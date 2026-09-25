import * as THREE from 'three';
import { getLayout } from '../../shared/map/layout.js';
import { heightAt } from '../../shared/map/terrain.js';
import { UV, crossCluster, foliageMaterial, instanced, tintInstances } from './Foliage.js';

// Bushes/hedges around house gardens, plus flower and grass-tuft patches in parks — all cards
// from the same foliage atlas as the trees (src/world/Trees.js), same wind-sway shader, much
// smaller. Positions come from `L.props.plants` (shared/map/layout.js).
export async function buildPlants(textures) {
  const L = getLayout();
  const items = L.props.plants || [];
  const group = new THREE.Group();
  group.name = 'plants';
  if (!items.length) return { group, colliders: [], uniforms: { uTime: { value: 0 } } };
  const y = (x, z) => heightAt(x, z);
  const [foliageCa, foliageN] = await Promise.all([
    textures.load('foliage_ca'), textures.load('foliage_n', { srgb: false }),
  ]);
  const mat = foliageMaterial(foliageCa, foliageN, { swayAmp: 0.14 });
  const uniforms = mat.userData.windUniforms;

  const bushGeo = crossCluster(1.1, 0.85, UV.smallLeaf, 0, 3);
  const flowerGeo = crossCluster(0.55, 0.4, UV.flower, 0, 2);
  const grassGeo = crossCluster(0.7, 0.45, UV.grass, 0, 2);

  const groups = { bush: [], flower: [], grass: [] };
  for (const p of items) groups[p.kind]?.push({ ...p, y: y(p.x, p.z) });
  const place = (o, p) => { o.position.set(p.x, p.y, p.z); o.rotation.set(0, p.r, 0); o.scale.setScalar(p.s); };

  const colliders = [];
  if (groups.bush.length) {
    const m = instanced(bushGeo, mat, groups.bush, place, false);
    tintInstances(m, groups.bush, 0.75, 0.3);
    group.add(m);
    for (const b of groups.bush) colliders.push({ kind: 'small', x: b.x, z: b.z, hx: 0.5 * b.s, hz: 0.5 * b.s, rot: 0, y0: b.y - 1, y1: b.y + 0.8 * b.s, walk: true });
  }
  if (groups.flower.length) { const m = instanced(flowerGeo, mat, groups.flower, place, false); tintInstances(m, groups.flower, 0.85, 0.3); group.add(m); }
  if (groups.grass.length) { const m = instanced(grassGeo, mat, groups.grass, place, false); tintInstances(m, groups.grass, 0.8, 0.25); group.add(m); }

  return { group, colliders, uniforms };
}
