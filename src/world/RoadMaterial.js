import * as THREE from 'three';

// Road surface: PBR asphalt (world-space UVs, two scales to hide tiling) plus lane markings
// drawn procedurally from the road's own coordinates, so they stay crisp at any distance:
//   uv.x = 0..1 across the road, uv.y = metres along it, roadInfo = (kind, width, median).
//   kind 0 highway: white edges, double yellow centre, dashed white lane lines
//   kind 1 main:    white edges, double yellow centre (or kerbed median)
//   kind 2 street:  dashed white centre line
//   kind 3 mountain: white edges, solid yellow centre
// Paint is worn with noise, darker tyre tracks run along each lane.
export function createRoadMaterial(tex) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
  mat.userData.unique = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tAR = { value: tex.ar };
    sh.uniforms.tN = { value: tex.n };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 roadInfo; attribute vec2 roadUv;
        varying vec4 vRoadInfo; varying vec2 vRoadUv; varying vec3 vRWPos;`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vRoadInfo = roadInfo; vRoadUv = roadUv; vRWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tAR; uniform sampler2D tN;
        varying vec4 vRoadInfo; varying vec2 vRoadUv; varying vec3 vRWPos;
        float rHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float rNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rHash(i), rHash(i + vec2(1, 0)), f.x), mix(rHash(i + vec2(0, 1)), rHash(i + vec2(1, 1)), f.x), f.y); }
        // anti-aliased stripe of half-width hw centred on c (in metres)
        float stripe(float x, float c, float hw) { float d = abs(x - c) - hw; float aa = fwidth(x) * 0.75 + 1e-4; return 1.0 - smoothstep(-aa, aa, d); }
        float dashes(float y, float on, float period) { float f = mod(y, period); float aa = fwidth(y) * 0.75 + 1e-4; return smoothstep(-aa, aa, f) * (1.0 - smoothstep(on - aa, on + aa, f)); }
        float roadPaintW; vec3 roadPaintC; float roadRough;`)
      .replace('#include <map_fragment>', `
        {
          float kind = floor(vRoadInfo.x + 0.5), W = vRoadInfo.y, hasMedian = vRoadInfo.z;
          float x = (vRoadUv.x - 0.5) * W, y = vRoadUv.y;
          vec2 wuv = vRWPos.xz / 3.2;
          vec4 a = mix(texture2D(tAR, wuv), texture2D(tAR, wuv * 0.27 + 0.5), 0.35);
          vec3 asph = a.rgb;
          roadRough = a.a;
          // tyre tracks: slightly darker, smoother bands along each lane
          float lanes = kind < 0.5 ? 2.0 : 1.0;
          float track = 0.0;
          for (float l = 0.0; l < 2.0; l++) {
            if (l >= lanes) break;
            float c = W * 0.25 + (lanes > 1.0 ? (l - 0.5) * W * 0.225 : 0.0);
            track += stripe(abs(x), c - 0.8, 0.35) + stripe(abs(x), c + 0.8, 0.35);
          }
          asph *= 1.0 - 0.12 * clamp(track, 0.0, 1.0);
          roadRough -= 0.08 * clamp(track, 0.0, 1.0);
          // markings
          float white = 0.0, yellow = 0.0;
          float edge = W * 0.5 - 0.35;
          if (kind < 0.5) { // highway
            white += stripe(abs(x), edge, 0.08);
            yellow += stripe(abs(x), 0.14, 0.06);
            white += stripe(abs(x), W * 0.25, 0.06) * dashes(y, 3.0, 12.0);
          } else if (kind < 1.5) { // main
            white += stripe(abs(x), edge, 0.08);
            yellow += stripe(abs(x), hasMedian > 0.5 ? 1.45 : 0.12, 0.06);
          } else if (kind < 2.5) { // street
            white += stripe(x, 0.0, 0.06) * dashes(y, 3.0, 9.0);
          } else { // mountain
            white += stripe(abs(x), edge, 0.07);
            yellow += stripe(x, 0.0, 0.06);
          }
          float wear = smoothstep(0.25, 0.75, rNoise(vRWPos.xz * 1.7) * 0.6 + rNoise(vRWPos.xz * 9.0) * 0.4);
          float paintMask = smoothstep(0.35, 0.95, vRoadInfo.w);
          white *= wear * paintMask; yellow *= wear * paintMask;
          roadPaintC = mix(vec3(0.78, 0.78, 0.74), vec3(0.83, 0.62, 0.14), clamp(yellow, 0.0, 1.0));
          roadPaintW = clamp(white + yellow, 0.0, 1.0) * 0.92;
          diffuseColor.rgb *= mix(asph, roadPaintC, roadPaintW);
          roadRough = mix(roadRough, 0.55, roadPaintW);
        }`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roadRough;')
      .replace('#include <normal_fragment_maps>', `{
          vec2 wuv = vRWPos.xz / 3.2;
          vec3 n = texture2D(tN, wuv).xyz * 2.0 - 1.0;
          n.xy *= 1.0 - roadPaintW * 0.8;
          vec3 wn = normalize(vec3(n.x, n.z, n.y)); // tangent frame = world X / Z on a flat road
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`);
  };
  mat.customProgramCacheKey = () => 'road-v1';
  return mat;
}

/** Plain PBR surface with world-space planar UVs (sidewalks, kerbs, medians). */
export function createPlanarMaterial(tex, scale, { vertical = false, tint = null } = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: tint || 0xffffff });
  mat.userData.unique = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tAR = { value: tex.ar };
    sh.uniforms.tN = { value: tex.n };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPWPos; varying vec3 vPWN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvPWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vPWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tAR; uniform sampler2D tN; varying vec3 vPWPos; varying vec3 vPWN; float pRough; vec2 pUv; vec3 pT, pB;`)
      .replace('#include <map_fragment>', `
        vec3 pN = normalize(vPWN);
        if (abs(pN.y) > 0.6) { pUv = vPWPos.xz / ${scale.toFixed(2)}; pT = vec3(1, 0, 0); pB = vec3(0, 0, 1); }
        else if (abs(pN.x) > abs(pN.z)) { pUv = vPWPos.zy / ${scale.toFixed(2)}; pT = vec3(0, 0, 1); pB = vec3(0, 1, 0); }
        else { pUv = vPWPos.xy / ${scale.toFixed(2)}; pT = vec3(1, 0, 0); pB = vec3(0, 1, 0); }
        vec4 pa = texture2D(tAR, pUv);
        diffuseColor.rgb *= pa.rgb; pRough = pa.a;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = pRough;')
      .replace('#include <normal_fragment_maps>', `{
          vec3 n = texture2D(tN, pUv).xyz * 2.0 - 1.0;
          vec3 wn = normalize(pT * n.x + pB * n.y + pN * n.z);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`);
  };
  mat.customProgramCacheKey = () => 'planar-' + scale;
  void vertical;
  return mat;
}
