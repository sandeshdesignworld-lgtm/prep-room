import { classifyMediaError, errorName } from "../.test-build/media-errors.js";

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${ok ? "" : `\n        got  ${got}\n        want ${want}`}`);
};

/** Browsers reject with a DOMException; some mobile ones send a plain Error. */
const domErr = (name) => Object.assign(new Error(name), { name });

// --- the rule this whole fix rests on ---
console.log("--- only a real denial is a denial ---");
eq("NotAllowedError is denied", classifyMediaError(domErr("NotAllowedError")), "denied");
eq("PermissionDeniedError is denied", classifyMediaError(domErr("PermissionDeniedError")), "denied");
eq("SecurityError is NOT denied", classifyMediaError(domErr("SecurityError")), "insecure");
eq("NotReadableError is NOT denied", classifyMediaError(domErr("NotReadableError")), "busy");
eq("OverconstrainedError is NOT denied", classifyMediaError(domErr("OverconstrainedError")), "mismatch");
eq("NotFoundError is NOT denied", classifyMediaError(domErr("NotFoundError")), "absent");

console.log("--- the rest of the real errors ---");
eq("DevicesNotFoundError is absent", classifyMediaError(domErr("DevicesNotFoundError")), "absent");
eq("TrackStartError is busy", classifyMediaError(domErr("TrackStartError")), "busy");
eq("ConstraintNotSatisfiedError is mismatch", classifyMediaError(domErr("ConstraintNotSatisfiedError")), "mismatch");

console.log("--- nothing unknown is ever guessed into denied ---");
eq("AbortError is unknown", classifyMediaError(domErr("AbortError")), "unknown");
eq("a bare Error is unknown", classifyMediaError(new Error("boom")), "unknown");
eq("a string is unknown", classifyMediaError("nope"), "unknown");
eq("null is unknown", classifyMediaError(null), "unknown");
eq("undefined is unknown", classifyMediaError(undefined), "unknown");

console.log("--- name extraction survives odd throws ---");
eq("reads a name", errorName(domErr("NotAllowedError")), "NotAllowedError");
eq("no name is empty", errorName({}), "");
eq("null is empty", errorName(null), "");
eq("non-string name is empty", errorName({ name: 7 }), "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
