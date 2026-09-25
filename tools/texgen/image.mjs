// Float image buffers + helpers for offline texture generation (tiling-aware).
import zlib from 'node:zlib';
import fs from 'node:fs';

export class Img {
  constructor(w, h, ch = 1, fill = 0) {
    this.w = w; this.h = h; this.ch = ch;
    this.d = new Float32Array(w * h * ch).fill(fill);
  }
  i(x, y) { x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h; return (y * this.w + x) * this.ch; }
  get(x, y, c = 0) { return this.d[this.i(x, y) + c]; }
  set(x, y, v, c = 0) { this.d[this.i(x, y) + c] = v; }
  /** Run f(u, v, x, y) for every pixel; f returns a number or array. */
  fill(f) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const r = f(x / this.w, y / this.h, x, y), k = (y * this.w + x) * this.ch;
      if (this.ch === 1) this.d[k] = r; else for (let c = 0; c < this.ch; c++) this.d[k + c] = r[c];
    }
    return this;
  }
  /** Alpha-blend a soft round/elliptic brush (wraps around edges). */
  stamp(cx, cy, rx, ry, rot, color, alpha = 1, hardness = 0.6, op = 'mix') {
    const c = Math.cos(rot), s = Math.sin(rot);
    const R = Math.ceil(Math.max(rx, ry)) + 1;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const lx = (dx * c + dy * s) / rx, ly = (-dx * s + dy * c) / ry;
      const d = Math.hypot(lx, ly);
      if (d > 1) continue;
      const a = alpha * (d < hardness ? 1 : 1 - (d - hardness) / (1 - hardness));
      const k = this.i(Math.round(cx + dx), Math.round(cy + dy));
      for (let ch = 0; ch < this.ch; ch++) {
        const v = Array.isArray(color) ? color[ch] : color;
        if (op === 'max') this.d[k + ch] = Math.max(this.d[k + ch], v * a);
        else if (op === 'add') this.d[k + ch] += v * a;
        else this.d[k + ch] += (v - this.d[k + ch]) * a;
      }
    }
  }
  /** Soft stroke between two points. */
  stroke(x0, y0, x1, y1, r, color, alpha = 1, op = 'mix') {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(0.5, r * 0.5)));
    for (let i = 0; i <= n; i++) { const t = i / n; this.stamp(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r, r, 0, color, alpha, 0.5, op); }
  }
}

/** Tangent-space normal map (OpenGL convention, +Y up) from a tileable height map. */
export function normalFromHeight(hImg, strength = 2) {
  const n = new Img(hImg.w, hImg.h, 3);
  for (let y = 0; y < hImg.h; y++) for (let x = 0; x < hImg.w; x++) {
    const dx = (hImg.get(x + 1, y) - hImg.get(x - 1, y)) * strength;
    const dy = (hImg.get(x, y + 1) - hImg.get(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const k = (y * n.w + x) * 3;
    // R = slope along +u (columns), G = along +v (rows; KTX2 rows map to v without flipping)
    n.d[k] = (-dx / l) * 0.5 + 0.5; n.d[k + 1] = (-dy / l) * 0.5 + 0.5; n.d[k + 2] = (1 / l) * 0.5 + 0.5;
  }
  return n;
}

/** Pack float channels (0..1) into an RGBA8 buffer. `srgb` channels are already sRGB colour. */
export function toRGBA8(channels, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 4; c++) {
    const src = channels[c];
    let v = src ? (typeof src === 'number' ? src : src.img.d[i * src.img.ch + src.c]) : 1;
    out[i * 4 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}

// ---- minimal PNG writer (previews)
const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc(buf) { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
export function writePNG(file, rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}
