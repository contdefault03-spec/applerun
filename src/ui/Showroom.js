import * as THREE from 'three';
import { enableVisibleLayers } from '../world/layers.js';
import { Animator } from '../characters/Animator.js';

// 3D character preview used by the character-select screen (rotating turntable).
export class Showroom {
  constructor(engine, factory) {
    this.engine = engine;
    this.factory = factory;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0d1320');
    this.scene.fog = new THREE.Fog('#0d1320', 8, 22);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    enableVisibleLayers(this.camera);
    const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(3, 5, 4); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const rim = new THREE.DirectionalLight('#ff8a5c', 1.6); rim.position.set(-4, 3, -3);
    const fill = new THREE.HemisphereLight('#9fb8ff', '#20242e', 0.9);
    this.scene.add(key, rim, fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), new THREE.MeshStandardMaterial({ color: '#1a2233', roughness: 0.4, metalness: 0.3 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(2.15, 2.25, 64), new THREE.MeshBasicMaterial({ color: '#ff5a36' }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
    this.ring = ring;
    this.scene.add(floor, ring);
    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.cache = new Map();
    this.current = null;
    this.t = 0;
    this.nextEmote = 3;
  }
  show(id) {
    if (this.current?.id === id) return;
    if (this.current) this.turntable.remove(this.current.char.root);
    let e = this.cache.get(id);
    if (!e) {
      const char = this.factory.create(id);
      char.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      e = { id, char, anim: new Animator(char) };
      this.cache.set(id, e);
    }
    this.current = e;
    this.turntable.add(e.char.root);
    this.ring.material.color.set(e.char.def.accent || '#ff5a36');
    this.nextEmote = 1.5;
    const h = e.char.height;
    this.camera.position.set(0, h * 0.62, 3.2 + h * 1.25);
    this.camera.lookAt(0, h * 0.52, 0);
  }
  update(dt) {
    this.t += dt;
    this.turntable.rotation.y += dt * 0.45;
    if (!this.current) return;
    this.nextEmote -= dt;
    if (this.nextEmote < 0) {
      const def = this.current.char.def;
      const emote = def.gorilla ? 'chestBeat' : def.idleStyle === 'flex' ? 'flex' : def.idleStyle === 'silly' ? 'dance' : def.idleStyle === 'bored' ? 'wave' : ['wave', 'taunt', 'celebrate'][Math.floor(Math.random() * 3)];
      this.current.anim.play(emote);
      this.nextEmote = 5 + Math.random() * 3;
    }
    this.current.anim.update(dt, { speed: 0 });
  }
  render() {
    const r = this.engine.renderer;
    this.camera.aspect = r.domElement.width / r.domElement.height;
    this.camera.updateProjectionMatrix();
    // the showroom renders directly (no post chain), so it tone-maps itself
    const tm = r.toneMapping;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.render(this.scene, this.camera);
    r.toneMapping = tm;
  }
}
