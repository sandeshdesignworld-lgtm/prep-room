"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDictation, type DictationError } from "./speech";
import { useMicActivity } from "./mic";
import { joinSpoken } from "./speech-text";
import { lastHeard, shouldSend, silenceRemaining } from "./voice-activity";

/**
 * The voice half of a turn, in one place: what the user said, when they stopped
 * saying it, and therefore when their turn goes.
 *
 * Nothing here changes how a message reaches the API. It changes what pulls the
 * trigger. The same send path runs whether the user tapped Send, pressed Enter,
 * or simply stopped talking, which is the only way this stays debuggable.
 *
 * Three behaviours, and they are all about not talking over the user:
 *  - auto-send, after SILENCE_MS of actual quiet, with a visible countdown that
 *    any sound at all puts back;
 *  - barge-in, so starting to speak while the coach is talking stops the coach
 *    rather than being transcribed on top of it;
 *  - a manual Send, and a switch to turn the whole thing off, because a
 *    generous silence window is still a guess about how someone thinks.
 */

/** How often the countdown is recomputed. 15 renders across the window. */
const COUNTDOWN_TICK_MS = 100;

export interface VoiceLoop {
  /** Does this browser do speech recognition at all. */
  supported: boolean;
  listening: boolean;
  /** The phrase still being recognised; shown, not yet committed. */
  interim: string;
  error: DictationError | null;
  clearError: () => void;
  /** Toggles the mic. Starting always silences the coach first. */
  toggle: () => void;
  stop: () => void;
  /** Milliseconds left before the turn goes, or null when nothing is pending. */
  countdownMs: number | null;
  /** Hold the send back until the user speaks again. */
  cancelPending: () => void;
  /** False when the level meter isn't running, so the copy can stay honest. */
  levelAvailable: boolean;
}

export function useVoiceLoop({
  micOn,
  autoSend,
  hasDraft,
  busy,
  coachSpeaking,
  getDraft,
  onDictated,
  onSend,
  onInterrupt,
}: {
  micOn: boolean;
  autoSend: boolean;
  /** Is there anything committed to send yet. */
  hasDraft: boolean;
  /** A reply is streaming, so nothing may go out underneath it. */
  busy: boolean;
  coachSpeaking: boolean;
  getDraft: () => string;
  /** A finished phrase, to append to the draft. */
  onDictated: (text: string) => void;
  /** Send this exact text. The draft plus whatever was still being recognised. */
  onSend: (text: string) => void;
  /** Stop the coach's audio: the user is talking. */
  onInterrupt: () => void;
}): VoiceLoop {
  const [countdownMs, setCountdownMs] = useState<number | null>(null);

  const interimRef = useRef("");
  /** When recognition last produced anything. The fallback clock. */
  const heardAtRef = useRef(0);
  /** Speech at or before this instant has already been declined. */
  const declinedAtRef = useRef(0);
  const armedAtRef = useRef(0);

  // Read inside long-lived timers and handlers, so they never close over a
  // stale render.
  const getDraftRef = useRef(getDraft);
  const onSendRef = useRef(onSend);
  const onDictatedRef = useRef(onDictated);
  const onInterruptRef = useRef(onInterrupt);
  useEffect(() => {
    getDraftRef.current = getDraft;
    onSendRef.current = onSend;
    onDictatedRef.current = onDictated;
    onInterruptRef.current = onInterrupt;
  });

  const dictation = useDictation({
    onFinal: (text) => {
      heardAtRef.current = performance.now();
      onDictatedRef.current(text);
    },
  });
  const { supported, listening, interim, error, start, stop, clearError } = dictation;

  const mic = useMicActivity({ enabled: micOn });
  const levelAvailable = mic.available;

  const levelAvailableRef = useRef(levelAvailable);
  useEffect(() => {
    levelAvailableRef.current = levelAvailable;
  }, [levelAvailable]);

  /**
   * When the user was last making a sound. Whichever source heard them last.
   *
   * This used to prefer the level meter and fall back to recognition only when
   * the meter was unavailable, on the reasoning that recognition results arrive
   * late and would stretch the window. The reasoning was right and the rule was
   * wrong, because there is a third state it ignored: a meter that is running
   * and never hears anything. A quiet mic, a laptop across the desk, low input
   * gain. Then the meter's stamp stays at zero, the countdown is suppressed
   * forever, and the user talks, watches their words appear, and never gets an
   * answer. For an app whose users are the softly spoken ones, that is the
   * worst failure in it.
   *
   * So: the later of the two. When the meter is working it is almost always the
   * later one, because it stamps during speech, and the window stays honest.
   * When it hears nothing, recognition carries the clock on its own. The lag is
   * smaller than it looks, too, since interim results land while the user is
   * still talking rather than after they stop.
   */
  const lastSpeechAt = useCallback(
    () => lastHeard(levelAvailableRef.current ? mic.speechAt.current : 0, heardAtRef.current),
    [mic.speechAt]
  );

  useEffect(() => {
    interimRef.current = interim;
    if (!interim) return;
    heardAtRef.current = performance.now();
    // A word arriving while the coach is mid-sentence is the user talking over
    // it, whatever the level meter did or didn't notice. Not conditional on the
    // meter being absent: a meter that is running but never crosses its
    // threshold is exactly the case where this is the only thing that fires.
    onInterruptRef.current();
  }, [interim]);

  /* --------------------------- barge-in and pickup ------------------------- */

  useEffect(() => {
    if (!mic.speaking) return;
    // Talking over the coach stops the coach. Nothing else interrupts it: the
    // reply stays on screen, it just stops being read out over the user.
    if (coachSpeaking) onInterruptRef.current();
    // And someone who has already started talking shouldn't have to find a
    // button first. Without this the loop only runs once: auto-send stops the
    // recogniser to take the tail cleanly, and the next turn would need a tap.
    // Gated on auto-send, so switching that off leaves the mic strictly
    // push-to-talk, which is the point of switching it off.
    if (autoSend && micOn && supported && !listening) start();
  }, [mic.speaking, coachSpeaking, autoSend, micOn, supported, listening, start]);

  /** Muting the call has to actually stop the recogniser, not just hide it. */
  useEffect(() => {
    if (!micOn && listening) stop();
  }, [micOn, listening, stop]);

  /* ------------------------------- auto-send ------------------------------- */

  const fire = useCallback(() => {
    const text = joinSpoken(getDraftRef.current(), interimRef.current).trim();
    setCountdownMs(null);
    declinedAtRef.current = 0;
    if (!text) return;
    // Stop first: the tail is already folded into `text`, and leaving the
    // recogniser running would append the coach's reply to the next turn.
    stop();
    interimRef.current = "";
    onSendRef.current(text);
  }, [stop]);

  const armed = autoSend && listening && !busy && (hasDraft || interim.trim().length > 0);

  useEffect(() => {
    if (!armed) return;
    armedAtRef.current = performance.now();

    const id = window.setInterval(() => {
      const now = performance.now();
      const last = lastSpeechAt();
      // Nothing heard yet, or the user has already waved this send away and
      // hasn't spoken since. Either way there is nothing to count down.
      if (last <= 0 || last <= declinedAtRef.current) {
        setCountdownMs(null);
        return;
      }
      setCountdownMs(silenceRemaining(last, now));
      if (shouldSend({ lastSpeechAt: last, armedAt: armedAtRef.current, now })) fire();
    }, COUNTDOWN_TICK_MS);

    return () => {
      window.clearInterval(id);
      // Disarming has to take the indicator with it, or a cancelled countdown
      // sits on screen at whatever fraction it had reached.
      setCountdownMs(null);
    };
  }, [armed, lastSpeechAt, fire]);

  const cancelPending = useCallback(() => {
    declinedAtRef.current = lastSpeechAt();
    setCountdownMs(null);
  }, [lastSpeechAt]);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      setCountdownMs(null);
      return;
    }
    // Nobody wants to be transcribed over the coach's own voice.
    onInterruptRef.current();
    declinedAtRef.current = 0;
    start();
  }, [listening, start, stop]);

  return {
    supported,
    listening,
    interim,
    error,
    clearError,
    toggle,
    stop,
    countdownMs,
    cancelPending,
    levelAvailable,
  };
}
