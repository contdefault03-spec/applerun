import * as THREE from 'three';

// Standard bone set used by every character. Poses are authored in *model space*
// (character faces +Z, up +Y, character's left = +X) as delta rotations D so that
// boneWorld = D * restWorld. Bones without an explicit delta inherit their parent's.
export const STD_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'shoulderL', 'upperArmL', 'forearmL', 'handL',
  'shoulderR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL',
  'thighR', 'shinR', 'footR',
];

export const RIGIFY_MAP = {
  hips: 'spine', spine: 'spine.001', chest: 'spine.002', upperChest: 'spine.003', neck: 'spine.004', head: 'spine.005',
  shoulderL: 'shoulder.L', upperArmL: 'upper_arm.L', forearmL: 'forearm.L', handL: 'hand.L',
  shoulderR: 'shoulder.R', upperArmR: 'upper_arm.R', forearmR: 'forearm.R', handR: 'hand.R',
  thighL: 'thigh.L', shinL: 'shin.L', footL: 'foot.L',
  thighR: 'thigh.R', shinR: 'shin.R', footR: 'foot.R',
};

const CHILD_OF = { upperArmL: 'forearmL', forearmL: 'handL', upperArmR: 'forearmR', forearmR: 'handR', thighL: 'shinL', shinL: 'footL', thighR: 'shinR', shinR: 'footR', neck: 'head', upperChest: 'neck', hips: 'spine', spine: 'chest', chest: 'upperChest' };

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();

export class Rig {
  /**
   * @param {THREE.Object3D} rigRoot object whose local space is "model space" (armature node)
   * @param {Record<string, THREE.Bone>} bones std name -> bone
   */
  constructor(rigRoot, bones) {
    this.root = rigRoot;
    this.bones = bones;
    this.order = STD_BONES.filter((n) => bones[n]);
    this.rest = {};
    // Rest world quaternion (relative to rigRoot) and rest local
    for (const name of this.order) {
      const b = bones[name];
      const qw = new THREE.Quaternion();
      let o = b;
      const chain = [];
      while (o && o !== rigRoot) { chain.push(o); o = o.parent; }
      for (let i = chain.length - 1; i >= 0; i--) qw.multiply(chain[i].quaternion);
      this.rest[name] = { world: qw, local: b.quaternion.clone(), parentStd: null, parentRestWorld: null, pos: b.position.clone() };
    }
    for (const name of this.order) {
      const b = bones[name];
      const pName = this.order.find((n) => bones[n] === b.parent);
      const r = this.rest[name];
      r.parentStd = pName || null;
      if (!pName) {
        const qw = new THREE.Quaternion();
        let o = b.parent; const chain = [];
        while (o && o !== rigRoot) { chain.push(o); o = o.parent; }
        for (let i = chain.length - 1; i >= 0; i--) qw.multiply(chain[i].quaternion);
        r.parentRestWorld = qw;
      }
    }
    // Rest directions (model space) from bone head to child head
    this.restDir = {};
    const headPos = {};
    for (const name of this.order) headPos[name] = this.modelPos(bones[name]);
    for (const name of this.order) {
      const c = CHILD_OF[name];
      if (c && headPos[c]) this.restDir[name] = headPos[c].clone().sub(headPos[name]).normalize();
      else this.restDir[name] = new THREE.Vector3(0, 1, 0).applyQuaternion(this.rest[name].world);
    }
    this.headPos = headPos;
    this.cur = {};
    for (const name of this.order) this.cur[name] = new THREE.Quaternion();
    this.delta = {};
  }

  modelPos(bone) {
    // position of bone head in rigRoot space (includes rigRoot-internal scales ignored at root level)
    this.root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    return new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld).applyMatrix4(inv);
  }

  /** Delta that rotates a bone's rest direction to point along dir (model space). */
  aim(name, dir, out = new THREE.Quaternion()) {
    const rd = this.restDir[name];
    if (!rd) return out.identity();
    return out.setFromUnitVectors(rd, _v.copy(dir).normalize());
  }

  apply(deltas) {
    for (const name of this.order) {
      const r = this.rest[name];
      const b = this.bones[name];
      const parentW = r.parentStd ? this.cur[r.parentStd] : r.parentRestWorld;
      const d = deltas[name];
      const w = this.cur[name];
      if (d) w.copy(d).multiply(r.world);
      else w.copy(parentW).multiply(r.local);
      b.quaternion.copy(_q.copy(parentW).invert().multiply(w));
    }
  }
}
