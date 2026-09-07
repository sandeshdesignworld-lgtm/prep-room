"use client";

import { useState } from "react";
import SessionTranscript from "./SessionTranscript";
import { MODES } from "@/lib/modes";
import { relativeDay } from "@/lib/progress";
import type { Session } from "@/lib/types";

const ACCENT_DOT: Record<string, string> = {
  coral: "bg-coral",
  blue: "bg-blue",
  amber: "bg-amber",
};

export default function HistoryView({
  sessions,
  onOpen,
  onDelete,
  onStartNew,
}: {
  sessions: Session[];
  onOpen: (session: Session) => void;
  onDelete: (id: string) => void;
  onStartNew: () => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  // The room doesn't show the conversation any more, so this is where it is read.
  const [reading, setReading] = useState<string | null>(null);

  if (sessions.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <h1 className="text-xl font-semibold text-ink">Nothing here yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Conversations you have with the coach show up here, along with any practice runs and how
          they went.
        </p>
        <button
          type="button"
          onClick={onStartNew}
          className="mt-5 rounded-xl bg-coral px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-coral-hover"
        >
          Start a conversation
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">History</h1>
        <span className="text-xs text-ink-3">
          {sessions.length} {sessions.length === 1 ? "conversation" : "conversations"} · on this
          device
        </span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">
        Your coach speaks rather than types, so this is where the words are. Read any conversation
        in full, including the practice run and the debrief.
      </p>

      <ul className="mt-4 space-y-2">
        {sessions.map((session) => {
          const mode = MODES[session.mode];
          const isConfirming = confirming === session.id;
          const isReading = reading === session.id;
          return (
            <li key={session.id} className="rounded-2xl border bg-card hairline">
              <div className="flex items-start gap-3 p-4">
                <button
                  type="button"
                  onClick={() => onOpen(session)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex items-center gap-2 text-xs text-ink-3">
                    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${ACCENT_DOT[mode.accent]}`} />
                    {mode.label}
                    <span aria-hidden>·</span>
                    {relativeDay(session.updatedAt)}
                  </span>
                  <span className="mt-1 block truncate text-sm font-medium text-ink">
                    {session.title}
                  </span>
                  {(session.cues?.length ?? 0) > 0 && (
                    <span className="mt-1 block text-xs text-ink-2">
                      {session.cues?.length} cue{session.cues?.length === 1 ? "" : "s"} kept
                    </span>
                  )}
                  {session.debrief && (
                    <span className="mt-1 block text-xs text-ink-2">
                      Practised · {session.debrief.verdict}
                    </span>
                  )}
                </button>

                {session.debrief && (
                  <span className="shrink-0 rounded-lg bg-amber px-2 py-1 text-xs font-semibold text-on-amber">
                    {session.debrief.score}/10
                  </span>
                )}

                {!isConfirming && (
                  <>
                    <button
                      type="button"
                      onClick={() => setReading(isReading ? null : session.id)}
                      aria-expanded={isReading}
                      aria-label={`${isReading ? "Hide" : "Read"} ${session.title}`}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
                    >
                      {isReading ? "Hide" : "Read"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(session.id)}
                      aria-label={`Delete ${session.title}`}
                      className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-ink-3 transition-colors hover:bg-fill-2 hover:text-red"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>

              {isReading && <SessionTranscript session={session} />}

              {isConfirming && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line/60 px-4 py-3">
                  <span className="mr-auto text-xs text-ink-2">
                    Delete this conversation and its practice notes? This can&apos;t be undone.
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:bg-fill-2 hover:text-ink"
                  >
                    Keep it
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDelete(session.id);
                      setConfirming(null);
                    }}
                    className="rounded-lg bg-red px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90"
                  >
                    Delete
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
