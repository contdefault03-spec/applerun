import * as THREE from 'three';
import { WATER_LEVEL, WORLD } from '../../shared/map/layout.js';
import { heightAt } from '../../shared/map/terrain.js';

// Local player movement & state on foot (vehicles/activities take over when active).
export class PlayerController {
  constructor(game, avatar) {
    this.game = game;
    this.avatar = avatar;
    this.vel = new THREE.Vector3();
    this.onGround = true;
    this.crouch = false;
    this.sprint = false;
    this.stamina = 100;
    this.health = 100;
    this.armor = 0;
    this.swimming = false;
    this.mode = 'foot'; // foot | vehicle | dead | arrested | seated | ragdoll | frozen
    this.speed = 0;
    this.stepPhase = 0;
    this.airTime = 0;
    this.lastGroundY = 0;
    this.radius = 0.34;
    this.interior = null;
    this.moveInput = new THREE.Vector2();
    this.aiming = false;
  }
  get pos() { return this.avatar.position; }
  get stats() { return this.avatar.char.def.stats || { speed: 1, strength: 1, stamina: 1 }; }

  teleport(x, y, z, yaw = null) {
    this.pos.set(x, y ?? this.game.world.collision.groundAt(x, z), z);
    this.vel.set(0, 0, 0);
    if (yaw !== null) this.avatar.yaw = yaw;
  }

  update(dt, cam, { aiming = false, allowMove = true } = {}) {
    const input = this.game.input;
    const col = this.game.world.collision;
    this.aiming = aiming;
    if (this.mode !== 'foot') return;
    const ax = allowMove ? input.axis() : { x: 0, y: 0 };
    this.moveInput.set(ax.x, ax.y);
    if (input.hit('crouch')) this.crouch = !this.crouch;
    const moving = ax.x !== 0 || ax.y !== 0;
    this.sprint = allowMove && input.down('sprint') && moving && this.stamina > 2 && !aiming && !this.crouch;
    const st = this.stats;
    let target = this.crouch ? 1.7 : aiming ? 2.4 : this.sprint ? 7.2 : 4.3;
    target *= st.speed;
    if (this.swimming) target = this.sprint ? 3 : 1.8;
    if (this.game.activeSlowdown) target *= this.game.activeSlowdown;
    // stamina
    if (this.sprint) this.stamina = Math.max(0, this.stamina - dt * 12 / st.stamina);
    else this.stamina = Math.min(100, this.stamina + dt * 9 * st.stamina);
    // desired horizontal velocity relative to camera yaw
    const fwd = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    const wish = new THREE.Vector3().addScaledVector(fwd, ax.y).addScaledVector(right, ax.x);
    if (wish.lengthSq() > 0) wish.normalize();
    const accel = this.onGround ? 14 : 3;
    this.vel.x += (wish.x * target - this.vel.x) * Math.min(1, dt * accel);
    this.vel.z += (wish.z * target - this.vel.z) * Math.min(1, dt * accel);
    // facing
    if (aiming || cam.mode === 'first') this.avatar.yaw = cam.yaw + Math.PI;
    else if (wish.lengthSq() > 0.01) {
      const want = Math.atan2(wish.x, wish.z);
      let d = want - this.avatar.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.avatar.yaw += d * Math.min(1, dt * 12);
    }
    // jump
    if (allowMove && input.hit('jump') && this.onGround && !this.swimming) {
      this.vel.y = 6.2; this.onGround = false; this.crouch = false;
      this.game.audio.jump(this.pos);
    }
    // gravity & integrate
    if (!this.swimming) this.vel.y -= 20 * dt;
    const p = this.pos;
    p.x += this.vel.x * dt; p.z += this.vel.z * dt; p.y += this.vel.y * dt;
    // world bounds
    if (!this.interior) {
      p.x = THREE.MathUtils.clamp(p.x, WORLD.minX + 2, WORLD.maxX - 2);
      p.z = THREE.MathUtils.clamp(p.z, WORLD.minZ + 2, WORLD.maxZ - 2);
    }
    // collisions
    const res = col.resolve(p, this.radius, this.avatar.char.height * (this.crouch ? 0.65 : 1), 0.5, this.ignoreCollider);
    let ground = res.ground;
    if (this.interior) ground = Math.max(ground, this.interior.floorAt(p.x, p.z));
    // water
    const seaFloor = heightAt(p.x, p.z);
    this.swimming = !this.interior && seaFloor < WATER_LEVEL - 1.25 && p.y < WATER_LEVEL - 0.6 && ground < WATER_LEVEL - 1;
    if (this.swimming) {
      p.y += (WATER_LEVEL - 1.15 - p.y) * Math.min(1, dt * 5);
      this.vel.y = 0;
      this.onGround = false;
      this.stamina = Math.max(0, this.stamina - dt * (this.sprint ? 6 : 1));
    } else if (p.y <= ground + 0.02 && this.vel.y <= 0.1) {
      if (!this.onGround && this.airTime > 0.35) {
        this.game.audio.land(p);
        const fall = -this.vel.y;
        if (fall > 13) this.game.damageSelf?.(Math.round((fall - 13) * 8), 'fall');
      }
      // step smoothing
      if (ground - p.y < 0.55) p.y = ground; else p.y = ground;
      this.vel.y = 0;
      this.onGround = true;
      this.airTime = 0;
    } else {
      // walking off small ledges: snap down if close
      if (this.onGround && p.y - ground < 0.35 && this.vel.y <= 0) { p.y = ground; }
      else { this.onGround = false; this.airTime += dt; }
    }
    if (p.y < -60) { this.game.respawn?.('fell'); }
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // footsteps
    if (this.onGround && this.speed > 0.5) {
      this.stepPhase += (this.speed * dt) / (this.sprint ? 1.25 : 0.72);
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1;
        this.game.audio.footstep(p, this.surface(), this.sprint ? 0.35 : this.crouch ? 0.1 : 0.22);
      }
    }
  }

  surface() {
    if (this.interior) return 'wood';
    const d = this.game.world.layout;
    void d;
    const h = heightAt(this.pos.x, this.pos.z);
    if (h < 0.1 && h > -1.5) return 'sand';
    return 'hard';
  }

  animState(cam) {
    const a = this.avatar;
    return {
      speed: this.mode === 'foot' ? this.speed : 0,
      grounded: this.onGround || this.swimming,
      vy: this.vel.y,
      crouch: this.crouch,
      aim: this.aiming,
      aimPitch: cam.pitch,
      weapon: this.game.weapons?.animWeapon() || 'none',
      lookYaw: 0, lookPitch: 0,
      swimming: this.swimming,
      avatar: a,
    };
  }
}
