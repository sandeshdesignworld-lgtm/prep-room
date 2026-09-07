"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  detailSignals,
  faceSignals,
  fidget,
  gateStatus,
  headAngles,
  isFacing,
  newGate,
  nudgeLevel,
  openness,
  readCandidates,
  rotationMatrix,
  shoulderTilt,
  shoulderWidth,
  summariseSignals,
  downsample,
  type LiveRead,
  type Point,
  type Sample,
  type StatusGate,
} from "./signals-math";

/**
 * Reads delivery signals from the webcam, in the browser, and never anywhere
 * else. The video stream is attached to a local <video>, sampled by MediaPipe
 * running on WASM served from our own origin, and thrown away. No frame is
 * uploaded, encoded, or persisted, what leaves this module is a list of
 * numbers.
 *
 * The camera and the analysis are separate on purpose. In the room the camera
 * is on the whole time, the way it is in any call, but reading body language
 * only means something while the user is rehearsing. So the preview costs a
 * video element and the models don't even load until a roleplay starts.
 *
 * Two things come out of the analysis, and the difference matters:
 *
 *  - `read`, three debounced good/attention statuses, shown live over the
 *    camera so the user can see their own signals. Not coaching: no words, no
 *    score, no interpretation, and nothing that names a feeling.
 *  - the samples returned by endAnalysis(), the full timeline, which nobody
 *    sees until the roleplay is over and the debrief is written.
 */

const WASM_PATH = "/mediapipe/wasm";
const FACE_MODEL = "/mediapipe/models/face_landmarker.task";
const POSE_MODEL = "/mediapipe/models/pose_landmarker_lite.task";

/** ~15Hz. Fast enough that the pills track a glance away, far short of every frame. */
const SAMPLE_MS = 66;
/**
 * Pose runs on every other detection. It is the expensive half and posture
 * changes slowly, so ~7.5Hz costs nothing in accuracy and buys back the
 * headroom that keeps the video itself smooth on a mid-range laptop.
 */
const POSE_EVERY = 2;
const POSE_INTERVAL_MS = SAMPLE_MS * POSE_EVERY;

/** Opening seconds used to learn this person's own shoulder width. */
const BASELINE_MS = 2500;
/** Rolling window behind the live pills: recent enough to be true, long enough to be calm. */
const LIVE_WINDOW_MS = 800;
const FACE_WINDOW = Math.max(2, Math.round(LIVE_WINDOW_MS / SAMPLE_MS));
const POSE_WINDOW = Math.max(2, Math.round(LIVE_WINDOW_MS / POSE_INTERVAL_MS));
/** One second of nose positions feeds the movement figure. */
const FIDGET_WINDOW = Math.max(2, Math.round(1000 / POSE_INTERVAL_MS));
/**
 * Nothing is shown until the windows have filled and the shoulder baseline has
 * settled. A pill that reads "good" off two frames is a guess wearing a dot.
 */
const WARMUP_MS = BASELINE_MS + LIVE_WINDOW_MS;
/** The ambient dot is smoothed anyway, so it only needs pushing to React 4x a second. */
const LEVEL_PUSH_MS = 250;
/** Heavy smoothing on the nudge: roughly an 8 second time constant. */
const NUDGE_ALPHA = 1 - Math.exp(-SAMPLE_MS / 8000);

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

export type CaptureStatus =
  | "idle"
  | "starting"
  | "running"
  | "denied"
  | "unavailable"
  | "failed";

/** Off, loading the models, or actually reading. */
export type AnalysisState = "off" | "loading" | "on";

export const CAPTURE_MESSAGE: Record<Exclude<CaptureStatus, "idle" | "running">, string> = {
  starting: "Warming up the camera…",
  denied: "Camera access was blocked. Practice still works. You just won't get delivery notes.",
  unavailable: "No camera available, so there won't be delivery notes. Everything else works.",
  failed: "The camera couldn't start. Practice still works without it.",
};

interface Landmarkers {
  face: { detectForVideo: (v: HTMLVideoElement, t: number) => FaceResult; close(): void };
  pose: { detectForVideo: (v: HTMLVideoElement, t: number) => PoseResult; close(): void };
}
interface FaceResult {
  faceBlendshapes: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes: { data: number[] }[];
}
interface PoseResult {
  landmarks: { x: number; y: number }[][];
}

interface Gates {
  eyeContact: StatusGate;
  posture: StatusGate;
  steady: StatusGate;
  smile: StatusGate;
}

function freshGates(): Gates {
  return { eyeContact: newGate(), posture: newGate(), steady: newGate(), smile: newGate() };
}

async function createLandmarkers(): Promise<Landmarkers> {
  // Imported lazily: the WASM bundle is large and only matters once someone
  // actually rehearses.
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);

  const build = async (delegate: "GPU" | "CPU") => {
    const face = await vision.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    });
    const pose = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: POSE_MODEL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
    });
    return { face, pose } as unknown as Landmarkers;
  };

  try {
    return await build("GPU");
  } catch {
    // Plenty of college laptops have no usable WebGL. CPU is slower but fine at 15Hz.
    return await build("CPU");
  }
}

export function useSignalCapture() {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [analysis, setAnalysis] = useState<AnalysisState>("off");
  const [level, setLevel] = useState(0);
  /** null until the warmup is over: no pills rather than pills built on nothing. */
  const [read, setRead] = useState<LiveRead | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkersRef = useRef<Landmarkers | null>(null);
  const rafRef = useRef<number | null>(null);

  const samplesRef = useRef<Sample[]>([]);
  const turnRef = useRef(-1);
  const startedAtRef = useRef(0);
  const lastSampleRef = useRef(0);
  const lastStampRef = useRef(0);
  const baselineRef = useRef<number[]>([]);
  const noseRef = useRef<Point[]>([]);
  const smoothedRef = useRef(0);
  const lastLevelPushRef = useRef(0);

  /**
   * Bumped whenever the camera is torn down. startCamera() is a chain of awaits
   * (a permission prompt, then a video element that has to start playing), and
   * a user who leaves during one must not end up with a camera that switches
   * itself on afterwards and stays on.
   */
  const cameraRunRef = useRef(0);
  /** The same guard for analysis, whose await is a multi-megabyte model load. */
  const analysisRunRef = useRef(0);

  const poseTickRef = useRef(0);
  const lastPoseRef = useRef({ openness: 0, tilt: 0, fidget: 0 });
  const facingWindowRef = useRef<number[]>([]);
  const opennessWindowRef = useRef<number[]>([]);
  const fidgetWindowRef = useRef<number[]>([]);
  const smileWindowRef = useRef<number[]>([]);
  const gatesRef = useRef<Gates>(freshGates());
  /** Has the first read reached React yet? A ref, so the loop never closes over
   *  a stale `read` and re-publishes an identical object at 15Hz. */
  const publishedRef = useRef(false);

  /** Stops the detection loop. The camera and the loaded models stay put. */
  const haltAnalysis = useCallback(() => {
    analysisRunRef.current += 1;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const teardown = useCallback(() => {
    haltAnalysis();
    cameraRunRef.current += 1;
    landmarkersRef.current?.face.close();
    landmarkersRef.current?.pose.close();
    landmarkersRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [haltAnalysis]);

  /* ------------------------------ the camera ------------------------------ */

  const startCamera = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    const runId = ++cameraRunRef.current;
    setStatus("starting");

    let stream: MediaStream;
    try {
      // Video only. Audio belongs to speech recognition and is never touched here.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
      return;
    }
    if (cameraRunRef.current !== runId) {
      // Turned off while the permission prompt was up. Hand the camera straight back.
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;

    const video = videoRef.current;
    if (!video) {
      teardown();
      setStatus("failed");
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
    } catch (err) {
      console.error("[signals] camera failed to start", err);
      teardown();
      setStatus("failed");
      return;
    }
    if (cameraRunRef.current !== runId) return;
    setStatus("running");
  }, [teardown]);

  const stopCamera = useCallback(() => {
    teardown();
    setStatus("idle");
    setAnalysis("off");
    setLevel(0);
    setRead(null);
    samplesRef.current = [];
  }, [teardown]);

  /* ----------------------------- the analysis ----------------------------- */

  const startAnalysis = useCallback(async () => {
    const runId = ++analysisRunRef.current;

    samplesRef.current = [];
    baselineRef.current = [];
    noseRef.current = [];
    smoothedRef.current = 0;
    turnRef.current = -1;
    poseTickRef.current = 0;
    lastPoseRef.current = { openness: 0, tilt: 0, fidget: 0 };
    facingWindowRef.current = [];
    opennessWindowRef.current = [];
    fidgetWindowRef.current = [];
    smileWindowRef.current = [];
    gatesRef.current = freshGates();
    publishedRef.current = false;
    setRead(null);
    setLevel(0);

    // Loaded once and kept: a second roleplay shouldn't re-fetch 9MB of models.
    if (!landmarkersRef.current) {
      setAnalysis("loading");
      let marks: Landmarkers;
      try {
        marks = await createLandmarkers();
      } catch (err) {
        console.error("[signals] models failed to load", err);
        setAnalysis("off");
        return;
      }
      if (analysisRunRef.current !== runId) {
        marks.face.close();
        marks.pose.close();
        return;
      }
      landmarkersRef.current = marks;
    }

    startedAtRef.current = performance.now();
    lastSampleRef.current = 0;
    lastStampRef.current = 0;
    lastLevelPushRef.current = 0;
    setAnalysis("on");

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const marks = landmarkersRef.current;
      const el = videoRef.current;
      if (!marks || !el || el.readyState < 2) return;

      const now = performance.now();
      if (now - lastSampleRef.current < SAMPLE_MS) return;
      lastSampleRef.current = now;
      const t = now - startedAtRef.current;

      // MediaPipe rejects a timestamp that doesn't advance, and two rAF
      // callbacks can land on the same millisecond.
      let stamp = now;
      if (stamp <= lastStampRef.current) stamp = lastStampRef.current + 1;
      lastStampRef.current = stamp;

      let facing = 0;
      let face = { smile: 0, brow: 0, gazeDown: 0, jawOpen: 0, cheek: 0, eyeSquint: 0 };
      // Pose only runs on alternate ticks, so the ticks in between carry the
      // last real reading forward rather than writing a zero into the timeline.
      let { openness: open, tilt, fidget: movement } = lastPoseRef.current;

      try {
        const f = marks.face.detectForVideo(el, stamp);
        const matrix = f.facialTransformationMatrixes?.[0]?.data;
        if (matrix?.length === 16) {
          facing = isFacing(headAngles(rotationMatrix(matrix))) ? 1 : 0;
        }
        const categories = f.faceBlendshapes?.[0]?.categories;
        if (categories) {
          const scores: Record<string, number> = {};
          for (const c of categories) scores[c.categoryName] = c.score;
          face = faceSignals(scores);
        }

        if (poseTickRef.current % POSE_EVERY === 0) {
          const p = marks.pose.detectForVideo(el, stamp);
          const marksList = p.landmarks?.[0];
          if (marksList) {
            const left = marksList[LEFT_SHOULDER];
            const right = marksList[RIGHT_SHOULDER];
            if (left && right) {
              const width = shoulderWidth(left, right);
              if (t < BASELINE_MS) baselineRef.current.push(width);
              const baseline = median(baselineRef.current);
              open = openness(width, baseline);
              tilt = shoulderTilt(left, right);
            }
            const nose = marksList[NOSE];
            if (nose) {
              noseRef.current.push({ x: nose.x, y: nose.y });
              if (noseRef.current.length > FIDGET_WINDOW) noseRef.current.shift();
              movement = fidget(noseRef.current, POSE_INTERVAL_MS);
            }
          }
          lastPoseRef.current = { openness: open, tilt, fidget: movement };
          push(opennessWindowRef.current, open, POSE_WINDOW);
          push(fidgetWindowRef.current, movement, POSE_WINDOW);
        }
        poseTickRef.current += 1;
      } catch {
        // A dropped frame is not worth failing the session over.
        return;
      }

      const sample: Sample = {
        t,
        turn: turnRef.current,
        facing,
        ...face,
        openness: open,
        tilt,
        fidget: movement,
      };
      samplesRef.current.push(sample);
      push(facingWindowRef.current, facing, FACE_WINDOW);
      push(smileWindowRef.current, face.smile, FACE_WINDOW);

      // ---- the live read, debounced so the pills can't strobe ----
      if (t >= WARMUP_MS) {
        const candidates = readCandidates({
          eyeContactRatio: mean(facingWindowRef.current),
          openness: mean(opennessWindowRef.current),
          fidget: mean(fidgetWindowRef.current),
          smile: mean(smileWindowRef.current),
        });
        const prev = gatesRef.current;
        const next: Gates = {
          eyeContact: gateStatus(prev.eyeContact, candidates.eyeContact, now),
          posture: gateStatus(prev.posture, candidates.posture, now),
          steady: gateStatus(prev.steady, candidates.steady, now),
          smile: gateStatus(prev.smile, candidates.smile, now),
        };
        // Every gate hands back its previous object when nothing moved, so this
        // re-renders on a real change and stays silent the rest of the time,
        // which at 15Hz is the difference between a calm screen and a hot one.
        const moved =
          next.eyeContact !== prev.eyeContact ||
          next.posture !== prev.posture ||
          next.steady !== prev.steady ||
          next.smile !== prev.smile;
        if (moved || !publishedRef.current) {
          gatesRef.current = next;
          publishedRef.current = true;
          setRead({
            eyeContact: next.eyeContact.status,
            posture: next.posture.status,
            steady: next.steady.status,
            smile: next.smile.status,
          });
        }
      }

      const target = nudgeLevel(sample);
      smoothedRef.current += (target - smoothedRef.current) * NUDGE_ALPHA;
      if (now - lastLevelPushRef.current >= LEVEL_PUSH_MS) {
        lastLevelPushRef.current = now;
        setLevel(smoothedRef.current);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  /** Ends the read and hands back the timeline. The camera keeps running. */
  const endAnalysis = useCallback(() => {
    haltAnalysis();
    setAnalysis("off");
    setLevel(0);
    setRead(null);
    const samples = samplesRef.current;
    samplesRef.current = [];
    return samples;
  }, [haltAnalysis]);

  /** Called as each user turn begins, so samples can be tied back to a moment. */
  const markTurn = useCallback((index: number) => {
    turnRef.current = index;
  }, []);

  useEffect(() => teardown, [teardown]);

  return {
    status,
    analysis,
    level,
    read,
    videoRef,
    startCamera,
    stopCamera,
    startAnalysis,
    endAnalysis,
    markTurn,
  };
}

/** Appends to a rolling window, dropping the oldest once it's full. */
function push(window: number[], value: number, max: number) {
  window.push(value);
  if (window.length > max) window.shift();
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export { summariseSignals, detailSignals, downsample };
export type { LiveRead, Sample };
