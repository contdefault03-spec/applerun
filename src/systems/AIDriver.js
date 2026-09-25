import * as THREE from 'three';

// Steering controller for AI-driven physics vehicles (police pursuit, ambulances).
// Uses target prediction + three feeler rays to avoid buildings, and reverses when stuck.
export class AIDriver {
  constructor(game, vehicle) {
    this.game = game;
    this.v = vehicle;
    this.stuck = 0;
    this.reverseT = 0;
    this.lastPos = vehicle.position.clone();
    this.checkT = 0;
  }
  drive(dt, targetPos, { stopDist = 8, maxSpeed = 1, targetVel = null } = {}) {
    const v = this.v;
    const p = v.position;
    const aim = targetPos.clone();
    if (targetVel) aim.addScaledVector(targetVel, Math.min(2, p.distanceTo(targetPos) / 25));
    const to = aim.sub(p); to.y = 0;
    const dist = to.length();
    const fwd = v.forward();
    let ang = Math.atan2(to.x, to.z) - v.yaw; ang = Math.atan2(Math.sin(ang), Math.cos(ang));
    // obstacle feelers
    const col = this.game.world.collision;
    const probe = (a) => {
      const d = new THREE.Vector3(Math.sin(v.yaw + a), 0, Math.cos(v.yaw + a));
      const hit = col.raycast([p.x, p.y + 0.8, p.z], [d.x, 0, d.z], 14, { terrain: false, ignore: v.collider, filter: (c) => c.kind !== 'npc' && c.kind !== 'tree' && !c.dynamic });
      return hit ? hit.t : 14;
    };
    let steer = THREE.MathUtils.clamp(ang * 1.8, -1, 1);
    const c = probe(0);
    if (c < 10) { const l = probe(0.6), r = probe(-0.6); steer = l > r ? 1 : -1; }
    let throttle = dist > stopDist ? maxSpeed : 0;
    if (Math.abs(ang) > 1.2 && v.speed > 8) throttle = -0.4;
    if (dist < stopDist && v.speed > 1) throttle = -1;
    // stuck detection
    this.checkT += dt;
    if (this.checkT > 1) {
      this.checkT = 0;
      if (p.distanceTo(this.lastPos) < 1 && throttle > 0) this.stuck++; else this.stuck = 0;
      this.lastPos.copy(p);
      if (this.stuck >= 2) { this.reverseT = 1.6; this.stuck = 0; }
    }
    if (this.reverseT > 0) { this.reverseT -= dt; throttle = -1; steer = -steer || 1; }
    v.simulate(dt, { throttle, steer, handbrake: false, boost: false }, col);
    void fwd;
    return dist;
  }
}
