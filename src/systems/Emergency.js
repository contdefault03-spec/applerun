import * as THREE from 'three';
import { Vehicle } from '../vehicles/Vehicle.js';
import { NPC } from '../npc/NPC.js';
import { AIDriver } from './AIDriver.js';

// Emergency services: when someone goes down in public an AI ambulance drives to the
// scene with its siren on, a paramedic treats the victim and they leave again.
export class Emergency {
  constructor(game) {
    this.game = game;
    this.calls = [];
    this.unit = null;
  }
  report(pos, victim = null) {
    if (this.game.inActivity || this.game.player?.interior) return;
    if (this.calls.length > 3) return;
    this.calls.push({ pos: pos.clone(), victim, t: 10 + Math.random() * 6 });
  }
  onNpcDeath(npc) { if (!npc.interior) this.report(npc.position, npc); }

  dispatch(call) {
    const g = this.game;
    const roads = g.layout.roads.filter((r) => r.type !== 'mountain');
    for (let i = 0; i < 25; i++) {
      const r = roads[Math.floor(Math.random() * roads.length)];
      const pt = r.pts[Math.floor(Math.random() * r.pts.length)];
      const d = Math.hypot(pt[0] - call.pos.x, pt[1] - call.pos.z);
      if (d < 90 || d > 180) continue;
      const v = new Vehicle(g.vehicles, { id: 'ems' + Math.floor(Math.random() * 1e5), type: 'ambulance', x: pt[0], z: pt[1], yaw: Math.atan2(call.pos.x - pt[0], call.pos.z - pt[1]) });
      v.siren = true;
      g.engine.scene.add(v.group);
      g.world.collision.add(v.collider);
      v.sirenSound = g.audio.siren('ambulance');
      v.engine = g.audio.engineLoop('truck');
      this.unit = { v, ai: new AIDriver(g, v), call, state: 'drive', t: 0, medic: null };
      return;
    }
  }
  update(dt) {
    const g = this.game;
    if (!g.player) return;
    for (let i = this.calls.length - 1; i >= 0; i--) {
      const c = this.calls[i];
      c.t -= dt;
      if (c.t <= 0 && !this.unit) { this.calls.splice(i, 1); if (c.pos.distanceTo(g.player.pos) < 250) this.dispatch(c); }
    }
    const u = this.unit;
    if (!u) return;
    const v = u.v;
    u.t += dt;
    if (u.state === 'drive') {
      const d = u.ai.drive(dt, u.call.pos, { stopDist: 9, maxSpeed: 0.85 });
      if ((d < 11 && Math.abs(v.speed) < 1.5) || u.t > 60) {
        u.state = 'treat';
        const m = new NPC(g.npcs, { role: 'medic', variant: 0, x: v.doorWorld(0).x, y: v.position.y, z: v.doorWorld(0).z });
        g.npcs.add(m); (g.npcs.extra ||= []).push(m);
        m.state = 'goto'; m.target = u.call.pos.clone(); m.after = 'idle';
        m.onArrive = () => { m.avatar.anim.play('interact'); m.say('Stay with me!'); setTimeout(() => { if (u.call.victim && !u.call.victim.alive) { u.call.victim.deadT = 999; } u.state = 'leave'; u.t = 0; }, 3500); };
        u.medic = m;
      }
    } else if (u.state === 'treat') {
      v.simulate(dt, { throttle: 0, steer: 0, handbrake: true }, g.world.collision);
      if (u.t > 25) { u.state = 'leave'; u.t = 0; }
    } else if (u.state === 'leave') {
      if (u.medic) { g.npcs.extra = g.npcs.extra.filter((x) => x !== u.medic); g.npcs.remove(u.medic); u.medic = null; v.siren = false; v.sirenSound?.stop(); v.sirenSound = null; }
      u.ai.drive(dt, v.position.clone().add(v.forward().multiplyScalar(60)), { stopDist: 0, maxSpeed: 0.6 });
      if (v.position.distanceTo(g.player.pos) > 230 || u.t > 40) {
        g.engine.scene.remove(v.group); g.world.collision.remove(v.collider); v.engine?.stop(); v.sirenSound?.stop();
        this.unit = null;
        return;
      }
    }
    v.updateVisual(dt, g.world.env.nightFactor);
    v.engine?.update(v.position, Math.min(1, Math.abs(v.speed) / v.spec.maxSpeed), 0.5, 0);
    v.sirenSound?.update(v.position);
  }
  blips(out) { if (this.unit) out.push({ x: this.unit.v.position.x, z: this.unit.v.position.z, color: '#ffffff', size: 5 }); }
}
export { THREE };
