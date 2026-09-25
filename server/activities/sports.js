// Server-side sports/wrestling rooms: lobby (teams, ready, host start) + authoritative sim.
import { registerActivity } from './index.js';
import { FootballSim } from '../../shared/sports/football.js';
import { BasketballSim } from '../../shared/sports/basketball.js';
import { WrestlingSim } from '../../shared/sports/wrestling.js';
import { applyReward } from '../../shared/economy.js';

const perTeamOf = (size) => { const m = /^(\d)v\d$/.exec(size || ''); return m ? +m[1] : 3; };

class SportActivity {
  constructor(room, mode, size) {
    this.room = room; this.mode = mode; this.size = size;
    this.teams = new Map(); // id -> 0|1
    this.ready = new Set();
    this.phase = 'lobby';
    this.sim = null;
    this.endT = 0;
    this.lastPos = new Map();
  }
  info() { return { mode: this.mode, size: this.size, phase: this.phase, teams: [...this.teams.entries()], ready: [...this.ready], host: this.room.hostId }; }
  broadcastLobby() { this.room.broadcast({ t: 'actLobby', lobby: this.info() }); }
  fullState() { return { lobby: this.info(), snap: this.sim?.snapshot() }; }
  onJoin(c) {
    const counts = [0, 0];
    for (const t of this.teams.values()) counts[t]++;
    this.teams.set(c.id, this.mode === 'wrestling' ? 0 : counts[0] <= counts[1] ? 0 : 1);
    c.team = this.teams.get(c.id) === 0 ? 'A' : 'B';
    this.broadcastLobby();
    if (this.phase === 'match' && this.sim) this.rebuildRoster();
  }
  onLeave(c) {
    this.teams.delete(c.id); this.ready.delete(c.id);
    if (this.phase === 'match' && this.sim) this.rebuildRoster();
    this.broadcastLobby();
  }
  humans() { return [...this.teams.entries()].map(([id, team]) => ({ id, team, name: this.room.clients.get(id)?.name, strength: { ajan: 1.3, masked: 1.2, lucky: 0.9 }[this.room.clients.get(id)?.character] || 1 })); }
  rebuildRoster() {
    // swap departed humans for AI without resetting the score
    const keep = { score: this.sim.score, time: this.sim.time, phase: this.sim.phase };
    if (this.mode === 'wrestling') return;
    this.sim.setHumans(this.humans());
    Object.assign(this.sim, keep);
  }
  request(c, op, d) {
    if (op === 'actTeam') { if (this.phase !== 'lobby') return { ok: false, error: 'Match in progress' }; this.teams.set(c.id, d.team === 1 ? 1 : 0); c.team = d.team === 1 ? 'B' : 'A'; this.broadcastLobby(); return { ok: true }; }
    if (op === 'actReady') { if (this.ready.has(c.id)) this.ready.delete(c.id); else this.ready.add(c.id); this.broadcastLobby(); return { ok: true }; }
    if (op === 'actStart') {
      if (c.id !== this.room.hostId) return { ok: false, error: 'Only the host can start' };
      if (this.phase !== 'lobby') return { ok: false, error: 'Already running' };
      const per = perTeamOf(this.size);
      if (this.mode === 'football') this.sim = new FootballSim({ perTeam: [1, 3, 5, 7].reduce((a, b) => (Math.abs(b - per) < Math.abs(a - per) ? b : a)), duration: 300 });
      else if (this.mode === 'basketball') this.sim = new BasketballSim({ perTeam: per, duration: 300 });
      else this.sim = new WrestlingSim({});
      if (this.mode === 'wrestling') this.sim.setHumans(this.humans().map((h) => ({ ...h })), this.teams.size < 2 ? 1 : 0);
      else this.sim.setHumans(this.humans());
      this.sim.start();
      this.phase = 'match';
      this.room.broadcast({ t: 'actStart', lobby: this.info(), snap: this.sim.snapshot() });
      return { ok: true };
    }
    return { ok: false, error: 'unknown' };
  }
  input(c, m) {
    if (this.phase !== 'match' || !this.sim) return;
    const s = this.sim;
    const n = (v) => (Number.isFinite(+v) ? +v : 0);
    switch (m.a) {
      case 'pos': {
        const now = Date.now();
        const last = this.lastPos.get(c.id) || now - 100;
        this.lastPos.set(c.id, now);
        s.report(c.id, n(m.x), n(m.z), n(m.yaw), (now - last) / 1000);
        break;
      }
      case 'kick': s.kick?.(c.id, n(m.dx), n(m.dz), Math.max(0, Math.min(1, n(m.power))), Math.max(0, Math.min(1, n(m.loft)))); break;
      case 'tackle': s.tackle?.(c.id); break;
      case 'shoot': s.shoot?.(c.id, Math.max(0, Math.min(1, n(m.q)))); break;
      case 'pass': s.pass?.(c.id, typeof m.to === 'string' ? m.to : null); break;
      case 'steal': s.steal?.(c.id); break;
      case 'act': if (typeof m.move === 'string') s.act?.(c.id, m.move); break;
      default: break;
    }
  }
  tick(dt) {
    if (this.phase === 'match' && this.sim) {
      this.sim.step(dt);
      const ev = this.sim.drainEvents();
      this.room.broadcast({ t: 'act', snap: this.sim.snapshot(), ev });
      for (const e of ev) this.reward(e);
      if (this.sim.phase === 'end') { this.phase = 'post'; this.endT = 0; }
    } else if (this.phase === 'post') {
      this.endT += dt;
      if (this.endT > 8) { this.phase = 'lobby'; this.ready.clear(); this.sim = null; this.broadcastLobby(); }
    }
  }
  reward(e) {
    const pay = (id, kind, data) => { const c = this.room.clients.get(id); if (!c) return; applyReward(c.profile, kind, data); c.dirtyProfile = true; c.send({ t: 'profile', profile: c.profile }); };
    if (e.type === 'goal' && e.by) pay(e.by, 'goal');
    if (e.type === 'score' && e.by) pay(e.by, 'points', { points: e.pts });
    if (e.type === 'win') pay(e.id, 'wrestlingWin');
    if (e.type === 'end' && e.score) {
      const win = e.score[0] > e.score[1] ? 0 : e.score[1] > e.score[0] ? 1 : -1;
      if (win >= 0) for (const [id, t] of this.teams) if (t === win) pay(id, 'matchWin');
    }
  }
}

for (const mode of ['football', 'basketball', 'wrestling']) registerActivity(mode, (room, size) => new SportActivity(room, mode, size));
