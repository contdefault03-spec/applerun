import * as THREE from 'three';

// Low-poly furniture prefabs. Each returns { obj, boxes: [{x,z,hx,hz,h,walk?}], seats: [{x,z,rot,y,kind}], uses: [...] }
// in the prefab's local frame (origin on the floor, facing +Z).
const mats = new Map();
export const mat = (c, o = {}) => {
  const k = c + JSON.stringify(o);
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: c, roughness: 0.75, ...o }));
  return mats.get(k);
};
function box(g, w, h, d, c, x, y, z, o = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof c === 'string' ? mat(c, o) : c);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  g.add(m); return m;
}
function cyl(g, r1, r2, h, c, x, y, z, seg = 12, o = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), mat(c, o));
  m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
}
const R = (seed) => { let s = seed || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

export const Prefabs = {
  sofa(color = '#6b4f3a') {
    const g = new THREE.Group();
    box(g, 2.2, 0.45, 0.9, color, 0, 0.3, 0);
    box(g, 2.2, 0.55, 0.22, color, 0, 0.75, -0.34);
    box(g, 0.22, 0.35, 0.9, color, -1.0, 0.6, 0); box(g, 0.22, 0.35, 0.9, color, 1.0, 0.6, 0);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 1.1, hz: 0.45, h: 0.55, walk: true }], seats: [{ x: -0.5, z: 0.1, rot: 0, y: 0.5 }, { x: 0.5, z: 0.1, rot: 0, y: 0.5 }] };
  },
  armchair(color = '#7a5c48') {
    const g = new THREE.Group();
    box(g, 0.9, 0.45, 0.85, color, 0, 0.3, 0); box(g, 0.9, 0.55, 0.2, color, 0, 0.75, -0.33);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.45, hz: 0.42, h: 0.55, walk: true }], seats: [{ x: 0, z: 0.1, rot: 0, y: 0.5 }] };
  },
  bed(color = '#3f6ea8') {
    const g = new THREE.Group();
    box(g, 1.7, 0.4, 2.1, '#6d4c41', 0, 0.2, 0);
    box(g, 1.6, 0.22, 2.0, '#f2f2ee', 0, 0.5, 0);
    box(g, 1.62, 0.1, 1.3, color, 0, 0.62, 0.35);
    box(g, 0.6, 0.14, 0.35, '#ffffff', -0.4, 0.68, -0.72); box(g, 0.6, 0.14, 0.35, '#ffffff', 0.4, 0.68, -0.72);
    box(g, 1.7, 0.9, 0.1, '#5d4037', 0, 0.6, -1.05);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.85, hz: 1.05, h: 0.65, walk: true }], seats: [{ x: 0, z: -0.1, rot: Math.PI, y: 0.7, kind: 'bed' }] };
  },
  table(w = 1.4, d = 0.9, color = '#8d6e63') {
    const g = new THREE.Group();
    box(g, w, 0.06, d, color, 0, 0.75, 0);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(g, 0.06, 0.75, 0.06, color, sx * (w / 2 - 0.06), 0.37, sz * (d / 2 - 0.06));
    return { obj: g, boxes: [{ x: 0, z: 0, hx: w / 2, hz: d / 2, h: 0.78, walk: true }] };
  },
  chair(color = '#5d4037') {
    const g = new THREE.Group();
    box(g, 0.45, 0.05, 0.45, color, 0, 0.45, 0); box(g, 0.45, 0.5, 0.05, color, 0, 0.72, -0.2);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(g, 0.04, 0.45, 0.04, color, sx * 0.19, 0.22, sz * 0.19);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.23, hz: 0.23, h: 0.47, walk: true }], seats: [{ x: 0, z: 0.05, rot: 0, y: 0.45 }] };
  },
  tv() {
    const g = new THREE.Group();
    box(g, 1.6, 0.5, 0.45, '#3e2723', 0, 0.25, 0);
    const screen = box(g, 1.3, 0.75, 0.06, '#111', 0, 0.95, 0);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.66), new THREE.MeshStandardMaterial({ color: '#223', emissive: '#3a7bd5', emissiveIntensity: 0.6 }));
    glow.position.set(0, 0.95, 0.035); g.add(glow);
    void screen;
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.8, hz: 0.23, h: 1.3 }], uses: [{ x: 0, z: 0.8, kind: 'tv', label: 'Watch TV', target: glow }] };
  },
  kitchen(len = 3) {
    const g = new THREE.Group();
    box(g, len, 0.9, 0.62, '#eceff1', 0, 0.45, 0);
    box(g, len, 0.05, 0.66, '#37474f', 0, 0.92, 0);
    box(g, len, 0.7, 0.35, '#eceff1', 0, 2.0, -0.13);
    box(g, 0.7, 1.9, 0.7, '#cfd8dc', len / 2 + 0.4, 0.95, 0);
    cyl(g, 0.22, 0.22, 0.02, '#90a4ae', -len / 4, 0.95, 0.05, 16, { metalness: 0.8 });
    return { obj: g, boxes: [{ x: 0.2, z: 0, hx: len / 2 + 0.75, hz: 0.35, h: 1.9 }], uses: [{ x: len / 2 + 0.4, z: 0.8, kind: 'fridge', label: 'Grab a snack (+health)' }] };
  },
  bookshelf() {
    const g = new THREE.Group();
    box(g, 1.2, 2, 0.35, '#6d4c41', 0, 1, 0);
    const cols = ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#6a1b9a', '#ef6c00'];
    for (let s = 0; s < 4; s++) for (let i = 0; i < 7; i++) box(g, 0.12, 0.35, 0.25, cols[(s * 3 + i) % cols.length], -0.45 + i * 0.15, 0.3 + s * 0.48, 0.03);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.6, hz: 0.18, h: 2 }] };
  },
  plant() {
    const g = new THREE.Group();
    cyl(g, 0.2, 0.16, 0.35, '#8d6e63', 0, 0.17, 0);
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), mat('#2e7d32')); f.position.y = 0.75; g.add(f);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.2, hz: 0.2, h: 0.4 }] };
  },
  rug(w = 2.4, d = 1.6, color = '#8e3b46') {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(color)); m.rotation.x = -Math.PI / 2; m.position.y = 0.01; m.receiveShadow = true; g.add(m);
    return { obj: g, boxes: [] };
  },
  desk() {
    const r = Prefabs.table(1.5, 0.75, '#b0bec5');
    box(r.obj, 0.5, 0.35, 0.05, '#111', 0, 1.0, -0.2);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3), new THREE.MeshStandardMaterial({ color: '#123', emissive: '#4fc3f7', emissiveIntensity: 0.5 }));
    scr.position.set(0, 1.0, -0.17); r.obj.add(scr);
    const ch = Prefabs.chair('#263238'); ch.obj.position.set(0, 0, 0.6); ch.obj.rotation.y = Math.PI; r.obj.add(ch.obj);
    r.seats = [{ x: 0, z: 0.6, rot: Math.PI, y: 0.45 }];
    r.boxes.push({ x: 0, z: 0.6, hx: 0.23, hz: 0.23, h: 0.47, walk: true });
    r.uses = [{ x: 0, z: 0.9, kind: 'computer', label: 'Use computer' }];
    return r;
  },
  shelf(len = 3, seed = 1) {
    const g = new THREE.Group();
    const rnd = R(seed);
    box(g, len, 1.8, 0.5, '#cfd8dc', 0, 0.9, 0);
    const cols = ['#e53935', '#fdd835', '#43a047', '#1e88e5', '#fb8c00', '#8e24aa', '#ffffff'];
    for (let s = 0; s < 4; s++) for (let x = -len / 2 + 0.15; x < len / 2 - 0.1; x += 0.22) if (rnd() < 0.85) box(g, 0.16, 0.2 + rnd() * 0.12, 0.2, cols[Math.floor(rnd() * cols.length)], x, 0.25 + s * 0.42, 0.18);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: len / 2, hz: 0.28, h: 1.8 }] };
  },
  counter(len = 3, color = '#795548') {
    const g = new THREE.Group();
    box(g, len, 1.05, 0.7, color, 0, 0.52, 0);
    box(g, len + 0.1, 0.06, 0.8, '#263238', 0, 1.07, 0);
    box(g, 0.4, 0.25, 0.35, '#37474f', len / 2 - 0.4, 1.23, 0);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: len / 2, hz: 0.38, h: 1.1 }] };
  },
  gunrack(models = []) {
    const g = new THREE.Group();
    box(g, 3.2, 2.2, 0.15, '#4e342e', 0, 1.3, 0);
    models.forEach((m, i) => { const c = m.clone(); c.scale.multiplyScalar(1.2); c.rotation.set(0, Math.PI / 2, 0); c.position.set(-1.2 + (i % 4) * 0.8, 0.8 + Math.floor(i / 4) * 0.7, 0.15); g.add(c); });
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 1.6, hz: 0.12, h: 2.2 }] };
  },
  cell() {
    const g = new THREE.Group();
    for (let i = 0; i < 12; i++) cyl(g, 0.03, 0.03, 2.6, '#90a4ae', -1.5 + i * 0.27, 1.3, 1.5, 6, { metalness: 0.8, roughness: 0.3 });
    box(g, 3.2, 0.1, 3.1, '#b0bec5', 0, 2.6, 0);
    box(g, 1.8, 0.45, 0.8, '#9e9e9e', 0, 0.22, -1.0);
    return { obj: g, boxes: [{ x: -0.95, z: 1.5, hx: 0.65, hz: 0.06, h: 2.6 }, { x: 1.15, z: 1.5, hx: 0.45, hz: 0.06, h: 2.6 }, { x: 0, z: -1.0, hx: 0.9, hz: 0.4, h: 0.45, walk: true }], seats: [{ x: 0, z: -1.0, rot: 0, y: 0.45 }] };
  },
  hospitalBed() {
    const g = new THREE.Group();
    box(g, 1.0, 0.6, 2.1, '#eceff1', 0, 0.3, 0, { metalness: 0.4 });
    box(g, 0.95, 0.15, 2.0, '#ffffff', 0, 0.68, 0);
    box(g, 0.9, 0.1, 1.2, '#81d4fa', 0, 0.78, 0.35);
    cyl(g, 0.02, 0.02, 1.8, '#b0bec5', 0.7, 0.9, -0.9, 6);
    box(g, 0.3, 0.4, 0.05, '#e3f2fd', 0.7, 1.7, -0.9);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.5, hz: 1.05, h: 0.75, walk: true }], seats: [{ x: 0, z: -0.1, rot: Math.PI, y: 0.8, kind: 'bed' }], uses: [{ x: 0.9, z: 0.3, kind: 'heal', label: 'Get treated ($100)' }] };
  },
  weights() {
    const g = new THREE.Group();
    box(g, 1.4, 0.45, 0.4, '#212121', 0, 0.22, 0);
    cyl(g, 0.02, 0.02, 1.8, '#b0bec5', 0, 1.1, -0.1, 6, { metalness: 0.9 }).rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) cyl(g, 0.22, 0.22, 0.08, '#111', s * 0.75, 1.1, -0.1, 16).rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) box(g, 0.08, 1.2, 0.08, '#616161', s * 0.6, 0.6, -0.25);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.7, hz: 0.3, h: 0.45, walk: true }], uses: [{ x: 0, z: 0.7, kind: 'workout', label: 'Lift weights (+stamina)' }] };
  },
  treadmill() {
    const g = new THREE.Group();
    box(g, 0.8, 0.2, 1.8, '#263238', 0, 0.1, 0);
    box(g, 0.7, 0.03, 1.5, '#111', 0, 0.21, 0.05);
    for (const s of [-1, 1]) box(g, 0.05, 1.2, 0.05, '#546e7a', s * 0.38, 0.7, -0.8);
    box(g, 0.8, 0.3, 0.1, '#37474f', 0, 1.3, -0.8);
    return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.4, hz: 0.9, h: 0.22, walk: true }], uses: [{ x: 0, z: 1.2, kind: 'workout', label: 'Run on treadmill (+stamina)' }] };
  },
  crate(s = 1.2, c = '#a1887f') { const g = new THREE.Group(); box(g, s, s, s, c, 0, s / 2, 0); return { obj: g, boxes: [{ x: 0, z: 0, hx: s / 2, hz: s / 2, h: s, walk: true }] }; },
  barStool() { const g = new THREE.Group(); cyl(g, 0.2, 0.2, 0.06, '#b71c1c', 0, 0.78, 0); cyl(g, 0.03, 0.03, 0.75, '#9e9e9e', 0, 0.38, 0, 6); return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.2, hz: 0.2, h: 0.8, walk: true }], seats: [{ x: 0, z: 0, rot: 0, y: 0.8 }] }; },
  toilet() { const g = new THREE.Group(); box(g, 0.45, 0.45, 0.65, '#fafafa', 0, 0.22, 0); box(g, 0.45, 0.55, 0.2, '#fafafa', 0, 0.6, -0.3); return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.23, hz: 0.33, h: 0.45, walk: true }], seats: [{ x: 0, z: 0.05, rot: 0, y: 0.45 }] }; },
  bathtub() { const g = new THREE.Group(); box(g, 0.8, 0.55, 1.7, '#fafafa', 0, 0.27, 0); const w = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 1.5), mat('#81d4fa', { transparent: true, opacity: 0.8 })); w.rotation.x = -Math.PI / 2; w.position.y = 0.5; g.add(w); return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.4, hz: 0.85, h: 0.55, walk: true }] }; },
  lamp() { const g = new THREE.Group(); cyl(g, 0.15, 0.2, 0.05, '#333', 0, 0.02, 0); cyl(g, 0.02, 0.02, 1.5, '#333', 0, 0.75, 0, 6); cyl(g, 0.12, 0.25, 0.3, '#fff3e0', 0, 1.55, 0, 12, { emissive: '#ffcc80', emissiveIntensity: 0.8 }); return { obj: g, boxes: [{ x: 0, z: 0, hx: 0.15, hz: 0.15, h: 1.6 }], uses: [{ x: 0, z: 0.6, kind: 'light', label: 'Toggle lamp' }] }; },
  carLift() { const g = new THREE.Group(); for (const s of [-1, 1]) box(g, 0.3, 2.6, 0.3, '#f44336', s * 1.6, 1.3, 0); box(g, 3.5, 0.15, 0.4, '#b71c1c', 0, 1.8, 0); return { obj: g, boxes: [{ x: -1.6, z: 0, hx: 0.15, hz: 0.15, h: 2.6 }, { x: 1.6, z: 0, hx: 0.15, hz: 0.15, h: 2.6 }] }; },
  register() { const g = new THREE.Group(); box(g, 0.4, 0.25, 0.35, '#37474f', 0, 0.12, 0); return { obj: g, boxes: [] }; },
};
