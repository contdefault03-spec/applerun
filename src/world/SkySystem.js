import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { UltraHDRLoader } from 'three/addons/loaders/UltraHDRLoader.js';

// HDRI sky (Poly Haven, CC0): a camera-following dome that blends a day, a sunset/sunrise
// and a night HDRI by time of day. Each HDRI is rotated around the vertical axis so the sun
// baked into it sits at the same compass bearing as the game's sun. The daytime HDRI's own
// sun is clamped and a sun disc is drawn at the real sun direction instead. Near the horizon
// the sky melts into the fog colour, which is what the ocean and distant land fade into.
// The blended dome is also rendered into a PMREM environment map every few seconds so
// reflections and image-based lighting follow the sky.
const HDRIS = {
  day: { url: '/assets/hdri/day_sky_1k.hdr', sunAz: 214, clamp: 6, gain: 1.0, fillBelow: 0 },
  sunset: { url: '/assets/hdri/kiara_1_dawn_1k.hdr', sunAz: 229, clamp: 1e5, gain: 0.75, fillBelow: 9 },
  night: { url: '/assets/hdri/dikhololo_night_1k.hdr', sunAz: 123, clamp: 1e5, gain: 0.8, fillBelow: 10 },
};

export class SkySystem {
  constructor(renderer, scene, far) {
    this.renderer = renderer;
    this.scene = scene;
    this.uniforms = {
      tDay: { value: null }, tSunset: { value: null }, tNight: { value: null },
      uW: { value: new THREE.Vector3(1, 0, 0) },
      uRot: { value: new THREE.Vector3() },
      uClampDay: { value: HDRIS.day.clamp },
      uGain: { value: new THREE.Vector3(HDRIS.day.gain, HDRIS.sunset.gain, HDRIS.night.gain) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      uSunDisc: { value: 1 },
      uHorizon: { value: new THREE.Color(0xbfd6ea) },
      uExposure: { value: 1 },
      uHazeTop: { value: 0.09 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
          vec4 p = projectionMatrix * viewMatrix * vec4(cameraPosition + normalize(position) * 10.0, 1.0);
          gl_Position = p.xyww; // always on the far plane
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDay, tSunset, tNight;
        uniform vec3 uW, uRot, uGain, uSunDir, uSunColor;
        uniform float uClampDay, uSunDisc, uExposure, uHazeTop;
        uniform vec3 uHorizon;
        varying vec3 vDir;
        const float PI = 3.14159265359;
        vec2 equirect(vec3 d, float rot) {
          float c = cos(rot), s = sin(rot);
          d = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
          return vec2(atan(d.z, d.x) / (2.0 * PI) + 0.5, asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5);
        }
        vec3 lookup(sampler2D t, vec3 d, float rot) { return texture2D(t, equirect(d, rot)).rgb; }
        void main() {
          vec3 d = normalize(vDir);
          // below the horizon mirror the upper sky (the HDRIs contain ground there)
          vec3 ds = vec3(d.x, max(d.y, 0.02), d.z);
          vec3 col = vec3(0.0);
          if (uW.x > 0.001) col += uW.x * min(lookup(tDay, ds, uRot.x), vec3(uClampDay)) * uGain.x;
          if (uW.y > 0.001) col += uW.y * lookup(tSunset, ds, uRot.y) * uGain.y;
          if (uW.z > 0.001) col += uW.z * lookup(tNight, ds, uRot.z) * uGain.z;
          // sun disc + glow at the real sun direction
          float cs = dot(d, uSunDir);
          float disc = smoothstep(0.99985, 0.99994, cs);
          float glow = pow(max(cs, 0.0), 350.0) * 2.0 + pow(max(cs, 0.0), 12.0) * 0.12;
          col += uSunColor * (disc * 60.0 + glow) * uSunDisc;
          col *= uExposure;
          // haze band melting into the fog colour at the horizon
          float el = d.y;
          col = mix(col, uHorizon, 1.0 - smoothstep(-0.02, uHazeTop, el));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
    this.mesh.onBeforeRender = (r, s, cam) => { this.mesh.position.copy(cam.position); this.mesh.updateMatrixWorld(); };
    scene.add(this.mesh);
    // environment capture scene (the dome alone)
    this.envScene = new THREE.Scene();
    this.envMesh = new THREE.Mesh(this.mesh.geometry, mat);
    this.envMesh.frustumCulled = false;
    this.envScene.add(this.envMesh);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.ready = false;
    this.far = far;
  }

  // Paint out whatever the photographer's horizon contains (buildings, trees, pylons) below
  // `deg` degrees: each column is replaced by its own sky colour at that elevation, slightly
  // brightening towards the horizon like real atmospheric haze.
  static fillHorizon(tex, deg) {
    const { width: w, height: h, data } = tex.image;
    const cut = Math.round(h * (0.5 - deg / 180));
    const band = Math.max(4, Math.round(h * (4 / 180)));
    const half = data instanceof Uint16Array;
    const rd = half ? (v) => THREE.DataUtils.fromHalfFloat(v) : (v) => v;
    const wr = half ? (v) => THREE.DataUtils.toHalfFloat(v) : (v) => v;
    // reference colour per column: rows just above the cut, blurred horizontally so single
    // bright pixels (stars, lamps) can't smear into vertical streaks
    const refRaw = new Float32Array(w * 3), ref = new Float32Array(w * 3);
    for (let x = 0; x < w; x++) for (let k = 1; k <= 8; k++) for (let c = 0; c < 3; c++) refRaw[x * 3 + c] += rd(data[((cut - k) * w + x) * 4 + c]) / 8;
    const R = Math.round(w / 28);
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let acc = 0;
      for (let d = -R; d <= R; d++) acc += refRaw[(((x + d) % w + w) % w) * 3 + c];
      ref[x * 3 + c] = acc / (2 * R + 1);
    }
    for (let x = 0; x < w; x++) {
      for (let y = cut - band; y < h; y++) {
        const i = (y * w + x) * 4;
        const t = y < cut ? (y - (cut - band)) / band : 1; // blend in over a few degrees
        const bright = 1 + 0.12 * Math.max(0, Math.min(1, (y - cut) / Math.max(1, h / 2 - cut)));
        for (let c = 0; c < 3; c++) {
          const v = rd(data[i + c]);
          data[i + c] = wr(v + (ref[x * 3 + c] * bright - v) * t);
        }
      }
    }
    tex.needsUpdate = true;
  }

  async load(onProgress) {
    const hdr = new HDRLoader().setDataType(THREE.HalfFloatType);
    const ultra = new UltraHDRLoader().setDataType(THREE.HalfFloatType);
    const load = (def) => new Promise((res, rej) => (def.ultra ? ultra : hdr).load(def.url, res, undefined, rej));
    const keys = Object.keys(HDRIS);
    for (let i = 0; i < keys.length; i++) {
      onProgress?.(`Loading sky (${keys[i]})…`);
      try {
        const t = await load(HDRIS[keys[i]]);
        if (HDRIS[keys[i]].fillBelow) SkySystem.fillHorizon(t, HDRIS[keys[i]].fillBelow);
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
        t.wrapS = THREE.RepeatWrapping;
        this.uniforms['t' + keys[i][0].toUpperCase() + keys[i].slice(1)].value = t;
      } catch (e) {
        console.warn('[sky] could not load', HDRIS[keys[i]].url, e);
      }
    }
    // missing textures fall back to whatever loaded
    const any = this.uniforms.tDay.value || this.uniforms.tSunset.value || this.uniforms.tNight.value;
    for (const k of ['tDay', 'tSunset', 'tNight']) if (!this.uniforms[k].value) this.uniforms[k].value = any || new THREE.DataTexture(new Uint8Array([140, 180, 230, 255]), 1, 1);
    this.ready = true;
  }

  /**
   * @param sunDir  normalised game sun direction
   * @param el      sun elevation (-1..1, sine)
   * @param horizon fog/horizon colour
   */
  update(sunDir, el, horizon) {
    const u = this.uniforms;
    // blend weights: night below -8°, sunset band around the horizon, day above ~20°
    const deg = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1)) * 180 / Math.PI;
    const night = 1 - THREE.MathUtils.smoothstep(deg, -10, -2);
    const day = THREE.MathUtils.smoothstep(deg, 8, 24);
    const sunset = Math.max(0, 1 - night - day);
    u.uW.value.set(day, sunset, night);
    // rotate each HDRI so its sun sits at the game sun's compass bearing
    const gameAz = Math.atan2(sunDir.z, sunDir.x);
    const rot = (defAz) => {
      const hdriAz = (defAz / 360 - 0.5) * Math.PI * 2; // atan2(z, x) of the HDRI sun
      return hdriAz - gameAz;
    };
    u.uRot.value.set(rot(HDRIS.day.sunAz), rot(HDRIS.sunset.sunAz), rot(HDRIS.night.sunAz));
    u.uSunDir.value.copy(sunDir);
    u.uSunDisc.value = day + sunset * 0.35; // the twilight HDRI has no visible sun disc
    u.uSunColor.value.setRGB(1, 0.8 + 0.15 * day, 0.6 + 0.3 * day);
    u.uHorizon.value.copy(horizon);
    u.uExposure.value = 1;
    void el;
  }

  /** Re-render the image-based lighting from the current sky blend. */
  captureEnvironment() {
    if (!this.ready) return null;
    const old = this.envRT;
    this.envMesh.position.set(0, 0, 0);
    this.envMesh.updateMatrixWorld();
    // capture without the haze band so ground-facing reflections stay sky-coloured
    const hz = this.uniforms.uHazeTop.value;
    this.uniforms.uHazeTop.value = 0.001;
    this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 100, old ? { renderTarget: old } : undefined);
    this.uniforms.uHazeTop.value = hz;
    return this.envRT.texture;
  }
}
