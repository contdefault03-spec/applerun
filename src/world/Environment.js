import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { SkySystem } from './SkySystem.js';
import { installGlobalShading, shared } from './GlobalShading.js';
import { enableVisibleLayers, configureCascadeLayers } from './layers.js';

// Time of day: HDRI sky (day / sunset / night blend), sun + moon light with cascaded
// shadow maps, image-based lighting captured from the sky, and height fog whose colour
// follows the sky so distant land and sea melt into the horizon.
const FOG = {
  day: new THREE.Color(0xb9cadb), dusk: new THREE.Color(0xc99a82), night: new THREE.Color(0x070b14),
};
const SHADOW = {
  high: { cascades: 3, size: 2048, maxFar: 420 },
  medium: { cascades: 2, size: 1024, maxFar: 220 },
};

export class Environment {
  constructor(scene, renderer, quality, camera) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.quality = quality;
    this.time = 13.0; // hours (0-24)
    this.daySpeed = 24 / (48 * 60); // one in-game day per 48 real minutes
    this.paused = false;
    const sh = SHADOW[quality];
    installGlobalShading({ cascades: sh ? sh.cascades : 0, cameraNear: camera.near, shadowFar: sh ? Math.min(camera.far, sh.maxFar) : 400 });
    this.sky = new SkySystem(renderer, scene, camera.far);
    // sun / moon
    if (sh) {
      this.csm = new CSM({
        camera, parent: scene, cascades: sh.cascades, maxFar: sh.maxFar, mode: 'practical',
        shadowMapSize: sh.size, shadowBias: -0.0002, lightIntensity: 3, lightMargin: 180,
        lightDirection: new THREE.Vector3(-0.5, -0.8, -0.3).normalize(),
      });
      this.csm.fade = true;
      this.csm.updateFrustums();
      for (const l of this.csm.lights) { l.shadow.normalBias = 0.035; l.shadow.radius = 2; }
      this.csm._getExtendedBreaks(shared.csmBreaks);
      this.sunLights = this.csm.lights;
      configureCascadeLayers(this.csm.lights);
    } else {
      const l = new THREE.DirectionalLight(0xfff1dc, 3);
      scene.add(l, l.target);
      this.sunLights = [l];
    }
    this.sun = this.sunLights[0];
    enableVisibleLayers(camera);
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5b5140, 0.35);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(FOG.day.getHex(), 0.00045);
    this.sunDir = new THREE.Vector3();
    this.nightFactor = 0;
    this.windowMaterials = [];
    this.lampMaterials = [];
    this.neonMaterials = [];
    this.waterUniforms = null;
    this.envTimer = 99;
    this.lastW = new THREE.Vector3(-1, -1, -1);
    this.fogColor = new THREE.Color();
    this.shadowsActive = true;
    this.update(0, new THREE.Vector3());
  }

  async load(onProgress) {
    await this.sky.load(onProgress);
    this.refreshEnvMap(true);
  }

  // The image-based lighting is re-captured from the sky when the blend has changed enough.
  refreshEnvMap(force = false) {
    const w = this.sky.uniforms.uW.value;
    if (!force && w.distanceTo(this.lastW) < 0.03 && this.envTimer < 20) return;
    const tex = this.sky.captureEnvironment();
    if (tex) { this.scene.environment = tex; this.lastW.copy(w); this.envTimer = 0; }
    this.scene.environmentIntensity = 0.55 + 0.1 * (1 - this.nightFactor);
  }

  setTime(h) { this.time = ((h % 24) + 24) % 24; this.update(0, this.focus || new THREE.Vector3()); this.refreshEnvMap(true); }

  /** Pause shadow-map updates (inside interiors the sun can't reach). */
  setShadowsActive(on) {
    this.shadowsActive = on;
    for (const l of this.sunLights) if (l.shadow) l.shadow.autoUpdate = on;
  }

  update(dt, focus) {
    this.focus = focus;
    if (!this.paused) this.time = (this.time + dt * this.daySpeed) % 24;
    this.envTimer += dt;
    const t = this.time;
    // sun elevation: -1 at midnight, +1 at noon
    const ang = ((t - 6) / 24) * Math.PI * 2;
    const el = Math.sin(ang);
    const az = Math.cos(ang);
    this.sunDir.set(az * 0.75, Math.max(el, -0.3), 0.45).normalize();
    const day = THREE.MathUtils.smoothstep(el, -0.12, 0.25);
    this.nightFactor = 1 - day;
    // sun by day, cool moonlight by night
    const moon = el <= 0.03;
    const lightDir = moon ? new THREE.Vector3(-0.35, 0.85, 0.25).normalize() : this.sunDir;
    const warm = THREE.MathUtils.smoothstep(el, 0.0, 0.45);
    const col = moon ? new THREE.Color(0.55, 0.65, 0.95) : new THREE.Color(1, 0.72 + 0.24 * warm, 0.5 + 0.42 * warm);
    const intensity = moon ? 0.28 : 0.35 + 2.9 * THREE.MathUtils.smoothstep(el, 0.02, 0.35);
    if (this.csm) {
      this.csm.lightDirection.copy(lightDir).negate();
      for (const l of this.csm.lights) { l.color.copy(col); l.intensity = intensity; }
    } else {
      this.sun.color.copy(col); this.sun.intensity = intensity;
      this.sun.position.copy(focus).addScaledVector(lightDir, 300);
      this.sun.target.position.copy(focus);
    }
    this.hemi.intensity = 0.12 + 0.3 * day;
    this.hemi.color.setRGB(0.55 + 0.26 * day, 0.62 + 0.28 * day, 0.85 + 0.15 * day);
    // fog / horizon colour
    const fc = this.fogColor.copy(FOG.night).lerp(FOG.dusk, THREE.MathUtils.smoothstep(el, -0.2, 0.05)).lerp(FOG.day, THREE.MathUtils.smoothstep(el, 0.08, 0.4));
    this.scene.fog.color.copy(fc);
    shared.fogSun[0].copy(this.sunDir);
    const sunTint = moon ? new THREE.Color(0, 0, 0) : new THREE.Color(1, 0.78 + 0.2 * warm, 0.55 + 0.35 * warm).multiplyScalar(1.1 - 0.4 * warm);
    shared.fogSun[1].set(sunTint.r, sunTint.g, sunTint.b);
    // denser, lower haze at dawn/dusk and at night
    shared.fogParams[0].set(0.0011 + 0.0007 * (1 - warm), 0.011, 0);
    this.sky.update(this.sunDir, el, fc);
    // eye adaptation: exposure opens up at night
    this.exposure = THREE.MathUtils.lerp(1.45, 0.62, day);
    this.renderer.toneMappingExposure = this.exposure;
    const n = this.nightFactor;
    for (const m of this.windowMaterials) m.emissiveIntensity = 0.35 * n;
    for (const m of this.lampMaterials) m.emissiveIntensity = 0.1 + 4 * n;
    for (const m of this.neonMaterials) m.emissiveIntensity = 0.15 + 1.1 * n;
    if (this.waterUniforms) {
      this.waterUniforms.uSunDir.value.copy(this.sunDir);
      this.waterUniforms.uNight.value = n * 0.8;
      this.waterUniforms.uSky.value.copy(fc);
    }
    if (this.envTimer > 3) this.refreshEnvMap();
  }

  /** Called right before rendering, after the camera has moved. */
  preRender() {
    if (this.csm) this.csm.update();
  }

  clock() {
    const h = Math.floor(this.time), m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
}
