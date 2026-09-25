import * as THREE from 'three';
import { buildVehicle, SPECS } from './VehicleModels.js';
import { circleVsObb } from '../../shared/map/geom.js';
import { heightAt } from '../../shared/map/terrain.js';
import { WATER_LEVEL } from '../../shared/map/layout.js';

// One vehicle: arcade "bicycle model" physics (steering, grip, drifting, suspension
// approximation from terrain), collisions, damage, lights/sirens and network state.
const _v = new THREE.Vector3();
export class Vehicle {
  constructor(mgr, { id, type, color, x, y, z, yaw = 0 }) {
    this.mgr = mgr;
    this.id = id; this.netId = id;
    this.type = type;
    this.spec = SPECS[type] || SPECS.sedan;
    const s = this.spec;
    this.color = color || s.colors[Math.abs(hashId(id)) % s.colors.length];
    const m = buildVehicle(type, this.color);
    this.group = m.group; this.wheels = m.wheels; this.lights = m.lights;
    this.group.userData.vehicle = this;
    this.yaw = yaw;
    this.group.position.set(x, y ?? heightAt(x, z), z);
    this.speed = 0; this.vLat = 0; this.yawRate = 0; this.steer = 0; this.vy = 0;
    this.pitch = 0; this.roll = 0; this.dmg = 0; this.throttle = 0; this.braking = false;
    this.lightsOn = false; this.siren = false; this.sirenT = 0;
    this.driver = null; this.passengers = [];
    this.isDriver = false;
    this.remote = false; this.buf = [];
    this.destroyed = false; this.sinking = false;
    this.wheelSpin = 0;
    this.skid = 0;
    this.collider = { kind: 'vehicle', dynamic: true, x, z, hx: s.width / 2, hz: s.length / 2, rot: yaw, y0: -1, y1: 0, owner: this, noCamera: true };
    this.updateCollider();
  }
  get position() { return this.group.position; }
  forward(o = new THREE.Vector3()) { return o.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  left(o = new THREE.Vector3()) { return o.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)); }
  updateCollider() {
    const c = this.collider, p = this.group.position;
    c.x = p.x; c.z = p.z; c.rot = this.yaw; c.y0 = p.y - 0.5; c.y1 = p.y + this.spec.height;
  }
  seatLocal(i) {
    const s = this.spec;
    if (s.bike) return new THREE.Vector3(0, s.wheelR + 0.55, i === 0 ? -0.15 : -0.6);
    const side = i % 2 === 0 ? 1 : -1;
    const row = i < 2 ? 0 : -1;
    const y = s.box ? 1.0 : s.truck ? 1.35 : s.low ? 0.32 : s.tall ? 0.72 : 0.5;
    return new THREE.Vector3(side * s.width * 0.22, y, row * 0.95 + (s.box ? s.length / 2 - 1.6 : s.truck ? s.length / 2 - 1.1 : 0));
  }
  seatWorld(i) { return this.seatLocal(i).applyMatrix4(this.group.matrixWorld); }
  doorWorld(i, out = new THREE.Vector3()) {
    const s = this.spec;
    const side = i % 2 === 0 ? 1 : -1;
    const l = new THREE.Vector3(side * (s.width / 2 + 0.75), 0, this.seatLocal(i).z);
    return out.copy(l).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.group.position);
  }

  /** Local driver physics step. input: {throttle, steer, handbrake, boost} */
  simulate(dt, input, collision) {
    const s = this.spec;
    if (s.boat) return this.simulateBoat(dt, input);
    if (this.destroyed) { input = { throttle: 0, steer: 0, handbrake: true }; }
    const p = this.group.position;
    const dmgMul = this.dmg > 80 ? 0.5 : this.dmg > 50 ? 0.8 : 1;
    const maxSpeed = s.maxSpeed * dmgMul * (input.boost ? 1.12 : 1);
    this.throttle = input.throttle;
    this.braking = false;
    const grounded = this.vy === 0;
    if (grounded) {
      if (input.throttle > 0) {
        if (this.speed < -0.5) { this.speed += s.brake * dt; this.braking = true; }
        else this.speed += s.accel * input.throttle * (input.boost ? 1.35 : 1) * Math.max(0, 1 - (this.speed / maxSpeed) ** 2) * dt;
      } else if (input.throttle < 0) {
        if (this.speed > 0.5) { this.speed -= s.brake * dt; this.braking = true; }
        else this.speed = Math.max(-maxSpeed * 0.3, this.speed - s.accel * 0.6 * dt);
      }
      // rolling resistance + aero drag
      const drag = (0.6 + 0.0025 * this.speed * this.speed) * (input.throttle ? 0.35 : 1);
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
      if (input.handbrake) { this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 7 * dt); this.braking = true; }
    }
    // steering (less lock at speed)
    const lock = s.steer * (1 - 0.6 * Math.min(1, Math.abs(this.speed) / s.maxSpeed));
    this.steer += (input.steer * lock - this.steer) * Math.min(1, dt * 7);
    const grip = (input.handbrake ? 1.4 : s.grip) * (grounded ? 1 : 0.05);
    const targetYawRate = (this.speed / s.wheelBase) * Math.tan(this.steer) * (input.handbrake ? 1.35 : 1);
    this.yawRate += (targetYawRate - this.yawRate) * Math.min(1, dt * grip * 1.5);
    this.yaw += this.yawRate * dt;
    // lateral slip: momentum carries sideways when yaw changes faster than grip allows
    this.vLat += -this.speed * this.yawRate * dt * (input.handbrake ? 0.5 : 0.12);
    this.vLat *= Math.exp(-grip * dt);
    this.skid = Math.abs(this.vLat) > 2 || (input.handbrake && Math.abs(this.speed) > 6) ? Math.min(1, Math.abs(this.vLat) / 6 + (input.handbrake ? 0.5 : 0)) : 0;
    const f = this.forward(), l = this.left(_v);
    const vx = f.x * this.speed + l.x * this.vLat, vz = f.z * this.speed + l.z * this.vLat;
    p.x += vx * dt; p.z += vz * dt;
    // --- collisions (circles along the body)
    const n = s.bike ? 2 : Math.max(2, Math.ceil(s.length / s.width));
    const r = s.width / 2;
    let hitN = null, hitDepth = 0;
    for (let i = 0; i < n; i++) {
      const off = (i / (n - 1) - 0.5) * (s.length - s.width);
      const cx = p.x + f.x * off, cz = p.z + f.z * off;
      for (const c of collision.query(cx, cz, r + 1, this._q || (this._q = []))) {
        if (c === this.collider || c.owner === this || c.kind === 'interior') continue;
        if (c.y1 <= p.y + 0.55 || c.y0 >= p.y + s.height) continue;
        const push = circleVsObb(cx, cz, r, c);
        if (push) {
          p.x += push.x; p.z += push.z;
          const d = Math.hypot(push.x, push.z);
          if (d > hitDepth) { hitDepth = d; hitN = [push.x / d, push.z / d, c]; }
        }
      }
    }
    if (hitN) {
      const [nx, nz, c] = hitN;
      const vn = vx * nx + vz * nz;
      if (vn < 0) {
        const rvx = vx - (1.35 * vn) * nx, rvz = vz - (1.35 * vn) * nz;
        this.speed = rvx * f.x + rvz * f.z;
        this.vLat = rvx * l.x + rvz * l.z;
        const impact = -vn;
        if (impact > 4) this.mgr.onCrash(this, impact, c);
        if (c.owner instanceof Vehicle && impact > 3) c.owner.bump?.(nx * -impact * 0.5, nz * -impact * 0.5);
      }
    }
    // --- ground / suspension approximation
    const ground = this.groundHeight(collision, p.x, p.z);
    const hf = this.groundHeight(collision, p.x + f.x * s.wheelBase / 2, p.z + f.z * s.wheelBase / 2);
    const hb = this.groundHeight(collision, p.x - f.x * s.wheelBase / 2, p.z - f.z * s.wheelBase / 2);
    const hl = this.groundHeight(collision, p.x + l.x * s.width / 2, p.z + l.z * s.width / 2);
    const hr = this.groundHeight(collision, p.x - l.x * s.width / 2, p.z - l.z * s.width / 2);
    const gAvg = Math.max(ground, (hf + hb) / 2);
    if (p.y > gAvg + 0.08) {
      this.vy -= 20 * dt;
      p.y += this.vy * dt;
      if (p.y <= gAvg) { if (this.vy < -7) this.mgr.onLand(this, -this.vy); p.y = gAvg; this.vy = 0; }
    } else {
      // launch off crests when the ground falls away faster than gravity allows
      const prev = p.y;
      p.y = gAvg;
      const fallRate = (prev - gAvg) / dt;
      this.vy = 0;
      if (fallRate > 9 && Math.abs(this.speed) > 20) { p.y = prev; this.vy = -1; }
    }
    const tPitch = Math.atan2(hb - hf, s.wheelBase);
    const tRoll = s.bike ? -this.steer * Math.min(1, Math.abs(this.speed) / 15) * 0.7 : Math.atan2(hr - hl, s.width) + this.vLat * 0.01;
    this.pitch += (tPitch + (this.braking ? 0.02 : -Math.max(0, this.throttle) * 0.015) - this.pitch) * Math.min(1, dt * 8);
    this.roll += (tRoll - this.roll) * Math.min(1, dt * 6);
    // --- water
    const sea = heightAt(p.x, p.z);
    if (sea < WATER_LEVEL - 0.8 && p.y < WATER_LEVEL + 0.2) {
      this.sinking = true;
      this.speed *= Math.exp(-dt * 1.5);
      p.y = Math.max(sea, p.y - dt * 0.6);
      this.dmg = Math.min(100, this.dmg + dt * 12);
    } else this.sinking = false;
    this.updateCollider();
  }
  bump(dx, dz) { if (!this.isDriver && !this.remote) { this.group.position.x += dx * 0.05; this.group.position.z += dz * 0.05; this.updateCollider(); } }

  /** Simplified physics for boats: no wheels/suspension, floats on the sea (or the local
   * terrain height near shore), gentle bob, ignores the swim-back-out limit that stops
   * players — boats may go further, per Stage 1's note. */
  simulateBoat(dt, input) {
    const s = this.spec;
    const p = this.group.position;
    if (this.destroyed) input = { throttle: 0, steer: 0 };
    if (input.throttle > 0) this.speed += s.accel * input.throttle * Math.max(0, 1 - (this.speed / s.maxSpeed) ** 2) * dt;
    else if (input.throttle < 0) this.speed -= s.accel * 0.6 * dt;
    else this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 1.2 * dt);
    this.speed = Math.max(-s.maxSpeed * 0.3, Math.min(s.maxSpeed, this.speed));
    this.braking = input.throttle < 0;
    const lock = s.steer * (1 - 0.5 * Math.min(1, Math.abs(this.speed) / s.maxSpeed));
    this.steer += (input.steer * lock - this.steer) * Math.min(1, dt * 5);
    this.yawRate = (this.speed / s.wheelBase) * this.steer;
    this.yaw += this.yawRate * dt;
    const f = this.forward();
    p.x += f.x * this.speed * dt; p.z += f.z * this.speed * dt;
    const sea = heightAt(p.x, p.z);
    this.bobT = (this.bobT || 0) + dt;
    p.y = Math.max(sea, WATER_LEVEL) + 0.05 + Math.sin(this.bobT * 1.3) * 0.05;
    this.pitch += (Math.sin(this.bobT * 1.1 + 1) * 0.03 - this.pitch) * Math.min(1, dt * 4);
    this.roll += (Math.sin(this.bobT * 0.9) * 0.04 - this.roll) * Math.min(1, dt * 4);
    this.vLat = 0; this.vy = 0; this.sinking = false;
    this.updateCollider();
  }

  groundHeight(collision, x, z) {
    let h = collision.groundAt(x, z);
    // drivable platforms (pier deck, parking decks, low props) — anything with a low top
    for (const c of collision.query(x, z, 0.5, this._g || (this._g = []))) {
      if (c.owner === this || c.dynamic || c.kind === 'interior') continue;
      if (c.walk && c.y1 > h && c.y1 < this.group.position.y + 0.6 && circleVsObb(x, z, 0.05, c)) h = c.y1;
    }
    return h;
  }

  // ------------------------------------------------------------------ network
  netState() {
    const p = this.group.position;
    const flags = (this.lightsOn ? 1 : 0) | (this.siren ? 2 : 0) | (this.braking ? 4 : 0) | (this.destroyed ? 8 : 0);
    return [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), +this.yaw.toFixed(3), +this.pitch.toFixed(3), +this.roll.toFixed(3), +this.speed.toFixed(2), +this.steer.toFixed(2), flags];
  }
  pushRemote(s) {
    this.buf.push({ t: performance.now(), s });
    if (this.buf.length > 12) this.buf.shift();
  }
  interpolate() {
    const b = this.buf;
    if (!b.length) return;
    const rt = performance.now() - 120;
    let a = b[0], c = b[b.length - 1];
    for (let i = 0; i < b.length - 1; i++) if (b[i].t <= rt && b[i + 1].t >= rt) { a = b[i]; c = b[i + 1]; break; }
    const span = c.t - a.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (rt - a.t) / span)) : 1;
    const A = a.s, C = c.s;
    const L = (i) => A[i] + (C[i] - A[i]) * k;
    this.group.position.set(L(0), L(1), L(2));
    let dy = C[3] - A[3]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw = A[3] + dy * k;
    this.pitch = L(4); this.roll = L(5); this.speed = L(6); this.steer = L(7);
    const fl = C[8] | 0;
    this.lightsOn = !!(fl & 1); this.siren = !!(fl & 2); this.braking = !!(fl & 4);
    if (fl & 8 && !this.destroyed) this.mgr.destroy(this, true);
    this.updateCollider();
  }

  // ------------------------------------------------------------------ visuals
  updateVisual(dt, night) {
    const g = this.group;
    g.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    if (this.spec.wheelR) this.wheelSpin += (this.speed * dt) / this.spec.wheelR;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = this.steer;
    }
    const lit = this.lightsOn || night > 0.5;
    if (this.lights.head) this.lights.head.material.emissiveIntensity = lit ? 2.5 : 0.3;
    if (this.lights.tail) this.lights.tail.material.emissiveIntensity = this.braking ? 3 : lit ? 1.2 : 0.4;
    if (this.siren) {
      this.sirenT += dt;
      const ph = Math.floor(this.sirenT * 6) % 2;
      if (this.lights.red) this.lights.red.material.emissiveIntensity = ph ? 4 : 0.2;
      if (this.lights.blue) this.lights.blue.material.emissiveIntensity = ph ? 0.2 : 4;
    } else {
      if (this.lights.red) this.lights.red.material.emissiveIntensity = 0.2;
      if (this.lights.blue) this.lights.blue.material.emissiveIntensity = 0.2;
    }
  }
}
function hashId(s) { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
