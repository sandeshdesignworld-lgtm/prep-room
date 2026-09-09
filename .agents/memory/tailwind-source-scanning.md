---
name: Tailwind source scanning
description: Why this project scopes Tailwind v4 content detection to the application source tree.
---

Tailwind v4's default source detection can walk workspace tooling and package-cache directories. Placeholder examples inside those directories may be interpreted as arbitrary utilities and cause Turbopack to resolve invalid module paths during CSS processing.

**Why:** The Next/Turbopack build failed on a generated `mask-[url(...)]` candidate that came from outside the application source tree.

**How to apply:** Keep the global stylesheet on `source(none)` with an explicit `@source` pointing at the app's source tree. If the source layout changes, update that explicit source rather than re-enabling broad auto-detection.