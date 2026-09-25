import * as THREE from 'three';
import { getLayout, WATER_LEVEL, wx, wz } from '../../shared/map/layout.js';
import { heightAt } from '../../shared/map/terrain.js';
import { pitchTexture, courtTexture, signTexture, parkingTexture } from './textures.js';

const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
function box(w, h, d, mat, x, y, z, ry = 0, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

// Unique, hand-built landmark structures from the reference map.
export function buildLandmarks() {
  const L = getLayout();
  const lm = L.landmarks;
  const g = new THREE.Group();
  g.name = 'landmarks';
  const concrete = M('#b9b6ae'), darkConcrete = M('#8a8780'), seatBlue = M('#1f4fa3'), seatWhite = M('#e8e8e8'), steel = M('#9aa3ab', { metalness: 0.6, roughness: 0.4 });

  // ---------------- Stadium (football)
  {
    const st = lm.stadium;
    const s = new THREE.Group();
    s.position.set(st.x, 0, st.z);
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(116, 76), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95 }));
    pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.04; pitch.receiveShadow = true;
    s.add(pitch);
    const run = new THREE.Mesh(new THREE.PlaneGeometry(st.hx * 2 - 20, st.hz * 2 - 20), M('#3b7d3d'));
    run.rotation.x = -Math.PI / 2; run.position.y = 0.02; run.receiveShadow = true; s.add(run);
    // tiered stands on all 4 sides
    const tiers = 7;
    for (const side of [0, 1, 2, 3]) {
      const alongX = side < 2;
      const len = alongX ? st.hx * 2 - 16 : st.hz * 2 - 30;
      const sign = side % 2 ? 1 : -1;
      for (let t = 0; t < tiers; t++) {
        const depth = 2, h = 1.2;
        const off = (alongX ? st.hz : st.hx) - 14 + t * depth;
        const y = 1 + t * h * 1.9;
        const mat = t % 3 === 0 ? seatWhite : seatBlue;
        const bx = box(alongX ? len : depth, h, alongX ? depth : len, mat, alongX ? 0 : sign * off, y, alongX ? sign * off : 0);
        s.add(bx);
      }
      // back wall
      const wall = box(alongX ? len + 4 : 2, 26, alongX ? 2 : len + 4, concrete, alongX ? 0 : sign * (alongX ? st.hz : st.hx), 13, alongX ? sign * (st.hz - 1) : 0);
      if (!alongX) wall.position.x = sign * (st.hx - 1);
      s.add(wall);
      // under-stand fill
      const fill = box(alongX ? len : 14, 12, alongX ? 14 : len, darkConcrete, alongX ? 0 : sign * (st.hx - 7), 6, alongX ? sign * (st.hz - 7) : 0, 0, false);
      fill.scale.y = 1; s.add(fill);
      // roof canopy
      const roof = box(alongX ? len + 4 : 16, 0.6, alongX ? 16 : len + 4, M('#e5e5e5', { roughness: 0.5 }), alongX ? 0 : sign * (st.hx - 8), 27, alongX ? sign * (st.hz - 8) : 0);
      s.add(roof);
    }
    // corner entrance arches (gaps are in the colliders at the midpoints)
    // floodlights
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const pole = box(1, 40, 1, steel, sx * (st.hx - 4), 20, sz * (st.hz - 4));
      const head = box(6, 3, 0.6, M('#dddddd', { emissive: '#fffbe6', emissiveIntensity: 0.3 }), sx * (st.hx - 4), 40, sz * (st.hz - 4), Math.atan2(sx, sz));
      head.userData.lamp = true;
      s.add(pole, head);
    }
    // goals
    const goalMat = M('#ffffff', { roughness: 0.3 });
    const netMat = new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.5 });
    for (const sx of [-1, 1]) {
      const gx = sx * 52.5;
      const goal = new THREE.Group();
      goal.add(box(0.12, 2.44, 0.12, goalMat, 0, 1.22, -3.66), box(0.12, 2.44, 0.12, goalMat, 0, 1.22, 3.66), box(0.12, 0.12, 7.44, goalMat, 0, 2.44, 0));
      const net = new THREE.Mesh(new THREE.BoxGeometry(2, 2.44, 7.32, 4, 6, 12), netMat);
      net.position.set(sx * 1, 1.22, 0);
      goal.add(net);
      goal.position.x = gx;
      s.add(goal);
    }
    // big sign
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(40, 6), new THREE.MeshStandardMaterial({ map: signTexture('APPLERUN STADIUM', '#0d2a5c', '#ffffff'), emissive: '#ffffff', emissiveIntensity: 0.15 }));
    sign.position.set(0, 30, st.hz + 0.2); s.add(sign);
    g.add(s);
  }

  // ---------------- Arena (open-air basketball court)
  {
    const ar = lm.arena;
    const s = new THREE.Group();
    s.position.set(ar.x, 0, ar.z);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ar.hx * 2 - 18, ar.hz * 2 - 18), M('#6c3f23'));
    floor.rotation.x = -Math.PI / 2; floor.position.y = 0.03; floor.receiveShadow = true; s.add(floor);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(28, 15), new THREE.MeshStandardMaterial({ map: courtTexture(), roughness: 0.45 }));
    court.rotation.x = -Math.PI / 2; court.position.y = 0.05; court.receiveShadow = true; s.add(court);
    // stands (matching colliders): 3 tiers
    const at = 9;
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const segW = (ar.hx * 2 - 12) / 2;
      for (let t = 0; t < 3; t++) s.add(box(segW, 1.5 + t * 2.5, 3, t % 2 ? seatWhite : M('#c62828'), sx * (6 + segW / 2), 0.75 + t * 1.25, sz * (ar.hz - at + 1.5 + t * 3)));
    }
    for (const sx of [-1, 1]) for (let t = 0; t < 3; t++) s.add(box(3, 1.5 + t * 2.5, ar.hz * 2 - 2 * at, t % 2 ? seatWhite : M('#c62828'), sx * (ar.hx - at + 1.5 + t * 3), 0.75 + t * 1.25, 0));
    // hoops
    for (const sx of [-1, 1]) s.add(hoop(sx * 12.7, 0, sx));
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(18, 3), new THREE.MeshStandardMaterial({ map: signTexture('APPLERUN ARENA', '#8b1a1a', '#ffffff'), emissive: '#ffffff', emissiveIntensity: 0.15 }));
    sign.position.set(0, 11, -ar.hz - 0.2); sign.rotation.y = Math.PI; s.add(sign);
    g.add(s);
  }

  // ---------------- Street basketball court in the park by the freeway
  {
    const c = lm.basketballCourtPark;
    const s = new THREE.Group();
    s.position.set(c.x, heightAt(c.x, c.z), c.z);
    const court = new THREE.Mesh(new THREE.PlaneGeometry(30, 17), new THREE.MeshStandardMaterial({ map: courtTexture(), roughness: 0.6, color: '#9fb8d8' }));
    court.rotation.x = -Math.PI / 2; court.position.y = 0.06; court.receiveShadow = true; s.add(court);
    for (const sx of [-1, 1]) s.add(hoop(sx * 12.7, 0, sx));
    const fence = new THREE.MeshBasicMaterial({ color: '#555', wireframe: true });
    for (const [w, d, x, z] of [[32, 0.1, 0, -9], [32, 0.1, 0, 9], [0.1, 18, -16, 0], [0.1, 18, 16, 0]]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(w, 3, d, Math.ceil(w), 3, 1), fence); f.position.set(x, 1.5, z); s.add(f);
    }
    g.add(s);
  }

  // ---------------- Dome (wrestling venue)
  {
    const dm = lm.dome;
    const s = new THREE.Group();
    s.position.set(dm.x, 0, dm.z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(dm.hx * 0.98, dm.hx, 10, 40), M('#cfd4da'));
    body.scale.z = dm.hz / dm.hx; body.position.y = 5; body.castShadow = true; body.receiveShadow = true; s.add(body);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(dm.hx * 0.98, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2), M('#e9edf2', { roughness: 0.35, metalness: 0.3 }));
    dome.scale.set(1, 0.35, dm.hz / dm.hx); dome.position.y = 10; dome.castShadow = true; s.add(dome);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(20, 3.2), new THREE.MeshStandardMaterial({ map: signTexture('APPLERUN DOME · WRESTLING', '#4a148c', '#ffeb3b'), emissive: '#ffffff', emissiveIntensity: 0.2 }));
    sign.position.set(0, 7, -dm.hz - 0.3); sign.rotation.y = Math.PI; s.add(sign);
    // entrance
    s.add(box(6, 4, 1, M('#2b2b2b'), 0, 2, -dm.hz + 0.2));
    g.add(s);
  }

  // ---------------- Parking lots
  for (const key of ['parkingStadium', 'parkingArena']) {
    const p = lm[key];
    const t = parkingTexture().clone(); t.needsUpdate = true;
    t.repeat.set(p.hx / 8, 1);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(p.hx * 2, p.hz * 2), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
    m.rotation.x = -Math.PI / 2; m.position.set(p.x, heightAt(p.x, p.z) + 0.05, p.z); m.receiveShadow = true;
    g.add(m);
  }

  // ---------------- Plaza park & fountain plaza
  {
    const p = lm.plazaPark;
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(p.hx * 2, p.hz * 2), M('#5a9446', { roughness: 1 }));
    grass.rotation.x = -Math.PI / 2; grass.position.set(p.x, 0.16, p.z); grass.receiveShadow = true; g.add(grass);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(3, p.hz * 2), M('#c9bca3'));
    path.rotation.x = -Math.PI / 2; path.position.set(p.x, 0.18, p.z); g.add(path);
    const path2 = path.clone(); path2.rotation.z = Math.PI / 2; g.add(path2);
    const f = lm.fountainPlaza;
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(f.hx * 2, f.hz * 2), M('#d8cfbf'));
    plaza.rotation.x = -Math.PI / 2; plaza.position.set(f.x, 0.16, f.z); plaza.receiveShadow = true; g.add(plaza);
    const pool = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.5, 0.8, 32), M('#d0d0d0'));
    pool.position.set(f.x, 0.4, f.z); g.add(pool);
    const water = new THREE.Mesh(new THREE.CircleGeometry(8.6, 32), new THREE.MeshStandardMaterial({ color: '#3fb6d6', roughness: 0.1, metalness: 0.3, emissive: '#0a3a4a', emissiveIntensity: 0.3 }));
    water.rotation.x = -Math.PI / 2; water.position.set(f.x, 0.75, f.z); g.add(water);
    const center = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.4, 3, 12), M('#bcb4a4'));
    center.position.set(f.x, 1.5, f.z); g.add(center);
    const spray = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 12, 1, true), new THREE.MeshStandardMaterial({ color: '#dff6ff', transparent: true, opacity: 0.5, emissive: '#bfefff', emissiveIntensity: 0.3 }));
    spray.position.set(f.x, 4, f.z); spray.rotation.x = Math.PI; spray.userData.spin = true; g.add(spray);
  }

  // ---------------- Pier + marina walkways (from colliders)
  const wood = M('#8b6a4a', { roughness: 0.9 });
  for (const c of L.colliders) {
    if (c.kind !== 'support') continue;
    const deck = box(c.hx * 2, 0.5, c.hz * 2, c.pontoon ? M('#9c8b76') : wood, c.x, c.y1 - 0.25, c.z, c.rot || 0);
    g.add(deck);
    // posts
    const n = Math.floor(Math.max(c.hx, c.hz) / 6);
    for (let i = -n; i <= n; i++) {
      const along = c.hx > c.hz;
      for (const s of [-1, 1]) {
        const px = c.x + (along ? i * 6 : s * (c.hx - 0.3)), pz = c.z + (along ? s * (c.hz - 0.3) : i * 6);
        g.add(box(0.35, 4, 0.35, M('#5b4430'), px, c.y1 - 2.3, pz, 0, false));
      }
    }
  }
  // Pier railings + end kiosk + ferris wheel
  {
    const p = lm.pier;
    for (const s of [-1, 1]) g.add(box(p.hx * 2, 0.08, 0.08, M('#ffffff'), p.x, 1.9, p.z + s * (p.hz - 0.2), 0, false));
    const e = lm.pierEnd;
    const wheel = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(10, 0.3, 8, 40), M('#ff6b6b', { metalness: 0.4 }));
    wheel.add(rim);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const spoke = box(0.15, 10, 0.15, steel, Math.cos(a) * 5, Math.sin(a) * 5, 0, 0, false);
      spoke.rotation.z = a - Math.PI / 2;
      wheel.add(spoke);
      const cab = box(1.4, 1.4, 1.4, M(['#ffd93d', '#6bcB77', '#4d96ff', '#ff6b6b'][i % 4]), Math.cos(a) * 10, Math.sin(a) * 10 - 1, 0);
      cab.userData.cabin = a;
      wheel.add(cab);
    }
    wheel.position.set(e.x - 2, 12, e.z);
    wheel.rotation.y = Math.PI / 2;
    wheel.userData.ferris = true;
    g.add(wheel);
    g.add(box(0.8, 12, 0.8, steel, e.x - 2, 6, e.z - 2, 0), box(0.8, 12, 0.8, steel, e.x - 2, 6, e.z + 2, 0));
    g.add(box(4, 3, 4, M('#f6f1e7'), e.x + 8, 2.4, e.z + 10), box(4.6, 0.3, 4.6, M('#e53935'), e.x + 8, 4.05, e.z + 10));

    // Carousel
    {
      const carousel = new THREE.Group();
      carousel.add(new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.4, 20), M('#f2e2c4')));
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(6, 3, 16), M('#e53935'));
      canopy.position.y = 4.2; canopy.castShadow = true; carousel.add(canopy);
      const poleCols = ['#ff6b6b', '#4d96ff', '#6bcb77', '#ffd93d'];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        carousel.add(box(0.08, 3, 0.08, steel, Math.cos(a) * 4, 1.8, Math.sin(a) * 4, 0, false));
        const horse = box(0.4, 0.8, 1.3, M(poleCols[i % 4]), Math.cos(a) * 4, 0.9, Math.sin(a) * 4);
        horse.rotation.y = a; carousel.add(horse);
      }
      carousel.position.set(e.x + 9, heightAt(e.x + 9, e.z - 10) + 0.2, e.z - 10);
      carousel.userData.spin = true;
      g.add(carousel);
    }
    // Roller coaster: a closed loop, 3 cars running around it (visual only)
    {
      const cx = e.x - 2, cz = e.z, pts = [];
      const N = 16;
      for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * 17, 12.5 + Math.sin(a * 2) * 3, cz + Math.sin(a) * 24)); }
      const curve = new THREE.CatmullRomCurve3(pts, true);
      const track = new THREE.Mesh(new THREE.TubeGeometry(curve, 200, 0.22, 6, true), steel);
      track.castShadow = true; g.add(track);
      for (let i = 0; i < N; i += 2) { const p = curve.getPointAt(i / N); g.add(box(0.2, Math.max(0.5, p.y - 0.2), 0.2, steel, p.x, p.y / 2, p.z, 0, false)); }
      const coasterCars = [];
      const carCols = ['#ff6b6b', '#4d96ff', '#6bcb77'];
      for (let i = 0; i < 3; i++) {
        const car = box(1.2, 0.7, 1.8, M(carCols[i]), 0, 0, 0);
        car.userData.coaster = { curve, t0: i / 3 };
        g.add(car);
        coasterCars.push(car);
      }
      g.userData.coasterCars = coasterCars;
    }
    // Food stalls and benches along the pier deck
    {
      const p2 = lm.pier;
      const stallCols = ['#e53935', '#fb8c00', '#43a047'];
      for (let i = 0; i < 4; i++) {
        const t = (i + 0.5) / 4, x = p2.x - p2.hx + t * p2.hx * 2, side = i % 2 ? 1 : -1;
        const stall = new THREE.Group();
        stall.add(box(2.2, 1.4, 1.4, M('#f6f1e7'), 0, 0.9, 0));
        stall.add(box(2.6, 0.15, 1.8, M(stallCols[i % 3]), 0, 1.75, -0.2));
        stall.position.set(x, heightAt(x, p2.z + side * (p2.hz - 1)), p2.z + side * (p2.hz - 1));
        g.add(stall);
      }
    }
  }

  // ---------------- Mountain ski resort: lodge + chairlift with moving cabins
  {
    const r = lm.resort;
    const gy = heightAt(r.x, r.z);
    const lodge = new THREE.Group();
    const wood = M('#6d4c35', { roughness: 0.85 }), roofM = M('#3a3f44', { roughness: 0.7 }), glass = M('#bcd9e8', { roughness: 0.2, metalness: 0.2 });
    lodge.add(box(20, 6, 14, wood, 0, 3, 0));
    lodge.add(box(21, 0.6, 15, roofM, 0, 6.3, 0));
    // simple gable cap
    const gable = new THREE.Mesh(new THREE.CylinderGeometry(0, 8, 3, 4, 1), roofM);
    gable.rotation.y = Math.PI / 4; gable.scale.set(1, 1, 15 / 11.4);
    gable.position.set(0, 6.9, 0); gable.castShadow = true; lodge.add(gable);
    for (let i = -1; i <= 1; i += 2) lodge.add(box(10, 2.4, 0.15, glass, i * 5, 3.6, 7.05));
    lodge.add(box(1.6, 3, 0.2, M('#4e342e'), 0, 1.5, 7.05));
    lodge.position.set(r.x, gy, r.z);
    g.add(lodge);
    // two lift towers + a chairlift line running up-slope, past the lodge
    const towerA = { x: r.x - 10, z: r.z + 26 }, towerB = { x: r.x - 10, z: r.z - 40 };
    const ay = heightAt(towerA.x, towerA.z), by = heightAt(towerB.x, towerB.z);
    const towerH = 9;
    g.add(box(0.6, towerH, 0.6, steel, towerA.x, ay + towerH / 2, towerA.z));
    g.add(box(0.6, towerH, 0.6, steel, towerB.x, by + towerH / 2, towerB.z));
    g.add(box(3, 0.15, 0.15, steel, towerA.x, ay + towerH, towerA.z));
    g.add(box(3, 0.15, 0.15, steel, towerB.x, by + towerH, towerB.z));
    const cabA = new THREE.Vector3(towerA.x, ay + towerH - 0.5, towerA.z);
    const cabB = new THREE.Vector3(towerB.x, by + towerH - 0.5, towerB.z);
    const cabinCol = ['#e53935', '#1e88e5', '#fdd835', '#43a047'];
    const lifts = [];
    for (let i = 0; i < 6; i++) {
      const cab = box(1.1, 1.3, 1.1, M(cabinCol[i % cabinCol.length]), 0, 0, 0);
      cab.userData.skilift = { a: cabA, b: cabB, phase: i / 6 };
      g.add(cab);
      lifts.push(cab);
    }
    g.userData.skilifts = lifts;
    // a couple of groomed-looking snow mounds either side (visual only)
    for (const [dx, dz] of [[14, 0], [-14, -5]]) { const mound = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 6), M('#f2f6fb')); mound.scale.y = 0.25; mound.position.set(r.x + dx, gy - 0.5, r.z + dz); mound.receiveShadow = true; g.add(mound); }
  }

  // ---------------- Port: container yard, cranes, quay
  {
    const quay = box(220 * 1.2, 2, 6, darkConcrete, wx(895), heightAt(wx(895), wz(788)) - 0.5, wz(786));
    g.add(quay);
    for (const c of L.props.cranes) {
      const crane = new THREE.Group();
      const yel = M('#f4b400', { roughness: 0.6 });
      for (const [dx, dz] of [[-6, -5], [6, -5], [-6, 5], [6, 5]]) crane.add(box(1, 30, 1, yel, dx, 15, dz));
      crane.add(box(14, 2, 12, yel, 0, 30, 0), box(3, 2, 60, yel, 0, 33, 12), box(4, 3, 4, M('#333'), 0, 31, -10));
      crane.position.set(c.x, heightAt(c.x, c.z), c.z);
      g.add(crane);
    }
  }

  // ---------------- Beach: umbrellas + towels + lifeguard towers
  {
    const cols = ['#ff5252', '#ffd740', '#40c4ff', '#69f0ae', '#ffffff', '#ff80ab'];
    let seed = 3;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const lg of L.props.lifeguards) {
      const t = new THREE.Group();
      t.add(box(3, 0.3, 3, M('#fafafa'), 0, 3, 0));
      for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) t.add(box(0.2, 3, 0.2, M('#fafafa'), dx, 1.5, dz));
      t.add(box(3, 2, 3, M('#ef5350'), 0, 4.2, 0), box(3.4, 0.2, 3.4, M('#fafafa'), 0, 5.3, 0));
      t.position.set(lg.x, heightAt(lg.x, lg.z), lg.z);
      g.add(t);
    }
    for (let i = 0; i < 60; i++) {
      const py = 220 + r() * 760;
      if (py > 530 && py < 560) continue;
      const px = shoreApprox(py) + 10 + r() * 22;
      const x = wx(px), z = wz(py), y = heightAt(x, z);
      if (y < WATER_LEVEL + 0.1) continue;
      const um = new THREE.Group();
      um.add(box(0.06, 2.2, 0.06, M('#eeeeee'), 0, 1.1, 0, 0, false));
      const top = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.6, 8), M(cols[i % cols.length]));
      top.position.y = 2.3; top.castShadow = true; um.add(top);
      const towel = box(0.9, 0.02, 1.8, M(cols[(i + 2) % cols.length]), 1.2, 0.02, 0, r() * 3, false);
      um.add(towel);
      um.position.set(x, y, z);
      g.add(um);
    }
  }
  return g;
}

function shoreApprox(py) {
  // local copy of shoreline lookup to avoid a circular import on the client bundle
  const S = [[0, 40], [60, 70], [120, 105], [180, 138], [250, 168], [320, 188], [400, 200], [480, 207], [560, 212], [640, 213], [720, 210], [800, 196], [850, 178], [900, 162], [960, 150], [1090, 132]];
  for (let i = 0; i < S.length - 1; i++) if (py <= S[i + 1][0]) return S[i][1] + ((S[i + 1][1] - S[i][1]) * (py - S[i][0])) / (S[i + 1][0] - S[i][0]);
  return 132;
}

export function hoop(x, y, dir) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 3.9, 10), M('#37474f', { metalness: 0.5 }));
  pole.position.set(dir * 1.2, 1.95, 0); pole.castShadow = true;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.12), M('#37474f'));
  arm.position.set(dir * 0.7, 3.5, 0);
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.05, 1.8), new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, roughness: 0.2 }));
  board.position.set(dir * 0.05, 3.45, 0);
  const square = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.45, 0.6), new THREE.MeshBasicMaterial({ color: '#d32f2f', wireframe: true }));
  square.position.set(dir * 0.04, 3.3, 0);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 8, 24), M('#ff5722', { metalness: 0.6 }));
  rim.rotation.x = Math.PI / 2; rim.position.set(-dir * 0.26, 3.05, 0);
  const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.14, 0.42, 12, 3, true), new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true }));
  net.position.set(-dir * 0.26, 2.83, 0);
  g.add(pole, arm, board, square, rim, net);
  g.position.set(x, y, 0);
  return g;
}
