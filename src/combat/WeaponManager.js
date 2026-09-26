import * as THREE from 'three';
import { WEAPONS, SHOP_ITEMS } from '../../shared/weapons.js';
import { weaponModel } from './WeaponModels.js';
import { h } from '../ui/dom.js';

// Local player's weapons + all combat networking (shots, hits, kills, respawns).
const SLOT_ORDER = [1, 2, 3, 4];

export class WeaponManager {
  constructor(game) {
    this.game = game;
    this.owned = ['fists'];
    this.mags = {};          // weapon -> rounds in magazine (client side)
    this.current = 'fists';
    this.cooldown = 0;
    this.reloading = 0;
    this.bloom = 0;
    this.meleeSide = false;
    this.loadout = null;     // activity override {weapons:[], ammo:{}}
    this.viewModel = null;
    this.vmKick = 0;
    this.holstered = false;
    this.grenades = []; // in-flight thrown grenades (client-simulated arc; server validates the explosion)
    const net = game.net;
    net.on('shot', (m) => this.onRemoteShot(m));
    net.on('hit', (m) => this.onHit(m));
    net.on('kill', (m) => this.onKill(m));
    net.on('respawn', (m) => this.onRespawn(m));
    net.on('hp', (m) => { if (m.id === net.id) { game.player.health = m.hp; game.player.armor = m.armor; } });
    net.on('ammo', (m) => { if (this.game.profile.ammo) this.game.profile.ammo[m.w] = m.n; this.mags[m.w] = Math.min(this.mags[m.w] || 0, m.n); });
  }

  // ------------------------------------------------------------------ inventory
  onProfile(p) {
    if (this.loadout) return;
    this.owned = ['fists', ...p.weapons.filter((w) => w !== 'fists')];
    for (const w of this.owned) {
      const def = WEAPONS[w];
      if (!def.mag) continue;
      const total = p.ammo[w] || 0;
      if (this.mags[w] === undefined || this.mags[w] > total) this.mags[w] = Math.min(def.mag, total);
    }
    this.game.player && (this.game.player.armor = p.armor || 0);
    if (!this.owned.includes(this.current)) this.equip('fists');
  }
  setLoadout(lo) {
    this.loadout = lo;
    if (lo) {
      this.owned = ['fists', ...lo.weapons];
      this.mags = {};
      for (const w of lo.weapons) { const d = WEAPONS[w]; if (d.mag) this.mags[w] = Math.min(d.mag, lo.ammo[w] ?? d.mag * 3); }
      this.equip(lo.weapons.find((w) => WEAPONS[w].slot === 3) || lo.weapons[0] || 'fists');
    } else { this.onProfile(this.game.profile); this.equip('fists'); }
  }
  total(w) { return this.loadout ? (this.loadout.ammo[w] ?? 0) : (this.game.profile.ammo?.[w] ?? 0); }
  spend(w) { if (this.loadout) this.loadout.ammo[w] = Math.max(0, (this.loadout.ammo[w] || 0) - 1); else this.game.profile.ammo[w] = Math.max(0, (this.game.profile.ammo[w] || 0) - 1); }
  def() { return WEAPONS[this.current]; }
  currentId() { return this.holstered ? 'fists' : this.current; }
  name(w) { return WEAPONS[w]?.name || w; }
  animFor(w) { const d = WEAPONS[w]; if (!d || d.type === 'melee') return w === 'knife' ? 'knife' : 'none'; return d.type === 'sniper' ? 'sniper' : d.type; }
  animWeapon() {
    const d = this.def();
    if (d.id === 'fists') return this.game.player?.aiming ? 'fists' : 'none';
    return this.animFor(d.id);
  }
  canAim() { return !this.game.vehicles?.current; }
  displayModels() { return ['ak47', 'm4a1', 'deagle', 'glock', 'pistol', 'bolt', 'semisniper', 'knife', 'ak47', 'm4a1'].map((w) => weaponModel(w)).filter(Boolean); }

  equip(w) {
    if (!this.owned.includes(w) || WEAPONS[w].type === 'grenade') return;
    this.current = w;
    this.reloading = 0;
    const av = this.game.avatar;
    const m = w !== 'fists' ? weaponModel(w) : null;
    av?.hold(m);
    this.buildViewModel();
    this.game.audio.dryFire(this.game.player?.pos);
  }
  equipRemote(r, w) { r.avatar.hold(w && w !== 'fists' ? weaponModel(w) : null); }
  cycle(dir) {
    // grenades are thrown with a dedicated key (see throwGrenade), never cycled/equipped as the held weapon
    const list = this.owned.filter((w) => WEAPONS[w].type !== 'grenade').sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot);
    const i = list.indexOf(this.current);
    this.equip(list[(i + dir + list.length) % list.length]);
  }
  selectSlot(slot) {
    const inSlot = this.owned.filter((w) => WEAPONS[w].slot === slot);
    if (!inSlot.length) return;
    const i = inSlot.indexOf(this.current);
    this.equip(inSlot[(i + 1) % inSlot.length]);
  }

  // ------------------------------------------------------------------ view model (first person)
  buildViewModel() {
    const cam = this.game.engine.camera;
    if (this.viewModel) cam.remove(this.viewModel);
    const g = new THREE.Group();
    const skin = new THREE.MeshStandardMaterial({ color: this.game.avatar?.char.def.skin || '#d2a07c', roughness: 0.8 });
    const sleeve = new THREE.MeshStandardMaterial({ color: this.game.avatar?.char.def.outfit?.shirt || '#222', roughness: 0.9 });
    const arm = (x, z, rx) => { const a = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.35), sleeve); a.position.set(x, -0.05, z); a.rotation.x = rx; const hnd = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.09), skin); hnd.position.set(0, 0, 0.2); a.add(hnd); g.add(a); };
    const w = this.current !== 'fists' ? weaponModel(this.current) : null;
    if (w) { w.position.set(0, 0, 0); g.add(w); arm(0.0, -0.18, 0.1); if (WEAPONS[this.current].type !== 'melee') arm(-0.06, 0.15, 0.2); }
    else { arm(0.12, -0.1, 0.3); arm(-0.12, -0.1, 0.3); }
    g.position.set(0.16, -0.17, -0.38);
    g.rotation.y = Math.PI; // camera looks down -Z
    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 5; } });
    g.visible = false;
    cam.add(g);
    this.viewModel = g;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, playing) {
    const g = this.game;
    const p = g.player;
    if (!p) return;
    this.cooldown -= dt;
    this.bloom = Math.max(0, this.bloom - dt * 2.5);
    const input = g.input;
    const onFoot = p.mode === 'foot' && !g.vehicles?.current && !g.seated;
    const inputOk = playing && input.locked && onFoot && !g.ui.modalOpen && !g.dialogue?.npc && !g.activities?.blocksWeapons?.();
    if (inputOk) {
      for (const s of SLOT_ORDER) if (input.hit('slot' + s)) this.selectSlot(s);
      if (input.hit('slot5')) this.useMedkit();
      if (input.hit('grenade')) this.throwGrenade();
      if (input.mouse.wheel) this.cycle(input.mouse.wheel > 0 ? 1 : -1);
      if (input.hit('reload')) this.reload();
      if (input.hit('drop') && this.current !== 'fists') { this.equip('fists'); g.ui.notify('Weapon holstered', 'info'); }
    }
    this.updateGrenades(dt);
    // reloading
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const d = this.def();
        const tot = this.total(d.id);
        this.mags[d.id] = Math.min(d.mag, tot);
      }
    }
    const d = this.def();
    const scoped = d.scope && p.aiming && onFoot;
    g.cam.zoomed = !!scoped; g.cam.zoomFov = d.scope ? d.scope : 70;
    if (this.viewModel) {
      this.viewModel.visible = g.cam.mode === 'first' && onFoot && !scoped;
      this.vmKick = Math.max(0, this.vmKick - dt * 8);
      this.viewModel.position.z = -0.38 + this.vmKick * 0.06;
      this.viewModel.rotation.x = this.vmKick * 0.15;
      this.viewModel.position.y = -0.17 - (this.reloading > 0 ? 0.08 : 0) + Math.sin(performance.now() / 180) * 0.004 * Math.min(1, p.speed);
    }
    if (!inputOk) return;
    // fire
    const wantFire = d.type === 'melee' || !d.auto ? input.mouse.leftPressed : input.mouse.left;
    if (wantFire && this.cooldown <= 0 && this.reloading <= 0) {
      if (d.type === 'melee') this.melee();
      else this.fire();
    }
  }

  // ------------------------------------------------------------------ grenades
  // Client-simulated arc + bounce (same trust model as traffic/NPCs: cosmetic simulation is
  // local-only). The server only ever sees the final explosion point and does its own
  // distance/pvp checks before applying damage — see server/rooms.js onGrenade().
  throwGrenade() {
    const g = this.game;
    const w = WEAPONS.grenade;
    if (!this.owned.includes('grenade')) return g.ui.notify('No grenades — buy one first.', 'bad');
    if ((this.total('grenade') || 0) <= 0) return g.ui.notify('Out of grenades.', 'bad');
    this.spend('grenade');
    const cam = g.engine.camera;
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const pos = g.player.pos.clone(); pos.y += 1.4;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: '#3a4a34', roughness: 0.6 }));
    mesh.position.copy(pos);
    g.world.outdoor.add(mesh);
    const vel = dir.clone().multiplyScalar(w.throwSpeed).add(new THREE.Vector3(0, 3.2, 0));
    this.grenades.push({ mesh, pos, vel, fuse: w.fuse, bounces: 0 });
    g.avatar.anim.play('interact');
    g.net.send('fx', { kind: 'anim', a: { name: 'interact' } });
  }
  updateGrenades(dt) {
    const g = this.game;
    for (const gr of this.grenades) {
      if (gr.done) continue;
      gr.vel.y -= 18 * dt;
      gr.pos.addScaledVector(gr.vel, dt);
      const h = g.world.collision.groundAt ? g.world.collision.groundAt(gr.pos.x, gr.pos.z) : 0;
      if (gr.pos.y <= h + 0.09) {
        gr.pos.y = h + 0.09;
        if (gr.bounces < 3 && gr.vel.length() > 1) { gr.vel.y *= -0.4; gr.vel.x *= 0.6; gr.vel.z *= 0.6; gr.bounces++; }
        else gr.vel.set(0, 0, 0);
      }
      gr.mesh.position.copy(gr.pos);
      gr.fuse -= dt;
      if (gr.fuse <= 0) this.explodeGrenade(gr);
    }
    this.grenades = this.grenades.filter((gr) => !gr.done);
  }
  explodeGrenade(gr) {
    const g = this.game;
    gr.done = true;
    gr.mesh.parent?.remove(gr.mesh);
    g.fx?.explosion(gr.pos);
    g.audio.crash?.(gr.pos, 0.6);
    g.cam.addShake(Math.max(0, 1 - g.player.pos.distanceTo(gr.pos) / 30));
    if (g.net.connected && g.net.room) g.net.send('grenade', { x: +gr.pos.x.toFixed(2), y: +gr.pos.y.toFixed(2), z: +gr.pos.z.toFixed(2) });
    if (!g.inActivity) { g.npcs?.explosion?.(gr.pos, 8); g.police?.reportCrime?.('explosion', 2, gr.pos); }
  }

  reload() {
    const d = this.def();
    if (!d.mag || this.reloading > 0) return;
    const tot = this.total(d.id);
    if ((this.mags[d.id] || 0) >= d.mag || tot <= (this.mags[d.id] || 0)) return;
    this.reloading = d.reload;
    this.game.avatar.anim.play('reload', 1.6 / d.reload);
    this.game.audio.reload(this.game.player.pos, d.reload);
    this.game.net.send('fx', { kind: 'anim', a: { name: 'reload' } });
  }

  fire() {
    const g = this.game;
    const d = this.def();
    if ((this.mags[d.id] || 0) <= 0) { this.cooldown = 0.25; g.audio.dryFire(g.player.pos); if (this.total(d.id) > 0) this.reload(); return; }
    this.cooldown = 60 / d.rpm;
    this.mags[d.id]--;
    this.spend(d.id);
    const p = g.player;
    const cam = g.engine.camera;
    // spread
    const moving = Math.min(1, p.speed / 5);
    let spread = (p.aiming ? d.aimSpread : d.spread) * (1 + moving * 1.5 + this.bloom * 2) * (p.crouch ? 0.7 : 1);
    if (d.type === 'sniper' && !p.aiming) spread = d.spread;
    const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
    const rnd = () => (Math.random() - 0.5) * 2 * spread;
    const right = new THREE.Vector3().crossVectors(dir, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(right, dir).normalize();
    dir.addScaledVector(right, rnd()).addScaledVector(up, rnd()).normalize();
    const origin = cam.position.clone();
    // start the ray at the player's depth so walls behind the player (3rd person) don't block
    const toPlayer = p.pos.clone().setY(p.pos.y + 1.5).sub(origin).dot(dir);
    if (toPlayer > 0) origin.addScaledVector(dir, toPlayer);
    const hit = this.traceHit(origin, dir, d.range * 1.5);
    const muzzle = this.muzzlePos(dir);
    g.fx.muzzle(muzzle);
    g.fx.tracer(muzzle, hit.point);
    g.audio.gunshot(muzzle, d.sound || d.id);
    g.cam.kick(d.recoil * (p.aiming ? 0.7 : 1) * (p.crouch ? 0.7 : 1));
    g.cam.yaw += (Math.random() - 0.5) * d.recoil * 0.4;
    this.bloom = Math.min(1, this.bloom + d.recoil * 6);
    this.vmKick = 1;
    g.avatar.anim.play('recoil');
    // network: every shot (server validates fire rate/ammo; hits carry the target)
    let netHit = null;
    if (hit.kind === 'player') netHit = { id: hit.remote.id, head: hit.head };
    if (g.net.connected && g.net.room) g.net.send('shoot', { w: d.id, o: [+origin.x.toFixed(2), +origin.y.toFixed(2), +origin.z.toFixed(2)], d: [+dir.x.toFixed(4), +dir.y.toFixed(4), +dir.z.toFixed(4)], hit: netHit });
    this.applyHit(hit, d);
    // world reactions
    if (!g.inActivity) {
      g.npcs?.noise(g.player.pos, 55, 'gunshot', g.avatar);
      g.police?.reportCrime?.('gunfire', 1, g.player.pos);
      g.dialogue?.logEvent(g.player.pos, 'someone was firing a gun');
    }
  }
  muzzlePos(dir) {
    const held = this.game.avatar.held;
    if (held && this.game.cam.mode !== 'first') {
      held.updateMatrixWorld(true);
      return new THREE.Vector3(0, 0.04, held.userData.muzzle || 0.5).applyMatrix4(held.matrixWorld);
    }
    return this.game.engine.camera.position.clone().addScaledVector(dir, 0.6).add(new THREE.Vector3(0, -0.12, 0));
  }

  /** Find the first thing along the ray: world geometry, NPCs, players, vehicles. */
  traceHit(o, d, maxT) {
    const g = this.game;
    const world = g.world.collision.raycast([o.x, o.y, o.z], [d.x, d.y, d.z], maxT, { ignore: g.vehicles?.current?.collider, filter: (c) => c.kind !== 'npc' && c.owner !== g.player });
    let best = { t: world ? world.t : maxT, kind: world ? 'world' : 'none', collider: world?.collider };
    const npc = g.npcs?.raycast(o, d, best.t);
    if (npc && npc.t < best.t) best = { t: npc.t, kind: 'npc', npc: npc.npc, head: npc.head };
    // remote players (capsule test)
    for (const r of g.mp.remotes.values()) {
      if (!r.avatar.group.visible || r.hp <= 0) continue;
      const p = r.avatar.position, hgt = r.avatar.char.height;
      for (const [yy, rad, head] of [[hgt * 0.92, 0.17, true], [hgt * 0.68, 0.32, false], [hgt * 0.42, 0.32, false], [hgt * 0.15, 0.24, false]]) {
        const cx = p.x - o.x, cy = p.y + yy - o.y, cz = p.z - o.z;
        const t = cx * d.x + cy * d.y + cz * d.z;
        if (t < 0 || t > best.t) continue;
        const qx = cx - d.x * t, qy = cy - d.y * t, qz = cz - d.z * t;
        if (qx * qx + qy * qy + qz * qz < rad * rad) { best = { t, kind: 'player', remote: r, head }; break; }
      }
    }
    best.point = o.clone().addScaledVector(d, best.t);
    return best;
  }
  applyHit(hit, d) {
    const g = this.game;
    if (hit.kind === 'npc') {
      const falloff = 1 - (1 - (d.falloff ?? 1)) * Math.min(1, hit.t / d.range);
      hit.npc.takeDamage(d.damage * falloff, g.avatar, hit.head);
      g.hud.hitMarker(); g.audio.hitmarker();
      if (!hit.npc.alive) g.hud.kill(`${g.settings.get('player.name')} ✖ ${hit.npc.persona.short}`);
    } else if (hit.kind === 'player') {
      g.fx.blood(hit.point);
    } else if (hit.kind === 'world') {
      const c = hit.collider;
      if (c?.owner?.spec) { c.owner.dmg = Math.min(100, c.owner.dmg + d.damage * 0.08); g.fx.sparks(hit.point, 5); g.audio.impact(hit.point, 'metal'); if (c.owner.dmg >= 100) g.vehicles.destroy(c.owner); }
      else if (c?.traffic) { g.fx.sparks(hit.point, 5); g.audio.impact(hit.point, 'metal'); g.traffic.onRammed(c.traffic, 0); }
      else { g.fx.sparks(hit.point, 4, '#d7ccc8'); g.fx.dust(hit.point); g.audio.impact(hit.point); }
    }
  }

  melee() {
    const g = this.game;
    const d = this.def();
    this.cooldown = 60 / d.rpm;
    const av = g.avatar;
    const name = d.id === 'knife' ? 'slash' : (this.meleeSide = !this.meleeSide) ? 'punch' : 'punchL';
    av.anim.play(name);
    g.net.send('fx', { kind: 'anim', a: { name } });
    const str = av.char.def.stats?.strength || 1;
    setTimeout(() => {
      const p = g.player.pos;
      const fwd = new THREE.Vector3(Math.sin(av.yaw), 0, Math.cos(av.yaw));
      // NPCs
      let hitSomething = false;
      for (const n of g.npcs?.all() || []) {
        if (!n.alive) continue;
        const to = n.position.clone().sub(p); const dist = to.length(); to.y = 0; to.normalize();
        if (dist < 1.9 && to.dot(fwd) > 0.4) {
          n.takeDamage(d.damage * str, g.avatar);
          if (d.id === 'fists' && Math.random() < 0.25 * str) n.knockDown(fwd, 3);
          hitSomething = true;
          g.police?.reportCrime?.('assault', 1, n.position);
        }
      }
      for (const r of g.mp.remotes.values()) {
        const to = r.avatar.position.clone().sub(p); const dist = to.length(); to.y = 0; to.normalize();
        if (dist < 2.1 && to.dot(fwd) > 0.4) { g.net.send('melee', { target: r.id, w: d.id }); hitSomething = true; }
      }
      if (hitSomething) { g.audio.punch(p); g.cam.addShake(0.12); g.hud.hitMarker(); }
      else g.audio.noiseBurst?.(p, { dur: 0.12, freq: 800, vol: 0.12, ref: 3 });
      if (hitSomething && !g.inActivity) g.npcs?.noise(p, 20, 'fight', g.avatar);
    }, 150);
  }

  async useMedkit() {
    const g = this.game;
    if ((g.profile.medkits | 0) <= 0) return g.ui.notify('No medkits. Buy them at a gun store.', 'bad');
    if (g.player.health >= 100) return g.ui.notify('Already at full health.', 'info');
    const r = await g.net.request('useMedkit', {});
    if (r.ok || !g.net.connected) {
      if (r.profile) g.setProfile(r.profile); else { g.profile.medkits--; }
      g.player.health = 100;
      g.ui.notify('Medkit used (+health)', 'good');
    } else g.ui.notify(r.error, 'bad');
  }

  // ------------------------------------------------------------------ network combat events
  onRemoteShot(m) {
    const g = this.game;
    const r = g.mp.remotes.get(m.id);
    const o = new THREE.Vector3(...m.o), d = new THREE.Vector3(...m.d);
    const from = r ? r.avatar.position.clone().add(new THREE.Vector3(0, r.avatar.char.height * 0.75, 0)).addScaledVector(d, 0.6) : o;
    const hit = g.world.collision.raycast([o.x, o.y, o.z], [d.x, d.y, d.z], 150, {});
    const to = o.clone().addScaledVector(d, hit ? hit.t : 150);
    g.fx.muzzle(from); g.fx.tracer(from, to);
    g.audio.gunshot(from, WEAPONS[m.w]?.sound || m.w);
    if (hit) g.fx.sparks(to, 3);
    r?.avatar.anim.play('recoil');
    if (!g.inActivity) g.npcs?.noise(from, 50, 'gunshot', null);
  }
  onHit(m) {
    const g = this.game;
    if (m.to === g.net.id) {
      g.player.health = m.hp; g.player.armor = m.armor;
      g.hud.hitFlash(Math.min(1, m.dmg / 35));
      g.cam.addShake(Math.min(0.5, m.dmg / 60));
      g.avatar.anim.play('hit');
      if (m.knock && g.player.mode === 'foot') { g.avatar.anim.play('hit'); }
      if (m.from) this.lastAttacker = m.from;
    } else {
      const r = g.mp.remotes.get(m.to);
      if (r) { r.hp = m.hp; g.fx.blood(r.avatar.position.clone().add(new THREE.Vector3(0, m.head ? r.avatar.char.height * 0.9 : 1.1, 0))); r.avatar.anim.play('hit'); }
      if (m.from === g.net.id) { g.hud.hitMarker(); g.audio.hitmarker(); }
    }
  }
  onKill(m) {
    const g = this.game;
    const me = g.net.id;
    const weapon = WEAPONS[m.cause]?.name || m.cause;
    g.hud.kill(m.kname ? `${m.kname} ✖ ${m.vname}${m.head ? ' (headshot)' : ''} — ${weapon}` : `${m.vname} died (${m.cause})`);
    if (m.victim === me) this.localDeath(m.kname ? `Killed by ${m.kname}` : `You died (${m.cause})`);
    if (m.killer === me && m.victim !== me) g.audio.cash();
    g.activities?.onKill?.(m);
  }
  localDeath(why) {
    const g = this.game;
    if (g.player.mode === 'dead') return;
    if (g.vehicles?.current) g.vehicles.exitLocal(true);
    if (g.seated) g.standUp();
    g.dialogue?.close();
    g.player.mode = 'dead';
    g.player.health = 0;
    g.avatar.anim.setLoop('dead');
    const canRevive = !g.inActivity && g.net.connected && g.mp.remotes.size > 0;
    g.hud.bigMessage(g.inActivity ? 'ELIMINATED' : canRevive ? 'DOWNED' : 'WASTED', canRevive ? `${why} — a friend can revive you (E), or wait for the ambulance` : why, canRevive ? 9.5 : 4.5, '#ff4757');
    g.police?.onPlayerDeath?.();
    this.deathT = 0;
    const respawnDelay = g.activities?.respawnDelay?.() ?? (canRevive ? 10 : 5);
    setTimeout(() => {
      if (g.player.mode !== 'dead') return;
      if (g.net.connected && g.net.room) g.net.send('respawnReq');
      else this.localRespawn();
    }, respawnDelay * 1000);
  }
  localRespawn() {
    const g = this.game;
    const L = g.layout;
    const hb = L.buildings[L.special.hospital];
    const spot = g.activities?.spawnPoint?.() || { x: hb.door.x + Math.sin(hb.door.rot) * 3, z: hb.door.z + Math.cos(hb.door.rot) * 3 };
    this.onRespawn({ id: g.net.id, p: [spot.x, 0, spot.z], hp: 100, local: true });
    if (!g.inActivity) g.net.request('reward', { kind: 'hospital' }).then((r) => r.profile && g.setProfile(r.profile));
  }
  onRespawn(m) {
    const g = this.game;
    if (m.id !== g.net.id && !m.local) { const r = g.mp.remotes.get(m.id); if (r) { r.hp = m.hp; r.avatar.anim.play('getUp'); } return; }
    if (g.interiors?.current) { g.interiors.current.group.visible = false; g.interiors.current = null; g.player.interior = null; g.world.setOutdoorVisible(true); g.engine.scene.background = null; g.engine.scene.fog.density = 0.0009; }
    g.player.mode = 'foot';
    g.player.health = m.hp ?? 100;
    g.avatar.anim.setLoop(null);
    g.avatar.anim.play('getUp');
    if (m.revived) { g.hud.bigMessage('REVIVED', `${m.by} got you back on your feet.`, 2.5, '#7dff9b'); g.player.vel.set(0, 0, 0); return; }
    g.player.teleport(m.p[0], null, m.p[2]);
    if (!g.inActivity) g.hud.bigMessage('APPLERUN GENERAL', 'You were patched up at the hospital ($200 bill).', 3, '#7dff9b');
    g.police?.clear?.();
    g.activities?.onRespawn?.();
  }

  // ------------------------------------------------------------------ HUD & shop
  hud() {
    const d = this.def();
    const p = this.game.player;
    return {
      weaponName: this.reloading > 0 ? `${d.name} — reloading…` : d.name,
      ammo: d.mag ? this.mags[d.id] || 0 : null,
      reserve: d.mag ? Math.max(0, this.total(d.id) - (this.mags[d.id] || 0)) : 0,
      slots: this.owned.slice().sort((a, b) => WEAPONS[a].slot - WEAPONS[b].slot).map((w) => ({ short: WEAPONS[w].short, active: w === this.current })),
      aiming: p?.aiming && d.type !== 'melee',
      scoped: this.game.cam?.zoomed,
    };
  }
  openShop() {
    const g = this.game;
    g.suppressPause = true;
    g.input.unlock();
    const grid = h('div.shop-grid');
    const money = h('b', `$${g.profile.money}`);
    const render = () => {
      money.textContent = `$${g.profile.money.toLocaleString()}`;
      grid.replaceChildren(...Object.values(SHOP_ITEMS).map((it) => {
        const owned = it.kind === 'weapon' && g.profile.weapons.includes(it.id);
        const w = it.kind === 'weapon' ? WEAPONS[it.id] : it.kind === 'ammo' ? WEAPONS[it.weapon] : null;
        const stat = w && it.kind === 'weapon' ? (w.type === 'melee' ? `Damage ${w.damage}` : w.type === 'grenade' ? `Damage ${w.damage} · radius ${w.radius}m` : `Dmg ${w.damage} · ${w.rpm} RPM · Mag ${w.mag}`) : it.kind === 'ammo' ? `Have ${g.profile.ammo[it.weapon] || 0}` : it.kind === 'armor' ? `Armor ${g.profile.armor || 0}/100` : `Have ${g.profile.medkits || 0}`;
        return h('div.shop-item', h('b', it.name), h('div.muted', { style: { fontSize: '12px' } }, stat), h('div.price', `$${it.price.toLocaleString()}`),
          h('button.btn.small' + (owned ? '' : '.primary'), {
            disabled: owned || (it.kind === 'ammo' && !g.profile.weapons.includes(it.weapon)),
            onclick: async () => {
              const r = await g.net.request('buy', { item: it.id });
              if (r.ok) { g.setProfile(r.profile); g.audio.cash(); g.ui.notify(`Bought ${it.name}`, 'good'); if (it.kind === 'weapon' && WEAPONS[it.id].type !== 'grenade') this.equip(it.id); if (it.kind === 'armor') g.player.armor = 100; }
              else g.ui.notify(r.error || 'Purchase failed', 'bad');
              render();
            },
          }, owned ? 'Owned' : 'Buy'));
      }));
    };
    render();
    g.ui.modal('Applerun Guns', h('div', h('p.muted', 'Purchases are validated by the server. Money: ', money), grid), { wide: true, onClose: () => g.input.lock() });
  }
}
