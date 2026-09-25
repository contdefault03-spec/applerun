import * as THREE from 'three';

// Terrain splat material: a MeshStandardMaterial (so lighting, cascaded shadows, IBL and fog
// all still apply) whose albedo / roughness / normal come from six PBR ground layers in two
// texture arrays: 0 grass, 1 dirt, 2 sand, 3 rock, 4 snow, 5 paving.
// Per-vertex weights (splat0 = grass,dirt,sand; splat1 = rock,snow,paving) are computed from
// height, slope and district, then broken up with noise and sharpened in the shader. Rock is
// projected triplanar so cliffs don't stretch; every layer mixes two scales to hide tiling.
export const LAYER_SCALE = [3.2, 4.0, 4.5, 9.0, 6.0, 2.4]; // metres per texture repeat

export function createTerrainMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, vertexColors: true });
  mat.userData.unique = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tAR = { value: tex.ar };
    sh.uniforms.tN = { value: tex.n };
    sh.uniforms.uScale = { value: LAYER_SCALE };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 splat0; attribute vec3 splat1;
        varying vec3 vSplat0; varying vec3 vSplat1; varying vec3 vTWPos; varying vec3 vTWNrm;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vTWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTWNrm = normalize(mat3(modelMatrix) * objectNormal);
        vSplat0 = splat0; vSplat1 = splat1;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray tAR; uniform sampler2DArray tN; uniform float uScale[6];
        varying vec3 vSplat0; varying vec3 vSplat1; varying vec3 vTWPos; varying vec3 vTWNrm;
        vec3 terrainNrmW; float terrainRough;
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1, 0)), f.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), f.x), f.y); }
        vec4 sampleLayer(float layer, vec2 uv, float mixK) {
          vec4 a = texture(tAR, vec3(uv, layer));
          vec4 b = texture(tAR, vec3(uv * 0.29 + vec2(0.37, 0.71), layer));
          return mix(a, b, mixK);
        }`)
      .replace('#include <map_fragment>', `
        vec3 tN0 = normalize(vTWNrm);
        vec2 wp = vTWPos.xz;
        float w[6];
        w[0] = vSplat0.x; w[1] = vSplat0.y; w[2] = vSplat0.z; w[3] = vSplat1.x; w[4] = vSplat1.y; w[5] = vSplat1.z;
        float nA = tNoise(wp * 0.23), nB = tNoise(wp * 0.071 + 13.0), nC = tNoise(wp * 0.6 + 41.0);
        w[0] *= 0.55 + 0.9 * nA; w[1] *= 0.45 + 1.1 * (1.0 - nA) * nB; w[2] *= 0.7 + 0.6 * nC;
        w[3] *= 0.6 + 0.8 * nB; w[4] *= 0.7 + 0.6 * (1.0 - nC);
        float wsum = 0.0;
        for (int i = 0; i < 6; i++) { w[i] = pow(max(w[i], 0.0), 3.0); wsum += w[i]; }
        vec4 tAlb = vec4(0.0); vec3 tNrm = vec3(0.0);
        vec3 Tu = normalize(vec3(1.0, 0.0, 0.0) - tN0 * tN0.x);
        vec3 Tv = normalize(vec3(0.0, 0.0, 1.0) - tN0 * tN0.z);
        float mixK = 0.3 + 0.35 * nB;
        for (int i = 0; i < 6; i++) {
          float wi = w[i] / max(wsum, 1e-4);
          if (wi < 0.02) continue;
          float s = uScale[i];
          if (i == 3) {
            // rock: triplanar with whiteout normal blending
            vec3 bw = pow(abs(tN0), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
            vec3 p = vTWPos / s;
            vec4 ax = texture(tAR, vec3(p.zy, 3.0)), ay = sampleLayer(3.0, p.xz, mixK), az = texture(tAR, vec3(p.xy, 3.0));
            tAlb += (ax * bw.x + ay * bw.y + az * bw.z) * wi;
            vec3 nx = texture(tN, vec3(p.zy, 3.0)).xyz * 2.0 - 1.0;
            vec3 ny = texture(tN, vec3(p.xz, 3.0)).xyz * 2.0 - 1.0;
            vec3 nz = texture(tN, vec3(p.xy, 3.0)).xyz * 2.0 - 1.0;
            nx = vec3(nx.xy + tN0.zy, abs(nx.z) * tN0.x);
            ny = vec3(ny.xy + tN0.xz, abs(ny.z) * tN0.y);
            nz = vec3(nz.xy + tN0.xy, abs(nz.z) * tN0.z);
            tNrm += normalize(nx.zyx * bw.x + ny.xzy * bw.y + nz.xyz * bw.z) * wi;
          } else {
            vec2 uv = wp / s;
            tAlb += sampleLayer(float(i), uv, mixK) * wi;
            vec3 n = texture(tN, vec3(uv, float(i))).xyz * 2.0 - 1.0;
            tNrm += normalize(Tu * n.x + Tv * n.y + tN0 * n.z) * wi;
          }
        }
        // large-scale brightness variation so distant ground doesn't look uniform
        tAlb.rgb *= 0.86 + 0.28 * tNoise(wp * 0.013 + 7.0);
        terrainNrmW = normalize(tNrm + tN0 * 0.15);
        terrainRough = tAlb.a;
        diffuseColor.rgb *= tAlb.rgb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * terrainRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(terrainNrmW, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'terrain-splat-v1';
  return mat;
}
