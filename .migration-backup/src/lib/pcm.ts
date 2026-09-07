/**
 * Turning the coach's voice into something AvatarKit can lip-sync to.
 *
 * Sarvam hands back mp3. AvatarKit's motion server wants mono PCM16 at the
 * session's sample rate. The conversion happens in the page, on audio we
 * already have, and adds a few milliseconds per sentence.
 *
 * The float-to-PCM half is pure and tested. The decode half needs
 * OfflineAudioContext and is browser-only.
 */

/**
 * 24kHz, not the SDK's 16kHz default. The avatar plays this audio back to the
 * user, so it is the voice they hear, and 16kHz mono is telephone quality on a
 * coaching line. 24k is in the supported set and costs a third more upload.
 */
export const AVATAR_SAMPLE_RATE = 24000;

/**
 * Interleaved-free: the avatar takes mono, and averaging is a truer downmix
 * than picking the left channel when a provider ever returns stereo.
 */
export function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const length = channels[0].length;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let total = 0;
    for (const channel of channels) total += channel[i] ?? 0;
    out[i] = total / channels.length;
  }
  return out;
}

/**
 * Float samples in [-1, 1] to 16-bit signed little-endian.
 *
 * The asymmetric scaling is deliberate: signed 16-bit runs -32768 to 32767, so
 * multiplying both directions by 32768 clips every peak at +1.0 into a wrap.
 */
export function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/** A run of silence, used to close a speech turn without an audible click. */
export function silence(ms: number, sampleRate = AVATAR_SAMPLE_RATE): ArrayBuffer {
  return new ArrayBuffer(Math.round((ms / 1000) * sampleRate) * 2);
}

/**
 * Decodes an audio blob and resamples it to `sampleRate`.
 *
 * decodeAudioData resamples to the sample rate of the context it's called on,
 * which is why the OfflineAudioContext is created at the target rate rather
 * than the device's. Returns null rather than throwing: a sentence that won't
 * decode falls back to ordinary playback, it doesn't end the session.
 */
export async function toPcm16(
  blob: Blob,
  sampleRate = AVATAR_SAMPLE_RATE
): Promise<ArrayBuffer | null> {
  if (typeof window === "undefined") return null;
  const Offline = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;
  if (!Offline) return null;

  try {
    const bytes = await blob.arrayBuffer();
    // Length 1: nothing is rendered, the context exists only to carry the rate.
    const context = new Offline(1, 1, sampleRate);
    const decoded = await context.decodeAudioData(bytes);
    const channels: Float32Array[] = [];
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      channels.push(decoded.getChannelData(c));
    }
    const mono = downmix(channels);
    return mono.length ? floatToPcm16(mono) : null;
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  }
}
