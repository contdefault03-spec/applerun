import * as THREE from 'three';
import { NPC } from '../npc/NPC.js';
import { Avatar } from '../characters/Avatar.js';
import { PLAYABLE } from '../characters/defs.js';
import { buildVehicle, setCustomModel } from '../vehicles/VehicleModels.js';
import { STORY_ORIGIN, STORY_RADIUS } from './storyZone.js';

// v1.3 "major new feature": a scripted story intro played once per session before free-roam
// starts — character select -> startgame.mp4 -> forest ambush (12 enemies.glb enemies across 3
// waves) -> saver.mp4 -> escape in startcar.glb -> a car chase (2 destructible enemy vehicles) ->
// escape.mp4 -> spawn at a beachside hotel with $50,000.
//
// Multiplayer honesty note: this reuses the same trust model the rest of this codebase already
// uses for NPCs/traffic (client-simulated locally per player) — enemies are simulated on each
// client independently, so exact hit/kill timing can differ slightly between players. What IS
// synchronized is every *stage transition* (which video plays, when the escape car spawns, when
// the chase starts, the final hotel spawn and the $50,000 grant): only the room host's client
// decides when a stage is complete, and broadcasts that over a new lightweight 'story' relay (see
// server/rooms.js) that every client — including the host itself — applies identically. That is
// "server/host-authoritative for the important transitions" without a full deterministic-lockstep
// rewrite of the whole cutscene, which was out of scope for this pass.
export const STORY_CHARACTERS = PLAYABLE.slice(0, 5); // max, ajan, rize, masked, lucky
const ORIGIN = STORY_ORIGIN; // an isolated pocket, far from the real city
const WAVE_SIZE = 4, WAVE_COUNT = 3; // 12 enemies total
const HITS_TO_DESTROY = 10;

export class StoryIntro {
  constructor(game) {
    this.game = game;
    this.phase = 'idle';
    this.blockInput = false;
    this.enemies = [];
    this.companions = [];
    this.chaseCars = [];
    this.waveIdx = 0;
    this.forestGroup = null;
    this.activeVideo = null;
    game.net.on('story', (m) => this.applyPhase(m.phase, m.data));
    game.net.on('storySkip', () => this._finishVideo?.());
  }

  active() { return this.phase !== 'idle' && this.phase !== 'done'; }
  isHost() {
    const g = this.game;
    return !g.net.connected || !g.net.room || g.net.room.hostId === g.net.id;
  }
  /** Every stage transition goes through here. Solo/offline has no server to echo the message
   * back, so it applies immediately; multiplayer always waits for the (possibly own) broadcast —
   * see the class docblock for why. */
  advance(phase, data = {}) {
    const g = this.game;
    if (g.net.connected && g.net.room) g.net.send('story', { phase, data });
    else this.applyPhase(phase, data);
  }

  // ------------------------------------------------------------------ entry point
  async begin(solo) {
    const g = this.game;
    this.solo = solo;
    this.killed = 0;
    this.waveIdx = 0;
    this.phase = 'introVideo'; // marks the intro as "active" (see active()) from the very first frame
    g.police?.clear(true); // no wanted level / cops during the scripted intro — see PoliceManager.update's guard
    await Promise.all([g.assets.ensureGltf('enemyChar'), g.assets.ensureGltf('startcar')]);
    setCustomModel('startcar', g.assets.gltf('startcar').scene);
    this.playVideo('introStart', () => { if (this.isHost()) this.advance('forestSpawn'); });
  }

  applyPhase(phase, data) {
    this.phase = phase;
    const g = this.game;
    switch (phase) {
      case 'forestSpawn':
        this.buildForest();
        this.spawnPlayerInForest();
        if (this.solo) this.spawnCompanions();
        this.spawnWave(0);
        break;
      case 'wave':
        this.spawnWave(data.idx);
        break;
      case 'saverVideo':
        this.clearWave();
        this.playVideo('introSaver', () => { if (this.isHost()) this.advance('escapeCar'); });
        break;
      case 'escapeCar':
        this.spawnEscapeCar();
        break;
      case 'chase':
        this.spawnChase();
        break;
      case 'escapeVideo':
        this.clearChase();
        this.playVideo('introEscape', () => { if (this.isHost()) this.advance('hotelSpawn'); });
        break;
      case 'hotelSpawn':
        this.finish();
        break;
    }
  }

  // ------------------------------------------------------------------ video overlay
  playVideo(id, onEnd) {
    const g = this.game;
    this.blockInput = true;
    const video = document.createElement('video');
    video.src = g.assets.url(id);
    video.playsInline = true;
    video.controls = false;
    video.autoplay = true;
    Object.assign(video.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', objectFit: 'contain', background: '#000', zIndex: 500 });
    document.body.appendChild(video);
    this.activeVideo = video;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      video.remove();
      if (this.activeVideo === video) this.activeVideo = null;
      if (this._finishVideo === finish) this._finishVideo = null;
      this.blockInput = false;
      onEnd();
    };
    this._finishVideo = finish; // called locally by a skip, or remotely via the 'storySkip' broadcast
    video.addEventListener('ended', finish);
    video.play().catch(() => { video.muted = true; video.play().catch(() => {}); });
    // v1.3: the host can double-tap "8" (within 600ms) to skip the cutscene for the whole room —
    // a raw keydown listener, since Game.update() (and its normal input-polling) is entirely
    // short-circuited while blockInput is set, so the usual input.hit()-based binding can't see it.
    let lastPress = 0;
    const onKey = (e) => {
      if (e.code !== 'Digit8' && e.key !== '8') return;
      if (!this.isHost()) return;
      const now = performance.now();
      if (now - lastPress < 600) {
        lastPress = 0;
        if (g.net.connected && g.net.room) g.net.send('storySkip', {});
        else finish();
      } else lastPress = now;
    };
    document.addEventListener('keydown', onKey);
  }

  // ------------------------------------------------------------------ forest
  buildForest() {
    if (this.forestGroup) return;
    const g = this.game;
    const grp = new THREE.Group();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#3b4a2f', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
    grp.add(ground);
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4632', roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: '#2f5233', roughness: 0.85 });
    const rockMat = new THREE.MeshStandardMaterial({ color: '#7d7a72', roughness: 0.9 });
    this.treeSpots = [];
    for (let i = 0; i < 90; i++) {
      const x = (Math.random() - 0.5) * 150, z = (Math.random() - 0.5) * 150;
      if (Math.hypot(x, z) < 10) continue; // keep a clearing near the centre for the fight
      const h = 5 + Math.random() * 4;
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, h * 0.4, 6), trunkMat);
      trunk.position.set(x, h * 0.2, z);
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.5 + Math.random() * 0.8, h * 0.75, 7), leafMat);
      leaves.position.set(x, h * 0.55, z);
      trunk.castShadow = leaves.castShadow = true;
      grp.add(trunk, leaves);
      this.treeSpots.push(new THREE.Vector3(x, 0, z));
    }
    for (let i = 0; i < 16; i++) {
      const x = (Math.random() - 0.5) * 140, z = (Math.random() - 0.5) * 140;
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + Math.random() * 0.7, 0), rockMat);
      rock.position.set(x, 0.3, z); rock.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      grp.add(rock);
    }
    const hemi = new THREE.HemisphereLight('#cfe6ff', '#3a2f22', 0.9);
    const sun = new THREE.DirectionalLight('#fff2d8', 1.3);
    sun.position.set(30, 60, 20);
    grp.add(hemi, sun);
    grp.position.copy(ORIGIN);
    g.engine.scene.add(grp);
    this.forestGroup = grp;
    // v1.3 fix: hiding the outdoor group also hides the sky mesh, and this pocket never set its
    // own scene.background or fog — every pixel not covered by the small 160x160 ground plane
    // (i.e. most of what the camera sees looking anywhere but straight down) rendered pure black,
    // "no forest, nothing there". Mirror what InteriorManager.enter does for the same reason.
    this._savedEnv = { background: g.engine.scene.background, fogDensity: g.engine.scene.fog.density };
    g.engine.scene.background = new THREE.Color('#131f14');
    g.engine.scene.fog.density = 0.01;
    g.world.env.setShadowsActive(false); // the real city's cascades don't reach out here anyway
    g.world.setOutdoorVisible(false); // hide the real city while we're in this isolated pocket
  }
  teardownForest() {
    if (!this.forestGroup) return;
    const g = this.game;
    this.forestGroup.parent?.remove(this.forestGroup);
    this.forestGroup = null;
    g.world.setOutdoorVisible(true);
    g.world.env.setShadowsActive(true);
    if (this._savedEnv) {
      g.engine.scene.background = this._savedEnv.background;
      g.engine.scene.fog.density = this._savedEnv.fogDensity;
      this._savedEnv = null;
    }
  }

  spawnPlayerInForest() {
    const g = this.game;
    const spot = ORIGIN.clone().add(new THREE.Vector3(0, 0, 16));
    g.player.teleport(spot.x, ORIGIN.y + 0.1, spot.z, Math.PI);
    g.weapons.owned = [...new Set([...g.weapons.owned, 'pistol'])];
    g.profile.ammo ||= {}; g.profile.ammo.pistol = Math.max(g.profile.ammo.pistol || 0, 65);
    g.weapons.equip('pistol');
    g.ui.bigMessage?.('AMBUSH', 'Take cover and fight back!', 4, '#ff4757');
  }

  spawnCompanions() {
    const g = this.game;
    const others = STORY_CHARACTERS.filter((c) => c.id !== g.avatar.key);
    for (let i = 0; i < others.length; i++) {
      const def = others[i];
      const av = new Avatar(g.factory, def.id, { name: def.name, showTag: true });
      const a = (i / others.length) * Math.PI * 2;
      av.position.set(ORIGIN.x + Math.cos(a) * 4, ORIGIN.y, ORIGIN.z + 14 + Math.sin(a) * 4);
      g.engine.scene.add(av.group);
      this.companions.push({ avatar: av, cd: 0, hp: 150 });
    }
  }
  removeCompanions() {
    for (const c of this.companions) c.avatar.dispose();
    this.companions = [];
  }

  spawnEnemy(pos, yaw) {
    const g = this.game;
    const npc = new NPC(g.npcs, { role: 'gang', variant: 0, x: pos.x, y: ORIGIN.y, z: pos.z, yaw, identity: `storyEnemy-${Math.random().toString(36).slice(2)}` });
    npc.avatar.char.root.visible = false; // hide the normal rig — enemies.glb stands in for it
    const mesh = g.assets.gltf('enemyChar').scene.clone();
    mesh.scale.setScalar(1.8); // the source model is normalized to 1 unit tall
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    npc.avatar.group.add(mesh);
    npc.armed = true; npc.weapon = 'pistol';
    npc.hp = npc.prof.hp = 100;
    npc.threat = g.avatar; npc.state = 'shoot'; npc.timer = 9999;
    g.npcs.add(npc);
    (g.npcs.extra ||= []).push(npc);
    return npc;
  }
  spawnWave(idx) {
    const g = this.game;
    this.waveIdx = idx;
    const base = ORIGIN.clone().add(new THREE.Vector3(0, 0, -18 - idx * 10));
    const car = buildVehicle('sedan', ['#455a64', '#37474f', '#212121'][idx % 3]);
    car.group.position.copy(base);
    g.engine.scene.add(car.group);
    (this.waveProps ||= []).push(car.group);
    this.enemies = [];
    for (let i = 0; i < WAVE_SIZE; i++) {
      const a = (i / WAVE_SIZE) * Math.PI * 2;
      const pos = base.clone().add(new THREE.Vector3(Math.cos(a) * 3.2, 0, Math.sin(a) * 3.2));
      this.enemies.push(this.spawnEnemy(pos, Math.atan2(-Math.cos(a), -Math.sin(a))));
    }
    g.ui.notify(`Wave ${idx + 1}/${WAVE_COUNT} — ${this.killed}/${WAVE_SIZE * WAVE_COUNT} down`, 'bad');
  }
  clearWaveEnemies() {
    const g = this.game;
    for (const n of this.enemies) { g.npcs.extra = (g.npcs.extra || []).filter((x) => x !== n); g.npcs.remove(n); }
    this.enemies = [];
    for (const p of this.waveProps || []) p.parent?.remove(p);
    this.waveProps = [];
  }
  clearWave() { this.clearWaveEnemies(); }

  // ------------------------------------------------------------------ escape car + chase
  spawnEscapeCar() {
    const g = this.game;
    const spot = ORIGIN.clone().add(new THREE.Vector3(0, 0, 20));
    g.vehicles.states.set('storycar', { type: 'startcar', x: spot.x, y: ORIGIN.y, z: spot.z, yaw: Math.PI, dmg: 0 });
    const v = g.vehicles.instantiate('storycar');
    this.escapeCar = v;
    g.vehicles.seatLocal(v, 0); // bypasses the server vehEnter round-trip — see class docblock
    for (const c of this.companions) c.seat = true;
    g.ui.bigMessage?.('GO GO GO', 'Get out of here!', 3.5, '#ffd23f');
    this.chaseTimer = 3; // a short head start before pursuers appear
  }
  spawnChase() {
    const g = this.game;
    const v = this.escapeCar;
    if (!v) return;
    this.chaseCars = [];
    for (let i = 0; i < 2; i++) {
      const behind = v.position.clone().addScaledVector(new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw)), -(14 + i * 6));
      g.vehicles.states.set(`chase${i}`, { type: 'sedan', x: behind.x, y: ORIGIN.y, z: behind.z, yaw: v.yaw, dmg: 0, color: '#7a1620' });
      const cv = g.vehicles.instantiate(`chase${i}`);
      cv.hits = 0;
      const occupants = [];
      for (let k = 0; k < 2; k++) {
        const npc = this.spawnEnemy(behind, v.yaw);
        npc.state = 'shoot'; npc.threat = g.avatar;
        occupants.push(npc);
      }
      this.chaseCars.push({ v: cv, occupants });
    }
    g.ui.notify('They\'re right behind you — shoot the chase cars!', 'bad');
  }
  clearChase() {
    const g = this.game;
    for (const c of this.chaseCars) {
      for (const n of c.occupants) { g.npcs.extra = (g.npcs.extra || []).filter((x) => x !== n); g.npcs.remove(n); }
      if (g.vehicles.vehicles.has(c.v.id)) g.vehicles.removeVehicle(c.v);
    }
    this.chaseCars = [];
    if (this.escapeCar && g.vehicles.current === this.escapeCar) g.vehicles.exitLocal(true);
    if (this.escapeCar && g.vehicles.vehicles.has(this.escapeCar.id)) g.vehicles.removeVehicle(this.escapeCar);
    this.escapeCar = null;
  }
  /** Called from WeaponManager.applyHit when a bullet lands on a vehicle marked chaseTarget —
   * counts only direct hits on the vehicle body, never stray/missed shots. */
  registerChaseHit(vehicle) {
    const c = this.chaseCars.find((x) => x.v === vehicle);
    if (!c || c.destroyed) return;
    c.v.hits = (c.v.hits || 0) + 1;
    this.game.hud?.hitMarker?.();
    if (c.v.hits >= HITS_TO_DESTROY) {
      c.destroyed = true;
      this.game.vehicles.destroy(c.v);
      for (const n of c.occupants) if (n.alive) n.die(this.game.avatar);
    }
  }

  // ------------------------------------------------------------------ hotel finish
  async finish() {
    const g = this.game;
    this.clearWaveEnemies();
    this.clearChase();
    this.teardownForest();
    this.removeCompanions();
    const hotel = g.layout.landmarks.storyHotel || g.layout.landmarks.plazaPark;
    g.player.teleport(hotel.x, null, hotel.z, 0);
    g.police?.clear(true);
    // an exact $50,000 balance (not an add-on-top reward) — handled server/LocalBackend-side so
    // it can't be granted twice by re-entering this phase
    const res = await g.net.request('reward', { kind: 'storyStart' });
    if (res.profile) g.setProfile(res.profile);
    this.phase = 'done';
    g.ui.bigMessage?.('WELCOME TO APPLERUN', 'You start with $50,000. The city is yours.', 6, '#7dff9b');
  }

  /** v1.3 fix: if the player bails out of the intro early (pause menu -> quit to main menu, or
   * dies mid-sequence) instead of reaching the natural finish() above, nothing ever restored the
   * real city / lighting / police — "exit to main menu, the full game is all black". Called from
   * Game.toMainMenu()/respawn() so every exit path leaves the world in a normal state. */
  abort() {
    if (!this.active()) return;
    const g = this.game;
    this._finishVideo?.(); // remove any cutscene overlay immediately, don't wait for 'ended'
    this.clearWaveEnemies();
    this.clearChase();
    this.removeCompanions();
    this.teardownForest();
    g.police?.clear(true);
    this.phase = 'idle';
    // if the player is still standing in (or near) the forest pocket, they'd otherwise be dropped
    // into open ocean once the pocket's ground override no longer applies to them
    if (g.player && Math.hypot(g.player.pos.x - ORIGIN.x, g.player.pos.z - ORIGIN.z) < STORY_RADIUS + 40) {
      const sp = g.layout.spawnPoints[0];
      g.player.teleport(sp.x, null, sp.z);
    }
  }
  onLeave() { this.abort(); }

  // ------------------------------------------------------------------ per-frame
  update(dt, playing) {
    if (!playing || this.phase === 'idle' || this.phase === 'done') return;
    const g = this.game;
    // the forest/chase pocket sits far outside the real heightfield — pin players and companions
    // to its flat ground plane instead of letting the normal terrain-following code run there
    if (this.forestGroup && g.player.mode !== 'vehicle') g.player.pos.y = ORIGIN.y + 0.02;
    for (const c of this.companions) {
      if (c.seat) continue;
      const target = g.player.pos.clone().addScaledVector(new THREE.Vector3(Math.sin(g.avatar.yaw + 1), 0, Math.cos(g.avatar.yaw + 1)), 2.2);
      c.avatar.position.lerp(target, Math.min(1, dt * 2));
      c.avatar.position.y = ORIGIN.y;
      const foe = this.enemies.find((n) => n.alive);
      if (foe) {
        c.avatar.yaw = Math.atan2(foe.position.x - c.avatar.position.x, foe.position.z - c.avatar.position.z);
        c.cd -= dt;
        if (c.cd <= 0) { c.cd = 1.2 + Math.random(); foe.takeDamage(18, null); }
      }
      c.avatar.update(dt, {});
    }
    if (this.phase === 'chase' && this.escapeCar) {
      for (const c of this.chaseCars) {
        if (c.destroyed) continue;
        const v = c.v, target = this.escapeCar;
        const behindDist = 10 + Math.sin(performance.now() / 900) * 2;
        const want = target.position.clone().addScaledVector(new THREE.Vector3(Math.sin(target.yaw), 0, Math.cos(target.yaw)), -behindDist);
        const dir = want.clone().sub(v.position);
        const dist = dir.length();
        if (dist > 0.5) {
          v.yaw += ((Math.atan2(dir.x, dir.z) - v.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 2);
          v.speed = Math.min(target.speed + 4, dist * 1.5);
          v.position.addScaledVector(new THREE.Vector3(Math.sin(v.yaw), 0, Math.cos(v.yaw)), v.speed * dt);
          v.group.position.copy(v.position); v.group.rotation.y = v.yaw;
        }
        for (const n of c.occupants) if (n.alive) { n.position.copy(v.position); n.threat = g.avatar; n.state = 'shoot'; }
      }
    }
    // host-only stage advancement — see the class docblock on why only the host decides this
    if (!this.isHost()) return;
    if ((this.phase === 'forestSpawn' || this.phase === 'wave') && this.enemies.length && this.enemies.every((n) => !n.alive)) {
      this.killed += this.enemies.length;
      if (this.waveIdx < WAVE_COUNT - 1) this.advance('wave', { idx: this.waveIdx + 1 });
      else this.advance('saverVideo');
    } else if (this.phase === 'escapeCar') {
      this.chaseTimer -= dt;
      if (this.chaseTimer <= 0) this.advance('chase');
    } else if (this.phase === 'chase' && this.chaseCars.length && this.chaseCars.every((c) => c.destroyed)) {
      this.advance('escapeVideo');
    }
  }
}
