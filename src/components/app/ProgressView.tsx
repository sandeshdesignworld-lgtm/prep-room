"use client";

import { useMemo, useState } from "react";
import { MODES } from "@/lib/modes";
import { computeProgress, shortDate } from "@/lib/progress";
import type { Session } from "@/lib/types";

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border bg-card hairline p-4">
      <p className="text-xs font-medium uppercase tracking-[0.1em] text-ink-2">{label}</p>
      <p className="mt-1.5 text-2xl leading-none font-semibold text-ink tabular-nums">{value}</p>
      {note && <p className="mt-1.5 text-xs leading-snug text-ink-2">{note}</p>}
    </div>
  );
}

/** A meter rather than a chart: one number against a fixed 0-100 scale. */
function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-right text-xs text-ink-2">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-fill">
        <div
          className="h-full rounded-full bg-dusty"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-2">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

export default function ProgressView({ sessions }: { sessions: Session[] }) {
  const progress = useMemo(() => computeProgress(sessions), [sessions]);
  const [hover, setHover] = useState<number | null>(null);

  if (progress.totalSessions === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <h1 className="text-xl font-semibold text-ink">Nothing to show yet</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          Once you&apos;ve practised a few times, this is where you&apos;ll see how it&apos;s
          going, scores over time, and how your delivery is holding up.
        </p>
      </div>
    );
  }

  const { scores } = progress;
  const W = 600;
  const H = 120;
  const xFor = (i: number) => (scores.length === 1 ? W / 2 : (i / (scores.length - 1)) * W);
  const yFor = (score: number) => H - ((score - 1) / 9) * H;
  const active = hover === null ? null : scores[hover];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <h1 className="text-xl font-semibold text-ink">Progress</h1>
      <p className="mt-1 text-sm text-ink-2">All of this is worked out on your device.</p>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Conversations" value={String(progress.totalSessions)} />
        <Tile label="Practised" value={String(progress.practiceRuns)} note="Roleplays finished" />
        <Tile
          label="Average"
          value={progress.averageScore === null ? "-" : `${progress.averageScore}`}
          note={progress.averageScore === null ? "After your first practice" : "Out of 10"}
        />
        <Tile
          label="Streak"
          value={progress.currentStreakDays === 0 ? "-" : `${progress.currentStreakDays}d`}
          note={`${progress.activeDays} ${progress.activeDays === 1 ? "day" : "days"} in total`}
        />
      </div>

      {/* One series, so no legend; the heading names it. */}
      {scores.length >= 2 && (
        <section className="mt-6 rounded-2xl border bg-card hairline p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink">Score, run by run</h2>
            <span className="text-xs text-ink-3">
              {active
                ? `${MODES[active.mode].label} · ${shortDate(active.at)} · ${active.score}/10`
                : progress.trend === null
                  ? "A trend needs four runs"
                  : progress.trend >= 0
                    ? `Up ${progress.trend} on your earlier runs`
                    : `Down ${Math.abs(progress.trend)} on your earlier runs`}
            </span>
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            height={H}
            preserveAspectRatio="none"
            role="img"
            aria-label="Practice score for each run, oldest first"
            className="mt-4 overflow-visible"
            onMouseLeave={() => setHover(null)}
          >
            {[1, 5.5, 10].map((tick) => (
              <line
                key={tick}
                x1={0}
                x2={W}
                y1={yFor(tick)}
                y2={yFor(tick)}
                stroke="var(--line)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path
              d={scores.map((s, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(s.score)}`).join(" ")}
              fill="none"
              stroke="var(--dusty)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {scores.map((s, i) => (
              <circle
                key={s.sessionId}
                cx={xFor(i)}
                cy={yFor(s.score)}
                r={hover === i ? 6 : 4.5}
                fill="var(--dusty)"
                stroke="var(--card)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                onMouseEnter={() => setHover(i)}
                className="cursor-pointer"
              />
            ))}
          </svg>
          <div className="mt-1 flex justify-between text-[11px] text-ink-3">
            <span>{shortDate(scores[0].at)}</span>
            <span>{shortDate(scores[scores.length - 1].at)}</span>
          </div>
        </section>
      )}

      {scores.length === 1 && (
        <p className="mt-6 rounded-2xl border bg-card hairline p-5 text-sm leading-relaxed text-ink-2">
          One practice run so far, scored {scores[0].score}/10, &ldquo;{scores[0].verdict}&rdquo;.
          Do a couple more and a trend will show up here.
        </p>
      )}

      {progress.delivery && (
        <section className="mt-6 rounded-2xl border bg-card hairline p-5">
          <h2 className="text-sm font-semibold text-ink">Delivery, averaged</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">
            Across {progress.delivery.runs}{" "}
            {progress.delivery.runs === 1 ? "run" : "runs"} where the camera was on. Physical
            measurements, not judgements about how you felt.
          </p>
          <div className="mt-4 space-y-2.5">
            <Meter label="Facing them" value={progress.delivery.facing} />
            <Meter label="Stillness" value={progress.delivery.stillness} />
            <Meter label="Open posture" value={progress.delivery.openness} />
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-ink">What you&apos;ve worked on</h2>
        <div className="mt-3 space-y-2">
          {progress.byMode.map(({ mode, sessions: count }) => (
            <div
              key={mode}
              className="flex items-center justify-between rounded-xl border bg-card hairline px-4 py-2.5"
            >
              <span className="text-sm text-ink">{MODES[mode].label}</span>
              <span className="text-xs tabular-nums text-ink-2">
                {count} {count === 1 ? "conversation" : "conversations"}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
