/**
 * Puts MediaPipe's WASM runtime and models under public/ so the browser fetches
 * them from our own origin. That keeps the privacy promise honest, nothing
 * about a practice session reaches a third party, not even a model request, * and the app keeps working offline once these are in place.
 *
 * Runs automatically before dev and build. Skips work that's already done.
 */
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();
const wasmOut = path.join(root, "public/mediapipe/wasm");
const modelOut = path.join(root, "public/mediapipe/models");

const MODELS = [
  {
    file: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
  },
  {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
  },
];

async function exists(p) {
  try {
    const s = await stat(p);
    return s.size > 0;
  } catch {
    return false;
  }
}

async function copyWasm() {
  const pkg = path.dirname(require.resolve("@mediapipe/tasks-vision/vision_bundle.js"));
  await mkdir(wasmOut, { recursive: true });
  await cp(path.join(pkg, "wasm"), wasmOut, { recursive: true });
  console.log("mediapipe: wasm runtime copied to public/mediapipe/wasm");
}

async function fetchModels() {
  await mkdir(modelOut, { recursive: true });
  for (const { file, url } of MODELS) {
    const dest = path.join(modelOut, file);
    if (await exists(dest)) {
      console.log(`mediapipe: ${file} already present`);
      continue;
    }
    process.stdout.write(`mediapipe: downloading ${file}… `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  }
}

try {
  await copyWasm();
  await fetchModels();
} catch (err) {
  // Never block dev or build; the app degrades to no delivery signals.
  console.warn("\nmediapipe setup failed; delivery signals will be unavailable.");
  console.warn(String(err?.message ?? err));
}
