/**
 * Server-only. Sarvam's Bulbul text-to-speech, used because the browser's own
 * speechSynthesis reads Indian English like a train announcement.
 *
 * The key is read from the environment and must never reach the client, same
 * rule as the Anthropic key. If it isn't configured the app falls back to
 * speechSynthesis rather than losing voice entirely.
 */
import { isSpeaker } from "./voices";

const ENDPOINT = "https://api.sarvam.ai/text-to-speech/stream";

export const SARVAM_MODEL = process.env.SARVAM_MODEL ?? "bulbul:v3";

/** Override with SARVAM_SPEAKER once you've auditioned them at /voices. */
export const DEFAULT_SPEAKER = isSpeaker(process.env.SARVAM_SPEAKER)
  ? process.env.SARVAM_SPEAKER
  : "shubh";

export function sarvamConfigured(): boolean {
  return Boolean(process.env.SARVAM_API_KEY);
}

/**
 * What the caller wants back.
 *
 * `mp3` is for an <audio> element, which is how the coach speaks when there is
 * no avatar. `pcm` is raw mono PCM16 at PCM_SAMPLE_RATE, which is exactly what
 * AvatarKit's motion server takes, so with an avatar the audio goes from Sarvam
 * to Spatius without being decoded, re-encoded or resampled anywhere in
 * between. That is the whole reason the lips and the voice stay together:
 * there is one stream, and one clock.
 */
export type SpeechFormat = "mp3" | "pcm";

/** Must match AVATAR_SAMPLE_RATE in lib/pcm.ts: it is the same audio. */
export const PCM_SAMPLE_RATE = 24000;

export const CONTENT_TYPE: Record<SpeechFormat, string> = {
  mp3: "audio/mpeg",
  pcm: "audio/pcm",
};

/** Streaming keeps time-to-first-audio short; the body is audio, not JSON. */
export async function speak(opts: {
  text: string;
  speaker: string;
  format: SpeechFormat;
  signal?: AbortSignal;
}): Promise<Response> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new Error("SARVAM_API_KEY is not set");

  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "api-subscription-key": key,
      "content-type": "application/json",
    },
    signal: opts.signal,
    body: JSON.stringify({
      text: opts.text,
      model: SARVAM_MODEL,
      speaker: opts.speaker,
      language_code: "en-IN",
      // linear16 is 16-bit little-endian mono, headerless, at the rate below.
      output_audio_codec: opts.format === "pcm" ? "linear16" : "mp3",
      ...(opts.format === "pcm" ? { speech_sample_rate: PCM_SAMPLE_RATE } : {}),
      // A hair under conversational speed; the default rushes the coaching lines.
      pace: 0.95,
    }),
  });
}
