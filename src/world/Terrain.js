import * as THREE from 'three';
import { getHeightfield, heightAt, HF_BOUNDS, outsideDistance, SEA_FLOOR } from '../../shared/map/terrain.js';
import { WORLD, WATER_LEVEL, districtAt, getLayout, toPx, shoreXpx } from '../../shared/map/layout.js';
import { groundDetailTexture } from './textures.js';
import { pointInPoly } from '../../shared/map/geom.js';

// Island terrain: the heightfield is split into square chunks, each a THREE.LOD with three
// detail levels (frustum culled per chunk). Chunks entirely below the sea are skipped.
// Skirts hang below every chunk edge to hide cracks between neighbouring LOD levels.
const CHUNK = 230;
const LODS = [{ step: 4, dist: 0 }, { step: 10, dist: 420 }, { step: 23, dist: 1000 }];

function slopeAt(x, z) {
  const hx = heightAt(x + 2, z) - heightAt(x - 2, z), hz = heightAt(x, z + 2) - heightAt(x, z - 2);
  return Math.hypot(hx, hz) / 4;
}

function makeColorFn() {
  const L = getLayout();
  const lm = L.landmarks;
  const inRect = (x, z, b, pad = 0) => Math.abs(x - b.x) < b.hx + pad && Math.abs(z - b.z) < b.hz + pad;
  const farm = [lm.farm1, lm.farm2, lm.field];
  const c = new THREE.Color();
  return (x, z, h, out, o) => {
    const slope = slopeAt(x, z);
    const n = (Math.sin(x * 0.13) * Math.cos(z * 0.11) + Math.sin(x * 0.041 + z * 0.057)) * 0.5;
    const outside = outsideDistance(x, z) > 0;
    if (h < WATER_LEVEL - 0.2) c.setRGB(0.62, 0.57, 0.45).multiplyScalar(h < -6 ? 0.7 : 0.9); // sea floor
    else if (h > 118) c.setRGB(0.95, 0.96, 0.98); // snow
    else if (slope > 0.75 || h > 85) c.setRGB(0.47, 0.43, 0.38).multiplyScalar(0.9 + n * 0.12); // rock / cliff
    else if (outside) {
      if (h < 1.8) c.setRGB(0.84, 0.76, 0.58).multiplyScalar(0.95 + n * 0.05); // island beaches
      else if (h < 3) c.setRGB(0.6, 0.6, 0.4).multiplyScalar(0.95 + n * 0.05); // dune grass
      else c.setRGB(0.3 + (h > 30 ? 0.08 : 0), 0.5 - (h > 30 ? 0.06 : 0), 0.22).multiplyScalar(0.85 + n * 0.15);
    } else {
      const [px, py] = toPx(x, z);
      const dist = districtAt(x, z).id;
      const shore = px - shoreXpx(py);
      if (shore < 44 || h < 0.25 && shore < 60) c.setRGB(0.93, 0.85, 0.64).multiplyScalar(0.95 + n * 0.05); // sand
      else if (farm.some((b) => inRect(x, z, b))) c.setRGB(0.55, 0.43, 0.27).multiplyScalar(0.92 + 0.08 * Math.sin(x * 0.9));
      else if (['downtown', 'midtown'].includes(dist) && !inRect(x, z, lm.plazaPark) && !inRect(x, z, lm.fountainPlaza)) c.setRGB(0.62, 0.61, 0.58);
      else if (dist === 'industrial' || inRect(x, z, lm.containerYard, 6)) c.setRGB(0.5, 0.5, 0.48);
      else if (inRect(x, z, lm.parkingStadium, 2) || inRect(x, z, lm.parkingArena, 2)) c.setRGB(0.3, 0.31, 0.32);
      else if (dist === 'eastside') c.setRGB(0.45, 0.5, 0.3).multiplyScalar(0.9 + n * 0.1); // patchy dry grass
      else {
        const dry = dist === 'mountain' ? 0.25 : dist === 'outskirts' ? 0.12 : 0;
        c.setRGB(0.3 + dry * 0.3, 0.52 - dry * 0.12, 0.22).multiplyScalar(0.85 + n * 0.15);
      }
    }
    out[o] = c.r; out[o + 1] = c.g; out[o + 2] = c.b;
  };
}

// One chunk at one detail level: (n+1)^2 grid + a skirt ring hanging 6 m down.
function chunkGeometry(x0, z0, size, step, colorFn) {
  const n = Math.round(size / step);
  const st = size / n;
  const ring = 4 * n;
  const count = (n + 1) * (n + 1) + ring;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const put = (k, x, z, y) => {
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    const e = 1.5;
    const nx = heightAt(x - e, z) - heightAt(x + e, z), nz = heightAt(x, z - e) - heightAt(x, z + e);
    const l = Math.hypot(nx, 2 * e, nz);
    nor[k * 3] = nx / l; nor[k * 3 + 1] = (2 * e) / l; nor[k * 3 + 2] = nz / l;
    uv[k * 2] = x / 5; uv[k * 2 + 1] = z / 5;
  };
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = j * (n + 1) + i, x = x0 + i * st, z = z0 + j * st, h = heightAt(x, z);
    put(k, x, z, h);
    colorFn(x, z, h, col, k * 3);
  }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // skirt: walk the border, duplicate each vertex 6 m lower
  const border = [];
  for (let i = 0; i < n; i++) border.push(i);                         // top edge (j=0)
  for (let j = 0; j < n; j++) border.push(j * (n + 1) + n);           // right edge
  for (let i = n; i > 0; i--) border.push(n * (n + 1) + i);           // bottom edge
  for (let j = n; j > 0; j--) border.push(j * (n + 1));               // left edge
  const base = (n + 1) * (n + 1);
  border.forEach((src, s) => {
    const k = base + s;
    pos[k * 3] = pos[src * 3]; pos[k * 3 + 1] = pos[src * 3 + 1] - 6; pos[k * 3 + 2] = pos[src * 3 + 2];
    for (let q = 0; q < 3; q++) { nor[k * 3 + q] = nor[src * 3 + q]; col[k * 3 + q] = col[src * 3 + q]; }
    uv[k * 2] = uv[src * 2]; uv[k * 2 + 1] = uv[src * 2 + 1];
  });
  for (let s = 0; s < ring; s++) {
    const a = border[s], b = border[(s + 1) % ring], a2 = base + s, b2 = base + ((s + 1) % ring);
    idx.push(a, b, a2, b, b2, a2, a, a2, b, b, a2, b2); // both windings (skirt seen from either side)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

export function buildTerrain(quality = 'high') {
  getHeightfield();
  const tex = groundDetailTexture();
  tex.repeat.set(1, 1);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.97, metalness: 0 });
  const colorFn = makeColorFn();
  const group = new THREE.Group();
  group.name = 'terrain';
  const B = HF_BOUNDS;
  const lods = quality === 'low' ? LODS.map((l) => ({ ...l, step: l.step * 1.5 })) : LODS;
  for (let z0 = B.minZ; z0 < B.maxZ - 1; z0 += CHUNK) {
    for (let x0 = B.minX; x0 < B.maxX - 1; x0 += CHUNK) {
      const sx = Math.min(CHUNK, B.maxX - x0), sz = Math.min(CHUNK, B.maxZ - z0);
      const size = Math.min(sx, sz);
      // skip chunks that are entirely deep sea floor
      let maxH = -Infinity;
      for (let z = z0; z <= z0 + sz; z += 10) for (let x = x0; x <= x0 + sx; x += 10) maxH = Math.max(maxH, heightAt(x, z));
      if (maxH < SEA_FLOOR + 3) continue;
      // non-square border chunks are covered by several square tiles
      for (let tz = z0; tz < z0 + sz - 0.5; tz += size) for (let tx = x0; tx < x0 + sx - 0.5; tx += size) {
        const lod = new THREE.LOD();
        for (const l of lods) {
          const m = new THREE.Mesh(chunkGeometry(tx, tz, size, l.step, colorFn), mat);
          m.receiveShadow = true;
          lod.addLevel(m, l.dist);
        }
        lod.autoUpdate = true;
        group.add(lod);
      }
    }
  }
  group.userData.material = mat;
  return group;
}

// Endless ocean: a camera-following plane (world-space waves, so moving it is invisible)
// that reads the terrain heightfield for shallow-water colour, see-through shallows and surf,
// and fades into the fog colour towards the horizon.
export function buildWater(far = 1600) {
  const hf = getHeightfield();
  const half = new Uint16Array(hf.nx * hf.nz);
  for (let k = 0; k < half.length; k++) half[k] = THREE.DataUtils.toHalfFloat(hf.h[k]);
  const htex = new THREE.DataTexture(half, hf.nx, hf.nz, THREE.RedFormat, THREE.HalfFloatType);
  htex.magFilter = htex.minFilter = THREE.LinearFilter;
  htex.wrapS = htex.wrapT = THREE.ClampToEdgeWrapping;
  htex.needsUpdate = true;
  const geo = new THREE.CircleGeometry(far * 0.98, 96);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uDeep: { value: new THREE.Color('#0a3552') },
    uMid: { value: new THREE.Color('#12708c') },
    uShallow: { value: new THREE.Color('#3cc7c2') },
    uSky: { value: new THREE.Color('#9cc7e6') },
    uNight: { value: 0 },
    uHeight: { value: htex },
    uHB: { value: new THREE.Vector4(hf.minX, hf.minZ, (hf.nx - 1) * hf.cell, (hf.nz - 1) * hf.cell) },
    uWater: { value: WATER_LEVEL },
    uFar: { value: far },
    fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0.0006 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    fog: true,
    depthWrite: false,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uDeep; uniform vec3 uMid; uniform vec3 uShallow; uniform vec3 uSky; uniform float uNight;
      uniform sampler2D uHeight; uniform vec4 uHB; uniform float uWater; uniform float uFar;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      float terrainH(vec2 xz) {
        vec2 uv = (xz - uHB.xy) / uHB.zw;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -18.0;
        return texture2D(uHeight, uv).r;
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
      }
      vec3 waveNormal(vec2 p, float calm) {
        float t = uTime;
        vec2 g = vec2(0.0);
        g += vec2(cos(p.x*0.21+t*0.9), -sin(p.y*0.19+t*0.7))*0.35;
        g += vec2(cos(p.x*0.53-p.y*0.31+t*1.6), cos(p.y*0.47+p.x*0.23-t*1.3))*0.18;
        g += vec2(sin(p.x*1.3+p.y*0.9+t*2.4), cos(p.y*1.1-p.x*0.7+t*2.1))*0.07;
        g += vec2(sin(p.x*3.1-p.y*2.3+t*3.7), cos(p.y*2.9+p.x*1.7-t*3.3))*0.03;
        return normalize(vec3(-g.x * calm, 1.0, -g.y * calm));
      }
      void main() {
        float depth = uWater - terrainH(vWorld.xz);
        if (depth < -0.02) discard;
        float dist = length(cameraPosition.xz - vWorld.xz);
        float calm = mix(0.35, 1.0, smoothstep(0.0, 6.0, depth)) * mix(1.0, 0.45, smoothstep(250.0, 900.0, dist));
        vec3 n = waveNormal(vWorld.xz, calm);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);
        vec3 base = mix(uShallow, uMid, smoothstep(0.3, 4.0, depth));
        base = mix(base, uDeep, smoothstep(4.0, 16.0, depth));
        vec3 col = mix(base, uSky, 0.12 + fres * 0.6);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(n, H), 0.0), 220.0) * (1.0 - uNight);
        col += spec * vec3(1.0, 0.95, 0.85) * 1.8;
        // surf: foam hugging the shoreline plus waves rolling in
        float shore = 1.0 - smoothstep(0.0, 0.7, depth);
        float roll = smoothstep(0.8, 1.0, sin(depth * 7.0 - uTime * 1.6 + vnoise(vWorld.xz * 0.15) * 3.0)) * (1.0 - smoothstep(0.2, 1.1, depth));
        float foam = clamp(shore * (0.5 + 0.5 * vnoise(vWorld.xz * 0.9 + uTime * 0.4)) + roll * 0.5, 0.0, 1.0);
        col = mix(col, vec3(0.95, 0.97, 0.98), foam * 0.85);
        col *= mix(1.0, 0.22, uNight);
        float alpha = mix(0.45, 0.93, smoothstep(0.0, 3.0, depth));
        alpha = max(alpha, foam * 0.9);
        gl_FragColor = vec4(col, alpha);
        #include <fog_fragment>
        // horizon: melt into the fog colour before the plane ends
        float hz = smoothstep(uFar * 0.4, uFar * 0.9, dist);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, hz);
        gl_FragColor.a = mix(gl_FragColor.a, 1.0, hz);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.name = 'water';
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  // follow the camera (snapped to a coarse grid; waves are computed in world space)
  const follow = (cam) => { mesh.position.x = Math.round(cam.position.x / 16) * 16; mesh.position.z = Math.round(cam.position.z / 16) * 16; };
  return { mesh, uniforms, follow };
}

export { pointInPoly, WORLD };
