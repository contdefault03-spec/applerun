import * as THREE from 'three';
import { PostFX } from './PostFX.js';

// Renderer + scene + camera + main loop with quality presets.
export class Engine {
  constructor(container, settings) {
    this.settings = settings;
    this.quality = settings.get('graphics.quality');
    const q = this.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: q !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.25 : 1));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.canvas = this.renderer.domElement;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.get('graphics.fov'), window.innerWidth / window.innerHeight, 0.08, q === 'low' ? 900 : 1600);
    this.scene.add(this.camera);
    this.updaters = [];
    this.beforeRender = []; // hooks run after all updates, right before drawing (e.g. shadow cascades)
    this.post = null;
    this.clock = new THREE.Clock();
    this.fps = 60;
    this.running = false;
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.post?.setSize(window.innerWidth, window.innerHeight);
  }
  /** Post-processing on/off (never on the low preset). */
  setPost(on) {
    if (on && this.quality !== 'low') {
      if (!this.post) this.post = new PostFX(this, this.quality);
    } else if (this.post) {
      this.post.composer.dispose();
      this.post = null;
    }
    this.renderer.toneMapping = this.post ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  }
  /** Draw the main scene (through post-processing when enabled). */
  renderScene(dt = 1 / 60) {
    for (const f of this.beforeRender) f();
    if (this.post) this.post.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
  onUpdate(fn) { this.updaters.push(fn); return () => (this.updaters = this.updaters.filter((f) => f !== fn)); }
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
      try {
        for (const f of this.updaters) f(dt);
      } catch (e) {
        // never let one bad frame kill the game loop — log (rate-limited) and keep rendering
        const now = performance.now();
        if (!this._lastErr || now - this._lastErr > 2000) { this._lastErr = now; console.error('[frame]', e); }
      }
      if (this.renderOverride) this.renderOverride();
      else this.renderScene(dt);
    };
    loop();
  }
  /** Manual stepping (used by automated tests). */
  step(dt = 1 / 60, n = 1) {
    for (let i = 0; i < n; i++) for (const f of this.updaters) f(dt);
    if (this.renderOverride) this.renderOverride();
    else this.renderScene(dt);
  }
}
