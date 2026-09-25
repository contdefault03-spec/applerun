import * as THREE from 'three';
import { getLayout } from '../../shared/map/layout.js';
import { getHeightfield } from '../../shared/map/terrain.js';
import { buildTerrain, buildWater } from './Terrain.js';
import { buildRoads } from './Roads.js';
import { buildBuildings } from './Buildings.js';
import { buildLandmarks } from './Landmarks.js';
import { buildProps } from './Props.js';
import { buildTrees } from './Trees.js';
import { buildPlants } from './Plants.js';
import { Collision } from './Collision.js';
import { Environment } from './Environment.js';
import { mergeStatic, splitByCells } from './mergeStatic.js';
import { LAYER } from './layers.js';
import { TextureLib } from './TextureLib.js';

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
    this.env = new Environment(this.scene, this.engine.renderer, q, this.engine.camera);
    await this.env.load((msg) => onProgress(msg));
    this.engine.beforeRender.push(() => this.env.preRender());
    this.textures = new TextureLib(this.engine.renderer);
    onProgress('Loading ground textures…');
    let terrainTex = null;
    try { terrainTex = await this.textures.terrainArrays(); } catch (e) { console.warn('[world] terrain textures unavailable, using fallback', e); }
    const terrain = await step('Building terrain…', () => buildTerrain(q, terrainTex));
    this.outdoor.add(terrain);
    const water = await step('Filling the ocean…', () => buildWater(this.engine.camera.far, this.env.sky.uniforms));
    this.water = water;
    this.outdoor.add(water.mesh);
    this.env.waterUniforms = water.uniforms;
    this.waterUniforms = water.uniforms;
    let roadTex = null;
    try {
      const [asphalt, pavement, concrete, grass, street] = await Promise.all(['asphalt', 'pavement', 'concrete', 'grass', 'street'].map((n) => this.textures.material(n)));
      roadTex = { asphalt, pavement, concrete, grass, street: { ar: street.ar, n: street.n } };
    } catch (e) { console.warn('[world] road textures unavailable', e); }
    const roads = await step('Paving roads…', () => buildRoads(roadTex));
    this.outdoor.add(roads.group);
    this.medianTrees = roads.medianTrees;
    for (const c of roads.colliders) this.collision.add(c);
    const b = await step('Raising buildings…', () => buildBuildings());
    // cut the city-wide merged facade meshes into 200 m cells for culling
    for (const m of [...b.group.children]) if (m.isMesh && m.geometry.attributes.position.count > 3000) { m.removeFromParent(); b.group.add(...splitByCells(m, 200)); }
    this.outdoor.add(b.group);
    this.env.windowMaterials.push(...b.windowMaterials);
    this.env.neonMaterials.push(...b.neonMaterials);
    const lmk = await step('Building landmarks…', () => buildLandmarks());
    this.outdoor.add(lmk);
    lmk.traverse((o) => { if (o.userData.ferris) this.ferris = o; if (o.userData.spin) this.animated.push(o); if (o.userData.lamp) this.env.lampMaterials.push(o.material); });
    this.skilifts = lmk.userData.skilifts || [];
    this.coasterCars = lmk.userData.coasterCars || [];
    // static landmark parts → a few merged meshes per material and area (far fewer draw calls)
    this.mergeStats = mergeStatic(lmk, { keep: (o) => o.userData.ferris || o.userData.spin || o.userData.keep || o.userData.skilift || o.userData.coaster });
    const props = await step('Planting trees…', () => buildProps());
    props.group.traverse((o) => { if (o.isInstancedMesh) o.layers.set(LAYER.MID); });
    this.outdoor.add(props.group);
    props.group.traverse((o) => { if (o.userData.lampHeads) this.env.lampMaterials.push(o.material); if (o.userData.bob) this.boats = o; });
    this.trafficLights = props.trafficLights;
    this.trafficLightHeads = props.trafficHeads;
    const trees = await step('Planting trees…', () => buildTrees(this.textures, this.medianTrees));
    trees.group.traverse((o) => { if (o.isInstancedMesh) o.layers.set(LAYER.MID); });
    this.outdoor.add(trees.group);
    this.treeWind = trees.uniforms;
    const plants = await step('Planting gardens…', () => buildPlants(this.textures));
    plants.group.traverse((o) => { if (o.isInstancedMesh) o.layers.set(LAYER.MID); });
    this.outdoor.add(plants.group);
    this.plantWind = plants.uniforms;
    // Colliders
    for (const c of this.layout.colliders) this.collision.add({ ...c });
    for (const c of props.colliders) this.collision.add(c);
    for (const c of trees.colliders) this.collision.add(c);
    for (const c of plants.colliders) this.collision.add(c);
    onProgress('City ready');
  }

  update(dt, focus) {
    this.env.update(dt, focus);
    this.engine.post?.setLook({ exposure: this.env.exposure, night: this.env.nightFactor });
    if (this.waterUniforms) this.waterUniforms.uTime.value += dt;
    if (this.treeWind) this.treeWind.uTime.value += dt;
    if (this.plantWind) this.plantWind.uTime.value += dt;
    this.water?.follow(this.engine.camera);
    if (this.ferris) {
      this.ferris.rotation.x += dt * 0.08;
      for (const c of this.ferris.children) if (c.userData.cabin !== undefined) c.rotation.x = -this.ferris.rotation.x;
    }
    for (const a of this.animated) a.rotation.y += dt;
    if (this.skilifts?.length) {
      this.liftT = (this.liftT || 0) + dt * 0.06;
      for (const cab of this.skilifts) {
        const { a, b, phase } = cab.userData.skilift;
        const t = Math.abs((((this.liftT + phase) % 2) - 1)); // ping-pong 0..1..0
        cab.position.lerpVectors(a, b, t);
      }
    }
    if (this.coasterCars?.length) {
      this.coasterT = (this.coasterT || 0) + dt * 0.045;
      for (const car of this.coasterCars) {
        const { curve, t0 } = car.userData.coaster;
        const t = (t0 + this.coasterT) % 1;
        car.position.copy(curve.getPointAt(t));
        car.lookAt(curve.getPointAt((t + 0.01) % 1));
      }
    }
  }

  setOutdoorVisible(v) { this.outdoor.visible = v; this.env.sky.mesh.visible = v; }
}
