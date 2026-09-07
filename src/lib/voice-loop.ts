"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useDictation, type DictationError } from "./speech";
import { useMicActivity } from "./mic";
import { joinSpoken } from "./speech-text";
import { lastHeard, shouldSend, silenceRemaining, NOISY_ROOM_RMS } from "./voice-activity";

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

/** Long enough for the noise floor to mean something before it is read. */
const NOISE_SETTLE_MS = 4000;

/**
 * How the microphone behaves.
 *
 * "auto" is hands-free: it picks up when you start talking and sends when you
 * stop. Lovely at a desk, unusable in a room with other people in it, because
 * every one of those decisions is a guess about whose voice it just heard.
 *
 * "tap" is the honest fallback: it listens only between one tap and the next,
 * and sends when you stop it. No guessing, no picking up on a flatmate, no turn
 * held open by a television.
 */
export type MicMode = "auto" | "tap";

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
  /** Recognition is deliberately off because the coach is talking. */
  heldForCoach: boolean;
  /**
   * The room is loud enough that hands-free listening will misfire. Set once,
   * from the ambient level, so the room can suggest tap to talk rather than
   * the user having to work out why it keeps interrupting them.
   */
  noisyRoom: boolean;
}

export function useVoiceLoop({
  micOn,
  mode,
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
  mode: MicMode;
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

  /* ------------------- while the coach is talking, don't listen ------------ */

  /**
   * Recognition is stopped for as long as the coach is speaking, and put back
   * when it stops.
   *
   * The coach comes out of the speakers and goes straight back into the
   * microphone. Speech recognition opens its own audio stream that we cannot
   * put echo cancellation on, so it hears the coach clearly, transcribes it,
   * and hands it back as though the user had said it. That is the feedback
   * loop: the coach answers itself, the turn sends early, and with the avatar
   * playing at the same time the audio breaks up.
   *
   * Barge-in survives this. It runs off the level meter below, which has echo
   * cancellation and is a different stream, so talking over the coach still
   * stops it and hands the microphone straight back.
   */
  const wasHeldRef = useRef(false);
  useEffect(() => {
    if (coachSpeaking && listening) {
      wasHeldRef.current = true;
      stop();
      return;
    }
    // Back to the user's turn. Only resume what we ourselves interrupted, and
    // only in the hands-free mode: tap to talk means the mic starts when the
    // user says it starts.
    if (!coachSpeaking && wasHeldRef.current) {
      wasHeldRef.current = false;
      if (mode === "auto" && micOn && supported) start();
    }
  }, [coachSpeaking, listening, mode, micOn, supported, start, stop]);

  /* --------------------------- barge-in and pickup ------------------------- */

  useEffect(() => {
    if (!mic.speaking) return;
    // Talking over the coach stops the coach. Nothing else interrupts it: the
    // reply stays on screen, it just stops being read out over the user.
    if (coachSpeaking) {
      onInterruptRef.current();
      wasHeldRef.current = true;
    }
    // And someone who has already started talking shouldn't have to find a
    // button first. Without this the loop only runs once: auto-send stops the
    // recogniser to take the tail cleanly, and the next turn would need a tap.
    // Hands-free only: tap to talk exists precisely so nothing picks itself up.
    if (mode === "auto" && micOn && supported && !listening && !coachSpeaking) start();
  }, [mic.speaking, coachSpeaking, mode, micOn, supported, listening, start]);

  /* ----------------------------- a loud room ------------------------------- */

  const [noisyRoom, setNoisyRoom] = useState(false);
  useEffect(() => {
    if (!micOn || !levelAvailable) return;
    // Sampled a few seconds in, once the floor has had time to settle, and
    // decided once rather than flapping as the room comes and goes.
    const id = window.setTimeout(() => {
      setNoisyRoom(mic.noiseFloor.current >= NOISY_ROOM_RMS);
    }, NOISE_SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [micOn, levelAvailable, mic.noiseFloor]);

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

  // Never while the coach is talking, and never in tap to talk, where the
  // user ends their own turn.
  const armed =
    mode === "auto" &&
    autoSend &&
    listening &&
    !busy &&
    !coachSpeaking &&
    (hasDraft || interim.trim().length > 0);

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
    heldForCoach: coachSpeaking && !listening,
    noisyRoom,
  };
}
