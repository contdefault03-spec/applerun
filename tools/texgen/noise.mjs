// Tileable noise helpers for offline texture generation (all functions wrap at `period`).
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const mod = (a, n) => ((a % n) + n) % n;

/** Value noise on a lattice of `period` cells across the unit square (u,v in [0,1)). */
export function vnoise(u, v, period, seed = 0) {
  const x = u * period, y = v * period;
  const xi = Math.floor(x), yi = Math.floor(y);
  const tx = fade(x - xi), ty = fade(y - yi);
  const x0 = mod(xi, period), x1 = mod(xi + 1, period), y0 = mod(yi, period), y1 = mod(yi + 1, period);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed), c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

export function fbm(u, v, period, oct = 5, seed = 0, gain = 0.5) {
  let s = 0, amp = 0.5, n = 0, p = period;
  for (let i = 0; i < oct; i++) { s += amp * vnoise(u, v, p, seed + i * 31); n += amp; amp *= gain; p *= 2; }
  return s / n;
}

export function ridged(u, v, period, oct = 5, seed = 0) {
  let s = 0, amp = 0.5, n = 0, p = period;
  for (let i = 0; i < oct; i++) { const r = 1 - Math.abs(vnoise(u, v, p, seed + i * 17) * 2 - 1); s += amp * r * r; n += amp; amp *= 0.5; p *= 2; }
  return s / n;
}

/** Tileable Worley noise: returns {f1, f2, id} with `cells` feature points per axis. */
export function worley(u, v, cells, seed = 0) {
  const x = u * cells, y = v * cells;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const wx = mod(cx, cells), wy = mod(cy, cells);
    const px = cx + hash2(wx, wy, seed), py = cy + hash2(wx, wy, seed + 7);
    const d = Math.hypot(px - x, py - y);
    if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, seed + 13); } else if (d < f2) f2 = d;
  }
  return { f1, f2, id };
}

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

/** Deterministic PRNG. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
