import * as THREE from 'three';

// Procedural accessory meshes. Every builder takes the measured head frame
// { c: head center (Vector3), w, h, d: head size, front: z of the face surface,
//   eyeY, top } in the rig's model space and returns an Object3D positioned in that space.

const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, ...opts });

export function eyes(head, style = 'normal', skin = '#e0b394') {
  const g = new THREE.Group();
  const r = head.w * 0.085;
  const white = mat('#f7f7f2', { roughness: 0.3 });
  const iris = mat('#2a1d14', { roughness: 0.2 });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 10), white);
    e.position.set(head.c.x + s * head.w * 0.2, head.eyeY, head.front - r * 0.55);
    e.scale.set(1, 0.85, 0.6);
    const p = new THREE.Mesh(new THREE.SphereGeometry(r * 0.52, 10, 8), iris);
    p.position.set(0, -r * 0.05, r * 0.72);
    e.add(p);
    g.add(e);
    if (style === 'bored') {
      const lid = new THREE.Mesh(new THREE.SphereGeometry(r * 1.08, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(skin));
      lid.position.copy(e.position); lid.scale.set(1, 0.9, 0.7); lid.rotation.x = 0.35;
      g.add(lid);
    }
    // brows
    const brow = new THREE.Mesh(new THREE.BoxGeometry(r * 2.4, r * 0.45, r * 0.6), mat('#2a1d14'));
    brow.position.set(head.c.x + s * head.w * 0.2, head.eyeY + r * (style === 'bored' ? 1.25 : 1.6), head.front - r * 0.2);
    brow.rotation.z = s * (style === 'bored' ? -0.08 : 0.1);
    g.add(brow);
  }
  return g;
}

export function fluffyHair(head, color) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.95 });
  const geo = new THREE.IcosahedronGeometry(1, 1);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 46; i++) {
    const th = rnd() * Math.PI * 2, ph = rnd() * Math.PI * 0.55;
    const dir = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    if (dir.z > 0.55 && dir.y < 0.55) continue; // keep the face clear
    const s = head.w * (0.2 + rnd() * 0.14);
    const b = new THREE.Mesh(geo, m);
    b.scale.setScalar(s);
    b.position.set(head.c.x + dir.x * head.w * 0.55, head.c.y + head.h * 0.12 + dir.y * head.h * 0.42, head.c.z + dir.z * head.d * 0.55 - head.d * 0.05);
    g.add(b);
  }
  // fringe over the forehead
  for (let i = -2; i <= 2; i++) {
    const b = new THREE.Mesh(geo, m);
    b.scale.set(head.w * 0.17, head.w * 0.14, head.w * 0.14);
    b.position.set(head.c.x + i * head.w * 0.17, head.eyeY + head.h * 0.26, head.front - head.d * 0.12);
    g.add(b);
  }
  return g;
}

export function shortHairCap(head, color) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), mat(color, { roughness: 0.95 }));
  m.scale.set(head.w * 0.56, head.h * 0.5, head.d * 0.58);
  m.position.set(head.c.x, head.c.y + head.h * 0.08, head.c.z - head.d * 0.04);
  m.rotation.x = -0.25;
  return m;
}

export function ponytail(head, color) {
  const g = new THREE.Group();
  g.add(shortHairCap(head, color));
  const t = new THREE.Mesh(new THREE.CapsuleGeometry(head.w * 0.16, head.h * 0.55, 4, 8), mat(color, { roughness: 0.95 }));
  t.position.set(head.c.x, head.c.y - head.h * 0.05, head.c.z - head.d * 0.62);
  t.rotation.x = 0.35;
  g.add(t);
  return g;
}

export function umbrellaHat(head) {
  const g = new THREE.Group();
  const R = head.w * 1.05;
  const colors = ['#ff4d6d', '#ffd23f', '#3ec1d3', '#8ac926', '#ff9f1c', '#a06cd5', '#ff4d6d', '#3ec1d3'];
  const segs = 8;
  for (let i = 0; i < segs; i++) {
    const geo = new THREE.ConeGeometry(R, R * 0.55, 3, 1, true, (i / segs) * Math.PI * 2, (Math.PI * 2) / segs);
    const m = new THREE.Mesh(geo, mat(colors[i], { side: THREE.DoubleSide, roughness: 0.6 }));
    g.add(m);
  }
  // scalloped rim
  for (let i = 0; i < segs; i++) {
    const a = ((i + 0.5) / segs) * Math.PI * 2;
    const b = new THREE.Mesh(new THREE.SphereGeometry(R * 0.12, 8, 6), mat(colors[i]));
    b.position.set(Math.sin(a) * R * 0.93, -R * 0.27, Math.cos(a) * R * 0.93);
    b.scale.set(1, 0.5, 1);
    g.add(b);
  }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.035, R * 0.035, R * 0.6), mat('#6d4c41'));
  stem.position.y = R * 0.35;
  g.add(stem);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(R * 0.08, 10, 8), mat('#ffffff'));
  ball.position.y = R * 0.66;
  g.add(ball);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(head.w * 0.52, head.w * 0.54, head.h * 0.12, 16, 1, true), mat('#ffffff', { side: THREE.DoubleSide }));
  band.position.y = -R * 0.2;
  g.add(band);
  g.position.set(head.c.x, head.top - R * 0.02, head.c.z);
  g.rotation.z = 0.12;
  return g;
}

export function cap(head, color = '#c0392b') {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), mat(color));
  dome.scale.set(head.w * 0.57, head.h * 0.42, head.d * 0.6);
  g.add(dome);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(head.w * 0.42, head.w * 0.42, head.h * 0.03, 16, 1, false, -Math.PI / 2, Math.PI), mat(color));
  brim.position.set(0, 0, head.d * 0.42);
  brim.scale.set(1, 1, 0.9);
  g.add(brim);
  g.position.set(head.c.x, head.c.y + head.h * 0.2, head.c.z);
  return g;
}

export function policeHat(head) {
  const g = cap(head, '#101a33');
  const badge = new THREE.Mesh(new THREE.CircleGeometry(head.w * 0.09, 6), mat('#d4af37', { metalness: 0.8, roughness: 0.3 }));
  badge.position.set(0, head.h * 0.2, head.d * 0.58);
  g.add(badge);
  return g;
}

export function hardhat(head) {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), mat('#ffcc00', { roughness: 0.4 }));
  dome.scale.set(head.w * 0.62, head.h * 0.48, head.d * 0.65);
  g.add(dome);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(head.w * 0.7, head.w * 0.7, head.h * 0.03, 20), mat('#ffcc00', { roughness: 0.4 }));
  g.add(rim);
  g.position.set(head.c.x, head.c.y + head.h * 0.18, head.c.z);
  return g;
}

export function bandana(head, color = '#7d1111') {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(head.w * 0.53, head.w * 0.55, head.h * 0.14, 18, 1, true), mat(color, { side: THREE.DoubleSide }));
  m.position.set(head.c.x, head.c.y + head.h * 0.2, head.c.z);
  return m;
}

export function skiMask(head, color = '#141414', skin = '#c48b60') {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), mat(color, { roughness: 1 }));
  shell.scale.set(head.w * 0.58, head.h * 0.64, head.d * 0.62);
  shell.position.set(head.c.x, head.c.y + head.h * 0.07, head.c.z);
  g.add(shell);
  // eye openings (skin patch) + eyes
  const patch = new THREE.Mesh(new THREE.CapsuleGeometry(head.w * 0.07, head.w * 0.34, 4, 10), mat(skin));
  patch.rotation.z = Math.PI / 2;
  patch.position.set(head.c.x, head.eyeY, head.front + head.d * 0.02);
  patch.scale.set(1, 1, 0.45);
  g.add(patch);
  const e = eyes({ ...head, front: head.front + head.d * 0.09 }, 'normal', skin);
  e.children.filter((c) => c.geometry.type === 'BoxGeometry').forEach((c) => (c.visible = false));
  g.add(e);
  // stitched mouth hole
  const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(head.w * 0.035, head.w * 0.12, 4, 8), mat('#3a1b14'));
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(head.c.x, head.c.y - head.h * 0.28, head.front + head.d * 0.02);
  g.add(mouth);
  return g;
}

export function gorillaHead(head, fur = '#2a2522') {
  const g = new THREE.Group();
  const furM = mat(fur, { roughness: 1 });
  const face = mat('#4b4540', { roughness: 0.85 });
  const W = head.w * 1.25, H = head.h * 1.15, D = head.d * 1.15;
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 18), furM);
  skull.scale.set(W * 0.55, H * 0.55, D * 0.55);
  g.add(skull);
  // sagittal crest
  const crest = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), furM);
  crest.scale.set(W * 0.22, H * 0.28, D * 0.45);
  crest.position.set(0, H * 0.38, -D * 0.05);
  g.add(crest);
  // face plate
  const plate = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), face);
  plate.scale.set(W * 0.42, H * 0.42, D * 0.3);
  plate.position.set(0, -H * 0.02, D * 0.33);
  g.add(plate);
  // brow ridge
  const brow = new THREE.Mesh(new THREE.CapsuleGeometry(H * 0.09, W * 0.5, 4, 10), face);
  brow.rotation.z = Math.PI / 2;
  brow.position.set(0, H * 0.14, D * 0.55);
  g.add(brow);
  // muzzle
  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), face);
  muzzle.scale.set(W * 0.36, H * 0.26, D * 0.26);
  muzzle.position.set(0, -H * 0.2, D * 0.52);
  g.add(muzzle);
  for (const s of [-1, 1]) {
    const n = new THREE.Mesh(new THREE.SphereGeometry(W * 0.05, 10, 8), mat('#141210'));
    n.position.set(s * W * 0.07, -H * 0.1, D * 0.76);
    n.scale.set(1, 0.7, 0.5);
    g.add(n);
    const e = new THREE.Mesh(new THREE.SphereGeometry(W * 0.055, 12, 10), mat('#1a0f08', { roughness: 0.2 }));
    e.position.set(s * W * 0.16, H * 0.04, D * 0.6);
    g.add(e);
    const glint = new THREE.Mesh(new THREE.SphereGeometry(W * 0.014, 6, 6), mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.5 }));
    glint.position.set(s * W * 0.16 + W * 0.015, H * 0.06, D * 0.65);
    g.add(glint);
    const ear = new THREE.Mesh(new THREE.SphereGeometry(W * 0.1, 10, 8), face);
    ear.position.set(s * W * 0.54, H * 0.02, 0);
    ear.scale.set(0.5, 1, 0.8);
    g.add(ear);
  }
  const mouth = new THREE.Mesh(new THREE.CapsuleGeometry(H * 0.02, W * 0.22, 4, 8), mat('#141210'));
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, -H * 0.3, D * 0.73);
  g.add(mouth);
  g.position.set(head.c.x, head.c.y + head.h * 0.02, head.c.z + head.d * 0.02);
  return g;
}

export function hoodCollar(neckPos, radius, color) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.35, 10, 20), mat(color, { roughness: 0.9 }));
  m.rotation.x = Math.PI / 2 + 0.2;
  m.position.copy(neckPos);
  return m;
}
