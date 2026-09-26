import * as THREE from 'three';
import { combatArenaGeom } from '../../shared/map/layout.js';

// v1.2 Stage 12: a real desert-town/industrial arena for Counter-Strike mode, replacing the old
// invisible bounding box. Geometry here must line up with the collider walls/cover added in
// shared/map/layout.js's addLandmarkColliders() (both read combatArenaGeom() so they can't drift
// apart). Kept as plain low-poly boxes in the game's established procedural style — sand/tan
// concrete + corrugated industrial roofs, no textures/assets needed.
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
function box(w, h, d, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function buildCombatArena() {
  const g = new THREE.Group();
  g.name = 'combatArena';
  const { cx, cz, halfX, halfZ } = combatArenaGeom();
  const sand = M('#c2a575'), sandDark = M('#a88c5f'), concrete = M('#9d9488'), rust = M('#6b4a3a', { roughness: 0.95 }),
    metal = M('#5c6670', { metalness: 0.5, roughness: 0.55 }), roof = M('#7d3b31', { metalness: 0.2, roughness: 0.8 });

  // ground pad — sandy compound floor, distinct from the surrounding terrain
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfX * 2 + 6, halfZ * 2 + 6), sand);
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx, 0.03, cz); floor.receiveShadow = true;
  g.add(floor);

  const wt = 1.2, wh = 6;
  g.add(box(halfX * 2, wh, wt, concrete, cx, wh / 2, cz - halfZ));
  g.add(box(halfX * 2, wh, wt, concrete, cx, wh / 2, cz + halfZ));
  for (const sx of [-1, 1]) {
    const ex = cx + sx * halfX;
    const seg = (halfZ * 2 - 10) / 2;
    g.add(box(wt, wh, seg, concrete, ex, wh / 2, cz - 5 - seg / 2));
    g.add(box(wt, wh, seg, concrete, ex, wh / 2, cz + 5 + seg / 2));
    // gate posts either side of the entrance gap
    g.add(box(1.4, wh + 1.5, 1.4, rust, ex, (wh + 1.5) / 2, cz - 5));
    g.add(box(1.4, wh + 1.5, 1.4, rust, ex, (wh + 1.5) / 2, cz + 5));
  }
  // corner watchtowers
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const tx = cx + sx * (halfX - 3), tz = cz + sz * (halfZ - 3);
    const leg = (lx, lz) => box(0.35, 5.5, 0.35, metal, tx + lx, 2.75, tz + lz);
    g.add(leg(-1.3, -1.3), leg(1.3, -1.3), leg(-1.3, 1.3), leg(1.3, 1.3));
    g.add(box(3.2, 0.3, 3.2, metal, tx, 5.6, tz));
    g.add(box(3.4, 1.6, 3.4, sandDark, tx, 6.6, tz));
    g.add(box(3.6, 0.25, 3.6, roof, tx, 7.5, tz));
  }
  // mid-lane cover: staggered crates so there's no clean end-to-end sightline
  const coverX = [-45, -20, 0, 20, 45];
  for (let i = 0; i < coverX.length; i++) {
    const zoff = i % 2 === 0 ? -14 : 14;
    const c = box(2.6 + (i % 2), 2.2, 2.6, i % 3 === 0 ? rust : sandDark, cx + coverX[i], 1.1, cz + zoff, (i * 0.4) % 1.5);
    g.add(c);
  }
  // flanking buildings (alleys between them and the perimeter wall) + industrial sheds
  const bldg = (x, z, w, h, d, mRoof = roof) => {
    const bg = new THREE.Group();
    bg.add(box(w, h, d, sandDark, 0, h / 2, 0));
    bg.add(box(w + 0.6, 0.3, d + 0.6, mRoof, 0, h + 0.15, 0));
    bg.position.set(x, 0, z);
    return bg;
  };
  g.add(bldg(cx - 30, cz - halfZ + 12, 9, 7, 8));
  g.add(bldg(cx + 30, cz + halfZ - 12, 9, 7, 8));
  g.add(bldg(cx - 12, cz + halfZ - 10, 7, 6, 6, metal));
  g.add(bldg(cx + 12, cz - halfZ + 10, 7, 6, 6, metal));
  // a couple of rusted shipping containers dropped in the lane for extra cover/flavour
  for (const [x, z, ry] of [[cx - 6, cz - 4, 0.3], [cx + 8, cz + 6, -0.5]]) {
    g.add(box(6, 2.6, 2.4, rust, x, 1.3, z, ry));
  }

  // Army barracks / industrial gate — the open-world entrance marking this as a distinct
  // destination, sitting just outside the west (spawnA) wall.
  const gate = new THREE.Group();
  gate.position.set(cx - halfX - 8, 0, cz);
  gate.add(box(2, 8, 2, rust, -6, 4, -6.5), box(2, 8, 2, rust, -6, 4, 6.5));
  gate.add(box(16, 1.4, 2, metal, -6, 8, 0));
  const signMat = M('#2e3b2e', { emissive: '#1a2a1a', emissiveIntensity: 0.4 });
  gate.add(box(9, 1, 0.2, signMat, -6, 8.2, 0.9));
  gate.add(bldg(0, -10, 10, 5, 12, metal));
  gate.add(bldg(0, 10, 10, 5, 12, metal));
  gate.add(box(2.5, 6.5, 2.5, sandDark, -6, 3.25, -14));
  gate.add(box(2.5, 6.5, 2.5, sandDark, -6, 3.25, 14));
  g.add(gate);

  g.traverse((o) => { if (o.isMesh) o.userData.keep = false; });
  return g;
}
