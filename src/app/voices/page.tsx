"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { SPEAKERS } from "@/lib/voices";
import { loadProfile, saveProfile } from "@/lib/storage";

/** Long enough to judge a voice, short enough to stay cheap to audition. */
const SAMPLE =
  "Right, tell me about yourself. And take your time, there's no rush here.";

export default function VoicesPage() {
  const [playing, setPlaying] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<string, string>());

  const play = useCallback(async (speaker: string) => {
    setError(null);
    audioRef.current?.pause();
    setPlaying(speaker);
    try {
      let url = cache.current.get(speaker);
      if (!url) {
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: SAMPLE, speaker }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(payload?.error ?? "Couldn't reach the voice service.");
        }
        url = URL.createObjectURL(await res.blob());
        cache.current.set(speaker, url);
      }
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlaying(null);
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setPlaying(null);
    }
  }, []);

  function choose(speaker: string) {
    const profile = loadProfile();
    if (!profile) {
      setError("Finish setup in the app first, then come back and pick a voice.");
      return;
    }
    saveProfile({ ...profile, voice: speaker, speakReplies: true });
    setChosen(speaker);
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-12">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-blue-strong">PrepRoom</p>
      <h1 className="mt-3 text-2xl font-semibold text-ink">Pick a voice</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        These are Sarvam&apos;s Bulbul voices, reading a line the interviewer might open with.
        Whichever you choose becomes the coach&apos;s voice everywhere. Each preview costs a
        fraction of a rupee, and repeats are cached.
      </p>

      {error && (
        <p className="mt-4 rounded-xl border border-red/40 bg-red/8 px-3.5 py-2.5 text-sm text-ink">
          {error}
        </p>
      )}

      {chosen && (
        <p className="mt-4 rounded-xl border border-blue/50 bg-blue/12 px-3.5 py-2.5 text-sm text-ink">
          Saved. The coach will use <span className="font-medium">{chosen}</span> from now on.{" "}
          <Link href="/" className="text-blue-strong underline underline-offset-2">
            Back to PrepRoom
          </Link>
        </p>
      )}

      <ul className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SPEAKERS.map((speaker) => (
          <li
            key={speaker}
            className="flex items-center justify-between gap-3 rounded-xl border bg-card hairline px-3.5 py-2.5"
          >
            <span className="text-sm font-medium capitalize text-ink">{speaker}</span>
            <span className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => play(speaker)}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
              >
                {playing === speaker ? "Playing…" : "Play"}
              </button>
              <button
                type="button"
                onClick={() => choose(speaker)}
                className={[
                  "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                  chosen === speaker
                    ? "bg-blue/20 text-ink"
                    : "text-blue-strong hover:bg-fill-2",
                ].join(" ")}
              >
                {chosen === speaker ? "Chosen" : "Use"}
              </button>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm">
        <Link href="/" className="text-blue-strong underline underline-offset-2">
          Back to PrepRoom
        </Link>
      </p>
    </main>
  );
}
