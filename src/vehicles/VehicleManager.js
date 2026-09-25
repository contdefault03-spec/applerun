import * as THREE from 'three';
import { Vehicle } from './Vehicle.js';
import { SPECS } from './VehicleModels.js';
import { heightAt } from '../../shared/map/terrain.js';

// Owns every vehicle: parked cars from the map (streamed around the player), networked
// vehicles driven by other players, and the local player's vehicle (driver or passenger).
const STREAM_IN = 240, STREAM_OUT = 290;

export class VehicleManager {
  constructor(game) {
    this.game = game;
    this.layout = game.layout;
    this.vehicles = new Map(); // id -> Vehicle (instantiated)
    this.states = new Map();   // id -> persistent state for parked/moved vehicles {type, x,y,z,yaw,dmg,color}
    for (const sp of this.layout.vehicleSpawns) this.states.set('p' + sp.id, { type: sp.type, x: sp.x, z: sp.z, yaw: sp.rot, dmg: 0, fixed: sp.fixed });
    this.current = null; this.seat = 0;
    this.streamT = 0;
    this.engines = new Map();
    this.lastOwned = null;
    const net = game.net;
    net.on('vehicle', (m) => this.onVehicleInfo(m.v));
    net.on('vehicleGone', (m) => { const v = this.vehicles.get(m.id); if (v && v !== this.current) this.removeVehicle(v); this.states.delete(m.id); });
  }

  // ------------------------------------------------------------------ lifecycle
  onJoined(r) {
    // reset parked vehicles to layout defaults, then apply the room's moved/driven vehicles
    for (const v of [...this.vehicles.values()]) if (v !== this.current) this.removeVehicle(v);
    for (const sp of this.layout.vehicleSpawns) this.states.set('p' + sp.id, { type: sp.type, x: sp.x, z: sp.z, yaw: sp.rot, dmg: 0, fixed: sp.fixed });
    for (const v of r.vehicles || []) this.onVehicleInfo(v);
  }
  onLeave() { if (this.current) this.exitLocal(true); }

  onVehicleInfo(info) {
    if (!info) return;
    const st = this.states.get(info.id) || { type: info.type };
    if (info.s) { st.x = info.s[0]; st.y = info.s[1]; st.z = info.s[2]; st.yaw = info.s[3]; }
    st.type = info.type || st.type; st.dmg = info.dmg | 0;
    st.driver = info.driver; st.passengers = info.passengers || [];
    this.states.set(info.id, st);
    const v = this.vehicles.get(info.id);
    if (v) {
      v.driver = info.driver; v.passengers = st.passengers;
      v.remote = !!info.driver && info.driver !== this.game.net.id;
      if (!info.driver && v !== this.current) { v.remote = false; v.speed = 0; }
    }
  }
  onSnapVehicles(list) {
    for (const e of list || []) {
      const [id, ...s] = e;
      let v = this.vehicles.get(id);
      const st = this.states.get(id);
      if (!v) {
        if (!st) continue;
        st.x = s[0]; st.y = s[1]; st.z = s[2]; st.yaw = s[3];
        v = this.instantiate(id);
        if (!v) continue;
      }
      if (v === this.current && v.isDriver) continue;
      v.remote = true;
      v.pushRemote(s);
      if (st) { st.x = s[0]; st.y = s[1]; st.z = s[2]; st.yaw = s[3]; }
    }
  }

  instantiate(id) {
    const st = this.states.get(id);
    if (!st) return null;
    const v = new Vehicle(this, { id, type: st.type, x: st.x, y: st.y, z: st.z, yaw: st.yaw });
    v.dmg = st.dmg || 0;
    v.driver = st.driver || null; v.passengers = st.passengers || [];
    this.vehicles.set(id, v);
    this.game.engine.scene.add(v.group);
    this.game.world.collision.add(v.collider);
    if (v.dmg >= 100) this.destroy(v, true);
    return v;
  }
  removeVehicle(v) {
    const st = this.states.get(v.id);
    if (st) { st.x = v.position.x; st.y = v.position.y; st.z = v.position.z; st.yaw = v.yaw; st.dmg = v.dmg; }
    this.game.engine.scene.remove(v.group);
    this.game.world.collision.remove(v.collider);
    this.stopEngine(v);
    this.vehicles.delete(v.id);
  }

  stream() {
    const p = this.game.player.pos;
    if (this.game.player.interior) return;
    for (const [id, st] of this.states) {
      const d = Math.hypot(st.x - p.x, st.z - p.z);
      const v = this.vehicles.get(id);
      if (!v && d < STREAM_IN) this.instantiate(id);
      else if (v && d > STREAM_OUT && v !== this.current && !v.remote) this.removeVehicle(v);
    }
  }

  // ------------------------------------------------------------------ enter / exit
  interactions(out, pos) {
    const g = this.game;
    if (g.player.interior || g.player.mode !== 'foot') return;
    if (this.current) return;
    const v = this.nearest(pos, 3.6);
    if (v) {
      const busy = v.driver && v.driver !== g.net.id;
      out.push({ label: v.destroyed ? `${v.spec.name} (wrecked)` : busy ? `Ride as passenger (${v.spec.name})` : `Drive ${v.spec.name}`, key: 'vehicle', priority: 4, action: () => !v.destroyed && this.enter(v, busy ? 1 : 0) });
    } else if (g.traffic) {
      const t = g.traffic.nearest(pos, 3.8);
      if (t) out.push({ label: `Carjack ${SPECS[t.type].name}`, key: 'vehicle', priority: 4, action: () => this.hijack(t) });
    }
  }
  nearest(pos, maxD) {
    let best = null, bd = maxD;
    for (const v of this.vehicles.values()) {
      const d = v.position.distanceTo(pos) - v.spec.length * 0.35;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  async enter(v, seat = 0) {
    const g = this.game;
    if (g.net.connected && g.net.room) {
      const r = await g.net.request('vehEnter', { id: v.id, seat });
      if (!r.ok) { g.ui.notify(r.error || 'Cannot enter', 'bad'); return; }
      seat = r.v.driver === g.net.id ? 0 : Math.max(1, r.v.passengers.indexOf(g.net.id) + 1);
    }
    this.seatLocal(v, seat);
    // stealing a car that isn't yours is a crime if someone sees it
    if (seat === 0 && v.id !== this.lastOwned && v.id.startsWith('p')) g.police?.reportCrime?.('theft', 1, v.position);
  }
  seatLocal(v, seat) {
    const g = this.game;
    this.current = v; this.seat = seat;
    v.isDriver = seat === 0;
    v.remote = !v.isDriver;
    if (v.isDriver) { v.driver = g.net.id || 'me'; this.lastOwned = v.id; }
    g.player.mode = 'vehicle';
    g.player.vel.set(0, 0, 0);
    g.avatar.anim.play('enterCar');
    g.avatar.anim.setLoop(v.spec.bike ? 'ride' : 'drive');
    g.avatar.char.root.visible = true;
    g.audio.door(v.position);
    g.cam.yaw = v.yaw + Math.PI;
    if (v.isDriver && !v.engine) this.startEngine(v);
    if (v.spec.siren && v.isDriver) g.ui.notify(`Press ${g.settings.binding('horn').replace('Key', '')} for the siren`, 'info');
    for (const s of g.systems) s.onEnterVehicle?.(v, seat);
  }
  async hijack(t) {
    const g = this.game;
    const st = g.traffic.takeOver(t);
    if (!st) return;
    g.police?.reportCrime?.('carjack', 2, new THREE.Vector3(st.x, 0, st.z));
    if (g.net.connected && g.net.room) {
      const r = await g.net.request('vehSpawn', { type: st.type, x: st.x, y: st.y, z: st.z, yaw: st.yaw });
      if (!r.ok) return g.ui.notify(r.error || 'Carjack failed', 'bad');
      this.states.set(r.v.id, { type: st.type, x: st.x, y: st.y, z: st.z, yaw: st.yaw, dmg: 0 });
      const v = this.instantiate(r.v.id);
      v.speed = st.speed * 0.3;
      this.seatLocal(v, 0);
    } else {
      const id = 'local' + Math.floor(Math.random() * 1e6);
      this.states.set(id, { type: st.type, x: st.x, y: st.y, z: st.z, yaw: st.yaw, dmg: 0 });
      const v = this.instantiate(id);
      this.seatLocal(v, 0);
    }
  }
  exitLocal(force = false) {
    const g = this.game;
    const v = this.current;
    if (!v) return;
    if (!force && Math.abs(v.speed) > 9 && !v.destroyed && !v.sinking) { g.ui.notify('Slow down before jumping out!', 'info'); return; }
    // find a free spot beside the vehicle
    const col = g.world.collision;
    let spot = null;
    for (const side of [this.seat % 2 === 0 ? 0 : 1, this.seat % 2 === 0 ? 1 : 0]) {
      const p = v.doorWorld(side);
      p.y = col.groundAt(p.x, p.z);
      const test = p.clone();
      col.resolve(test, 0.35, 1.8, 0.5);
      if (test.distanceTo(p) < 0.3) { spot = p; break; }
    }
    if (!spot) { spot = v.position.clone(); spot.y += v.spec.height + 0.2; }
    this.current = null;
    v.isDriver = false;
    if (v.driver === (g.net.id || 'me')) v.driver = null;
    v.remote = false;
    v.throttle = 0;
    g.avatar.anim.setLoop(null);
    g.player.mode = 'foot';
    g.player.teleport(spot.x, spot.y, spot.z, v.yaw);
    g.player.vel.set(0, 0, 0);
    g.audio.door(v.position);
    this.stopEngine(v);
    const st = this.states.get(v.id);
    if (st) { st.x = v.position.x; st.y = v.position.y; st.z = v.position.z; st.yaw = v.yaw; st.dmg = v.dmg; }
    if (g.net.connected && g.net.room) g.net.send('vehExit');
    for (const s of g.systems) s.onExitVehicle?.(v);
  }

  // ------------------------------------------------------------------ remote players in seats
  seatRemote(r, vid, seat) {
    const v = this.vehicles.get(vid) || (this.states.has(vid) ? this.instantiate(vid) : null);
    if (!v) return;
    r.vehicle = v; r.seat = seat;
    v.group.updateMatrixWorld(true);
    const p = v.seatWorld(seat);
    r.avatar.position.copy(p).y -= 0.45 + (v.spec.bike ? 0.1 : 0);
    r.avatar.yaw = v.yaw;
    r.avatar.char.pivot.rotation.x = v.pitch;
    r.avatar.anim.steer = v.steer;
    if (r.avatar.anim.loop !== (v.spec.bike ? 'ride' : 'drive')) r.avatar.anim.setLoop(v.spec.bike ? 'ride' : 'drive');
    if (seat === 0 && !v.engine) this.startEngine(v);
  }
  unseatRemote(r) {
    const v = r.vehicle;
    r.vehicle = null;
    r.avatar.anim.setLoop(null);
    if (v && !v.driver) this.stopEngine(v);
  }

  // ------------------------------------------------------------------ per frame
  controlsPlayer() { return !!this.current; }

  update(dt, playing) {
    const g = this.game;
    if (!g.player) return;
    this.streamT -= dt;
    if (this.streamT < 0) { this.streamT = 0.5; this.stream(); }
    const input = g.input;
    const v = this.current;
    if (v) {
      if (playing && input.hit('vehicle')) { this.exitLocal(); }
    }
    if (this.current) {
      const cv = this.current;
      if (cv.isDriver) {
        const ctl = playing && !g.ui.modalOpen ? {
          throttle: (input.down('forward') ? 1 : 0) - (input.down('back') ? 1 : 0),
          steer: (input.down('left') ? 1 : 0) - (input.down('right') ? 1 : 0),
          handbrake: input.down('jump'), boost: input.down('sprint'),
        } : { throttle: 0, steer: 0, handbrake: true };
        if (playing && input.hit('horn')) {
          if (cv.spec.siren) { cv.siren = !cv.siren; this.toggleSiren(cv); } else g.audio.horn(cv.position);
          if (!cv.spec.siren) g.net.send('fx', { kind: 'horn' });
        }
        if (playing && input.hit('reload')) cv.lightsOn = !cv.lightsOn;
        cv.simulate(dt, ctl, g.world.collision);
        if ((cv.sinking && cv.dmg > 60) || (cv.dmg >= 100 && !cv.destroyed)) {
          if (cv.dmg >= 100 && !cv.sinking) this.destroy(cv);
          this.exitLocal(true);
          if (cv.sinking) g.ui.notify('Your car sank! Swim for it.', 'bad');
        }
        this.hitPedestrians(cv);
      }
      if (this.current) {
        // avatar sits in the seat
        const cur = this.current;
        cur.group.updateMatrixWorld(true);
        const seatP = cur.seatWorld(this.seat);
        g.player.pos.copy(seatP).y -= 0.45 + (cur.spec.bike ? 0.1 : 0);
        g.avatar.yaw = cur.yaw;
        g.avatar.char.pivot.rotation.x = cur.pitch;
        g.avatar.anim.steer = cur.steer;
        g.avatar.update(dt, { speed: 0 });
        g.avatar.char.root.visible = g.cam.mode !== 'first' || !cur.spec.interior;
        g.cam.updateVehicle(dt, cur);
      }
    }
    // other vehicles: interpolate remote ones, settle parked ones
    const night = g.world.env.nightFactor;
    for (const veh of this.vehicles.values()) {
      if (veh.remote && veh !== this.current) veh.interpolate();
      else if (veh.remote && veh === this.current && !veh.isDriver) veh.interpolate();
      else if (!veh.isDriver && !veh.remote && Math.abs(veh.speed) > 0.05) veh.simulate(dt, { throttle: 0, steer: 0, handbrake: true }, g.world.collision);
      veh.updateVisual(dt, night);
      this.updateEngine(veh);
      if (veh.dmg > 60 && Math.random() < dt * 8) g.fx?.smoke(veh.position.clone().add(new THREE.Vector3(0, veh.spec.height * 0.7, 0).addScaledVector(veh.forward(), veh.spec.length * 0.35)), veh.dmg > 85);
      if (veh.destroyed && Math.random() < dt * 10) g.fx?.fire(veh.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, veh.spec.height * 0.6, (Math.random() - 0.5) * 2)));
    }
    if (this.current?.isDriver) g.player.speed = Math.abs(this.current.speed);
    this.updateHeadlights();
  }

  hitPedestrians(v) {
    const sp = Math.abs(v.speed);
    if (sp < 4) return;
    const g = this.game;
    const f = v.forward();
    const front = v.position.clone().addScaledVector(f, Math.sign(v.speed) * v.spec.length * 0.45);
    // remote players
    for (const r of g.mp.remotes.values()) {
      if (r.vehicle || !r.avatar.group.visible) continue;
      if (r.avatar.position.distanceTo(front) < v.spec.width * 0.7 + 0.4 && !(r._ramT > performance.now())) {
        r._ramT = performance.now() + 1500;
        g.net.send('ram', { target: r.id, speed: sp });
        g.audio.punch(r.avatar.position);
      }
    }
    g.npcs?.vehicleSweep?.(v, front, sp);
  }

  onCrash(v, impact, c) {
    const g = this.game;
    v.dmg = Math.min(100, v.dmg + (impact - 4) * (v.spec.bike ? 3 : 1.6));
    g.audio.crash(v.position, Math.min(1, impact / 18));
    g.fx?.sparks(v.position.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(v.forward(), v.spec.length * 0.45), 10);
    if (v === this.current) {
      g.cam.addShake(Math.min(1, impact / 20));
      if (v.spec.bike && impact > 12) { this.exitLocal(true); g.damageSelf?.(Math.round(impact * 2), 'crash'); g.ui.notify('You flew off the bike!', 'bad'); }
    }
    if (c?.owner && c.owner.constructor?.name === 'Vehicle' && v.isDriver) g.net.send('vehHit', { id: c.owner.id, d: impact });
    if (c?.traffic) g.traffic?.onRammed(c.traffic, impact);
    if (v.dmg >= 100 && !v.destroyed) this.destroy(v);
  }
  onLand(v, speed) { this.game.audio.crash(v.position, Math.min(0.6, speed / 25)); if (v === this.current) this.game.cam.addShake(Math.min(0.6, speed / 25)); }

  destroy(v, silent = false) {
    if (v.destroyed) return;
    v.destroyed = true; v.dmg = 100;
    const g = this.game;
    v.group.traverse((o) => { if (o.isMesh && o.material && !o.material.userData?.burnt) { o.material = o.material.clone(); o.material.userData = { burnt: true }; if (o.material.color) o.material.color.multiplyScalar(0.18); if (o.material.vertexColors) o.material.color?.setRGB?.(0.15, 0.15, 0.15); } });
    if (silent) return;
    g.fx?.explosion(v.position.clone().add(new THREE.Vector3(0, 1, 0)));
    g.audio.crash(v.position, 1); g.audio.gunshot(v.position, 'bolt');
    g.cam.addShake(Math.max(0, 1 - g.player.pos.distanceTo(v.position) / 40));
    const d = g.player.pos.distanceTo(v.position);
    if (d < 7) g.damageSelf?.(Math.round((7 - d) * 12), 'explosion');
    g.npcs?.explosion?.(v.position, 8);
    g.police?.reportCrime?.('explosion', 2, v.position);
  }

  toggleSiren(v) {
    const g = this.game;
    if (v.siren && !v.sirenSound) v.sirenSound = g.audio.siren(v.spec.siren);
    if (!v.siren && v.sirenSound) { v.sirenSound.stop(); v.sirenSound = null; }
  }
  startEngine(v) { if (!v.engine && this.game.audio.ctx) v.engine = this.game.audio.engineLoop(v.spec.bike ? 'motorcycle' : v.type === 'truck' ? 'truck' : v.type === 'sports' ? 'sports' : 'car'); }
  stopEngine(v) { if (v.engine) { v.engine.stop(); v.engine = null; } if (v.sirenSound) { v.sirenSound.stop(); v.sirenSound = null; v.siren = false; } }
  updateEngine(v) {
    if (v.remote && v.driver && !v.engine && v.position.distanceTo(this.game.player.pos) < 80) this.startEngine(v);
    if (v.remote && v.siren && !v.sirenSound) v.sirenSound = this.game.audio.siren(v.spec.siren);
    if (v.remote && !v.siren && v.sirenSound) { v.sirenSound.stop(); v.sirenSound = null; }
    if (!v.engine) return;
    const rpm = Math.min(1, Math.abs(v.speed) / v.spec.maxSpeed);
    v.engine.update(v.position, rpm, Math.abs(v.throttle), v.skid);
    v.sirenSound?.update(v.position);
  }

  onUse(u) {
    if (u.kind !== 'repair') return false;
    const g = this.game;
    const v = this.lastOwned ? this.vehicles.get(this.lastOwned) : null;
    const st = this.lastOwned ? this.states.get(this.lastOwned) : null;
    if (!st) { g.ui.notify('Drive a car here first — we repair the last car you drove.', 'info'); return true; }
    g.net.request('reward', { kind: 'repair' }).then((r) => {
      if (!r.ok && g.net.connected) return g.ui.notify(r.error || 'Repair failed', 'bad');
      if (r.profile) g.setProfile(r.profile);
      st.dmg = 0;
      if (v) { v.dmg = 0; if (v.destroyed) { v.destroyed = false; this.removeVehicle(v); this.instantiate(this.lastOwned); } }
      g.audio.cash(); g.ui.notify('Your car is repaired and good as new. (-$150)', 'good');
    });
    return true;
  }
  updateHeadlights() {
    const g = this.game;
    const v = this.current;
    const night = g.world.env.nightFactor;
    if (!this.headlights) {
      this.headlights = [0, 1].map(() => { const l = new THREE.SpotLight('#fff4d6', 0, 70, 0.45, 0.5, 1.2); l.castShadow = false; g.engine.scene.add(l, l.target); return l; });
    }
    for (const [i, l] of this.headlights.entries()) {
      if (!v || v.spec.bike && i === 1) { l.intensity = 0; continue; }
      const on = night > 0.4 || v.lightsOn;
      l.intensity = on ? 180 : 0;
      const side = v.spec.bike ? 0 : i ? -0.6 : 0.6;
      const f = v.forward(), lf = v.left();
      l.position.copy(v.position).addScaledVector(f, v.spec.length / 2).addScaledVector(lf, side).add(new THREE.Vector3(0, 0.8, 0));
      l.target.position.copy(l.position).addScaledVector(f, 20).add(new THREE.Vector3(0, -2, 0));
    }
  }

  blips(out) {
    for (const v of this.vehicles.values()) if (v.driver && v !== this.current) out.push({ x: v.position.x, z: v.position.z, color: v.spec.police ? '#4fa3ff' : '#ffffff', size: 3 });
  }
}
export { heightAt };
