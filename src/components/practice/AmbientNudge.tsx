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
export default function AmbientNudge({ level }: { level: number | null }) {
  if (level === null) return null;

  const clamped = Math.min(1, Math.max(0, level));
  // Sage when settled, drifting toward poppy. Never red, never alarming.
  const color = clamped < 0.5 ? "var(--sage)" : "var(--poppy)";

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-4 top-4 transition-all duration-[1200ms] ease-in-out"
      style={{ opacity: 0.25 + clamped * 0.45 }}
    >
      <span
        className="block h-2.5 w-2.5 rounded-full transition-colors duration-[1200ms]"
        style={{ backgroundColor: color, boxShadow: `0 0 12px 3px ${color}` }}
      />
    </div>
  );
}
