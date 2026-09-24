import { circleVsObb, rayVsObb } from '../../shared/map/geom.js';
import { heightAt } from '../../shared/map/terrain.js';
import { getLayout, WATER_LEVEL, districtAt } from '../../shared/map/layout.js';

// Spatial hash of oriented-box colliders (+ a small dynamic list for vehicles etc).
// Collider: { x, z, hx, hz, rot, y0, y1, kind, walk?, dynamic? }
const CELL = 16;
const SIDEWALK_W = 3.2;
const SIDEWALK_H = 0.14;
const URBAN = new Set(['downtown', 'midtown', 'redbrick', 'eastside', 'hillcrest', 'beachfront', 'sports', 'industrial']);

export class Collision {
  constructor() {
    this.grid = new Map();
    this.dynamic = new Set();
    this.all = [];
    this.stamp = 0;
    this.layout = getLayout();
  }
  key(i, j) { return i * 73856093 ^ j * 19349663; }
  add(c) {
    c.r = Math.hypot(c.hx, c.hz);
    c._s = 0;
    if (c.dynamic) { this.dynamic.add(c); return c; }
    const i0 = Math.floor((c.x - c.r) / CELL), i1 = Math.floor((c.x + c.r) / CELL);
    const j0 = Math.floor((c.z - c.r) / CELL), j1 = Math.floor((c.z + c.r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = this.key(i, j);
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(c);
    }
    c._cells = [i0, i1, j0, j1];
    this.all.push(c);
    return c;
  }
  remove(c) {
    if (c.dynamic) { this.dynamic.delete(c); return; }
    const [i0, i1, j0, j1] = c._cells || [0, -1, 0, -1];
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.grid.get(this.key(i, j));
      if (a) { const n = a.indexOf(c); if (n >= 0) a.splice(n, 1); }
    }
  }
  query(x, z, r, out = []) {
    out.length = 0;
    const s = ++this.stamp;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = this.grid.get(this.key(i, j));
      if (!a) continue;
      for (const c of a) if (c._s !== s && !c.disabled) { c._s = s; out.push(c); }
    }
    for (const c of this.dynamic) if (!c.disabled && Math.abs(c.x - x) < r + c.r && Math.abs(c.z - z) < r + c.r) out.push(c);
    return out;
  }

  /** Terrain height plus raised sidewalks along urban roads. */
  groundAt(x, z) {
    const h = heightAt(x, z);
    const n = this.layout.roadIndex.nearest(x, z, 12);
    if (n && n.road.type !== 'highway' && n.road.type !== 'mountain') {
      const e = n.d - n.road.width / 2;
      if (e > 0 && e < SIDEWALK_W && URBAN.has(districtAt(x, z).id)) return h + SIDEWALK_H;
    }
    return h;
  }

  /**
   * Move a vertical capsule (feet at pos.y) out of colliders.
   * Returns { ground, hitWall } where ground is the highest walkable surface under the feet.
   */
  resolve(pos, radius, height, stepH = 0.45, ignore = null) {
    let ground = this.groundAt(pos.x, pos.z);
    let hitWall = false;
    const list = this.query(pos.x, pos.z, radius + 1, this._tmp || (this._tmp = []));
    for (let pass = 0; pass < 2; pass++) {
      for (const c of list) {
        if (c === ignore || c.owner === ignore) continue;
        // walkable top?
        if (c.y1 <= pos.y + stepH && c.y1 > ground - 0.01) {
          if (circleVsObb(pos.x, pos.z, 0.01, c)) { ground = Math.max(ground, c.y1); continue; }
          if (c.y1 <= pos.y + 0.05) continue;
        }
        if (c.y1 <= pos.y + stepH || c.y0 >= pos.y + height) continue;
        const push = circleVsObb(pos.x, pos.z, radius, c);
        if (push) { pos.x += push.x; pos.z += push.z; hitWall = true; }
      }
    }
    return { ground, hitWall };
  }

  /** Raycast against colliders (and optionally terrain). dir must be normalized. */
  raycast(o, d, maxDist, { terrain = true, ignore = null, filter = null } = {}) {
    let best = maxDist, hit = null;
    const s = ++this.stamp;
    const step = CELL * 0.5;
    const tested = [];
    for (let t = 0; t <= maxDist + step; t += step) {
      const x = o[0] + d[0] * Math.min(t, maxDist), z = o[2] + d[2] * Math.min(t, maxDist);
      if (t > best + CELL) break;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const a = this.grid.get(this.key(Math.floor(x / CELL) + di, Math.floor(z / CELL) + dj));
        if (!a) continue;
        for (const c of a) {
          if (c._s === s || c.disabled || c === ignore) continue;
          c._s = s;
          if (filter && !filter(c)) continue;
          const th = rayVsObb(o, d, c, best);
          if (th >= 0 && th < best) { best = th; hit = c; }
        }
      }
    }
    void tested;
    for (const c of this.dynamic) {
      if (c.disabled || c === ignore || c.owner === ignore) continue;
      if (filter && !filter(c)) continue;
      const th = rayVsObb(o, d, c, best);
      if (th >= 0 && th < best) { best = th; hit = c; }
    }
    if (terrain) {
      // march the heightfield
      const st = 1.0;
      for (let t = 0; t < best; t += st) {
        const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
        const h = heightAt(x, z);
        if (y < h) { best = Math.max(0, t - st * 0.5); hit = { kind: 'terrain' }; break; }
      }
    }
    return hit ? { t: best, collider: hit, point: [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best] } : null;
  }

  isWater(x, z) { return heightAt(x, z) < WATER_LEVEL - 0.3; }
}

export { URBAN };
