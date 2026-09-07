import {
  matrixLayout, rotationMatrix, headAngles, isFacing, faceSignals,
  shoulderWidth, shoulderTilt, openness, fidget, nudgeLevel,
  downsample, rollupByTurn, summariseSignals,
  readCandidates, newGate, gateStatus, STATUS_HOLD_MS, FIDGET_NOMINAL_MS,
  turnArcs, detailSignals, MAX_TRACK_ROWS,
} from "../.test-build/signals-math.js";

let pass=0, fail=0;
const ok=(n,c)=>{c?pass++:fail++;console.log(`${c?"ok  ":"FAIL"}  ${n}`);};
const near=(n,g,w,eps=0.5)=>{const c=Math.abs(g-w)<eps;c?pass++:fail++;
  console.log(`${c?"ok  ":"FAIL"}  ${n}${c?"":`  got ${g}, want ~${w}`}`);};

// Build a rotation matrix for known yaw/pitch/roll, R = Rz*Ry*Rx
const d2r = d => d*Math.PI/180;
function build(yawDeg, pitchDeg, rollDeg) {
  const a=d2r(pitchDeg), b=d2r(yawDeg), g=d2r(rollDeg);
  const ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cg=Math.cos(g),sg=Math.sin(g);
  return [
    [cg*cb, cg*sb*sa - sg*ca, cg*sb*ca + sg*sa],
    [sg*cb, sg*sb*sa + cg*ca, sg*sb*ca - cg*sa],
    [-sb,   cb*sa,            cb*ca],
  ];
}
// Flatten with translation in the right place for each layout
const flatRow = (R,tx,ty,tz)=>[R[0][0],R[0][1],R[0][2],tx, R[1][0],R[1][1],R[1][2],ty, R[2][0],R[2][1],R[2][2],tz, 0,0,0,1];
const flatCol = (R,tx,ty,tz)=>[R[0][0],R[1][0],R[2][0],0, R[0][1],R[1][1],R[2][1],0, R[0][2],R[1][2],R[2][2],0, tx,ty,tz,1];

console.log("--- matrix layout detection ---");
const R30 = build(30, 0, 0);
ok("detects row-major (translation in col 4)", matrixLayout(flatRow(R30, 2, -3, -55)) === "row");
ok("detects column-major (translation in row 4)", matrixLayout(flatCol(R30, 2, -3, -55)) === "column");

console.log("--- angle recovery, BOTH layouts ---");
for (const [name, flat] of [["row", flatRow], ["column", flatCol]]) {
  for (const [y,p,r] of [[0,0,0],[30,0,0],[-25,0,0],[0,20,0],[0,-15,0],[0,0,12],[18,-10,5]]) {
    const a = headAngles(rotationMatrix(flat(build(y,p,r), 2,-3,-55)));
    near(`${name}: yaw ${y} pitch ${p} roll ${r} -> yaw`, a.yaw, y);
    near(`${name}: yaw ${y} pitch ${p} roll ${r} -> pitch`, a.pitch, p);
    near(`${name}: yaw ${y} pitch ${p} roll ${r} -> roll`, a.roll, r);
  }
}

console.log("--- facing thresholds (brief: |yaw|<18, |pitch|<14) ---");
ok("straight on = facing", isFacing({yaw:0,pitch:0,roll:0}));
ok("yaw 17 = facing", isFacing({yaw:17,pitch:0,roll:0}));
ok("yaw 19 = not facing", !isFacing({yaw:19,pitch:0,roll:0}));
ok("yaw -19 = not facing", !isFacing({yaw:-19,pitch:0,roll:0}));
ok("pitch 13 = facing", isFacing({yaw:0,pitch:13,roll:0}));
ok("pitch 15 = not facing", !isFacing({yaw:0,pitch:15,roll:0}));
ok("big roll alone still facing", isFacing({yaw:0,pitch:0,roll:40}));

console.log("--- blendshapes ---");
const bs = faceSignals({mouthSmileLeft:0.4, mouthSmileRight:0.6, browDownLeft:0.2, browDownRight:0.2, eyeLookDownLeft:0.8, eyeLookDownRight:0.6, jawOpen:0.3});
near("smile averages the pair", bs.smile, 0.5, 1e-9);
near("brow averages the pair", bs.brow, 0.2, 1e-9);
near("gazeDown averages the pair", bs.gazeDown, 0.7, 1e-9);
near("jawOpen is single", bs.jawOpen, 0.3, 1e-9);
const empty = faceSignals({});
ok("missing blendshapes read as 0", empty.smile===0 && empty.jawOpen===0);

console.log("--- posture ---");
near("shoulder width", shoulderWidth({x:0.3,y:0.5},{x:0.7,y:0.5}), 0.4, 1e-9);
near("level shoulders = 0 tilt", shoulderTilt({x:0.3,y:0.5},{x:0.7,y:0.5}), 0, 1e-9);
ok("dropped shoulder gives nonzero tilt", Math.abs(shoulderTilt({x:0.3,y:0.5},{x:0.7,y:0.6}))>10);
near("at baseline openness ~0.71", openness(0.4, 0.4), 0.714, 0.01);
ok("narrower than baseline lowers openness", openness(0.30,0.4) < openness(0.40,0.4));
ok("openness clamps to 0..1", openness(0.05,0.4)===0 && openness(1.0,0.4)===1);
ok("zero baseline is safe", openness(0.4, 0) === 0);

console.log("--- fidget ---");
const still = Array.from({length:10},(_,i)=>({x:0.5,y:0.5}));
const jittery = Array.from({length:10},(_,i)=>({x:0.5+(i%2)*0.03,y:0.5}));
near("perfectly still = 0", fidget(still), 0, 1e-9);
near("jittery saturates at 1", fidget(jittery), 1, 1e-9);
ok("single point is safe", fidget([{x:0,y:0}])===0);
ok("empty is safe", fidget([])===0);

console.log("--- nudge level ---");
near("settled -> low", nudgeLevel({facing:1,fidget:0,openness:1}), 0, 1e-9);
near("worst case -> 1", nudgeLevel({facing:0,fidget:1,openness:0}), 1, 1e-9);
ok("looking away dominates", nudgeLevel({facing:0,fidget:0,openness:1}) > nudgeLevel({facing:1,fidget:1,openness:1}));

console.log("--- downsample + rollup ---");
const mk=(t,turn,facing)=>({t,turn,facing,smile:0,brow:0,gazeDown:0,jawOpen:0,openness:0.5,tilt:0,fidget:0.2});
const raw=[mk(0,0,1),mk(100,0,1),mk(500,0,0),mk(1000,1,0),mk(1500,1,1)];
const ds=downsample(raw,1000);
ok("downsample buckets by second", ds.length===2);
near("bucket 0 facing is the mean", ds[0].facing, 2/3, 1e-9);
ok("bucket takes the turn it ends in", ds[1].turn===1);
ok("downsample of empty is empty", downsample([],1000).length===0);
const roll=rollupByTurn(raw);
ok("rollup groups by turn", roll.length===2 && roll[0].turn===0 && roll[1].turn===1);
ok("rollup drops pre-turn samples", rollupByTurn([mk(0,-1,1),...raw]).length===2);

console.log("--- summary text ---");
ok("empty samples -> empty string", summariseSignals([],[])==="");
const summary = summariseSignals(
  [mk(0,0,1),mk(500,0,1),mk(1000,1,0),mk(1500,1,0)],
  ["I built a bus tracking app","um i dont know"]
);
ok("mentions per-turn", summary.includes("Turn 1") && summary.includes("Turn 2"));
ok("quotes what they said", summary.includes("bus tracking app"));
ok("flags the biggest shift", summary.includes("Biggest change") && summary.includes("facing the camera"));
ok("states signals are physical, not emotional", /not emotions/i.test(summary));
ok("no emotion words leak in", !/(anxious|nervous|confident|happy|sad|afraid)/i.test(summary));

console.log("--- fidget is rate-independent ---");
// Same physical movement sampled half as often: twice the travel per step, half
// the steps. The score must not move, or every threshold shifts with the fps.
const walk10 = Array.from({length:11},(_,i)=>({x:0.5+i*0.004,y:0.5}));
const walk20 = Array.from({length:6},(_,i)=>({x:0.5+i*0.008,y:0.5}));
near("100ms and 200ms sampling agree", fidget(walk20,200), fidget(walk10,100), 1e-9);
near("default interval is the nominal one", fidget(walk10), fidget(walk10,FIDGET_NOMINAL_MS), 1e-9);

console.log("--- live read candidates ---");
const good = readCandidates({eyeContactRatio:0.9, openness:0.7, fidget:0.1});
ok("settled reads good across the board",
  good.eyeContact==="good" && good.posture==="good" && good.steady==="good");
const drifted = readCandidates({eyeContactRatio:0.2, openness:0.1, fidget:0.9});
ok("drifted reads attention across the board",
  drifted.eyeContact==="attention" && drifted.posture==="attention" && drifted.steady==="attention");
ok("eye contact needs more than half the window",
  readCandidates({eyeContactRatio:0.56,openness:1,fidget:0}).eyeContact==="good" &&
  readCandidates({eyeContactRatio:0.54,openness:1,fidget:0}).eyeContact==="attention");
ok("sitting up straighter is never a fault",
  readCandidates({eyeContactRatio:1,openness:1,fidget:0}).posture==="good");

console.log("--- status gate (the anti-strobe) ---");
let g = newGate("good");
g = gateStatus(g, "attention", 0);
ok("a new condition does not flip immediately", g.status==="good");
g = gateStatus(g, "attention", STATUS_HOLD_MS - 1);
ok("still holding just before the window closes", g.status==="good");
g = gateStatus(g, "attention", STATUS_HOLD_MS);
ok("flips once the condition has held", g.status==="attention");

// A single stray frame mid-wait must reset the clock, not squeak through.
let h = newGate("good");
h = gateStatus(h, "attention", 0);
h = gateStatus(h, "good", 500);
h = gateStatus(h, "attention", 600);
h = gateStatus(h, "attention", 1000);
ok("a blip resets the waiting period", h.status==="good");
h = gateStatus(h, "attention", 1400);
ok("and it flips once the fresh window closes", h.status==="attention");

// Alternating every frame is exactly the strobe the debounce exists to stop.
let s = newGate("good");
for (let i=0;i<40;i++) s = gateStatus(s, i%2 ? "attention" : "good", i*66);
ok("frame-by-frame flapping never flips the pill", s.status==="good");

let back = newGate("attention");
back = gateStatus(back, "good", 0);
back = gateStatus(back, "good", STATUS_HOLD_MS);
ok("recovering is debounced the same way", back.status==="good");

const steadyGate = newGate("good");
ok("an unchanged gate is returned by identity",
  gateStatus(steadyGate, "good", 500) === steadyGate);

console.log("--- turn arcs ---");
// One turn that starts facing the camera and ends off it, and a second that
// never moves. Nine samples so each third is three.
const drift = [];
for (let i = 0; i < 9; i++) drift.push({
  t: i * 100, turn: 0, facing: i < 3 ? 1 : i < 6 ? 0.5 : 0,
  smile: 0, brow: 0, gazeDown: 0, jawOpen: 0, openness: 0.8, tilt: 0, fidget: 0.1,
});
for (let i = 0; i < 9; i++) drift.push({
  t: 900 + i * 100, turn: 1, facing: 1,
  smile: 0.2, brow: 0, gazeDown: 0, jawOpen: 0, openness: 0.8, tilt: 0, fidget: 0.1,
});
const arcs = turnArcs(drift);
ok("one arc per turn", arcs.length === 2);
near("opens facing", arcs[0].open.facing, 1);
near("closes away", arcs[0].close.facing, 0);
near("the whole turn averages between the two", arcs[0].whole.facing, 5/9);
near("a flat turn opens and closes the same", arcs[1].open.facing - arcs[1].close.facing, 0);
ok("samples before the first turn are dropped",
  turnArcs([{ ...drift[0], turn: -1 }]).length === 0);

// A turn too short to have a shape reports one, not a shape read off two frames.
const stub = turnArcs([drift[0], { ...drift[1], facing: 0 }]);
ok("a very short turn has no arc", stub[0].open.facing === stub[0].close.facing);

console.log("--- the deep read ---");
ok("nothing from no samples", detailSignals([], []) === "");
const detail = detailSignals(drift, ["I built a parser", "Around eight lakh"]);
ok("names the proxies, not the conclusions", /PROXY/.test(detail));
ok("says what it cannot see", /does not track pupils/.test(detail));
ok("shows the arc inside a turn", detail.includes("100% → 0%"));
ok("quotes what was being said", detail.includes("I built a parser"));
ok("too short for a track, so it doesn't fake one",
  !/Track across the whole session/.test(detail));
// The preamble names the emotion words in order to forbid them, so the check
// that matters is on the data itself.
const dataLines = detail.split("\n").filter((l) => /^Turn \d/.test(l));
ok("the per-turn lines are numbers and quotes, nothing else",
  dataLines.length === 2 &&
  !/nervous|anxious|confident|uncomfortable|defensive|seemed/i.test(dataLines.join(" ")));

// A long session must not turn into a thousand rows of prompt.
const long = [];
for (let i = 0; i < 4000; i++) long.push({
  t: i * 66, turn: Math.floor(i / 500), facing: 1,
  smile: 0, brow: 0, gazeDown: 0, jawOpen: 0, openness: 0.7, tilt: 0, fidget: 0.2,
});
const longDetail = detailSignals(long, []);
ok("a long enough session carries a track", /Track across the whole session/.test(longDetail));
const rows = longDetail.split("\n").filter((l) => /^\d+s {2}turn /.test(l));
ok(`and it stays bounded (${rows.length} rows)`, rows.length <= MAX_TRACK_ROWS + 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
