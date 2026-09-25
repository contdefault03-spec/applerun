import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getLayout } from '../../shared/map/layout.js';
import { heightAt } from '../../shared/map/terrain.js';
import { createPlanarMaterial } from './RoadMaterial.js';
import { UV, card, crossCluster, foliageMaterial, instanced, tintInstances, hash } from './Foliage.js';

// Realistic-ish trees: bark-textured trunks + alpha-tested foliage "cross cards" cut from the
// foliage atlas (tools/gen-textures.mjs), with a wind sway applied in the canopy vertex shader.
// Cheap (a handful of quads per tree) but reads well at driving speed; three species, instanced.

export async function buildTrees(textures, medianTrees = []) {
  const L = getLayout();
  const P = L.props;
  const group = new THREE.Group();
  group.name = 'trees';
  const colliders = [];
  const y = (x, z) => heightAt(x, z);
  const [bark, foliageCa, foliageN] = await Promise.all([
    textures.material('bark'), textures.load('foliage_ca'), textures.load('foliage_n', { srgb: false }),
  ]);
  const barkMat = createPlanarMaterial(bark, 1.4);
  const canopyMat = foliageMaterial(foliageCa, foliageN);
  const uniforms = canopyMat.userData.windUniforms;

  // --- Broadleaf ---
  const broadTrunk = new THREE.CylinderGeometry(0.16, 0.26, 2.6, 6);
  broadTrunk.translate(0, 1.3, 0);
  const broadCanopy = mergeGeometries([
    crossCluster(4.2, 3.4, UV.broad, 2.1, 3),
    crossCluster(2.6, 2.2, UV.broad, 3.6, 3),
  ]);

  // --- Pine ---
  const pineTrunk = new THREE.CylinderGeometry(0.14, 0.24, 3, 6);
  pineTrunk.translate(0, 1.5, 0);
  const pineCanopy = mergeGeometries([
    crossCluster(3.4, 2.4, UV.pine, 1.6, 4),
    crossCluster(2.6, 2.0, UV.pine, 3.3, 4),
    crossCluster(1.8, 1.6, UV.pine, 4.9, 4),
  ]);

  const trees = P.trees;
  const broadItems = [], pineItems = [];
  for (const t of trees) {
    const h = y(t.x, t.z);
    (h > 25 || t.v > 0.7 ? pineItems : broadItems).push({ ...t, y: h });
    colliders.push({ kind: 'tree', x: t.x, z: t.z, hx: 0.35, hz: 0.35, rot: 0, y0: h - 1, y1: h + 4 });
  }
  // boulevard/median trees from Roads.js: smaller broadleaf, no extra colliders (the median
  // strip itself already has one)
  for (const m of medianTrees) broadItems.push({ x: m.x, z: m.z, y: m.y, r: hash(m.x, m.z) * Math.PI * 2, s: 0.72 + hash(m.z, m.x) * 0.12 });
  const placeTree = (o, t) => { o.position.set(t.x, t.y - 0.1, t.z); o.rotation.set(0, t.r, 0); o.scale.setScalar(t.s); };
  const broadTrunkMesh = instanced(broadTrunk, barkMat, broadItems, placeTree);
  const broadCanopyMesh = instanced(broadCanopy, canopyMat, broadItems, placeTree);
  tintInstances(broadCanopyMesh, broadItems);
  const pineTrunkMesh = instanced(pineTrunk, barkMat, pineItems, placeTree);
  const pineCanopyMesh = instanced(pineCanopy, canopyMat, pineItems, placeTree);
  tintInstances(pineCanopyMesh, pineItems, 0.8, 0.2);
  group.add(broadTrunkMesh, broadCanopyMesh, pineTrunkMesh, pineCanopyMesh);

  // --- Palms ---
  const palmParts = [];
  for (let i = 0; i < 6; i++) palmParts.push(new THREE.CylinderGeometry(0.2 - i * 0.015, 0.24 - i * 0.015, 1.3, 6).translate(Math.sin(i * 0.4) * 0.3 * i * 0.25, 0.65 + i * 1.25, 0));
  const palmTrunk = mergeGeometries(palmParts);
  const frondParts = [];
  for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; frondParts.push(card(3.6, 1.1, UV.palm, a, 0, 0.55).translate(Math.cos(a) * 0.3, 7.3, Math.sin(a) * 0.3)); }
  const palmFronds = mergeGeometries(frondParts);
  const palmItems = P.palms.map((t) => ({ ...t, y: y(t.x, t.z) }));
  const palmTrunkMesh = instanced(palmTrunk, barkMat, palmItems, placeTree);
  const palmFrondMesh = instanced(palmFronds, canopyMat, palmItems, placeTree);
  tintInstances(palmFrondMesh, palmItems, 0.85, 0.25);
  group.add(palmTrunkMesh, palmFrondMesh);
  for (const t of P.palms) colliders.push({ kind: 'tree', x: t.x, z: t.z, hx: 0.3, hz: 0.3, rot: 0, y0: -2, y1: y(t.x, t.z) + 6 });

  return { group, colliders, uniforms };
}
