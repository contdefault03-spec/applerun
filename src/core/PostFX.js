import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, ToneMappingEffect, ToneMappingMode, Effect, BlendFunction } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

// Post-processing chain (pmndrs/postprocessing):
//   scene (half-float HDR) → N8AO ambient occlusion (high) → bloom (street lights, neon,
//   windows, sun glints) + exposure/white balance → ACES filmic tone mapping →
//   subtle colour grade (contrast, split toning, vignette) → SMAA anti-aliasing.
// N8AO reconstructs normals from the depth buffer, so AO costs no extra scene render.

class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', /* glsl */`
      uniform float exposure;
      uniform vec3 whiteBalance;
      uniform float saturation;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb * exposure * whiteBalance;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation);
        outputColor = vec4(max(c, 0.0), inputColor.a);
      }`, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([['exposure', new THREE.Uniform(1)], ['whiteBalance', new THREE.Uniform(new THREE.Vector3(1, 1, 1))], ['saturation', new THREE.Uniform(1.08)]]),
    });
  }
}

class LookEffect extends Effect {
  constructor() {
    super('LookEffect', /* glsl */`
      uniform float contrast;
      uniform vec3 shadowTint;
      uniform vec3 highlightTint;
      uniform float vignette;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
        // gentle S-curve around mid grey
        c = mix(c, c * c * (3.0 - 2.0 * c), contrast);
        // split toning: cool shadows, warm highlights
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c += shadowTint * (1.0 - smoothstep(0.0, 0.45, l)) + highlightTint * smoothstep(0.55, 1.0, l);
        // vignette
        vec2 d = uv - 0.5;
        c *= 1.0 - vignette * smoothstep(0.35, 0.85, length(d * vec2(1.25, 1.0)));
        outputColor = vec4(c, inputColor.a);
      }`, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([['contrast', new THREE.Uniform(0.18)], ['shadowTint', new THREE.Uniform(new THREE.Vector3(-0.004, 0.0, 0.012))], ['highlightTint', new THREE.Uniform(new THREE.Vector3(0.012, 0.006, -0.006))], ['vignette', new THREE.Uniform(0.22)]]),
    });
  }
}

export class PostFX {
  constructor(engine, quality) {
    const { renderer, scene, camera } = engine;
    this.engine = engine;
    this.quality = quality;
    renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the chain
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer.addPass(new RenderPass(scene, camera));
    const w = renderer.domElement.width, h = renderer.domElement.height;
    if (quality === 'high') {
      const ao = new N8AOPostPass(scene, camera, w, h);
      ao.configuration.aoRadius = 2.2;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.2;
      ao.configuration.halfRes = true;
      ao.configuration.transparencyAware = false;
      ao.configuration.gammaCorrection = false;
      ao.setQualityMode('Low');
      this.ao = ao;
      this.composer.addPass(ao);
    }
    this.bloom = new BloomEffect({ luminanceThreshold: 1.0, luminanceSmoothing: 0.25, mipmapBlur: true, intensity: 0.9, radius: 0.72, levels: 7 });
    this.exposure = new ExposureEffect();
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.look = new LookEffect();
    this.composer.addPass(new EffectPass(camera, this.bloom, this.exposure, this.tone, this.look));
    this.smaa = new SMAAEffect();
    this.composer.addPass(new EffectPass(camera, this.smaa));
    this.enabled = true;
  }
  setSize(w, h) { this.composer.setSize(w, h); }
  /** Per-frame exposure / bloom tuning from the time of day. */
  setLook({ exposure = 1, night = 0 } = {}) {
    this.exposure.uniforms.get('exposure').value = exposure;
    // daylight: only the sun / glints bloom; night: street lights, neon and windows glow
    this.bloom.intensity = 0.3 + 0.7 * night;
    this.bloom.luminanceMaterial.threshold = 1.8 - 0.95 * night;
  }
  render(dt) { this.composer.render(dt); }
}
