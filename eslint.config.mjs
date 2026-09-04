import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated, not ours: the MediaPipe WASM glue is downloaded by
    // scripts/setup-mediapipe.mjs (and gitignored), and .test-build is tsc output.
    "public/mediapipe/**",
    ".test-build/**",
  ]),
]);

export default eslintConfig;
