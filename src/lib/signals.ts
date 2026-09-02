"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  faceSignals,
  fidget,
  headAngles,
  isFacing,
  nudgeLevel,
  openness,
  rotationMatrix,
  shoulderTilt,
  shoulderWidth,
  summariseSignals,
  downsample,
  type Point,
  type Sample,
} from "./signals-math";

/**
 * Reads delivery signals from the webcam, in the browser, and never anywhere
 * else. The video stream is attached to a local <video>, sampled by MediaPipe
 * running on WASM served from our own origin, and thrown away. No frame is
 * uploaded, encoded, or persisted, what leaves this module is a list of
 * numbers.
 *
 * Nothing here is shown to the user mid-roleplay except the ambient dot.
 */

const WASM_PATH = "/mediapipe/wasm";
const FACE_MODEL = "/mediapipe/models/face_landmarker.task";
const POSE_MODEL = "/mediapipe/models/pose_landmarker_lite.task";

/** ~10Hz. Plenty for posture and gaze, and a tenth of the cost of every frame. */
const SAMPLE_MS = 100;
/** Opening seconds used to learn this person's own shoulder width. */
const BASELINE_MS = 2500;
/** One second of nose positions feeds the movement figure. */
const FIDGET_WINDOW = 10;
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

async function createLandmarkers(): Promise<Landmarkers> {
  // Imported lazily: the WASM bundle is large and only matters once someone
  // actually turns the camera on.
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
    // Plenty of college laptops have no usable WebGL. CPU is slower but fine at 10Hz.
    return await build("CPU");
  }
}

export function useSignalCapture() {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [level, setLevel] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkersRef = useRef<Landmarkers | null>(null);
  const rafRef = useRef<number | null>(null);

  const samplesRef = useRef<Sample[]>([]);
  const turnRef = useRef(-1);
  const startedAtRef = useRef(0);
  const lastSampleRef = useRef(0);
  const baselineRef = useRef<number[]>([]);
  const noseRef = useRef<Point[]>([]);
  const smoothedRef = useRef(0);

  const teardown = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    landmarkersRef.current?.face.close();
    landmarkersRef.current?.pose.close();
    landmarkersRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("unavailable");
      return;
    }
    setStatus("starting");
    samplesRef.current = [];
    baselineRef.current = [];
    noseRef.current = [];
    smoothedRef.current = 0;
    turnRef.current = -1;

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
      landmarkersRef.current = await createLandmarkers();
    } catch (err) {
      console.error("[signals] setup failed", err);
      teardown();
      setStatus("failed");
      return;
    }

    startedAtRef.current = performance.now();
    lastSampleRef.current = 0;
    setStatus("running");

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const marks = landmarkersRef.current;
      const el = videoRef.current;
      if (!marks || !el || el.readyState < 2) return;

      const now = performance.now();
      if (now - lastSampleRef.current < SAMPLE_MS) return;
      lastSampleRef.current = now;
      const t = now - startedAtRef.current;

      let facing = 0;
      let face = { smile: 0, brow: 0, gazeDown: 0, jawOpen: 0 };
      let open = 0;
      let tilt = 0;
      let movement = 0;

      try {
        // MediaPipe requires strictly increasing timestamps, so pass our own clock.
        const f = marks.face.detectForVideo(el, now);
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

        const p = marks.pose.detectForVideo(el, now);
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
            movement = fidget(noseRef.current);
          }
        }
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

      const target = nudgeLevel(sample);
      smoothedRef.current += (target - smoothedRef.current) * NUDGE_ALPHA;
      setLevel(smoothedRef.current);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [teardown]);

  /** Called as each user turn begins, so samples can be tied back to a moment. */
  const markTurn = useCallback((index: number) => {
    turnRef.current = index;
  }, []);

  const stop = useCallback(() => {
    teardown();
    setStatus("idle");
    setLevel(0);
    const samples = samplesRef.current;
    samplesRef.current = [];
    return samples;
  }, [teardown]);

  useEffect(() => teardown, [teardown]);

  return { status, level, videoRef, start, stop, markTurn };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export { summariseSignals, downsample };
export type { Sample };
