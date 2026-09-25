import * as THREE from 'three';
import { WEAPONS } from '../../shared/weapons.js';
import { weaponModel } from '../combat/WeaponModels.js';
import { SPECS, buildVehicle } from '../vehicles/VehicleModels.js';
import { VARIANTS } from '../npc/NPCManager.js';

// Loading-time warm-up so nothing compiles a shader or builds a model the first time it is
// used in play (first shot, first car, first NPC, first explosion…).
// Every model/effect that can appear later is put in front of the camera once, the whole scene
// is compiled with renderer.compile(), then one frame is rendered (which also builds the
// shadow-depth programs) while the loading screen still covers the canvas.
export async function prewarmScene(game) {
  const { renderer, scene, camera } = game.engine;
  const group = new THREE.Group();
  group.name = 'prewarm';
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd);
  group.position.copy(camera.position).addScaledVector(fwd, 12);
  const row = (obj, i, spacing = 1.5) => { obj.position.set((i % 8) * spacing - 6, 0, -Math.floor(i / 8) * spacing); group.add(obj); };
  let i = 0;
  for (const id of Object.keys(WEAPONS)) { const m = weaponModel(id); if (m) row(m, i++); }
  for (const type of Object.keys(SPECS)) { const v = buildVehicle(type, '#888888'); row(v.group || v, i++, 5); }
  const chars = ['max', 'ajan', 'rize', 'masked', 'lucky', 'dex', 'nova'];
  for (const [role, n] of Object.entries(VARIANTS)) for (let k = 0; k < n; k++) chars.push(`npc:${role}:${k}`);
  for (const key of chars) { const c = game.factory.create(key); row(c.root, i++, 1.2); }
  // first-person arms + held weapon
  const vm = game.weapons?.viewModel;
  // pooled effects are hidden until used: show one of each kind for the compile
  const fx = game.fx;
  const shown = [];
  const show = (o) => { if (o && !o.visible) { o.visible = true; shown.push(o); } };
  const sprites = fx.pool.slice(-2);
  sprites[0].material.map = fx.tex.fire; sprites[0].material.blending = THREE.AdditiveBlending;
  sprites[1].material.map = fx.tex.soft; sprites[1].material.blending = THREE.NormalBlending;
  for (const s of sprites) { s.position.copy(group.position); show(s); }
  show(fx.tracerPool[0]);
  const decal = new THREE.Mesh(fx.decalGeo, fx.decalMat); decal.position.copy(group.position); scene.add(decal);
  if (vm) show(vm);
  scene.add(group);
  await tick();
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
    renderer.render(scene, camera);
  } finally {
    scene.remove(group);
    scene.remove(decal);
    for (const o of shown) o.visible = false;
    for (const s of sprites) s.material.blending = THREE.NormalBlending;
  }
  return renderer.info.programs?.length || 0;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
