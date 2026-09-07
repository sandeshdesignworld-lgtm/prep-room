"use client";

import { MODES, MODE_ORDER } from "@/lib/modes";
import type { ModeId } from "@/lib/types";

/**
 * Where every session starts.
 *
 * The room is a video call, and opening a video call is not a neutral act: the
 * camera comes on, a face appears, and there is suddenly someone to perform
 * for. Landing in that cold is the wrong first second for an app people bring
 * things they are dreading to. So the app opens here instead, and NOTHING
 * starts until a card is tapped: no camera, no microphone, no avatar. The
 * permission prompt is the consequence of a decision the user just made, which
 * is the only time a permission prompt reads as reasonable.
 *
 * Distinct from the first-run trust screen, which is a one-time consent and
 * stays as it is. This is the every-session doorway: three things you can do,
 * one line each, pick one.
 */

const ACCENT_TINT: Record<string, string> = {
  coral: "bg-coral/10 text-coral",
  blue: "bg-blue/12 text-blue-strong",
  amber: "bg-amber/18 text-on-amber",
};

const ACCENT_HOVER: Record<string, string> = {
  coral: "hover:border-coral/50",
  blue: "hover:border-blue/50",
  amber: "hover:border-amber/60",
};

function ModeIcon({ id }: { id: ModeId }) {
  if (id === "interview") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.7}>
        <rect x="3" y="7" width="18" height="13" rx="3" stroke="currentColor" />
        <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" stroke="currentColor" strokeLinecap="round" />
      </svg>
    );
  }
  if (id === "social") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.7}>
        <circle cx="9" cy="8.5" r="3.2" stroke="currentColor" />
        <path d="M3 19c1-2.9 3.3-4.5 6-4.5s5 1.6 6 4.5" stroke="currentColor" strokeLinecap="round" />
        <path d="M16.5 6.2a3.2 3.2 0 0 1 0 6M18 14.9c2 .7 3.4 2.1 4 4.1" stroke="currentColor" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5" fill="none" strokeWidth={1.7}>
      <path
        d="M20 13.5c0 3-2.9 5.5-6.5 5.5a8 8 0 0 1-2.2-.3L7 20.5l.8-3A5.4 5.4 0 0 1 5 12.5C5 9.5 7.9 7 11.5 7S20 9.5 20 13.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Home({
  onPick,
  /** The user's own words from setup, so the greeting isn't generic. */
  goal,
}: {
  onPick: (mode: ModeId) => void;
  goal?: string;
}) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center px-5 py-10 sm:py-14">
      <div className="fade-up">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-blue-strong">PrepRoom</p>

        <h1 className="mt-3 font-serif text-[2rem] leading-[1.15] font-semibold text-ink sm:text-[2.5rem]">
          What are we working on today?
        </h1>

        <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-ink-2">
          Tell your coach the real situation. They&apos;ll ask a couple of questions, give you
          the actual words to use, and then run it with you out loud.
        </p>

        <div className="mt-8 space-y-3">
          {MODE_ORDER.map((id) => {
            const mode = MODES[id];
            return (
              <button
                key={id}
                type="button"
                onClick={() => onPick(id)}
                className={[
                  "group block w-full rounded-2xl border bg-card p-4 text-left transition-colors sm:p-5",
                  "hairline",
                  ACCENT_HOVER[mode.accent],
                ].join(" ")}
              >
                <span className="flex items-start gap-3.5">
                  <span
                    aria-hidden
                    className={[
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                      ACCENT_TINT[mode.accent],
                    ].join(" ")}
                  >
                    <ModeIcon id={id} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-ink">{mode.label}</span>
                      <span className="truncate text-xs text-ink-3">{mode.tagline}</span>
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-ink-2">
                      {mode.blurb}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="mt-2.5 shrink-0 text-ink-3 transition-transform group-hover:translate-x-0.5"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" strokeWidth={2}>
                      <path d="M9 5l7 7-7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {goal?.trim() && (
          <p className="mt-6 text-sm leading-relaxed text-ink-2">
            You said you wanted to{" "}
            <span className="text-ink">{lowerFirst(goal.trim())}</span>. Pick whichever of these
            gets you closest.
          </p>
        )}

        <p className="mt-8 text-xs leading-relaxed text-ink-3">
          Your camera only switches on once you pick one, and it&apos;s read entirely on this
          device. No video is ever recorded or uploaded. PrepRoom is a practice aid for
          communication, not therapy or a diagnosis.
        </p>
      </div>
    </div>
  );
}

/** "Stop freezing in interviews." reads better mid-sentence than "Stop ...". */
function lowerFirst(text: string): string {
  const trimmed = text.replace(/[.!]+$/, "");
  // Leave acronyms and proper nouns alone; only a plain capital gets lowered.
  if (/^[A-Z][a-z]/.test(trimmed)) return trimmed[0].toLowerCase() + trimmed.slice(1);
  return trimmed;
}
