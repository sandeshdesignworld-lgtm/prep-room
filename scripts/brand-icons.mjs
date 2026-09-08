/**
 * Builds every icon the app ships from one supplied artwork file.
 *
 * The brand artwork arrives as opaque PNG: a black line-drawn head, coral
 * sound waves, on white. That is exactly right for a home screen icon, which
 * is an opaque square whatever we do, and exactly wrong inside the app, where
 * a white tile on the dark theme reads as a hole in the page.
 *
 * So the mark is lifted off its background here, and drawn twice: once in the
 * ink of the light theme, once in the ink of the dark one. The coral survives
 * both, because it is the one colour that carries the brand.
 *
 * Run: node scripts/brand-icons.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "assets/brand");
const OUT = path.join(ROOT, "public/icons");

/** Theme ink, straight from globals.css. Light is --ink, dark is --ink. */
/** The brand coral, so the waves come out the palette colour exactly. */
const CORAL = [0xf2, 0x6a, 0x4b];

const INK_LIGHT = [0x1e, 0x24, 0x30];
const INK_DARK = [0xf2, 0xf4, 0xf7];

/* ------------------------------- decoding -------------------------------- */

/** Minimal PNG reader: 8-bit RGB or RGBA, no interlacing. Enough for ours. */
function readPng(file) {
  const buf = fs.readFileSync(file);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf[24];
  const colour = buf[25];
  if (depth !== 8 || (colour !== 2 && colour !== 6)) {
    throw new Error(`${path.basename(file)}: expected 8-bit RGB or RGBA`);
  }
  const channels = colour === 6 ? 4 : 3;

  // Concatenate every IDAT before inflating: encoders are free to split them.
  const parts = [];
  let at = 8;
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    if (type === "IDAT") parts.push(buf.subarray(at + 8, at + 8 + len));
    if (type === "IEND") break;
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));

  // Undo the per-scanline filters. Each row is prefixed with its filter type.
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = channels === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return { width, height, data: out };
}

/* ------------------------------- encoding -------------------------------- */

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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

function writePng(img, file) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  const rows = Buffer.alloc(img.height * (img.width * 4 + 1));
  for (let y = 0; y < img.height; y++) {
    rows[y * (img.width * 4 + 1)] = 0;
    img.data.copy(
      rows,
      y * (img.width * 4 + 1) + 1,
      y * img.width * 4,
      (y + 1) * img.width * 4,
    );
  }
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(rows, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
  return file;
}

/* ------------------------------ transforms ------------------------------- */

function blank(size, fill = [0, 0, 0, 0]) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { width: size, height: size, data };
}

/** Box-filter resize. The source is far larger than any target, so this is ample. */
function resize(img, w, h) {
  const out = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      const y0 = Math.floor(y * sy);
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const s = (yy * img.width + xx) * 4;
          const al = img.data[s + 3];
          // Weight colour by alpha so transparent pixels do not drag the
          // edges toward black, which is what makes a naive resize look grimy.
          r += img.data[s] * al;
          g += img.data[s + 1] * al;
          b += img.data[s + 2] * al;
          a += al;
          n++;
        }
      }
      const d = (y * h + x) * 4 + (x - x) /* keep index arithmetic explicit */;
      const idx = (y * w + x) * 4;
      void d;
      out.data[idx] = a ? Math.round(r / a) : 0;
      out.data[idx + 1] = a ? Math.round(g / a) : 0;
      out.data[idx + 2] = a ? Math.round(b / a) : 0;
      out.data[idx + 3] = Math.round(a / n);
    }
  }
  return out;
}

/** Paste `src` into `dst` at a scale, centred. */
function centre(dst, src, fraction) {
  const size = Math.round(dst.width * fraction);
  const small = resize(src, size, size);
  const off = Math.round((dst.width - size) / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const d = ((y + off) * dst.width + (x + off)) * 4;
      const a = small.data[s + 3] / 255;
      if (!a) continue;
      for (let c = 0; c < 3; c++) {
        dst.data[d + c] = Math.round(small.data[s + c] * a + dst.data[d + c] * (1 - a));
      }
      dst.data[d + 3] = Math.max(dst.data[d + 3], small.data[s + 3]);
    }
  }
  return dst;
}

/**
 * Lift the mark off its white background and recolour the line work.
 *
 * The artwork is two inks on white: near-black strokes and coral waves.
 * Whiteness becomes transparency, and every pixel that is not coral is
 * repainted in the theme's ink, so the same drawing reads correctly on a
 * white page and on a near-black one.
 */
function liftAndInk(img, ink) {
  const out = { width: img.width, height: img.height, data: Buffer.alloc(img.data.length) };
  // Every pixel in the artwork is some coverage of one ink over white:
  //   seen = a * ink + (1 - a) * white
  // so the coverage is recovered by measuring the darkest channel against how
  // dark that ink goes at full strength. Coral only reaches 0x46, so dividing
  // by 255 the way black would allow is what made the waves come out ghostly.
  const coverage = (min, floor) => Math.max(0, Math.min(255, Math.round(((255 - min) * 255) / (255 - floor))));
  const CORAL_FLOOR = 0x46;

  for (let i = 0; i < img.width * img.height; i++) {
    const r = img.data[i * 4];
    const g = img.data[i * 4 + 1];
    const b = img.data[i * 4 + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    // Coral is the only strongly saturated thing in the artwork, so saturation
    // alone separates the waves from the head without hunting for exact hex.
    const saturated = max - min > 40;
    const d = i * 4;
    if (saturated) {
      out.data[d] = CORAL[0];
      out.data[d + 1] = CORAL[1];
      out.data[d + 2] = CORAL[2];
      out.data[d + 3] = coverage(min, CORAL_FLOOR);
    } else {
      out.data[d] = ink[0];
      out.data[d + 1] = ink[1];
      out.data[d + 2] = ink[2];
      out.data[d + 3] = coverage(min, 0);
    }
  }
  return out;
}

/* --------------------------------- run ----------------------------------- */

fs.mkdirSync(OUT, { recursive: true });
const made = [];

// The home screen icons are the supplied artwork at the sizes it was supplied
// in. An opaque square is what these are meant to be, so nothing is lifted.
for (const [from, to] of [
  ["icon-32.png", "favicon-32.png"],
  ["icon-180.png", "apple-touch-icon.png"],
  ["icon-192-2.png", "app-192.png"],
  ["icon-512-2.png", "app-512.png"],
]) {
  fs.copyFileSync(path.join(SRC, from), path.join(OUT, to));
  made.push(to);
}

const master = readPng(path.join(SRC, "icon-512-2.png"));

// Maskable: Android crops this to whatever shape the launcher fancies, so the
// mark is held inside the safe circle with white run to the edges.
made.push(
  path.basename(
    writePng(
      centre(blank(512, [0xff, 0xff, 0xff, 0xff]), liftAndInk(master, INK_LIGHT), 0.62),
      path.join(OUT, "maskable-512.png"),
    ),
  ),
);

// The in-app mark, on nothing, in each theme's ink.
made.push(
  path.basename(
    writePng(resize(liftAndInk(master, INK_LIGHT), 256, 256), path.join(OUT, "mark-light.png")),
  ),
  path.basename(
    writePng(resize(liftAndInk(master, INK_DARK), 256, 256), path.join(OUT, "mark-dark.png")),
  ),
);

console.log(`wrote ${made.length} files to public/icons:\n  ${made.join("\n  ")}`);
