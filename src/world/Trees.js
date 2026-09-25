import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getLayout } from '../../shared/map/layout.js';
import { heightAt } from '../../shared/map/terrain.js';
import { createPlanarMaterial } from './RoadMaterial.js';

// Realistic-ish trees: bark-textured trunks + alpha-tested foliage "cross cards" cut from the
// foliage atlas (tools/gen-textures.mjs), with a wind sway applied in the canopy vertex shader.
// Cheap (a handful of quads per tree) but reads well at driving speed; three species, instanced.

// UV rects into foliage_ca.ktx2 (1024x1024, no vertical flip: v matches image row / S).
const UV = {
  broad: [0, 0, 0.5, 0.5],     // big leaf-cluster blob
  pine: [0, 0.5, 0.5, 1],      // horizontal pine branch
  palm: [0.5, 0.5, 1.0, 0.75], // frond strip (top half of the br quadrant)
};

function hash(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }

/** One quad, base pivot at local origin, extending +Y by h, centred on X, with a wind-sway
 * weight (0 at the base, 1 at the tip) baked in as a vertex attribute. */
function card(w, h, uv, rotY = 0, baseY = 0, tiltX = 0) {
  const [u0, v0, u1, v1] = uv;
  const pos = new Float32Array([-w / 2, 0, 0, w / 2, 0, 0, w / 2, h, 0, -w / 2, h, 0]);
  const uvs = new Float32Array([u0, v1, u1, v1, u1, v0, u0, v0]);
  const sway = new Float32Array([0, 0, 1, 1]);
  const idx = [0, 1, 2, 0, 2, 3];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setAttribute('swayW', new THREE.BufferAttribute(sway, 1));
  g.setIndex(idx);
  g.rotateX(tiltX);
  g.rotateY(rotY);
  g.translate(0, baseY, 0);
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(4 * 3).fill(1), 3));
  return g;
}

/** A "cross card": n quads fanned evenly around Y, each showing the same atlas cell — cheap
 * volumetric-looking foliage blob from any angle. */
function crossCluster(w, h, uv, baseY, n = 3) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(card(w, h, uv, (i / n) * Math.PI, baseY));
  return mergeGeometries(parts);
}

function canopyMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.ca, normalMap: tex.n, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true,
  });
  mat.userData.unique = true;
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float swayW; uniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 iw = instanceMatrix[3].xz;
        #else
          vec2 iw = vec2(0.0);
        #endif
        float swPhase = dot(iw, vec2(0.15, 0.11));
        float sw = sin(uTime * 1.6 + swPhase) * 0.6 + sin(uTime * 3.1 + swPhase * 1.7) * 0.4;
        transformed.x += sw * swayW * 0.35;
        transformed.z += cos(uTime * 1.3 + swPhase) * swayW * 0.22;`);
  };
  mat.customProgramCacheKey = () => 'canopy-v1';
  mat.userData.windUniforms = uniforms;
  return mat;
}

function instanced(geo, mat, items, place, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const o = new THREE.Object3D();
  items.forEach((it, i) => { place(o, it, i); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
  m.count = items.length;
  m.castShadow = shadow; m.receiveShadow = true;
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

function tintInstances(mesh, items, base = 0.85, range = 0.3) {
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
  const c = new THREE.Color();
  items.forEach((it, i) => { const k = base + hash(it.x, it.z) * range; c.setRGB(k, k * (0.95 + hash(it.z, it.x) * 0.1), k * 0.92).toArray(mesh.instanceColor.array, i * 3); });
  mesh.instanceColor.needsUpdate = true;
}

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
  const canopyMat = canopyMaterial({ ca: foliageCa, n: foliageN });
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
