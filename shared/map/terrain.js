// Heightfield with roads, building pads and landmark pads flattened in.
import { getLayout, rawHeightPx, toPx, WORLD, WATER_LEVEL } from './layout.js';

export const CELL = 2;
let _hf = null;

export function getHeightfield() {
  if (_hf) return _hf;
  const L = getLayout();
  const nx = Math.ceil((WORLD.maxX - WORLD.minX) / CELL) + 1;
  const nz = Math.ceil((WORLD.maxZ - WORLD.minZ) / CELL) + 1;
  const h = new Float32Array(nx * nz);
  const w = new Float32Array(nx * nz); // flatten weight
  const tgt = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = WORLD.minX + i * CELL, z = WORLD.minZ + j * CELL;
      const [px, py] = toPx(x, z);
      h[j * nx + i] = rawHeightPx(px, py);
    }
  }
  const stamp = (x, z, height, weight) => {
    const i = Math.round((x - WORLD.minX) / CELL), j = Math.round((z - WORLD.minZ) / CELL);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return;
    const k = j * nx + i;
    if (weight > w[k]) { w[k] = weight; tgt[k] = height; }
  };
  // Roads
  for (const r of L.roads) {
    const half = r.width / 2 + 1.5, blend = r.type === 'mountain' ? 10 : 6;
    for (let s = 0; s < r.pts.length - 1; s++) {
      const [ax, az] = r.pts[s], [bx, bz] = r.pts[s + 1];
      const ha = r.hs[s], hb = r.hs[s + 1];
      const x0 = Math.min(ax, bx) - half - blend, x1 = Math.max(ax, bx) + half + blend;
      const z0 = Math.min(az, bz) - half - blend, z1 = Math.max(az, bz) + half + blend;
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-6;
      for (let z = Math.floor(z0 / CELL) * CELL; z <= z1; z += CELL) {
        for (let x = Math.floor(x0 / CELL) * CELL; x <= x1; x += CELL) {
          let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
          if (d > half + blend) continue;
          const wt = d <= half ? 1 : 1 - (d - half) / blend;
          stamp(x, z, ha + (hb - ha) * t - 0.08, wt * wt * (3 - 2 * wt));
        }
      }
    }
  }
  // Building pads
  for (const b of L.buildings) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const R = Math.hypot(b.hx, b.hz) + 6;
    for (let z = Math.floor((b.z - R) / CELL) * CELL; z <= b.z + R; z += CELL) {
      for (let x = Math.floor((b.x - R) / CELL) * CELL; x <= b.x + R; x += CELL) {
        const dx = x - b.x, dz = z - b.z;
        const lx = Math.abs(dx * c - dz * s) - b.hx, lz = Math.abs(dx * s + dz * c) - b.hz;
        const d = Math.max(lx, lz);
        if (d > 6) continue;
        const wt = d <= 1 ? 1 : 1 - (d - 1) / 5;
        stamp(x, z, b.base, 0.9 * wt);
      }
    }
  }
  // Landmark pads (flat, at 0)
  for (const key of ['stadium', 'arena', 'dome', 'parkingStadium', 'parkingArena', 'containerYard', 'plazaPark', 'fountainPlaza', 'basketballCourtPark']) {
    const b = L.landmarks[key];
    for (let z = b.z - b.hz - 4; z <= b.z + b.hz + 4; z += CELL) for (let x = b.x - b.hx - 4; x <= b.x + b.hx + 4; x += CELL) stamp(x, z, 0, 1);
  }
  for (let k = 0; k < h.length; k++) if (w[k] > 0) h[k] = h[k] + (tgt[k] - h[k]) * w[k];
  _hf = { nx, nz, h, cell: CELL, minX: WORLD.minX, minZ: WORLD.minZ };
  return _hf;
}

export function heightAt(x, z) {
  const hf = _hf || getHeightfield();
  let fx = (x - hf.minX) / hf.cell, fz = (z - hf.minZ) / hf.cell;
  if (fx < 0) fx = 0; if (fz < 0) fz = 0;
  if (fx > hf.nx - 1.001) fx = hf.nx - 1.001; if (fz > hf.nz - 1.001) fz = hf.nz - 1.001;
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
  const a = hf.h[j * hf.nx + i], b = hf.h[j * hf.nx + i + 1], c = hf.h[(j + 1) * hf.nx + i], d = hf.h[(j + 1) * hf.nx + i + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
}

export function isWaterAt(x, z) {
  return heightAt(x, z) < WATER_LEVEL - 0.05;
}
