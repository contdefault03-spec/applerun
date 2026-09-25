import * as THREE from 'three';
import { Vehicle } from '../vehicles/Vehicle.js';
import { NPC } from '../npc/NPC.js';
import { AIDriver } from './AIDriver.js';
import { h } from '../ui/dom.js';

// Crime & police: witnessed crimes raise a wanted level (1-5 stars); police respond with
// officers on foot, pursuit cruisers and (at 4+) a helicopter. Break line of sight to
// evade, get busted (arrest + fine) or turn yourself in at a police station.
const CRIMES = {
  gunfire: { sev: 1, text: 'shots fired' }, assault: { sev: 1, text: 'an assault' }, theft: { sev: 1, text: 'a stolen vehicle' },
  trespass: { sev: 1, text: 'a break-in' }, carjack: { sev: 2, text: 'a carjacking' }, robbery: { sev: 2, text: 'a robbery' },
  murder: { sev: 2, text: 'a homicide' }, vehicular: { sev: 2, text: 'a hit-and-run' }, explosion: { sev: 2, text: 'an explosion' }, copkill: { sev: 3, text: 'an officer down' },
};

export class PoliceManager {
  constructor(game) {
    this.game = game;
    this.level = 0;
    this.seen = false;
    this.lostT = 0;
    this.units = [];     // {veh, driver, officers[]}
    this.officers = [];  // on-foot officers (NPC)
    this.heli = null;
    game.lights.spot('heli', { distance: 120, angle: 0.25, penumbra: 0.4 }); // reserved up front (no shader recompiles later)
    this.reportQueue = [];
    this.arresting = 0;
    this.onDuty = false;
    this.spawnT = 0;
  }

  // ------------------------------------------------------------------ crimes
  reportCrime(kind, severity = null, pos = null) {
    const g = this.game;
    if (g.inActivity || !g.player || g.player.mode === 'dead') return;
    const c = CRIMES[kind] || { sev: 1, text: kind };
    const sev = severity ?? c.sev;
    const where = pos || g.player.pos;
    // who saw it?
    const cops = [...(g.npcs?.all() || []), ...this.officers].filter((n) => n.alive && n.role === 'police' && n.position.distanceTo(where) < 55);
    const copCars = this.units.filter((u) => u.veh.position.distanceTo(where) < 70);
    const witnesses = (g.npcs?.all() || []).filter((n) => n.alive && n.role !== 'police' && n.role !== 'gang' && n.position.distanceTo(where) < 35);
    g.dialogue?.logEvent(where, c.text);
    if (cops.length || copCars.length) this.raise(sev, `Police witnessed ${c.text}!`);
    else if (kind === 'gunfire' || kind === 'explosion') this.reportQueue.push({ t: 6 + Math.random() * 4, sev, text: c.text });
    else if (witnesses.length) this.reportQueue.push({ t: 5 + Math.random() * 6, sev, text: c.text });
  }
  npcReport(npc) { if (npc.alive) this.reportQueue.push({ t: 1, sev: 1, text: 'a 911 call' }); }
  policeNoticed(cop, source) {
    if (!cop.alive) return;
    const g = this.game;
    if (source === g.avatar || !source) { if (this.level === 0) this.raise(1, 'An officer heard gunshots!'); cop.provoke(g.avatar, 'gunshot'); }
  }
  raise(sev, why) {
    const g = this.game;
    const before = this.level;
    this.level = Math.min(5, Math.max(this.level + (this.level >= sev ? 1 : 0) * (sev >= 2 ? 1 : 0), sev, this.level));
    if (this.level > before) {
      g.ui.notify(`${why} Wanted level ${this.level} ★`, 'bad');
      g.net.send('wanted', { level: this.level });
    }
    this.seen = true; this.lostT = 0;
  }
  clear(silent = false) {
    if (this.level && !silent) this.game.ui.notify('You lost the cops. Wanted level cleared.', 'good');
    this.level = 0; this.seen = false; this.lostT = 0;
    this.game.net.send('wanted', { level: 0 });
    this.dismissAll();
  }
  onPlayerDeath() { this.level = 0; this.game.net.send('wanted', { level: 0 }); this.dismissAll(); }

  // ------------------------------------------------------------------ units
  spawnCar() {
    const g = this.game;
    const pp = g.player.pos;
    // spawn on a road 90-160m away, out of sight if possible
    const roads = g.layout.roads.filter((r) => r.type !== 'mountain');
    for (let tries = 0; tries < 20; tries++) {
      const r = roads[Math.floor(Math.random() * roads.length)];
      const pt = r.pts[Math.floor(Math.random() * r.pts.length)];
      const d = Math.hypot(pt[0] - pp.x, pt[1] - pp.z);
      if (d < 80 || d > 170) continue;
      const type = this.level >= 4 && Math.random() < 0.4 ? 'suv' : 'police';
      const v = new Vehicle(g.vehicles, { id: 'cop' + Math.random().toString(36).slice(2, 7), type: 'police', x: pt[0], z: pt[1], yaw: Math.atan2(pp.x - pt[0], pp.z - pt[1]) });
      if (type === 'suv') v.spec = { ...v.spec, maxSpeed: 62 };
      v.siren = true;
      g.engine.scene.add(v.group);
      g.world.collision.add(v.collider);
      v.sirenSound = g.audio.siren('police');
      v.engine = g.audio.engineLoop('car');
      const unit = { veh: v, ai: new AIDriver(g, v), state: 'chase', officers: [], deployT: 0 };
      this.units.push(unit);
      return unit;
    }
    return null;
  }
  spawnOfficer(pos) {
    const g = this.game;
    const n = new NPC(g.npcs, { role: 'police', variant: Math.floor(Math.random() * 2), x: pos.x, y: g.world.collision.groundAt(pos.x, pos.z), z: pos.z });
    n.armed = true; n.weapon = this.level >= 4 ? 'ak47' : 'pistol';
    g.npcs.add(n);
    n.state = 'goto';
    this.officers.push(n);
    return n;
  }
  dismissAll() {
    const g = this.game;
    for (const u of this.units) { u.leaving = true; u.veh.siren = false; if (u.veh.sirenSound) { u.veh.sirenSound.stop(); u.veh.sirenSound = null; } }
    for (const o of this.officers) if (o.alive) { o.state = 'wander'; o.threat = null; }
    if (this.heli) { this.heli.leaving = true; }
    void g;
  }
  removeUnit(u) {
    const g = this.game;
    g.engine.scene.remove(u.veh.group);
    g.world.collision.remove(u.veh.collider);
    u.veh.sirenSound?.stop(); u.veh.engine?.stop();
    this.units.splice(this.units.indexOf(u), 1);
  }

  // ------------------------------------------------------------------ helicopter
  spawnHeli() {
    const g = this.game;
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), new THREE.MeshStandardMaterial({ color: '#1b2a4a', roughness: 0.4, metalness: 0.4 }));
    body.scale.set(1, 0.9, 1.8); grp.add(body);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 5), body.material); tail.position.z = -4; grp.add(tail);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.35), new THREE.MeshStandardMaterial({ color: '#111' })); rotor.position.y = 1.6; grp.add(rotor);
    const rotor2 = rotor.clone(); rotor2.rotation.y = Math.PI / 2; grp.add(rotor2);
    const light = g.lights.spot('heli', { distance: 120, angle: 0.25, penumbra: 0.4 });
    light.intensity = 400;
    grp.position.copy(g.player.pos).add(new THREE.Vector3(80, 60, 80));
    g.engine.scene.add(grp);
    this.heli = { grp, rotor, rotor2, light, t: 0, shootT: 3, sound: g.audio.engineLoop('truck') };
  }
  updateHeli(dt) {
    const g = this.game;
    const H = this.heli;
    H.t += dt;
    const pp = g.player.pos;
    const target = H.leaving ? pp.clone().add(new THREE.Vector3(400, 120, 400)) : pp.clone().add(new THREE.Vector3(Math.cos(H.t * 0.3) * 35, 40, Math.sin(H.t * 0.3) * 35));
    H.grp.position.lerp(target, Math.min(1, dt * 0.6));
    H.grp.lookAt(pp.x, H.grp.position.y, pp.z);
    H.rotor.rotation.y += dt * 30; H.rotor2.rotation.y += dt * 30;
    H.light.position.copy(H.grp.position).y -= 1;
    H.light.target.position.copy(pp);
    H.light.intensity = g.world.env.nightFactor > 0.3 ? 400 : 0;
    H.sound?.update(H.grp.position, 0.7, 0.6, 0);
    if (!H.leaving && this.level >= 5) {
      H.shootT -= dt;
      if (H.shootT < 0) { H.shootT = 0.18; const from = H.grp.position.clone(); g.audio.gunshot(from, 'm4a1'); const miss = Math.random() > 0.2; const to = pp.clone().add(new THREE.Vector3(miss ? (Math.random() - 0.5) * 6 : 0, 1, miss ? (Math.random() - 0.5) * 6 : 0)); g.fx.tracer(from, to); if (!miss) g.damageSelf(6, 'police'); }
    }
    if (H.leaving && H.grp.position.distanceTo(pp) > 300) { g.engine.scene.remove(H.grp); H.sound?.stop(); H.light.intensity = 0; this.heli = null; }
  }

  // ------------------------------------------------------------------ per frame
  update(dt, playing) {
    const g = this.game;
    if (!g.player) return;
    // delayed reports (911 calls)
    for (let i = this.reportQueue.length - 1; i >= 0; i--) {
      const r = this.reportQueue[i];
      r.t -= dt;
      if (r.t <= 0) { this.reportQueue.splice(i, 1); this.raise(r.sev, `Someone reported ${r.text}.`); }
    }
    const pp = g.player.pos;
    const inVeh = g.vehicles?.current;
    // line of sight: any cop within range that can see the player
    let seen = false;
    const canSee = (pos, range) => {
      if (pos.distanceTo(pp) > range) return false;
      const o = pos.clone(); o.y += 1.5;
      const d = pp.clone().setY(pp.y + 1.2).sub(o); const L = d.length(); d.normalize();
      return !g.world.collision.raycast([o.x, o.y, o.z], [d.x, d.y, d.z], L - 1, { terrain: true, filter: (c) => !c.dynamic && c.kind !== 'tree' });
    };
    if (this.level > 0) {
      for (const u of this.units) if (!u.leaving && canSee(u.veh.position, 90)) seen = true;
      for (const o of this.officers) if (o.alive && canSee(o.position, 70)) seen = true;
      if (this.heli && !this.heli.leaving && this.heli.grp.position.distanceTo(pp) < 90) seen = true;
      if (g.player.interior) seen = seen && false;
      this.seen = seen;
      if (!seen) {
        this.lostT += dt;
        const need = 12 + this.level * 6;
        if (this.lostT > need) {
          this.level--; this.lostT = 0;
          g.net.send('wanted', { level: this.level });
          if (this.level === 0) this.clear();
          else g.ui.notify(`Evading… wanted level ${this.level}`, 'info');
        }
      } else this.lostT = 0;
      // maintain response
      this.spawnT -= dt;
      const wantCars = [0, 1, 2, 3, 4, 5][this.level];
      const active = this.units.filter((u) => !u.leaving).length;
      if (this.spawnT < 0 && active < wantCars && !g.player.interior) { this.spawnT = 4; this.spawnCar(); }
      if (this.level >= 4 && !this.heli) this.spawnHeli();
    }
    if (this.heli) this.updateHeli(dt);
    // drive units
    const targetVel = inVeh ? inVeh.forward().multiplyScalar(inVeh.speed) : g.player.vel;
    for (const u of [...this.units]) {
      const v = u.veh;
      if (u.leaving) {
        u.ai.drive(dt, v.position.clone().add(v.forward().multiplyScalar(50)), { stopDist: 0, maxSpeed: 0.6 });
        if (v.position.distanceTo(pp) > 220) this.removeUnit(u);
      } else {
        const dist = v.position.distanceTo(pp);
        if (inVeh || dist > 25 || u.officers.length) {
          u.ai.drive(dt, pp, { stopDist: inVeh ? 0 : 12, maxSpeed: 1, targetVel });
          // ram / box in the player's vehicle
        } else {
          // stop and deploy officers
          u.ai.drive(dt, pp, { stopDist: 30, maxSpeed: 0 });
          if (!u.officers.length && Math.abs(v.speed) < 2) {
            for (let i = 0; i < 2; i++) { const o = this.spawnOfficer(v.doorWorld(i)); u.officers.push(o); }
          }
        }
      }
      v.updateVisual(dt, g.world.env.nightFactor);
      v.engine?.update(v.position, Math.min(1, Math.abs(v.speed) / v.spec.maxSpeed), 0.6, v.skid);
      v.sirenSound?.update(v.position);
      if (v.dmg >= 100 && !v.destroyed) { g.vehicles.destroy(v); u.leaving = true; }
    }
    // officers on foot
    for (let i = this.officers.length - 1; i >= 0; i--) {
      const o = this.officers[i];
      if (!o.alive) { if (o.deadT > 30) { g.npcs.remove(o); this.officers.splice(i, 1); } else o.update(dt, { player: pp, camDist: o.position.distanceTo(g.engine.camera.position) }); continue; }
      if (this.level === 0) {
        o.state = 'wander';
        if (o.position.distanceTo(pp) > 120) { g.npcs.remove(o); this.officers.splice(i, 1); continue; }
      } else if (this.level >= 3 || g.weapons?.currentId() !== 'fists') {
        if (o.state !== 'shoot') { o.threat = g.avatar; o.state = 'shoot'; o.timer = 30; if (Math.random() < 0.5) o.say('Drop your weapon!'); }
      } else {
        // try to arrest: run up to the player
        o.threat = g.avatar; o.state = 'goto'; o.runTo = true; o.target = pp.clone(); o.after = 'goto';
        if (o.position.distanceTo(pp) < 1.8 && !inVeh && g.player.speed < 3 && g.player.mode === 'foot') {
          this.arresting += dt;
          if (this.arresting > 1.2) this.bust();
        }
      }
      o.update(dt, { player: pp, camDist: o.position.distanceTo(g.engine.camera.position) });
    }
    if (!this.officers.some((o) => o.alive && o.position.distanceTo(pp) < 2)) this.arresting = Math.max(0, this.arresting - dt);
  }

  async bust() {
    const g = this.game;
    this.arresting = 0;
    const fine = 250 * Math.max(1, this.level);
    g.player.mode = 'arrested';
    g.avatar.anim.setLoop('handsUp');
    g.hud.bigMessage('BUSTED', `Fine: $${fine}`, 4, '#4fa3ff');
    g.audio.bell();
    setTimeout(async () => {
      const r = await g.net.request('reward', { kind: 'arrest', fine });
      if (r.profile) g.setProfile(r.profile);
      const st = g.layout.buildings[g.layout.special.police];
      g.avatar.anim.setLoop(null);
      g.player.mode = 'foot';
      g.player.teleport(st.door.x + Math.sin(st.door.rot) * 3, null, st.door.z + Math.cos(st.door.rot) * 3);
      this.clear(true);
      g.ui.notify(`You were released from the Applerun PD. Fine paid: $${fine}.`, 'info');
    }, 4000);
  }

  onUse(u) {
    const g = this.game;
    if (u.kind === 'surrender') {
      if (!this.level) { g.ui.notify('You are not wanted. Stay out of trouble!', 'info'); return true; }
      const fine = 150 * this.level;
      g.net.request('reward', { kind: 'arrest', fine }).then((r) => r.profile && g.setProfile(r.profile));
      this.clear(true);
      g.ui.notify(`You turned yourself in. Fine: $${fine}. Wanted level cleared.`, 'good');
      return true;
    }
    if (u.kind === 'policejob') {
      this.onDuty = !this.onDuty;
      g.ui.notify(this.onDuty ? 'You are on police duty: crimes near you appear on the map. Stop criminals for rewards.' : 'You are off duty.', 'good');
      g.events?.setPoliceDuty?.(this.onDuty);
      return true;
    }
    return false;
  }
  onEnterInterior() { if (this.level) this.lostT += 5; }
  blips(out) {
    for (const u of this.units) if (!u.leaving) out.push({ x: u.veh.position.x, z: u.veh.position.z, color: '#4fa3ff', size: 5 });
    for (const o of this.officers) if (o.alive && this.level) out.push({ x: o.position.x, z: o.position.z, color: '#4fa3ff', size: 3 });
  }
  hudPanel() { return this.onDuty ? h('div') : null; }
}
