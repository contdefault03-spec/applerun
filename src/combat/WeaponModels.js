import * as THREE from 'three';

// Procedural weapon models. Grip at the origin, barrel along +Z, top along +Y. Units: metres.
const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.5, ...o });
const mats = {
  black: M('#1c1c1e', { roughness: 0.45, metalness: 0.6 }), dark: M('#2e2e30'), wood: M('#7b4a26', { roughness: 0.7, metalness: 0 }),
  silver: M('#c9ccd1', { roughness: 0.25, metalness: 0.95 }), olive: M('#556b2f', { roughness: 0.6, metalness: 0.1 }), grey: M('#6b6f75'),
  glass: M('#4fc3f7', { roughness: 0.05, metalness: 0.2, emissive: '#0a3d5c', emissiveIntensity: 0.4 }), blade: M('#dfe3e8', { roughness: 0.2, metalness: 1 }),
};
function b(g, w, h, d, m, x, y, z, rx = 0) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; g.add(o); return o; }
function c(g, r, len, m, x, y, z, seg = 10) { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z + len / 2); o.castShadow = true; g.add(o); return o; }

const builders = {
  pistol(g) { b(g, 0.035, 0.12, 0.05, mats.dark, 0, -0.04, 0, 0.25); b(g, 0.035, 0.045, 0.2, mats.grey, 0, 0.04, 0.06); c(g, 0.008, 0.03, mats.black, 0, 0.045, 0.16); return 0.2; },
  glock(g) { b(g, 0.034, 0.12, 0.05, mats.black, 0, -0.04, 0, 0.3); b(g, 0.034, 0.04, 0.19, mats.black, 0, 0.035, 0.055); b(g, 0.01, 0.03, 0.04, mats.black, 0, -0.005, 0.03); return 0.16; },
  deagle(g) { b(g, 0.04, 0.14, 0.06, mats.dark, 0, -0.05, 0, 0.2); b(g, 0.042, 0.06, 0.28, mats.silver, 0, 0.045, 0.08); b(g, 0.02, 0.01, 0.26, mats.silver, 0, 0.08, 0.08); return 0.23; },
  ak47(g) {
    b(g, 0.05, 0.08, 0.35, mats.black, 0, 0.03, 0.12);           // receiver
    b(g, 0.045, 0.07, 0.3, mats.wood, 0, 0.0, -0.18, -0.05);    // stock
    b(g, 0.045, 0.06, 0.2, mats.wood, 0, 0.0, 0.38);             // handguard
    c(g, 0.011, 0.34, mats.black, 0, 0.035, 0.45);               // barrel
    b(g, 0.035, 0.16, 0.06, mats.black, 0, -0.1, 0.18, 0.35);    // curved mag
    b(g, 0.035, 0.1, 0.045, mats.wood, 0, -0.07, 0.0, 0.3);      // grip
    b(g, 0.01, 0.05, 0.01, mats.black, 0, 0.08, 0.72);           // front sight
    return 0.8;
  },
  m4a1(g) {
    b(g, 0.05, 0.08, 0.32, mats.black, 0, 0.03, 0.12);
    b(g, 0.045, 0.07, 0.26, mats.dark, 0, 0.01, -0.16);
    b(g, 0.055, 0.065, 0.24, mats.dark, 0, 0.03, 0.38);
    c(g, 0.01, 0.3, mats.black, 0, 0.035, 0.5);
    b(g, 0.035, 0.15, 0.055, mats.dark, 0, -0.1, 0.17);
    b(g, 0.035, 0.1, 0.045, mats.black, 0, -0.07, 0.0, 0.3);
    b(g, 0.03, 0.03, 0.12, mats.black, 0, 0.09, 0.1);            // carry rail
    c(g, 0.02, 0.07, mats.black, 0, 0.1, 0.02);                  // optic
    return 0.8;
  },
  bolt(g) {
    b(g, 0.05, 0.08, 0.4, mats.olive, 0, 0.02, 0.1);
    b(g, 0.05, 0.1, 0.34, mats.olive, 0, -0.01, -0.22);
    c(g, 0.012, 0.6, mats.black, 0, 0.035, 0.3);
    c(g, 0.03, 0.26, mats.black, 0, 0.11, -0.02);
    c(g, 0.032, 0.01, mats.glass, 0, 0.11, 0.24);
    b(g, 0.035, 0.1, 0.045, mats.olive, 0, -0.07, 0.0, 0.3);
    b(g, 0.03, 0.06, 0.05, mats.black, 0, -0.06, 0.16);
    return 0.9;
  },
  semisniper(g) {
    b(g, 0.05, 0.08, 0.38, mats.black, 0, 0.02, 0.1);
    b(g, 0.045, 0.08, 0.3, mats.dark, 0, 0.0, -0.2);
    c(g, 0.011, 0.5, mats.black, 0, 0.035, 0.28);
    c(g, 0.028, 0.22, mats.black, 0, 0.105, 0.0);
    c(g, 0.03, 0.01, mats.glass, 0, 0.105, 0.22);
    b(g, 0.035, 0.14, 0.05, mats.black, 0, -0.1, 0.17);
    b(g, 0.035, 0.1, 0.045, mats.black, 0, -0.07, 0.0, 0.3);
    return 0.78;
  },
  knife(g) { b(g, 0.025, 0.035, 0.11, mats.black, 0, 0, 0); b(g, 0.006, 0.03, 0.17, mats.blade, 0, 0.004, 0.14); b(g, 0.04, 0.012, 0.02, mats.dark, 0, 0, 0.055); return 0.23; },
};

const cache = new Map();
export function weaponModel(id) {
  if (!builders[id]) return null;
  if (!cache.has(id)) {
    const g = new THREE.Group();
    const muzzle = builders[id](g);
    g.userData.muzzle = muzzle;
    g.name = 'weapon_' + id;
    cache.set(id, g);
  }
  const m = cache.get(id).clone();
  m.userData.muzzle = cache.get(id).userData.muzzle;
  return m;
}
