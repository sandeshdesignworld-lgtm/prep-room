/**
 * The rules behind auto-send. Pure: no React, no browser APIs, no audio, so
 * every threshold and every timing decision here can be tested directly.
 *
 * The product problem this solves: in a voice-first session, reaching for a
 * Send button after every sentence breaks the illusion that you are talking to
 * someone. So the turn goes on its own once the user stops speaking.
 *
 * The risk it creates is worse than the problem, though, and it shapes every
 * number below: some of the people this is for pause mid-thought, lose the
 * thread, and start again. Cutting one of them off mid-sentence is the single
 * worst thing this app can do. So the window is generous, the level has to hold
 * before it counts as speech at all, and any sound at all during the window
 * puts the send back.
 */

/**
 * How long the user has to be quiet before their turn goes.
 *
 * 1.5s is deliberate, not a placeholder. Half a second is what a transcription
 * demo uses and it truncates anyone who thinks before they finish. This is the
 * one number to move if the feel is wrong.
 */
export const SILENCE_MS = 1500;

/**
 * The quietest level that can ever count as speech, whatever the room is doing,
 * and the level it has to fall back through before the silence clock starts.
 * The gap between them is hysteresis: without it, the dip between two words
 * restarts the whole thing every syllable.
 *
 * These are a FLOOR, not the threshold. In a quiet room they are the threshold;
 * in a noisy one the threshold rises above them, because a fixed number that
 * works at a desk at night counts a cafe as one continuous sentence. See
 * speechThresholds().
 */
export const SPEECH_ON_RMS = 0.035;
export const SPEECH_OFF_RMS = 0.02;

/**
 * How far above the room's own noise the user has to be before it counts.
 *
 * Someone talking to you is much louder at your microphone than someone talking
 * across the room, so a threshold set relative to the ambient level separates
 * them where a fixed one cannot. It is not magic: a loud voice close by will
 * still register, and no amount of arithmetic can tell a flatmate leaning over
 * your shoulder from you. It handles the common case, which is a room with
 * other people in it several feet away.
 */
export const SPEECH_OVER_NOISE = 2.8;
/** Hysteresis, applied to the noise-relative threshold as well as the floor. */
export const RELEASE_RATIO = 0.6;

/**
 * How fast the noise floor follows the room, down and up.
 *
 * Asymmetric on purpose. Down is quick, so leaving a noisy room does not leave
 * the threshold stranded high and the user unheard. Up is slow, so a door
 * slamming does not raise the bar for the next ten seconds. Per audio frame, at
 * roughly 20 a second.
 */
export const NOISE_FALL = 0.25;
export const NOISE_RISE = 0.004;

/**
 * Above this the room is loud enough that hands-free listening will misfire,
 * and tap to talk is the better default. Roughly a busy cafe.
 */
export const NOISY_ROOM_RMS = 0.045;

/**
 * How long the level has to stay up before it counts. This is the noise-blip
 * filter: a door, a keyboard, a cough from the next room is loud but short, and
 * none of it should hold a send open.
 */
export const SPEECH_MIN_MS = 140;

/**
 * One rolling decision about whether sound is currently speech.
 * `risingSince` is when the level first crossed SPEECH_ON_RMS in the current
 * run, and is negative whenever it hasn't. A sentinel rather than 0, because 0
 * is a perfectly good timestamp and this has to be testable from t=0.
 */
export interface SpeechGate {
  speaking: boolean;
  risingSince: number;
  /** Rolling estimate of the room's own level, with the user not talking. */
  noiseFloor: number;
}

const NOT_RISING = -1;

export function newSpeechGate(): SpeechGate {
  return { speaking: false, risingSince: NOT_RISING, noiseFloor: 0 };
}

/**
 * What counts as speech right now, given how loud the room already is.
 *
 * Never below the absolute floor: in a silent room the noise estimate tends to
 * zero, and a threshold that went with it would call the microphone's own hiss
 * a sentence.
 */
export function speechThresholds(noiseFloor: number): { on: number; off: number } {
  const on = Math.max(SPEECH_ON_RMS, noiseFloor * SPEECH_OVER_NOISE);
  return { on, off: Math.max(SPEECH_OFF_RMS, on * RELEASE_RATIO) };
}

/**
 * Follows the room while the user is not talking.
 *
 * Only ever called with non-speech frames, so the user's own voice never raises
 * the bar they have to clear.
 */
export function adaptNoiseFloor(noiseFloor: number, level: number): number {
  const rate = level < noiseFloor ? NOISE_FALL : NOISE_RISE;
  return noiseFloor + (level - noiseFloor) * rate;
}

/**
 * Advances the gate by one audio frame. Returns the previous object unchanged
 * when nothing moved, so a caller can compare by identity and skip the work of
 * publishing a state that is the same as the last one.
 */
export function advanceGate(
  prev: SpeechGate,
  level: number,
  now: number,
  minMs = SPEECH_MIN_MS
): SpeechGate {
  const { on, off } = speechThresholds(prev.noiseFloor);

  if (prev.speaking) {
    // It takes a clear drop to call it silence, not just a quiet syllable. The
    // noise floor is left alone while someone is talking: this is not a sample
    // of the room, it is a sample of them.
    if (level > off) return prev;
    return { speaking: false, risingSince: NOT_RISING, noiseFloor: prev.noiseFloor };
  }

  // Not speech, so it is the room, so it is what the floor is made of.
  const noiseFloor = level < on ? adaptNoiseFloor(prev.noiseFloor, level) : prev.noiseFloor;

  if (level < on) {
    return { speaking: false, risingSince: NOT_RISING, noiseFloor };
  }
  if (prev.risingSince < 0) {
    return { speaking: false, risingSince: now, noiseFloor };
  }
  if (now - prev.risingSince >= minMs) {
    return { speaking: true, risingSince: prev.risingSince, noiseFloor };
  }
  return { speaking: false, risingSince: prev.risingSince, noiseFloor };
}

/** Level of one frame of time-domain audio, 0-1. */
export function rms(frame: ArrayLike<number>): number {
  if (frame.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < frame.length; i++) total += frame[i] * frame[i];
  const value = Math.sqrt(total / frame.length);
  return Number.isFinite(value) ? value : 0;
}

/**
 * When the user was last heard, given both clocks: the microphone level meter
 * and the speech recogniser. Zero from either means "that one has heard
 * nothing", not "the user stopped talking just now".
 *
 * Trivial, and it exists because getting it wrong was not. Preferring the meter
 * whenever it was merely RUNNING meant a quiet microphone reported zero forever
 * and the countdown never started: the user spoke, watched their words appear
 * on screen, and never got an answer.
 */
export function lastHeard(meterAt: number, recognisedAt: number): number {
  return Math.max(meterAt, recognisedAt);
}

/** Milliseconds left before the turn goes. 0 means send it. */
export function silenceRemaining(
  lastSpeechAt: number,
  now: number,
  silenceMs = SILENCE_MS
): number {
  return Math.max(0, silenceMs - (now - lastSpeechAt));
}

/**
 * The countdown has to be on screen long enough to be worth calling a warning.
 * Recognition results can land a second after the user actually stopped, which
 * would otherwise mean the indicator appears and the message goes in the same
 * frame, and the promise that you can talk over it would be a lie.
 */
export const MIN_VISIBLE_MS = 400;

/** Whether the turn may go now, given when it was armed and when speech ended. */
export function shouldSend(opts: {
  lastSpeechAt: number;
  armedAt: number;
  now: number;
  silenceMs?: number;
  minVisibleMs?: number;
}): boolean {
  const { lastSpeechAt, armedAt, now } = opts;
  if (lastSpeechAt <= 0) return false;
  if (now - armedAt < (opts.minVisibleMs ?? MIN_VISIBLE_MS)) return false;
  return silenceRemaining(lastSpeechAt, now, opts.silenceMs ?? SILENCE_MS) <= 0;
}
