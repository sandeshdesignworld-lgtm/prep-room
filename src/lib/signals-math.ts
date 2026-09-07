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

/** Mean per-step nose travel (normalised units) that counts as fully fidgety. */
export const FIDGET_FULL_SCALE = 0.012;
/** The sampling step FIDGET_FULL_SCALE is calibrated against. */
export const FIDGET_NOMINAL_MS = 100;

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

/**
 * Mean nose travel across the window, scaled to 0-1.
 *
 * Travel per sample depends on how often we sample, so it is normalised to a
 * nominal 100ms step before being scored. Without that, moving pose detection
 * from 10Hz to 7.5Hz would inflate every reading by a third and quietly
 * invalidate FIDGET_FULL_SCALE and every threshold built on it.
 */
export function fidget(noseWindow: Point[], intervalMs = FIDGET_NOMINAL_MS): number {
  if (noseWindow.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < noseWindow.length; i++) {
    total += Math.hypot(
      noseWindow[i].x - noseWindow[i - 1].x,
      noseWindow[i].y - noseWindow[i - 1].y
    );
  }
  const perSample = total / (noseWindow.length - 1);
  const perNominalStep = perSample * (FIDGET_NOMINAL_MS / Math.max(1, intervalMs));
  return clamp01(perNominalStep / FIDGET_FULL_SCALE);
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

/* ------------------------------ the live read ---------------------------- */

/**
 * The three pills shown over the camera during a roleplay. This is the ONLY
 * thing the user sees about their own delivery while they are still talking,
 * and it is deliberately not coaching: no sentences, no score, no advice, and
 * nothing that names a feeling. Two words and a coloured dot, so a glance costs
 * nothing and ignoring it costs nothing either.
 *
 * "attention" means a signal has drifted, not that the user is doing badly.
 * What it means is the debrief's job.
 */
export type SignalStatus = "good" | "attention";

export interface LiveRead {
  /** Head pointed at the camera often enough over the recent window. */
  eyeContact: SignalStatus;
  /** Shoulders squared against this person's own opening baseline. */
  posture: SignalStatus;
  /** Head movement low enough to read as settled. */
  steady: SignalStatus;
}

/** Share of the recent window spent facing the camera that still reads as engaged. */
export const EYE_CONTACT_GOOD_RATIO = 0.55;
/**
 * Openness is already relative to the person's own baseline, so this is a floor
 * rather than a band: below it they have turned away or folded in. There is no
 * upper bound, because sitting up straighter than you started is not a fault.
 */
export const POSTURE_GOOD_MIN = 0.3;
/** Smoothed movement above this reads as restless rather than settled. */
export const STEADY_MAX = 0.45;
/**
 * How long a condition must hold before a pill is allowed to change, in either
 * direction. This is the whole reason the pills are calm enough to sit next to
 * a conversation: without it they flicker on every glance away and become the
 * mid-roleplay interruption the brief forbids.
 */
export const STATUS_HOLD_MS = 800;

/** The smoothed window a read is taken from. */
export interface SignalWindow {
  /** Fraction of recent samples with the head pointed at the camera, 0-1. */
  eyeContactRatio: number;
  /** Smoothed shoulder openness, 0-1. */
  openness: number;
  /** Smoothed head movement, 0-1. */
  fidget: number;
}

/** The status each signal would have right now, before any debouncing. */
export function readCandidates(w: SignalWindow): LiveRead {
  return {
    eyeContact: w.eyeContactRatio > EYE_CONTACT_GOOD_RATIO ? "good" : "attention",
    posture: w.openness >= POSTURE_GOOD_MIN ? "good" : "attention",
    steady: w.fidget <= STEADY_MAX ? "good" : "attention",
  };
}

/**
 * One pill's debounce state. `pending` is the status being considered; it only
 * becomes `status` once it has held for STATUS_HOLD_MS without wavering.
 */
export interface StatusGate {
  status: SignalStatus;
  pending: SignalStatus | null;
  pendingSince: number;
}

export function newGate(status: SignalStatus = "good"): StatusGate {
  return { status, pending: null, pendingSince: 0 };
}

/**
 * Advances one gate. Returns the previous object unchanged when nothing moved,
 * so callers can compare by identity and skip a re-render.
 */
export function gateStatus(
  prev: StatusGate,
  candidate: SignalStatus,
  now: number,
  holdMs = STATUS_HOLD_MS
): StatusGate {
  if (candidate === prev.status) {
    // Back to where we already were: forget any part-served waiting period.
    return prev.pending === null ? prev : newGate(prev.status);
  }
  if (prev.pending !== candidate) {
    // A new direction; start its clock.
    return { status: prev.status, pending: candidate, pendingSince: now };
  }
  if (now - prev.pendingSince >= holdMs) {
    return newGate(candidate);
  }
  return prev;
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

/* ------------------------- the deep read (analysis) ---------------------- */

/**
 * Everything measured over one stretch of samples.
 * Same six numbers as the rollup, so a turn, a third of a turn and the whole
 * session are all described in the same terms.
 */
export interface Means {
  facing: number;
  fidget: number;
  openness: number;
  smile: number;
  brow: number;
  gazeDown: number;
}

function meansOf(group: Sample[]): Means {
  return {
    facing: mean(group.map((g) => g.facing)),
    fidget: mean(group.map((g) => g.fidget)),
    openness: mean(group.map((g) => g.openness)),
    smile: mean(group.map((g) => g.smile)),
    brow: mean(group.map((g) => g.brow)),
    gazeDown: mean(group.map((g) => g.gazeDown)),
  };
}

/**
 * One turn, plus how it started and how it ended.
 *
 * A per-turn mean hides the thing most worth seeing: someone who opens facing
 * the camera and has drifted off it by the end of the same answer averages out
 * as fine. The thirds make that visible. The middle third is dropped on
 * purpose, it only blurs the two ends together.
 */
export interface TurnArc {
  turn: number;
  seconds: number;
  whole: Means;
  open: Means;
  close: Means;
}

/** Turns shorter than this have no meaningful shape; open and close are the same. */
export const ARC_MIN_SAMPLES = 6;

export function turnArcs(samples: Sample[]): TurnArc[] {
  const byTurn = new Map<number, Sample[]>();
  for (const s of samples) {
    if (s.turn < 0) continue;
    const list = byTurn.get(s.turn);
    if (list) list.push(s);
    else byTurn.set(s.turn, [s]);
  }

  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, group]) => {
      const whole = meansOf(group);
      const third = Math.floor(group.length / 3);
      const short = group.length < ARC_MIN_SAMPLES || third === 0;
      return {
        turn,
        seconds: Math.round((group[group.length - 1].t - group[0].t) / 1000),
        whole,
        open: short ? whole : meansOf(group.slice(0, third)),
        close: short ? whole : meansOf(group.slice(-third)),
      };
    });
}

/** Keeps the track readable, and the prompt bounded, however long the rehearsal ran. */
export const MAX_TRACK_ROWS = 40;
const TRACK_MIN_BUCKET_MS = 3000;

/**
 * The full text handed to the analysis step. Richer than summariseSignals, which
 * still feeds the debrief itself: this one carries the shape inside each turn
 * and a coarse track of the whole session, which is what a claim like "it fell
 * away every time they were pushed" has to be read off.
 *
 * It states, at length, what each number actually is and what it cannot see.
 * That preamble is load-bearing. The numbers are estimates off face and pose
 * landmarks, and a model handed bare percentages will write about them as
 * though they were measurements of a person's state.
 */
export function detailSignals(samples: Sample[], turnLabels: string[]): string {
  if (samples.length === 0) return "";
  const arcs = turnArcs(samples);
  const overall = meansOf(samples);
  const seconds = Math.round((samples[samples.length - 1].t - samples[0].t) / 1000);

  const lines = [
    "Delivery signals, measured in the user's own browser from their camera at about 15Hz. No video was recorded or sent anywhere; these numbers are all that exists.",
    "",
    "What each number IS, and what it cannot see. Every one of these is an estimate off face and pose landmarks, not a measurement of the person:",
    "- facing: the share of frames where the head was pointed within about 18 degrees of the camera horizontally and 14 vertically. This is a PROXY for eye contact. It does not track pupils, so reading from a second screen straight ahead still counts as facing, and a webcam above the screen means looking at the other person's face reads as slightly down.",
    "- movement: how far the nose travelled between frames, scaled to 0-100%. A PROXY for fidgeting. Leaning in, nodding and talking with the head all raise it.",
    "- open posture: the width between the shoulders measured against this person's own first two and a half seconds. Turning side-on or hunching lowers it; so does simply sitting further back.",
    "- smiling, brow down, eyes down: face blendshape scores. PROXIES for the expression, nothing more. They cannot tell a warm smile from a nervous one, or concentration from a frown.",
    "",
    `Whole session (${seconds}s of camera across ${arcs.length} ${arcs.length === 1 ? "turn" : "turns"}): facing ${pct(overall.facing)}, movement ${pct(overall.fidget)}, open posture ${pct(overall.openness)}, smiling ${pct(overall.smile)}, brow down ${pct(overall.brow)}, eyes down ${pct(overall.gazeDown)}.`,
    "",
    "Per turn. Each pair is the first third of that turn, then the last third, so you can see which way it moved while they were speaking:",
  ];

  for (const a of arcs) {
    const label = turnLabels[a.turn];
    const quoted = label ? ` They said: "${truncate(label, 120)}"` : "";
    lines.push(
      `Turn ${a.turn + 1} (${a.seconds}s): facing ${arrow(a.open.facing, a.close.facing)}, movement ${arrow(a.open.fidget, a.close.fidget)}, open posture ${arrow(a.open.openness, a.close.openness)}, smiling ${arrow(a.open.smile, a.close.smile)}, eyes down ${arrow(a.open.gazeDown, a.close.gazeDown)}.${quoted}`
    );
  }

  const track = downsample(samples, trackBucket(samples));
  if (track.length > 1) {
    lines.push(
      "",
      "Track across the whole session, one row per bucket (turn number, then the same signals):"
    );
    for (const s of track) {
      lines.push(
        `${Math.round(s.t / 1000)}s  turn ${s.turn < 0 ? "-" : s.turn + 1}  facing ${pct(s.facing)}  movement ${pct(s.fidget)}  posture ${pct(s.openness)}  smile ${pct(s.smile)}`
      );
    }
  }

  return lines.join("\n");
}

function trackBucket(samples: Sample[]): number {
  const span = samples[samples.length - 1].t - samples[0].t;
  return Math.max(TRACK_MIN_BUCKET_MS, Math.ceil(span / MAX_TRACK_ROWS));
}

/** "82% → 31%", or just "82%" when the two ends are the same number. */
function arrow(from: number, to: number): string {
  return pct(from) === pct(to) ? pct(from) : `${pct(from)} → ${pct(to)}`;
}
