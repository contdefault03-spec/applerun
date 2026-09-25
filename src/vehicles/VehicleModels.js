import * as THREE from 'three';
import { LAYER, setLayer } from '../world/layers.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Vehicle specs (physics + layout) and procedural low-poly models with simple interiors.
// Local frame: +Z forward, +X left, origin at ground level under the vehicle centre.
export const SPECS = {
  sedan: { name: 'Sedan', length: 4.5, width: 1.85, height: 1.45, wheelR: 0.34, wheelBase: 2.7, track: 1.55, maxSpeed: 46, accel: 7.5, brake: 16, steer: 0.55, grip: 7, mass: 1400, seats: 4, colors: ['#b71c1c', '#1565c0', '#eeeeee', '#212121', '#546e7a', '#2e7d32', '#6d4c41', '#c0ca33'] },
  sedan_old: { name: 'Rusty Sedan', length: 4.6, width: 1.85, height: 1.45, wheelR: 0.34, wheelBase: 2.7, track: 1.55, maxSpeed: 38, accel: 5.5, brake: 12, steer: 0.5, grip: 6, mass: 1500, seats: 4, colors: ['#8d6e63', '#78909c', '#9e9d24', '#5d4037', '#607d8b'], rusty: true },
  sports: { name: 'Sports Car', length: 4.4, width: 1.95, height: 1.2, wheelR: 0.35, wheelBase: 2.6, track: 1.65, maxSpeed: 68, accel: 12, brake: 22, steer: 0.5, grip: 9.5, mass: 1300, seats: 2, colors: ['#ff1744', '#ffea00', '#00e5ff', '#76ff03', '#ff9100', '#e0e0e0', '#111111'], low: true },
  hypercar: { name: 'Scorpio GTX', length: 4.5, width: 2.0, height: 1.05, wheelR: 0.36, wheelBase: 2.65, track: 1.72, maxSpeed: 78, accel: 14, brake: 24, steer: 0.48, grip: 10.5, mass: 1250, seats: 2, colors: ['#e10600', '#f5c400', '#0a3d91', '#0b0b0b', '#e8e8e8'], low: true, wedge: true },
  suv: { name: 'SUV', length: 4.8, width: 2.0, height: 1.85, wheelR: 0.42, wheelBase: 2.85, track: 1.7, maxSpeed: 42, accel: 7, brake: 15, steer: 0.5, grip: 7.5, mass: 2100, seats: 4, colors: ['#263238', '#eceff1', '#3e2723', '#1a237e', '#455a64'], tall: true },
  taxi: { name: 'Taxi', length: 4.6, width: 1.85, height: 1.5, wheelR: 0.34, wheelBase: 2.75, track: 1.55, maxSpeed: 44, accel: 7, brake: 16, steer: 0.55, grip: 7, mass: 1450, seats: 4, colors: ['#ffc400'], taxi: true },
  police: { name: 'Police Cruiser', length: 4.8, width: 1.9, height: 1.5, wheelR: 0.35, wheelBase: 2.85, track: 1.6, maxSpeed: 58, accel: 10, brake: 20, steer: 0.55, grip: 8.5, mass: 1600, seats: 4, colors: ['#f5f5f5'], police: true, siren: 'police' },
  ambulance: { name: 'Ambulance', length: 5.9, width: 2.2, height: 2.6, wheelR: 0.42, wheelBase: 3.6, track: 1.85, maxSpeed: 44, accel: 6.5, brake: 14, steer: 0.45, grip: 7, mass: 3200, seats: 4, colors: ['#ffffff'], ambulance: true, siren: 'ambulance', box: true },
  van: { name: 'Delivery Van', length: 5.3, width: 2.05, height: 2.3, wheelR: 0.4, wheelBase: 3.3, track: 1.75, maxSpeed: 38, accel: 5.5, brake: 13, steer: 0.45, grip: 6.5, mass: 2600, seats: 2, colors: ['#ffffff', '#1e88e5', '#8d6e63', '#fdd835'], box: true },
  truck: { name: 'Box Truck', length: 7.2, width: 2.4, height: 3.2, wheelR: 0.5, wheelBase: 4.4, track: 2.0, maxSpeed: 32, accel: 4.2, brake: 11, steer: 0.4, grip: 6, mass: 7000, seats: 2, colors: ['#e53935', '#1565c0', '#eeeeee', '#2e7d32'], truck: true },
  motorcycle: { name: 'Motorcycle', length: 2.1, width: 0.8, height: 1.15, wheelR: 0.33, wheelBase: 1.45, track: 0, maxSpeed: 60, accel: 13, brake: 20, steer: 0.6, grip: 8, mass: 220, seats: 2, colors: ['#d50000', '#212121', '#ff6d00', '#2962ff', '#00c853'], bike: true },
  boat: { name: 'Skiff', length: 6.2, width: 2.2, height: 1.6, wheelR: 0, wheelBase: 3, track: 1.6, maxSpeed: 18, accel: 4.5, brake: 6, steer: 0.5, grip: 3, mass: 900, seats: 4, colors: ['#e0e0e0', '#1565c0', '#e53935'], boat: true },
};
for (const s of Object.values(SPECS)) s.interior = !s.bike;

const cache = new Map();
function colorGeo(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const a = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}
function bx(w, h, d, x, y, z, color, rx = 0) { const g = new THREE.BoxGeometry(w, h, d); if (rx) g.rotateX(rx); g.translate(x, y, z); return colorGeo(g, color); }
// Trapezoid prism (cabin): bottom z-extent [zb0,zb1], top [zt0,zt1], width w, y range
function cabin(w, y0, y1, zb0, zb1, zt0, zt1, color, topW = w * 0.92) {
  const hw = w / 2, ht = topW / 2;
  const v = [
    [-hw, y0, zb0], [hw, y0, zb0], [hw, y0, zb1], [-hw, y0, zb1],
    [-ht, y1, zt0], [ht, y1, zt0], [ht, y1, zt1], [-ht, y1, zt1],
  ];
  const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  const pos = [];
  for (const f of faces) { const [a, b, c, d] = f.map((i) => v[i]); pos.push(...a, ...c, ...b, ...a, ...d, ...c); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return colorGeo(g, color);
}

const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45, side: THREE.DoubleSide });
const matteMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
const glassMat = new THREE.MeshStandardMaterial({ color: '#1b2733', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
const tireMat = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: '#b0bec5', roughness: 0.3, metalness: 0.8 });
export const lightMats = {
  head: new THREE.MeshStandardMaterial({ color: '#fffde7', emissive: '#fff8e1', emissiveIntensity: 0.4 }),
  tail: new THREE.MeshStandardMaterial({ color: '#b71c1c', emissive: '#ff1744', emissiveIntensity: 0.6 }),
  red: new THREE.MeshStandardMaterial({ color: '#b71c1c', emissive: '#ff1744', emissiveIntensity: 0.2 }),
  blue: new THREE.MeshStandardMaterial({ color: '#0d47a1', emissive: '#2979ff', emissiveIntensity: 0.2 }),
};

/** Build a vehicle model. Returns { group, wheels: [{obj, front, x, z}], lightbar: [meshes], seatLocal: [...] } */
export function buildVehicle(type, color, accent = null) {
  const s = SPECS[type] || SPECS.sedan;
  const key = type + color + (accent || '');
  let parts = cache.get(key);
  if (!parts) { parts = buildParts(type, s, color, accent); cache.set(key, parts); }
  const group = new THREE.Group();
  const body = new THREE.Mesh(parts.body, bodyMat); body.castShadow = true; body.receiveShadow = true;
  const matte = new THREE.Mesh(parts.matte, matteMat); matte.castShadow = true;
  group.add(body, matte);
  if (parts.glass) { const gl = new THREE.Mesh(parts.glass, glassMat); group.add(gl); }
  const lights = {};
  for (const [k, geo] of Object.entries(parts.lights)) { const m = new THREE.Mesh(geo, lightMats[k].clone()); group.add(m); lights[k] = m; }
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(s.wheelR, s.wheelR, s.bike ? 0.16 : 0.26, 16); tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(s.wheelR * 0.62, s.wheelR * 0.62, s.bike ? 0.18 : 0.28, 10); rimGeo.rotateZ(Math.PI / 2);
  const wz = s.wheelBase / 2;
  const positions = s.boat ? [] : s.bike ? [[0, wz, true], [0, -wz, false]] : [[s.track / 2, wz, true], [-s.track / 2, wz, true], [s.track / 2, -wz, false], [-s.track / 2, -wz, false]];
  if (s.truck) positions.push([s.track / 2, -wz + 1.3, false], [-s.track / 2, -wz + 1.3, false]);
  for (const [x, z, front] of positions) {
    const pivot = new THREE.Group(); pivot.position.set(x, s.wheelR, z);
    const spin = new THREE.Group();
    const t = new THREE.Mesh(tireGeo, tireMat); t.castShadow = true;
    const r = new THREE.Mesh(rimGeo, rimMat);
    spin.add(t, r); pivot.add(spin); group.add(pivot);
    wheels.push({ pivot, spin, front, x, z });
  }
  setLayer(group, LAYER.MID); // no shadows in the far cascade
  return { group, wheels, lights, spec: s };
}

function buildParts(type, s, color, accent) {
  const L = s.length, W = s.width, H = s.height, R = s.wheelR;
  const body = [], matte = [], glass = [], head = [], tail = [], red = [], blue = [];
  const dark = '#1f1f1f', interior = '#2b2b2b', seat = '#3e2723', chrome = '#9e9e9e';
  const y0 = R * 0.9;
  if (s.bike) {
    body.push(bx(0.34, 0.35, 1.0, 0, y0 + 0.35, 0.05, color));           // tank/body
    body.push(bx(0.3, 0.2, 0.6, 0, y0 + 0.62, 0.35, color));
    matte.push(bx(0.32, 0.14, 0.7, 0, y0 + 0.55, -0.35, '#111'));        // seat
    matte.push(bx(0.08, 0.7, 0.08, 0, y0 + 0.35, 0.75, chrome, -0.35));  // fork
    matte.push(bx(0.7, 0.05, 0.05, 0, y0 + 0.85, 0.62, '#111'));          // handlebar
    matte.push(bx(0.1, 0.12, 0.5, 0.12, y0, -0.55, chrome));             // exhaust
    head.push(bx(0.16, 0.12, 0.06, 0, y0 + 0.62, 0.72, '#fff'));
    tail.push(bx(0.14, 0.08, 0.05, 0, y0 + 0.45, -0.72, '#f00'));
  } else if (s.truck) {
    const cabL = 2.0;
    body.push(bx(W, 1.1, cabL, 0, y0 + 0.75, L / 2 - cabL / 2, color));
    body.push(cabin(W, y0 + 1.3, H - 0.5, L / 2 - cabL, L / 2 - 0.35, L / 2 - cabL, L / 2 - 0.6, color));
    glass.push(bx(W * 0.9, 0.7, 0.05, 0, y0 + 1.75, L / 2 - 0.45, '#000', -0.15));
    matte.push(bx(W + 0.1, H - 0.4, L - cabL - 0.3, 0, (H - 0.4) / 2 + y0 + 0.2, -cabL / 2 + 0.05 - 0.15, '#eceff1'));
    matte.push(bx(W, 0.3, L, 0, y0 + 0.15, 0, dark));
    head.push(bx(0.35, 0.18, 0.05, W / 2 - 0.3, y0 + 0.75, L / 2 + 0.01, '#fff'), bx(0.35, 0.18, 0.05, -W / 2 + 0.3, y0 + 0.75, L / 2 + 0.01, '#fff'));
    tail.push(bx(0.3, 0.2, 0.05, W / 2 - 0.25, y0 + 0.6, -L / 2 - 0.01, '#f00'), bx(0.3, 0.2, 0.05, -W / 2 + 0.25, y0 + 0.6, -L / 2 - 0.01, '#f00'));
  } else if (s.boat) {
    const hullH = 0.6;
    body.push(bx(W, hullH, L * 0.92, 0, hullH / 2, 0, color));
    body.push(bx(W * 0.7, hullH * 0.7, L * 0.22, 0, hullH * 0.85, L * 0.42, color));
    matte.push(bx(W + 0.06, 0.12, L + 0.1, 0, hullH + 0.02, 0, '#e8e8e8'));
    matte.push(bx(W * 0.6, 0.55, 1.1, 0, hullH + 0.3, -L * 0.12, '#37474f'));
    glass.push(bx(W * 0.55, 0.32, 0.05, 0, hullH + 0.62, -L * 0.12 + 0.5, '#000', -0.3));
    matte.push(bx(0.06, 0.4, 0.06, 0, hullH + 0.75, -L * 0.12, '#222'));
    head.push(bx(0.2, 0.1, 0.05, W / 2 - 0.25, hullH + 0.15, L / 2 + 0.01, '#fff'));
    tail.push(bx(0.16, 0.1, 0.05, W / 2 - 0.2, hullH + 0.15, -L / 2 - 0.01, '#f00'));
  } else if (s.box) {
    // van / ambulance: tall box with short nose
    const nose = 1.1;
    body.push(bx(W, 0.9, nose, 0, y0 + 0.5, L / 2 - nose / 2, color));
    body.push(bx(W, H - y0 - 0.1, L - nose, 0, (H - y0 - 0.1) / 2 + y0 + 0.05, -nose / 2, color));
    body.push(cabin(W, y0 + 0.95, H - 0.1, L / 2 - nose, L / 2 - 0.05, L / 2 - nose, L / 2 - nose + 0.2, color));
    glass.push(bx(W * 0.92, 0.75, 0.05, 0, y0 + 1.4, L / 2 - nose + 0.45, '#000', -0.75));
    glass.push(bx(0.05, 0.6, 0.9, W / 2 + 0.01, y0 + 1.45, L / 2 - nose - 0.3, '#000'), bx(0.05, 0.6, 0.9, -W / 2 - 0.01, y0 + 1.45, L / 2 - nose - 0.3, '#000'));
    matte.push(bx(W + 0.04, 0.25, L + 0.04, 0, y0 + 0.08, 0, dark));
    head.push(bx(0.4, 0.18, 0.05, W / 2 - 0.3, y0 + 0.7, L / 2 + 0.01, '#fff'), bx(0.4, 0.18, 0.05, -W / 2 + 0.3, y0 + 0.7, L / 2 + 0.01, '#fff'));
    tail.push(bx(0.2, 0.4, 0.05, W / 2 - 0.15, y0 + 0.9, -L / 2 - 0.01, '#f00'), bx(0.2, 0.4, 0.05, -W / 2 + 0.15, y0 + 0.9, -L / 2 - 0.01, '#f00'));
    if (s.ambulance) {
      matte.push(bx(W + 0.02, 0.3, L - nose + 0.02, 0, y0 + 0.9, -nose / 2, '#d32f2f'));
      matte.push(bx(0.02, 0.7, 0.2, W / 2 + 0.02, y0 + 1.7, -0.8, '#d32f2f'), bx(0.02, 0.2, 0.7, W / 2 + 0.02, y0 + 1.7, -0.8, '#d32f2f'));
      matte.push(bx(0.02, 0.7, 0.2, -W / 2 - 0.02, y0 + 1.7, -0.8, '#d32f2f'), bx(0.02, 0.2, 0.7, -W / 2 - 0.02, y0 + 1.7, -0.8, '#d32f2f'));
      red.push(bx(0.5, 0.18, 0.25, 0.45, H + 0.05, L / 2 - nose - 0.2, '#f00')); blue.push(bx(0.5, 0.18, 0.25, -0.45, H + 0.05, L / 2 - nose - 0.2, '#00f'));
      red.push(bx(0.3, 0.15, 0.2, 0.7, H + 0.02, -L / 2 + 0.2, '#f00')); blue.push(bx(0.3, 0.15, 0.2, -0.7, H + 0.02, -L / 2 + 0.2, '#00f'));
    }
  } else {
    // cars: lower body + cabin
    const low = s.low ? 0.8 : 1;
    const bodyH = (s.tall ? 0.8 : 0.6) * low;
    body.push(bx(W, bodyH, L, 0, y0 + bodyH / 2, 0, color));
    // bumpers
    matte.push(bx(W + 0.04, 0.2, 0.18, 0, y0 + 0.12, L / 2 + 0.02, dark), bx(W + 0.04, 0.2, 0.18, 0, y0 + 0.12, -L / 2 - 0.02, dark));
    const cabBottom = y0 + bodyH, cabTop = H;
    const cz0 = s.wedge ? -L * 0.16 : s.low ? -L * 0.28 : -L * 0.32, cz1 = s.wedge ? L * 0.2 : s.low ? L * 0.12 : L * 0.2;
    const tz0 = s.wedge ? -L * 0.06 : s.low ? -L * 0.18 : s.tall ? -L * 0.34 : -L * 0.22, tz1 = s.wedge ? L * 0.1 : s.low ? L * -0.02 : s.tall ? L * 0.1 : L * 0.05;
    const topWFrac = s.wedge ? 0.76 : 0.86;
    body.push(bx(W * 0.9, 0.06, tz1 - tz0, 0, cabTop, (tz0 + tz1) / 2, color));
    glass.push(cabin(W * 0.94, cabBottom, cabTop, cz0, cz1, tz0, tz1, '#000', W * topWFrac));
    // pillars
    for (const sx of [-1, 1]) matte.push(bx(0.06, cabTop - cabBottom, 0.1, sx * W * 0.45, (cabBottom + cabTop) / 2, (cz0 + tz0) / 2, color));
    // interior: seats, dash, steering wheel
    matte.push(bx(W * 0.85, 0.3, 0.3, 0, cabBottom + 0.05, cz1 - 0.2, interior));
    matte.push(bx(0.5, 0.45, 0.45, W * 0.22, cabBottom - 0.05, 0, seat), bx(0.5, 0.6, 0.12, W * 0.22, cabBottom + 0.2, -0.25, seat));
    matte.push(bx(0.5, 0.45, 0.45, -W * 0.22, cabBottom - 0.05, 0, seat), bx(0.5, 0.6, 0.12, -W * 0.22, cabBottom + 0.2, -0.25, seat));
    if (s.seats > 2) matte.push(bx(W * 0.8, 0.45, 0.5, 0, cabBottom - 0.05, cz0 + 0.45, seat));
    const wheel = new THREE.TorusGeometry(0.17, 0.025, 6, 16); wheel.rotateX(-0.5); wheel.translate(W * 0.22, cabBottom + 0.3, cz1 - 0.45);
    matte.push(colorGeo(wheel, '#111'));
    head.push(bx(0.4, 0.14, 0.05, W / 2 - 0.3, y0 + bodyH - 0.15, L / 2 + 0.01, '#fff'), bx(0.4, 0.14, 0.05, -W / 2 + 0.3, y0 + bodyH - 0.15, L / 2 + 0.01, '#fff'));
    tail.push(bx(0.35, 0.14, 0.05, W / 2 - 0.25, y0 + bodyH - 0.15, -L / 2 - 0.01, '#f00'), bx(0.35, 0.14, 0.05, -W / 2 + 0.25, y0 + bodyH - 0.15, -L / 2 - 0.01, '#f00'));
    if (s.taxi) {
      matte.push(bx(0.7, 0.22, 0.3, 0, cabTop + 0.14, (tz0 + tz1) / 2, '#fff59d'));
      matte.push(bx(W + 0.01, 0.12, L * 0.6, 0, y0 + bodyH * 0.55, 0, '#212121'));
    }
    if (s.police) {
      body.push(bx(W + 0.01, bodyH * 0.55, L * 0.45, 0, y0 + bodyH * 0.45, 0, '#101820'));
      matte.push(bx(1.1, 0.1, 0.3, 0, cabTop + 0.08, (tz0 + tz1) / 2, '#222'));
      red.push(bx(0.45, 0.14, 0.26, 0.3, cabTop + 0.16, (tz0 + tz1) / 2, '#f00'));
      blue.push(bx(0.45, 0.14, 0.26, -0.3, cabTop + 0.16, (tz0 + tz1) / 2, '#00f'));
      matte.push(bx(W * 0.8, 0.35, 0.06, 0, y0 + 0.35, L / 2 + 0.12, '#111')); // push bar
    }
    if (s.rusty) for (let i = 0; i < 5; i++) matte.push(bx(0.02, 0.2 + i * 0.03, 0.3, (i % 2 ? 1 : -1) * (W / 2 + 0.005), y0 + 0.25, -L / 3 + i * 0.5, '#6d3b1d'));
    if (accent && !s.taxi && !s.police) {
      // a racing stripe (or two-tone roof) down the centreline, from the nose over the roof
      matte.push(bx(W * 0.22, bodyH + 0.02, L * 0.94, 0, y0 + bodyH + 0.005, 0, accent));
      matte.push(bx(W * 0.5, 0.05, tz1 - tz0 + 0.02, 0, cabTop + 0.01, (tz0 + tz1) / 2, accent));
    }
  }
  const merge = (arr) => (arr.length ? mergeGeometries(arr) : null);
  const lights = {};
  if (head.length) lights.head = merge(head);
  if (tail.length) lights.tail = merge(tail);
  if (red.length) lights.red = merge(red);
  if (blue.length) lights.blue = merge(blue);
  return { body: merge(body), matte: merge(matte.length ? matte : [bx(0.01, 0.01, 0.01, 0, 0, 0, '#000')]), glass: merge(glass), lights };
}
