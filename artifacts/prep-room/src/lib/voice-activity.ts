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
 * Root-mean-square level that counts as possibly-speech, and the lower level it
 * has to fall back through before the silence clock starts. The gap between
 * them is hysteresis: without it, the dip between two words restarts the whole
 * thing every syllable.
 *
 * Calibrated against getUserMedia with the browser's own gain control on, where
 * ordinary room noise sits around 0.005-0.02 and speech runs 0.05-0.2.
 */
export const SPEECH_ON_RMS = 0.035;
export const SPEECH_OFF_RMS = 0.02;

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
}

const NOT_RISING = -1;

export function newSpeechGate(): SpeechGate {
  return { speaking: false, risingSince: NOT_RISING };
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
  if (prev.speaking) {
    // It takes a clear drop to call it silence, not just a quiet syllable.
    return level > SPEECH_OFF_RMS ? prev : newSpeechGate();
  }
  if (level < SPEECH_ON_RMS) {
    return prev.risingSince < 0 ? prev : newSpeechGate();
  }
  if (prev.risingSince < 0) {
    return { speaking: false, risingSince: now };
  }
  if (now - prev.risingSince >= minMs) {
    return { speaking: true, risingSince: prev.risingSince };
  }
  return prev;
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
