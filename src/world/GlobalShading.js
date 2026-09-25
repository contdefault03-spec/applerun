import * as THREE from 'three';
import { CSMShader } from 'three/addons/csm/CSMShader.js';

// Scene-wide shader upgrades applied to every built-in material (current and future), so
// materials created anywhere in the game (NPCs, cars, props…) get them without extra code:
//  - cascaded shadow maps (three's CSM shader chunks, cascades selected per fragment)
//  - height fog with aerial perspective (thicker near the ground/sea, thinner up high, and
//    tinted towards the sun when looking into it)
// Uniforms are shared through arrays: three copies ShaderLib uniforms per material but
// shallow-copies arrays, so the Vector objects inside stay live and updates reach everyone.
export const shared = {
  csmBreaks: [],                                   // Vector2 per cascade (near, far) in view-depth fraction
  fogSun: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0.9, 0.7)], // [sun direction, in-scatter colour]
  fogParams: [new THREE.Vector3(0.0035, 0.012, 0.0)], // [density at sea level, height falloff, unused]
};

let installed = false;

export function installGlobalShading({ cascades = 0, cameraNear = 0.1, shadowFar = 400 } = {}) {
  if (installed) return;
  installed = true;
  for (let i = 0; i < cascades; i++) shared.csmBreaks.push(new THREE.Vector2());
  if (cascades > 0) {
    const defs = `#ifndef USE_CSM\n#define USE_CSM 1\n#define CSM_CASCADES ${cascades}\n#define CSM_FADE\n#endif\n`;
    THREE.ShaderChunk.lights_fragment_begin = CSMShader.lights_fragment_begin;
    THREE.ShaderChunk.lights_pars_begin = defs + CSMShader.lights_pars_begin;
  }
  // height fog
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying vec3 vFogRay;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogRay = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogRay;
  uniform vec3 fogSun[ 2 ];
  uniform vec3 fogParams[ 1 ];
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  float fogDist = length( vFogRay );
  vec3 fogDir = vFogRay / max( fogDist, 1e-4 );
  #ifdef FOG_EXP2
    float fogA = fogParams[ 0 ].x > 0.0 ? fogParams[ 0 ].x : fogDensity;
    float fogB = fogParams[ 0 ].y > 0.0 ? fogParams[ 0 ].y : 0.01;
    float fogRy = abs( fogDir.y ) < 1e-3 ? 1e-3 : fogDir.y;
    float fogCamH = max( cameraPosition.y, -2.0 );
    // integral of a*exp(-b*h) along the view ray (height fog)
    float fogAmount = fogA * exp( -fogCamH * fogB ) * ( 1.0 - exp( -fogDist * fogRy * fogB ) ) / ( fogRy * fogB );
    float fogFactor = 1.0 - exp( -fogAmount );
    // a little uniform haze so distant peaks still fade
    fogFactor = max( fogFactor, 1.0 - exp( - fogDensity * fogDensity * fogDist * fogDist ) );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fogDist );
  #endif
  float fogSunAmt = pow( max( dot( fogDir, fogSun[ 0 ] ), 0.0 ), 6.0 );
  vec3 fogCol = mix( fogColor, fogSun[ 1 ], fogSunAmt * 0.35 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, clamp( fogFactor, 0.0, 1.0 ) );
#endif`;
  // shared uniforms for every built-in shader
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (!lib.uniforms) continue;
    if (lib.uniforms.fogColor) {
      lib.uniforms.fogSun = { value: shared.fogSun };
      lib.uniforms.fogParams = { value: shared.fogParams };
    }
    if (cascades > 0 && (lib.uniforms.directionalLights || lib === THREE.ShaderLib.physical)) {
      lib.uniforms.CSM_cascades = { value: shared.csmBreaks };
      lib.uniforms.cameraNear = { value: cameraNear };
      lib.uniforms.shadowFar = { value: shadowFar };
    }
  }
}

/** Uniforms to merge into custom ShaderMaterials that use the fog chunks. */
export function fogUniforms() {
  return { fogSun: { value: shared.fogSun }, fogParams: { value: shared.fogParams } };
}
