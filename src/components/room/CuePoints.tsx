"use client";

import type { CuePoint } from "@/lib/types";

/**
 * The running list beside the room.
 *
 * The coach speaks, so the advice arrives once and is gone. In a chat window
 * you scroll back; in a call you remember, and under pressure you remember
 * almost none of it. This is what stays: the two or three moves from each
 * exchange, stacking up as the conversation goes, still there an hour later.
 *
 * It is not live coaching. Nothing lands here mid-answer: a cue appears once an
 * exchange is over, which is the same rule the debrief follows and the same
 * reason. The only thing that reacts while someone is still talking is the
 * pills on their own camera.
 */

function SpeakerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5" fill="none" strokeWidth={1.8}>
      <path d="M4 9v6h3.5L12 19V5L7.5 9H4Z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

const SOURCE_LABEL: Record<CuePoint["source"], string> = {
  advice: "From the conversation",
  debrief: "From your practice run",
};

export default function CuePoints({
  cues,
  /** True while the coach is still working out what to say. */
  pending,
}: {
  cues: CuePoint[];
  pending: boolean;
}) {
  if (cues.length === 0) {
    return (
      <div className="rounded-xl border bg-fill-2 hairline px-3.5 py-3">
        <p className="text-sm leading-relaxed text-ink-2">
          {pending
            ? "Listening. What to take away lands here once your coach has answered."
            : "Your coach talks rather than types. The things worth remembering will collect here as you go, and stay for the whole session."}
        </p>
      </div>
    );
  }

  // Newest first: the thing just said is the thing being acted on.
  const groups: { source: CuePoint["source"]; items: CuePoint[] }[] = [];
  for (const cue of [...cues].reverse()) {
    const last = groups[groups.length - 1];
    if (last?.source === cue.source) last.items.push(cue);
    else groups.push({ source: cue.source, items: [cue] });
  }

  return (
    <div className="space-y-4">
      {groups.map((group, i) => (
        <div key={`${group.source}-${i}`}>
          <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
            {group.source === "debrief" && (
              <span className="text-blue">
                <SpeakerIcon />
              </span>
            )}
            {SOURCE_LABEL[group.source]}
          </h3>
          <ul className="mt-2 space-y-2">
            {group.items.map((cue) => (
              <li
                key={cue.id}
                className="fade-up rounded-xl border bg-card hairline px-3.5 py-2.5 text-sm leading-relaxed text-ink"
              >
                {cue.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
