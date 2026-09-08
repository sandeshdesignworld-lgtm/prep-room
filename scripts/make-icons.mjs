/**
 * Draws the app icons, so they are never out of step with the palette.
 *
 * There is no image library here and none is worth adding for four files, so
 * this writes the PNGs itself: a coral tile with the P mark, rendered at four
 * times the target size and averaged down, which is where the smooth edges come
 * from. Run it with `npm run icons` after changing a brand colour.
 *
 * Two shapes of icon, and the difference matters. The plain one is drawn to its
 * own edges. The maskable one is drawn inside the middle 80%, because Android
 * crops these to whatever shape the launcher fancies, and a mark drawn to the
 * edge comes back with its corners shaved off.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import path from "node:path";

/** Straight from globals.css. The only place these are repeated. */
const CORAL = [0xf2, 0x6a, 0x4b];
const PAGE = [0xf7, 0xf8, 0xfa];
const WHITE = [0xff, 0xff, 0xff];

const SS = 4; // supersampling factor
const OUT = path.join(process.cwd(), "public/icons");

/** One 8-bit RGBA image, drawn into by the helpers below. */
function canvas(size) {
  return { size, px: new Uint8ClampedArray(size * size * 4) };
}

function put(img, x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= img.size || y >= img.size) return;
  const i = (y * img.size + x) * 4;
  img.px[i] = r;
  img.px[i + 1] = g;
  img.px[i + 2] = b;
  img.px[i + 3] = a;
}

/** Rounded rectangle, filled. */
function roundedRect(img, x0, y0, w, h, radius, colour) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = Math.max(x0 + radius - x, x - (x0 + w - 1 - radius), 0);
      const dy = Math.max(y0 + radius - y, y - (y0 + h - 1 - radius), 0);
      if (dx * dx + dy * dy <= radius * radius) put(img, x, y, colour);
    }
  }
}

/** Filled circle, used for the bowl of the P. */
function disc(img, cx, cy, r, colour) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) put(img, x, y, colour);
    }
  }
}

function rect(img, x0, y0, w, h, colour) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(img, x, y, colour);
}

/**
 * The mark: a stem and a bowl, drawn as geometry rather than set as type.
 * A letterform built from a rectangle and two circles is a logotype at this
 * size, and it needs no font file to exist.
 */
function drawP(img, box, colour, background) {
  const { x, y, w, h } = box;
  const stroke = Math.round(w * 0.24);
  // A capital P's bowl is a D, not a circle. Drawn as a rounded rectangle with
  // a radius of half its own height, so the right side is a true semicircle and
  // the top and bottom run flat into the stem. A disc here reads as a
  // lowercase p, which is what the first attempt at this did.
  const bowlH = Math.round(h * 0.56);
  roundedRect(img, x, y, w, bowlH, Math.round(bowlH / 2), colour);
  // The counter, punched back to the tile colour underneath.
  const inner = bowlH - stroke * 2;
  roundedRect(img, x + stroke, y + stroke, w - stroke * 2, inner, Math.round(inner / 2), background);
  // Stem last, so it covers the bowl's rounded left corners and the two meet
  // square, the way the letter does.
  rect(img, x, y, stroke, h, colour);
}

/** Averages the supersampled buffer down to the target size. */
function downsample(img, target) {
  const out = canvas(target);
  const n = SS * SS;
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * img.size + (x * SS + sx)) * 4;
          r += img.px[i]; g += img.px[i + 1]; b += img.px[i + 2]; a += img.px[i + 3];
        }
      }
      const o = (y * target + x) * 4;
      out.px[o] = r / n; out.px[o + 1] = g / n; out.px[o + 2] = b / n;
      out.px[o + 3] = a / n;
    }
  }
  return out;
}

/* ------------------------------ PNG encoding ----------------------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function toPng(img) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.size, 0);
  ihdr.writeUInt32BE(img.size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  // Each scanline is prefixed with its filter type; 0 is "none".
  const raw = Buffer.alloc(img.size * (img.size * 4 + 1));
  let p = 0;
  for (let y = 0; y < img.size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < img.size * 4; x++) raw[p++] = img.px[y * img.size * 4 + x];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -------------------------------- the icons ------------------------------ */

function build({ size, maskable, background, mark }) {
  const s = size * SS;
  const img = canvas(s);
  if (maskable) {
    // Edge to edge: the launcher owns the shape, so the colour must reach the
    // corners or they come back transparent.
    rect(img, 0, 0, s, s, background);
  } else {
    roundedRect(img, 0, 0, s, s, Math.round(s * 0.22), background);
  }
  // 80% safe zone on maskable, a normal optical margin otherwise.
  const inset = maskable ? 0.30 : 0.24;
  const w = Math.round(s * (1 - inset * 2) * 0.72);
  const h = Math.round(s * (1 - inset * 2));
  drawP(img, { x: Math.round((s - w) / 2), y: Math.round((s - h) / 2), w, h }, mark, background);
  return downsample(img, size);
}

await mkdir(OUT, { recursive: true });

const icons = [
  { file: "app-192.png", size: 192, maskable: false, background: CORAL, mark: WHITE },
  { file: "app-512.png", size: 512, maskable: false, background: CORAL, mark: WHITE },
  { file: "maskable-512.png", size: 512, maskable: true, background: CORAL, mark: WHITE },
  // iOS puts its own rounded mask on, and shows the icon on light and dark
  // home screens alike, so it is drawn square and solid rather than rounded.
  { file: "apple-touch-icon.png", size: 180, maskable: true, background: CORAL, mark: WHITE },
];

for (const spec of icons) {
  const png = toPng(build(spec));
  await writeFile(path.join(OUT, spec.file), png);
  console.log(`icons: ${spec.file.padEnd(22)} ${spec.size}x${spec.size}  ${(png.length / 1024).toFixed(1)}kB`);
}

// A plain tile for the browser tab, where the mark is too small to read.
const favicon = build({ size: 32, maskable: true, background: CORAL, mark: WHITE });
await writeFile(path.join(OUT, "favicon-32.png"), toPng(favicon));
console.log("icons: favicon-32.png         32x32");
console.log(`icons: page colour ${PAGE.map((n) => n.toString(16).padStart(2, "0")).join("")} used for the manifest background`);
