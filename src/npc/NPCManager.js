import * as THREE from 'three';
import { NPC } from './NPC.js';
import { districtAt, toPx } from '../../shared/map/layout.js';
import { URBAN } from '../world/Collision.js';
import { mulberry32 } from '../../shared/rng.js';
import { circleVsObb } from '../../shared/map/geom.js';

// Population manager: streams pedestrians around the player by district, spawns
// interior NPCs, handles perception (noise), combat hooks and speech bubbles.
const ROLE_MIX = {
  downtown: [['civilian', 82], ['police', 6], ['junkie', 4], ['worker', 8]],
  midtown: [['civilian', 80], ['police', 6], ['worker', 8], ['junkie', 6]],
  beachfront: [['civilian', 85], ['athlete', 15]],
  hillcrest: [['civilian', 94], ['police', 3], ['athlete', 3]],
  northshore: [['civilian', 100]],
  eastside: [['civilian', 45], ['gang', 32], ['junkie', 18], ['police', 5]],
  redbrick: [['civilian', 70], ['gang', 12], ['junkie', 8], ['worker', 10]],
  industrial: [['worker', 60], ['civilian', 20], ['gang', 15], ['junkie', 5]],
  sports: [['civilian', 55], ['athlete', 45]],
  outskirts: [['civilian', 80], ['worker', 20]],
  mountain: [['civilian', 70], ['athlete', 30]],
};
const DENSITY = { downtown: 1, midtown: 0.9, beachfront: 0.9, eastside: 0.8, redbrick: 0.7, sports: 0.7, hillcrest: 0.5, industrial: 0.45, northshore: 0.3, outskirts: 0.25, mountain: 0.2 };
export const VARIANTS = { civilian: 8, police: 2, gang: 3, junkie: 2, shopkeeper: 2, medic: 1, worker: 2, athlete: 2, teamA: 2, teamB: 2, wrestler: 3 };

// Park life (Stage 8): a simple procedural dog, attached to some civilian NPCs spawned near a
// park so they read as "dog walkers" — it inherits the owner's avatar transform (child of
// avatar.group) so it turns and moves with them without any extra per-frame logic.
const DOG_COLORS = ['#8d6e4f', '#3b2e1f', '#e8d9b5', '#2b2b2b', '#c9c0a8'];
function buildDog(color) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.5), m); body.position.set(0.35, 0.22, -0.9); g.add(body);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.18), m); head.position.set(0.35, 0.28, -1.18); g.add(head);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.2), m); tail.position.set(0.35, 0.3, -0.63); tail.rotation.x = -0.6; g.add(tail);
  for (const [dx, dz] of [[-0.08, -0.78], [0.08, -0.78], [-0.08, -1.02], [0.08, -1.02]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.06), m); leg.position.set(0.35 + dx, 0.1, dz); g.add(leg);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.userData.dog = true;
  return g;
}

export class NPCManager {
  constructor(game) {
    this.game = game;
    this.layout = game.layout;
    this.npcs = [];
    this.interiorNpcs = [];
    this.target = game.engine.quality === 'low' ? 24 : game.engine.quality === 'medium' ? 36 : 50;
    this.spawnT = 0;
    this.bubbles = [];
    this.active = new Set();
  }
  /** Pre-build NPC appearance variants during loading to avoid hitches later. */
  async prebuild(progress) {
    const keys = [];
    for (const [role, n] of Object.entries(VARIANTS)) for (let i = 0; i < n; i++) keys.push(`npc:${role}:${i}`);
    for (let i = 0; i < keys.length; i++) { this.game.factory.template(keys[i]); progress?.(i / keys.length); await new Promise((r) => setTimeout(r, 0)); }
  }

  own() { return this.interiorNpcs.length ? [...this.npcs, ...this.interiorNpcs] : this.npcs; }
  all() { const cops = this.game.police?.officers; return cops?.length || this.interiorNpcs.length || this.extra?.length ? [...this.npcs, ...this.interiorNpcs, ...(cops || []), ...(this.extra || [])] : this.npcs; }
  positions() { return this.npcs.filter((n) => n.alive).map((n) => n.position); }

  add(npc) {
    this.game.engine.scene.add(npc.avatar.group);
    this.game.world.collision.add(npc.collider);
    return npc;
  }
  remove(npc) {
    npc.avatar.dispose();
    this.game.world.collision.remove(npc.collider);
    if (npc.bubbleSprite) { npc.bubbleSprite.removeFromParent(); }
    this.active.delete(npc.identity);
  }

  // ------------------------------------------------------------------ spawning
  pickRole(dist) {
    const mix = ROLE_MIX[dist] || ROLE_MIX.downtown;
    const tot = mix.reduce((s, m) => s + m[1], 0);
    let r = Math.random() * tot;
    for (const [role, w] of mix) { r -= w; if (r <= 0) return role; }
    return 'civilian';
  }
  spawnAround(center) {
    const roads = this.layout.roads;
    for (let tries = 0; tries < 10; tries++) {
      const road = roads[Math.floor(Math.random() * roads.length)];
      if (road.type === 'highway') continue;
      const i = Math.floor(Math.random() * road.pts.length);
      const [x0, z0] = road.pts[i];
      const d = Math.hypot(x0 - center.x, z0 - center.z);
      if (d < 40 || d > 150) continue;
      const dist = districtAt(x0, z0).id;
      if (Math.random() > (DENSITY[dist] ?? 0.4)) continue;
      const nb = road.pts[Math.min(road.pts.length - 1, i + 1)], pb = road.pts[Math.max(0, i - 1)];
      let tx = nb[0] - pb[0], tz = nb[1] - pb[1]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const side = Math.random() < 0.5 ? 1 : -1;
      const off = road.width / 2 + (URBAN.has(dist) ? 1.6 : 2.5);
      const x = x0 - tz * side * off, z = z0 + tx * side * off;
      const col = this.game.world.collision;
      const test = new THREE.Vector3(x, 0, z);
      if (col.query(x, z, 0.6).some((c) => !c.dynamic && c.y1 > test.y + 1 && circleVsObb(x, z, 0.6, c))) continue;
      const role = this.pickRole(dist);
      let identity = null;
      for (let k = 0; k < 5; k++) { const id = `${dist}-${role}-${Math.floor(Math.random() * 30)}`; if (!this.active.has(id)) { identity = id; break; } }
      if (!identity) continue;
      this.active.add(identity);
      const variant = Math.floor(Math.random() * (VARIANTS[role === 'resident' ? 'civilian' : role] || 1));
      test.y = col.groundAt(x, z);
      const npc = new NPC(this, { role, variant, identity, x, y: test.y, z, yaw: Math.atan2(tx * side, tz * side) });
      // Park life: near the plaza park, some civilians walk a dog and some athletes jog instead
      // of the normal city amble — gives parks a different feel from ordinary streets.
      const park = this.layout.landmarks.plazaPark;
      if (park && Math.hypot(x - park.x, z - park.z) < Math.max(park.hx, park.hz) + 30) {
        if (role === 'civilian' || role === 'athlete') {
          const roll = Math.random();
          if (roll < 0.2) { npc.avatar.group.add(buildDog(DOG_COLORS[Math.floor(Math.random() * DOG_COLORS.length)])); npc.dogWalker = true; }
          else if (roll < 0.4) npc.jogger = true;
        }
      }
      // Pedestrian groups: occasionally a second civilian spawns right alongside as a loose
      // companion, sharing whatever wander target the leader picks (with a small side offset) so
      // they read as walking together instead of every pedestrian being a lone individual.
      if (role === 'civilian' && !npc.dogWalker && Math.random() < 0.15 && this.npcs.length < this.target - 1) {
        const cid = `${identity}-mate`;
        if (!this.active.has(cid)) {
          this.active.add(cid);
          const mate = new NPC(this, { role: 'civilian', variant: Math.floor(Math.random() * (VARIANTS.civilian || 1)), identity: cid, x: x + 1.2, y: test.y, z: z + 0.6, yaw: npc.avatar.yaw });
          mate.groupLeader = npc; npc.groupMate = mate;
          this.add(mate); this.npcs.push(mate);
        }
      }
      return this.add(npc);
    }
    return null;
  }
  spawnFleeing(pos, why) {
    const npc = new NPC(this, { role: 'civilian', variant: Math.floor(Math.random() * 8), x: pos.x, y: this.game.world.collision.groundAt(pos.x, pos.z), z: pos.z });
    this.add(npc);
    this.npcs.push(npc);
    npc.provoke(this.game.avatar, why);
    npc.state = 'flee'; npc.timer = 10;
    npc.say(why === 'carjacked' ? 'My car!! Somebody stop them!' : 'Help!!');
    npc.callPolice = 3;
    return npc;
  }

  // interiors
  spawnInterior(it) {
    this.despawnInterior();
    const rnd = mulberry32(it.bid * 31 + 7);
    const occupied = it.residential ? rnd() < 0.65 : true;
    const o = it.origin;
    it.npcSpots.forEach((s, i) => {
      if (it.residential && (!occupied || (i > 0 && rnd() < 0.5))) return;
      if (it.owned) return;
      const role = s.role;
      const variant = Math.floor(rnd() * (VARIANTS[role === 'resident' ? 'civilian' : role] || 1));
      const npc = new NPC(this, { role, variant, identity: `b${it.bid}-${i}`, x: o.x + s.x, y: 0, z: o.z + s.z, yaw: s.yaw ?? rnd() * 6, fixed: !!(s.fixed || s.sit || s.lie || it.residential), persona: s.name ? { name: s.name } : {}, interior: it });
      if (s.sit) { npc.state = 'sit'; npc.avatar.position.y = 0; }
      if (s.lie) npc.state = 'lie';
      this.add(npc);
      this.interiorNpcs.push(npc);
    });
    // trespassing: residents notice you
    if (it.residential && !it.owned && this.interiorNpcs.length) {
      this.trespass = { it, t: 0, warned: false, reported: false };
    } else this.trespass = null;
  }
  despawnInterior() {
    for (const n of this.interiorNpcs) this.remove(n);
    this.interiorNpcs = [];
    this.trespass = null;
  }

  // ------------------------------------------------------------------ AI helpers
  pickWanderTarget(npc) {
    const p = npc.position;
    if (npc.interior) return null;
    // Dog walkers amble around inside the park itself (a loose loop around the park's centre)
    // instead of the generic road-following wander, which would otherwise pull them out onto the
    // street edge like an ordinary pedestrian — and they pause more often, like a dog sniffing
    // around, rather than walking briskly point-to-point.
    if (npc.dogWalker) {
      const park = this.layout.landmarks.plazaPark;
      if (park && Math.hypot(p.x - park.x, p.z - park.z) < Math.max(park.hx, park.hz) + 30) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * Math.max(park.hx, park.hz) * 0.8;
        if (Math.random() < 0.3) { npc.state = 'idle'; npc.timer = 3 + Math.random() * 6; return null; }
        return new THREE.Vector3(park.x + Math.cos(a) * r, 0, park.z + Math.sin(a) * r);
      }
    }
    // sometimes pop into a nearby building (they disappear inside)
    if (Math.random() < 0.06) {
      const d = this.game.interiors?.nearestDoor(p.x, p.z, 25);
      if (d) { npc.state = 'goto'; npc.after = 'wander'; npc.onArrive = () => { npc.gone = true; }; return (npc.target = new THREE.Vector3(d.x, 0, d.z)); }
    }
    // or take a seat on a bench — the park itself gets a much higher chance so it reads as a
    // place people actually go to sit and chill, not just pass through (v1.3 "richer park life")
    const nearPark = this.layout.landmarks.plazaPark && Math.hypot(p.x - this.layout.landmarks.plazaPark.x, p.z - this.layout.landmarks.plazaPark.z) < Math.max(this.layout.landmarks.plazaPark.hx, this.layout.landmarks.plazaPark.hz) + 20;
    if (Math.random() < (nearPark ? 0.4 : 0.1)) {
      for (const b of this.layout.props.benches) if (Math.hypot(b.x - p.x, b.z - p.z) < (nearPark ? 40 : 25)) { npc.state = 'goto'; npc.after = 'sit'; const bx = b.x, bz = b.z; npc.onArrive = () => { npc.heading = b.rot; npc.position.set(bx, 0.16, bz); npc.state = 'sit'; npc.timer = (nearPark ? 25 : 15) + Math.random() * 30; }; return (npc.target = new THREE.Vector3(bx, 0, bz)); }
    }
    // small chance to just stand and chat in place for a while — ambient "people standing around"
    if (nearPark && Math.random() < 0.12) { npc.state = 'idle'; npc.timer = 8 + Math.random() * 14; return null; }
    const n = this.layout.roadIndex.nearest(p.x, p.z, 30);
    if (n && n.road.type !== 'highway') {
      const road = n.road;
      const i = Math.min(n.i, road.pts.length - 2);
      const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1];
      let tx = bx - ax, tz = bz - az; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
      const fwd = Math.sin(npc.heading) * tx + Math.cos(npc.heading) * tz >= 0 ? 1 : -1;
      const dir = Math.random() < 0.85 ? fwd : -fwd;
      const side = Math.sign((p.x - n.q[0]) * -tz + (p.z - n.q[1]) * tx) || 1;
      const off = road.width / 2 + 1.6;
      const step = 10 + Math.random() * 10;
      const cx = n.q[0] + tx * dir * step, cz = n.q[1] + tz * dir * step;
      // occasionally cross the road — flag it so update() makes the NPC actually look both ways
      // and wait for a gap instead of just walking straight into traffic
      const cross = Math.random() < 0.08 ? -1 : 1;
      npc.crossRoad = cross === -1 ? road : null;
      return new THREE.Vector3(cx - tz * side * cross * off, 0, cz + tx * side * cross * off);
    }
    const a = Math.random() * Math.PI * 2;
    return new THREE.Vector3(p.x + Math.cos(a) * 10, 0, p.z + Math.sin(a) * 10);
  }

  /** Is a car on `road` bearing down on `pos` closely enough that crossing now would be unsafe?
   * Used by NPC.js's wander state so pedestrians actually check for traffic before crossing
   * instead of just walking straight across (cars already brake for pedestrians they can see —
   * this is the pedestrian's own half of that same interaction). */
  trafficDanger(pos, road) {
    const traf = this.game.traffic;
    if (!traf || !road) return false;
    for (const c of traf.cars) {
      if (c.edge?.road !== road.id) continue;
      const dx = c.p.x - pos.x, dz = c.p.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 15 || c.speed < 1) continue;
      const approaching = -(dx * c.p.tx + dz * c.p.tz); // >0 if the car's heading points toward pos
      if (approaching > 0) return true;
    }
    return false;
  }

  /** A loud event: gunshots, explosions, fights. */
  noise(pos, radius, kind, source = null) {
    for (const n of this.all()) {
      if (!n.alive || n === source) continue;
      const d = n.position.distanceTo(pos);
      if (d > radius) continue;
      if (n.role === 'police') { this.game.police?.policeNoticed?.(n, source, kind); continue; }
      if (n.state === 'flee' || n.state === 'fight' || n.state === 'shoot') continue;
      if (n.talkingTo) this.game.dialogue?.close();
      n.provoke(source || pos, kind);
    }
  }
  explosion(pos, r) {
    for (const n of this.all()) {
      const d = n.position.distanceTo(pos);
      if (d < r) n.takeDamage((r - d) * 25, null);
      else if (d < r * 2 && n.alive) n.knockDown(n.position.clone().sub(pos).normalize(), 6);
    }
    this.noise(pos, 80, 'explosion');
  }

  /** Ray vs NPC capsules (for weapons). */
  raycast(o, d, maxT) {
    let best = null;
    const tmp = new THREE.Vector3();
    for (const n of this.all()) {
      if (!n.alive || !n.avatar.group.visible) continue;
      const p = n.position;
      const h = n.height;
      tmp.set(p.x - o.x, p.y - o.y, p.z - o.z);
      const along = tmp.x * d.x + tmp.z * d.z + (tmp.y + h * 0.5) * d.y;
      if (along < 0 || along > maxT) continue;
      // test points along the body
      for (const [yy, r, head] of [[h * 0.92, 0.16, true], [h * 0.7, 0.3, false], [h * 0.45, 0.3, false], [h * 0.15, 0.22, false]]) {
        const cx = p.x - (o.x + d.x * along), cz = p.z - (o.z + d.z * along);
        const t2 = ((p.x - o.x) * d.x + (p.y + yy - o.y) * d.y + (p.z - o.z) * d.z);
        const qx = o.x + d.x * t2 - p.x, qy = o.y + d.y * t2 - (p.y + yy), qz = o.z + d.z * t2 - p.z;
        void cx; void cz;
        if (t2 > 0 && t2 < maxT && qx * qx + qy * qy + qz * qz < r * r) {
          if (!best || t2 < best.t) best = { npc: n, t: t2, head, point: new THREE.Vector3(o.x + d.x * t2, o.y + d.y * t2, o.z + d.z * t2) };
          break;
        }
      }
    }
    return best;
  }

  npcMelee(npc) {
    const g = this.game;
    if (!npc.alive) return;
    const t = npc.threat;
    if (t === g.avatar) {
      if (npc.position.distanceTo(g.player.pos) < 1.8 && g.player.mode === 'foot') {
        g.audio.punch(g.player.pos);
        g.damageSelf(8 + Math.random() * 6, 'npc');
        g.cam.addShake(0.2);
      }
    } else if (t && t.takeDamage && npc.position.distanceTo(t.position) < 1.8) { t.takeDamage(10, npc); g.audio.punch(t.position); }
  }
  /** Is there clear terrain/building geometry between two points (a real wall check, not just
   * distance)? Used to gate whether an NPC is even allowed to fire — never just whether the shot
   * happens to connect. */
  hasLineOfSight(from3, to3) {
    const from = from3.clone(); from.y += 1.5;
    const to = to3.clone(); to.y += 1.2;
    const dir = to.clone().sub(from); const L = dir.length();
    if (L < 0.5) return true;
    dir.normalize();
    const blocked = this.game.world.collision.raycast([from.x, from.y, from.z], [dir.x, dir.y, dir.z], L - 0.5, { terrain: true, filter: (c) => c.kind !== 'npc' && c.kind !== 'vehicle' });
    return !blocked;
  }
  npcShoot(npc, targetPos, dist) {
    const g = this.game;
    const from = npc.position.clone(); from.y += npc.height * 0.75;
    const to = targetPos.clone(); to.y += 1.2;
    npc.avatar.anim.play('recoil');
    g.audio.gunshot(from, npc.weapon === 'ak47' ? 'ak47' : npc.weapon === 'pistol' ? 'pistol' : 'glock');
    g.fx?.muzzle(from.clone().add(to.clone().sub(from).normalize().multiplyScalar(0.6)));
    const acc = npc.role === 'police' ? 0.55 : 0.35;
    const hitChance = Math.max(0.08, acc - dist * 0.012) * (g.vehicles?.current ? 0.6 : 1) * (g.player.crouch ? 0.7 : 1);
    const t = npc.threat;
    const miss = to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3));
    if (t === g.avatar) {
      // line of sight check
      const dir = to.clone().sub(from); const L = dir.length(); dir.normalize();
      const blocked = g.world.collision.raycast([from.x, from.y, from.z], [dir.x, dir.y, dir.z], L - 1, { terrain: true, ignore: npc.collider, filter: (c) => c.kind !== 'npc' });
      if (!blocked && Math.random() < hitChance) {
        g.fx?.tracer(from, to);
        g.damageSelf(npc.weapon === 'ak47' ? 14 : 11, npc.role === 'police' ? 'police' : 'npc');
        if (g.vehicles?.current) g.vehicles.current.dmg = Math.min(100, g.vehicles.current.dmg + 2);
      } else g.fx?.tracer(from, miss);
    } else if (t && t.takeDamage) {
      // same wall check for NPC-vs-NPC fire (police vs. a fleeing civilian, gang vs. a witness,
      // etc.) — this branch previously had none at all
      if (this.hasLineOfSight(npc.position, t.position ?? t) && Math.random() < hitChance + 0.2) {
        g.fx?.tracer(from, to);
        t.takeDamage(12, npc);
      } else g.fx?.tracer(from, miss);
    }
    this.noise(from, 45, 'gunshot', npc);
  }

  vehicleSweep(v, front, speed) {
    for (const n of this.all()) {
      if (!n.alive || n.state === 'knocked') continue;
      if (n.position.distanceTo(front) < v.spec.width * 0.7 + 0.3) {
        const dir = v.forward().multiplyScalar(Math.sign(v.speed));
        this.game.audio.punch(n.position);
        if (speed > 14) n.takeDamage(speed * 6, this.game.avatar);
        else { n.knockDown(dir, speed * 0.8); n.hp -= speed * 3; if (n.hp <= 0) n.die(this.game.avatar); }
        this.game.police?.reportCrime?.(speed > 14 ? 'vehicular' : 'assault', speed > 14 ? 2 : 1, n.position);
        this.noise(n.position, 20, 'fight', null);
      } else if (n.position.distanceTo(front) < 4 && speed > 6 && n.state === 'wander') {
        n.state = 'flee'; n.threat = v.group.position; n.timer = 3; n.bark('angry');
      }
    }
  }
  angryDriver(c) { void c; }

  onDeath(npc, attacker) {
    const g = this.game;
    g.emergency?.onNpcDeath(npc);
    this.noise(npc.position, 30, 'death', npc);
    if (attacker === g.avatar) {
      g.police?.reportCrime?.(npc.role === 'police' ? 'copkill' : 'murder', npc.role === 'police' ? 3 : 2, npc.position);
      g.remember?.(npc, 'The player killed you.');
    }
  }

  // ------------------------------------------------------------------ speech bubbles
  bubble(npc, text, dur) {
    if (npc.bubbleSprite) npc.bubbleSprite.removeFromParent();
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.font = 'bold 40px system-ui, Arial';
    const w = Math.min(500, g.measureText(text).width + 40);
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath(); g.roundRect(256 - w / 2, 14, w, 76, 22); g.fill();
    g.beginPath(); g.moveTo(246, 90); g.lineTo(266, 90); g.lineTo(256, 108); g.fill();
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 256, 53, 470);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
    s.scale.set(2.4, 0.6, 1);
    s.position.y = npc.height + 0.55;
    s.renderOrder = 20;
    npc.avatar.group.add(s);
    npc.bubbleSprite = s;
    this.bubbles.push({ s, t: dur, npc });
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    if (!g.player) return;
    const pp = g.player.pos;
    const camPos = g.engine.camera.position;
    // streaming outdoors
    if (!g.player.interior && !g.inActivity) {
      for (let i = this.npcs.length - 1; i >= 0; i--) {
        const n = this.npcs[i];
        const d = n.position.distanceTo(pp);
        if (n.state === 'sit' && !n.fixed && n.timer <= 0) { n.state = 'wander'; n.position.x += Math.sin(n.heading) * 0.8; n.position.z += Math.cos(n.heading) * 0.8; }
        if (d > 200 || n.gone || (!n.alive && n.deadT > 40)) { this.remove(n); this.npcs.splice(i, 1); }
      }
      this.spawnT -= dt;
      if (this.spawnT < 0 && this.npcs.length < this.target) { this.spawnT = 0.25; const n = this.spawnAround(pp); if (n) this.npcs.push(n); }
    } else if (this.npcs.length && (g.inActivity)) { for (const n of this.npcs) this.remove(n); this.npcs = []; }
    const ctx = { player: pp, camDist: 0 };
    const list = this.extra?.length ? [...this.own(), ...this.extra] : this.own();
    for (const n of list) {
      ctx.camDist = n.position.distanceTo(camPos);
      const vis = ctx.camDist < 170 && (!!n.interior === !!g.player.interior);
      n.avatar.group.visible = vis;
      if (!vis && n.state === 'wander') continue;
      n.update(dt, ctx);
    }
    // trespassing in someone's home
    if (this.trespass) {
      const tr = this.trespass;
      tr.t += dt;
      const res = this.interiorNpcs.find((n) => n.alive);
      if (res && tr.t > 1.2 && !tr.warned) { tr.warned = true; res.state = 'idle'; res.bark('trespass'); res.memoryHint = 'The player walked into your house uninvited.'; g.remember?.(res, 'The player trespassed in your house.'); }
      if (res && tr.t > 14 && !tr.reported) {
        tr.reported = true;
        res.say("That's it, I'm calling the police!");
        g.police?.reportCrime?.('trespass', 1, pp);
        if (Math.random() < res.prof.bravery) res.provoke(g.avatar, 'attacked');
      }
    }
    // bubbles
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.t -= dt;
      if (b.t <= 0) { b.s.removeFromParent(); if (b.npc.bubbleSprite === b.s) b.npc.bubbleSprite = null; this.bubbles.splice(i, 1); }
    }
  }

  interactions(out, pos) {
    const g = this.game;
    if (g.vehicles?.current || g.player.mode !== 'foot') return;
    const cam = g.engine.camera;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    let best = null, bs = Infinity;
    for (const n of this.all()) {
      if (!n.alive || !n.avatar.group.visible || n.state === 'flee' || n.state === 'fight' || n.state === 'shoot') continue;
      const d = n.position.distanceTo(pos);
      if (d > 3.2) continue;
      const head = n.position.clone(); head.y += n.height * 0.7;
      const dot = head.sub(cam.position).normalize().dot(fwd);
      if (dot < 0.8) continue;
      const s = d * (2 - dot);
      if (s < bs) { bs = s; best = n; }
    }
    if (best) out.push({ label: `Talk to ${best.persona.short}`, key: 'interact', priority: 5, action: () => g.dialogue.open(best) });
  }
  blips(out) {
    for (const n of this.npcs) if (n.alive && (n.state === 'shoot' || n.state === 'fight') && n.threat === this.game.avatar) out.push({ x: n.position.x, z: n.position.z, color: '#ff4757', size: 3 });
  }
  onEnterInterior(it) { void it; for (const n of this.npcs) n.avatar.group.visible = false; }
  onExitInterior() { this.despawnInterior(); }
}
export { toPx };
