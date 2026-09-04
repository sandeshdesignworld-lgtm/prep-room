"use client";

/**
 * The gentle ambient cue, the ONLY feedback allowed during a live roleplay.
 * A soft dot that shifts colour. Never a sentence, never a voice, never
 * anything that pulls focus mid-answer, because that is what makes people choke.
 *
 * Phase 3 builds it; Phase 4 feeds it. `level` is null until delivery signals
 * exist, and null renders nothing at all, because an inert dot would be a fake signal.
 *
 * level: 0 = settled, 1 = worth easing off. Anything in between shifts quietly.
 */
const CORNER = {
  "top-right": "right-4 top-4",
  "bottom-right": "bottom-4 right-4",
  "bottom-left": "bottom-4 left-4",
} as const;

export default function AmbientNudge({
  level,
  corner = "top-right",
}: {
  level: number | null;
  /** Which corner of the positioned parent it sits in. */
  corner?: keyof typeof CORNER;
}) {
  if (level === null) return null;

  const clamped = Math.min(1, Math.max(0, level));
  // Blue when settled, drifting toward amber, matching the pills. Never red.
  const color = clamped < 0.5 ? "var(--blue)" : "var(--amber)";

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute ${CORNER[corner]} transition-all duration-[1200ms] ease-in-out`}
      style={{ opacity: 0.25 + clamped * 0.45 }}
    >
      <span
        className="block h-2.5 w-2.5 rounded-full transition-colors duration-[1200ms]"
        style={{ backgroundColor: color, boxShadow: `0 0 12px 3px ${color}` }}
      />
    </div>
  );
}
