/**
 * Compiles the pure modules (the ones with no React, DOM or MediaPipe imports)
 * and runs the assertion suites against them. No test framework: these are plain
 * scripts that exit non-zero on failure, which is all this needs.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = path.join(root, ".test-build");

const PURE = ["speech-text", "json", "signals-math", "progress", "voice-activity", "pcm", "media-errors"];

execFileSync(
  "npx",
  [
    "tsc",
    ...PURE.map((m) => path.join("src/lib", `${m}.ts`)),
    "--outDir", out,
    "--module", "esnext",
    "--target", "es2022",
    "--moduleResolution", "bundler",
    "--skipLibCheck",
  ],
  { cwd: root, stdio: "inherit" }
);

let failed = 0;
for (const file of readdirSync(here).filter((f) => f.endsWith(".test.mjs")).sort()) {
  console.log(`\n── ${file} ${"─".repeat(Math.max(0, 46 - file.length))}`);
  try {
    execFileSync("node", [path.join(here, file)], { cwd: root, stdio: "inherit" });
  } catch {
    failed++;
  }
}

console.log(failed ? `\n${failed} suite(s) failed` : "\nall suites passed");
process.exit(failed ? 1 : 0);
