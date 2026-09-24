import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getLayout, districtAt } from '../../shared/map/layout.js';
import { roadTexture, sidewalkTexture } from './textures.js';
import { URBAN } from './Collision.js';

// Road ribbons (one merged mesh per road class) + raised sidewalks with curbs.
export function buildRoads() {
  const L = getLayout();
  const group = new THREE.Group();
  group.name = 'roads';
  const byType = { highway: [], main: [], street: [], mountain: [] };
  const walks = [];
  const order = { street: 1, mountain: 1, main: 2, highway: 3 };
  for (const r of L.roads) {
    byType[r.type].push(ribbon(r.pts, r.hs, -r.width / 2, r.width / 2, 0.05 + order[r.type] * 0.012, 12, true));
    if (r.type === 'street' || r.type === 'main') {
      for (const side of [-1, 1]) {
        const segs = sidewalkRuns(r, side, L);
        for (const run of segs) {
          if (run.pts.length < 2) continue;
          const a = side < 0 ? -r.width / 2 - 3.2 : r.width / 2;
          const b = side < 0 ? -r.width / 2 : r.width / 2 + 3.2;
          walks.push(ribbon(run.pts, run.hs, a, b, 0.14, 4, false));
          // curb face
          walks.push(curb(run.pts, run.hs, side * r.width / 2, 0.14));
        }
      }
    }
  }
  for (const [type, geos] of Object.entries(byType)) {
    if (!geos.length) continue;
    const g = mergeGeometries(geos);
    const tex = roadTexture(type);
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 - order[type], polygonOffsetUnits: -2 - order[type] }));
    m.receiveShadow = true;
    m.name = 'road_' + type;
    group.add(m);
  }
  if (walks.length) {
    const g = mergeGeometries(walks);
    const tex = sidewalkTexture();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    m.receiveShadow = true;
    m.name = 'sidewalks';
    group.add(m);
  }
  // Roundabout islands
  for (const r of L.roads) {
    if (!r.closed) continue;
    let cx = 0, cz = 0;
    for (const p of r.pts) { cx += p[0]; cz += p[1]; }
    cx /= r.pts.length; cz /= r.pts.length;
    const rad = Math.hypot(r.pts[0][0] - cx, r.pts[0][1] - cz) - r.width / 2 - 0.3;
    if (rad < 2) continue;
    const island = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad + 0.3, 0.35, 28), new THREE.MeshStandardMaterial({ color: '#5d8f3f', roughness: 1 }));
    island.position.set(cx, r.hs[0] + 0.18, cz);
    island.receiveShadow = true;
    group.add(island);
    const statue = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: '#b8b2a4', roughness: 0.6 }));
    statue.position.set(cx, r.hs[0] + 2.3, cz);
    statue.castShadow = true;
    group.add(statue);
  }
  return group;
}

function ribbon(pts, hs, a, b, lift, vScale, uAcross) {
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), nor = new Float32Array(n * 2 * 3);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(n - 1, i + 1)];
    let tx = q1[0] - q0[0], tz = q1[1] - q0[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz, nz = tx;
    if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const y = hs[i] + lift;
    pos.set([p[0] + nx * a, y, p[1] + nz * a, p[0] + nx * b, y, p[1] + nz * b], i * 6);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    if (uAcross) uv.set([0, acc / vScale, 1, acc / vScale], i * 4);
    else uv.set([0, acc / vScale, (b - a) / vScale, acc / vScale], i * 4);
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function curb(pts, hs, off, h) {
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), nor = new Float32Array(n * 2 * 3);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(n - 1, i + 1)];
    let tx = q1[0] - q0[0], tz = q1[1] - q0[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz, nz = tx;
    if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const x = p[0] + nx * off, z = p[1] + nz * off;
    pos.set([x, hs[i] + 0.02, z, x, hs[i] + h, z], i * 6);
    const s = -Math.sign(off);
    nor.set([nx * s, 0, nz * s, nx * s, 0, nz * s], i * 6);
    uv.set([acc / 4, 0, acc / 4, 0.05], i * 4);
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3, k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// Split a road side into runs of sidewalk, cutting where another road crosses
// and only in urban districts.
function sidewalkRuns(r, side, L) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < r.pts.length; i++) {
    const p = r.pts[i];
    const q0 = r.pts[Math.max(0, i - 1)], q1 = r.pts[Math.min(r.pts.length - 1, i + 1)];
    let tx = q1[0] - q0[0], tz = q1[1] - q0[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const off = r.width / 2 + 1.6;
    const sx = p[0] - tz * side * off, sz = p[1] + tx * side * off;
    const n = L.roadIndex.nearest(sx, sz, 20);
    const blocked = n && n.road !== r && n.edge < 2.0;
    const urban = URBAN.has(districtAt(sx, sz).id);
    if (!blocked && urban) {
      if (!cur) { cur = { pts: [], hs: [] }; runs.push(cur); }
      cur.pts.push(p); cur.hs.push(r.hs[i]);
    } else cur = null;
  }
  return runs;
}
