import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Collapses a static hierarchy into a few merged meshes: one per material and per spatial
// cell (so frustum culling and shadow cascades still skip far-away parts). Objects that
// animate or are looked up at runtime are left untouched when `keep(obj)` returns true.
// Plain coloured standard materials are folded into one shared vertex-coloured material per
// (roughness, metalness, side) so parts that only differ in colour still merge.
const sharedMats = new Map();
function materialFor(mat) {
  const plain = mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial && !mat.map && !mat.vertexColors && !mat.transparent
    && !mat.alphaMap && !mat.normalMap && !mat.emissiveMap && mat.emissive.getHex() === 0 && !mat.userData.unique;
  if (plain) {
    const k = `vc|${mat.roughness.toFixed(2)}|${mat.metalness.toFixed(2)}|${mat.side}|${mat.flatShading}`;
    let m = sharedMats.get(k);
    if (!m) sharedMats.set(k, (m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: mat.roughness, metalness: mat.metalness, side: mat.side, flatShading: mat.flatShading })));
    return { mat: m, bake: mat.color };
  }
  const k = [mat.type, mat.color?.getHex(), mat.emissive?.getHex(), mat.emissiveIntensity, mat.roughness, mat.metalness, mat.map?.uuid, mat.emissiveMap?.uuid,
    mat.transparent, mat.opacity, mat.side, mat.vertexColors, mat.alphaTest, mat.polygonOffset, mat.polygonOffsetFactor, mat.userData.unique ? mat.uuid : ''].join('|');
  let m = sharedMats.get(k);
  if (!m) sharedMats.set(k, (m = mat));
  return { mat: m, bake: null };
}

export function mergeStatic(root, { cell = 160, keep = () => false } = {}) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const victims = [];
  const skip = new Set();
  root.traverse((o) => {
    if (o === root) return;
    if (skip.has(o.parent) || keep(o)) { skip.add(o); return; }
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.visible) return;
    if (o.material.transparent && o.material.opacity < 1 && o.renderOrder) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.applyMatrix4(m);
    if (m.determinant() < 0) { // mirrored parts: flip winding back
      const p = geo.attributes.position.array;
      for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; }
    }
    const { mat, bake } = materialFor(o.material);
    if (bake) {
      geo.deleteAttribute('uv');
      const n = geo.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = bake.r; col[i * 3 + 1] = bake.g; col[i * 3 + 2] = bake.b; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    if (mat.vertexColors && !geo.attributes.color) return; // needs per-vertex colour it doesn't have
    const c = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const sig = Object.keys(geo.attributes).sort().join(',');
    const key = `${mat.uuid}|${o.castShadow ? 1 : 0}${o.receiveShadow ? 1 : 0}|${sig}|${Math.floor(c.x / cell)},${Math.floor(c.z / cell)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, cast: o.castShadow, recv: o.receiveShadow, geos: [], renderOrder: o.renderOrder }));
    b.geos.push(geo);
    victims.push(o);
  });
  for (const o of victims) {
    o.removeFromParent();
    if (o.children.length) for (const ch of [...o.children]) { // re-parent kept children in place
      if (skip.has(ch)) { ch.applyMatrix4(o.matrixWorld); root.attach(ch); }
    }
  }
  let merged = 0;
  for (const b of buckets.values()) {
    const g = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    if (!g) continue;
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, b.mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = b.recv; mesh.renderOrder = b.renderOrder;
    mesh.matrixAutoUpdate = false;
    root.add(mesh);
    merged++;
  }
  return { before: victims.length, after: merged };
}

// Splits one big merged mesh into per-cell meshes (triangles bucketed by centroid) so each
// piece has a tight bounding sphere for frustum / shadow-cascade culling.
export function splitByCells(mesh, cell = 200) {
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const names = Object.keys(src.attributes);
  const pos = src.attributes.position.array;
  const tris = pos.length / 9;
  const cells = new Map();
  for (let t = 0; t < tris; t++) {
    const cx = (pos[t * 9] + pos[t * 9 + 3] + pos[t * 9 + 6]) / 3, cz = (pos[t * 9 + 2] + pos[t * 9 + 5] + pos[t * 9 + 8]) / 3;
    const k = `${Math.floor(cx / cell)},${Math.floor(cz / cell)}`;
    let a = cells.get(k); if (!a) cells.set(k, (a = [])); a.push(t);
  }
  const out = [];
  for (const list of cells.values()) {
    const g = new THREE.BufferGeometry();
    for (const n of names) {
      const at = src.attributes[n], sz = at.itemSize, arr = new at.array.constructor(list.length * 3 * sz);
      list.forEach((t, i) => arr.set(at.array.subarray(t * 3 * sz, t * 3 * sz + 3 * sz), i * 3 * sz));
      g.setAttribute(n, new THREE.BufferAttribute(arr, sz, at.normalized));
    }
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mesh.material);
    m.castShadow = mesh.castShadow; m.receiveShadow = mesh.receiveShadow; m.name = mesh.name; m.renderOrder = mesh.renderOrder;
    out.push(m);
  }
  return out;
}
