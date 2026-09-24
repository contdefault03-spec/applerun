import * as THREE from 'three';
import { Avatar } from '../characters/Avatar.js';

// Remote players: avatars, snapshot interpolation, animation flags and name tags.
// Also sends the local player's state to the server at 15 Hz.
const FLAG = { grounded: 1, crouch: 2, aim: 4, sprint: 8, swim: 16, dead: 32, vehicle: 64 };
const INTERP_MS = 120;

export class MultiplayerManager {
  constructor(game) {
    this.game = game;
    this.remotes = new Map(); // id -> remote
    this.sendAcc = 0;
    this.muted = new Set(JSON.parse(localStorage.getItem('bayview.muted') || '[]'));
    const net = game.net;
    net.on('playerJoin', (m) => this.upsert(m.player));
    net.on('playerLeave', (m) => this.remove(m.id));
    net.on('playerMeta', (m) => { const r = this.remotes.get(m.id); if (!r) return; Object.assign(r.info, m); if (m.character) r.avatar.setCharacter(m.character); if (m.name) r.avatar.setName(m.name); this.tagColor(r); });
    net.on('snap', (m) => this.onSnap(m));
    net.on('talking', (m) => { const r = this.remotes.get(m.id); if (r) { r.talking = m.on; r.avatar.setTalking(m.on); } });
    net.on('fx', (m) => this.onFx(m));
    net.on('correct', (m) => { const p = game.player; if (p && !game.vehicles?.current) { p.pos.set(m.p[0], m.p[1], m.p[2]); p.vel.set(0, 0, 0); } });
    net.on('kicked', (m) => { game.ui.notify(m.reason || 'Disconnected by server', 'bad'); });
    net.on('host', (m) => { if (game.net.room) game.net.room.hostId = m.id; });
    net.on('time', (m) => game.world.env.setTime(m.time));
    net.on('disconnected', () => this.clear());
  }

  onJoined(r) {
    this.clear();
    for (const p of r.players || []) this.upsert(p);
    if (r.time !== undefined) this.game.world.env.setTime(r.time);
  }
  onLeave() { this.clear(); }
  clear() { for (const id of [...this.remotes.keys()]) this.remove(id); }

  upsert(info) {
    let r = this.remotes.get(info.id);
    if (r) { Object.assign(r.info, info); return r; }
    const avatar = new Avatar(this.game.factory, info.character || 'max', { name: info.name || 'Player' });
    avatar.group.visible = false;
    this.game.engine.scene.add(avatar.group);
    r = { id: info.id, info: { ...info }, avatar, buf: [], talking: false, weapon: 'fists', vehicle: null, lastAct: '' };
    this.remotes.set(info.id, r);
    this.tagColor(r);
    this.game.voice?.onPeerJoined?.(info.id);
    return r;
  }
  tagColor(r) {
    const team = r.info.team;
    r.avatar.setTagColor(team === 'A' ? '#6fb6ff' : team === 'B' ? '#ff6b7a' : r.info.wanted > 0 ? '#ffd23f' : r.info.passive ? '#9aa4b5' : '#ffffff');
  }
  remove(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    r.avatar.dispose();
    this.remotes.delete(id);
    this.game.voice?.onPeerLeft?.(id);
  }

  onSnap(m) {
    const t = performance.now();
    const seen = new Set();
    for (const e of m.p) {
      const [id, x, y, z, yaw, speed, flags, w, v, seat, hp, act, aim] = e;
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r) r = this.upsert({ id, name: 'Player', character: 'max' });
      r.buf.push({ t, x, y, z, yaw, speed, flags, w, v, seat, hp, act, aim });
      if (r.buf.length > 20) r.buf.shift();
      r.avatar.group.visible = true;
    }
    // hide players outside interest range
    for (const r of this.remotes.values()) if (!seen.has(r.id)) { r.outOfRange = true; r.avatar.group.visible = false; } else r.outOfRange = false;
    this.game.vehicles?.onSnapVehicles?.(m.v);
  }

  onFx(m) {
    const r = this.remotes.get(m.id);
    if (!r) return;
    const a = m.a || {};
    switch (m.kind) {
      case 'anim': if (a.name) r.avatar.anim.play(a.name); break;
      case 'loop': r.avatar.anim.setLoop(a.name || null); break;
      default: this.game.onRemoteFx?.(m.kind, r, a); break;
    }
  }

  update(dt) {
    const g = this.game;
    // send local state
    if (g.net.connected && g.net.room && g.player) {
      this.sendAcc += dt;
      if (this.sendAcc >= 1 / 15) {
        this.sendAcc = 0;
        const p = g.player, a = g.avatar;
        let flags = 0;
        if (p.onGround) flags |= FLAG.grounded;
        if (p.crouch) flags |= FLAG.crouch;
        if (p.aiming) flags |= FLAG.aim;
        if (p.sprint) flags |= FLAG.sprint;
        if (p.swimming) flags |= FLAG.swim;
        if (p.mode === 'dead') flags |= FLAG.dead;
        const veh = g.vehicles?.current;
        if (veh) flags |= FLAG.vehicle;
        const msg = { t: 'state', p: [+p.pos.x.toFixed(2), +p.pos.y.toFixed(2), +p.pos.z.toFixed(2)], r: +a.yaw.toFixed(3), s: +p.speed.toFixed(2), a: flags, w: g.weapons?.currentId() || 'fists', act: a.anim.loop || '', ap: +(g.cam?.pitch || 0).toFixed(2), ch: a.key };
        if (veh) { msg.v = veh.netId; if (veh.isDriver) msg.vs = veh.netState(); }
        g.net.sendRaw(msg);
      }
    }
    // interpolate remotes
    const renderT = performance.now() - INTERP_MS;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) continue;
      let s0 = b[0], s1 = b[b.length - 1];
      for (let i = 0; i < b.length - 1; i++) if (b[i].t <= renderT && b[i + 1].t >= renderT) { s0 = b[i]; s1 = b[i + 1]; break; }
      const span = s1.t - s0.t;
      const k = span > 0 ? THREE.MathUtils.clamp((renderT - s0.t) / span, 0, 1) : 1;
      const av = r.avatar;
      const tx = s0.x + (s1.x - s0.x) * k, ty = s0.y + (s1.y - s0.y) * k, tz = s0.z + (s1.z - s0.z) * k;
      if (av.position.distanceToSquared(new THREE.Vector3(tx, ty, tz)) > 400) av.position.set(tx, ty, tz);
      else av.position.set(tx, ty, tz);
      let dy = s1.yaw - s0.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      av.yaw = s0.yaw + dy * k;
      const f = s1.flags;
      r.hp = s1.hp;
      // weapons in hand
      if (s1.w !== r.weapon) { r.weapon = s1.w; g.weapons?.equipRemote?.(r, s1.w); }
      // vehicle seating
      const inVeh = !!(f & FLAG.vehicle) && s1.v;
      if (inVeh) {
        g.vehicles?.seatRemote?.(r, s1.v, s1.seat);
      } else if (r.vehicle) { g.vehicles?.unseatRemote?.(r); }
      // loops (sit, grapple, dribble...) — vehicle loops handled by VehicleManager
      const act = (f & FLAG.dead) ? 'dead' : s1.act || null;
      if (!inVeh && av.anim.loop !== act) av.anim.setLoop(act || null);
      if (!inVeh) {
        av.update(dt, {
          speed: s0.speed + (s1.speed - s0.speed) * k,
          grounded: !!(f & FLAG.grounded) || !!(f & FLAG.swim),
          vy: 0, crouch: !!(f & FLAG.crouch), aim: !!(f & FLAG.aim), aimPitch: s1.aim || 0,
          weapon: g.weapons?.animFor?.(r.weapon) || 'none',
        });
      } else av.update(dt, { speed: 0 });
      // name tag visibility by distance
      if (av.tag) {
        const d = av.position.distanceTo(g.engine.camera.position);
        av.tag.sprite.visible = d < 90;
        const s = THREE.MathUtils.clamp(d * 0.045, 0.9, 2.6);
        av.tag.sprite.scale.set(1.6 * s, 0.4 * s, 1);
      }
    }
  }

  blips(out) {
    for (const r of this.remotes.values()) {
      if (!r.avatar.group.visible && !r.outOfRange) continue;
      const p = r.avatar.position;
      out.push({ x: p.x, z: p.z, color: r.info.team === 'B' ? '#ff6b7a' : r.info.wanted ? '#ffd23f' : '#4fa3ff', size: 5 });
    }
  }

  /** Nearest remote player the local player is looking at (for interactions). */
  lookTarget(maxDist = 3.5) {
    const g = this.game;
    const cam = g.engine.camera;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd);
    let best = null, bestScore = Infinity;
    for (const r of this.remotes.values()) {
      if (!r.avatar.group.visible) continue;
      const p = r.avatar.position.clone(); p.y += r.avatar.char.height * 0.6;
      const d = p.distanceTo(g.player.pos);
      if (d > maxDist) continue;
      const to = p.clone().sub(cam.position).normalize();
      const dot = to.dot(fwd);
      if (dot < 0.85) continue;
      const score = d * (2 - dot);
      if (score < bestScore) { bestScore = score; best = r; }
    }
    return best;
  }
  toggleMute(id) {
    if (this.muted.has(id)) this.muted.delete(id); else this.muted.add(id);
    localStorage.setItem('bayview.muted', JSON.stringify([...this.muted]));
    this.game.voice?.applyMute?.(id, this.muted.has(id));
    return this.muted.has(id);
  }
}
export { FLAG };
