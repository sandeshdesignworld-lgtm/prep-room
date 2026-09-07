/**
 * ESM rather than TypeScript, and that is not a preference.
 *
 * AvatarKit ships WebAssembly, and `@spatius/avatarkit/next` is the wrapper that
 * serves it from /_avatarkit/ with the right content type and fixes Emscripten's
 * script directory, which bundlers otherwise rewrite to a build-time path the
 * browser cannot resolve. That subpath is export-mapped for `import` only, and
 * Next's TypeScript config loader reaches for it with `require`, which fails the
 * build outright. A .mjs config is loaded as ESM and resolves it.
 *
 * Without the wrapper the avatar fails to load in the browser and the room quietly
 * falls back to voice-only, which is the one failure mode that looks like nothing
 * is wrong.
 */
import { withAvatarkit } from "@spatius/avatarkit/next";

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withAvatarkit(nextConfig);
