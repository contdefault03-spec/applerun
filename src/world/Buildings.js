import * as THREE from 'three';
import { getLayout } from '../../shared/map/layout.js';
import { mulberry32 } from '../../shared/rng.js';
import { facadeTexture, facadeEmissive, FACADE_STYLES, roofTexture, storefrontTexture, graffitiTexture, signTexture } from './textures.js';

export const TYPE_STYLE = {
  tower: 'glass', office: 'office', apartment: 'apartment', shop: 'shop', restaurant: 'shop', cafe: 'shop', bar: 'rough', clothing: 'shop',
  house: 'house', villa: 'villa', beach_house: 'villa', safehouse: 'villa', rough_apartment: 'rough', rough_house: 'rough',
  brick_apartment: 'brick', warehouse: 'warehouse', factory: 'warehouse', farmhouse: 'house', cabin: 'cabin', gym: 'warehouse',
  police: 'office', hospital: 'apartment', gunstore: 'shop', taxi_depot: 'shop', garage: 'warehouse',
};
const PITCHED = new Set(['house', 'farmhouse', 'cabin', 'safehouse', 'rough_house']);
const SIGNS = {
  police: ['POLICE', '#1b3c8f', '#ffffff'], hospital: ['HOSPITAL', '#ffffff', '#d32f2f'], gunstore: ['BAYVIEW GUNS', '#2b2b2b', '#ffb300'],
  gym: ['IRON GYM', '#111111', '#ff3d00'], taxi_depot: ['BAYVIEW CABS', '#f7c600', '#111111'], garage: ['MOD GARAGE', '#263238', '#00e5ff'],
  cafe: ['CAFE LUNA', '#5d4037', '#ffe0b2'], restaurant: ['DINER', '#b71c1c', '#ffffff'], bar: ['THE RUSTY BAR', '#3e2723', '#ffca28'],
  clothing: ['THREADS', '#6a1b9a', '#ffffff'], shop: ['24/7 MART', '#1b5e20', '#ffffff'], safehouse: ['SAFEHOUSE', '#37474f', '#80cbc4'],
};
export const SPECIAL_TINT = { police: '#9fb4e0', hospital: '#ffffff', gunstore: '#8d8d8d', gym: '#9e9e9e' };

class Bucket {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; }
  quad(a, b, c, d, n, uvs, color) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c, d]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 4; i++) this.nor.push(n[0], n[1], n[2]);
    for (const u of uvs) this.uv.push(u[0], u[1]);
    for (let i = 0; i < 4; i++) this.col.push(color.r, color.g, color.b);
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(a, b, c, n, uvs, color) {
    const base = this.pos.length / 3;
    for (const p of [a, b, c]) this.pos.push(p[0], p[1], p[2]);
    for (let i = 0; i < 3; i++) this.nor.push(n[0], n[1], n[2]);
    for (const u of uvs) this.uv.push(u[0], u[1]);
    for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
    this.idx.push(base, base + 1, base + 2);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

// Box helper: local frame (center x,z, rot) -> world
function frame(b) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return (lx, y, lz) => [b.x + lx * c + lz * s, y, b.z - lx * s + lz * c];
}
function dirW(b, lx, lz) { const c = Math.cos(b.rot), s = Math.sin(b.rot); return [lx * c + lz * s, 0, -lx * s + lz * c]; }

function addBoxWalls(bucket, b, hx, hz, y0, y1, st, color, cx = 0, cz = 0) {
  const W = frame(b);
  const faces = [
    [[-hx, hz], [hx, hz], [0, 1]], [[hx, hz], [hx, -hz], [1, 0]], [[hx, -hz], [-hx, -hz], [0, -1]], [[-hx, -hz], [-hx, hz], [-1, 0]],
  ];
  for (const [[ax, az], [bx, bz], [nx, nz]] of faces) {
    const len = Math.hypot(bx - ax, bz - az);
    const u1 = Math.max(1, Math.round(len / st.bay));
    const v0 = (y0 - b.base) / st.floor, v1 = (y1 - b.base) / st.floor;
    bucket.quad(W(ax + cx, y0, az + cz), W(bx + cx, y0, bz + cz), W(bx + cx, y1, bz + cz), W(ax + cx, y1, az + cz), dirW(b, nx, nz), [[0, v0], [u1, v0], [u1, v1], [0, v1]], color);
  }
}
function addFlatTop(bucket, b, hx, hz, y, color, cx = 0, cz = 0) {
  const W = frame(b);
  bucket.quad(W(-hx + cx, y, hz + cz), W(hx + cx, y, hz + cz), W(hx + cx, y, -hz + cz), W(-hx + cx, y, -hz + cz), [0, 1, 0], [[0, 0], [hx / 4, 0], [hx / 4, hz / 4], [0, hz / 4]], color);
}
function addGable(bucket, wallBucket, b, hx, hz, y, rise, color, wallColor, st) {
  const W = frame(b);
  const o = 0.6; // overhang
  const alongX = hx >= hz;
  if (alongX) {
    const A = W(-hx - o, y, -hz - o), B = W(hx + o, y, -hz - o), C = W(hx + o, y + rise, 0), D = W(-hx - o, y + rise, 0);
    const E = W(-hx - o, y, hz + o), F = W(hx + o, y, hz + o);
    const s1 = dirW(b, 0, -1), s2 = dirW(b, 0, 1);
    bucket.quad(A, B, C, D, [s1[0] * 0.7, 0.7, s1[2] * 0.7], [[0, 0], [hx / 2, 0], [hx / 2, hz / 3], [0, hz / 3]], color);
    bucket.quad(F, E, D, C, [s2[0] * 0.7, 0.7, s2[2] * 0.7], [[0, 0], [hx / 2, 0], [hx / 2, hz / 3], [0, hz / 3]], color);
    // gable ends
    wallBucket.tri(W(-hx, y, -hz), W(-hx, y, hz), W(-hx, y + rise, 0), dirW(b, -1, 0), [[0, 0], [hz * 2 / st.bay, 0], [hz / st.bay, rise / st.floor]], wallColor);
    wallBucket.tri(W(hx, y, hz), W(hx, y, -hz), W(hx, y + rise, 0), dirW(b, 1, 0), [[0, 0], [hz * 2 / st.bay, 0], [hz / st.bay, rise / st.floor]], wallColor);
  } else {
    const A = W(-hx - o, y, hz + o), B = W(-hx - o, y, -hz - o), C = W(0, y + rise, -hz - o), D = W(0, y + rise, hz + o);
    const E = W(hx + o, y, hz + o), F = W(hx + o, y, -hz - o);
    const s1 = dirW(b, -1, 0), s2 = dirW(b, 1, 0);
    bucket.quad(A, B, C, D, [s1[0] * 0.7, 0.7, s1[2] * 0.7], [[0, 0], [hz / 2, 0], [hz / 2, hx / 3], [0, hx / 3]], color);
    bucket.quad(F, E, D, C, [s2[0] * 0.7, 0.7, s2[2] * 0.7], [[0, 0], [hz / 2, 0], [hz / 2, hx / 3], [0, hx / 3]], color);
    wallBucket.tri(W(hx, y, -hz), W(-hx, y, -hz), W(0, y + rise, -hz), dirW(b, 0, -1), [[0, 0], [hx * 2 / st.bay, 0], [hx / st.bay, rise / st.floor]], wallColor);
    wallBucket.tri(W(-hx, y, hz), W(hx, y, hz), W(0, y + rise, hz), dirW(b, 0, 1), [[0, 0], [hx * 2 / st.bay, 0], [hx / st.bay, rise / st.floor]], wallColor);
  }
}

export function buildBuildings() {
  const L = getLayout();
  const group = new THREE.Group();
  group.name = 'buildings';
  const buckets = {};
  const B = (k) => (buckets[k] ??= new Bucket());
  const roofTiles = new Bucket(), roofFlat = new Bucket(), doors = new Bucket(), storefronts = new Bucket(), trims = new Bucket();
  const c = new THREE.Color();
  const materials = [];
  const signMeshes = [];
  const rand = mulberry32(99);
  for (const b of L.buildings) {
    const style = TYPE_STYLE[b.type] || 'office';
    const st = FACADE_STYLES[style];
    const tintBase = SPECIAL_TINT[b.type];
    if (tintBase) c.set(tintBase);
    else {
      const t = 0.82 + rand() * 0.18;
      c.setRGB(t * (0.95 + rand() * 0.08), t * (0.95 + rand() * 0.06), t * (0.95 + rand() * 0.08));
    }
    const wallCol = c.clone();
    const y0 = b.base - 3, top = b.base + b.h;
    const setback = b.type === 'tower' && b.h > 70 && rand() < 0.6;
    const lowerTop = setback ? b.base + b.h * 0.7 : top;
    addBoxWalls(B(style), b, b.hx, b.hz, y0, lowerTop, st, wallCol);
    if (setback) {
      const sx = b.hx * 0.72, sz = b.hz * 0.72;
      addBoxWalls(B(style), b, sx, sz, lowerTop, top, st, wallCol);
      addFlatTop(roofFlat, b, b.hx, b.hz, lowerTop, c.setRGB(0.55, 0.55, 0.53));
      addFlatTop(roofFlat, b, sx, sz, top, c.setRGB(0.5, 0.5, 0.5));
    } else if (PITCHED.has(b.type)) {
      const roofCol = new THREE.Color(['#a4442c', '#7a3b2e', '#4b4f56', '#6d4c35', '#9c5a3c'][Math.floor(rand() * 5)]);
      if (b.type === 'rough_house') roofCol.set('#55504a');
      addGable(roofTiles, B(style), b, b.hx, b.hz, top, Math.min(b.hx, b.hz) * 0.7, roofCol, wallCol, st);
    } else {
      addFlatTop(roofFlat, b, b.hx, b.hz, top, c.setRGB(0.52 + rand() * 0.1, 0.52, 0.5));
      // parapet trim
      addBoxWalls(trims, b, b.hx + 0.15, b.hz + 0.15, top - 0.2, top + 0.6, { bay: 4, floor: 1 }, c.setRGB(0.42, 0.42, 0.42));
      // rooftop units
      if (b.h > 14) {
        const n = 1 + Math.floor(rand() * 3);
        for (let i = 0; i < n; i++) {
          const ux = (rand() - 0.5) * b.hx * 1.2, uz = (rand() - 0.5) * b.hz * 1.2;
          const sub = { ...b, x: frame(b)(ux, 0, uz)[0], z: frame(b)(ux, 0, uz)[2], base: top };
          const s = 1 + rand() * 2;
          addBoxWalls(trims, sub, s, s * 0.7, top, top + 1.2 + rand() * 2, { bay: 4, floor: 1 }, c.setRGB(0.62, 0.63, 0.64));
          addFlatTop(roofFlat, sub, s, s * 0.7, top + 1.4, c.setRGB(0.5, 0.5, 0.52));
        }
      }
    }
    // Door
    const W = frame(b);
    const [fx, fz] = b.face;
    const dw = b.type === 'warehouse' || b.type === 'factory' || b.type === 'garage' ? 3.2 : 1.3;
    const dh = b.type === 'warehouse' || b.type === 'factory' || b.type === 'garage' ? 3.6 : 2.3;
    const off = 0.06;
    let pA, pB, n;
    if (fz !== 0) { const z = fz * (b.hz + off); pA = [-dw * fz, z]; pB = [dw * fz, z]; }
    else { const x = fx * (b.hx + off); pA = [x, dw * fx]; pB = [x, -dw * fx]; }
    n = dirW(b, fx, fz);
    doors.quad(W(pA[0], b.base, pA[1]), W(pB[0], b.base, pB[1]), W(pB[0], b.base + dh, pB[1]), W(pA[0], b.base + dh, pA[1]), n, [[0, 0], [1, 0], [1, 1], [0, 1]], c.set(b.special ? '#2c2622' : '#3e3a36'));
    // Storefront band on commercial ground floors
    if (['shop', 'restaurant', 'cafe', 'clothing', 'gunstore', 'bar', 'office', 'tower'].includes(b.type) && b.h > 6) {
      const hw = fz !== 0 ? b.hx : b.hz;
      const sOff = 0.04;
      let a1, a2;
      if (fz !== 0) { const z = fz * (b.hz + sOff); a1 = [-hw * fz, z]; a2 = [hw * fz, z]; }
      else { const x = fx * (b.hx + sOff); a1 = [x, hw * fx]; a2 = [x, -hw * fx]; }
      storefronts.quad(W(a1[0], b.base, a1[1]), W(a2[0], b.base, a2[1]), W(a2[0], b.base + 3.4, a2[1]), W(a1[0], b.base + 3.4, a1[1]), n, [[0, 0], [hw * 2 / 8, 0], [hw * 2 / 8, 1], [0, 1]], c.setRGB(1, 1, 1));
    }
    // Signs
    const sign = SIGNS[b.type];
    if (sign) {
      const tex = signTexture(sign[0], sign[1], sign[2]);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.25, roughness: 0.5 }));
      const dx = fz !== 0 ? 0 : fx * (b.hx + 0.12), dz = fz !== 0 ? fz * (b.hz + 0.12) : 0;
      const p = W(dx, b.base + Math.min(b.h - 1, 4.4), dz);
      m.position.set(p[0], p[1], p[2]);
      m.rotation.y = b.rot + Math.atan2(fx, fz);
      m.userData.sign = true;
      signMeshes.push(m);
    }
  }
  // Graffiti decals
  const gGroups = {};
  for (const g of L.props.graffiti) {
    const b = L.buildings[g.b];
    const W = frame(b);
    const side = [[0, 1], [1, 0], [0, -1], [-1, 0]][g.v % 4];
    const lx = side[0] * (b.hx + 0.05), lz = side[1] * (b.hz + 0.05);
    const p = W(lx * (side[0] ? 1 : 0.4 + 0), b.base + 1.6, lz);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.2), (gGroups[g.v % 6] ??= new THREE.MeshStandardMaterial({ map: graffitiTexture(g.v % 6), transparent: true, alphaTest: 0.1, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 })));
    m.position.set(p[0], p[1], p[2]);
    m.rotation.y = b.rot + Math.atan2(side[0], side[1]);
    signMeshes.push(m);
  }
  for (const [style, bucket] of Object.entries(buckets)) {
    const tex = facadeTexture(style);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, vertexColors: true, roughness: style === 'glass' ? 0.25 : 0.85, metalness: style === 'glass' ? 0.35 : 0.02,
      emissive: '#ffc877', emissiveMap: facadeEmissive(style), emissiveIntensity: 0,
    });
    materials.push(mat);
    const mesh = new THREE.Mesh(bucket.geometry(), mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = 'facade_' + style;
    group.add(mesh);
  }
  const roofTex = roofTexture('tiles');
  const addB = (bucket, mat, name, shadow = true) => {
    if (!bucket.pos.length) return;
    const m = new THREE.Mesh(bucket.geometry(), mat);
    m.castShadow = shadow; m.receiveShadow = true; m.name = name;
    group.add(m);
  };
  addB(roofTiles, new THREE.MeshStandardMaterial({ map: roofTex, vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), 'roofTiles');
  addB(roofFlat, new THREE.MeshStandardMaterial({ map: roofTexture('flat'), vertexColors: true, roughness: 0.95 }), 'roofFlat');
  addB(trims, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 'trims');
  addB(doors, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }), 'doors', false);
  addB(storefronts, new THREE.MeshStandardMaterial({ map: storefrontTexture(), roughness: 0.3, metalness: 0.2, emissive: '#fff2cc', emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -1 }), 'storefronts', false);
  const sf = group.getObjectByName('storefronts');
  if (sf) materials.push(sf.material);
  for (const m of signMeshes) group.add(m);
  return { group, windowMaterials: materials };
}
