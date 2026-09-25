import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { LAYER } from '../world/layers.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { Rig, RIGIFY_MAP, STD_BONES } from './Rig.js';
import { autoRig } from './AutoRig.js';
import { PLAYABLE_BY_ID, NPC_ROLES, SKIN_TONES, HAIR_COLORS } from './defs.js';
import { printTexture } from './outfitTexture.js';
import * as ACC from './accessories.js';
import { mulberry32 } from '../../shared/rng.js';

const san = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
const LIMB_CHILD = { upperArmL: 'forearmL', forearmL: 'handL', upperArmR: 'forearmR', forearmR: 'handR', thighL: 'shinL', shinL: 'footL', thighR: 'shinR', shinR: 'footR' };

/**
 * Builds character templates from the supplied models and hands out independent
 * instances ({ root, rig, def }) that share geometry/materials.
 */
/** Adds an invisible, simplified copy of a skinned mesh that only renders into shadow maps. */
function addShadowProxy(skinned, ratio) {
  if (!MeshoptSimplifier.supported) return;
  const g = skinned.geometry;
  const pos = g.attributes.position;
  const p = pos.isInterleavedBufferAttribute ? Float32Array.from({ length: pos.count * 3 }, (_, i) => pos.getComponent(Math.floor(i / 3), i % 3)) : pos.array;
  const idx = g.index ? Uint32Array.from(g.index.array) : Uint32Array.from({ length: pos.count }, (_, i) => i);
  const remap = MeshoptSimplifier.generatePositionRemap(p, 3); // weld UV-seam duplicates
  for (let i = 0; i < idx.length; i++) idx[i] = remap[idx[i]];
  const [simple] = MeshoptSimplifier.simplify(idx, p, 3, Math.floor((idx.length * ratio) / 3) * 3, 0.02, ['Prune']);
  const pg = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) pg.setAttribute(k, a);
  pg.setIndex(new THREE.BufferAttribute(simple, 1));
  const proxy = new THREE.SkinnedMesh(pg, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  proxy.name = skinned.name + '_shadow';
  proxy.bind(skinned.skeleton, skinned.bindMatrix);
  proxy.userData.shadowProxy = true;
  skinned.userData.noShadow = true;
  skinned.parent.add(proxy);
}

export class CharacterFactory {
  constructor(assets) {
    this.assets = assets;
    this.bases = {};
    this.templates = new Map();
  }

  init() {
    // --- Max: static scan -> auto-rigged
    const maxScene = this.assets.gltf('max').scene;
    maxScene.updateMatrixWorld(true);
    let src = null;
    maxScene.traverse((o) => { if (o.isMesh && !src) src = o; });
    if (!src) throw new Error('max_3d_model.glb contains no mesh');
    const geo = src.geometry.clone();
    geo.applyMatrix4(src.matrixWorld);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const rigged = autoRig(new THREE.Mesh(geo, src.material));
    rigged.skinned.material.roughness = 0.85;
    // Max's scan is ~190k triangles: shadows come from a simplified proxy sharing his skeleton
    addShadowProxy(rigged.skinned, 0.1);
    this.bases.max = { armature: rigged.armature, stdNames: Object.fromEntries(STD_BONES.map((n) => [n, n])) };

    // --- Humans: rigged man + woman from HumanModels.glb
    const hs = this.assets.gltf('humans').scene;
    for (const [key, nodeName] of [['man', 'Man (Rig)'], ['woman', 'Woman (Rig)']]) {
      const arm = hs.getObjectByName(san(nodeName));
      if (!arm) throw new Error(`HumanModels.glb: missing node "${nodeName}"`);
      arm.removeFromParent();
      arm.position.set(0, 0, 0);
      // GLTFLoader de-duplicates names across the file (woman bones get a "_1" suffix)
      arm.traverse((o) => { if (o.isBone) o.name = o.name.replace(/_\d+$/, ''); });
      arm.updateMatrixWorld(true);
      const stdNames = {};
      for (const [std, rn] of Object.entries(RIGIFY_MAP)) stdNames[std] = san(rn);
      // Some bones are exported without their proper parent (hand.L hangs off the armature
      // root in this file) -> reattach under the forearm while preserving the rest pose.
      for (const side of ['L', 'R']) {
        const hand = arm.getObjectByName(stdNames['hand' + side]);
        const fore = arm.getObjectByName(stdNames['forearm' + side]);
        if (hand && fore && hand.parent !== fore) fore.attach(hand);
      }
      arm.updateMatrixWorld(true);
      // The file's inverse-bind matrices don't match the node rest pose (mesh is offset
      // from its skeleton). Bake the true skinned rest shape into the geometry and rebind
      // so that bind pose == node rest pose, which every later step relies on.
      arm.traverse((o) => {
        if (!o.isSkinnedMesh) return;
        const g = o.geometry.clone();
        const pa = g.attributes.position;
        const v = new THREE.Vector3();
        for (let i = 0; i < pa.count; i++) { o.getVertexPosition(i, v); pa.setXYZ(i, v.x, v.y, v.z); }
        o.geometry = g;
        fixWindingByBones(o, arm, stdNames);
        g.computeVertexNormals();
        o.bind(o.skeleton);
      });
      this.bases[key] = { armature: arm, stdNames };
    }
  }

  /** Get (or build) the template for a playable id or NPC variant key. */
  template(key) {
    if (this.templates.has(key)) return this.templates.get(key);
    let def;
    if (key.startsWith('npc:')) def = npcDef(key);
    else def = PLAYABLE_BY_ID[key];
    if (!def) throw new Error('Unknown character ' + key);
    const t = this.build(def);
    this.templates.set(key, t);
    return t;
  }

  /** Create an independent animated instance. */
  create(key) {
    const t = this.template(key);
    const root = SkeletonUtils.clone(t.root);
    root.userData.charKey = key;
    const armature = root.getObjectByName(t.armatureName);
    const bones = {};
    for (const [std, name] of Object.entries(t.stdNames)) {
      const b = armature.getObjectByName(name);
      if (b) bones[std] = b;
    }
    const rig = new Rig(armature, bones);
    let mesh = null;
    root.traverse((o) => {
      if (o.isSkinnedMesh && !o.userData.shadowProxy && !mesh) mesh = o;
      if (o.isSkinnedMesh) o.frustumCulled = false;
      if (o.isMesh) {
        o.castShadow = !o.userData.noShadow; o.receiveShadow = false;
        o.layers.set(o.userData.shadowProxy ? LAYER.SHADOW_NEAR : LAYER.NEAR);
      }
    });
    return { root, rig, def: t.def, mesh, height: t.height, headHeight: t.headHeight, pivot: root.getObjectByName('pivot') };
  }

  build(def) {
    const base = this.bases[def.base];
    const armature = SkeletonUtils.clone(base.armature);
    armature.name = 'Armature_' + def.id;
    armature.updateMatrixWorld(true);
    let skinned = null;
    armature.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
    // drop unrelated meshes
    if (def.base !== 'max') {
      skinned.geometry = skinned.geometry.clone();
      this.deformAndPaint(def, armature, skinned);
    }
    armature.updateMatrixWorld(true);

    // Normalise height: holder scales the armature so the character is def.height tall.
    const box = measure(armature, skinned);
    const holder = new THREE.Group();
    holder.name = 'holder';
    holder.add(armature);
    const s = def.height / (box.max.y - box.min.y);
    holder.scale.setScalar(s);
    holder.position.y = -box.min.y * s;
    const root = new THREE.Group();
    root.name = 'Character_' + def.id;
    const pivot = new THREE.Group();
    pivot.name = 'pivot';
    pivot.add(holder);
    root.add(pivot);
    root.userData.def = def;
    return { root, def, stdNames: base.stdNames, armatureName: armature.name, height: def.height, headHeight: def.height * 0.93 };
  }

  deformAndPaint(def, armature, skinned) {
    const geo = skinned.geometry;
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight;
    const skel = skinned.skeleton;
    armature.updateMatrixWorld(true);
    const Minv = armature.matrixWorld.clone().invert();
    const Mv = Minv.clone().multiply(skinned.matrixWorld);
    const Mvi = Mv.clone().invert();
    const Nm = new THREE.Matrix3().getNormalMatrix(Mv);

    // bone -> std group
    const stdByBone = new Map();
    const base = this.bases[def.base];
    const nameToStd = Object.fromEntries(Object.entries(base.stdNames).map(([s, n]) => [n, s]));
    const groupOf = (bone) => {
      let o = bone;
      while (o && o !== armature) { if (nameToStd[o.name]) return nameToStd[o.name]; o = o.parent; }
      return 'hips';
    };
    skel.bones.forEach((b, i) => stdByBone.set(i, groupOf(b)));
    // Joint positions (armature space)
    const J = {};
    for (const [std, n] of Object.entries(base.stdNames)) {
      const b = armature.getObjectByName(n);
      if (b) J[std] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(Minv);
    }
    // Vertices in armature space
    const N = pos.count;
    const P = new Float32Array(N * 3), NR = new Float32Array(N * 3);
    const v = new THREE.Vector3();
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < N; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(Mv);
      P[i * 3] = v.x; P[i * 3 + 1] = v.y; P[i * 3 + 2] = v.z;
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      v.fromBufferAttribute(nrm, i).applyMatrix3(Nm).normalize();
      NR[i * 3] = v.x; NR[i * 3 + 1] = v.y; NR[i * 3 + 2] = v.z;
    }
    const H = maxY - minY;
    const cx = J.hips.x, cz = J.hips.z;
    const d = { torsoW: 1, torsoD: 1, belly: 0, armThick: 1, legThick: 1, armLen: 1, legLen: 1, headScale: 1, shoulder: 0, waist: 1, ...(def.deform || {}) };
    const hipY = J.hips.y;
    const bellyY = hipY + 0.1 * H;
    const waistY = hipY + 0.07 * H;
    const shoulderHalf = Math.abs(J.upperArmL.x - cx);
    const thighHalf = Math.abs(J.thighL.x - cx);
    const armShift = (d.torsoW - 1) * shoulderHalf * 0.85 + d.shoulder * H;
    const legShift = (d.torsoW - 1) * thighHalf * 0.55;
    const neckTop = J.head.clone();
    const gauss = (x) => Math.exp(-x * x);
    const seg = {};
    for (const [a, b] of Object.entries(LIMB_CHILD)) seg[a] = [J[a], J[b]];
    seg.handL = [J.handL, J.handL.clone().add(J.handL.clone().sub(J.forearmL).multiplyScalar(0.45))];
    seg.handR = [J.handR, J.handR.clone().add(J.handR.clone().sub(J.forearmR).multiplyScalar(0.45))];
    seg.footL = [J.footL, J.footL.clone().add(new THREE.Vector3(0, -0.02 * H, 0.1 * H))];
    seg.footR = [J.footR, J.footR.clone().add(new THREE.Vector3(0, -0.02 * H, 0.1 * H))];
    const tmp = new THREE.Vector3(), q = new THREE.Vector3(), ab = new THREE.Vector3();

    const T = (x, y, z, g, out) => {
      out.set(x, y, z);
      const isArm = /Arm|forearm|hand/.test(g);
      const isLeg = /thigh|shin|foot/.test(g);
      const side = g.endsWith('L') ? 1 : g.endsWith('R') ? -1 : 0;
      if (isArm || isLeg) {
        const [A, B] = seg[g];
        ab.subVectors(B, A);
        const t = Math.max(0, Math.min(1, tmp.subVectors(out, A).dot(ab) / ab.lengthSq()));
        q.copy(A).addScaledVector(ab, t);
        const k = isArm ? d.armThick : g.startsWith('foot') ? Math.min(1.15, d.legThick) : d.legThick;
        out.sub(q).multiplyScalar(k).add(q);
        if (isArm) {
          const sh = side > 0 ? J.upperArmL : J.upperArmR;
          out.sub(sh).multiplyScalar(d.armLen).add(sh);
          out.x += side * armShift;
        } else out.x += side * legShift;
      } else if (g === 'head') {
        out.sub(neckTop).multiplyScalar(d.headScale).add(neckTop);
      } else if (g !== 'neck') {
        // torso & shoulders
        const dx = out.x - cx, dz = out.z - cz;
        const wf = 1 - (1 - d.waist) * gauss((out.y - waistY) / (0.07 * H));
        const bf = gauss((out.y - bellyY) / (0.11 * H));
        out.x = cx + dx * d.torsoW * wf * (1 + 0.25 * d.belly * bf);
        out.z = cz + dz * d.torsoD * (dz > 0 ? 1 + d.belly * 0.9 * bf : 1);
        if (g.startsWith('shoulder')) out.x += Math.sign(dx) * armShift * 0.5;
      }
      // global vertical proportions
      if (out.y < hipY) out.y = minY + (out.y - minY) * d.legLen;
      else out.y = minY + (hipY - minY) * d.legLen + (out.y - hipY);
      return out;
    };

    // Deform vertices (weighted by skin influences)
    const acc = new THREE.Vector3(), o = new THREE.Vector3();
    const region = new Array(N);
    const domGroup = new Array(N);
    for (let i = 0; i < N; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      acc.set(0, 0, 0);
      let best = -1, bw = -1, wsum = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w <= 0) continue;
        const g = stdByBone.get(si.getComponent(i, k));
        T(x, y, z, g, o);
        acc.addScaledVector(o, w);
        wsum += w;
        if (w > bw) { bw = w; best = g; }
      }
      if (wsum > 0) acc.divideScalar(wsum); else acc.set(x, y, z);
      domGroup[i] = best || 'hips';
      P[i * 3] = acc.x; P[i * 3 + 1] = acc.y; P[i * 3 + 2] = acc.z;
    }
    // Deform bones: compute new armature-space head positions for every bone first
    const newPos = new Map();
    armature.traverse((b) => {
      if (!b.isBone) return;
      const p = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(Minv);
      newPos.set(b, T(p.x, p.y, p.z, groupOf(b), new THREE.Vector3()));
    });
    const Mw = armature.matrixWorld;
    armature.traverse((b) => {
      if (!b.isBone) return;
      const wp = newPos.get(b).clone().applyMatrix4(Mw);
      b.parent.updateMatrixWorld(true);
      b.position.copy(wp.applyMatrix4(b.parent.matrixWorld.clone().invert()));
      b.updateMatrixWorld(true);
    });
    // Write geometry back to mesh space
    for (let i = 0; i < N; i++) {
      v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(Mvi);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingBox(); geo.computeBoundingSphere();
    armature.updateMatrixWorld(true);
    skinned.bind(skinned.skeleton);
    // updated joints (post deform)
    for (const [std, n] of Object.entries(base.stdNames)) {
      const b = armature.getObjectByName(n);
      if (b) J[std] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(Minv);
    }

    // ---- Head frame (for accessories)
    let hb = new THREE.Box3();
    const headMinY = J.head.y - 0.012 * H;
    for (let i = 0; i < N; i++) if (domGroup[i] === 'head' && P[i * 3 + 1] > headMinY) hb.expandByPoint(v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
    const hc = hb.getCenter(new THREE.Vector3()), hs = hb.getSize(new THREE.Vector3());
    const eyeY = hb.min.y + hs.y * 0.55;
    let front = -Infinity;
    for (let i = 0; i < N; i++) {
      if (domGroup[i] !== 'head' || P[i * 3 + 1] < headMinY) continue;
      if (Math.abs(P[i * 3] - hc.x) < hs.x * 0.2 && Math.abs(P[i * 3 + 1] - eyeY) < hs.y * 0.08) front = Math.max(front, P[i * 3 + 2]);
    }
    const head = { c: hc, w: hs.x, h: hs.y, d: hs.z, front, eyeY, top: hb.max.y };
    this._lastHead = head; this._J = Object.fromEntries(Object.entries(J).map(([k, v]) => [k, +v.y.toFixed(3)]));

    // ---- Paint: vertex colours per region + front print UVs
    const o2 = { skin: def.skin || '#e0b394', hair: def.hair || '#2b1d14', ...defaultsOutfit(def.outfit || {}) };
    const col = new Float32Array(N * 3);
    const uv = new Float32Array(N * 2);
    const pmask = new Float32Array(N);
    const c = new THREE.Color();
    const hipY2 = J.hips.y;
    const chestTop = J.neck.y - 0.03 * H, chestBot = hipY2 + 0.01 * H;
    const chestHalf = shoulderHalf * d.torsoW * 0.95 + 0.01 * H;
    const rnd = mulberry32(hashStr(def.id));
    const headH = head.h;
    for (let i = 0; i < N; i++) {
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      const nz = NR[i * 3 + 2];
      const g = domGroup[i];
      let reg = 'skin';
      const t = (a, b) => {
        const [A, B] = seg[a] || [J[a], J[b]];
        ab.subVectors(B, A);
        return tmp.set(x, y, z).sub(A).dot(ab) / ab.lengthSq();
      };
      if (g === 'hips') reg = y < hipY2 + 0.035 * H ? 'pants' : 'shirt';
      else if (/spine|chest|upperChest|shoulder/.test(g)) reg = 'shirt';
      else if (g === 'neck') reg = def.outfit?.print === 'hoodie' || def.outfit?.print === 'techfleece' ? 'shirt' : 'skin';
      else if (g === 'head' && y < headMinY) reg = def.outfit?.print === 'hoodie' || def.outfit?.print === 'techfleece' ? 'shirt' : 'skin';
      else if (g === 'head') {
        const yr = (y - hb.min.y) / headH;
        const nyv = (P[i * 3 + 1] - hc.y) / (headH / 2);
        const back = (z - hc.z) / (hs.z / 2);
        reg = (yr > 0.72 && back < 0.75) || (yr > 0.35 && back < -0.25) ? 'hair' : 'skin';
        if (def.gorilla) reg = 'fur';
        void nyv;
      } else if (/upperArm/.test(g)) reg = o2.sleeves === 'long' || o2.sleeves === 'mid' || t(g) < 0.45 ? 'shirt' : 'skin';
      else if (/forearm/.test(g)) reg = o2.sleeves === 'long' ? (t(g) > 0.93 ? 'cuff' : 'shirt') : 'skin';
      else if (/hand/.test(g)) reg = def.gorilla ? 'furDark' : 'skin';
      else if (/thigh/.test(g)) reg = o2.pantsLen === 'short' && t(g) > 0.7 ? 'skin' : 'pants';
      else if (/shin/.test(g)) reg = o2.pantsLen === 'short' ? (t(g) > 0.85 ? 'socks' : 'skin') : t(g) > 0.93 ? 'shoes' : 'pants';
      else if (/foot/.test(g)) reg = 'shoes';
      if (def.gorilla && reg === 'skin') reg = 'fur';
      region[i] = reg;
      c.set(o2[reg] || o2.skin);
      // stripes on shirt
      if (reg === 'shirt' && o2.stripes && Math.floor((y / H) * 40) % 2 === 0) c.set(o2.stripes);
      // subtle fabric / fur variation
      const n = (rnd() - 0.5) * (reg === 'fur' || reg === 'furDark' ? 0.12 : 0.04);
      col[i * 3] = clamp01(c.r + n); col[i * 3 + 1] = clamp01(c.g + n); col[i * 3 + 2] = clamp01(c.b + n);
      // print projection
      const pu = Math.max(0, Math.min(1, (x - (cx - chestHalf)) / (2 * chestHalf)));
      const pv = Math.max(0, Math.min(1, (y - chestBot) / (chestTop - chestBot)));
      const frontFacing = nz > -0.3 && z > cz && reg === 'shirt' && y > chestBot - 0.05 * H && y < chestTop + 0.05 * H && /spine|chest|upperChest|hips|shoulder/.test(g);
      uv[i * 2] = pu;
      uv[i * 2 + 1] = pv;
      pmask[i] = frontFacing ? 1 : 0;
      if (reg === 'shirt' && /hest/.test(g)) { (this._dbg ??= { n: 0, zf: 0, zb: 0, nf: 0, nb: 0, cz }); if (nz > 0.5) { this._dbg.zf += z; this._dbg.nf++; } if (nz < -0.5) { this._dbg.zb += z; this._dbg.nb++; } }
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('printUv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('printMask', new THREE.Float32BufferAttribute(pmask, 1));
    const print = o2.print || (def.role === 'police' ? 'police' : null);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: def.gorilla ? 0.95 : 0.78, metalness: 0, side: THREE.DoubleSide });
    if (print) applyPrint(material, printTexture(print, { panel: o2.shirtPanel, shirt: o2.shirt, apron: o2.apron, number: o2.number }));
    skinned.material = material;

    // ---- Accessories attached to the head bone
    const headBone = armature.getObjectByName(base.stdNames.head);
    const addToBone = (bone, obj, center = head.c) => {
      // Groups authored around the armature origin get re-centred so their pivot sits
      // near the bone (otherwise small bone rotations swing them on a huge lever arm).
      if (obj.position.lengthSq() < 1e-10 && obj.children.length) {
        for (const ch of obj.children) ch.position.sub(center);
        obj.position.copy(center);
      }
      // obj is authored in armature space -> express in bone space
      const inv = new THREE.Matrix4().copy(armature.matrixWorld).invert().multiply(bone.matrixWorld).invert();
      obj.updateMatrix();
      obj.applyMatrix4(inv);
      bone.add(obj);
      obj.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    };
    const accs = [];
    if (def.gorilla) {
      accs.push(ACC.gorillaHead(head, def.skin));
      addToBone(armature.getObjectByName(base.stdNames.upperChest), ACC.hoodCollar(J.neck.clone().add(new THREE.Vector3(0, 0.01 * H, -0.01 * H)), hs.x * 0.62, o2.shirt));
    } else if (def.mask) {
      accs.push(ACC.skiMask(head, def.mask, def.skin));
    } else {
      accs.push(ACC.eyes(head, def.eyes || 'normal', def.skin));
      if (def.hairStyle === 'fluffy') accs.push(ACC.fluffyHair(head, def.hair));
      else if (def.hairStyle === 'ponytail') accs.push(ACC.ponytail(head, def.hair));
      else if (def.hairStyle === 'short') accs.push(ACC.shortHairCap(head, def.hair));
    }
    if (def.hat === 'umbrella') accs.push(ACC.umbrellaHat(head));
    else if (def.hat === 'cap') accs.push(ACC.cap(head, def.hatColor));
    else if (def.hat === 'police') accs.push(ACC.policeHat(head));
    else if (def.hat === 'hardhat') accs.push(ACC.hardhat(head));
    else if (def.hat === 'bandana') accs.push(ACC.bandana(head, def.hatColor || o2.shirt));
    for (const a of accs) addToBone(headBone, a);
  }
}

// Some supplied meshes have inverted triangle winding (hidden by double-sided materials).
// Flip triangles when the signed volume is negative so normals point outwards.
function fixWinding(g) {
  const idx = g.index, pa = g.attributes.position;
  const n = idx ? idx.count : pa.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let vol = 0;
  for (let i = 0; i < n; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pa, i0); b.fromBufferAttribute(pa, i1); c.fromBufferAttribute(pa, i2);
    vol += a.dot(b.cross(c));
  }
  if (vol >= 0) return false;
  if (idx) {
    for (let i = 0; i < n; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t); }
    idx.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const at = g.attributes[name], sz = at.itemSize;
      for (let i = 0; i < n; i += 3) for (let k = 0; k < sz; k++) {
        const t = at.array[(i + 1) * sz + k]; at.array[(i + 1) * sz + k] = at.array[(i + 2) * sz + k]; at.array[(i + 2) * sz + k] = t;
      }
      at.needsUpdate = true;
    }
  }
  return true;
}

// The Man mesh mixes triangle windings (parts were mirrored). Orient every triangle so
// its normal points away from the bone axis that owns it.
function fixWindingByBones(mesh, armature, stdNames) {
  const g = mesh.geometry;
  armature.updateMatrixWorld(true);
  const toMesh = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const P = (name) => { const b = armature.getObjectByName(stdNames[name]); return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).applyMatrix4(toMesh); };
  const J = {}; for (const k of Object.keys(stdNames)) J[k] = P(k);
  const nameToStd = Object.fromEntries(Object.entries(stdNames).map(([s, n]) => [n, s]));
  const grp = mesh.skeleton.bones.map((b) => { let o = b; while (o && o !== armature) { if (nameToStd[o.name]) return nameToStd[o.name]; o = o.parent; } return 'hips'; });
  const headC = J.head.clone().add(J.head.clone().sub(J.neck).multiplyScalar(1.5));
  const segs = {
    torso: [J.hips, J.neck], neck: [J.neck, J.head], head: [headC, headC],
    upperArmL: [J.upperArmL, J.forearmL], forearmL: [J.forearmL, J.handL], handL: [J.handL, J.handL.clone().add(J.handL.clone().sub(J.forearmL).multiplyScalar(0.4))],
    upperArmR: [J.upperArmR, J.forearmR], forearmR: [J.forearmR, J.handR], handR: [J.handR, J.handR.clone().add(J.handR.clone().sub(J.forearmR).multiplyScalar(0.4))],
    thighL: [J.thighL, J.shinL], shinL: [J.shinL, J.footL], footL: [J.footL, J.footL.clone().add(new THREE.Vector3(0, -0.05, 0.12))],
    thighR: [J.thighR, J.shinR], shinR: [J.shinR, J.footR], footR: [J.footR, J.footR.clone().add(new THREE.Vector3(0, -0.05, 0.12))],
    shoulderL: [J.shoulderL, J.upperArmL], shoulderR: [J.shoulderR, J.upperArmR],
  };
  const segFor = (gname) => segs[gname] || segs.torso;
  const pa = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const dom = (i) => { let b = 0, w = -1; for (let k = 0; k < 4; k++) { const x = sw.getComponent(i, k); if (x > w) { w = x; b = si.getComponent(i, k); } } return grp[b]; };
  const idx = g.index;
  if (!idx) return;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), cen = new THREE.Vector3(), ab = new THREE.Vector3(), q = new THREE.Vector3();
  let flipped = 0;
  for (let t = 0; t < idx.count; t += 3) {
    const i0 = idx.getX(t), i1 = idx.getX(t + 1), i2 = idx.getX(t + 2);
    a.fromBufferAttribute(pa, i0); b.fromBufferAttribute(pa, i1); c.fromBufferAttribute(pa, i2);
    cen.copy(a).add(b).add(c).divideScalar(3);
    n.subVectors(b, a).cross(c.clone().sub(a));
    const [A, B] = segFor(dom(i0));
    ab.subVectors(B, A);
    const L = ab.lengthSq();
    const tt = L > 1e-9 ? Math.max(0, Math.min(1, cen.clone().sub(A).dot(ab) / L)) : 0;
    q.copy(A).addScaledVector(ab, tt);
    if (n.dot(cen.sub(q)) < 0) { idx.setX(t + 1, i2); idx.setX(t + 2, i1); flipped++; }
  }
  idx.needsUpdate = true;
  return flipped;
}

// Shirt print: planar-projected texture shown only where the (interpolated) printMask
// attribute says the surface is the front of the torso.
function applyPrint(material, tex) {
  material.userData.printMap = tex;
  material.onBeforeCompile = (sh) => {
    sh.uniforms.printMap = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float printMask;\nattribute vec2 printUv;\nvarying float vPrintMask;\nvarying vec2 vPrintUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPrintMask = printMask;\nvPrintUv = printUv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D printMap;\nvarying float vPrintMask;\nvarying vec2 vPrintUv;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vPrintMask > 0.5) { vec4 pc = texture2D(printMap, vec2(vPrintUv.x * 0.5, vPrintUv.y)); diffuseColor.rgb *= pc.rgb; }');
  };
  material.customProgramCacheKey = () => 'print';
}

function defaultsOutfit(o) {
  return {
    shirt: '#777777', shirtPanel: '#333333', pants: '#333a44', shoes: '#eeeeee', socks: '#f5f5f5', cuff: o.shirt || '#777777',
    fur: '#2a2522', furDark: '#1c1916', sleeves: 'short', pantsLen: 'long', ...o,
  };
}
function measure(armature, skinned) {
  const box = new THREE.Box3();
  const pos = skinned.geometry.attributes.position;
  const M = new THREE.Matrix4().copy(armature.matrix).multiply(new THREE.Matrix4().copy(armature.matrixWorld).invert()).multiply(skinned.matrixWorld);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(M));
  return box;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }

// ---- NPC variant definitions: "npc:<role>:<n>"
export function npcDef(key) {
  const [, role, nStr] = key.split(':');
  const n = +nStr || 0;
  const R = NPC_ROLES[role] || NPC_ROLES.civilian;
  const r = mulberry32(hashStr(key));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const female = role === 'wrestler' ? r() < 0.25 : role !== 'police' || r() < 0.3 ? r() < 0.45 : false;
  const base = female ? 'woman' : 'man';
  const heavy = r() < 0.25;
  const def = {
    id: key, role, name: role, base,
    height: (female ? 1.6 : 1.72) + r() * 0.2,
    skin: pick(SKIN_TONES), hair: pick(HAIR_COLORS),
    hairStyle: female ? (r() < 0.6 ? 'ponytail' : 'short') : r() < 0.8 ? 'short' : null,
    deform: {
      torsoW: heavy ? 1.2 + r() * 0.2 : 0.92 + r() * 0.16, torsoD: heavy ? 1.25 : 1, belly: heavy ? 0.4 + r() * 0.5 : r() * 0.15,
      armThick: 0.95 + r() * 0.2, legThick: 0.95 + r() * 0.15, legLen: 0.95 + r() * 0.08,
    },
    outfit: {
      shirt: pick(R.shirts), pants: pick(R.pants), shoes: pick(['#f0f0f0', '#222222', '#6d4c41', '#1565c0']),
      sleeves: R.sleeves || pick(['short', 'long', 'short']), pantsLen: R.pantsLen || (r() < 0.15 ? 'short' : 'long'),
      print: role === 'police' ? 'police' : role === 'medic' ? 'medic' : role === 'shopkeeper' ? 'apron' : role === 'worker' ? 'hivis' : role === 'athlete' || R.jersey ? 'jersey' : role === 'junkie' ? 'shabby' : r() < 0.3 ? 'stripes' : null,
      apron: R.apron, number: 1 + (n % 30), stripes: r() < 0.3 ? '#ffffff' : null,
    },
    hat: R.hat || (r() < 0.12 ? 'cap' : null), hatColor: pick(['#c0392b', '#1e272e', '#27ae60', '#2980b9']),
    eyes: role === 'junkie' ? 'bored' : 'normal',
  };
  if (def.outfit.print !== 'stripes') def.outfit.stripes = null;
  return def;
}
