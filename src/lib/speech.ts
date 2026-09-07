"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forSpeaking, lastSentenceBoundary } from "./speech-text";
import { toPcm16 } from "./pcm";
import type { AvatarSink } from "./avatar";

/**
 * Web Speech API wrappers. Both halves feature-detect and degrade to typing, * Firefox has no SpeechRecognition at all, and iOS Safari is inconsistent, so
 * nothing here may be load-bearing.
 *
 * Default language is en-IN: the first market is Indian students, and en-US
 * recognition mangles Indian-accented English badly enough to be unusable.
 */
export const DEFAULT_LANG = "en-IN";

/* ---- SpeechRecognition is not in lib.dom.d.ts, so type the bits we use ---- */

interface RecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface RecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  [index: number]: RecognitionAlternative;
}
interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}
interface RecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: RecognitionResultList;
}
interface RecognitionErrorEvent extends Event {
  readonly error: string;
}
interface RecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => RecognitionInstance;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** For screens that need to know what's available before anything is wired up. */
export function useSpeechSupport() {
  return useMemo(
    () => ({
      dictation: recognitionCtor() !== null,
      speaking: typeof window !== "undefined" && "speechSynthesis" in window,
    }),
    []
  );
}

export type DictationError = "denied" | "no-speech" | "network" | "failed";

const ERROR_COPY: Record<DictationError, string> = {
  denied: "Your browser is blocking the mic. Allow it in the address bar, or just type.",
  "no-speech": "Didn't catch anything. Try again, or type it.",
  network: "Speech recognition needs a connection right now. You can type instead.",
  failed: "The mic stopped working. You can type instead.",
};

export function dictationErrorCopy(err: DictationError): string {
  return ERROR_COPY[err];
}

/**
 * Push-to-talk dictation. Final phrases are handed to `onFinal`; the in-flight
 * guess is exposed as `interim` so the user can see it landing.
 */
export function useDictation({
  lang = DEFAULT_LANG,
  onFinal,
}: {
  lang?: string;
  onFinal: (text: string) => void;
}) {
  const supported = useMemo(() => recognitionCtor() !== null, []);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<DictationError | null>(null);

  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const wantRef = useRef(false);
  const restartsRef = useRef(0);
  // Kept current in an effect, not during render, so the long-lived recognition
  // handlers always call the latest callback without being re-bound.
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const stop = useCallback(() => {
    wantRef.current = false;
    setListening(false);
    setInterim("");
    const r = recognitionRef.current;
    recognitionRef.current = null;
    if (r) {
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      try {
        r.abort();
      } catch {
        // Already dead, so nothing to do.
      }
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || wantRef.current) return;

    setError(null);
    setInterim("");
    restartsRef.current = 0;
    wantRef.current = true;

    const begin = () => {
      const r = new Ctor();
      recognitionRef.current = r;
      r.lang = lang;
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;

      r.onresult = (event) => {
        let pendingInterim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript ?? "";
          if (result.isFinal) {
            const clean = text.trim();
            if (clean) onFinalRef.current(clean);
          } else {
            pendingInterim += text;
          }
        }
        setInterim(pendingInterim.trim());
      };

      r.onerror = (event) => {
        // "aborted" is us calling stop(); "no-speech" happens on any pause.
        if (event.error === "aborted") return;
        if (event.error === "no-speech") return;
        const mapped: DictationError =
          event.error === "not-allowed" || event.error === "service-not-allowed"
            ? "denied"
            : event.error === "network"
              ? "network"
              : "failed";
        wantRef.current = false;
        setError(mapped);
        setListening(false);
        setInterim("");
      };

      // Chrome ends the session on every pause even with continuous = true,
      // so keep it alive until the user actually stops. The counter is a
      // circuit breaker against a restart storm when the mic is unavailable.
      r.onend = () => {
        if (!wantRef.current) return;
        if (restartsRef.current > 40) {
          wantRef.current = false;
          setListening(false);
          setError("failed");
          return;
        }
        restartsRef.current += 1;
        try {
          begin();
        } catch {
          wantRef.current = false;
          setListening(false);
          setError("failed");
        }
      };

      r.start();
    };

    try {
      begin();
      setListening(true);
    } catch {
      wantRef.current = false;
      setListening(false);
      setError("failed");
    }
  }, [lang]);

  useEffect(() => stop, [stop]);

  return { supported, listening, interim, error, start, stop, clearError: () => setError(null) };
}

/* ------------------------------- speaking -------------------------------- */

function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const base = lang.split("-")[0];
  return (
    voices.find((v) => v.lang.replace("_", "-") === lang) ??
    voices.find((v) => v.lang.replace("_", "-").startsWith(`${base}-`)) ??
    null
  );
}

export type VoiceEngine = "bulbul" | "browser" | "none";

/**
 * Asked once per page load, not per component, and never on mount: resolving it
 * inside an effect would mean setState-in-effect for something that isn't
 * rendering state anyway.
 */
let enginePromise: Promise<VoiceEngine> | null = null;

function browserEngine(): VoiceEngine {
  return typeof window !== "undefined" && "speechSynthesis" in window ? "browser" : "none";
}

export function resolveEngine(): Promise<VoiceEngine> {
  if (!enginePromise) {
    enginePromise = fetch("/api/speak")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.available ? ("bulbul" as const) : browserEngine()))
      .catch(browserEngine);
  }
  return enginePromise;
}

interface Clip {
  text: string;
  controller: AbortController;
  blob: Promise<Blob | null>;
}

/**
 * Speaks the advisor's reply as it streams, one sentence at a time. Waiting for
 * the whole reply before starting adds a few seconds of silence, which reads as
 * the app being broken.
 *
 * Each sentence is fetched from /api/speak while the previous one is still
 * playing, so the network cost mostly hides behind playback. If Bulbul is
 * unconfigured or a clip fails, that sentence falls back to speechSynthesis
 * rather than being dropped.
 */
export function useSpeaker({
  enabled,
  speaker,
  sink,
  lang = DEFAULT_LANG,
}: {
  enabled: boolean;
  speaker?: string;
  /**
   * Where the audio goes when the coach has a face. The avatar plays the clip
   * itself so the mouth and the sound stay together; without one, or when it
   * refuses a clip, playback falls back to the audio element below.
   */
  sink?: AvatarSink;
  lang?: string;
}) {
  const supported = useMemo(
    () => typeof window !== "undefined" && ("speechSynthesis" in window || "fetch" in window),
    []
  );
  const [speaking, setSpeaking] = useState(false);

  const spokenUpToRef = useRef(0);
  const queueRef = useRef<Clip[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const drainingRef = useRef(false);
  const generationRef = useRef(0);

  const enabledRef = useRef(enabled);
  const speakerRef = useRef(speaker);
  const sinkRef = useRef(sink);
  useEffect(() => {
    enabledRef.current = enabled;
    speakerRef.current = speaker;
    sinkRef.current = sink;
  }, [enabled, speaker, sink]);

  /** Set by flush(), so the drain loop knows the reply is complete. */
  const endPendingRef = useRef(false);
  /**
   * Whether any part of THIS reply went to the avatar. Per reply rather than
   * per drain pass, because a reply is drained in several passes as sentences
   * arrive, and only the pass that happens to run last would otherwise know to
   * close the turn.
   */
  const avatarRoundRef = useRef(false);

  // Voices load asynchronously; touching the list early makes them available later.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const warm = () => window.speechSynthesis.getVoices();
    warm();
    window.speechSynthesis.addEventListener("voiceschanged", warm);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", warm);
  }, []);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    drainingRef.current = false;
    spokenUpToRef.current = 0;

    for (const clip of queueRef.current) clip.controller.abort();
    queueRef.current = [];

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    endPendingRef.current = false;
    avatarRoundRef.current = false;
    sinkRef.current?.interrupt();
    setSpeaking(false);
  }, []);

  /** Last resort for one sentence, so a failed clip doesn't silently vanish. */
  const speakInBrowser = useCallback(
    (text: string) =>
      new Promise<void>((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        const voice = pickVoice(lang);
        if (voice) utterance.voice = voice;
        utterance.rate = 1.02;
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      }),
    [lang]
  );

  const playClip = useCallback(
    async (clip: Clip) => {
      const blob = await clip.blob.catch(() => null);
      if (!blob) {
        await speakInBrowser(clip.text);
        return;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      try {
        await audio.play();
        await new Promise<void>((resolve) => {
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
        });
      } catch {
        // Autoplay refused, or a decode error. Say it the plain way instead.
        await speakInBrowser(clip.text);
      } finally {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      }
    },
    [speakInBrowser]
  );

  const drain = useCallback(async () => {
    if (drainingRef.current) return;
    drainingRef.current = true;
    const generation = generationRef.current;
    setSpeaking(true);

    while (queueRef.current.length > 0 && generation === generationRef.current) {
      const clip = queueRef.current.shift()!;

      // The avatar path doesn't wait for playback to finish. Its whole model is
      // that audio is pushed as it arrives and the motion server stays ahead;
      // pacing it to wall-clock here is exactly what its docs warn stalls it.
      const avatar = sinkRef.current;
      if (avatar?.ready) {
        const blob = await clip.blob.catch(() => null);
        if (generation !== generationRef.current) break;
        const pcm = blob ? await toPcm16(blob) : null;
        if (generation !== generationRef.current) break;
        if (pcm && avatar.send(pcm)) {
          avatarRoundRef.current = true;
          continue;
        }
        // Wouldn't decode, or the avatar wouldn't take it. Say it anyway.
        await speakInBrowser(clip.text);
        continue;
      }

      await playClip(clip);
    }

    drainingRef.current = false;
    if (generation !== generationRef.current) return;

    if (avatarRoundRef.current && endPendingRef.current) {
      endPendingRef.current = false;
      avatarRoundRef.current = false;
      sinkRef.current?.finish();
      // The avatar reports its own playback state, so this flag stops meaning
      // anything the moment it takes over.
      setSpeaking(false);
      return;
    }
    setSpeaking(false);
  }, [playClip, speakInBrowser]);

  const enqueue = useCallback(
    async (raw: string) => {
      const text = forSpeaking(raw);
      if (!text) return;

      const engine = await resolveEngine();
      if (engine === "none") return;

      const controller = new AbortController();
      const blob: Promise<Blob | null> =
        engine === "bulbul"
          ? fetch("/api/speak", {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({ text, speaker: speakerRef.current }),
            })
              .then((r) => (r.ok ? r.blob() : null))
              .catch(() => null)
          : Promise.resolve(null);

      queueRef.current.push({ text, controller, blob });
      void drain();
    },
    [drain]
  );

  /** Call with the full text received so far; only new whole sentences are spoken. */
  const feed = useCallback(
    (full: string) => {
      if (!enabledRef.current) return;
      const pending = full.slice(spokenUpToRef.current);
      const boundary = lastSentenceBoundary(pending);
      if (boundary <= 0) return;
      spokenUpToRef.current += boundary;
      void enqueue(pending.slice(0, boundary));
    },
    [enqueue]
  );

  /** Speak the trailing fragment once the stream is done. */
  const flush = useCallback(
    (full: string) => {
      if (!enabledRef.current) return;
      const rest = full.slice(spokenUpToRef.current);
      spokenUpToRef.current = full.length;
      endPendingRef.current = true;
      if (rest.trim()) {
        void enqueue(rest);
        return;
      }
      // The reply ended exactly on a sentence boundary, so there is no trailing
      // fragment to enqueue. If the queue has already emptied, nothing is left
      // to notice the round is over except this.
      if (!drainingRef.current && queueRef.current.length === 0) {
        endPendingRef.current = false;
        if (avatarRoundRef.current) {
          avatarRoundRef.current = false;
          sinkRef.current?.finish();
        }
      }
    },
    [enqueue]
  );

  /** Start of a new reply, so forget how far we got in the previous one. */
  const reset = useCallback(() => {
    spokenUpToRef.current = 0;
    endPendingRef.current = false;
    avatarRoundRef.current = false;
  }, []);

  useEffect(() => cancel, [cancel]);

  return { supported, speaking, feed, flush, reset, cancel };
}
