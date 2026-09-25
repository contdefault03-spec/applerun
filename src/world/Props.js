import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getLayout } from '../../shared/map/layout.js';
import { heightAt } from '../../shared/map/terrain.js';

// Instanced props (trees, palms, lamps, furniture, containers, boats...).
// Returns { group, colliders, lampHeads } — colliders are registered by World.
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });

function colored(geo, color) {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}
function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = null) {
  const g = geo.clone();
  if (s) g.scale(...s);
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return colored(g.index ? g.toNonIndexed() : g, color);
}
function instanced(geo, mat, items, place, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const o = new THREE.Object3D();
  items.forEach((it, i) => { place(o, it, i); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
  m.count = items.length;
  m.castShadow = shadow; m.receiveShadow = true;
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

export function buildProps() {
  const L = getLayout();
  const P = L.props;
  const group = new THREE.Group();
  group.name = 'props';
  const colliders = [];
  const vmat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  const y = (x, z) => heightAt(x, z);
  // Trees & palms are built separately (src/world/Trees.js): bark-textured trunks and
  // foliage-atlas canopy cards with wind sway, instead of solid-colour boxes here.

  // Street lamps
  const lampGeo = mergeGeometries([
    part(new THREE.CylinderGeometry(0.08, 0.12, 7, 6), '#3c4146', 0, 3.5, 0),
    part(new THREE.BoxGeometry(0.1, 0.1, 1.8), '#3c4146', 0, 6.95, 0.85),
  ]);
  const lampItems = P.lamps.map((l) => ({ ...l, y: y(l.x, l.z) + 0.14 }));
  const placeLamp = (o, l) => { o.position.set(l.x, l.y, l.z); o.rotation.set(0, l.rot, 0); o.scale.setScalar(1); };
  group.add(instanced(lampGeo, vmat, lampItems, placeLamp));
  const headMat = new THREE.MeshStandardMaterial({ color: '#fff8e1', emissive: '#ffd27a', emissiveIntensity: 0.1 });
  const headGeo = new THREE.BoxGeometry(0.5, 0.18, 0.8);
  headGeo.translate(0, 6.85, 1.6);
  const heads = instanced(headGeo, headMat, lampItems, placeLamp, false);
  heads.userData.lampHeads = true;
  group.add(heads);
  for (const l of lampItems) colliders.push({ kind: 'pole', x: l.x, z: l.z, hx: 0.15, hz: 0.15, rot: 0, y0: l.y - 1, y1: l.y + 7 });

  // Benches
  const benchGeo = mergeGeometries([
    part(new THREE.BoxGeometry(1.8, 0.08, 0.5), '#8d6e4f', 0, 0.45, 0),
    part(new THREE.BoxGeometry(1.8, 0.45, 0.06), '#8d6e4f', 0, 0.75, -0.25),
    part(new THREE.BoxGeometry(0.08, 0.45, 0.45), '#333', -0.8, 0.22, 0),
    part(new THREE.BoxGeometry(0.08, 0.45, 0.45), '#333', 0.8, 0.22, 0),
  ]);
  const benchItems = P.benches.map((b) => ({ ...b, y: 0.16 }));
  group.add(instanced(benchGeo, vmat, benchItems, (o, b) => { o.position.set(b.x, b.y, b.z); o.rotation.set(0, b.rot, 0); o.scale.setScalar(1); }));
  for (const b of benchItems) colliders.push({ kind: 'bench', x: b.x, z: b.z, hx: 0.9, hz: 0.3, rot: b.rot, y0: 0, y1: 0.55, walk: true, seat: true });

  // Hydrants & bins
  const hyd = mergeGeometries([part(new THREE.CylinderGeometry(0.15, 0.18, 0.7, 8), '#c62828', 0, 0.35, 0), part(new THREE.SphereGeometry(0.16, 8, 6), '#c62828', 0, 0.72, 0)]);
  group.add(instanced(hyd, vmat, P.hydrants.map((h) => ({ ...h, y: y(h.x, h.z) + 0.14 })), (o, h) => { o.position.set(h.x, h.y, h.z); o.rotation.set(0, 0, 0); o.scale.setScalar(1); }));
  const bin = part(new THREE.CylinderGeometry(0.3, 0.26, 0.95, 10), '#2e7d32', 0, 0.48, 0);
  group.add(instanced(bin, vmat, P.bins.map((h) => ({ ...h, y: y(h.x, h.z) + 0.14 })), (o, h) => { o.position.set(h.x, h.y, h.z); o.rotation.set(0, 0, 0); o.scale.setScalar(1); }));
  for (const h of [...P.hydrants, ...P.bins]) colliders.push({ kind: 'small', x: h.x, z: h.z, hx: 0.25, hz: 0.25, rot: 0, y0: -1, y1: y(h.x, h.z) + 1 });

  // Containers
  const contCols = ['#c62828', '#1565c0', '#2e7d32', '#ef6c00', '#6a1b9a', '#546e7a'];
  const contGeo = new THREE.BoxGeometry(12, 2.6, 2.45);
  contGeo.translate(0, 1.3, 0);
  const contTex = containerTexture();
  const cmat = new THREE.MeshStandardMaterial({ map: contTex, roughness: 0.7, metalness: 0.3 });
  const contMesh = instanced(contGeo, cmat, P.containers.map((c) => ({ ...c, h: y(c.x, c.z) })), (o, c) => { o.position.set(c.x, c.h + c.y, c.z); o.rotation.set(0, Math.PI / 2, 0); o.scale.setScalar(1); });
  P.containers.forEach((c, i) => contMesh.setColorAt(i, new THREE.Color(contCols[c.c])));
  if (contMesh.instanceColor) contMesh.instanceColor.needsUpdate = true;
  group.add(contMesh);
  // container colliders: one per stack (use max height)
  const stacks = new Map();
  for (const c of P.containers) {
    const k = `${Math.round(c.x)},${Math.round(c.z)}`;
    const top = y(c.x, c.z) + c.y + 2.6;
    if (!stacks.has(k) || stacks.get(k).y1 < top) stacks.set(k, { kind: 'container', x: c.x, z: c.z, hx: 1.25, hz: 6, rot: 0, y0: -1, y1: top, walk: true });
  }
  colliders.push(...stacks.values());

  // Boats
  const hull = mergeGeometries([
    part(new THREE.BoxGeometry(2.4, 1, 7), '#fafafa', 0, 0.2, 0),
    part(new THREE.ConeGeometry(1.2, 2.2, 4, 1), '#fafafa', 0, 0.2, 4.5, Math.PI / 2, Math.PI / 4, 0, [1, 1, 0.8]),
    part(new THREE.BoxGeometry(1.8, 1, 2.6), '#e0e0e0', 0, 1.1, -0.6),
    part(new THREE.BoxGeometry(1.7, 0.4, 2.4), '#263238', 0, 1.4, -0.6),
  ]);
  const boatCols = ['#1e88e5', '#e53935', '#43a047', '#fdd835'];
  const boats = instanced(hull, vmat, P.boats, (o, b) => { o.position.set(b.x, -0.1, b.z); o.rotation.set(0, b.rot, 0); o.scale.setScalar(b.ship ? 6 : b.s); });
  P.boats.forEach((b, i) => boats.setColorAt(i, new THREE.Color(boatCols[b.c]).lerp(new THREE.Color('#ffffff'), 0.6)));
  boats.userData.bob = true;
  group.add(boats);

  // Rocks
  const rock = part(new THREE.DodecahedronGeometry(1, 0), '#7a746b');
  group.add(instanced(rock, vmat, P.rocks.map((r) => ({ ...r, y: y(r.x, r.z) })), (o, r) => { o.position.set(r.x, r.y, r.z); o.rotation.set(r.r, r.r * 2, 0); o.scale.set(r.s, r.s * 0.6, r.s); }));

  // Traffic lights at big intersections
  const tl = [];
  for (const n of L.graph.nodes) {
    if (n.edges.length < 3) continue;
    const types = n.edges.map((e) => L.roads[L.graph.edges[e].road].type);
    if (!types.includes('main') && !types.includes('highway')) continue;
    if (types.some((t) => t === 'mountain')) continue;
    const e0 = L.graph.edges[n.edges[0]];
    const w = L.roads[e0.road].width / 2 + 1.5;
    tl.push({ x: n.x + w, z: n.z + w, node: n.id }, { x: n.x - w, z: n.z - w, node: n.id });
  }
  const tlGeo = mergeGeometries([
    part(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), '#263238', 0, 2.1, 0),
    part(new THREE.BoxGeometry(0.35, 1.0, 0.3), '#1b1b1b', 0, 4.3, 0),
  ]);
  group.add(instanced(tlGeo, vmat, tl.map((t) => ({ ...t, y: y(t.x, t.z) + 0.14 })), (o, t) => { o.position.set(t.x, t.y, t.z); o.rotation.set(0, 0, 0); o.scale.setScalar(1); }));
  for (const t of tl) colliders.push({ kind: 'pole', x: t.x, z: t.z, hx: 0.12, hz: 0.12, rot: 0, y0: -1, y1: y(t.x, t.z) + 4 });

  return { group, colliders, lampItems, trafficLights: tl };
}

function containerTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 32);
  for (let x = 0; x < 128; x += 4) { g.fillStyle = x % 8 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.3)'; g.fillRect(x, 0, 2, 32); }
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, 0, 128, 2); g.fillRect(0, 30, 128, 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
