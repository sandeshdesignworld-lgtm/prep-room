import {
  matrixLayout, rotationMatrix, headAngles, isFacing, faceSignals,
  shoulderWidth, shoulderTilt, openness, fidget, nudgeLevel,
  downsample, rollupByTurn, summariseSignals,
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
