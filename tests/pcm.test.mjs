import { floatToPcm16, downmix, silence, AVATAR_SAMPLE_RATE } from "../.test-build/pcm.js";

let pass=0, fail=0;
const ok=(n,c)=>{c?pass++:fail++;console.log(`${c?"ok  ":"FAIL"}  ${n}`);};

const read = (buf) => {
  const view = new DataView(buf);
  const out = [];
  for (let i = 0; i < buf.byteLength; i += 2) out.push(view.getInt16(i, true));
  return out;
};

console.log("--- float to pcm16 ---");
ok("two bytes per sample", floatToPcm16(new Float32Array(4)).byteLength === 8);
ok("silence is zeros", read(floatToPcm16(new Float32Array(3))).every((v) => v === 0));
ok("full positive stops short of wrapping", read(floatToPcm16(Float32Array.of(1)))[0] === 32767);
ok("full negative uses the whole range", read(floatToPcm16(Float32Array.of(-1)))[0] === -32768);
// The asymmetry is the point: scaling +1 by 32768 overflows into -32768, which
// is a click at every peak.
ok("a peak never wraps to its opposite", read(floatToPcm16(Float32Array.of(0.9999)))[0] > 0);
ok("anything above 1 is clamped, not wrapped",
  read(floatToPcm16(Float32Array.of(4, -4))).every((v) => v === 32767 || v === -32768));
ok("little-endian", new Uint8Array(floatToPcm16(Float32Array.of(1)))[0] === 0xff);
ok("empty in, empty out", floatToPcm16(new Float32Array(0)).byteLength === 0);

console.log("--- downmix ---");
ok("mono passes through untouched",
  downmix([Float32Array.of(0.5, -0.5)]).length === 2);
ok("stereo averages",
  Array.from(downmix([Float32Array.of(1, 0), Float32Array.of(0, 1)])).every((v) => v === 0.5));
ok("no channels, no samples", downmix([]).length === 0);

console.log("--- the end-of-turn silence ---");
ok("length matches the rate", silence(1000, 16000).byteLength === 16000 * 2);
ok("defaults to the avatar's rate", silence(1000).byteLength === AVATAR_SAMPLE_RATE * 2);
ok("and it is actually silent", read(silence(10)).every((v) => v === 0));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
