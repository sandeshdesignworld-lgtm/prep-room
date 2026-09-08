"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Getting iOS to let the coach speak at all.
 *
 * Safari will not play audio that a person did not ask for, and it is stricter
 * than the rule sounds. It is not enough that a tap happened somewhere earlier:
 * an HTMLAudioElement is unlocked individually, by having play() called on it
 * inside a gesture handler, and it stays unlocked afterwards. An element
 * created later, in a network callback, is blocked however many taps preceded
 * it.
 *
 * The coach used to build a fresh Audio for every sentence, in a promise chain
 * after a fetch. On a desktop that is fine. On an iPhone it meant the voice
 * never arrived and nothing said why.
 *
 * So: one element, unlocked on the first tap, reused for every sentence
 * afterwards. Plus an AudioContext resumed at the same moment, which is what
 * the avatar's own player and the level meter need.
 *
 * unlock() has to be called SYNCHRONOUSLY from inside a real gesture handler.
 * Awaiting anything first spends the gesture and Safari refuses.
 */

/** One frame of silence. Something has to be played, and this is the least of it. */
const SILENCE =
  "data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQIAAAAAAA==";

let element: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let unlocked = false;

const listeners = new Set<() => void>();

function announce() {
  for (const l of listeners) l();
}

/**
 * The one audio element the coach speaks through.
 *
 * Created on demand and never replaced, because replacing it would throw away
 * the unlock and iOS would go quiet again.
 */
export function sharedAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (!element) {
    element = new Audio();
    element.preload = "auto";
    // Tells iOS this is speech rather than a ringtone, and keeps it playing
    // when the phone is on silent in an installed app.
    element.setAttribute("playsinline", "");
  }
  return element;
}

/** Shared so the level meter and the avatar do not each open their own. */
export function sharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  return context;
}

export function audioUnlocked(): boolean {
  return unlocked;
}

/**
 * Call this from inside a tap handler, before anything is awaited.
 *
 * Safe to call repeatedly. Failing is not an error worth showing: the room
 * offers a "turn the sound on" tap of its own if this did not take.
 */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;

  const ctx = sharedAudioContext();
  if (ctx) {
    void ctx.resume().catch(() => {});
    try {
      // A single silent frame through the graph. Some iOS versions want the
      // context to have actually rendered something before they trust it.
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, 22050);
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // An unusable context is not worth failing a tap over.
    }
  }

  const audio = sharedAudio();
  if (!audio) return;
  audio.src = SILENCE;
  const played = audio.play();
  if (played) {
    void played
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        if (!unlocked) {
          unlocked = true;
          announce();
        }
      })
      .catch(() => {
        // Blocked. The room will offer the user a way to ask again.
      });
  }
}

/* ------------------------------- for React -------------------------------- */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function serverSnapshot(): boolean {
  return false;
}

/** Whether the coach is allowed to make a sound yet, and a way to ask again. */
export function useAudioUnlocked() {
  const ready = useSyncExternalStore(subscribe, audioUnlocked, serverSnapshot);
  const unlock = useCallback(() => unlockAudio(), []);
  return { ready, unlock };
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
