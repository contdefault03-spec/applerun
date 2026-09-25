import * as THREE from 'three';

// Fixed set of dynamic lights that stay in the scene for the whole session.
// three.js bakes the number of lights into every material's shader, so adding or removing a
// light at runtime recompiles every visible material (this caused the old first-shot freeze).
// Systems borrow lights from here instead and switch them off with intensity = 0.
export class LightPool {
  constructor(scene) {
    this.scene = scene;
    this.flashes = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight('#ffffff', 0, 10, 2);
      l.position.set(0, -500, 0);
      scene.add(l);
      this.flashes.push({ l, t: 1, life: 1, peak: 0 });
    }
    this.named = new Map();
  }
  // A persistent named point/spot light (created once, during loading).
  point(name, opts = {}) { return this.get(name, () => new THREE.PointLight(opts.color || '#ffffff', 0, opts.distance || 10, opts.decay ?? 2)); }
  spot(name, opts = {}) {
    return this.get(name, () => {
      const l = new THREE.SpotLight(opts.color || '#ffffff', 0, opts.distance || 60, opts.angle || 0.45, opts.penumbra ?? 0.5, opts.decay ?? 1.2);
      l.castShadow = false;
      this.scene.add(l.target);
      return l;
    });
  }
  get(name, make) {
    let l = this.named.get(name);
    if (!l) { l = make(); l.position.set(0, -500, 0); this.scene.add(l); this.named.set(name, l); }
    return l;
  }
  // Short-lived flash (muzzle flash, explosion): steals the oldest flash light.
  flash(pos, color, intensity, distance, life) {
    let best = this.flashes[0];
    for (const f of this.flashes) if (f.t / f.life > best.t / best.life) best = f;
    best.l.color.set(color); best.l.distance = distance; best.l.position.copy(pos);
    best.peak = intensity; best.t = 0; best.life = life; best.l.intensity = intensity;
  }
  update(dt) {
    for (const f of this.flashes) {
      if (f.t >= f.life) continue;
      f.t += dt;
      const k = Math.min(1, f.t / f.life);
      f.l.intensity = f.peak * (1 - k) * (1 - k);
    }
  }
}
