"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { advanceGate, newSpeechGate, rms, type SpeechGate } from "./voice-activity";

/**
 * Listens to the microphone's level, and nothing else. No transcription, no
 * recording, no upload: an AnalyserNode reads the waveform in the page, we take
 * one number off it, and the samples are overwritten on the next frame.
 *
 * This exists because speech recognition is not a usable voice-activity
 * detector. It reports words, late, and only sometimes; it cannot tell us that
 * someone has started talking over the coach, and it cannot tell a two-second
 * think from the end of a sentence. The level can.
 *
 * Deliberately separate from useSignalCapture: that one takes video and never
 * touches audio, this one takes audio and never touches video. Neither sends
 * anything anywhere.
 */

/** 20Hz. The gate's shortest decision is 140ms, so this is plenty. */
const TICK_MS = 50;

export interface MicActivity {
  /** True once a stream is open and levels are actually arriving. */
  available: boolean;
  /** Debounced: sound has held above the speech threshold. Flips rarely. */
  speaking: boolean;
  /**
   * performance.now() of the last frame that counted as speech, 0 if there
   * hasn't been one. A ref rather than state on purpose: it moves 20 times a
   * second and nothing should re-render for it. The auto-send countdown polls it.
   */
  speechAt: RefObject<number>;
}

export function useMicActivity({ enabled }: { enabled: boolean }): MicActivity {
  const [available, setAvailable] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speechAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    if (typeof window === "undefined" || !("AudioContext" in window)) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let timer: number | null = null;
    let gate: SpeechGate = newSpeechGate();

    const start = async () => {
      let opened: MediaStream;
      try {
        opened = await navigator.mediaDevices.getUserMedia({
          // Echo cancellation matters more here than anywhere else in the app:
          // without it the coach's own voice out of the laptop speakers reads
          // as the user talking, and barge-in fires on the coach interrupting
          // itself.
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
      } catch {
        // Denied, or no input device. Auto-send falls back to recognition
        // timing and everything else carries on.
        return;
      }
      if (cancelled) {
        opened.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = opened;

      const ctx = new AudioContext();
      context = ctx;
      // Autoplay policy can hand back a suspended context; entering the room is
      // a user gesture, so this resolves immediately in practice.
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      if (cancelled) return;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0;
      ctx.createMediaStreamSource(opened).connect(analyser);
      // Not connected to the destination: nothing is played back, so there is
      // no feedback loop and nothing for the user to hear.

      const frame = new Float32Array(analyser.fftSize);
      setAvailable(true);

      timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(frame);
        const now = performance.now();
        const next = advanceGate(gate, rms(frame), now);
        if (next !== gate) {
          const was = gate.speaking;
          gate = next;
          if (next.speaking !== was) setSpeaking(next.speaking);
        }
        if (gate.speaking) speechAt.current = now;
      }, TICK_MS);
    };

    void start();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      void context?.close().catch(() => {});
      setAvailable(false);
      setSpeaking(false);
      speechAt.current = 0;
    };
  }, [enabled]);

  return { available, speaking, speechAt };
}
