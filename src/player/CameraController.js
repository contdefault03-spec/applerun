import * as THREE from 'three';

// Third-person orbit camera with collision, first-person head camera, and vehicle chase camera.
export class CameraController {
  constructor(camera, input, settings, collision) {
    this.camera = camera;
    this.input = input;
    this.settings = settings;
    this.collision = collision;
    this.yaw = 0; this.pitch = -0.12;
    this.mode = settings.get('camera.mode') || 'third'; // 'third' | 'first'
    this.distance = 4.2;
    this.aimBlend = 0;
    this.target = new THREE.Vector3();
    this.smoothPos = new THREE.Vector3();
    this.shake = 0;
    this.lastMouse = 0;
    this.vehicleYaw = 0;
    this.recoil = 0;
    this.fovKick = 0;
    this.baseFov = settings.get('graphics.fov');
    settings.onChange((k, v) => { if (k === 'graphics.fov') { this.baseFov = v; } });
  }
  toggleMode() {
    this.mode = this.mode === 'third' ? 'first' : 'third';
    this.settings.set('camera.mode', this.mode);
  }
  look(dt) {
    const s = 0.0022 * this.settings.get('controls.sensitivity') * (this.aimBlend > 0.5 ? 0.6 : 1) * (this.zoomed ? 0.35 : 1);
    const inv = this.settings.get('controls.invertY') ? -1 : 1;
    const { dx, dy } = this.input.mouse;
    if (dx || dy) this.lastMouse = performance.now();
    this.yaw -= dx * s;
    this.pitch -= dy * s * inv;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 1.25);
    if (this.recoil > 0) { this.pitch += this.recoil * dt * 10; this.recoil = Math.max(0, this.recoil - dt * 10 * this.recoil - dt * 0.5); }
  }
  forward(out = new THREE.Vector3()) { return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch)); }
  addShake(v) { this.shake = Math.min(1, this.shake + v); }
  kick(v) { this.recoil += v; }

  /**
   * Update for a character on foot.
   * @param avatar Avatar  @param aiming bool
   */
  updateOnFoot(dt, avatar, aiming, crouch) {
    this.aimBlend += ((aiming ? 1 : 0) - this.aimBlend) * Math.min(1, dt * 10);
    const h = avatar.char.height;
    const head = avatar.position.clone();
    if (this.mode === 'first') {
      avatar.headWorld(head);
      // eyes slightly forward/up of the head bone
      const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      head.addScaledVector(f, 0.12).y += h * 0.05;
      this.camera.position.copy(head);
      this.lookFrom(head);
      avatar.char.root.visible = false;
    } else {
      avatar.char.root.visible = true;
      head.y += h * (crouch ? 0.62 : 0.86);
      this.target.lerp(head, this.target.lengthSq() === 0 ? 1 : Math.min(1, dt * 18));
      const inside = avatar.interior || this.interior;
      const dist = THREE.MathUtils.lerp((inside ? 2.6 : this.distance) * (h / 1.8) ** 0.5, 1.7, this.aimBlend);
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const pivot = this.target.clone().addScaledVector(right, 0.55 * this.aimBlend + 0.25);
      const back = this.forward().multiplyScalar(-1);
      const want = pivot.clone().addScaledVector(back, dist);
      this.placeWithCollision(pivot, want);
      if (inside) this.camera.position.y = Math.min(this.camera.position.y, inside.H - 0.3);
      this.lookFrom(this.camera.position, pivot.clone().addScaledVector(this.forward(), 10));
    }
    this.applyFx(dt);
  }

  updateVehicle(dt, vehicle) {
    const pos = vehicle.group.position;
    const idle = performance.now() - this.lastMouse > 1400;
    const vyaw = vehicle.yaw + (vehicle.speed < -1 ? Math.PI : 0);
    if (idle && Math.abs(vehicle.speed) > 2) {
      let d = vyaw + Math.PI - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 2.5);
      this.pitch += (-0.22 - this.pitch) * Math.min(1, dt * 2);
    }
    const size = vehicle.spec.length;
    const pivot = pos.clone(); pivot.y += vehicle.spec.height + 0.6;
    if (this.mode === 'first' && vehicle.spec.interior) {
      const seat = vehicle.seatWorld(0);
      seat.y += 0.72;
      this.camera.position.copy(seat);
      this.lookFrom(seat);
    } else {
      const want = pivot.clone().addScaledVector(this.forward(), -(size * 1.15 + 3));
      this.placeWithCollision(pivot, want, vehicle.collider);
      this.lookFrom(this.camera.position, pivot.clone().addScaledVector(this.forward(), 10));
    }
    const sp = Math.abs(vehicle.speed);
    this.fovKick += ((Math.min(1, sp / 40) * 12) - this.fovKick) * Math.min(1, dt * 2);
    this.applyFx(dt);
  }

  updateFree(dt, pivot, dist = 6) {
    const want = pivot.clone().addScaledVector(this.forward(), -dist);
    this.placeWithCollision(pivot, want);
    this.lookFrom(this.camera.position, pivot);
    this.applyFx(dt);
  }

  placeWithCollision(pivot, want, ignore = null) {
    const d = want.clone().sub(pivot);
    const len = d.length();
    d.divideScalar(len || 1);
    const hit = this.collision.raycast([pivot.x, pivot.y, pivot.z], [d.x, d.y, d.z], len, { ignore, filter: (c) => c.kind !== 'tree' && c.kind !== 'pole' && c.kind !== 'small' && !c.noCamera });
    const L = hit ? Math.max(0.3, hit.t - 0.3) : len;
    this.camera.position.copy(pivot).addScaledVector(d, L);
  }
  lookFrom(pos, at = null) {
    if (at) this.camera.lookAt(at);
    else this.camera.lookAt(pos.clone().add(this.forward()));
  }
  applyFx(dt) {
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.3;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake = Math.max(0, this.shake - dt * 2.5);
    }
    const fov = (this.zoomed ? this.zoomFov : this.baseFov - this.aimBlend * 12) + this.fovKick;
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 12); this.camera.updateProjectionMatrix(); }
    this.fovKick *= Math.max(0, 1 - dt * 0.5);
  }
}
