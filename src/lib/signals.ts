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
import { allowAgainHint, INSECURE_MESSAGE, isSecure } from "./secure";

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

/**
 * Whether this video can actually be handed to a detector right now.
 *
 * Every clause here is a way MediaPipe throws rather than returning nothing,
 * and a throw used to take the read down for the rest of the rehearsal:
 *
 *  - no element, or no stream on it;
 *  - HAVE_NOTHING / HAVE_METADATA, which happens for a moment whenever the
 *    stream is re-attached or the element is re-laid-out;
 *  - a zero intrinsic size, which can outlast readyState reaching 2 and is the
 *    one that readyState alone does not catch;
 *  - paused or ended, where there is no current frame to read at all.
 */
function videoIsReadable(el: HTMLVideoElement): boolean {
  return (
    el.readyState >= 2 &&
    el.videoWidth > 0 &&
    el.videoHeight > 0 &&
    !el.paused &&
    !el.ended
  );
}

/**
 * How long the loop may go without running a single frame before it is treated
 * as dead. Comfortably longer than a slow frame, comfortably shorter than a
 * rehearsal.
 */
const LOOP_STALL_MS = 2000;

/** Roughly two seconds of failed frames at the sample rate. */
const DETECT_FAILURE_ALARM = 30;

const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

export type CaptureStatus =
  | "idle"
  | "starting"
  | "running"
  | "denied"
  | "unavailable"
  | "insecure"
  | "failed";

/** Off, loading the models, or actually reading. */
export type AnalysisState = "off" | "loading" | "on";

/**
 * What to say about a camera that is not running. Read at render time rather
 * than held in a constant, because the advice for getting the camera back
 * depends on whether this is a browser tab or an installed app.
 */
export function captureMessage(status: CaptureStatus): string {
  switch (status) {
    case "starting":
      return "Warming up the camera…";
    case "denied":
      return `Your browser is blocking the camera. ${allowAgainHint("camera")} Everything else works without it, and you can still type or talk to your coach.`;
    case "unavailable":
      return "No camera on this device, so there will be no delivery notes. Everything else works, and you can still type or talk to your coach.";
    case "insecure":
      // Not the same thing as absent hardware, and worth separating: the phone
      // has a camera, the page just is not on an origin allowed to ask for it.
      return INSECURE_MESSAGE;
    case "failed":
      return "The camera could not start. Another app may be using it, so close that and try again. Practice still works without it, and you can talk or type to your coach.";
    default:
      return "";
  }
}

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
  /**
   * True when startAnalysis() gave up rather than started. State, not a ref:
   * the room reads it to clear its own retry latch, and a ref would not tell
   * it anything had changed.
   */
  const [failed, setFailed] = useState(false);
  /** Guards against a second preload racing the first. */
  const preloadingRef = useRef(false);

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
  /** Consecutive detection throws, so a permanently dead read announces itself. */
  const detectFailuresRef = useRef(0);
  /** When the loop last ran a frame at all. The watchdog reads this. */
  const lastTickRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);

  /** Stops the detection loop. The camera and the loaded models stay put. */
  const haltAnalysis = useCallback(() => {
    analysisRunRef.current += 1;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (watchdogRef.current !== null) window.clearInterval(watchdogRef.current);
    watchdogRef.current = null;
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
      // On http the API is not refused, it is simply absent, which is
      // indistinguishable from a laptop with no webcam unless we check.
      const why = isSecure() ? "unavailable" : "insecure";
      console.error(`[Prime AI signals] no camera API available (${why}).`);
      setStatus(why);
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
      // Phones distinguish these, and so must we: "allow the camera" and "no
      // camera here" send the user to different places, and a camera another
      // app is holding is neither. Anything unrecognised is treated as a
      // failure rather than absent hardware, because claiming a phone has no
      // camera is the one answer that is almost certainly wrong.
      const name = err instanceof DOMException ? err.name : "";
      console.error("[Prime AI signals] the camera was refused or unavailable.", name, err);
      setStatus(
        name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError"
          ? "denied"
          : name === "NotFoundError" ||
              name === "DevicesNotFoundError" ||
              name === "OverconstrainedError"
            ? "unavailable"
            : "failed",
      );
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

  /**
   * Fetches and instantiates the models without starting to read.
   *
   * The read used to begin at the same moment the rehearsal did, which meant
   * the first several seconds of it were spent downloading nine megabytes of
   * face and pose models. The pills sat grey through the opening line and the
   * user's first answer, which is exactly the part of a rehearsal they most
   * want a read on, and grey for eight seconds is indistinguishable from
   * broken.
   *
   * So this runs while the practice card is on screen, during the seconds
   * someone spends choosing a difficulty and reading what is about to happen.
   * By the time they press Start the models are cached and only the warmup is
   * left. Safe to call repeatedly; it does nothing once they are loaded.
   *
   * Loading is not reading. Nothing is sampled here and the camera is not
   * touched: this only puts the models in memory.
   */
  const preloadModels = useCallback(async () => {
    if (landmarkersRef.current || preloadingRef.current) return;
    preloadingRef.current = true;
    try {
      landmarkersRef.current = await createLandmarkers();
    } catch (err) {
      console.error("[Prime AI signals] the face and pose models failed to load.", err);
    } finally {
      preloadingRef.current = false;
    }
  }, []);


  const startAnalysis = useCallback(async () => {
    const runId = ++analysisRunRef.current;
    setFailed(false);

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
    detectFailuresRef.current = 0;
    setRead(null);
    setLevel(0);

    // Loaded once and kept: a second roleplay shouldn't re-fetch 9MB of models.
    if (!landmarkersRef.current) {
      setAnalysis("loading");
      let marks: Landmarkers;
      try {
        marks = await createLandmarkers();
      } catch (err) {
        console.error(
          "[Prime AI signals] the face and pose models failed to load, so there is no live read this time.",
          err
        );
        setFailed(true);
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
    console.info(
      "[Prime AI signals] reading body language from the camera, on this device. Nothing is uploaded."
    );

    const tick = () => {
      // Scheduled first and unconditionally. Whatever happens below, the next
      // frame is already booked, so no single bad frame can end the loop.
      rafRef.current = requestAnimationFrame(tick);

      lastTickRef.current = performance.now();

      const marks = landmarkersRef.current;
      const el = videoRef.current;
      if (!marks || !el) return;

      // The stream can come adrift from the element: a re-layout, a element
      // React re-created, a track the browser detached. MediaPipe is handed
      // this element every frame, so if it has lost its source the read is over
      // until something puts it back. This puts it back.
      const stream = streamRef.current;
      if (stream && el.srcObject !== stream) {
        el.srcObject = stream;
        void el.play().catch(() => {});
        return;
      }
      if (el.paused && stream) void el.play().catch(() => {});

      // readyState alone is not enough. A video can report HAVE_CURRENT_DATA
      // while its intrinsic size is still 0, and detectForVideo throws on a
      // zero-sized frame rather than returning nothing. Skipping is free; the
      // next frame is 66ms away.
      if (!videoIsReadable(el)) return;

      const now = performance.now();
      if (now - lastSampleRef.current < SAMPLE_MS) return;
      lastSampleRef.current = now;
      const t = now - startedAtRef.current;

      // MediaPipe rejects a timestamp that does not advance, and two rAF
      // callbacks can land on the same millisecond. Strictly increasing by
      // construction: never the previous value, never behind it, even if
      // performance.now() were to stall or step backwards.
      const stamp = Math.max(now, lastStampRef.current + 1);
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
        detectFailuresRef.current = 0;
      } catch (err) {
        // A dropped frame is not worth failing the session over, and it must
        // never be worth ending the loop over: the next frame is already
        // scheduled and will try again. A dropped frame EVERY frame is worth
        // saying out loud, once, or the read sits grey for the whole rehearsal
        // with nothing anywhere explaining it.
        detectFailuresRef.current += 1;
        if (detectFailuresRef.current === DETECT_FAILURE_ALARM) {
          console.error(
            `[Prime AI signals] face and pose detection has failed ${DETECT_FAILURE_ALARM} frames in a row, so the live read is not updating. The loop is still running and will recover on its own if the camera comes back.`,
            err
          );
        }
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

    lastTickRef.current = performance.now();
    rafRef.current = requestAnimationFrame(tick);

    /**
     * Restarts the loop if it ever stops running.
     *
     * requestAnimationFrame is not a guarantee. A frame callback that throws
     * somewhere unguarded, a renderer under enough pressure to drop it, a tab
     * hidden and restored oddly: any of them leave the read frozen for the rest
     * of the rehearsal, still showing whatever it last showed, with nothing to
     * say it has stopped.
     *
     * Cancelling before rescheduling means there is never more than one loop:
     * a callback already queued is discarded rather than joined by a second.
     */
    if (watchdogRef.current !== null) window.clearInterval(watchdogRef.current);
    watchdogRef.current = window.setInterval(() => {
      if (analysisRunRef.current !== runId) return;
      if (performance.now() - lastTickRef.current < LOOP_STALL_MS) return;
      console.warn("[Prime AI signals] the read stopped running, restarting it.");
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastTickRef.current = performance.now();
      rafRef.current = requestAnimationFrame(tick);
    }, LOOP_STALL_MS);
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
    /** The last attempt to start reading failed. Worth trying again. */
    failed,
    level,
    read,
    videoRef,
    startCamera,
    stopCamera,
    preloadModels,
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
