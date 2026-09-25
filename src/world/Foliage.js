import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Shared building blocks for anything drawn from the foliage atlas (tools/gen-textures.mjs
// foliageAtlas): trees, bushes, hedges, flower beds, grass tufts. Alpha-tested cross cards with
// a wind sway baked into the vertex shader, driven by a shared uTime uniform.

// UV rects into foliage_ca.ktx2 (1024x1024, no vertical flip: v matches image row / S).
export const UV = {
  broad: [0, 0, 0.5, 0.5],       // big leaf-cluster blob (broadleaf trees)
  smallLeaf: [0.5, 0, 1, 0.5],   // small-leaf cluster (bushes / hedges)
  pine: [0, 0.5, 0.5, 1],        // horizontal pine branch
  palm: [0.5, 0.5, 1.0, 0.75],   // frond strip (top half of the br quadrant)
  grass: [0.5, 0.75, 0.75, 1.0], // grass tuft
  flower: [0.72, 0.72, 1.0, 1.0], // flowers
};

export function hash(x, z) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }

/** One quad, base pivot at local origin, extending +Y by h, centred on X, with a wind-sway
 * weight (0 at the base, 1 at the tip) baked in as a vertex attribute. */
export function card(w, h, uv, rotY = 0, baseY = 0, tiltX = 0) {
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
export function crossCluster(w, h, uv, baseY, n = 3) {
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(card(w, h, uv, (i / n) * Math.PI, baseY));
  return mergeGeometries(parts);
}

/** MeshStandardMaterial for foliage cards: alpha-tested, double-sided, vertex-colour tinted,
 * swaying in the wind (uniforms.uTime should be incremented from the caller's update loop). */
export function foliageMaterial(ca, n, { swayAmp = 0.35 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map: ca, normalMap: n, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true,
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
        transformed.x += sw * swayW * ${swayAmp.toFixed(2)};
        transformed.z += cos(uTime * 1.3 + swPhase) * swayW * ${(swayAmp * 0.63).toFixed(2)};`);
  };
  mat.customProgramCacheKey = () => `foliage-v1-${swayAmp}`;
  mat.userData.windUniforms = uniforms;
  return mat;
}

export function instanced(geo, mat, items, place, shadow = true) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const o = new THREE.Object3D();
  items.forEach((it, i) => { place(o, it, i); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
  m.count = items.length;
  m.castShadow = shadow; m.receiveShadow = true;
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  return m;
}

export function tintInstances(mesh, items, base = 0.85, range = 0.3) {
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
  const c = new THREE.Color();
  items.forEach((it, i) => { const k = base + hash(it.x, it.z) * range; c.setRGB(k, k * (0.95 + hash(it.z, it.x) * 0.1), k * 0.92).toArray(mesh.instanceColor.array, i * 3); });
  mesh.instanceColor.needsUpdate = true;
}
