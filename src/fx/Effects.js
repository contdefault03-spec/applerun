import * as THREE from 'three';

// Pooled sprite particles + tracers + decals for smoke, fire, explosions, sparks, blood, muzzle flashes.
function radialTex(inner, outer, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene, lights) {
    this.scene = scene;
    this.lights = lights;
    this.tex = {
      soft: radialTex('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
      fire: radialTex('rgba(255,240,180,1)', 'rgba(255,80,0,0)'),
    };
    this.pool = [];
    this.active = [];
    for (let i = 0; i < 260; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.soft, transparent: true, depthWrite: false }));
      s.visible = false; scene.add(s); this.pool.push(s);
    }
    // tracer lines are pooled too: each owns a 2-point geometry that is rewritten per shot
    this.tracers = [];
    this.tracerPool = [];
    for (let i = 0; i < 32; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#fff3b0', transparent: true, opacity: 0.8 }));
      line.frustumCulled = false; line.visible = false; scene.add(line);
      this.tracerPool.push(line);
    }
    this.decals = [];
    this.decalGeo = new THREE.PlaneGeometry(0.18, 0.18);
    this.decalMat = new THREE.MeshBasicMaterial({ color: '#111', transparent: true, opacity: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  }
  spawn(pos, { color = '#ffffff', size = 1, grow = 1, life = 1, vel = [0, 0, 0], gravity = 0, fire = false, opacity = 0.8, additive = false }) {
    const s = this.pool.pop() || this.active.shift()?.s;
    if (!s) return;
    s.material.map = fire ? this.tex.fire : this.tex.soft;
    s.material.color.set(color);
    s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    s.material.opacity = opacity;
    s.position.copy(pos);
    s.scale.setScalar(size);
    s.visible = true;
    this.active.push({ s, t: 0, life, size, grow, vel: new THREE.Vector3(...vel), gravity, opacity });
  }
  smoke(pos, dark = false) { this.spawn(pos, { color: dark ? '#222' : '#9e9e9e', size: 0.8, grow: 2.5, life: 1.8 + Math.random(), vel: [(Math.random() - 0.5) * 0.6, 1.2 + Math.random(), (Math.random() - 0.5) * 0.6], opacity: 0.5 }); }
  fire(pos) { this.spawn(pos, { fire: true, color: '#ffffff', size: 0.9, grow: 0.6, life: 0.5 + Math.random() * 0.4, vel: [(Math.random() - 0.5) * 0.4, 2 + Math.random(), (Math.random() - 0.5) * 0.4], additive: true, opacity: 0.9 }); }
  explosion(pos) {
    for (let i = 0; i < 18; i++) this.spawn(pos, { fire: true, size: 2 + Math.random() * 2, grow: 2, life: 0.6 + Math.random() * 0.5, vel: [(Math.random() - 0.5) * 12, Math.random() * 10, (Math.random() - 0.5) * 12], additive: true, opacity: 1 });
    for (let i = 0; i < 14; i++) this.spawn(pos, { color: '#1a1a1a', size: 2, grow: 3, life: 2.5 + Math.random(), vel: [(Math.random() - 0.5) * 5, 3 + Math.random() * 4, (Math.random() - 0.5) * 5], opacity: 0.7 });
    this.lights.flash(pos, '#ff8a3d', 60, 40, 0.6);
  }
  sparks(pos, n = 6, color = '#ffd180') { for (let i = 0; i < n; i++) this.spawn(pos, { color, size: 0.12, grow: 0.2, life: 0.25 + Math.random() * 0.2, vel: [(Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6], gravity: 15, additive: true, opacity: 1 }); }
  blood(pos) { for (let i = 0; i < 6; i++) this.spawn(pos, { color: '#8b0000', size: 0.15, grow: 0.8, life: 0.4, vel: [(Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2], gravity: 9, opacity: 0.9 }); }
  dust(pos) { for (let i = 0; i < 4; i++) this.spawn(pos, { color: '#c8b89a', size: 0.4, grow: 1.5, life: 0.8, vel: [(Math.random() - 0.5) * 1.5, 0.5 + Math.random(), (Math.random() - 0.5) * 1.5], opacity: 0.45 }); }
  muzzle(pos) {
    this.spawn(pos, { fire: true, size: 0.45, grow: 0.3, life: 0.06, additive: true, opacity: 1 });
    this.lights.flash(pos, '#ffb74d', 8, 8, 0.07);
  }
  tracer(from, to, color = '#fff3b0') {
    const line = this.tracerPool.pop() || this.tracers.shift()?.line;
    if (!line) return;
    const a = line.geometry.attributes.position;
    a.setXYZ(0, from.x, from.y, from.z); a.setXYZ(1, to.x, to.y, to.z); a.needsUpdate = true;
    line.material.color.set(color); line.material.opacity = 0.8; line.visible = true;
    this.tracers.push({ line, t: 0 });
  }
  decal(pos, normal) {
    const m = new THREE.Mesh(this.decalGeo, this.decalMat);
    m.position.copy(pos).addScaledVector(normal, 0.02);
    m.lookAt(pos.clone().add(normal));
    this.scene.add(m);
    this.decals.push(m);
    if (this.decals.length > 80) this.scene.remove(this.decals.shift());
  }
  update(dt) {
    this.lights.update(dt);
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) { p.s.visible = false; this.pool.push(p.s); this.active.splice(i, 1); continue; }
      p.vel.y -= p.gravity * dt;
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(p.size * (1 + p.grow * k));
      p.s.material.opacity = p.opacity * (1 - k);
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      t.line.material.opacity = 0.8 * (1 - t.t / 0.08);
      if (t.t > 0.08) { t.line.visible = false; this.tracerPool.push(t.line); this.tracers.splice(i, 1); }
    }
  }
}
