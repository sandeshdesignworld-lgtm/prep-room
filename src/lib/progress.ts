import type { ModeId, Session } from "./types";

/**
 * Turns a pile of saved sessions into the few numbers worth showing. Pure, so
 * the arithmetic can be tested without a browser.
 *
 * Deliberately conservative: with two data points there is no trend, and drawing
 * one anyway would be telling the user something we don't know.
 */

/** A practice run that produced a score. */
export interface ScorePoint {
  sessionId: string;
  mode: ModeId;
  at: string;
  score: number;
  verdict: string;
}

export interface Progress {
  totalSessions: number;
  practiceRuns: number;
  scores: ScorePoint[];
  averageScore: number | null;
  bestScore: number | null;
  /** Average of the most recent three minus the previous three; null if too few. */
  trend: number | null;
  byMode: { mode: ModeId; sessions: number }[];
  /** Only present when at least one run captured delivery signals. */
  delivery: { facing: number; stillness: number; openness: number; runs: number } | null;
  activeDays: number;
  currentStreakDays: number;
}

const MIN_FOR_TREND = 4;

export function computeProgress(sessions: Session[]): Progress {
  const ordered = [...sessions].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));

  const scores: ScorePoint[] = ordered
    .filter((s) => s.debrief)
    .map((s) => ({
      sessionId: s.id,
      mode: s.mode,
      at: s.roleplay?.endedAt ?? s.updatedAt,
      score: s.debrief!.score,
      verdict: s.debrief!.verdict,
    }));

  const values = scores.map((s) => s.score);

  const byModeCounts = new Map<ModeId, number>();
  for (const s of ordered) byModeCounts.set(s.mode, (byModeCounts.get(s.mode) ?? 0) + 1);

  const withSignals = ordered.filter((s) => (s.roleplay?.signals?.length ?? 0) > 0);
  const delivery = withSignals.length
    ? {
        facing: mean(withSignals.map((s) => mean(s.roleplay!.signals!.map((x) => x.facing)))),
        stillness: mean(withSignals.map((s) => 1 - mean(s.roleplay!.signals!.map((x) => x.fidget)))),
        openness: mean(withSignals.map((s) => mean(s.roleplay!.signals!.map((x) => x.openness)))),
        runs: withSignals.length,
      }
    : null;

  const days = new Set(ordered.map((s) => s.updatedAt.slice(0, 10)));

  return {
    totalSessions: ordered.length,
    practiceRuns: scores.length,
    scores,
    averageScore: values.length ? round1(mean(values)) : null,
    bestScore: values.length ? Math.max(...values) : null,
    trend: computeTrend(values),
    byMode: [...byModeCounts.entries()]
      .map(([mode, count]) => ({ mode, sessions: count }))
      .sort((a, b) => b.sessions - a.sessions),
    delivery,
    activeDays: days.size,
    currentStreakDays: streak([...days].sort()),
  };
}

/** Recent half against the earlier half. Null until there's enough to compare. */
function computeTrend(values: number[]): number | null {
  if (values.length < MIN_FOR_TREND) return null;
  const half = Math.floor(values.length / 2);
  const earlier = values.slice(0, half);
  const recent = values.slice(values.length - half);
  return round1(mean(recent) - mean(earlier));
}

/** Consecutive days ending today or yesterday; a gap of two days ends it. */
function streak(sortedDays: string[]): number {
  if (sortedDays.length === 0) return 0;
  const dayMs = 86400000;
  const today = startOfDay(new Date());
  const last = startOfDay(new Date(sortedDays[sortedDays.length - 1]));
  const gap = Math.round((today - last) / dayMs);
  if (gap > 1) return 0;

  let count = 1;
  for (let i = sortedDays.length - 1; i > 0; i--) {
    const a = startOfDay(new Date(sortedDays[i]));
    const b = startOfDay(new Date(sortedDays[i - 1]));
    if (Math.round((a - b) / dayMs) === 1) count++;
    else break;
  }
  return count;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** "3 Sep", or "3 Sep 2025" once it isn't this year. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function relativeDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return shortDate(iso);
}
