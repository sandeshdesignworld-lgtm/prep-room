import {
  advanceGate, newSpeechGate, rms, silenceRemaining, shouldSend,
  SILENCE_MS, SPEECH_ON_RMS, SPEECH_OFF_RMS, SPEECH_MIN_MS, MIN_VISIBLE_MS,
} from "../.test-build/voice-activity.js";

let pass=0, fail=0;
const ok=(n,c)=>{c?pass++:fail++;console.log(`${c?"ok  ":"FAIL"}  ${n}`);};
const near=(n,g,w,eps=1e-6)=>{const c=Math.abs(g-w)<eps;c?pass++:fail++;
  console.log(`${c?"ok  ":"FAIL"}  ${n}${c?"":`  got ${g}, want ~${w}`}`);};

const LOUD = SPEECH_ON_RMS + 0.05;
const QUIET = SPEECH_OFF_RMS / 2;
const BETWEEN = (SPEECH_ON_RMS + SPEECH_OFF_RMS) / 2;

/* -------------------------------- rms ---------------------------------- */

near("rms of silence", rms(new Float32Array(64)), 0);
near("rms of a constant", rms([0.5, -0.5, 0.5, -0.5]), 0.5);
ok("rms of nothing", rms([]) === 0);
ok("rms survives NaN", Number.isFinite(rms([NaN, 1])));

/* ------------------------------ the gate -------------------------------- */

ok("starts quiet", newSpeechGate().speaking === false);

{
  // A loud frame is not speech on its own; it has to hold.
  let g = newSpeechGate();
  g = advanceGate(g, LOUD, 0);
  ok("loud frame alone isn't speech", g.speaking === false);
  g = advanceGate(g, LOUD, SPEECH_MIN_MS - 10);
  ok("still not speech just before the minimum", g.speaking === false);
  g = advanceGate(g, LOUD, SPEECH_MIN_MS);
  ok("speech once it has held", g.speaking === true);
}

{
  // The blip filter: loud, then gone, well inside the minimum.
  let g = newSpeechGate();
  g = advanceGate(g, LOUD, 0);
  g = advanceGate(g, LOUD, 60);
  g = advanceGate(g, QUIET, 80);
  ok("a short blip never becomes speech", g.speaking === false);
  g = advanceGate(g, LOUD, 100);
  g = advanceGate(g, LOUD, 100 + SPEECH_MIN_MS - 10);
  ok("and the blip's clock doesn't count toward the next run", g.speaking === false);
}

{
  // Hysteresis: a quiet syllable mid-sentence keeps it speech.
  let g = newSpeechGate();
  g = advanceGate(g, LOUD, 0);
  g = advanceGate(g, LOUD, SPEECH_MIN_MS);
  ok("speaking", g.speaking === true);
  const held = advanceGate(g, BETWEEN, 500);
  ok("a dip between the thresholds stays speech", held.speaking === true);
  ok("and reports no change at all", held === g);
  ok("a clear drop ends it", advanceGate(g, QUIET, 600).speaking === false);
}

{
  let g = newSpeechGate();
  ok("quiet on quiet is the same object", advanceGate(g, QUIET, 0) === g);
}

/* ---------------------------- the countdown ----------------------------- */

near("full window right after speech", silenceRemaining(1000, 1000), SILENCE_MS);
near("half way", silenceRemaining(1000, 1000 + SILENCE_MS / 2), SILENCE_MS / 2);
ok("never negative", silenceRemaining(1000, 1000 + SILENCE_MS * 3) === 0);

const armedAt = 0;
ok(
  "sends after a full silence window",
  shouldSend({ lastSpeechAt: 1000, armedAt, now: 1000 + SILENCE_MS + 1 }) === true
);
ok(
  "no speech ever heard means no send",
  shouldSend({ lastSpeechAt: 0, armedAt, now: 99999 }) === false
);
ok(
  "holds while the user is still inside the window",
  shouldSend({ lastSpeechAt: 1000, armedAt, now: 1000 + SILENCE_MS - 100 }) === false
);
ok(
  "and the indicator always gets its moment on screen",
  shouldSend({ lastSpeechAt: 1, armedAt: 5000, now: 5000 + MIN_VISIBLE_MS - 50 }) === false
);
ok(
  "then goes once it has had it",
  shouldSend({ lastSpeechAt: 1, armedAt: 5000, now: 5000 + MIN_VISIBLE_MS + 50 }) === true
);

/* ------------------------- the window is on purpose --------------------- */

ok("the silence window is generous by design", SILENCE_MS >= 1500);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
