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

  // Traffic lights at big intersections: one pole per approach group (0 = the road direction
  // of the node's first edge, 1 = the perpendicular one), so each pair of opposite corners
  // shows the same red/amber/green state — matching how Traffic.js's lightGreen() groups cars.
  const tl = [];
  for (const n of L.graph.nodes) {
    if (n.edges.length < 3) continue;
    const types = n.edges.map((e) => L.roads[L.graph.edges[e].road].type);
    if (!types.includes('main') && !types.includes('highway')) continue;
    if (types.some((t) => t === 'mountain')) continue;
    const e0 = L.graph.edges[n.edges[0]];
    const w = L.roads[e0.road].width / 2 + 1.5;
    tl.push({ x: n.x + w, z: n.z + w, node: n.id, group: 0 }, { x: n.x - w, z: n.z - w, node: n.id, group: 0 });
    tl.push({ x: n.x + w, z: n.z - w, node: n.id, group: 1 }, { x: n.x - w, z: n.z + w, node: n.id, group: 1 });
  }
  const tlGeo = mergeGeometries([
    part(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), '#263238', 0, 2.1, 0),
    part(new THREE.BoxGeometry(0.35, 1.0, 0.3), '#1b1b1b', 0, 4.3, 0),
  ]);
  const tlItems = tl.map((t) => ({ ...t, y: y(t.x, t.z) + 0.14 }));
  const placeTl = (o, t) => { o.position.set(t.x, t.y, t.z); o.rotation.set(0, 0, 0); o.scale.setScalar(1); };
  group.add(instanced(tlGeo, vmat, tlItems, placeTl));
  // signal head: a small emissive box whose colour Traffic.js updates every frame (red/amber/green)
  const headMat2 = new THREE.MeshStandardMaterial({ color: '#c62828', emissive: '#c62828', emissiveIntensity: 1.4 });
  const tlHeadGeo = new THREE.BoxGeometry(0.32, 0.32, 0.14);
  tlHeadGeo.translate(0, 4.32, 0.16);
  const tlHeads = instanced(tlHeadGeo, headMat2, tlItems, placeTl, false);
  tlHeads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(tlItems.length * 3), 3);
  tlHeads.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const red = new THREE.Color('#c62828');
  for (let i = 0; i < tlItems.length; i++) red.toArray(tlHeads.instanceColor.array, i * 3);
  tlHeads.instanceColor.needsUpdate = true;
  tlHeads.userData.trafficHeads = true;
  group.add(tlHeads);
  for (const t of tl) colliders.push({ kind: 'pole', x: t.x, z: t.z, hx: 0.12, hz: 0.12, rot: 0, y0: -1, y1: y(t.x, t.z) + 4 });

  // Bollards
  const bollGeo = mergeGeometries([
    part(new THREE.CylinderGeometry(0.09, 0.1, 0.85, 8), '#2b2f33', 0, 0.42, 0),
    part(new THREE.CylinderGeometry(0.095, 0.095, 0.1, 8), '#f2c94c', 0, 0.55, 0),
  ]);
  const bollItems = P.bollards.map((b) => ({ ...b, y: y(b.x, b.z) + 0.14 }));
  group.add(instanced(bollGeo, vmat, bollItems, (o, b) => { o.position.set(b.x, b.y, b.z); o.rotation.set(0, 0, 0); o.scale.setScalar(1); }));
  for (const b of bollItems) colliders.push({ kind: 'small', x: b.x, z: b.z, hx: 0.12, hz: 0.12, rot: 0, y0: -1, y1: b.y + 0.85 });

  // Bike racks (three U-hoops on a base rail)
  const hoop = (ox) => [
    part(new THREE.TorusGeometry(0.28, 0.03, 6, 10, Math.PI), '#455a64', ox, 0.55, 0, Math.PI / 2, 0, Math.PI / 2),
  ];
  const rackGeo = mergeGeometries([
    part(new THREE.BoxGeometry(1.6, 0.06, 0.06), '#37474f', 0, 0.05, 0),
    ...hoop(-0.55), ...hoop(0), ...hoop(0.55),
  ]);
  const rackItems = P.bikeRacks.map((b) => ({ ...b, y: y(b.x, b.z) + 0.14 }));
  group.add(instanced(rackGeo, vmat, rackItems, (o, b) => { o.position.set(b.x, b.y, b.z); o.rotation.set(0, b.rot, 0); o.scale.setScalar(1); }));
  for (const b of rackItems) colliders.push({ kind: 'small', x: b.x, z: b.z, hx: 0.85, hz: 0.35, rot: b.rot, y0: -1, y1: b.y + 0.6 });

  // Bus stops: pole + sign flag + a simple shelter (roof + back panel + bench)
  const busGeo = mergeGeometries([
    part(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), '#37474f', -0.9, 1.2, 0),
    part(new THREE.BoxGeometry(0.42, 0.3, 0.05), '#1565c0', -0.9, 2.15, 0),
    part(new THREE.BoxGeometry(2.0, 0.08, 1.1), '#78909c', 0, 2.3, 0.4),
    part(new THREE.BoxGeometry(2.0, 1.6, 0.05), '#b0bec5', 0.9, 1.1, 0.95, 0, 0, 0),
    part(new THREE.BoxGeometry(1.6, 0.08, 0.4), '#8d6e4f', 0, 0.45, 0.55),
  ]);
  const busItems = P.busStops.map((b) => ({ ...b, y: y(b.x, b.z) + 0.14 }));
  group.add(instanced(busGeo, vmat, busItems, (o, b) => { o.position.set(b.x, b.y, b.z); o.rotation.set(0, b.rot, 0); o.scale.setScalar(1); }));
  for (const b of busItems) colliders.push({ kind: 'bench', x: b.x, z: b.z, hx: 1.0, hz: 0.6, rot: b.rot, y0: 0, y1: 2.3, walk: true });

  // Street signs (stop-sign style octagon on a pole) at minor junctions
  const signGeo = mergeGeometries([
    part(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), '#78838a', 0, 1.2, 0),
    part(new THREE.CylinderGeometry(0.26, 0.26, 0.04, 8), '#c62828', 0, 2.35, 0, Math.PI / 2, 0, 0),
  ]);
  const signItems = P.signs.map((s) => ({ ...s, y: y(s.x, s.z) + 0.14 }));
  group.add(instanced(signGeo, vmat, signItems, (o, s) => { o.position.set(s.x, s.y, s.z); o.rotation.set(0, s.rot, 0); o.scale.setScalar(1); }));
  for (const s of signItems) colliders.push({ kind: 'pole', x: s.x, z: s.z, hx: 0.1, hz: 0.1, rot: 0, y0: -1, y1: s.y + 2.4 });

  // Garden fences (low picket rail, gap left at the door side by the layout)
  const fenceGeo = new THREE.BoxGeometry(1, 1.0, 0.07);
  fenceGeo.translate(0.5, 0.5, 0);
  const fenceItems = P.fences.map((f) => {
    const dx = f.x2 - f.x1, dz = f.z2 - f.z1, len = Math.hypot(dx, dz);
    return { x: f.x1, z: f.z1, len, rot: Math.atan2(dx, dz), y: y(f.x1, f.z1) + 0.1 };
  });
  group.add(instanced(fenceGeo, M('#e8e4da'), fenceItems, (o, f) => { o.position.set(f.x, f.y, f.z); o.rotation.set(0, f.rot, 0); o.scale.set(f.len, 1, 1); }, false));
  for (const f of fenceItems) colliders.push({ kind: 'small', x: f.x + Math.sin(f.rot) * f.len / 2, z: f.z + Math.cos(f.rot) * f.len / 2, hx: Math.abs(Math.sin(f.rot)) * f.len / 2 + 0.1, hz: Math.abs(Math.cos(f.rot)) * f.len / 2 + 0.1, rot: 0, y0: f.y - 1, y1: f.y + 1 });

  // ATMs (a wall-mounted-looking box with a lit screen) outside banks and some shops
  const atmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
  const atmGeo = mergeGeometries([
    part(new THREE.BoxGeometry(0.6, 1.3, 0.35), '#37474f', 0, 0.65, 0),
    part(new THREE.BoxGeometry(0.4, 0.28, 0.02), '#1b5e20', 0, 0.95, 0.18),
  ]);
  const atmItems = (P.atms || []).map((a) => ({ ...a, y: y(a.x, a.z) + 0.14 }));
  group.add(instanced(atmGeo, atmMat, atmItems, (o, a) => { o.position.set(a.x, a.y, a.z); o.rotation.set(0, a.rot, 0); o.scale.setScalar(1); }));
  for (const a of atmItems) colliders.push({ kind: 'small', x: a.x, z: a.z, hx: 0.3, hz: 0.2, rot: a.rot, y0: -1, y1: a.y + 1.3 });

  return { group, colliders, lampItems, trafficLights: tl, trafficHeads: tlHeads };
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
