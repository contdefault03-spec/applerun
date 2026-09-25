import * as THREE from 'three';
import { getLayout } from '../../shared/map/layout.js';
import { getHeightfield } from '../../shared/map/terrain.js';
import { buildTerrain, buildWater } from './Terrain.js';
import { buildRoads } from './Roads.js';
import { buildBuildings } from './Buildings.js';
import { buildLandmarks } from './Landmarks.js';
import { buildProps } from './Props.js';
import { Collision } from './Collision.js';
import { Environment } from './Environment.js';

// WorldManager: builds the city from the shared layout and owns collision + environment.
export class World {
  constructor(engine) {
    this.engine = engine;
    this.scene = engine.scene;
    this.layout = getLayout();
    this.collision = new Collision();
    this.outdoor = new THREE.Group();
    this.outdoor.name = 'outdoor';
    this.scene.add(this.outdoor);
    this.animated = [];
  }

  async build(onProgress = () => {}) {
    const q = this.engine.quality;
    const step = async (label, fn) => { onProgress(label); await new Promise((r) => setTimeout(r, 0)); return fn(); };
    await step('Shaping terrain…', () => getHeightfield());
    this.env = new Environment(this.scene, this.engine.renderer, q);
    const terrain = await step('Building terrain…', () => buildTerrain(q));
    this.outdoor.add(terrain);
    const water = await step('Filling the ocean…', () => buildWater(this.engine.camera.far));
    this.water = water;
    this.outdoor.add(water.mesh);
    this.env.waterUniforms = water.uniforms;
    this.waterUniforms = water.uniforms;
    await step('Paving roads…', () => this.outdoor.add(buildRoads()));
    const b = await step('Raising buildings…', () => buildBuildings());
    this.outdoor.add(b.group);
    this.env.windowMaterials.push(...b.windowMaterials);
    const lmk = await step('Building landmarks…', () => buildLandmarks());
    this.outdoor.add(lmk);
    lmk.traverse((o) => { if (o.userData.ferris) this.ferris = o; if (o.userData.spin) this.animated.push(o); if (o.userData.lamp) this.env.lampMaterials.push(o.material); });
    const props = await step('Planting trees…', () => buildProps());
    this.outdoor.add(props.group);
    props.group.traverse((o) => { if (o.userData.lampHeads) this.env.lampMaterials.push(o.material); if (o.userData.bob) this.boats = o; });
    this.trafficLights = props.trafficLights;
    // Colliders
    for (const c of this.layout.colliders) this.collision.add({ ...c });
    for (const c of props.colliders) this.collision.add(c);
    onProgress('City ready');
  }

  update(dt, focus) {
    this.env.update(dt, focus);
    if (this.waterUniforms) this.waterUniforms.uTime.value += dt;
    this.water?.follow(this.engine.camera);
    if (this.ferris) {
      this.ferris.rotation.x += dt * 0.08;
      for (const c of this.ferris.children) if (c.userData.cabin !== undefined) c.rotation.x = -this.ferris.rotation.x;
    }
    for (const a of this.animated) a.rotation.y += dt;
  }

  setOutdoorVisible(v) { this.outdoor.visible = v; this.env.sky.visible = v; }
}
