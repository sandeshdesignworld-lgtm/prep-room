"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { firstChunkBoundary, forSpeaking, lastSentenceBoundary } from "./speech-text";
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

/**
 * Pumps one sentence of PCM from Sarvam into the avatar as it arrives.
 *
 * This is the whole sync fix. There used to be a decode in the middle: the mp3
 * was fetched whole, turned into PCM in the page, and only then handed over, so
 * nothing reached the avatar until the entire sentence had been synthesised and
 * decoded. Now the bytes Sarvam streams are already the format the motion
 * server wants, and they go straight through.
 *
 * Returns false when nothing was sent, so the caller can fall back.
 */
async function streamToAvatar(
  clip: Clip,
  avatar: AvatarSink,
  live: () => boolean
): Promise<boolean> {
  const res = await clip.response.catch(() => null);
  if (!res?.body) return false;

  const reader = res.body.getReader();
  /**
   * A chunk boundary can land in the middle of a sample: PCM16 is two bytes and
   * the network knows nothing about that. An odd trailing byte is carried into
   * the next chunk rather than shipped, which would shift every sample after it
   * by one byte and turn the rest of the sentence into noise.
   */
  let odd: Uint8Array | null = null;
  let sent = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!live()) {
        await reader.cancel().catch(() => {});
        return sent;
      }
      let bytes = value;
      if (odd) {
        const joined = new Uint8Array(odd.length + bytes.length);
        joined.set(odd);
        joined.set(bytes, odd.length);
        bytes = joined;
        odd = null;
      }
      if (bytes.length % 2 === 1) {
        odd = bytes.subarray(bytes.length - 1).slice();
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      if (bytes.length === 0) continue;
      // A copy, because the SDK holds onto the buffer past this call and the
      // reader is free to reuse the one it handed us.
      if (!avatar.send(bytes.slice().buffer)) return sent;
      sent = true;
    }
  } catch {
    // A dropped stream mid-sentence. Whatever arrived has already been sent.
  }
  return sent;
}

/**
 * Resolves when the promise does, or when the ceiling is reached.
 *
 * Every wait in the playback queue is a wait on a browser event, and a browser
 * event is not a promise anyone owes you. speechSynthesis is known to skip its
 * `end` callback on long utterances; a stalled decode fires neither `ended` nor
 * `error`. Either one hangs the queue forever, which leaves the coach marked as
 * still speaking, which leaves the microphone held, which is the room going
 * permanently silent. A ceiling turns all of that into a late sentence.
 */
function noLongerThan(promise: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.warn("[Prime AI voice] a clip never reported finishing, carrying on without it.");
      resolve();
    }, ms);
    void promise.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * How long a clip is allowed to take, from what it is.
 *
 * A flat ceiling had to be generous enough for the longest sentence anyone
 * might write, which made it useless as a recovery: thirty seconds of silence
 * per sentence is the app being broken, just on a timer. Speech runs about
 * fourteen characters a second, so the text says how long it should take, and
 * anything much past that has stalled.
 */
function clipCeilingMs(text: string): number {
  const spoken = (text.length / 14) * 1000;
  return Math.min(25000, Math.max(3000, spoken * 1.6 + 2000));
}

interface Clip {
  text: string;
  controller: AbortController;
  /**
   * How this clip is going to be played, decided when it was requested rather
   * than when it is played, because the format has to be asked of the server.
   * "pcm" streams into the avatar; "mp3" goes to an <audio> element.
   */
  format: "pcm" | "mp3";
  response: Promise<Response | null>;
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
      noLongerThan(
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
        clipCeilingMs(text)
      ),
    [lang]
  );

  const playClip = useCallback(
    async (clip: Clip) => {
      const res = await clip.response.catch(() => null);
      const blob = res ? await res.blob().catch(() => null) : null;
      if (!blob) {
        await speakInBrowser(clip.text);
        return;
      }
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      try {
        await audio.play();
        // The element knows its own length once it has metadata, which is a
        // far better ceiling than a guess from the text. Falls back to the
        // guess when it does not.
        await noLongerThan(
          new Promise<void>((resolve) => {
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
          }),
          Number.isFinite(audio.duration) && audio.duration > 0
            ? audio.duration * 1000 + 3000
            : clipCeilingMs(clip.text)
        );
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

      // The avatar path never waits for playback. Audio is pushed to the motion
      // server as fast as Sarvam produces it and the avatar plays it on its own
      // clock; pacing it to wall-clock here is exactly what its docs warn
      // stalls it. What this DOES wait for is the whole of one clip's stream
      // before starting the next, so sentences reach the server in order.
      const avatar = sinkRef.current;
      if (clip.format === "pcm" && avatar?.ready) {
        const sent = await streamToAvatar(clip, avatar, () => generation === generationRef.current);
        if (generation !== generationRef.current) break;
        if (sent) {
          avatarRoundRef.current = true;
          continue;
        }
        // Nothing arrived, or the avatar refused it. Say it the plain way.
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

      // Asked now, not at playback: the request has to name the format, and by
      // the time this clip's turn comes round the answer would be the same.
      const format = sinkRef.current?.ready ? "pcm" : "mp3";

      const controller = new AbortController();
      const response: Promise<Response | null> =
        engine === "bulbul"
          ? fetch("/api/speak", {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({ text, speaker: speakerRef.current, format }),
            })
              .then((r) => (r.ok ? r : null))
              .catch(() => null)
          : Promise.resolve(null);

      queueRef.current.push({ text, controller, format, response });
      void drain();
    },
    [drain]
  );

  /** Call with the full text received so far; only new whole sentences are spoken. */
  const feed = useCallback(
    (full: string) => {
      if (!enabledRef.current) return;
      const pending = full.slice(spokenUpToRef.current);
      // Nothing spoken yet this reply, so this is the opening and it is allowed
      // to break at a clause rather than wait for a full stop.
      const boundary =
        spokenUpToRef.current === 0 ? firstChunkBoundary(pending) : lastSentenceBoundary(pending);
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
