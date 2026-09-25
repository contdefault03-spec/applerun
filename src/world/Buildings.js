import * as THREE from 'three';
import { getLayout } from '../../shared/map/layout.js';
import { mulberry32 } from '../../shared/rng.js';
import { facadeTexture, facadeEmissiveRandom, FACADE_STYLES, roofTexture, storefrontTexture, graffitiTexture, signTexture } from './textures.js';

export const TYPE_STYLE = {
  tower: 'glass', office: 'office', apartment: 'apartment', shop: 'shop', restaurant: 'shop', cafe: 'shop', bar: 'rough', nightclub: 'rough', clothing: 'shop',
  house: 'house', villa: 'villa', beach_house: 'villa', safehouse: 'villa', rough_apartment: 'rough', rough_house: 'rough',
  brick_apartment: 'brick', warehouse: 'warehouse', factory: 'warehouse', farmhouse: 'house', cabin: 'cabin', gym: 'warehouse',
  police: 'office', hospital: 'apartment', gunstore: 'shop', taxi_depot: 'shop', garage: 'warehouse', hotel: 'apartment',
};
const PITCHED = new Set(['house', 'farmhouse', 'cabin', 'safehouse', 'rough_house']);
const SIGNS = {
  police: ['POLICE', '#1b3c8f', '#ffffff'], hospital: ['HOSPITAL', '#ffffff', '#d32f2f'], gunstore: ['APPLERUN GUNS', '#2b2b2b', '#ffb300'],
  gym: ['IRON GYM', '#111111', '#ff3d00'], taxi_depot: ['APPLERUN CABS', '#f7c600', '#111111'], garage: ['MOD GARAGE', '#263238', '#00e5ff'],
  cafe: ['CAFE LUNA', '#5d4037', '#ffe0b2'], restaurant: ['DINER', '#b71c1c', '#ffffff'], bar: ['THE RUSTY BAR', '#3e2723', '#ffca28'],
  clothing: ['THREADS', '#6a1b9a', '#ffffff'], shop: ['24/7 MART', '#1b5e20', '#ffffff'], safehouse: ['SAFEHOUSE', '#37474f', '#80cbc4'],
  nightclub: ['NEON CLUB', '#170022', '#ff2fd6'],
  hotel: ['SEABREEZE HOTEL', '#0d3b4a', '#ffd77a'],
};
export const SPECIAL_TINT = { police: '#9fb4e0', hospital: '#ffffff', gunstore: '#8d8d8d', gym: '#9e9e9e' };
// Pastel paint colours for houses/villas (multiplied over the light render/siding wall texture).
const HOUSE_PALETTE = ['#f2e2c4', '#dce8dc', '#e3d3e8', '#f5d6d0', '#cfe0ea', '#eae0c8', '#d8e4d0', '#f0d9b5', '#e8d7c3', '#c9dde0', '#f6e8e8', '#dbe6f0'];

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

// Small projecting balcony (floor slab + railing) on some bays of every upper floor, on the
// building's front (door-facing) side. Each occupied balcony rolls its own small set of details
// (chair, table, plant, laundry line) so neighbouring balconies don't read as identical.
function addBalconies(bucket, b, st, wallCol, rand) {
  const floors = Math.floor(b.h / st.floor);
  if (floors < 2) return;
  const [fx, fz] = b.face;
  const faceLen = fz !== 0 ? b.hx : b.hz;
  const n = Math.max(1, Math.floor((faceLen * 2) / (st.bay * 1.3)));
  const bw = fz !== 0 ? 1.15 : 0.75, bd = fz !== 0 ? 0.75 : 1.15;
  const railCol = wallCol.clone().multiplyScalar(0.62);
  const outx = fx * (b.hx + Math.max(bw, bd) / 2 + 0.02), outz = fz * (b.hz + Math.max(bw, bd) / 2 + 0.02);
  const potCol = new THREE.Color('#8d6e5a'), leafCol = new THREE.Color('#4d8c3c');
  const clothCols = [new THREE.Color('#e8e4da'), new THREE.Color('#c8d6e8'), new THREE.Color('#e0b8a8'), new THREE.Color('#c8c8c8')];
  for (let fl = 1; fl < floors; fl++) {
    const fy = b.base + fl * st.floor - 0.15;
    for (let i = 0; i < n; i++) {
      if (rand() < 0.4) continue; // not every bay gets one
      const t = (i + 0.5) / n - 0.5;
      const cx = (fz !== 0 ? t * faceLen * 1.7 : 0) + outx, cz = (fz === 0 ? t * faceLen * 1.7 : 0) + outz;
      addFlatTop(bucket, b, bw, bd, fy, wallCol, cx, cz);
      addBoxWalls(bucket, b, bw, bd, fy, fy + 0.85, { bay: 2, floor: 0.85 }, railCol, cx, cz);
      // one of a few small furnishing kits, chosen per balcony so layouts vary
      const kit = rand();
      const local = (lx, ly, lz) => { const dx = (fz !== 0 ? lx : 0) + fx * lz, dz = (fz !== 0 ? 0 : lx) + fz * lz; return [cx + dx, fy + ly, cz + dz]; };
      if (kit < 0.3) {
        // chair + small table
        const [tx, ty, tz] = local(0, 0.35, 0);
        addBoxWalls(bucket, b, 0.35, 0.35, fy, fy + 0.4, { bay: 1, floor: 0.4 }, wallCol.clone().multiplyScalar(0.75), tx - cx, tz - cz);
        addFlatTop(bucket, b, 0.35, 0.35, ty + 0.05, wallCol.clone().multiplyScalar(0.9), tx - cx, tz - cz);
        const [chx, , chz] = local(bw * 0.5, 0, bd * 0.3);
        addBoxWalls(bucket, b, 0.3, 0.3, fy, fy + 0.45, { bay: 1, floor: 0.45 }, wallCol.clone().multiplyScalar(0.5), chx - cx, chz - cz);
      } else if (kit < 0.55) {
        // potted plant(s)
        for (const ox of [-0.35, 0.3]) {
          if (rand() < 0.3) continue;
          const [px, , pz] = local(ox, 0, bd * 0.3);
          addBoxWalls(bucket, b, 0.22, 0.22, fy, fy + 0.3, { bay: 1, floor: 0.3 }, potCol, px - cx, pz - cz);
          addFlatTop(bucket, b, 0.28, 0.28, fy + 0.5, leafCol, px - cx, pz - cz);
        }
      } else if (kit < 0.8) {
        // laundry line with a couple of hanging cloths
        const lineCol = clothCols[Math.floor(rand() * clothCols.length)];
        for (const ox of [-0.3, 0, 0.3]) {
          if (rand() < 0.25) continue;
          const [lx, , lz] = local(ox, 0, 0);
          addFlatTop(bucket, b, 0.22, 0.03, fy + 0.65, lineCol, lx - cx, lz - cz);
        }
      }
      // else: bare balcony
    }
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
  const neonMaterials = [];
  const rand = mulberry32(99);
  for (const b of L.buildings) {
    let style = TYPE_STYLE[b.type] || 'office';
    // Houses & villas: paint-colour variety (occasionally brick instead of render), so
    // neighbouring houses don't look identical.
    const isHouseLike = style === 'house' || style === 'villa';
    if (style === 'house' && rand() < 0.3) style = 'brick';
    const st = FACADE_STYLES[style];
    const tintBase = SPECIAL_TINT[b.type];
    if (tintBase) c.set(tintBase);
    else if (isHouseLike && style !== 'brick') {
      c.set(HOUSE_PALETTE[Math.floor(rand() * HOUSE_PALETTE.length)]);
      c.multiplyScalar(0.92 + rand() * 0.12);
    } else {
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
    } else if (PITCHED.has(b.type) && rand() < 0.82) {
      const roofCol = new THREE.Color(['#a4442c', '#7a3b2e', '#4b4f56', '#6d4c35', '#9c5a3c'][Math.floor(rand() * 5)]);
      if (b.type === 'rough_house') roofCol.set('#55504a');
      addGable(roofTiles, B(style), b, b.hx, b.hz, top, Math.min(b.hx, b.hz) * 0.7, roofCol, wallCol, st);
    } else if (PITCHED.has(b.type)) {
      // a fraction of houses get a flat roof + parapet instead of a gable, for shape variety
      addFlatTop(roofFlat, b, b.hx, b.hz, top, c.setRGB(0.58 + rand() * 0.1, 0.56, 0.53));
      addBoxWalls(trims, b, b.hx + 0.1, b.hz + 0.1, top - 0.1, top + 0.45, { bay: 4, floor: 1 }, wallCol.clone().multiplyScalar(0.85));
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
    // Balconies: 3D floor slabs + railings on upper floors of apartments, villas and houses
    if ((style === 'apartment' || isHouseLike) && b.h > st.floor * 1.5) addBalconies(trims, b, st, wallCol, rand);
    // Signs
    const sign = SIGNS[b.type];
    if (sign) {
      const tex = signTexture(sign[0], sign[1], sign[2]);
      const signMat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.15, roughness: 0.5 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), signMat);
      const dx = fz !== 0 ? 0 : fx * (b.hx + 0.12), dz = fz !== 0 ? fz * (b.hz + 0.12) : 0;
      const p = W(dx, b.base + Math.min(b.h - 1, 4.4), dz);
      m.position.set(p[0], p[1], p[2]);
      m.rotation.y = b.rot + Math.atan2(fx, fz);
      m.userData.sign = true;
      signMeshes.push(m);
      neonMaterials.push(signMat);
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
    // Random-lit windows: the emissive map repeats every 4x4 bays instead of every single bay
    // (a separate UV transform from the colour map), so lit windows don't form a uniform grid.
    const emTex = facadeEmissiveRandom(style, 4, 4);
    emTex.repeat.set(0.25, 0.25);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, vertexColors: true, roughness: style === 'glass' ? 0.25 : 0.85, metalness: style === 'glass' ? 0.35 : 0.02,
      emissive: '#ffc877', emissiveMap: emTex, emissiveIntensity: 0,
    });
    if (style === 'glass') {
      // Cheap interior-mapping trick for distant skyscraper windows: each window cell fakes a
      // little room (floor/ceiling gradient, a desk band, a ceiling light strip, an occasional
      // person silhouette) instead of just showing a flat glass-tint gradient.
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec2 cell = fract(vMapUv);
            vec2 wc = (cell - 0.5) / vec2(0.92, 0.9) + 0.5;
            if (wc.x > 0.0 && wc.x < 1.0 && wc.y > 0.0 && wc.y < 1.0) {
              float rid = fract(sin(dot(floor(vMapUv), vec2(41.3, 289.1))) * 4375.5);
              vec3 room = mix(vec3(0.04, 0.045, 0.05), vec3(0.10, 0.095, 0.09), wc.y);
              room = mix(room, vec3(0.22, 0.16, 0.11), step(wc.y, 0.18) * 0.5);
              float ceilLight = smoothstep(0.86, 0.94, wc.y) * step(0.55, fract(rid * 9.1));
              room += ceilLight * vec3(1.0, 0.92, 0.75) * 1.6;
              float px = fract(rid * 5.7);
              float person = (1.0 - smoothstep(0.05, 0.09, abs(wc.x - px))) * step(0.5, fract(rid * 2.3)) * smoothstep(0.0, 0.25, wc.y) * (1.0 - smoothstep(0.25, 0.55, wc.y));
              room = mix(room, vec3(0.015), person);
              diffuseColor.rgb = room;
            }
          }`);
      };
      mat.customProgramCacheKey = () => 'glass-interior-v1';
    }
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
  return { group, windowMaterials: materials, neonMaterials };
}
