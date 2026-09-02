/**
 * The maths behind delivery signals. Pure: no React, no browser, no MediaPipe
 * imports, so every number here can be tested directly.
 *
 * Everything reported is PHYSICAL: where the head is pointing, how much the
 * shoulders are squared, how much someone is moving. Nothing here names or
 * infers an emotion, and nothing downstream may either.
 */

/** One moment, sampled roughly ten times a second. */
export interface Sample {
  /** Milliseconds since the roleplay started. */
  t: number;
  /** Index of the roleplay turn this falls inside; -1 before the first turn. */
  turn: number;
  /** 1 when the head is pointed at the camera, 0 when it isn't. */
  facing: number;
  smile: number;
  brow: number;
  gazeDown: number;
  jawOpen: number;
  /** Shoulder width against this person's own baseline, 0-1. */
  openness: number;
  /** Shoulder line angle in degrees; positive is one shoulder dropped. */
  tilt: number;
  /** Head movement over the recent window, 0-1. */
  fidget: number;
}

/* ------------------------------ tunables -------------------------------- */

/** From the brief: facing the camera means |yaw| < 18 deg and |pitch| < 14 deg. */
export const FACING_YAW_DEG = 18;
export const FACING_PITCH_DEG = 14;

/** Mean per-frame nose travel (normalised units) that counts as fully fidgety. */
export const FIDGET_FULL_SCALE = 0.012;

/** Shoulder-width ratios mapped onto 0-1 openness. */
export const OPENNESS_MIN_RATIO = 0.75;
export const OPENNESS_RANGE = 0.35;

/* --------------------------- head orientation ---------------------------- */

/**
 * MediaPipe flattens the 4x4 facial transformation matrix without telling us the
 * order, and it differs between builds. Rather than guess, detect it: the
 * translation column holds large values (centimetres) while every rotation entry
 * is within [-1, 1]. Whichever slot carries the big numbers is the translation.
 */
export function matrixLayout(data: number[]): "row" | "column" {
  const rowMajorTranslation = Math.abs(data[3]) + Math.abs(data[7]) + Math.abs(data[11]);
  const colMajorTranslation = Math.abs(data[12]) + Math.abs(data[13]) + Math.abs(data[14]);
  return colMajorTranslation > rowMajorTranslation ? "column" : "row";
}

/** Top-left 3x3 of the transform, always returned row-major as r[row][col]. */
export function rotationMatrix(data: number[]): number[][] {
  const column = matrixLayout(data) === "column";
  const at = (row: number, col: number) => (column ? data[row + 4 * col] : data[4 * row + col]);
  return [
    [at(0, 0), at(0, 1), at(0, 2)],
    [at(1, 0), at(1, 1), at(1, 2)],
    [at(2, 0), at(2, 1), at(2, 2)],
  ];
}

export interface HeadAngles {
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * Tait-Bryan angles in degrees for R = Rz(roll) * Ry(yaw) * Rx(pitch),
 * which gives the intuitive reading: yaw is turning away, pitch is looking
 * up or down, roll is tilting the head sideways.
 */
export function headAngles(r: number[][]): HeadAngles {
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  const yaw = -Math.asin(clamp(r[2][0]));
  const pitch = Math.atan2(r[2][1], r[2][2]);
  const roll = Math.atan2(r[1][0], r[0][0]);
  const deg = (rad: number) => (rad * 180) / Math.PI;
  return { yaw: deg(yaw), pitch: deg(pitch), roll: deg(roll) };
}

export function isFacing({ yaw, pitch }: HeadAngles): boolean {
  return Math.abs(yaw) < FACING_YAW_DEG && Math.abs(pitch) < FACING_PITCH_DEG;
}

/* ------------------------------ blendshapes ------------------------------ */

export interface FaceSignals {
  smile: number;
  brow: number;
  gazeDown: number;
  jawOpen: number;
}

/** Averages the paired blendshapes named in the brief. Missing keys read as 0. */
export function faceSignals(scores: Record<string, number>): FaceSignals {
  const get = (k: string) => scores[k] ?? 0;
  const avg = (a: string, b: string) => (get(a) + get(b)) / 2;
  return {
    smile: avg("mouthSmileLeft", "mouthSmileRight"),
    brow: avg("browDownLeft", "browDownRight"),
    gazeDown: avg("eyeLookDownLeft", "eyeLookDownRight"),
    jawOpen: get("jawOpen"),
  };
}

/* -------------------------------- posture -------------------------------- */

export interface Point {
  x: number;
  y: number;
}

/** Landmarks 11 and 12 are the left and right shoulders. */
export function shoulderWidth(left: Point, right: Point): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

/** Degrees off horizontal. 0 means the shoulders are level. */
export function shoulderTilt(left: Point, right: Point): number {
  return (Math.atan2(right.y - left.y, right.x - left.x) * 180) / Math.PI;
}

/**
 * Shoulder width means nothing in absolute terms, it depends how far someone
 * sits from their laptop, so it's scored against their own opening seconds.
 */
export function openness(width: number, baseline: number): number {
  if (!baseline) return 0;
  const ratio = width / baseline;
  return clamp01((ratio - OPENNESS_MIN_RATIO) / OPENNESS_RANGE);
}

/** Mean frame-to-frame nose travel across the window, scaled to 0-1. */
export function fidget(noseWindow: Point[]): number {
  if (noseWindow.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < noseWindow.length; i++) {
    total += Math.hypot(
      noseWindow[i].x - noseWindow[i - 1].x,
      noseWindow[i].y - noseWindow[i - 1].y
    );
  }
  return clamp01(total / (noseWindow.length - 1) / FIDGET_FULL_SCALE);
}

/* ------------------------------ the nudge -------------------------------- */

/**
 * The single number behind the ambient dot. 0 is settled, 1 is worth easing off.
 * Weighted toward facing the camera because that's the signal people most often
 * lose without noticing. Smoothing happens at the call site, this is memoryless.
 */
export function nudgeLevel(s: Pick<Sample, "facing" | "fidget" | "openness">): number {
  return clamp01(0.5 * (1 - s.facing) + 0.3 * s.fidget + 0.2 * (1 - s.openness));
}

/* ------------------------------- rollups --------------------------------- */

export function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Thins the 10Hz capture buffer down for storage and charting. */
export function downsample(samples: Sample[], bucketMs = 1000): Sample[] {
  if (samples.length === 0) return [];
  const buckets = new Map<number, Sample[]>();
  for (const s of samples) {
    const key = Math.floor(s.t / bucketMs);
    const list = buckets.get(key);
    if (list) list.push(s);
    else buckets.set(key, [s]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, group]) => ({
      t: key * bucketMs,
      // A bucket can straddle a turn change; the turn it ends in is the useful one.
      turn: group[group.length - 1].turn,
      facing: mean(group.map((g) => g.facing)),
      smile: mean(group.map((g) => g.smile)),
      brow: mean(group.map((g) => g.brow)),
      gazeDown: mean(group.map((g) => g.gazeDown)),
      jawOpen: mean(group.map((g) => g.jawOpen)),
      openness: mean(group.map((g) => g.openness)),
      tilt: mean(group.map((g) => g.tilt)),
      fidget: mean(group.map((g) => g.fidget)),
    }));
}

export interface TurnRollup {
  turn: number;
  seconds: number;
  facing: number;
  fidget: number;
  openness: number;
  smile: number;
  brow: number;
  gazeDown: number;
}

export function rollupByTurn(samples: Sample[]): TurnRollup[] {
  const byTurn = new Map<number, Sample[]>();
  for (const s of samples) {
    if (s.turn < 0) continue;
    const list = byTurn.get(s.turn);
    if (list) list.push(s);
    else byTurn.set(s.turn, [s]);
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, group]) => ({
      turn,
      seconds: Math.round((group[group.length - 1].t - group[0].t) / 1000),
      facing: mean(group.map((g) => g.facing)),
      fidget: mean(group.map((g) => g.fidget)),
      openness: mean(group.map((g) => g.openness)),
      smile: mean(group.map((g) => g.smile)),
      brow: mean(group.map((g) => g.brow)),
      gazeDown: mean(group.map((g) => g.gazeDown)),
    }));
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * The text handed to the debrief. Deliberately plain numbers with no
 * interpretation, reading them is the coach's job, and anything that sounds
 * like a verdict here would end up quoted back at the user as one.
 */
export function summariseSignals(samples: Sample[], turnLabels: string[]): string {
  if (samples.length === 0) return "";
  const turns = rollupByTurn(samples);
  if (turns.length === 0) return "";

  const overall = {
    facing: mean(samples.map((s) => s.facing)),
    fidget: mean(samples.map((s) => s.fidget)),
    openness: mean(samples.map((s) => s.openness)),
    smile: mean(samples.map((s) => s.smile)),
    brow: mean(samples.map((s) => s.brow)),
    gazeDown: mean(samples.map((s) => s.gazeDown)),
  };

  const lines = [
    "Delivery signals, measured in the browser from the camera. Physical only, these are positions and movement, not emotions, and they carry no interpretation.",
    "",
    `Whole session: facing the camera ${pct(overall.facing)} of the time, head movement ${pct(overall.fidget)}, open posture ${pct(overall.openness)}, smiling ${pct(overall.smile)}, brow drawn down ${pct(overall.brow)}, eyes cast down ${pct(overall.gazeDown)}.`,
    "",
    "Per turn (the user's turns, in order):",
  ];

  for (const t of turns) {
    const label = turnLabels[t.turn];
    const quoted = label ? `, they said: "${truncate(label, 90)}"` : "";
    lines.push(
      `Turn ${t.turn + 1} (${t.seconds}s): facing ${pct(t.facing)}, movement ${pct(t.fidget)}, open posture ${pct(t.openness)}, smiling ${pct(t.smile)}, brow down ${pct(t.brow)}, eyes down ${pct(t.gazeDown)}${quoted}`
    );
  }

  const shift = largestShift(turns);
  if (shift) lines.push("", shift);

  return lines.join("\n");
}

/** Names the biggest turn-to-turn change so the coach can tie it to a moment. */
function largestShift(turns: TurnRollup[]): string | null {
  if (turns.length < 2) return null;
  const metrics = [
    { key: "facing" as const, label: "facing the camera" },
    { key: "fidget" as const, label: "head movement" },
    { key: "openness" as const, label: "open posture" },
  ];

  let best: { label: string; from: number; to: number; turn: number; delta: number } | null = null;
  for (const m of metrics) {
    for (let i = 1; i < turns.length; i++) {
      const delta = Math.abs(turns[i][m.key] - turns[i - 1][m.key]);
      if (!best || delta > best.delta) {
        best = {
          label: m.label,
          from: turns[i - 1][m.key],
          to: turns[i][m.key],
          turn: turns[i].turn,
          delta,
        };
      }
    }
  }
  if (!best || best.delta < 0.15) return null;
  const direction = best.to < best.from ? "fell" : "rose";
  return `Biggest change: ${best.label} ${direction} from ${pct(best.from)} to ${pct(best.to)} going into turn ${best.turn + 1}.`;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}
