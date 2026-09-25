import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getLayout, districtAt } from '../../shared/map/layout.js';
import { roadTexture, sidewalkTexture } from './textures.js';
import { URBAN } from './Collision.js';
import { createRoadMaterial, createPlanarMaterial } from './RoadMaterial.js';

// Roads: PBR asphalt ribbons with procedural lane markings, concrete kerbs, paved sidewalks,
// zebra crossings + stop lines at urban junctions, manholes and kerbside drains, and planted
// medians down the middle of urban main roads (boulevards).
const KIND = { highway: 0, main: 1, street: 2, mountain: 3 };
const ORDER = { street: 1, mountain: 1, main: 2, highway: 3 };
const KERB_W = 0.25, KERB_H = 0.14, WALK_W = 3.2, MEDIAN_HW = 1.2;

export function buildRoads(tex = null) {
  const L = getLayout();
  const group = new THREE.Group();
  group.name = 'roads';
  const byType = { highway: [], main: [], street: [], mountain: [] };
  const walks = [], kerbs = [], medians = [], medianGrass = [];
  const medianTrees = [], medianColliders = [];
  const urbanNode = (n) => n.edges.length >= 3 && URBAN.has(districtAt(n.x, n.z).id);
  const junctions = L.graph.nodes.filter((n) => n.edges.length >= 3);
  const nearJunction = (x, z, r) => junctions.some((n) => Math.hypot(n.x - x, n.z - z) < r);
  for (const r of L.roads) {
    const pts = resample(r.pts, r.hs, 3);
    // paint mask: no markings where another road overlaps (inside junctions)
    const mask = pts.p.map(([x, z]) => {
      for (const n of junctions) { const d = Math.hypot(n.x - x, n.z - z); if (d < r.width * 0.5 + 2.5) { const other = L.roadIndex.nearest(x, z, 4); if (other && other.road !== r) return 0; } }
      return 1;
    });
    const hasMedian = r.type === 'main' && URBAN.has(districtAt(pts.p[Math.floor(pts.p.length / 2)][0], pts.p[Math.floor(pts.p.length / 2)][1]).id);
    byType[r.type].push(ribbon(pts.p, pts.h, -r.width / 2, r.width / 2, 0.05 + ORDER[r.type] * 0.012, { kind: KIND[r.type], width: r.width, median: hasMedian ? 1 : 0, mask }));
    if (r.type === 'street' || r.type === 'main') {
      for (const side of [-1, 1]) {
        for (const run of sidewalkRuns(r, side, L)) {
          if (run.pts.length < 2) continue;
          const rs = resample(run.pts, run.hs, 4);
          const e0 = side * r.width / 2, e1 = side * (r.width / 2 + KERB_W), e2 = side * (r.width / 2 + WALK_W);
          kerbs.push(ribbon(rs.p, rs.h, Math.min(e0, e1), Math.max(e0, e1), KERB_H + 0.01, null));
          kerbs.push(wall(rs.p, rs.h, e0, 0.03, KERB_H + 0.01, -side));
          walks.push(ribbon(rs.p, rs.h, Math.min(e1, e2), Math.max(e1, e2), KERB_H, null));
        }
      }
    }
    // boulevard median: kerbed grass strip, broken at junctions
    if (hasMedian) {
      let run = null;
      const runs = [];
      pts.p.forEach((p, i) => {
        if (nearJunction(p[0], p[1], r.width * 0.5 + 16)) { run = null; return; }
        if (!run) runs.push((run = { p: [], h: [] }));
        run.p.push(p); run.h.push(pts.h[i]);
      });
      for (const m of runs) {
        if (m.p.length < 3) continue;
        medians.push(wall(m.p, m.h, -MEDIAN_HW, 0.03, KERB_H + 0.02, -1), wall(m.p, m.h, MEDIAN_HW, 0.03, KERB_H + 0.02, 1));
        medianGrass.push(ribbon(m.p, m.h, -MEDIAN_HW, MEDIAN_HW, KERB_H + 0.02, null));
        let acc = 6;
        for (let i = 1; i < m.p.length; i++) {
          const [ax, az] = m.p[i - 1], [bx, bz] = m.p[i];
          const seg = Math.hypot(bx - ax, bz - az);
          acc += seg;
          if (acc >= 13) { acc = 0; medianTrees.push({ x: bx, z: bz, y: m.h[i] + KERB_H, kind: 'median' }); }
          const c = { kind: 'median', x: (ax + bx) / 2, z: (az + bz) / 2, hx: MEDIAN_HW, hz: seg / 2 + 0.05, rot: Math.atan2(bx - ax, bz - az), y0: -1, y1: Math.max(m.h[i - 1], m.h[i]) + 0.3, noCamera: true };
          medianColliders.push(c);
        }
      }
    }
  }
  // ---- asphalt
  const roadMat = tex?.asphalt ? createRoadMaterial(tex.asphalt) : null;
  for (const [type, geos] of Object.entries(byType)) {
    if (!geos.length) continue;
    const g = mergeGeometries(geos);
    let m;
    if (roadMat) {
      const mat = roadMat.clone(); mat.onBeforeCompile = roadMat.onBeforeCompile; mat.customProgramCacheKey = roadMat.customProgramCacheKey;
      mat.polygonOffsetFactor = -1 - ORDER[type]; mat.polygonOffsetUnits = -2 - ORDER[type];
      m = new THREE.Mesh(g, mat);
    } else {
      m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: roadTexture(type), roughness: 0.92, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 - ORDER[type], polygonOffsetUnits: -2 - ORDER[type] }));
    }
    m.receiveShadow = true;
    m.name = 'road_' + type;
    group.add(m);
  }
  // ---- sidewalks, kerbs, medians
  const pave = tex?.pavement ? createPlanarMaterial(tex.pavement, 2.4) : new THREE.MeshStandardMaterial({ map: sidewalkTexture(), roughness: 0.9 });
  const conc = tex?.concrete ? createPlanarMaterial(tex.concrete, 1.6) : new THREE.MeshStandardMaterial({ color: '#b5b0a6', roughness: 0.9 });
  conc.side = THREE.DoubleSide;
  const grassMat = tex?.grass ? createPlanarMaterial(tex.grass, 3.2) : new THREE.MeshStandardMaterial({ color: '#4d7a33', roughness: 1 });
  const addMerged = (geos, mat, name) => {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.receiveShadow = true; m.name = name;
    group.add(m);
  };
  addMerged(walks, pave, 'sidewalks');
  addMerged([...kerbs, ...medians], conc, 'kerbs');
  addMerged(medianGrass, grassMat, 'medianGrass');
  // ---- zebra crossings + stop lines at urban junctions
  const paint = [];
  for (const n of L.graph.nodes) {
    if (!urbanNode(n)) continue;
    let maxW = 0;
    for (const eid of n.edges) maxW = Math.max(maxW, L.graph.edges[eid].width);
    for (const eid of n.edges) {
      const e = L.graph.edges[eid];
      if (L.roads[e.road].type === 'highway' || L.roads[e.road].type === 'mountain') continue;
      const pts = e.a === n.id ? e.pts : [...e.pts].reverse();
      const at = pointAlong(pts, maxW / 2 + 2.2);
      if (!at) continue;
      const h = L.roads[e.road].hs ? sampleH(L.roads[e.road], at.x, at.z) : 0;
      const W = e.width;
      // stripes run along the road: 0.5 m wide, 0.5 m gaps, 3 m long, across the full width
      for (let o = -W / 2 + 0.6; o <= W / 2 - 0.6; o += 1.0) paint.push(quad(at.x + at.nx * o, at.z + at.nz * o, h + 0.1, at.tx, at.tz, 3.0, 0.5));
      // stop line across the lane arriving at the junction (right-hand traffic)
      const sx = at.x - at.tx * 2.1, sz = at.z - at.tz * 2.1;
      paint.push(quad(sx - at.nx * W * 0.25, sz - at.nz * W * 0.25, h + 0.1, at.tx, at.tz, 0.45, W * 0.5 - 0.4));
    }
  }
  if (paint.length) {
    const m = new THREE.Mesh(mergeGeometries(paint), new THREE.MeshStandardMaterial({ color: '#d8d8d2', roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -8 }));
    m.receiveShadow = true; m.name = 'crossings';
    group.add(m);
  }
  // ---- manholes (road centre-ish) and drains (kerbside)
  if (tex?.street) {
    const parts = [];
    let k = 0;
    for (const r of L.roads) {
      if (r.type !== 'street' && r.type !== 'main') continue;
      const pts = resample(r.pts, r.hs, 3);
      for (let i = 4; i < pts.p.length - 4; i++) {
        const [x, z] = pts.p[i], [x2, z2] = pts.p[i + 1];
        let tx = x2 - x, tz = z2 - z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
        const nx = -tz, nz = tx;
        if (!URBAN.has(districtAt(x, z).id) || nearJunction(x, z, r.width + 4)) continue;
        k++;
        if (k % 15 === 0) parts.push(disc(x + nx * (r.width * 0.25), z + nz * (r.width * 0.25), pts.h[i] + 0.11, 0.38, [0, 0, 0.5, 1]));
        if (k % 9 === 4) for (const s of [-1, 1]) parts.push(quad(x + nx * s * (r.width / 2 - 0.3), z + nz * s * (r.width / 2 - 0.3), pts.h[i] + 0.11, tx, tz, 0.9, 0.4, [0.5, 0, 1, 1]));
      }
    }
    if (parts.length) {
      const mat = new THREE.MeshStandardMaterial({ map: tex.street.ar, normalMap: tex.street.n, roughness: 0.7, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -9 });
      const m = new THREE.Mesh(mergeGeometries(parts), mat);
      m.receiveShadow = true; m.name = 'streetParts';
      group.add(m);
    }
  }
  // Roundabout islands
  for (const r of L.roads) {
    if (!r.closed) continue;
    let cx = 0, cz = 0;
    for (const p of r.pts) { cx += p[0]; cz += p[1]; }
    cx /= r.pts.length; cz /= r.pts.length;
    const rad = Math.hypot(r.pts[0][0] - cx, r.pts[0][1] - cz) - r.width / 2 - 0.3;
    if (rad < 2) continue;
    const island = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad + 0.3, 0.35, 28), grassMat);
    island.position.set(cx, r.hs[0] + 0.18, cz);
    island.receiveShadow = true;
    group.add(island);
    const statue = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 4, 8), new THREE.MeshStandardMaterial({ color: '#b8b2a4', roughness: 0.6 }));
    statue.position.set(cx, r.hs[0] + 2.3, cz);
    statue.castShadow = true;
    group.add(statue);
    medianTrees.push({ x: cx + rad * 0.6, z: cz, y: r.hs[0] + 0.35, kind: 'median' }, { x: cx - rad * 0.6, z: cz, y: r.hs[0] + 0.35, kind: 'median' });
  }
  return { group, medianTrees, colliders: medianColliders };
}

// ---------------------------------------------------------------- geometry helpers
/** Resample a polyline so no segment is longer than `step` metres. */
function resample(pts, hs, step) {
  const p = [pts[0]], h = [hs[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) { const t = k / n; p.push([ax + (bx - ax) * t, az + (bz - az) * t]); h.push(hs[i - 1] + (hs[i] - hs[i - 1]) * t); }
  }
  return { p, h };
}

function frame(pts, i) {
  const n = pts.length;
  const q0 = pts[Math.max(0, i - 1)], q1 = pts[Math.min(n - 1, i + 1)];
  let tx = q1[0] - q0[0], tz = q1[1] - q0[1];
  const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
  return { tx, tz, nx: -tz, nz: tx };
}

/** Flat strip between lateral offsets a..b. With `info` it carries road attributes. */
function ribbon(pts, hs, a, b, lift, info) {
  const n = pts.length;
  const pos = new Float32Array(n * 6), nor = new Float32Array(n * 6), uv = new Float32Array(n * 4);
  const rUv = info ? new Float32Array(n * 4) : null, rInfo = info ? new Float32Array(n * 8) : null;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], f = frame(pts, i);
    if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const y = hs[i] + lift;
    pos.set([p[0] + f.nx * a, y, p[1] + f.nz * a, p[0] + f.nx * b, y, p[1] + f.nz * b], i * 6);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    uv.set([0, acc / 4, (b - a) / 4, acc / 4], i * 4);
    if (info) {
      rUv.set([0, acc, 1, acc], i * 4);
      const m = info.mask ? info.mask[i] : 1; // 0 inside junctions: no paint
      rInfo.set([info.kind, info.width, info.median, m, info.kind, info.width, info.median, m], i * 8);
    }
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } // counter-clockwise from above
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (info) { g.setAttribute('roadUv', new THREE.BufferAttribute(rUv, 2)); g.setAttribute('roadInfo', new THREE.BufferAttribute(rInfo, 4)); }
  g.setIndex(idx);
  return g;
}

/** Vertical face at lateral offset `off` from y0 to y1 above the road, facing `face` (±1 = side). */
function wall(pts, hs, off, y0, y1, face) {
  const n = pts.length;
  const pos = new Float32Array(n * 6), nor = new Float32Array(n * 6), uv = new Float32Array(n * 4);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i], f = frame(pts, i);
    if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    const x = p[0] + f.nx * off, z = p[1] + f.nz * off;
    pos.set([x, hs[i] + y0, z, x, hs[i] + y1, z], i * 6);
    nor.set([f.nx * face, 0, f.nz * face, f.nx * face, 0, f.nz * face], i * 6);
    uv.set([acc / 4, 0, acc / 4, 0.05], i * 4);
  }
  const idx = [];
  for (let i = 0; i < n - 1; i++) { const k = i * 2; if (face > 0) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Flat quad centred at (x,y,z): `len` along (tx,tz), `wid` across. */
function quad(x, z, y, tx, tz, len, wid, uvRect = [0, 0, 1, 1]) {
  const nx = -tz, nz = tx, a = len / 2, b = wid / 2;
  const P = [[-a, -b], [a, -b], [a, b], [-a, b]].map(([u, v]) => [x + tx * u + nx * v, y, z + tz * u + nz * v]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P.flat()), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  const [u0, v0, u1, v1] = uvRect;
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]), 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

function disc(x, z, y, r, uvRect) {
  const seg = 16, pos = [x, y, z], uv = [(uvRect[0] + uvRect[2]) / 2, (uvRect[1] + uvRect[3]) / 2], idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pos.push(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
    uv.push(uv[0] + Math.cos(a) * (uvRect[2] - uvRect[0]) * 0.47, uv[1] + Math.sin(a) * (uvRect[3] - uvRect[1]) * 0.47);
    if (i > 0) idx.push(0, i + 1, i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  return g;
}

/** Point `d` metres along a polyline, with tangent (tx,tz) and normal (nx,nz). */
function pointAlong(pts, d) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const l = Math.hypot(bx - ax, bz - az);
    if (acc + l >= d) {
      const t = (d - acc) / l, tx = (bx - ax) / l, tz = (bz - az) / l;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, tx, tz, nx: -tz, nz: tx };
    }
    acc += l;
  }
  return null;
}

function sampleH(road, x, z) {
  let best = 0, bd = Infinity;
  road.pts.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; best = road.hs[i]; } });
  return best;
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
