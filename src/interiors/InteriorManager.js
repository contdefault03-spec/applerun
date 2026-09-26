import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getLayout } from '../../shared/map/layout.js';
import { interiorOrigin, INTERIOR_TYPE, RESIDENTIAL } from '../../shared/interiors.js';
import { mulberry32 } from '../../shared/rng.js';
import { Prefabs, mat } from './furniture.js';

// Modular interior generator + enter/exit logic. Every building on the map is enterable:
// its interior is generated on demand from reusable room layouts and furniture prefabs,
// placed in its own slot far outside the city (see shared/interiors.js).
export const DOME_ID = 1000;
const NAMES = {
  house: 'House', apartment: 'Apartment', safehouse: 'Your Safehouse', office: 'Office', shop: '24/7 Mart', restaurant: 'Diner', bar: 'The Rusty Bar',
  gunstore: 'Applerun Guns', police: 'Police Station', hospital: 'Applerun General Hospital', gym: 'Iron Gym', garage: 'Garage', warehouse: 'Warehouse', dome: 'Applerun Dome',
  nightclub: 'Neon Club', hotel: 'Seabreeze Hotel',
  clinic: 'Applerun Clinic', dentist: 'Bright Smile Dental', pharmacy: 'City Pharmacy', supermarket: 'Fresh Mart',
  barber: 'Sharp Cuts Barber', bank: 'Applerun Trust Bank', arcade: 'Pixel Palace Arcade',
  cinema: 'Starlight Cinema', concert: 'The Roost Concert Hall',
};
const WALL = { house: ['#e8dcc8', '#cfe3d4', '#dcd3ea'], apartment: ['#e6e1d6', '#d9e6ef'], safehouse: ['#d7e3e8'], office: ['#eceff1'], shop: ['#f5f5f5'], restaurant: ['#f3dcc2'], bar: ['#6d4c41'], gunstore: ['#8d8378'], police: ['#dfe6ee'], hospital: ['#f4f8fb'], gym: ['#cfd8dc'], garage: ['#9ea7ad'], warehouse: ['#9aa0a6'], dome: ['#2b2d42'], nightclub: ['#170022', '#1c0b2e'], hotel: ['#f2ede0'],
  clinic: ['#eaf6f4'], dentist: ['#eaf7fc'], pharmacy: ['#f0f8f0'], supermarket: ['#f7f7f7'], barber: ['#20222a'], bank: ['#e9e4d4'], arcade: ['#150826', '#1c0f33'], cinema: ['#160820'], concert: ['#0c0a16'] };
const FLOOR = { house: '#a1795a', apartment: '#b08968', safehouse: '#8d6e63', office: '#90a4ae', shop: '#e0e0e0', restaurant: '#8d6e63', bar: '#5d4037', gunstore: '#616161', police: '#b0bec5', hospital: '#e3eef5', gym: '#37474f', garage: '#757575', warehouse: '#7d7d7d', dome: '#1b1d2e', nightclub: '#0e0616', hotel: '#c9a876',
  clinic: '#d8ece8', dentist: '#d8eef7', pharmacy: '#dcefe0', supermarket: '#cfcfcf', barber: '#2a2c36', bank: '#8a7a4a', arcade: '#100620', cinema: '#2a0a1a', concert: '#151020' };

export class InteriorManager {
  constructor(game) {
    this.game = game;
    this.layout = getLayout();
    this.interiors = new Map();
    this.current = null;
    this.pool = [0, 1, 2].map((i) => game.lights.point('interior' + i, { color: '#fff1dd', decay: 1 }));
    this.fade = document.createElement('div');
    Object.assign(this.fade.style, { position: 'fixed', inset: 0, background: '#000', opacity: 0, transition: 'opacity .25s', pointerEvents: 'none', zIndex: 20 });
    document.body.append(this.fade);
    // door lookup grid
    this.doorGrid = new Map();
    const add = (id, x, z) => { const k = `${Math.floor(x / 10)},${Math.floor(z / 10)}`; (this.doorGrid.get(k) || this.doorGrid.set(k, []).get(k)).push({ id, x, z }); };
    for (const b of this.layout.buildings) add(b.id, b.door.x, b.door.z);
    const dm = this.layout.landmarks.dome;
    this.domeDoor = { x: dm.x, z: dm.z - dm.hz - 1.5, rot: Math.PI };
    add(DOME_ID, this.domeDoor.x, this.domeDoor.z);
  }

  typeOf(bid) { if (bid === DOME_ID) return 'dome'; return INTERIOR_TYPE[this.layout.buildings[bid].type] || 'house'; }
  building(bid) { return bid === DOME_ID ? { id: DOME_ID, type: 'dome', door: this.domeDoor, special: 'dome' } : this.layout.buildings[bid]; }

  nearestDoor(x, z, maxD = 2.6) {
    let best = null, bd = maxD;
    const ci = Math.floor(x / 10), cj = Math.floor(z / 10);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (const d of this.doorGrid.get(`${i},${j}`) || []) {
      const dd = Math.hypot(d.x - x, d.z - z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  get(bid) {
    if (!this.interiors.has(bid)) this.interiors.set(bid, this.build(bid));
    return this.interiors.get(bid);
  }

  // ------------------------------------------------------------------ building
  build(bid) {
    const type = this.typeOf(bid);
    const o = interiorOrigin(bid);
    const rnd = mulberry32(bid * 7919 + 13);
    const g = new THREE.Group();
    g.name = 'interior_' + bid;
    g.position.set(o.x, 0, o.z);
    g.visible = false;
    this.game.engine.scene.add(g);
    const size = { house: [14, 12], apartment: [12, 10], safehouse: [14, 12], office: [18, 14], shop: [14, 11], restaurant: [16, 12], bar: [14, 11], nightclub: [20, 16], hotel: [20, 15], gunstore: [13, 10], police: [22, 15], hospital: [22, 15], gym: [18, 14], garage: [16, 12], warehouse: [26, 18], dome: [34, 28],
      clinic: [15, 11], dentist: [14, 11], pharmacy: [13, 10], supermarket: [18, 14], barber: [11, 9], bank: [16, 12], arcade: [16, 13], cinema: [22, 18], concert: [30, 24] }[type] || [12, 10];
    const [W, D] = size;
    const H = type === 'warehouse' || type === 'dome' ? 7 : type === 'cinema' ? 9 : type === 'concert' ? 11 : type === 'gym' || type === 'garage' ? 5 : 3.2;
    const it = { bid, type, name: NAMES[type] || 'Building', group: g, origin: o, W, D, H, colliders: [], seats: [], uses: [], npcSpots: [], lights: [], residential: RESIDENTIAL.has(type) };
    const b = this.building(bid);
    if (b.special === 'safehouse') { it.type = 'safehouse'; it.name = NAMES.safehouse; it.residential = false; it.owned = true; }
    const wallC = WALL[type] ? WALL[type][Math.floor(rnd() * WALL[type].length)] : '#e0e0e0';
    // floor / ceiling
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat(FLOOR[type] || '#9e9e9e', { roughness: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    if (type !== 'dome') { const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), mat('#f5f5f5')); ceil.rotation.x = Math.PI / 2; ceil.position.y = H; g.add(ceil); }
    else { const ceil = new THREE.Mesh(new THREE.SphereGeometry(W * 0.62, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat('#1f2133', { side: THREE.BackSide })); ceil.scale.y = 0.5; ceil.position.y = H - 1; g.add(ceil); }
    // outer walls (door gap in +Z wall)
    const wallMat = mat(wallC, { roughness: 0.9 });
    const addWall = (x, z, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, H, d), wallMat);
      m.position.set(x, H / 2, z); m.receiveShadow = true; g.add(m);
      it.colliders.push({ x, z, hx: w / 2, hz: d / 2, h: H + 1 });
    };
    const doorW = type === 'garage' || type === 'warehouse' || type === 'dome' ? 4 : 1.6;
    addWall(0, -D / 2, W, 0.3);
    addWall(-W / 2, 0, 0.3, D); addWall(W / 2, 0, 0.3, D);
    addWall(-(W / 4 + doorW / 4), D / 2, W / 2 - doorW / 2, 0.3);
    addWall(W / 4 + doorW / 4, D / 2, W / 2 - doorW / 2, 0.3);
    // exit door visual
    const door = new THREE.Mesh(new THREE.PlaneGeometry(doorW, 2.3), mat('#4e342e'));
    door.position.set(0, 1.15, D / 2 - 0.02); door.rotation.y = Math.PI; g.add(door);
    const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.25), new THREE.MeshStandardMaterial({ color: '#1b5e20', emissive: '#00e676', emissiveIntensity: 1 }));
    exitSign.position.set(0, 2.55, D / 2 - 0.2); exitSign.rotation.y = Math.PI; g.add(exitSign);
    it.exit = { x: 0, z: D / 2 - 0.6 };
    it.entry = { x: 0, z: D / 2 - 1.6, yaw: Math.PI };
    // windows (emissive panes)
    const win = new THREE.MeshStandardMaterial({ color: '#9fd3ff', emissive: '#bfe6ff', emissiveIntensity: 0.6 });
    if (type !== 'dome' && type !== 'warehouse') for (let x = -W / 2 + 2.5; x < W / 2 - 2; x += 3.5) { const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), win); w.position.set(x, 1.8, -D / 2 + 0.17); g.add(w); }
    // lights
    const nl = Math.max(1, Math.min(3, Math.round((W * D) / 110)));
    for (let i = 0; i < nl; i++) {
      // light slot: a pooled PointLight is moved here while this interior is occupied
      const L = new THREE.Object3D();
      L.userData = { intensity: type === 'bar' ? 4 : 6, distance: Math.max(W, D) * 1.2 };
      L.position.set(-W / 2 + (W / (nl + 1)) * (i + 1), H - 0.4, 0);
      g.add(L); it.lights.push(L);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.6), new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff4e0', emissiveIntensity: 1 }));
      panel.rotation.x = Math.PI / 2; panel.position.set(L.position.x, H - 0.02, 0); g.add(panel);
    }
    // furniture helper (local coords)
    const place = (pf, x, z, rot = 0) => {
      pf.obj.position.set(x, 0, z); pf.obj.rotation.y = rot; g.add(pf.obj);
      const c = Math.cos(rot), s = Math.sin(rot);
      for (const bx of pf.boxes || []) it.colliders.push({ x: x + bx.x * c + bx.z * s, z: z - bx.x * s + bx.z * c, hx: bx.hx, hz: bx.hz, rot, h: bx.h, walk: bx.walk });
      for (const st of pf.seats || []) it.seats.push({ x: x + st.x * c + st.z * s, z: z - st.x * s + st.z * c, rot: rot + st.rot, y: st.y, kind: st.kind || 'sit' });
      for (const u of pf.uses || []) it.uses.push({ ...u, x: x + u.x * c + u.z * s, z: z - u.x * s + u.z * c });
      return pf;
    };
    const partition = (x, z, w, d, gapAt = null, gap = 1.2) => {
      if (gapAt === null) return addWall(x, z, w, d);
      if (w > d) { const l = gapAt - (x - w / 2) - gap / 2, r = x + w / 2 - gapAt - gap / 2; if (l > 0.1) addWall(x - w / 2 + l / 2, z, l, d); if (r > 0.1) addWall(x + w / 2 - r / 2, z, r, d); }
      else { const l = gapAt - (z - d / 2) - gap / 2, r = z + d / 2 - gapAt - gap / 2; if (l > 0.1) addWall(x, z - d / 2 + l / 2, w, l); if (r > 0.1) addWall(x, z + d / 2 - r / 2, w, r); }
    };
    const sofaC = ['#6b4f3a', '#37474f', '#5c6bc0', '#8d6e63', '#4e6e58'][Math.floor(rnd() * 5)];
    switch (it.type) {
      case 'house': case 'safehouse': case 'apartment': {
        const apt = it.type === 'apartment';
        // living room front-left, kitchen front-right, bedroom back-left, bath back-right
        partition(0, -D / 2 + D * 0.45, W, 0.2, -W / 4, 1.3);
        partition(W * 0.08, D * 0.05, 0.2, D * 0.9, apt ? 0.8 : 1.5, 1.3);
        place(Prefabs.rug(2.6, 1.8), -W / 4, D / 4);
        place(Prefabs.sofa(sofaC), -W / 4, D / 4 + 1.3, Math.PI);
        place(Prefabs.tv(), -W / 4, D / 4 - 1.4, 0);
        place(Prefabs.armchair(sofaC), -W / 2 + 1, D / 4, Math.PI / 2);
        place(Prefabs.lamp(), -W / 2 + 0.7, D / 2 - 1);
        place(Prefabs.plant(), -0.8, D / 2 - 1);
        place(Prefabs.kitchen(2.4), W / 4 + 0.2, -0.3, 0);
        place(Prefabs.table(1.4, 0.9), W / 4, D / 4 + 0.6);
        place(Prefabs.chair(), W / 4 - 0.4, D / 4 + 1.3, Math.PI); place(Prefabs.chair(), W / 4 + 0.4, D / 4 + 1.3, Math.PI);
        place(Prefabs.chair(), W / 4 - 0.4, D / 4 - 0.1, 0); place(Prefabs.chair(), W / 4 + 0.4, D / 4 - 0.1, 0);
        place(Prefabs.bed(['#3f6ea8', '#a83f5a', '#3fa87b'][Math.floor(rnd() * 3)]), -W / 4, -D / 2 + 1.4, 0);
        place(Prefabs.bookshelf(), -W / 2 + 0.3, -D / 2 + 3, Math.PI / 2);
        place(Prefabs.lamp(), -W / 4 + 1.4, -D / 2 + 0.6);
        place(Prefabs.toilet(), W / 2 - 0.6, -D / 2 + 0.6, 0);
        place(Prefabs.bathtub(), W * 0.08 + 1, -D / 2 + 1.1, 0);
        it.npcSpots.push({ x: -W / 4 - 0.5, z: D / 4 + 1.2, role: 'resident', sit: true }, { x: W / 4, z: 1, role: 'resident' });
        if (it.type === 'safehouse') it.uses.push({ x: -W / 4, z: -D / 2 + 2.8, kind: 'save', label: 'Sleep & save (restore health)' });
        break;
      }
      case 'shop': {
        for (let i = 0; i < 3; i++) place(Prefabs.shelf(W * 0.45, bid + i), -W * 0.12, -D / 2 + 2.2 + i * 2.2);
        place(Prefabs.counter(3.2), W / 2 - 2.2, D / 2 - 2.8, Math.PI / 2);
        place(Prefabs.shelf(3, bid + 9), W / 2 - 0.4, -D / 2 + 2.5, -Math.PI / 2);
        it.npcSpots.push({ x: W / 2 - 1.2, z: D / 2 - 2.8, role: 'shopkeeper', yaw: -Math.PI / 2, fixed: true }, { x: -W * 0.12, z: -1, role: 'civilian' });
        it.uses.push({ x: W / 2 - 3.1, z: D / 2 - 2.8, kind: 'rob', label: 'Rob the register (crime!)' }, { x: W / 2 - 3.1, z: D / 2 - 3.8, kind: 'snack', label: 'Buy a snack ($10, +health)' });
        break;
      }
      case 'restaurant': case 'bar': {
        const bar = it.type === 'bar';
        place(Prefabs.counter(W * 0.5, bar ? '#4e342e' : '#a1887f'), 0, -D / 2 + 1.6);
        for (let i = 0; i < 5; i++) place(Prefabs.barStool(), -W * 0.2 + i * W * 0.1, -D / 2 + 2.5);
        for (let i = 0; i < 4; i++) {
          const x = -W / 2 + 2.5 + (i % 2) * (W - 5), z = -0.5 + Math.floor(i / 2) * 3.5;
          place(Prefabs.table(1.2, 1.2, bar ? '#3e2723' : '#8d6e63'), x, z);
          place(Prefabs.chair(), x, z + 0.95, Math.PI); place(Prefabs.chair(), x, z - 0.95, 0);
        }
        it.npcSpots.push({ x: 0, z: -D / 2 + 0.8, role: 'shopkeeper', yaw: 0, fixed: true }, { x: -W / 2 + 2.5, z: 0.45, role: 'civilian', sit: true }, { x: W / 2 - 2.5, z: 3.95, role: 'civilian', sit: true });
        it.uses.push({ x: 0, z: -D / 2 + 2.6, kind: 'snack', label: bar ? 'Order a drink ($15)' : 'Order food ($15, +health)' });
        if (bar) it.uses.push({ x: W * 0.25, z: -D / 2 + 2.6, kind: 'rob', label: 'Rob the bar (crime!)' });
        else {
          // Dolma on the counter (supplied dolma.glb) — a real purchasable food item, not a snack shortcut
          const dolmaGltf = this.game.assets.gltf('dolma');
          if (dolmaGltf) {
            const dolma = dolmaGltf.scene.clone(true);
            const scale = 0.36 / Math.max(0.001, 0.98); // native model is ~1m across; shrink to plate size
            dolma.scale.setScalar(scale);
            dolma.position.set(-W * 0.2, 0.95, -D / 2 + 1.75);
            g.add(dolma);
            it.dolmaMesh = dolma;
          }
          it.uses.push({ x: -W * 0.2, z: -D / 2 + 2.6, kind: 'dolma', label: 'Buy a dolma ($12, +20 health)' });
        }
        break;
      }
      case 'nightclub': {
        place(Prefabs.counter(W * 0.35, '#12001f'), -W / 2 + 2.2, D / 2 - 2, Math.PI / 2);
        // DJ booth against the back wall
        const booth = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.6), mat('#1a0a26'));
        booth.position.set(0, 0.5, -D / 2 + 1.2); g.add(booth);
        it.colliders.push({ x: 0, z: -D / 2 + 1.2, hx: 1.5, hz: 0.8, h: 1 });
        it.djBooth = { x: 0, z: -D / 2 + 1.2 };
        // dance floor: a grid of small emissive tiles, colour-cycled in update()
        it.discoTiles = [];
        const tileN = 5;
        for (let i = 0; i < tileN; i++) for (let j = 0; j < tileN; j++) {
          const tm = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ff2fd6', emissiveIntensity: 0.8 });
          const tile = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), tm);
          tile.rotation.x = -Math.PI / 2;
          tile.position.set((i - (tileN - 1) / 2) * 1.5, 0.02, (j - (tileN - 1) / 2) * 1.5 + 1.5);
          g.add(tile);
          it.discoTiles.push({ mesh: tile, phase: (i + j) * 0.6 });
        }
        it.colliders.push({ x: 0, z: 1.5, hx: tileN * 0.8, hz: tileN * 0.8, h: 0.1, walk: true });
        for (let i = 0; i < 6; i++) place(Prefabs.barStool(), -W / 2 + 1.2, D / 2 - 3.3 + i * 0.9);
        it.npcSpots.push({ x: -W / 2 + 1.6, z: D / 2 - 2, role: 'shopkeeper', yaw: Math.PI / 2, fixed: true, name: 'Bartender' });
        for (let i = 0; i < 5; i++) it.npcSpots.push({ x: (Math.sin(i * 2.1) * tileN * 0.6), z: 1.5 + Math.cos(i * 1.7) * tileN * 0.6, role: 'civilian', name: 'Patron' });
        it.uses.push({ x: -W / 2 + 2.2, z: D / 2 - 2, kind: 'snack', label: 'Order a drink ($15)' });
        break;
      }
      case 'hotel': {
        // Reception (front), small restaurant corner (front-right), a decorated room (back)
        partition(0, -D / 2 + D * 0.42, W, 0.2, W * 0.3, 1.4);
        place(Prefabs.counter(3.4, '#5d4037'), -W / 4, -D / 2 + 1.6);
        place(Prefabs.plant(), -W / 2 + 1, -D / 2 + 1);
        place(Prefabs.sofa('#8d6e63'), W / 2 - 2, -D / 2 + 1.6, Math.PI);
        for (let i = 0; i < 3; i++) { const x = W / 4 - 2 + i * 2, z = -D * 0.15; place(Prefabs.table(1, 1, '#a1887f'), x, z); place(Prefabs.chair(), x, z + 0.85, Math.PI); place(Prefabs.chair(), x, z - 0.85, 0); }
        place(Prefabs.bed('#5c6bc0'), 0, D / 2 - 2.6, Math.PI);
        place(Prefabs.lamp(), -W / 2 + 1, D / 2 - 1);
        place(Prefabs.plant(), W / 2 - 1, D / 2 - 1);
        place(Prefabs.bookshelf(), W / 2 - 0.3, D / 2 - 4, -Math.PI / 2);
        it.npcSpots.push({ x: -W / 4, z: -D / 2 + 1.6, role: 'shopkeeper', yaw: 0, fixed: true, name: 'Receptionist' }, { x: W / 2 - 2, z: -D / 2 + 1.9, role: 'civilian', sit: true });
        it.uses.push(
          { x: -W / 4, z: -D / 2 + 3.2, kind: 'hotelCheckin', label: 'Check in ($60, a room for the night)' },
          { x: W / 4, z: -D * 0.15 - 0.85, kind: 'snack', label: 'Order room service ($15, +health)' },
          { x: 0, z: D / 2 - 3.6, kind: 'hotelroom', label: 'Sleep & save (your room)' },
        );
        break;
      }
      case 'clinic': case 'dentist': {
        const dental = it.type === 'dentist';
        place(Prefabs.counter(3, '#eceff1'), 0, -D / 2 + 2);
        for (let i = 0; i < 3; i++) { place(Prefabs.chair(dental ? '#4fc3f7' : '#80cbc4'), -W / 2 + 1.5 + i * 1.6, -D / 2 + 3.6, Math.PI); }
        place(Prefabs.hospitalBed(), W / 4, D / 4, 0);
        place(Prefabs.bookshelf(), W / 2 - 0.3, -D / 2 + 2, -Math.PI / 2);
        it.npcSpots.push({ x: 0, z: -D / 2 + 1.2, role: 'medic', yaw: 0, fixed: true, name: dental ? 'Dental Nurse' : 'Nurse' }, { x: -W / 2 + 1.5, z: -D / 2 + 3.6, role: 'civilian', sit: true });
        it.uses.push({ x: 0, z: -D / 2 + 2.8, kind: 'heal', label: dental ? 'Get a checkup ($100, full health)' : 'Get treated ($100, full health)' });
        break;
      }
      case 'pharmacy': {
        for (let i = 0; i < 3; i++) place(Prefabs.shelf(W * 0.4, i), -W * 0.15, -D / 2 + 2 + i * 2);
        place(Prefabs.counter(2.6, '#eceff1'), W / 2 - 2, D / 2 - 2.4, Math.PI / 2);
        it.npcSpots.push({ x: W / 2 - 1.3, z: D / 2 - 2.4, role: 'medic', yaw: -Math.PI / 2, fixed: true, name: 'Pharmacist' });
        it.uses.push({ x: W / 2 - 3.2, z: D / 2 - 2.4, kind: 'heal', label: 'Buy medicine ($100, full health)' });
        break;
      }
      case 'supermarket': {
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) place(Prefabs.shelf(W * 0.32, i + j * 4), -W / 2 + 2.2 + i * (W - 4) / 3, -D / 2 + 2.5 + j * (D - 5), j ? Math.PI : 0);
        place(Prefabs.counter(3.2, '#c62828'), W / 2 - 2.2, D / 2 - 1.6, Math.PI / 2);
        it.npcSpots.push({ x: W / 2 - 1.2, z: D / 2 - 1.6, role: 'shopkeeper', yaw: -Math.PI / 2, fixed: true, name: 'Cashier' }, { x: 0, z: 0, role: 'civilian' });
        it.uses.push({ x: W / 2 - 3.4, z: D / 2 - 1.6, kind: 'grocery', label: 'Buy groceries ($8, +health)' }, { x: W / 2 - 3.4, z: D / 2 - 2.6, kind: 'rob', label: 'Rob the till (crime!)' });
        break;
      }
      case 'barber': {
        for (let i = 0; i < 2; i++) {
          const x = -W / 4 + i * W / 2;
          place(Prefabs.armchair('#c62828'), x, -D / 2 + 2.5, 0);
          const mirror = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.5), mat('#b0d8e0', { metalness: 0.5, roughness: 0.1 }));
          mirror.position.set(x, 1.5, -D / 2 + 0.15); g.add(mirror);
        }
        place(Prefabs.bookshelf(), W / 2 - 0.3, D / 2 - 2, -Math.PI / 2);
        it.npcSpots.push({ x: -W / 4, z: -D / 2 + 2.5, role: 'worker', name: 'Barber' });
        it.uses.push({ x: 0, z: -D * 0.1, kind: 'haircut', label: 'Get a haircut ($15, just for fun)' });
        break;
      }
      case 'bank': {
        place(Prefabs.counter(W * 0.5, '#8a7a4a'), 0, -D / 2 + 2.4);
        const vault = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.6, 16), mat('#455a64', { metalness: 0.7, roughness: 0.3 }));
        vault.rotation.z = Math.PI / 2; vault.position.set(0, 1.3, D / 2 - 1.5); g.add(vault);
        it.colliders.push({ x: 0, z: D / 2 - 1.5, hx: 1.3, hz: 1.3, h: 2.6 });
        for (let i = 0; i < 2; i++) place(Prefabs.desk(), -W / 2 + 2.5 + i * 4, 0.5);
        it.npcSpots.push({ x: 0, z: -D / 2 + 1.8, role: 'shopkeeper', yaw: 0, fixed: true, name: 'Bank Teller' }, { x: -W / 2 + 2.5, z: 0.5, role: 'civilian' });
        it.uses.push({ x: 0, z: -D / 2 + 3.4, kind: 'atm', label: 'Check balance' });
        break;
      }
      case 'arcade': {
        const cabCols = ['#e91e63', '#00bcd4', '#ffc107', '#8bc34a', '#673ab7'];
        let ci = 0;
        for (let side = -1; side <= 1; side += 2) for (let i = 0; i < 4; i++) {
          const x = side * (W / 2 - 0.6), z = -D / 2 + 2 + i * 2.2;
          const cab = mergeGeometries([
            new THREE.BoxGeometry(0.8, 1.9, 0.7).translate(0, 0.95, 0),
            new THREE.BoxGeometry(0.6, 0.4, 0.05).translate(0, 1.5, side * -0.36),
          ]);
          const m = new THREE.Mesh(cab, mat(cabCols[ci % cabCols.length], { emissive: cabCols[ci % cabCols.length], emissiveIntensity: 0.3 }));
          m.position.set(x, 0, z); m.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(m); ci++;
          it.colliders.push({ x, z, hx: 0.4, hz: 0.35, h: 1.9 });
        }
        it.npcSpots.push({ x: 0, z: 0, role: 'civilian' }, { x: -1.5, z: 1, role: 'civilian' });
        it.uses.push({ x: 0, z: -D / 2 + 2, kind: 'arcade', label: 'Play a game ($5, small chance to win big)' });
        break;
      }
      case 'gunstore': {
        place(Prefabs.counter(W * 0.6, '#5d4037'), 0, -D / 2 + 2.6);
        const models = this.game.weapons ? this.game.weapons.displayModels() : [];
        place(Prefabs.gunrack(models.slice(0, 8)), 0, -D / 2 + 0.3);
        place(Prefabs.gunrack(models.slice(2, 10)), -W / 2 + 0.3, 0, Math.PI / 2);
        place(Prefabs.crate(1, '#556b2f'), W / 2 - 1.2, 1); place(Prefabs.crate(1, '#556b2f'), W / 2 - 1.2, 2.2);
        it.npcSpots.push({ x: 0, z: -D / 2 + 1.5, role: 'shopkeeper', yaw: 0, fixed: true, name: 'Gunsmith' });
        it.uses.push({ x: 0, z: -D / 2 + 3.6, kind: 'gunshop', label: 'Browse weapons & ammo' });
        break;
      }
      case 'police': {
        place(Prefabs.counter(5, '#37474f'), 0, D / 2 - 4, 0);
        for (let i = 0; i < 4; i++) place(Prefabs.desk(), -W / 2 + 2.5 + (i % 2) * 4, -1 + Math.floor(i / 2) * 3, 0);
        place(Prefabs.cell(), W / 2 - 2.2, -D / 2 + 1.8); place(Prefabs.cell(), W / 2 - 5.6, -D / 2 + 1.8);
        place(Prefabs.bookshelf(), -W / 2 + 0.3, -D / 2 + 2, Math.PI / 2);
        it.npcSpots.push({ x: 0, z: D / 2 - 5, role: 'police', yaw: 0, fixed: true, name: 'Desk Sergeant' }, { x: -W / 2 + 2.5, z: -0.4, role: 'police', sit: true }, { x: 2, z: 1, role: 'police' });
        it.uses.push({ x: 0, z: D / 2 - 2.8, kind: 'surrender', label: 'Turn yourself in (clear wanted level, pay fine)' }, { x: 1.5, z: D / 2 - 2.8, kind: 'policejob', label: 'Sign up for police duty' });
        it.cellSpot = { x: W / 2 - 2.2, z: -D / 2 + 1.2 };
        break;
      }
      case 'hospital': {
        place(Prefabs.counter(4, '#eceff1'), 0, D / 2 - 4);
        for (let i = 0; i < 6; i++) place(Prefabs.hospitalBed(), -W / 2 + 2 + (i % 3) * 3.2, -D / 2 + 2 + Math.floor(i / 3) * 4.5, 0);
        it.npcSpots.push({ x: 0, z: D / 2 - 5, role: 'medic', yaw: 0, fixed: true, name: 'Nurse' }, { x: 3, z: 0, role: 'medic' }, { x: -W / 2 + 2, z: -D / 2 + 1.9, role: 'civilian', lie: true });
        it.uses.push({ x: 0, z: D / 2 - 2.8, kind: 'heal', label: 'Get treated ($100, full health)' });
        break;
      }
      case 'gym': {
        for (let i = 0; i < 3; i++) place(Prefabs.weights(), -W / 2 + 2.5 + i * 2.6, -D / 2 + 1.8);
        for (let i = 0; i < 3; i++) place(Prefabs.treadmill(), W / 2 - 1.5 - i * 1.4, -D / 2 + 1.6);
        // sparring ring (visual)
        const ring = new THREE.Group();
        const mt = new THREE.Mesh(new THREE.BoxGeometry(5, 0.5, 5), mat('#1565c0')); mt.position.y = 0.25; ring.add(mt);
        for (const [x, z] of [[-2.4, -2.4], [2.4, -2.4], [2.4, 2.4], [-2.4, 2.4]]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.6), mat('#eeeeee')); p.position.set(x, 1.1, z); ring.add(p); }
        ring.position.set(-2, 0, 2.5); g.add(ring);
        it.colliders.push({ x: -2, z: 2.5, hx: 2.5, hz: 2.5, h: 0.5, walk: true });
        it.npcSpots.push({ x: 3, z: 2, role: 'athlete', name: 'Coach' }, { x: -W / 2 + 2.5, z: -D / 2 + 2.4, role: 'athlete' });
        break;
      }
      case 'garage': {
        place(Prefabs.carLift(), -2, -D / 2 + 3);
        for (let i = 0; i < 4; i++) place(Prefabs.crate(1, '#8d6e63'), W / 2 - 1.2, -D / 2 + 1.2 + i * 1.3);
        place(Prefabs.counter(3, '#455a64'), 3, D / 2 - 3);
        it.npcSpots.push({ x: -2, z: -D / 2 + 4.5, role: 'worker', name: 'Mechanic' });
        it.uses.push({ x: 3, z: D / 2 - 2, kind: 'repair', label: 'Repair & respray your last car ($150)' });
        break;
      }
      case 'office': {
        for (let i = 0; i < 8; i++) place(Prefabs.desk(), -W / 2 + 3 + (i % 4) * 3.8, -D / 2 + 3 + Math.floor(i / 4) * 4, 0);
        place(Prefabs.plant(), W / 2 - 1, D / 2 - 1); place(Prefabs.sofa('#455a64'), -W / 2 + 2, D / 2 - 1.5, Math.PI);
        it.npcSpots.push({ x: -W / 2 + 3, z: -D / 2 + 3.6, role: 'civilian', sit: true }, { x: 2, z: 1, role: 'civilian' });
        break;
      }
      case 'warehouse': {
        for (let i = 0; i < 18; i++) { const x = -W / 2 + 2 + (i % 6) * 3.8, z = -D / 2 + 2 + Math.floor(i / 6) * 4; if (rnd() < 0.8) place(Prefabs.crate(1.4 + rnd() * 0.6, ['#a1887f', '#8d6e63', '#6d4c41'][i % 3]), x, z); }
        it.npcSpots.push({ x: 2, z: 3, role: 'worker' }, { x: -4, z: 4, role: 'gang' });
        break;
      }
      case 'cinema': {
        // Entry is near +Z; lobby/ticket counter sits just inside the door, the screening room
        // (screen + seats) fills the rest of the building, screen at the far -Z wall.
        const lobbyZ0 = D / 2 - 3.5;
        partition(0, lobbyZ0, W, 0.2, 0, 1.6);
        place(Prefabs.counter(3, '#4a148c'), 0, D / 2 - 1.8);
        place(Prefabs.plant(), -W / 2 + 1, D / 2 - 1);
        it.npcSpots.push({ x: 0, z: D / 2 - 1.8, role: 'shopkeeper', yaw: Math.PI, fixed: true, name: 'Ticket Clerk' });
        it.uses.push({ x: 0, z: D / 2 - 3.2, kind: 'movieTicket', label: 'Buy a ticket ($10)' });
        const rows = 4, seatsPerRow = 6;
        for (let r = 0; r < rows; r++) for (let sX = 0; sX < seatsPerRow; sX++) {
          const x = -W / 2 + 1.5 + sX * (W - 3) / (seatsPerRow - 1), z = lobbyZ0 - 1.5 - r * 1.4;
          place(Prefabs.chair('#4a148c'), x, z, Math.PI);
          if (rnd() < 0.5) it.npcSpots.push({ x, z: z + 0.35, role: 'civilian', sit: true });
        }
        // screen, at the far wall — sized to actually fit the room's own ceiling height, with
        // headroom above and below (was previously sized from width alone and could poke through
        // a 3.2m ceiling; the room is now tall enough on its own, but this stays height-aware so
        // it can never happen again if the room proportions change).
        const screenBase = 0.6, screenMaxH = H - screenBase - 1.4;
        let screenW = W * 0.85, screenH = screenW * 9 / 16;
        if (screenH > screenMaxH) { screenH = screenMaxH; screenW = screenH * 16 / 9; }
        const screenMat = mat('#0a0a0a', { emissive: '#111111', emissiveIntensity: 0 });
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(screenW, screenH), screenMat);
        screen.position.set(0, screenH / 2 + screenBase, -D / 2 + 0.15); g.add(screen);
        const frame = new THREE.Mesh(new THREE.BoxGeometry(screenW + 0.4, screenH + 0.4, 0.1), mat('#1b1b1b'));
        frame.position.set(0, screenH / 2 + screenBase, -D / 2 + 0.05); g.add(frame);
        it.screen = { mesh: screen, mat: screenMat };
        it.uses.push({ x: 0, z: -D / 2 + 1.3, kind: 'cinemaPlay', label: 'Press E to play/stop the movie' });
        break;
      }
      case 'concert': {
        // Stage at the far wall with a simple fictional band; a big standing crowd facing it,
        // a few benches at the back, and a small backstage nook behind the stage.
        const stageZ = -D / 2 + 3.5, stageW = W * 0.6, stageH = 1.1;
        const stage = new THREE.Mesh(new THREE.BoxGeometry(stageW, stageH, 5), mat('#2a1a0a'));
        stage.position.set(0, stageH / 2, stageZ); g.add(stage);
        it.colliders.push({ x: 0, z: stageZ, hx: stageW / 2, hz: 2.5, h: stageH, walk: true });
        // backstage nook behind the stage
        addWall(0, -D / 2 + 0.6, stageW * 0.7, 0.2);
        // band: simple boxy figures with instrument silhouettes, animated in InteriorManager.update
        const band = [];
        const bandSpec = [
          { x: -2.2, name: 'guitar', color: '#c62828' }, { x: -0.8, name: 'bass', color: '#1565c0' },
          { x: 1.4, name: 'drums', color: '#37474f' }, { x: 2.6, name: 'vocalist', color: '#f9a825' },
        ];
        for (const b2 of bandSpec) {
          const fig = new THREE.Group();
          const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.8, 4, 8), mat('#333'));
          body.position.y = stageH + 0.75; fig.add(body);
          const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), mat('#caa07a'));
          head.position.y = stageH + 1.35; fig.add(head);
          if (b2.name === 'drums') {
            const kit = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.5, 10), mat('#222'));
            kit.position.set(0, stageH + 0.3, -0.4); fig.add(kit);
          } else if (b2.name !== 'vocalist') {
            const guitar = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.6, 0.35), mat(b2.color));
            guitar.position.set(0.2, stageH + 0.55, 0.25); guitar.rotation.z = 0.5; fig.add(guitar);
          } else {
            const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), mat('#111'));
            mic.position.set(0, stageH + 0.9, 0.3); fig.add(mic);
          }
          fig.position.set(b2.x, 0, stageZ + 0.3);
          g.add(fig);
          band.push(fig);
        }
        it.band = band;
        // stage lighting rig
        for (const lx of [-stageW / 3, 0, stageW / 3]) {
          const beam = new THREE.Mesh(new THREE.ConeGeometry(1.6, H - stageH - 0.5, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#ff2fd6', transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
          beam.position.set(lx, (H + stageH) / 2, stageZ + 1); beam.rotation.x = Math.PI; g.add(beam);
          it.stageBeams = it.stageBeams || []; it.stageBeams.push(beam);
        }
        // crowd: a big standing block facing the stage, a few benches at the back
        for (let r = 0; r < 6; r++) for (let cIdx = 0; cIdx < 9; cIdx++) {
          if (rnd() < 0.15) continue;
          const x = -W / 2 + 1.5 + cIdx * (W - 3) / 8, z = stageZ + 4 + r * 1.6;
          it.npcSpots.push({ x, z, role: 'civilian', yaw: 0 });
        }
        it.npcSpots.push({ x: -W / 2 + 2, z: D / 2 - 2, role: 'civilian', sit: true }, { x: W / 2 - 2, z: D / 2 - 2, role: 'civilian', sit: true });
        it.uses.push({ x: 0, z: D / 2 - 1.5, kind: 'concertVibe', label: 'Feel the music' });
        break;
      }
      case 'dome': {
        // wrestling ring in the middle with stands around
        const ring = this.game.activities?.buildRing ? this.game.activities.buildRing() : null;
        if (ring) g.add(ring);
        for (let i = 0; i < 4; i++) { const st = new THREE.Mesh(new THREE.BoxGeometry(i % 2 ? 3 : W - 6, 2 + (i % 2), i % 2 ? D - 6 : 3), mat('#3949ab')); st.position.set(i === 1 ? W / 2 - 2.5 : i === 3 ? -W / 2 + 2.5 : 0, 1, i === 0 ? -D / 2 + 2.5 : i === 2 ? D / 2 - 4 : 0); if (i === 2) st.visible = false; g.add(st); if (i !== 2) it.colliders.push({ x: st.position.x, z: st.position.z, hx: st.geometry.parameters.width / 2, hz: st.geometry.parameters.depth / 2, h: 2.2 }); }
        it.colliders.push({ x: 0, z: 0, hx: 3.6, hz: 3.6, h: 1.2, walk: true, ring: true });
        it.uses.push({ x: 0, z: 5.5, kind: 'wrestling', label: 'Start a wrestling match' });
        it.npcSpots.push({ x: -8, z: -8, role: 'athlete', name: 'Promoter' });
        break;
      }
      default: break;
    }
    // register colliders (world coords)
    it.worldColliders = it.colliders.map((c) => this.game.world.collision.add({ kind: 'interior', x: o.x + c.x, z: o.z + c.z, hx: c.hx, hz: c.hz, rot: c.rot || 0, y0: -1, y1: c.h, walk: !!c.walk, noCamera: false }));
    it.floorAt = () => 0;
    return it;
  }

  // ------------------------------------------------------------------ enter / exit
  async enter(bid) {
    const g = this.game;
    const it = this.get(bid);
    await this.fadeTo(1);
    g.audio.door(g.player.pos);
    if (this.current) this.current.group.visible = false;
    this.current = it;
    it.group.visible = true;
    it.lightsOn = true;
    this.applyLights(it);
    g.world.setOutdoorVisible(false);
    g.engine.scene.fog.density = 0.004;
    g.engine.scene.background = new THREE.Color('#0a0a0f');
    // toggling castShadow would recompile every shader; just stop updating the shadow maps
    g.world.env.setShadowsActive(false);
    g.world.env.hemi.intensity = 0.45;
    const o = it.origin;
    g.player.interior = it;
    g.player.teleport(o.x + it.entry.x, 0, o.z + it.entry.z, it.entry.yaw);
    g.cam.yaw = it.entry.yaw + Math.PI; g.cam.pitch = -0.1;
    g.npcs?.spawnInterior?.(it);
    g.police?.onEnterInterior?.(it);
    for (const s of g.systems) s.onEnterInterior?.(it);
    if (it.type === 'nightclub') { this.discoT = 0; this.clubAudio = g.audio.clubBeat?.(() => ({ x: o.x + it.djBooth.x, y: 1.2, z: o.z + it.djBooth.z })); }
    if (it.type === 'concert') {
      this.discoT = 0;
      g.audio.ensureSample('concert', g.assets.url('concert')).then((ok) => {
        if (ok && this.current === it) this.clubAudio = g.audio.playLoopFrom('concert', { x: o.x, y: 2, z: o.z - it.D / 4 }, { volume: 0.8, ref: 6, max: 30 });
      });
    }
    this.fadeTo(0);
  }
  update(dt) {
    const it = this.current;
    if (!it) return;
    if (it.dolmaMesh && !it.dolmaMesh.visible) {
      it.dolmaRespawnT -= dt;
      if (it.dolmaRespawnT <= 0) it.dolmaMesh.visible = true;
    }
    if (it.type === 'nightclub') {
      this.discoT += dt;
      const hue = (t) => new THREE.Color().setHSL((this.discoT * 0.15 + t) % 1, 0.9, 0.55);
      for (const d of it.discoTiles) d.mesh.material.emissive.copy(hue(d.phase * 0.1));
      for (let i = 0; i < this.pool.length; i++) if (it.lights[i]) this.pool[i].color.copy(hue(i / this.pool.length));
    } else if (it.type === 'concert') {
      this.discoT += dt;
      // stage light colours cycle, roughly "in time" with the beat (bpm-ish pulse, not real
      // audio analysis) — and the band sways so it doesn't read as frozen mannequins
      const hue = (t) => new THREE.Color().setHSL((this.discoT * 0.1 + t) % 1, 0.85, 0.55);
      for (let i = 0; i < this.pool.length; i++) if (it.lights[i]) this.pool[i].color.copy(hue(i / this.pool.length));
      const beat = 0.5 + 0.5 * Math.sin(this.discoT * 6.0);
      for (const beam of it.stageBeams || []) { beam.material.color.copy(hue(beam.position.x * 0.1)); beam.material.opacity = 0.06 + beat * 0.12; }
      for (let i = 0; i < (it.band || []).length; i++) { const fig = it.band[i]; fig.rotation.z = Math.sin(this.discoT * 3 + i) * 0.15; fig.position.y = Math.abs(Math.sin(this.discoT * 6 + i)) * 0.05; }
    }
  }
  /** Cinema screen: press E to play/stop the supplied film as a real video texture, with
   * positional audio at the screen. Lazily creates the <video>/VideoTexture on first play so
   * an unvisited cinema costs nothing. Stops (not just hides) when the player leaves. */
  toggleCinema() {
    const it = this.current;
    if (!it || it.type !== 'cinema' || !it.screen) return;
    const g = this.game;
    if (!it.screen.video) {
      const video = document.createElement('video');
      video.src = g.assets.url('cinemaVideo');
      video.crossOrigin = 'anonymous';
      video.loop = true;
      video.playsInline = true;
      video.muted = true; // unmuted once routed through WebAudio below
      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      it.screen.mat.map = tex;
      it.screen.mat.emissiveMap = tex;
      it.screen.mat.needsUpdate = true;
      it.screen.video = video;
    }
    const video = it.screen.video;
    if (video.paused) {
      g.audio.init().then(() => {
        if (!it.screen.panner && g.audio.ctx) {
          const src = g.audio.ctx.createMediaElementSource(video);
          const p = it.origin, sy = it.screen.mesh.position.y;
          const panner = g.audio.out('sfx', { x: p.x + it.screen.mesh.position.x, y: sy, z: p.z + it.screen.mesh.position.z }, { ref: 4, max: 40 });
          src.connect(panner);
          it.screen.panner = panner;
        }
        video.muted = false;
        video.play().catch(() => {});
      });
      it.screen.mat.emissiveIntensity = 1;
    } else {
      video.pause();
      it.screen.mat.emissiveIntensity = 0;
    }
  }
  stopCinema(it) { if (it?.screen?.video && !it.screen.video.paused) { it.screen.video.pause(); it.screen.mat.emissiveIntensity = 0; } }
  // Move the pooled interior lights into the occupied interior's light slots (or switch them off).
  applyLights(it) {
    for (let i = 0; i < this.pool.length; i++) {
      const L = this.pool[i], slot = it?.lights[i];
      if (!slot || !it.lightsOn) { L.intensity = 0; continue; }
      it.group.updateMatrixWorld(true);
      slot.getWorldPosition(L.position);
      L.intensity = slot.userData.intensity; L.distance = slot.userData.distance;
    }
  }
  toggleLights(it) { it.lightsOn = !it.lightsOn; if (it === this.current) this.applyLights(it); }
  async exit() {
    const g = this.game;
    const it = this.current;
    if (!it) return;
    await this.fadeTo(1);
    g.audio.door(g.player.pos);
    if (this.clubAudio) { this.clubAudio.stop(it.type === 'concert' ? 0.6 : 0); this.clubAudio = null; }
    this.stopCinema(it);
    it.group.visible = false;
    this.current = null;
    this.applyLights(null);
    g.player.interior = null;
    g.world.setOutdoorVisible(true);
    g.engine.scene.fog.density = 0.0009;
    g.engine.scene.background = null;
    g.world.env.setShadowsActive(true);
    const b = this.building(it.bid);
    const d = b.door;
    const out = 1.8;
    const x = d.x + Math.sin(d.rot) * out, z = d.z + Math.cos(d.rot) * out;
    g.player.teleport(x, null, z, d.rot);
    g.cam.yaw = d.rot + Math.PI;
    g.npcs?.despawnInterior?.(it);
    for (const s of g.systems) s.onExitInterior?.(it);
    this.fadeTo(0);
  }
  fadeTo(v) { this.fade.style.opacity = String(v); return new Promise((r) => setTimeout(r, 260)); }

  /** Interaction candidates for the InteractionManager. */
  interactions(out, pos) {
    const g = this.game;
    if (this.current) {
      const it = this.current, o = it.origin;
      const lx = pos.x - o.x, lz = pos.z - o.z;
      if (Math.hypot(lx - it.exit.x, lz - it.exit.z) < 1.8) out.push({ label: 'Exit', key: 'interact', priority: 5, action: () => this.exit() });
      for (const u of it.uses) if (Math.hypot(lx - u.x, lz - u.z) < 1.5) out.push({ label: u.label, key: 'interact', priority: 4, action: () => g.onUse?.(u, it) });
      for (const s of it.seats) if (Math.hypot(lx - s.x, lz - s.z) < 1.2 && !g.seated) out.push({ label: s.kind === 'bed' ? 'Lie down' : 'Sit', key: 'interact', priority: 2, action: () => g.sitOn?.({ x: o.x + s.x, z: o.z + s.z, y: s.y, rot: s.rot, kind: s.kind }) });
      return;
    }
    if (g.vehicles?.current) return;
    const d = this.nearestDoor(pos.x, pos.z, 2.8);
    if (d) {
      const b = this.building(d.id);
      const type = this.typeOf(d.id);
      const name = b.special === 'safehouse' ? 'your safehouse' : (NAMES[type] || 'building').toLowerCase();
      out.push({ label: `Enter ${name}`, key: 'interact', priority: 3, action: () => this.enter(d.id) });
    }
  }
}
