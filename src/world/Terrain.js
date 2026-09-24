import * as THREE from 'three';
import { getHeightfield, heightAt } from '../../shared/map/terrain.js';
import { WORLD, WATER_LEVEL, districtAt, getLayout, toPx, shoreXpx } from '../../shared/map/layout.js';
import { groundDetailTexture } from './textures.js';
import { pointInPoly } from '../../shared/map/geom.js';

// Terrain mesh (vertex-coloured by district / height / slope) + animated water.
export function buildTerrain(quality = 'high') {
  getHeightfield();
  const step = quality === 'low' ? 6 : 4;
  const w = WORLD.maxX - WORLD.minX + 240, d = WORLD.maxZ - WORLD.minZ + 240; // extend beyond map
  const nx = Math.round(w / step), nz = Math.round(d / step);
  const geo = new THREE.PlaneGeometry(w, d, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const L = getLayout();
  const lm = L.landmarks;
  const inRect = (x, z, b, pad = 0) => Math.abs(x - b.x) < b.hx + pad && Math.abs(z - b.z) < b.hz + pad;
  const farm = [lm.farm1, lm.farm2, lm.field];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let h;
    if (x < WORLD.minX || x > WORLD.maxX || z < WORLD.minZ || z > WORLD.maxZ) {
      // outside map: ocean to the west/south-west, hills elsewhere
      const [px] = toPx(x, z);
      h = px < 120 ? -8 : heightAt(Math.max(WORLD.minX, Math.min(WORLD.maxX, x)), Math.max(WORLD.minZ, Math.min(WORLD.maxZ, z))) + 2;
    } else h = heightAt(x, z);
    pos.setY(i, h);
    // slope
    const hx = heightAt(x + 2, z) - heightAt(x - 2, z), hz = heightAt(x, z + 2) - heightAt(x, z - 2);
    const slope = Math.hypot(hx, hz) / 4;
    const [px, py] = toPx(x, z);
    const dist = districtAt(x, z).id;
    const shore = px - shoreXpx(py);
    const n = (Math.sin(x * 0.13) * Math.cos(z * 0.11) + Math.sin(x * 0.041 + z * 0.057)) * 0.5;
    if (h < WATER_LEVEL - 0.2) c.setRGB(0.55, 0.52, 0.42); // sea floor
    else if (shore < 44 || h < 0.25 && shore < 60) c.setRGB(0.93, 0.85, 0.64).multiplyScalar(0.95 + n * 0.05); // sand
    else if (h > 118) c.setRGB(0.95, 0.96, 0.98); // snow
    else if (slope > 0.75 || h > 85) c.setRGB(0.47, 0.43, 0.38).multiplyScalar(0.9 + n * 0.12); // rock
    else if (farm.some((b) => inRect(x, z, b))) c.setRGB(0.55, 0.43, 0.27).multiplyScalar(0.92 + 0.08 * Math.sin(x * 0.9));
    else if (['downtown', 'midtown'].includes(dist) && !inRect(x, z, lm.plazaPark) && !inRect(x, z, lm.fountainPlaza)) c.setRGB(0.62, 0.61, 0.58);
    else if (dist === 'industrial' || inRect(x, z, lm.containerYard, 6)) c.setRGB(0.5, 0.5, 0.48);
    else if (inRect(x, z, lm.parkingStadium, 2) || inRect(x, z, lm.parkingArena, 2)) c.setRGB(0.3, 0.31, 0.32);
    else if (dist === 'eastside') c.setRGB(0.45, 0.5, 0.3).multiplyScalar(0.9 + n * 0.1); // patchy dry grass
    else {
      // grass with variation, drier on mountain
      const dry = dist === 'mountain' ? 0.25 : dist === 'outskirts' ? 0.12 : 0;
      c.setRGB(0.3 + dry * 0.3, 0.52 - dry * 0.12, 0.22).multiplyScalar(0.85 + n * 0.15);
    }
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const tex = groundDetailTexture();
  tex.repeat.set(w / 5, d / 5);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.97, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

export function buildWater() {
  const geo = new THREE.PlaneGeometry(4000, 4000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() },
    uDeep: { value: new THREE.Color('#0d4a6b') },
    uShallow: { value: new THREE.Color('#2fa3b8') },
    uSky: { value: new THREE.Color('#9cc7e6') },
    uNight: { value: 0 },
    fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 }, fogDensity: { value: 0.0006 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    fog: true,
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
      uniform float uTime; uniform vec3 uSunDir; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform float uNight;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      float h(vec2 p){ return sin(p.x)*cos(p.y); }
      vec3 waveNormal(vec2 p){
        float t = uTime;
        vec2 g = vec2(0.0);
        g += vec2(cos(p.x*0.21+t*0.9), -sin(p.y*0.19+t*0.7))*0.35;
        g += vec2(cos(p.x*0.53-p.y*0.31+t*1.6), cos(p.y*0.47+p.x*0.23-t*1.3))*0.18;
        g += vec2(sin(p.x*1.3+p.y*0.9+t*2.4), cos(p.y*1.1-p.x*0.7+t*2.1))*0.07;
        return normalize(vec3(-g.x, 1.0, -g.y));
      }
      void main() {
        vec3 n = waveNormal(vWorld.xz);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 base = mix(uShallow, uDeep, clamp(length(cameraPosition.xz - vWorld.xz)/400.0, 0.0, 1.0));
        vec3 col = mix(base, uSky, fres*0.65);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(n, H), 0.0), 180.0) * (1.0 - uNight);
        col += spec * vec3(1.0, 0.95, 0.85) * 1.6;
        col *= mix(1.0, 0.25, uNight);
        gl_FragColor = vec4(col, 0.92);
        #include <fog_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.name = 'water';
  mesh.renderOrder = 1;
  return { mesh, uniforms };
}

export { pointInPoly };
