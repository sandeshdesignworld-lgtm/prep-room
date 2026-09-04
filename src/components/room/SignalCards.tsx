"use client";

import type { LiveRead, SignalStatus } from "@/lib/signals-math";

/**
 * The live read, spelled out under the video. Same three signals as the pills,
 * with room for a word about what each one is, for anyone who wants to look
 * rather than glance.
 *
 * Still not coaching. Each card names a physical thing the camera can see and
 * says whether it's holding. What any of it means is the debrief's job, and
 * these deliberately go quiet outside a roleplay: reading someone's body
 * language while they're typing a question to a coach measures nothing.
 *
 * There is no "pace" card, and there won't be one until something actually
 * measures pace. A card that can't be earned is a fake signal.
 */

const CARDS = [
  {
    key: "eyeContact" as const,
    label: "Eye contact",
    good: "Facing them",
    attention: "Looking away",
  },
  {
    key: "posture" as const,
    label: "Posture",
    good: "Open and square",
    attention: "Turned or folded in",
  },
  {
    key: "steady" as const,
    label: "Steadiness",
    good: "Settled",
    attention: "Lots of movement",
  },
];

function Tick() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5" fill="none" strokeWidth={2.2}>
      <path d="M3.5 8.5l3 3 6-7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Bang() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5" fill="none" strokeWidth={2.2}>
      <path d="M8 4v4.5" stroke="currentColor" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Card({
  label,
  note,
  status,
}: {
  label: string;
  note: string;
  /** Null means resting: the camera isn't being read right now. */
  status: SignalStatus | null;
}) {
  const good = status === "good";
  return (
    <div className="min-w-0 flex-1 rounded-xl border bg-card hairline px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={[
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
            status === null
              ? "bg-fill text-ink-3"
              : good
                ? "bg-blue/12 text-blue"
                : "bg-amber/15 text-amber",
          ].join(" ")}
        >
          {status === null ? null : good ? <Tick /> : <Bang />}
        </span>
        <span className="min-w-0 truncate text-sm font-medium text-ink">{label}</span>
      </div>
      <p className="mt-1 truncate text-xs text-ink-2">{note}</p>
    </div>
  );
}

export default function SignalCards({
  read,
  /** Why the read is quiet, when it is. */
  restingNote,
}: {
  read: LiveRead | null;
  restingNote: string;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5">
      {CARDS.map((c) => {
        const status = read?.[c.key] ?? null;
        return (
          <Card
            key={c.key}
            label={c.label}
            status={status}
            note={status === null ? restingNote : status === "good" ? c.good : c.attention}
          />
        );
      })}
    </div>
  );
}
