"use client";

import { useState } from "react";
import { deleteEverything, exportEverything } from "@/lib/storage";
import { shortDate } from "@/lib/progress";
import type { Profile, Session } from "@/lib/types";

const KEPT = [
  "What you typed or said to the coach, and what it said back.",
  "Your practice transcripts, the score, and the debrief notes.",
  "If you used the camera: a handful of numbers per second: whether your head was pointed at the screen, how much you moved, how square your shoulders were.",
  "The few lines you gave us at setup about yourself and what you wanted.",
];

const NEVER = [
  "Video. Not a frame, not a still, not ever, the camera is read inside your browser and thrown away.",
  "Audio. Speech-to-text is done by your browser; we never receive or keep a recording.",
  "Anything used to train a model, yours or anyone else's.",
];

export default function DataView({
  profile,
  sessions,
  onWiped,
  onOpenHistory,
}: {
  profile: Profile;
  sessions: Session[];
  onWiped: () => void;
  onOpenHistory: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [exported, setExported] = useState(false);

  function download() {
    const blob = new Blob([exportEverything()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `preproom-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExported(true);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Your data</h1>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">
        Everything PrepRoom knows about you is stored in this browser, on this device. Clearing your
        browser data removes it, and so does the button at the bottom of this page.
      </p>

      <section className="mt-6 rounded-2xl border bg-card hairline p-5">
        <h2 className="text-sm font-semibold text-ink">What&apos;s kept</h2>
        <ul className="mt-3 space-y-2">
          {KEPT.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
              <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <h2 className="mt-5 text-sm font-semibold text-ink">What never is</h2>
        <ul className="mt-3 space-y-2">
          {NEVER.map((item) => (
            <li key={item} className="flex gap-2.5 text-sm leading-relaxed text-ink-2">
              <span aria-hidden className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-blue" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <p className="mt-5 text-xs leading-relaxed text-ink-2">
          One thing to be straight about: to answer you at all, the coach sends your conversation to
          Anthropic&apos;s API, which generates the reply and does not keep it for training. That
          part of the conversation leaves your device. Nothing else does.{" "}
          <a
            href="/privacy"
            className="text-blue-strong underline underline-offset-2"
            target="_blank"
            rel="noreferrer"
          >
            Full privacy policy
          </a>
          .
        </p>
      </section>

      <section className="mt-4 rounded-2xl border bg-card hairline p-5">
        <h2 className="text-sm font-semibold text-ink">Take a copy</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">
          Download everything as a JSON file, {sessions.length}{" "}
          {sessions.length === 1 ? "conversation" : "conversations"} and your setup answers.
        </p>
        <button
          type="button"
          onClick={download}
          className="mt-3 rounded-xl border bg-card px-4 py-2.5 text-sm font-medium text-ink hairline transition-colors hover:bg-fill-2"
        >
          {exported ? "Download again" : "Download my data"}
        </button>
      </section>

      <section className="mt-4 rounded-2xl border bg-card hairline p-5">
        <h2 className="text-sm font-semibold text-ink">Delete</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-2">
          To remove one conversation, use the delete button beside it in{" "}
          <button
            type="button"
            onClick={onOpenHistory}
            className="text-blue-strong underline underline-offset-2"
          >
            History
          </button>
          . To remove all of it, including your setup answers, use the button below. Deleted means
          gone. We have no copy to restore from.
        </p>

        {confirming ? (
          <div className="mt-4 rounded-xl border border-red/40 bg-red/8 p-4">
            <p className="text-sm text-ink">
              Delete all {sessions.length}{" "}
              {sessions.length === 1 ? "conversation" : "conversations"}, your progress and your
              setup answers? You&apos;ll start again from the welcome screen.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  deleteEverything();
                  onWiped();
                }}
                className="rounded-xl bg-red px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
              >
                Yes, delete everything
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-xl px-3 py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-3 rounded-xl border border-red/50 px-4 py-2.5 text-sm font-medium text-red transition-colors hover:bg-red/8"
          >
            Delete everything
          </button>
        )}
      </section>

      <p className="mt-4 text-xs leading-relaxed text-ink-3">
        You agreed to how this works on {shortDate(profile.consentedAt)}.
      </p>
    </div>
  );
}
