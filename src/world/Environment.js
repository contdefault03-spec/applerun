import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Sky, sun, ambient light, fog and a day/night cycle.
export class Environment {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = 13.0; // hours (0-24)
    this.daySpeed = 24 / (48 * 60); // one in-game day per 48 real minutes
    this.paused = false;
    const sky = new Sky();
    sky.scale.setScalar(20000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.85;
    scene.add(sky);
    this.sky = sky;
    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
    this.sun.castShadow = quality !== 'low';
    const sz = quality === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sz, sz);
    const s = this.sun.shadow.camera;
    s.left = -90; s.right = 90; s.top = 90; s.bottom = -90; s.near = 1; s.far = 700;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5b5140, 1.1);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xbfd6ea, 0.0009);
    this.sunDir = new THREE.Vector3();
    this.nightFactor = 0;
    this.windowMaterials = [];
    this.lampMaterials = [];
    this.waterUniforms = null;
    // Neutral studio environment for reflections on glass / metal / cars
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = this.envRT.texture;
    pmrem.dispose();
    this.envTimer = 0;
    this.update(0, new THREE.Vector3());
  }

  refreshEnvMap() { this.scene.environmentIntensity = 0.12 + 0.38 * (1 - this.nightFactor); }

  setTime(h) { this.time = ((h % 24) + 24) % 24; this.update(0, this.sun.target.position); this.refreshEnvMap(); }

  update(dt, focus) {
    if (!this.paused) this.time = (this.time + dt * this.daySpeed) % 24;
    this.envTimer += dt;
    if (this.envTimer > 2) { this.envTimer = 0; this.refreshEnvMap(); }
    const t = this.time;
    // sun elevation: -1 at midnight, +1 at noon
    const ang = ((t - 6) / 24) * Math.PI * 2;
    const el = Math.sin(ang);
    const az = Math.cos(ang);
    this.sunDir.set(az * 0.75, Math.max(el, -0.3), 0.45).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const day = THREE.MathUtils.smoothstep(el, -0.12, 0.25);
    this.nightFactor = 1 - day;
    // sun light follows focus for shadows
    const lightDir = el > 0.05 ? this.sunDir : new THREE.Vector3(-0.3, 0.9, 0.2).normalize(); // moonlight
    this.sun.position.copy(focus).addScaledVector(lightDir, 300);
    this.sun.target.position.copy(focus);
    const warm = THREE.MathUtils.smoothstep(el, 0.0, 0.45);
    this.sun.color.setRGB(1, 0.75 + 0.2 * warm, 0.55 + 0.4 * warm);
    this.sun.intensity = el > 0.05 ? 0.4 + 2.8 * day : 0.35;
    if (el <= 0.05) this.sun.color.setRGB(0.55, 0.65, 0.95);
    this.hemi.intensity = 0.25 + 0.95 * day;
    this.hemi.color.setRGB(0.55 + 0.26 * day, 0.62 + 0.28 * day, 0.85 + 0.15 * day);
    const fogDay = new THREE.Color(0xbfd6ea), fogDusk = new THREE.Color(0xe0a27a), fogNight = new THREE.Color(0x0c1220);
    const fc = fogNight.clone().lerp(fogDusk, THREE.MathUtils.smoothstep(el, -0.2, 0.05)).lerp(fogDay, THREE.MathUtils.smoothstep(el, 0.05, 0.35));
    this.scene.fog.color.copy(fc);
    this.renderer.toneMappingExposure = 0.55 + 0.45 * day;
    const n = this.nightFactor;
    for (const m of this.windowMaterials) m.emissiveIntensity = 1.1 * n;
    for (const m of this.lampMaterials) m.emissiveIntensity = 0.1 + 3 * n;
    if (this.waterUniforms) {
      this.waterUniforms.uSunDir.value.copy(this.sunDir);
      this.waterUniforms.uNight.value = n * 0.8;
      this.waterUniforms.uSky.value.copy(fc);
    }
  }

  clock() {
    const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
