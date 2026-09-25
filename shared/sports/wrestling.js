// Wrestling simulation (shared server/client). Ring-local coords, ropes at ±ROPE.
// Every move changes health / stamina / state; the referee counts pins 1-2-3.
export const ROPE = 3.2;

const MOVES = {
  punch: { range: 1.45, dmg: 5, stam: 4, cd: 0.45 },
  kick: { range: 1.75, dmg: 8, stam: 7, cd: 0.75 },
  dropkick: { range: 2.4, dmg: 14, stam: 16, cd: 1.6 },
  throw: { dmg: 10, stam: 10, down: 2.0, push: 2.6 },
  slam: { dmg: 16, stam: 20, down: 3.0, push: 0.6 },
  suplex: { dmg: 21, stam: 30, down: 3.6, push: 1.2 },
};

export class WrestlingSim {
  constructor({ maxPlayers = 2 } = {}) {
    this.max = maxPlayers;
    this.w = [];
    this.phase = 'lobby';
    this.pin = null; // {by, victim, count, t}
    this.winner = null;
    this.events = [];
    this.time = 0;
  }
  setHumans(humans, aiCount = 0) {
    this.w = [];
    const all = [...humans.map((h) => ({ ...h, human: true })), ...Array.from({ length: aiCount }, (_, i) => ({ id: `ai${i}`, name: ['Big Tony', 'The Pigeon', 'El Umbrella', 'Captain Suplex'][i % 4], human: false }))];
    all.forEach((h, i) => {
      const a = (i / all.length) * Math.PI * 2;
      this.w.push({ id: h.id, name: h.name, human: h.human, x: Math.cos(a) * 2.2, z: Math.sin(a) * 2.2, yaw: a + Math.PI, vx: 0, vz: 0, hp: 100, st: 100, state: 'stand', stateT: 0, cd: 0, grab: null, rev: 0, strength: h.strength || 1, lastAct: '' });
    });
  }
  start() { this.phase = 'play'; this.winner = null; this.pin = null; this.time = 0; this.events.push({ type: 'bell' }); }
  get(id) { return this.w.find((x) => x.id === id); }
  alive() { return this.w.filter((x) => x.state !== 'out'); }

  report(id, x, z, yaw, dt = 0.1) {
    const p = this.get(id);
    if (!p || !p.human || !['stand'].includes(p.state)) return;
    const max = 8 * Math.max(dt, 0.05) + 1;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    const k = d > max ? max / d : 1;
    p.vx = (dx * k) / Math.max(dt, 0.05); p.vz = (dz * k) / Math.max(dt, 0.05);
    p.x += dx * k; p.z += dz * k; p.yaw = yaw;
    this.ropes(p);
  }
  ropes(p) {
    for (const k of ['x', 'z']) {
      if (Math.abs(p[k]) > ROPE) {
        p[k] = Math.sign(p[k]) * ROPE;
        const vk = k === 'x' ? 'vx' : 'vz';
        if (Math.abs(p[vk]) > 3) { p[vk] = -p[vk]; this.events.push({ type: 'ropes', id: p.id }); }
      }
    }
  }
  nearestOpp(p, range = 99) {
    let best = null, bd = range;
    for (const o of this.w) { if (o === p || o.state === 'out') continue; const d = Math.hypot(o.x - p.x, o.z - p.z); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  facing(p, o) { const a = Math.atan2(o.x - p.x, o.z - p.z); let d = a - p.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); return Math.abs(d) < 1.1; }

  act(id, action) {
    const p = this.get(id);
    if (!p || this.phase !== 'play') return false;
    if (action === 'reversal') { p.rev = 0.35; if (p.state === 'grappled' && p.st > 10 && Math.random() < 0.3 + (p.st - (this.get(p.grab)?.st || 50)) / 300) { const a = this.get(p.grab); this.release(a); this.events.push({ type: 'reversal', id: p.id }); this.hitWith(p, a, 'throw'); } return true; }
    if (p.state === 'grappling') {
      if (['throw', 'slam', 'suplex'].includes(action)) {
        const v = this.get(p.grab);
        if (!v) { this.release(p); return false; }
        if (p.st < MOVES[action].stam) action = 'throw';
        this.release(p);
        this.hitWith(p, v, action);
        return true;
      }
      return false;
    }
    if (p.state !== 'stand' || p.cd > 0) return false;
    if (action === 'pin') {
      const o = this.nearestOpp(p, 1.8);
      if (o && o.state === 'down' && !this.pin) { p.state = 'pinning'; o.state = 'pinned'; o.stateT = 0; this.pin = { by: p.id, victim: o.id, count: 0, t: 0 }; this.events.push({ type: 'pin', id: p.id, victim: o.id }); return true; }
      return false;
    }
    if (action === 'grapple') {
      const o = this.nearestOpp(p, 1.4);
      p.cd = 0.8;
      if (o && o.state === 'stand' && this.facing(p, o)) {
        if (o.rev > 0) { this.events.push({ type: 'reversal', id: o.id }); p.state = 'down'; p.stateT = 1.2; return true; }
        p.state = 'grappling'; p.grab = o.id; p.stateT = 0;
        o.state = 'grappled'; o.grab = p.id; o.stateT = 0;
        o.x = p.x + Math.sin(p.yaw) * 0.85; o.z = p.z + Math.cos(p.yaw) * 0.85; o.yaw = p.yaw + Math.PI;
        this.events.push({ type: 'grapple', id: p.id, victim: o.id });
        return true;
      }
      this.events.push({ type: 'whiff', id: p.id });
      return false;
    }
    const m = MOVES[action];
    if (!m || !m.range) return false;
    if (action === 'dropkick' && Math.hypot(p.vx, p.vz) < 2.5) action = 'kick';
    const mv = MOVES[action];
    if (p.st < mv.stam) return false;
    p.st -= mv.stam; p.cd = mv.cd; p.lastAct = action;
    this.events.push({ type: 'swing', id: p.id, move: action });
    const o = this.nearestOpp(p, mv.range);
    if (o && ['stand', 'grappling'].includes(o.state) && this.facing(p, o)) {
      if (o.rev > 0 && action !== 'dropkick') { this.events.push({ type: 'reversal', id: o.id }); p.state = 'down'; p.stateT = 1; o.rev = 0; return true; }
      this.hitWith(p, o, action);
      if (action === 'dropkick') { p.state = 'down'; p.stateT = 1.1; }
    }
    return true;
  }
  release(p) { const v = this.get(p.grab); if (v) { v.state = 'stand'; v.grab = null; } p.state = 'stand'; p.grab = null; }
  hitWith(p, o, move) {
    const m = MOVES[move];
    const dmg = m.dmg * (p.strength || 1) * (0.85 + Math.random() * 0.3);
    o.hp = Math.max(0, o.hp - dmg);
    p.st = Math.max(0, p.st - (m.stam && !m.range ? m.stam : 0));
    const knock = m.down || (move === 'kick' && (o.hp < 45 || Math.random() < 0.18) ? 1.6 : 0) || (move === 'dropkick' ? 2 : 0) || (o.hp <= 0 ? 4 : 0);
    if (knock) { o.state = 'down'; o.stateT = knock + (o.hp <= 0 ? 3 : 0); }
    const push = m.push || (move === 'kick' ? 0.8 : move === 'dropkick' ? 2 : 0.3);
    o.x += Math.sin(p.yaw) * push; o.z += Math.cos(p.yaw) * push;
    this.ropes(o);
    this.events.push({ type: 'hit', id: p.id, victim: o.id, move, dmg: Math.round(dmg), hp: Math.round(o.hp), down: !!knock });
  }

  step(dt) {
    if (this.phase !== 'play') return;
    this.time += dt;
    for (const p of this.w) {
      p.cd = Math.max(0, p.cd - dt); p.rev = Math.max(0, p.rev - dt);
      p.st = Math.min(100, p.st + dt * (p.state === 'down' ? 4 : 9));
      p.stateT += p.state === 'down' ? -dt : dt;
      if (p.state === 'down' && p.stateT <= 0) { p.state = 'stand'; this.events.push({ type: 'getup', id: p.id }); }
      if (p.state === 'grappling' && p.stateT > 2.6) this.release(p);
      if (!p.human) { p.x += p.vx * dt; p.z += p.vz * dt; this.ropes(p); }
    }
    // pin count
    if (this.pin) {
      const pin = this.pin, by = this.get(pin.by), v = this.get(pin.victim);
      pin.t += dt;
      if (!by || !v) this.pin = null;
      else if (pin.t > (pin.count + 1) * 1.0) {
        pin.count++;
        this.events.push({ type: 'count', n: pin.count });
        const kickout = pin.count < 3 && Math.random() < (v.hp / 100) * 0.7 + (v.rev > 0 ? 0.25 : 0) + (v.st / 100) * 0.1;
        if (kickout) { this.events.push({ type: 'kickout', id: v.id }); by.state = 'down'; by.stateT = 0.8; v.state = 'stand'; this.pin = null; }
        else if (pin.count >= 3) {
          this.winner = by.id; this.phase = 'end';
          this.events.push({ type: 'win', id: by.id, name: by.name });
        }
      }
    }
    this.stepAI(dt);
  }
  stepAI(dt) {
    for (const p of this.w) {
      if (p.human) continue;
      p.vx *= 0.8; p.vz *= 0.8;
      if (p.state !== 'stand') {
        if (p.state === 'grappling' && p.stateT > 0.5) this.act(p.id, p.st > 30 && Math.random() < 0.4 ? 'suplex' : Math.random() < 0.5 ? 'slam' : 'throw');
        if (p.state === 'grappled' && Math.random() < dt * 0.8) this.act(p.id, 'reversal');
        continue;
      }
      const o = this.nearestOpp(p);
      if (!o) continue;
      const d = Math.hypot(o.x - p.x, o.z - p.z);
      p.yaw = Math.atan2(o.x - p.x, o.z - p.z);
      if (o.state === 'down' && d < 1.7 && Math.random() < dt * 2) { this.act(p.id, 'pin'); continue; }
      if (d > 1.2) { p.vx = Math.sin(p.yaw) * 2.6; p.vz = Math.cos(p.yaw) * 2.6; }
      else if (p.cd <= 0 && Math.random() < dt * 2.2) {
        const r = Math.random();
        this.act(p.id, r < 0.4 ? 'punch' : r < 0.65 ? 'kick' : 'grapple');
      }
      if (Math.random() < dt * 0.3) p.rev = 0.35;
    }
  }
  snapshot() {
    return {
      ph: this.phase, win: this.winner, pin: this.pin ? [this.pin.by, this.pin.victim, this.pin.count] : null,
      w: this.w.map((p) => [p.id, p.human ? 1 : 0, +p.x.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), Math.round(p.hp), Math.round(p.st), p.state, p.grab || 0, +Math.hypot(p.vx, p.vz).toFixed(1), p.name || '']),
    };
  }
  drainEvents() { const e = this.events; this.events = []; return e; }
}
