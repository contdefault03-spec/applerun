// Heightfield with roads, building pads and landmark pads flattened in.
// The city map (WORLD) sits on an island: past every map edge the land keeps its natural
// shape for a while and then falls off into beaches (low land) or cliffs (high land) and the
// sea floor. The heightfield covers the map plus ISLAND_MARGIN on every side.
import { getLayout, rawHeightPx, toPx, WORLD, WATER_LEVEL } from './layout.js';
import { fbm } from '../rng.js';

export const CELL = 2;
export const ISLAND_MARGIN = 320;
export const HF_BOUNDS = { minX: WORLD.minX - ISLAND_MARGIN, maxX: WORLD.maxX + ISLAND_MARGIN, minZ: WORLD.minZ - ISLAND_MARGIN, maxZ: WORLD.maxZ + ISLAND_MARGIN };
export const SEA_FLOOR = -18;
let _hf = null;

/** Distance (m) of a point outside the map rectangle (0 inside). */
export function outsideDistance(x, z) {
  const dx = Math.max(WORLD.minX - x, 0, x - WORLD.maxX), dz = Math.max(WORLD.minZ - z, 0, z - WORLD.maxZ);
  return Math.hypot(dx, dz);
}

const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

// Height of the island outside the map rectangle. `edgeH` is the (flattened) height at the
// nearest map-edge point, so the terrain is continuous across the map border.
function islandHeight(x, z, edgeH, d) {
  const [px, py] = toPx(x, z);
  if (edgeH < WATER_LEVEL) return Math.max(SEA_FLOOR, Math.min(edgeH, -1.4 - d * 0.045)); // sea keeps getting deeper
  const natural = rawHeightPx(px, py); // continues the mountain / hills beyond the border
  let base = edgeH + (Math.max(natural, 0) - edgeH) * smooth(0, 70, d);
  // low land rolls up into small grassy hills/dunes before dropping to the beach
  const n = fbm(px / 90, py / 90, 3, 41);
  base += (2.5 + 6 * fbm(px / 45, py / 45, 3, 53)) * smooth(8, 70, d) * (1 - smooth(10, 30, base));
  // coastline distance varies along the shore; high land reaches further out to sea
  const C = 90 + n * 90 + Math.max(0, base) * 0.8;
  const cliffy = base > 14 && fbm(px / 60, py / 60, 2, 77) > 0.48;
  const W = cliffy ? 14 : 34 + n * 20;            // width of the beach / cliff face
  const shoreH = cliffy ? -3 : 0.1;
  if (d < C - W) return base;
  if (d < C) return base + (shoreH - base) * smooth(C - W, C, d);
  return Math.max(SEA_FLOOR, shoreH - (d - C) * (cliffy ? 0.35 : 0.07));
}

export function getHeightfield() {
  if (_hf) return _hf;
  const L = getLayout();
  const B = HF_BOUNDS;
  const nx = Math.ceil((B.maxX - B.minX) / CELL) + 1;
  const nz = Math.ceil((B.maxZ - B.minZ) / CELL) + 1;
  const h = new Float32Array(nx * nz);
  const w = new Float32Array(nx * nz); // flatten weight
  const tgt = new Float32Array(nx * nz);
  const inside = (x, z) => x >= WORLD.minX && x <= WORLD.maxX && z >= WORLD.minZ && z <= WORLD.maxZ;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = B.minX + i * CELL, z = B.minZ + j * CELL;
      if (!inside(x, z)) continue;
      const [px, py] = toPx(x, z);
      h[j * nx + i] = rawHeightPx(px, py);
    }
  }
  const stamp = (x, z, height, weight) => {
    const i = Math.round((x - B.minX) / CELL), j = Math.round((z - B.minZ) / CELL);
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
  // Landmark pads (flat, at sea level)
  for (const key of ['stadium', 'arena', 'dome', 'parkingStadium', 'parkingArena', 'containerYard', 'plazaPark', 'fountainPlaza', 'basketballCourtPark']) {
    const b = L.landmarks[key];
    for (let z = b.z - b.hz - 4; z <= b.z + b.hz + 4; z += CELL) for (let x = b.x - b.hx - 4; x <= b.x + b.hx + 4; x += CELL) stamp(x, z, 0, 1);
  }
  // Ski resort: a level plateau cut into the mountainside at whatever height it naturally sits
  // at (not sea level, since it's near the peak)
  {
    const b = L.landmarks.resort;
    const [cpx, cpy] = toPx(b.x, b.z);
    const plateau = rawHeightPx(cpx, cpy);
    for (let z = b.z - b.hz - 8; z <= b.z + b.hz + 8; z += CELL) for (let x = b.x - b.hx - 8; x <= b.x + b.hx + 8; x += CELL) stamp(x, z, plateau, 1);
  }
  for (let k = 0; k < h.length; k++) if (w[k] > 0) h[k] = h[k] + (tgt[k] - h[k]) * w[k];
  // island surroundings (after flattening so the border is continuous)
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = B.minX + i * CELL, z = B.minZ + j * CELL;
      if (inside(x, z)) continue;
      const cx = Math.min(WORLD.maxX, Math.max(WORLD.minX, x)), cz = Math.min(WORLD.maxZ, Math.max(WORLD.minZ, z));
      const ci = Math.round((cx - B.minX) / CELL), cj = Math.round((cz - B.minZ) / CELL);
      h[j * nx + i] = islandHeight(x, z, h[cj * nx + ci], Math.hypot(x - cx, z - cz));
    }
  }
  _hf = { nx, nz, h, cell: CELL, minX: B.minX, minZ: B.minZ };
  return _hf;
}

export function heightAt(x, z) {
  const hf = _hf || getHeightfield();
  if (x < HF_BOUNDS.minX || x > HF_BOUNDS.maxX || z < HF_BOUNDS.minZ || z > HF_BOUNDS.maxZ) return SEA_FLOOR; // open ocean
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
