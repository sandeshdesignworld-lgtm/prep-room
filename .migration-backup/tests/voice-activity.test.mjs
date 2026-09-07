import {
  advanceGate, newSpeechGate, rms, silenceRemaining, shouldSend,
  lastHeard, speechThresholds, adaptNoiseFloor,
  SPEECH_OVER_NOISE, NOISY_ROOM_RMS,
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
  // The gate no longer returns itself on a quiet frame, because the noise floor
  // moves on every one of them. What must not move is the verdict.
  let g = newSpeechGate();
  const next = advanceGate(g, QUIET, 0);
  ok("a quiet frame is still not speech", next.speaking === false);
  ok("and it is still not rising", next.risingSince < 0);
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

/* ------------------------------ a noisy room ---------------------------- */

console.log("--- thresholds follow the room ---");
ok("a silent room uses the absolute floor",
  speechThresholds(0).on === SPEECH_ON_RMS);
ok("so does a very quiet one, rather than chasing the hiss down",
  speechThresholds(0.001).on === SPEECH_ON_RMS);
{
  const noisy = speechThresholds(0.05);
  ok("a noisy room raises the bar", noisy.on > SPEECH_ON_RMS);
  near("to a fixed multiple of the noise", noisy.on, 0.05 * SPEECH_OVER_NOISE, 1e-9);
  ok("release stays below onset, so words don't chop", noisy.off < noisy.on);
}

console.log("--- the floor follows the room ---");
{
  // Down in a handful of frames, not a handful of seconds.
  let f = 0.05;
  for (let i = 0; i < 10; i++) f = adaptNoiseFloor(f, 0.01);
  ok("falls to the new quiet within half a second", f < 0.015);
}
ok("rises slowly when it gets loud",
  adaptNoiseFloor(0.01, 0.20) < 0.02);
{
  // A cafe: ambient chatter well above the old fixed threshold. It must settle
  // as noise rather than being taken for the user talking.
  let g = newSpeechGate();
  for (let i = 0; i < 400; i++) g = advanceGate(g, 0.030, i * 50);
  ok("sustained chatter is never called speech", g.speaking === false);
  ok("and becomes the floor instead", g.noiseFloor > 0.02);
  // The user, close to the mic, is far louder than the room.
  const before = g.noiseFloor;
  for (let i = 0; i < 20; i++) g = advanceGate(g, 0.25, 20000 + i * 50);
  ok("the user still gets through in that room", g.speaking === true);
  ok("and their voice does not raise the floor", g.noiseFloor === before);
}
{
  // The same chatter level in a room that was quiet a moment ago: with the old
  // fixed threshold this was speech, which is the bug.
  let quiet = newSpeechGate();
  for (let i = 0; i < 400; i++) quiet = advanceGate(quiet, 0.004, i * 50);
  ok("a quiet room keeps a low floor", quiet.noiseFloor < 0.01);
}
ok("the noisy-room mark is above ordinary quiet", NOISY_ROOM_RMS > SPEECH_OFF_RMS);

/* ---------------------------- which clock wins -------------------------- */

console.log("--- last heard ---");
// The regression: a level meter that is running but has never crossed its
// threshold reports 0, and 0 must never beat a real recognition stamp. When it
// did, a quiet microphone meant the countdown never started and the user's turn
// was never sent, however clearly they had been transcribed.
ok("a silent meter never outranks a heard word", lastHeard(0, 4200) === 4200);
ok("a working meter wins when it is later", lastHeard(4200, 3000) === 4200);
ok("recognition wins when it is later", lastHeard(3000, 4200) === 4200);
ok("neither has heard anything", lastHeard(0, 0) === 0);

/* ------------------------- the window is on purpose --------------------- */

ok("the silence window is generous by design", SILENCE_MS >= 1500);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
