import * as THREE from 'three';
import { Avatar } from '../characters/Avatar.js';
import { personaFor, FALLBACK } from './personas.js';

// A single AI character with a small state machine. Behaviour parameters come from the
// role profile so civilians, shopkeepers, police, gang members... act differently.
export const PROFILES = {
  civilian: { hp: 100, walk: 1.35, run: 4.6, bravery: 0.15, aggression: 0.05, armed: 0, flee: 12 },
  resident: { hp: 100, walk: 1.2, run: 4.2, bravery: 0.4, aggression: 0.25, armed: 0, flee: 10 },
  shopkeeper: { hp: 110, walk: 1.2, run: 4.2, bravery: 0.5, aggression: 0.3, armed: 0.35, flee: 8 },
  police: { hp: 140, walk: 1.5, run: 5.2, bravery: 1, aggression: 0.8, armed: 1, flee: 0 },
  gang: { hp: 120, walk: 1.4, run: 5.0, bravery: 0.8, aggression: 0.7, armed: 0.6, flee: 4 },
  junkie: { hp: 70, walk: 1.0, run: 3.8, bravery: 0.2, aggression: 0.15, armed: 0, flee: 10 },
  worker: { hp: 110, walk: 1.3, run: 4.4, bravery: 0.35, aggression: 0.2, armed: 0, flee: 10 },
  athlete: { hp: 120, walk: 1.5, run: 6.0, bravery: 0.6, aggression: 0.3, armed: 0, flee: 8 },
  medic: { hp: 100, walk: 1.4, run: 5.0, bravery: 0.5, aggression: 0, armed: 0, flee: 10 },
};

let seq = 0;
export class NPC {
  constructor(mgr, { role = 'civilian', variant = 0, identity, x, y, z, yaw = 0, fixed = false, persona = {}, interior = null }) {
    this.mgr = mgr;
    this.uid = ++seq;
    this.role = role;
    this.prof = PROFILES[role] || PROFILES.civilian;
    this.identity = identity || `npc-${role}-${Math.floor(Math.random() * 1e9)}`;
    this.persona = personaFor(this.identity, role, persona);
    const key = `npc:${role === 'resident' ? 'civilian' : role}:${variant}`;
    this.avatar = new Avatar(mgr.game.factory, key, { name: this.persona.name, showTag: false });
    this.avatar.position.set(x, y, z);
    this.avatar.yaw = yaw;
    this.hp = this.prof.hp;
    this.state = fixed ? 'idle' : 'wander';
    this.fixed = fixed;
    this.home = new THREE.Vector3(x, y, z);
    this.homeYaw = yaw;
    this.interior = interior;
    this.target = null; this.threat = null;
    this.timer = 1 + Math.random() * 3;
    this.speed = 0;
    this.vel = new THREE.Vector3();
    this.attackCd = 0; this.shootCd = 0;
    this.armed = Math.random() < this.prof.armed;
    this.weapon = this.armed ? (role === 'police' ? 'pistol' : Math.random() < 0.3 ? 'ak47' : 'glock') : 'fists';
    this.bubble = null;
    this.lodSkip = 0;
    this.collider = { kind: 'npc', dynamic: true, x, z, hx: 0.28, hz: 0.28, rot: 0, y0: y, y1: y + 1.7, owner: this, noCamera: true };
    this.heading = yaw;
    this.stuck = 0;
    this.talkingTo = null;
    this.memoryHint = null;
    this.angryAt = null;
  }
  get position() { return this.avatar.position; }
  get alive() { return this.state !== 'dead'; }
  get height() { return this.avatar.char.height; }

  say(text, dur = 3.5) { this.mgr.bubble(this, text, dur); }
  bark(kind) { const lines = BARKS[kind]?.[this.role] || BARKS[kind]?.any; if (lines) this.say(lines[Math.floor(Math.random() * lines.length)]); }
  fallbackLine() { const L = FALLBACK[this.role] || FALLBACK.civilian; return L[Math.floor(Math.random() * L.length)]; }

  // ------------------------------------------------------------------ damage
  takeDamage(dmg, attacker = null, head = false) {
    if (!this.alive) return;
    this.hp -= dmg * (head ? 2.5 : 1);
    this.avatar.anim.play('hit');
    this.mgr.game.fx?.blood(this.position.clone().add(new THREE.Vector3(0, head ? this.height * 0.9 : this.height * 0.6, 0)));
    if (this.hp <= 0) return this.die(attacker);
    if (attacker) this.provoke(attacker, 'attacked');
  }
  die(attacker) {
    this.killedBy = attacker;
    this.state = 'dead';
    this.hp = 0;
    this.deadT = 0;
    this.avatar.anim.setLoop('dead');
    this.collider.disabled = true;
    this.mgr.onDeath(this, attacker);
  }
  knockDown(dir, force) {
    if (!this.alive) return;
    this.state = 'knocked';
    this.timer = 2.5 + Math.random();
    this.avatar.anim.setLoop('knockedDown');
    this.vel.set(dir.x * force, 0, dir.z * force);
  }
  /** Something threatening happened involving `src` ({position} or the player). */
  provoke(src, why) {
    if (!this.alive || this.state === 'knocked') return;
    this.talkingTo = null;
    const brave = Math.random() < this.prof.bravery;
    const aggressive = Math.random() < this.prof.aggression || why === 'attacked' && brave;
    if (this.role === 'police') { this.threat = src; this.state = this.armed ? 'shoot' : 'fight'; this.timer = 20; return; }
    if (aggressive && (this.armed || why === 'attacked')) {
      this.threat = src;
      this.state = this.armed ? 'shoot' : 'fight';
      this.timer = 15;
      this.bark('fight');
    } else {
      this.threat = src;
      this.state = Math.random() < 0.2 && why !== 'attacked' ? 'cower' : 'flee';
      this.timer = this.prof.flee + Math.random() * 4;
      this.bark('scared');
      if (this.role !== 'gang' && Math.random() < 0.35) this.callPolice = 4 + Math.random() * 3;
    }
  }

  // ------------------------------------------------------------------ update
  update(dt, ctx) {
    const a = this.avatar;
    this.attackCd -= dt; this.shootCd -= dt; this.timer -= dt;
    let want = null, speed = 0, face = null;
    const pos = this.position;
    switch (this.state) {
      case 'dead': this.deadT += dt; break;
      case 'knocked':
        pos.addScaledVector(this.vel, dt); this.vel.multiplyScalar(Math.exp(-dt * 4));
        if (this.timer <= 0) { this.avatar.anim.setLoop(null); this.avatar.anim.play('getUp'); this.state = this.threat ? 'flee' : 'wander'; this.timer = 6; this.bark('angry'); }
        break;
      case 'idle':
        if (this.fixed) { face = this.facePlayerIfClose(ctx, 5) ?? this.homeYaw; if (pos.distanceTo(this.home) > 0.5) { want = this.home; speed = this.prof.walk; } }
        else if (this.timer <= 0) { this.state = 'wander'; this.timer = 4 + Math.random() * 8; }
        break;
      case 'sit': case 'lie': face = null; break;
      case 'wander':
        if (!this.target || this.timer <= 0 || pos.distanceTo(this.target) < 1) {
          this.target = this.mgr.pickWanderTarget(this);
          this.timer = 6 + Math.random() * 8;
          if (Math.random() < 0.15) { this.state = 'idle'; this.timer = 2 + Math.random() * 5; this.target = null; }
        }
        if (this.target) {
          // stop and check for traffic before actually stepping onto a road being crossed
          if (this.crossRoad && this.mgr.trafficDanger(pos, this.crossRoad)) { speed = 0; face = null; break; }
          if (this.crossRoad) this.crossRoad = null; // clear once it's safe to go (checked again next tick if still mid-crossing)
          want = this.target; speed = this.jogger ? this.prof.run : this.prof.walk;
        }
        break;
      case 'talkPlayer':
        face = Math.atan2(ctx.player.x - pos.x, ctx.player.z - pos.z);
        if (pos.distanceTo(ctx.player) > 8) { this.talkingTo = null; this.state = this.fixed ? 'idle' : 'wander'; }
        break;
      case 'flee': {
        const src = this.threatPos();
        if (src) { const away = pos.clone().sub(src).setY(0).normalize(); want = pos.clone().addScaledVector(away, 8); }
        speed = this.prof.run;
        if (this.timer <= 0) { this.state = this.fixed ? 'idle' : 'wander'; this.threat = null; }
        break;
      }
      case 'cower':
        face = null;
        if (this.timer <= 0) { this.state = 'flee'; this.timer = 6; }
        break;
      case 'fight': {
        const t = this.threatPos();
        if (!t || this.timer <= 0 || !this.threatAlive()) { this.state = this.fixed ? 'idle' : 'wander'; this.threat = null; break; }
        const d = pos.distanceTo(t);
        face = Math.atan2(t.x - pos.x, t.z - pos.z);
        if (d > 1.25) { want = t; speed = this.prof.run * 0.85; }
        else if (this.attackCd <= 0) { this.attackCd = 0.8 + Math.random() * 0.5; this.avatar.anim.play(Math.random() < 0.5 ? 'punch' : 'punchL'); setTimeout(() => this.mgr.npcMelee(this), 180); }
        if (d > 30) { this.state = 'wander'; this.threat = null; }
        break;
      }
      case 'shoot': {
        const t = this.threatPos();
        if (!t || this.timer <= 0 || !this.threatAlive()) { this.state = this.fixed ? 'idle' : 'wander'; this.threat = null; break; }
        const d = pos.distanceTo(t);
        face = Math.atan2(t.x - pos.x, t.z - pos.z);
        // never shoot through a wall: an NPC (police included) with no line of sight advances or
        // repositions to try to find an angle instead of camping and spraying a blocked shot
        const hasLOS = this.mgr.hasLineOfSight(pos, t);
        if (d > 22 || !hasLOS) { want = t; speed = this.prof.run * 0.8; }
        else if (d < 5 && this.role !== 'police') { const away = pos.clone().sub(t).setY(0).normalize(); want = pos.clone().addScaledVector(away, 4); speed = this.prof.walk; }
        if (this.shootCd <= 0 && d < 45 && hasLOS) { this.shootCd = (this.weapon === 'ak47' ? 0.25 : 0.7) + Math.random() * 0.6; this.mgr.npcShoot(this, t, d); }
        if (d > 70) { this.state = 'wander'; this.threat = null; }
        break;
      }
      case 'goto':
        if (this.target) { want = this.target; speed = this.runTo ? this.prof.run : this.prof.walk; if (pos.distanceTo(this.target) < 1.2) { this.target = null; this.state = this.after || 'idle'; this.timer = 5; this.onArrive?.(); } }
        break;
      default: break;
    }
    if (this.callPolice !== undefined) { this.callPolice -= dt; if (this.callPolice <= 0) { this.callPolice = undefined; this.mgr.game.police?.npcReport?.(this); } }
    // movement
    if (want && this.state !== 'dead' && this.state !== 'knocked') {
      const dx = want.x - pos.x, dz = want.z - pos.z;
      const L = Math.hypot(dx, dz);
      if (L > 0.3) {
        const tgt = Math.atan2(dx, dz);
        let d = tgt - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.heading += d * Math.min(1, dt * 6);
        const k = Math.min(speed, L * 2);
        const before = pos.clone();
        pos.x += Math.sin(this.heading) * k * dt; pos.z += Math.cos(this.heading) * k * dt;
        const col = this.mgr.game.world.collision;
        const r = col.resolve(pos, 0.3, 1.7, 0.5, this.collider);
        pos.y = this.interior ? Math.max(0, r.ground) : r.ground;
        const moved = pos.distanceTo(before);
        this.speed = moved / dt;
        if (r.hitWall && moved < k * dt * 0.3) { this.stuck += dt; if (this.stuck > 0.8) { this.target = null; this.heading += Math.PI * (0.5 + Math.random()); this.stuck = 0; if (this.state === 'wander') this.timer = 0; } }
        else this.stuck = 0;
      } else this.speed = 0;
    } else this.speed = Math.max(0, this.speed - dt * 8);
    if (face !== null && face !== undefined) { let d = face - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d)); this.heading += d * Math.min(1, dt * 5); }
    a.yaw = this.heading;
    this.collider.x = pos.x; this.collider.z = pos.z; this.collider.y0 = pos.y; this.collider.y1 = pos.y + this.height;
    // animation (LOD by distance)
    const dist = ctx.camDist;
    this.lodSkip++;
    const every = dist < 40 ? 1 : dist < 90 ? 2 : 4;
    if (this.lodSkip % every === 0) {
      const aim = this.state === 'shoot';
      const loop = this.state === 'dead' ? 'dead' : this.state === 'knocked' ? 'knockedDown' : this.state === 'sit' ? 'sit' : this.state === 'lie' ? 'lie' : this.state === 'cower' ? null : this.handsUp ? 'handsUp' : null;
      if (a.anim.loop !== loop && !(this.state === 'knocked')) a.anim.setLoop(loop);
      a.update(dt * every, { speed: this.speed, crouch: this.state === 'cower', aim, aimPitch: 0, weapon: aim ? (this.weapon === 'ak47' ? 'rifle' : 'pistol') : 'none' });
    }
  }
  facePlayerIfClose(ctx, d) { const p = ctx.player; return this.position.distanceTo(p) < d ? Math.atan2(p.x - this.position.x, p.z - this.position.z) : null; }
  threatPos() { const t = this.threat; if (!t) return null; return t.isVector3 ? t : t.position || null; }
  threatAlive() { const t = this.threat; if (!t) return false; if (t.alive !== undefined) return t.alive; if (t === this.mgr.game.avatar) return this.mgr.game.player.mode !== 'dead'; return true; }
}

const BARKS = {
  scared: { any: ['AAAH!', 'Oh my god!', "Don't shoot!", 'Somebody help!', 'Run!!', "I'm calling the cops!"], gang: ['Yo what the—'], police: [] },
  fight: { any: ['You want some?!', "Let's go!", "You're gonna regret that!"], gang: ['You picked the wrong block!', 'Get him!'], police: ['Drop the weapon!', 'Freeze!'] },
  angry: { any: ['Watch where you\'re going!', 'Are you crazy?!', 'Idiot!', 'My back...'] },
  trespass: { any: ['What the hell are you doing in my house?!', 'Can I help you?!', 'Get out before I call the cops!', 'Who let you in?!'] },
};
export { BARKS };
