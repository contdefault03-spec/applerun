import * as THREE from 'three';

// Automatic rigging for unrigged humanoid meshes (e.g. the supplied Max model, a static
// Tripo scan with arms at its sides). Joints are placed from body proportions measured
// in unit-height space, and skin weights come from distance-to-bone-capsule with a
// surface-normal test that separates the inner arm from the torso side.

// Joint layout in unit height (feet at y=0, top of head at y=1), x relative to body center.
const JOINTS = {
  hips: [0, 0.525, 0], spine: [0, 0.60, 0], chest: [0, 0.67, 0], upperChest: [0, 0.74, -0.005],
  neck: [0, 0.825, -0.012], head: [0, 0.872, -0.005], headTop: [0, 1.0, 0],
  shoulderL: [0.025, 0.795, -0.012], upperArmL: [0.105, 0.785, -0.012], forearmL: [0.128, 0.635, -0.018], handL: [0.132, 0.49, -0.004], handEndL: [0.132, 0.415, 0.004],
  shoulderR: [-0.025, 0.795, -0.012], upperArmR: [-0.105, 0.785, -0.012], forearmR: [-0.128, 0.635, -0.018], handR: [-0.132, 0.49, -0.004], handEndR: [-0.132, 0.415, 0.004],
  thighL: [0.066, 0.495, 0.002], shinL: [0.069, 0.272, 0.0], footL: [0.071, 0.05, -0.018], toeL: [0.072, 0.008, 0.085],
  thighR: [-0.066, 0.495, 0.002], shinR: [-0.069, 0.272, 0.0], footR: [-0.071, 0.05, -0.018], toeR: [-0.072, 0.008, 0.085],
};
const PARENT = {
  hips: null, spine: 'hips', chest: 'spine', upperChest: 'chest', neck: 'upperChest', head: 'neck',
  shoulderL: 'upperChest', upperArmL: 'shoulderL', forearmL: 'upperArmL', handL: 'forearmL',
  shoulderR: 'upperChest', upperArmR: 'shoulderR', forearmR: 'upperArmR', handR: 'forearmR',
  thighL: 'hips', shinL: 'thighL', footL: 'shinL', thighR: 'hips', shinR: 'thighR', footR: 'shinR',
};
// capsule: bone -> [from joint, to joint, radius]
const CAPS = {
  hips: ['hips', 'spine', 0.088, [0, -0.06, 0]], spine: ['spine', 'chest', 0.088], chest: ['chest', 'upperChest', 0.09], upperChest: ['upperChest', 'neck', 0.085],
  neck: ['neck', 'head', 0.045], head: ['head', 'headTop', 0.075, [0, 0.05, 0]],
  shoulderL: ['shoulderL', 'upperArmL', 0.05], upperArmL: ['upperArmL', 'forearmL', 0.036], forearmL: ['forearmL', 'handL', 0.031], handL: ['handL', 'handEndL', 0.03],
  shoulderR: ['shoulderR', 'upperArmR', 0.05], upperArmR: ['upperArmR', 'forearmR', 0.036], forearmR: ['forearmR', 'handR', 0.031], handR: ['handR', 'handEndR', 0.03],
  thighL: ['thighL', 'shinL', 0.062], shinL: ['shinL', 'footL', 0.047], footL: ['footL', 'toeL', 0.035],
  thighR: ['thighR', 'shinR', 0.062], shinR: ['shinR', 'footR', 0.047], footR: ['footR', 'toeR', 0.035],
};

export function autoRig(mesh, { centerX = null } = {}) {
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const H = bb.max.y - bb.min.y;
  const pos = geo.attributes.position;
  // estimate body center x from leg region
  let cx = centerX;
  if (cx == null) {
    let s = 0, n = 0;
    for (let i = 0; i < pos.count; i++) {
      const y = (pos.getY(i) - bb.min.y) / H;
      if (y > 0.55 && y < 0.7) { s += pos.getX(i); n++; }
    }
    cx = n ? s / n : 0;
  }
  const J = {};
  for (const [k, [x, y, z]] of Object.entries(JOINTS)) J[k] = new THREE.Vector3(cx + x * H, bb.min.y + y * H, z * H);

  // Build bones (identity rotations, positions relative to parent)
  const bones = {};
  const names = Object.keys(PARENT);
  for (const n of names) { const b = new THREE.Bone(); b.name = n; bones[n] = b; }
  for (const n of names) {
    const p = PARENT[n];
    if (p) { bones[p].add(bones[n]); bones[n].position.copy(J[n]).sub(J[p]); }
    else bones[n].position.copy(J[n]);
  }
  const boneList = names.map((n) => bones[n]);
  const index = Object.fromEntries(names.map((n, i) => [n, i]));

  // Skin weights
  const nrm = geo.attributes.normal;
  const skinIndex = new Uint16Array(pos.count * 4);
  const skinWeight = new Float32Array(pos.count * 4);
  const capList = Object.entries(CAPS).map(([bone, [a, b, r, off]]) => {
    const A = J[a].clone(), B = J[b].clone();
    if (off) { A.add(new THREE.Vector3(...off).multiplyScalar(H)); }
    return { bone, A, B, r: r * H };
  });
  const p = new THREE.Vector3(), ab = new THREE.Vector3(), ap = new THREE.Vector3();
  const armBand = (y) => y > 0.47 && y < 0.8;
  const d = new Float32Array(capList.length);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const yn = (p.y - bb.min.y) / H;
    const xr = (p.x - cx) / H;
    const nx = nrm ? nrm.getX(i) : 0;
    for (let c = 0; c < capList.length; c++) {
      const { A, B, r } = capList[c];
      ab.subVectors(B, A); ap.subVectors(p, A);
      const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
      const q = ab.multiplyScalar(t).add(A);
      d[c] = p.distanceTo(q) - r;
    }
    // Arm vs torso disambiguation (arms hang next to the torso on this mesh)
    if (armBand(yn)) {
      const side = Math.sign(xr);
      const outward = nx * side;
      const ax = Math.abs(xr);
      for (let c = 0; c < capList.length; c++) {
        const bn = capList[c].bone;
        const isArm = /upperArm|forearm|hand/.test(bn) && (bn.endsWith('L') ? side > 0 : side < 0);
        const isTorso = /hips|spine|chest|upperChest/.test(bn);
        if (ax > 0.07 && ax < 0.118) {
          if (outward > 0.3 && isArm) d[c] += 0.03 * H; // torso side surface
          if (outward < -0.3 && isTorso) d[c] += 0.03 * H; // inner arm surface
        }
        if (ax > 0.118 && isTorso) d[c] += 0.05 * H;
        if (ax < 0.06 && isArm) d[c] += 0.05 * H;
      }
    }
    // Legs are separated by side
    for (let c = 0; c < capList.length; c++) {
      const bn = capList[c].bone;
      if (/thigh|shin|foot/.test(bn)) {
        const wrong = bn.endsWith('L') ? xr < -0.005 : xr > 0.005;
        if (wrong && yn < 0.47) d[c] += 0.2 * H;
      }
      if (/Arm|forearm|hand|shoulder/.test(bn)) {
        const wrong = bn.endsWith('L') ? xr < 0 : xr > 0;
        if (wrong) d[c] += 0.2 * H;
      }
    }
    // top 3 by distance
    const order = [...d.keys()].sort((a, b) => d[a] - d[b]).slice(0, 3);
    const best = d[order[0]];
    let sum = 0;
    const ws = order.map((c) => { const w = d[c] - best < 0.03 * H ? Math.exp(-(d[c] - best) / (0.008 * H)) : 0; sum += w; return w; });
    for (let k = 0; k < 4; k++) {
      skinIndex[i * 4 + k] = k < 3 ? index[capList[order[k]].bone] : 0;
      skinWeight[i * 4 + k] = k < 3 ? ws[k] / sum : 0;
    }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  const skinned = new THREE.SkinnedMesh(geo, mesh.material);
  skinned.name = mesh.name || 'autoRigged';
  const armature = new THREE.Group();
  armature.name = 'AutoRigArmature';
  armature.add(bones.hips);
  armature.add(skinned);
  armature.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneList);
  skinned.bind(skeleton);
  skinned.frustumCulled = false;
  return { armature, skinned, bones, height: H, joints: J };
}
