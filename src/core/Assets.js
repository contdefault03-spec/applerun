import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MANIFEST } from '../assets/manifest.js';

// Manifest-driven asset loader with progress + clear error reporting.
export class Assets {
  constructor() {
    this.gltfs = {};
    this.audio = {}; // decoded later by AudioManager (raw ArrayBuffers here)
    this.urls = {};
    this.loader = new GLTFLoader();
  }

  async loadAll(onProgress = () => {}) {
    const entries = MANIFEST.filter((e) => e.preload !== false);
    let done = 0;
    const errors = [];
    const tick = (label) => { done++; onProgress(done / entries.length, label); };
    await Promise.all(entries.map(async (e) => {
      try {
        if (e.type === 'gltf') {
          this.gltfs[e.id] = await this.loader.loadAsync(e.url);
        } else if (e.type === 'audio') {
          const r = await fetch(e.url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          this.audio[e.id] = await r.arrayBuffer();
        }
        this.urls[e.id] = e.url;
      } catch (err) {
        errors.push(`${e.id} (${e.url}): ${err.message || err}`);
      }
      tick(e.label || e.id);
    }));
    for (const e of MANIFEST) this.urls[e.id] = e.url;
    if (errors.length) throw new Error('Failed to load assets:\n' + errors.join('\n'));
  }

  gltf(id) {
    const g = this.gltfs[id];
    if (!g) throw new Error(`Asset "${id}" is not loaded`);
    return g;
  }
  url(id) { return this.urls[id]; }
}
