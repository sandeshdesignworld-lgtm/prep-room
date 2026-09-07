"use client";

import { useMemo, useRef, useState } from "react";
import type { SignalSample } from "@/lib/types";

/**
 * Small multiples: one row per signal, sharing an x-axis and turn markers.
 * Deliberately not one chart with three lines, because these have unrelated meanings
 * and overlaying them would invite comparisons that aren't there.
 *
 * Every row is the same blue. The row label carries identity, so colour
 * doesn't have to, which also keeps it readable for colour-blind viewers.
 */
const ROWS = [
  { key: "facing", label: "Facing you", hint: "Head pointed at the camera" },
  { key: "stillness", label: "Stillness", hint: "How little the head moved" },
  { key: "openness", label: "Open posture", hint: "Shoulders squared, against your own baseline" },
] as const;

const W = 600;
const H = 40;

function valueOf(s: SignalSample, key: (typeof ROWS)[number]["key"]): number {
  if (key === "facing") return s.facing;
  if (key === "stillness") return 1 - s.fidget;
  return s.openness;
}

export default function SignalTimeline({ samples }: { samples: SignalSample[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const { points, turnMarks, duration } = useMemo(() => {
    if (samples.length === 0) return { points: [], turnMarks: [], duration: 0 };
    const span = Math.max(1, samples[samples.length - 1].t);
    const marks: { x: number; turn: number }[] = [];
    let seen = -1;
    for (const s of samples) {
      if (s.turn > seen) {
        seen = s.turn;
        if (s.turn > 0) marks.push({ x: (s.t / span) * W, turn: s.turn });
      }
    }
    return { points: samples, turnMarks: marks, duration: span };
  }, [samples]);

  if (points.length < 2) return null;

  const xFor = (s: SignalSample) => (s.t / duration) * W;

  function move(event: React.MouseEvent<HTMLDivElement>) {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const target = fraction * duration;
    let nearest = 0;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i].t - target) < Math.abs(points[nearest].t - target)) nearest = i;
    }
    setHover(nearest);
  }

  const active = hover === null ? null : points[hover];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-2">
          Delivery over the session
        </h4>
        <span className="text-xs text-ink-3">
          {active ? formatTime(active.t) : `${formatTime(duration)} total`}
        </span>
      </div>

      <div
        ref={wrapRef}
        className="mt-3 space-y-2.5"
        onMouseMove={move}
        onMouseLeave={() => setHover(null)}
      >
        {ROWS.map((row) => {
          const path = points
            .map((s, i) => `${i === 0 ? "M" : "L"} ${xFor(s).toFixed(1)} ${(H - valueOf(s, row.key) * H).toFixed(1)}`)
            .join(" ");
          const area = `${path} L ${W} ${H} L 0 ${H} Z`;
          return (
            <div key={row.key} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-right text-xs leading-tight text-ink-2" title={row.hint}>
                {row.label}
              </span>
              <svg
                viewBox={`0 0 ${W} ${H}`}
                width="100%"
                height={H}
                preserveAspectRatio="none"
                role="img"
                aria-label={`${row.label} over the session`}
                // flex-1 min-w-0, not just width="100%": as a flex item the SVG's
                // percentage width resolves against the whole row and ignores the
                // label and the figure beside it, so the chart ran off the panel.
                className="min-w-0 flex-1 overflow-visible"
              >
                <rect x={0} y={0} width={W} height={H} rx={3} fill="var(--fill)" />
                <path d={area} fill="var(--blue)" opacity={0.16} />
                <path
                  d={path}
                  fill="none"
                  stroke="var(--blue)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                {turnMarks.map((m) => (
                  <line
                    key={m.turn}
                    x1={m.x}
                    x2={m.x}
                    y1={0}
                    y2={H}
                    stroke="var(--line)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {active && (
                  <>
                    <line
                      x1={xFor(active)}
                      x2={xFor(active)}
                      y1={0}
                      y2={H}
                      stroke="var(--ink-3)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                    <circle
                      cx={xFor(active)}
                      cy={H - valueOf(active, row.key) * H}
                      r={3.5}
                      fill="var(--blue)"
                      stroke="var(--card)"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  </>
                )}
              </svg>
              <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-2">
                {Math.round(valueOf(active ?? points[points.length - 1], row.key) * 100)}%
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-2.5 text-[11px] leading-relaxed text-ink-3">
        Vertical lines mark each of your turns. These are physical measurements taken in your
        browser, positions and movement, not feelings. No video was recorded or sent anywhere.
      </p>

      <details className="mt-2">
        <summary className="cursor-pointer text-[11px] text-ink-3">See the numbers</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[11px] text-ink-2">
            <thead>
              <tr className="text-ink-3">
                <th className="py-1 pr-3 font-medium">Time</th>
                <th className="py-1 pr-3 font-medium">Turn</th>
                {ROWS.map((r) => (
                  <th key={r.key} className="py-1 pr-3 font-medium">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {points
                .filter((_, i) => i % Math.ceil(points.length / 12) === 0)
                .map((s) => (
                  <tr key={s.t} className="border-t border-line/60">
                    <td className="py-1 pr-3 tabular-nums">{formatTime(s.t)}</td>
                    <td className="py-1 pr-3 tabular-nums">{s.turn < 0 ? "-" : s.turn + 1}</td>
                    {ROWS.map((r) => (
                      <td key={r.key} className="py-1 pr-3 tabular-nums">
                        {Math.round(valueOf(s, r.key) * 100)}%
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function formatTime(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
