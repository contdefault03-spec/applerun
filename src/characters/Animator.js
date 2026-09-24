import * as THREE from 'three';

// Procedural animation controller. Produces a pose (model-space deltas per standard bone)
// each frame from locomotion state + upper-body overlays + one-shot / looping actions,
// with smooth cross-fades. Works for every character since all rigs share STD_BONES.

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const TAU = Math.PI * 2;

function limbDir(fwd, out, side, v = new THREE.Vector3()) {
  // fwd: rotation towards +Z (0 = hanging down, PI/2 = forward, PI = up); out: sideways lift
  const co = Math.cos(out);
  return v.set(side * Math.sin(out), -co * Math.cos(fwd), co * Math.sin(fwd)).normalize();
}
const qe = (x, y, z, q = new THREE.Quaternion()) => q.setFromEuler(new THREE.Euler(x, y, z, 'YXZ'));

class Pose {
  constructor() {
    this.q = {};
    this.rootY = 0; this.rootZ = 0; this.rootPitch = 0; this.rootRoll = 0;
  }
  set(name, q) { (this.q[name] ??= new THREE.Quaternion()).copy(q); }
  clear() { for (const k in this.q) delete this.q[k]; this.rootY = this.rootZ = this.rootPitch = this.rootRoll = 0; }
}

// Blend b into a with weight w (a := slerp(a, b, w)); missing bones treated as identity
function blendInto(a, b, w, names) {
  if (w <= 0) return;
  for (const n of names) {
    const qb = b.q[n];
    const qa = a.q[n];
    if (!qa && !qb) continue;
    const from = qa || new THREE.Quaternion();
    const to = qb || new THREE.Quaternion();
    (a.q[n] ??= new THREE.Quaternion()).copy(from).slerp(to, w);
  }
  a.rootY += (b.rootY - a.rootY) * w;
  a.rootZ += (b.rootZ - a.rootZ) * w;
  a.rootPitch += (b.rootPitch - a.rootPitch) * w;
  a.rootRoll += (b.rootRoll - a.rootRoll) * w;
}

const ALL = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];
const UPPER = ['chest', 'upperChest', 'neck', 'head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR'];
const ARMS = ['upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR'];

export const ACTIONS = {
  punch: { dur: 0.38, parts: 'upper' },
  punchL: { dur: 0.38, parts: 'upper' },
  kick: { dur: 0.55, parts: 'all' },
  slash: { dur: 0.35, parts: 'upper' },
  recoil: { dur: 0.13, parts: 'upper', additive: true },
  reload: { dur: 1.6, parts: 'arms' },
  interact: { dur: 0.7, parts: 'upper' },
  wave: { dur: 1.4, parts: 'upper' },
  chestBeat: { dur: 1.6, parts: 'upper' },
  flex: { dur: 1.6, parts: 'upper' },
  kickBall: { dur: 0.42, parts: 'all' },
  shootBall: { dur: 0.45, parts: 'all' },
  pass: { dur: 0.4, parts: 'upper' },
  jumpShot: { dur: 0.75, parts: 'all' },
  tackle: { dur: 0.6, parts: 'all' },
  throw: { dur: 1.0, parts: 'all' },
  slam: { dur: 1.1, parts: 'all' },
  dropkick: { dur: 0.9, parts: 'all' },
  reversal: { dur: 0.6, parts: 'all' },
  getUp: { dur: 1.0, parts: 'all' },
  celebrate: { dur: 1.8, parts: 'upper' },
  dance: { dur: 2.4, parts: 'all' },
  taunt: { dur: 1.4, parts: 'upper' },
  hit: { dur: 0.3, parts: 'upper', additive: true },
  enterCar: { dur: 0.5, parts: 'all' },
};
// Looping states (hold until cleared)
export const LOOPS = ['sit', 'drive', 'lie', 'dead', 'handsUp', 'grapple', 'grappled', 'pinning', 'pinned', 'dribble', 'swim', 'sleep', 'knockedDown', 'ride'];

export class Animator {
  constructor(char) {
    this.c = char;
    this.rig = char.rig;
    this.style = char.def.idleStyle || 'normal';
    this.runStyle = char.def.runStyle || 'normal';
    this.phase = 0;
    this.time = Math.random() * 10;
    this.speed = 0;
    this.speedSmooth = 0;
    this.grounded = true;
    this.vy = 0;
    this.crouch = 0; this.crouchT = 0;
    this.aim = 0; this.aimT = 0; this.aimPitch = 0;
    this.weapon = 'none'; // none | pistol | rifle | knife | sniper
    this.turnRate = 0;
    this.actions = []; // {name, t, dur, w}
    this.loop = null; this.loopW = 0; this.loopPrev = null; this.prevLoopW = 0;
    this.base = new Pose(); this.tmp = new Pose(); this.act = new Pose();
    this.q1 = new THREE.Quaternion(); this.q2 = new THREE.Quaternion(); this.v1 = new THREE.Vector3(); this.v2 = new THREE.Vector3();
    this.lookYaw = 0; this.lookPitch = 0;
    this.idleFidget = 0;
    this.bodyScale = char.height / 1.8;
  }

  play(name, speedMul = 1) {
    const a = ACTIONS[name];
    if (!a) return;
    // restart if already playing
    this.actions = this.actions.filter((x) => x.name !== name || x.t > x.dur * 0.6);
    this.actions.push({ name, t: 0, dur: a.dur / speedMul, parts: a.parts, additive: !!a.additive });
  }
  isPlaying(name) { return this.actions.some((a) => a.name === name); }
  setLoop(name) {
    if (this.loop === name) return;
    this.loopPrev = this.loop; this.prevLoopW = this.loopW;
    this.loop = name; this.loopW = 0;
  }

  update(dt, state = {}) {
    this.time += dt;
    const sp = state.speed ?? 0;
    this.speedSmooth += (sp - this.speedSmooth) * Math.min(1, dt * 8);
    this.grounded = state.grounded ?? true;
    this.vy = state.vy ?? 0;
    this.crouchT = state.crouch ? 1 : 0;
    this.crouch += (this.crouchT - this.crouch) * Math.min(1, dt * 10);
    this.aimT = state.aim ? 1 : 0;
    this.aim += (this.aimT - this.aim) * Math.min(1, dt * 12);
    this.aimPitch = state.aimPitch ?? 0;
    this.weapon = state.weapon || 'none';
    this.lookYaw += ((state.lookYaw ?? 0) - this.lookYaw) * Math.min(1, dt * 6);
    this.lookPitch += ((state.lookPitch ?? 0) - this.lookPitch) * Math.min(1, dt * 6);

    const base = this.base;
    base.clear();
    this.locomotion(base, dt);
    this.upperOverlay(base);

    // Loops
    if (this.loop) this.loopW = Math.min(1, this.loopW + dt * 5);
    if (this.loopPrev && this.prevLoopW > 0) {
      this.prevLoopW = Math.max(0, this.prevLoopW - dt * 5);
      this.act.clear(); this.loopPose(this.loopPrev, this.act);
      blendInto(base, this.act, this.prevLoopW, ALL);
      if (this.prevLoopW <= 0) this.loopPrev = null;
    }
    if (this.loop) {
      this.act.clear(); this.loopPose(this.loop, this.act);
      blendInto(base, this.act, this.loopW, this.loop === 'dribble' ? ['upperArmR', 'forearmR', 'handR'] : ALL);
    }

    // One-shot actions
    for (const a of this.actions) {
      a.t += dt;
      const t = Math.min(1, a.t / a.dur);
      this.act.clear();
      this.actionPose(a.name, t, this.act);
      const env = Math.min(1, t / 0.15, (1 - t) / 0.2);
      const names = a.parts === 'upper' ? UPPER : a.parts === 'arms' ? ARMS : ALL;
      blendInto(base, this.act, Math.max(0, env), names);
    }
    this.actions = this.actions.filter((a) => a.t < a.dur);

    this.rig.apply(base.q);
    const p = this.c.pivot;
    if (p) {
      p.position.y = base.rootY * this.bodyScale;
      p.position.z = base.rootZ * this.bodyScale;
      p.rotation.x = base.rootPitch;
      p.rotation.z = base.rootRoll;
    }
  }

  // ------------------------------------------------------------------ locomotion
  locomotion(P, dt) {
    const sp = this.speedSmooth;
    const run = THREE.MathUtils.smoothstep(sp, 2.2, 4.2);
    const stride = THREE.MathUtils.lerp(1.35, 2.6, run) * this.bodyScale;
    const moving = THREE.MathUtils.smoothstep(sp, 0.15, 0.8);
    this.phase = (this.phase + (sp * dt) / stride * TAU) % TAU;
    const ph = this.phase;
    const t = this.time;
    const st = this.runStyle;
    let A = THREE.MathUtils.lerp(0.42, 0.78, run) * moving;
    let armA = THREE.MathUtils.lerp(0.35, 0.85, run) * moving;
    let knee = THREE.MathUtils.lerp(0.55, 1.35, run);
    let lean = THREE.MathUtils.lerp(0.03, 0.2, run) * moving;
    let sway = 0.03 * moving;
    let elbow = THREE.MathUtils.lerp(0.25, 1.35, run);
    let armOut = 0.1;
    if (st === 'gorilla') { A *= 0.75; sway = 0.12 * moving; armOut = 0.35; elbow *= 0.6; armA *= 0.6; lean += 0.1; }
    if (st === 'waddle') { A *= 0.6; sway = 0.16 * moving; armOut = 0.5; armA *= 0.5; }
    if (st === 'lazy') { armA *= 0.5; lean *= 0.5; elbow *= 0.6; }
    if (st === 'athletic') { armA *= 1.1; }

    // Crouch
    const cr = this.crouch;
    // Idle breathing / styles
    const idle = 1 - moving;
    let hipsPitch = lean * 0.6, hipsYaw = 0.12 * Math.sin(ph) * moving, hipsRoll = sway * Math.sin(ph);
    let chestPitch = lean * 0.6 + 0.02 * Math.sin(t * 1.6) * idle, chestYaw = -0.18 * Math.sin(ph) * moving;
    let headPitch = -lean * 0.8, headYaw = 0;
    let idleArmOut = 0.13, idleArmFwd = 0.05, idleElbow = 0.18;
    if (idle > 0.01) {
      const s = this.style;
      hipsRoll += 0.025 * Math.sin(t * 0.7) * idle;
      headYaw += 0.25 * Math.sin(t * 0.37) * Math.sin(t * 0.11) * idle;
      if (s === 'bored') { chestPitch += 0.2 * idle; headPitch += 0.25 * idle; idleArmOut = 0.06; idleElbow = 0.1; headYaw += 0.3 * Math.sin(t * 0.2) * idle; }
      if (s === 'gorilla') { chestPitch += 0.18 * idle; idleArmOut = 0.38; idleArmFwd = 0.2; idleElbow = 0.35; hipsRoll += 0.06 * Math.sin(t * 1.3) * idle; }
      if (s === 'silly') { hipsRoll += 0.1 * Math.sin(t * 3) * idle; headYaw += 0.3 * Math.sin(t * 1.5) * idle; idleArmOut = 0.3 + 0.2 * Math.sin(t * 3); }
      if (s === 'flex') { chestPitch -= 0.06 * idle; idleArmOut = 0.3; idleElbow = 0.3; }
    }
    P.set('hips', qe(hipsPitch + cr * 0.25, hipsYaw, hipsRoll, this.q1));
    P.set('chest', qe(hipsPitch + chestPitch + cr * 0.15, hipsYaw + chestYaw, hipsRoll * 0.3, this.q1));
    P.set('head', qe(hipsPitch + chestPitch + headPitch - this.lookPitch * 0.6 + cr * 0.1, hipsYaw + chestYaw + headYaw + this.lookYaw, 0, this.q1));

    // Legs
    for (const [side, off] of [['L', 0], ['R', Math.PI]]) {
      const s = side === 'L' ? 1 : -1;
      const p = ph + off;
      let th = A * Math.sin(p);
      let kn = 0.08 + knee * Math.max(0, Math.cos(p)) * moving + 0.06 * run * moving;
      // crouch
      th += cr * 1.15; kn += cr * 2.0;
      // airborne tuck
      if (!this.grounded) { const up = this.vy > 0 ? 1 : 0.6; th = th * 0.3 + (side === 'L' ? 0.7 : 0.25) * up; kn = kn * 0.3 + 0.9 * up; }
      const outA = (st === 'gorilla' || st === 'waddle' ? 0.08 : 0.03) + cr * 0.12;
      this.rig.aim('thigh' + side, limbDir(th, outA, s, this.v1), this.q1); P.set('thigh' + side, this.q1);
      this.rig.aim('shin' + side, limbDir(th - kn, outA * 0.5, s, this.v1), this.q2); P.set('shin' + side, this.q2);
      const footPitch = moving * (0.25 * Math.sin(p - 0.7) * (0.5 + run)) - (this.grounded ? 0 : 0.3);
      P.set('foot' + side, qe(-footPitch * 0.6, 0, 0, this.q1));
    }
    const legLen = 0.9;
    // vertical bob + crouch drop (in metres for a 1.8m character)
    P.rootY = (-0.035 * run - 0.012) * moving * (1 - Math.abs(Math.sin(ph * 2 + 1.2))) * 2 - cr * 0.36 * legLen + (idle * 0.004 * Math.sin(t * 1.6));
    if (st === 'waddle') P.rootY += 0.03 * Math.abs(Math.sin(ph)) * moving;

    // Arms (swing opposite to legs)
    const chestQ = P.q.chest;
    for (const [side, off] of [['L', Math.PI], ['R', 0]]) {
      const s = side === 'L' ? 1 : -1;
      const sw = armA * Math.sin(ph + off);
      const fwd = sw * moving + idleArmFwd * idle + cr * 0.3;
      const out = armOut * moving + idleArmOut * idle;
      const el = elbow * moving + idleElbow * idle + cr * 0.4;
      this.v1.copy(limbDir(fwd, out, s)).applyQuaternion(chestQ);
      this.rig.aim('upperArm' + side, this.v1, this.q1); P.set('upperArm' + side, this.q1);
      this.v2.copy(limbDir(fwd + el, out * 0.6, s)).applyQuaternion(chestQ);
      this.rig.aim('forearm' + side, this.v2, this.q2); P.set('forearm' + side, this.q2);
    }
  }

  armTo(P, side, fwd, out, el, chestQ, elOut = null) {
    const s = side === 'L' ? 1 : -1;
    this.v1.copy(limbDir(fwd, out, s)).applyQuaternion(chestQ);
    this.rig.aim('upperArm' + side, this.v1, this.q1); P.set('upperArm' + side, this.q1);
    this.v2.copy(limbDir(fwd + el, elOut ?? out * 0.6, s)).applyQuaternion(chestQ);
    this.rig.aim('forearm' + side, this.v2, this.q2); P.set('forearm' + side, this.q2);
  }
  armDirs(P, side, upper, fore, chestQ) {
    this.v1.copy(upper).normalize().applyQuaternion(chestQ);
    this.rig.aim('upperArm' + side, this.v1, this.q1); P.set('upperArm' + side, this.q1);
    this.v2.copy(fore).normalize().applyQuaternion(chestQ);
    this.rig.aim('forearm' + side, this.v2, this.q2); P.set('forearm' + side, this.q2);
  }
  legTo(P, side, th, kn, out = 0.04) {
    const s = side === 'L' ? 1 : -1;
    this.rig.aim('thigh' + side, limbDir(th, out, s, this.v1), this.q1); P.set('thigh' + side, this.q1);
    this.rig.aim('shin' + side, limbDir(th - kn, out * 0.5, s, this.v1), this.q2); P.set('shin' + side, this.q2);
  }

  // ------------------------------------------------------------------ weapon / aim overlay
  upperOverlay(P) {
    const w = this.weapon;
    if (w === 'none' && this.aim < 0.01) return;
    const aimW = this.aim;
    const pitch = this.aimPitch;
    const T = new Pose();
    const chestQ = qe(-pitch * 0.35 + (P.q.hips ? 0 : 0), 0, 0, new THREE.Quaternion());
    T.set('chest', chestQ);
    T.set('head', qe(-pitch * 0.5, 0, 0));
    if (w === 'rifle' || w === 'sniper') {
      // rifle held at shoulder; low-ready when not aiming
      const up = THREE.MathUtils.lerp(0.9, Math.PI / 2 + pitch, aimW);
      this.armDirs(T, 'R', limbDir(up - 0.9, 0.35, -1), limbDir(up + 0.1, -0.35, -1), chestQ);
      this.armDirs(T, 'L', limbDir(up - 0.3, 0.2, 1), limbDir(up + 0.05, -0.55, 1), chestQ);
      T.set('chest', qe(-pitch * 0.35, -0.12 * aimW - 0.08, 0));
    } else if (w === 'pistol') {
      const up = THREE.MathUtils.lerp(0.5, Math.PI / 2 + pitch, aimW);
      this.armDirs(T, 'R', limbDir(up, 0.05, -1), limbDir(up, 0.02, -1), chestQ);
      if (aimW > 0.5) this.armDirs(T, 'L', limbDir(up - 0.05, -0.12, 1), limbDir(up, -0.45, 1), chestQ);
      else this.armTo(T, 'L', 0.05, 0.12, 0.2, chestQ);
    } else if (w === 'knife' || w === 'fists') {
      this.armTo(T, 'R', 0.6 + aimW * 0.5, 0.15, 1.5, chestQ);
      this.armTo(T, 'L', 0.7 + aimW * 0.5, 0.2, 1.7, chestQ);
    }
    blendInto(P, T, w === 'none' ? aimW : 1, ['chest', 'head', ...ARMS]);
  }

  // ------------------------------------------------------------------ loops
  loopPose(name, P) {
    const t = this.time;
    const cq = new THREE.Quaternion();
    switch (name) {
      case 'sit':
      case 'drive':
      case 'ride': {
        const bikeLean = name === 'ride' ? 0.35 : 0;
        P.set('hips', qe(-0.05 + bikeLean, 0, 0)); cq.copy(qe(-0.08 + bikeLean, 0, 0)); P.set('chest', cq);
        this.legTo(P, 'L', Math.PI / 2 - 0.05, Math.PI / 2 - (name === 'ride' ? 0.4 : 0), name === 'ride' ? 0.25 : 0.08);
        this.legTo(P, 'R', Math.PI / 2 - 0.05, Math.PI / 2 - (name === 'ride' ? 0.4 : 0), name === 'ride' ? 0.25 : 0.08);
        P.set('footL', qe(0, 0, 0)); P.set('footR', qe(0, 0, 0));
        if (name === 'drive' || name === 'ride') {
          const steer = this.steer || 0;
          this.armTo(P, 'L', 1.15 - steer * 0.25, 0.22, 0.35, cq);
          this.armTo(P, 'R', 1.15 + steer * 0.25, 0.22, 0.35, cq);
        } else {
          this.armTo(P, 'L', 0.35, 0.12, 0.9, cq); this.armTo(P, 'R', 0.35, 0.12, 0.9, cq);
        }
        P.rootY = -0.42;
        break;
      }
      case 'lie': case 'sleep': case 'dead': case 'knockedDown': case 'pinned': {
        P.rootPitch = -Math.PI / 2; P.rootY = 0.14; P.rootZ = -0.9;
        this.legTo(P, 'L', 0.05, 0.1, 0.1); this.legTo(P, 'R', 0.1, 0.25, 0.14);
        this.armTo(P, 'L', 0.2, 0.5, 0.2, cq); this.armTo(P, 'R', 0.15, 0.4, 0.3, cq);
        if (name === 'dead') { P.rootRoll = 0.2; this.armTo(P, 'R', 0.8, 1.2, 0.4, cq); }
        if (name === 'pinned' || name === 'knockedDown') { const wig = Math.sin(t * 8) * 0.15; this.armTo(P, 'L', 0.3 + wig, 0.6, 0.5, cq); this.legTo(P, 'R', 0.3 + wig, 0.6, 0.1); }
        break;
      }
      case 'handsUp': {
        this.armTo(P, 'L', 2.6, 0.5, 0.6, cq); this.armTo(P, 'R', 2.6, 0.5, 0.6, cq);
        break;
      }
      case 'grapple': {
        cq.copy(qe(0.35, 0, 0)); P.set('chest', cq); P.set('hips', qe(0.15, 0, 0));
        this.armTo(P, 'L', 1.5, 0.15, 0.6, cq); this.armTo(P, 'R', 1.5, 0.15, 0.6, cq);
        this.legTo(P, 'L', 0.35, 0.5, 0.1); this.legTo(P, 'R', -0.2, 0.3, 0.1);
        break;
      }
      case 'grappled': {
        cq.copy(qe(0.3, 0.1 * Math.sin(t * 6), 0)); P.set('chest', cq);
        this.armTo(P, 'L', 1.3, 0.3, 0.8, cq); this.armTo(P, 'R', 1.3, 0.3, 0.8, cq);
        break;
      }
      case 'pinning': {
        P.rootY = -0.75; P.set('hips', qe(0.9, 0, 0)); cq.copy(qe(1.2, 0, 0)); P.set('chest', cq);
        this.legTo(P, 'L', 1.4, 2.6, 0.3); this.legTo(P, 'R', 1.4, 2.6, 0.3);
        this.armTo(P, 'L', 0.2, 0.4, 0.2, cq); this.armTo(P, 'R', 0.2, 0.4, 0.2, cq);
        break;
      }
      case 'dribble': {
        const b = Math.sin(t * 9);
        cq.copy(qe(0.15, 0, 0));
        this.armTo(P, 'R', 0.55 + b * 0.25, 0.3, 0.6 + b * 0.4, cq);
        break;
      }
      case 'swim': {
        P.rootPitch = -1.2; P.rootY = -1.0;
        const s = Math.sin(t * 4);
        this.armTo(P, 'L', 1.6 + s * 1.2, 0.4, 0.3, cq); this.armTo(P, 'R', 1.6 - s * 1.2, 0.4, 0.3, cq);
        this.legTo(P, 'L', s * 0.3, 0.2); this.legTo(P, 'R', -s * 0.3, 0.2);
        break;
      }
      default: break;
    }
  }

  // ------------------------------------------------------------------ one-shot actions
  actionPose(name, t, P) {
    const cq = new THREE.Quaternion();
    const e = (a, b) => THREE.MathUtils.smoothstep(t, a, b);
    switch (name) {
      case 'punch': case 'punchL': {
        const side = name === 'punch' ? 'R' : 'L';
        const other = side === 'R' ? 'L' : 'R';
        const ext = e(0.1, 0.35) * (1 - e(0.6, 1));
        const twist = (side === 'R' ? 0.45 : -0.45) * ext;
        cq.copy(qe(0.1, twist, 0)); P.set('chest', cq);
        this.armTo(P, side, 1.5 * ext + 0.6 * (1 - ext), 0.05, 1.6 * (1 - ext), cq);
        this.armTo(P, other, 0.9, 0.2, 1.6, cq);
        break;
      }
      case 'slash': {
        const k = e(0.05, 0.5);
        cq.copy(qe(0.1, 0.6 - 1.2 * k, 0)); P.set('chest', cq);
        this.armTo(P, 'R', 1.4, 0.9 - 1.3 * k, 0.3, cq);
        break;
      }
      case 'kick': case 'kickBall': case 'shootBall': {
        const power = name === 'kick' ? 1.45 : name === 'shootBall' ? 1.3 : 1.0;
        const wind = e(0, 0.3), strike = e(0.3, 0.55), back = e(0.7, 1);
        const th = -0.5 * wind * (1 - strike) + power * strike * (1 - back);
        const kn = 1.2 * wind * (1 - strike) + 0.1;
        P.set('hips', qe(-0.1 * strike, 0, 0));
        this.legTo(P, 'R', th, kn * (1 - back) + 0.1);
        this.legTo(P, 'L', 0.1, 0.2);
        cq.copy(qe(-0.15 * strike, 0, 0)); P.set('chest', cq);
        this.armTo(P, 'L', 0.6, 0.6, 0.4, cq); this.armTo(P, 'R', -0.3, 0.5, 0.3, cq);
        break;
      }
      case 'recoil': case 'hit': {
        const k = Math.sin(t * Math.PI);
        cq.copy(qe(name === 'hit' ? 0.25 * k : -0.08 * k, 0, 0)); P.set('chest', cq);
        P.set('head', qe(name === 'hit' ? -0.3 * k : -0.1 * k, 0, 0));
        break;
      }
      case 'reload': {
        cq.copy(qe(0.1, -0.2, 0)); P.set('chest', cq);
        const k = e(0.1, 0.35) * (1 - e(0.6, 0.85));
        this.armTo(P, 'L', 0.9 - 0.8 * k, 0.2, 1.4 - 0.9 * k, cq);
        this.armTo(P, 'R', 1.0, 0.3, 1.2, cq);
        break;
      }
      case 'interact': {
        const k = Math.sin(t * Math.PI);
        cq.copy(qe(0.15 * k, 0, 0)); P.set('chest', cq);
        this.armTo(P, 'R', 1.3 * k, 0.1, 0.3, cq);
        break;
      }
      case 'wave': {
        cq.copy(qe(0, 0, 0));
        this.armTo(P, 'R', 2.5, 0.6 + 0.3 * Math.sin(t * 25), 0.6, cq);
        break;
      }
      case 'chestBeat': {
        const s = Math.sin(t * 30);
        cq.copy(qe(-0.2, 0, 0)); P.set('chest', cq); P.set('head', qe(-0.35, 0, 0));
        this.armTo(P, 'L', 1.2 + (s > 0 ? 0.3 : -0.1), 0.2, 1.9, cq, -0.9);
        this.armTo(P, 'R', 1.2 + (s < 0 ? 0.3 : -0.1), 0.2, 1.9, cq, -0.9);
        break;
      }
      case 'flex': {
        cq.copy(qe(-0.1, 0, 0)); P.set('chest', cq);
        this.armTo(P, 'L', 0.2, 1.45, 1.9, cq, 1.3); this.armTo(P, 'R', 0.2, 1.45, 1.9, cq, 1.3);
        break;
      }
      case 'celebrate': {
        const b = Math.sin(t * 20) * 0.2;
        this.armTo(P, 'L', 2.8 + b, 0.3, 0.2, cq); this.armTo(P, 'R', 2.8 - b, 0.3, 0.2, cq);
        break;
      }
      case 'taunt': {
        cq.copy(qe(-0.1, 0.3 * Math.sin(t * 10), 0)); P.set('chest', cq);
        this.armTo(P, 'L', 1.2, 0.8, 0.3, cq); this.armTo(P, 'R', 1.2, 0.8, 0.3 + Math.sin(t * 20) * 0.5, cq);
        break;
      }
      case 'dance': {
        const s = Math.sin(t * 24), c = Math.cos(t * 12);
        P.set('hips', qe(0, 0, s * 0.15)); cq.copy(qe(0, c * 0.3, -s * 0.1)); P.set('chest', cq);
        this.armTo(P, 'L', 1.5 + s, 0.6, 0.8, cq); this.armTo(P, 'R', 1.5 - s, 0.6, 0.8, cq);
        this.legTo(P, 'L', 0.2 + s * 0.2, 0.4); this.legTo(P, 'R', 0.2 - s * 0.2, 0.4);
        P.rootY = -0.05 * Math.abs(s);
        break;
      }
      case 'pass': {
        const k = e(0, 0.4) * (1 - e(0.6, 1));
        cq.copy(qe(0.1, 0, 0)); P.set('chest', cq);
        this.armTo(P, 'L', 0.8 + 0.7 * k, 0.2, 1.2 * (1 - k), cq); this.armTo(P, 'R', 0.8 + 0.7 * k, 0.2, 1.2 * (1 - k), cq);
        break;
      }
      case 'jumpShot': {
        const k = e(0, 0.45), rel = e(0.45, 0.6);
        cq.copy(qe(-0.05, 0, 0)); P.set('chest', cq);
        this.armTo(P, 'R', 1.6 + 1.2 * k, 0.2, 1.6 * (1 - rel) + 0.2, cq);
        this.armTo(P, 'L', 1.6 + 1.0 * k, 0.35, 1.8 * (1 - rel), cq);
        this.legTo(P, 'L', 0.1, 0.3 * (1 - k)); this.legTo(P, 'R', 0.1, 0.3 * (1 - k));
        P.rootY = 0.45 * Math.sin(Math.min(1, t / 0.9) * Math.PI);
        break;
      }
      case 'tackle': {
        const k = e(0, 0.3) * (1 - e(0.7, 1));
        P.set('hips', qe(0.2 * k, 0, 0)); cq.copy(qe(0.4 * k, 0, 0)); P.set('chest', cq);
        this.legTo(P, 'R', 1.2 * k, 0.1); this.legTo(P, 'L', -0.4 * k, 0.8 * k);
        P.rootY = -0.35 * k; P.rootRoll = 0.4 * k;
        break;
      }
      case 'throw': case 'slam': {
        const lift = e(0, 0.4), down = e(0.45, 0.75);
        cq.copy(qe(-0.3 * lift + 0.6 * down, 0, 0)); P.set('chest', cq);
        this.armTo(P, 'L', 1.3 + 1.4 * lift * (1 - down), 0.3, 0.5, cq); this.armTo(P, 'R', 1.3 + 1.4 * lift * (1 - down), 0.3, 0.5, cq);
        this.legTo(P, 'L', 0.3 * down, 0.6 * down); this.legTo(P, 'R', 0.3 * down, 0.6 * down);
        P.rootY = -0.25 * down;
        break;
      }
      case 'dropkick': {
        const k = e(0.1, 0.35) * (1 - e(0.65, 0.95));
        P.rootPitch = 1.2 * k; P.rootY = 0.9 * Math.sin(Math.min(1, t / 0.7) * Math.PI);
        this.legTo(P, 'L', 1.5 * k, 0.1); this.legTo(P, 'R', 1.5 * k, 0.1);
        this.armTo(P, 'L', 0.6, 0.8, 0.3, cq); this.armTo(P, 'R', 0.6, 0.8, 0.3, cq);
        break;
      }
      case 'reversal': {
        const k = Math.sin(t * Math.PI);
        cq.copy(qe(0.2, 0.9 * k, 0)); P.set('chest', cq);
        this.armTo(P, 'L', 1.4, 0.5, 0.8, cq); this.armTo(P, 'R', 1.2, 0.2, 0.6, cq);
        break;
      }
      case 'getUp': {
        const k = 1 - e(0, 0.8);
        P.rootPitch = -Math.PI / 2 * k; P.rootY = 0.14 * k; P.rootZ = -0.9 * k;
        this.legTo(P, 'L', 1.2 * (1 - Math.abs(0.5 - t) * 2), 2 * (1 - Math.abs(0.5 - t) * 2));
        this.armTo(P, 'L', 0.4, 0.4, 0.3, cq); this.armTo(P, 'R', 0.4, 0.4, 0.3, cq);
        break;
      }
      case 'enterCar': {
        const k = Math.sin(t * Math.PI);
        P.set('hips', qe(0.3 * k, 0, 0)); cq.copy(qe(0.4 * k, 0, 0)); P.set('chest', cq);
        this.legTo(P, 'L', 0.9 * k, 1.2 * k);
        break;
      }
      default: break;
    }
  }
}
