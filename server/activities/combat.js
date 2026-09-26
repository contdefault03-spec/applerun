// Counter-Strike-style team combat: lobby -> rounds (buy phase, live, round end) -> match end.
// Per-match economy (like CS), server-owned loadouts & ammo, elimination rounds.
import { registerActivity } from './index.js';
import { WEAPONS } from '../../shared/weapons.js';
import { getLayout } from '../../shared/map/layout.js';
import { applyReward } from '../../shared/economy.js';

const START_MONEY = 800, WIN_BONUS = 3250, LOSS_BONUS = 1400, KILL_BONUS = 300, MAX_MONEY = 16000;
const ROUNDS_TO_WIN = 5, BUY_TIME = 12, ROUND_TIME = 115, END_TIME = 5, HALFTIME_ROUND = 5;
const venue = getLayout().venues.combat;

class CombatActivity {
  constructor(room, size) {
    this.room = room; this.size = size;
    this.teams = new Map(); this.ready = new Set();
    this.phase = 'lobby'; this.t = 0; this.round = 0; this.score = [0, 0];
    this.cash = new Map(); this.alive = new Set(); this.kills = new Map(); this.deaths = new Map();
  }
  info() { return { mode: 'combat', size: this.size, phase: this.phase, teams: [...this.teams.entries()], ready: [...this.ready], host: this.room.hostId, round: this.round, score: this.score, t: Math.ceil(this.t), cash: [...this.cash.entries()], kd: [...this.teams.keys()].map((id) => [id, this.kills.get(id) || 0, this.deaths.get(id) || 0]) }; }
  broadcast() { this.room.broadcast({ t: 'actLobby', lobby: this.info() }); }
  fullState() { return { lobby: this.info() }; }
  onJoin(c) {
    const counts = [0, 0]; for (const t of this.teams.values()) counts[t]++;
    this.teams.set(c.id, counts[0] <= counts[1] ? 0 : 1);
    c.team = this.teams.get(c.id) ? 'B' : 'A';
    this.cash.set(c.id, START_MONEY);
    c.loadout = ['knife', 'glock']; c.actAmmo = { glock: 60 };
    if (this.phase !== 'lobby') { c.dead = true; c.hp = 0; } // spectate until next round
    this.broadcast();
  }
  onLeave(c) { this.teams.delete(c.id); this.ready.delete(c.id); this.alive.delete(c.id); this.checkRound(); this.broadcast(); }
  canDamage(a, b) { return this.phase === 'live' && this.teams.get(a.id) !== this.teams.get(b.id); }
  allowRespawn() { return false; }
  spawnFor(c) {
    const t = this.teams.get(c.id) ?? 0;
    const [sx, sz] = t === 0 ? venue.spawnA : venue.spawnB;
    return { x: sx + (Math.random() - 0.5) * 8, z: sz + (Math.random() - 0.5) * 8 };
  }
  request(c, op, d) {
    if (op === 'actTeam') { if (this.phase !== 'lobby') return { ok: false, error: 'Match in progress' }; this.teams.set(c.id, d.team === 1 ? 1 : 0); c.team = d.team === 1 ? 'B' : 'A'; this.broadcast(); return { ok: true }; }
    if (op === 'actReady') { if (this.ready.has(c.id)) this.ready.delete(c.id); else this.ready.add(c.id); this.broadcast(); return { ok: true }; }
    if (op === 'actStart') {
      if (c.id !== this.room.hostId) return { ok: false, error: 'Only the host can start' };
      if (this.phase !== 'lobby') return { ok: false, error: 'Already running' };
      const t = [...this.teams.values()];
      if (!t.includes(0) || !t.includes(1)) return { ok: false, error: 'Both teams need at least one player' };
      this.score = [0, 0]; this.round = 0; this.swapped = false;
      for (const id of this.teams.keys()) { this.cash.set(id, START_MONEY); this.kills.set(id, 0); this.deaths.set(id, 0); const cl = this.room.clients.get(id); if (cl) { cl.loadout = ['knife', 'glock']; cl.actAmmo = { glock: 60 }; } }
      this.newRound();
      return { ok: true };
    }
    if (op === 'actBuy') {
      if (this.phase !== 'buy' && this.phase !== 'lobby') return { ok: false, error: 'Buy time is over' };
      const w = WEAPONS[d.item];
      if (!w || !w.price) return { ok: false, error: 'Unknown weapon' };
      const money = this.cash.get(c.id) || 0;
      const price = Math.round(w.price * (d.item === 'knife' ? 0 : 1));
      if (money < price) return { ok: false, error: 'Not enough match money' };
      this.cash.set(c.id, money - price);
      c.loadout = [...new Set([...c.loadout.filter((x) => WEAPONS[x].slot !== w.slot || x === 'knife'), d.item])];
      if (w.mag) c.actAmmo[d.item] = w.mag + (w.reserve ?? w.mag * 3);
      this.broadcast();
      return { ok: true, loadout: c.loadout, ammo: c.actAmmo, cash: this.cash.get(c.id) };
    }
    return { ok: false, error: 'unknown' };
  }
  newRound() {
    this.round++;
    if (this.round === HALFTIME_ROUND && !this.swapped) {
      this.swapped = true;
      for (const id of this.teams.keys()) { const t = this.teams.get(id); this.teams.set(id, t ? 0 : 1); const cl = this.room.clients.get(id); if (cl) cl.team = t ? 'A' : 'B'; }
      this.room.broadcast({ t: 'actHalftime', round: this.round });
    }
    this.phase = 'buy'; this.t = BUY_TIME;
    this.alive = new Set(this.teams.keys());
    for (const id of this.teams.keys()) {
      const c = this.room.clients.get(id);
      if (!c) continue;
      c.dead = false; c.hp = 100; c.armor = 0; c.teleportGrace = Date.now() + 4000;
      for (const w of c.loadout) { const d = WEAPONS[w]; if (d.mag) c.actAmmo[w] = Math.max(c.actAmmo[w] || 0, d.mag + (d.reserve ?? d.mag * 3)); }
      const s = this.spawnFor(c);
      c.state.x = s.x; c.state.z = s.z;
      c.send({ t: 'respawn', id: c.id, p: [s.x, 0, s.z], hp: 100 });
      c.send({ t: 'actLoadout', loadout: c.loadout, ammo: c.actAmmo });
      this.room.broadcast({ t: 'respawn', id: c.id, p: [s.x, 0, s.z], hp: 100 }, c);
    }
    this.room.broadcast({ t: 'actRound', round: this.round, phase: 'buy', score: this.score });
    this.broadcast();
  }
  onKill(victim, killer) {
    if (this.phase !== 'live') return;
    this.alive.delete(victim.id);
    this.deaths.set(victim.id, (this.deaths.get(victim.id) || 0) + 1);
    if (killer && this.teams.get(killer.id) !== this.teams.get(victim.id)) {
      this.kills.set(killer.id, (this.kills.get(killer.id) || 0) + 1);
      this.cash.set(killer.id, Math.min(MAX_MONEY, (this.cash.get(killer.id) || 0) + KILL_BONUS));
    }
    this.checkRound();
    this.broadcast();
  }
  checkRound() {
    if (this.phase !== 'live') return;
    const aliveT = [0, 0];
    for (const id of this.alive) aliveT[this.teams.get(id)]++;
    if (aliveT[0] === 0 || aliveT[1] === 0) this.endRound(aliveT[0] > 0 ? 0 : aliveT[1] > 0 ? 1 : -1);
  }
  endRound(winner) {
    this.phase = 'roundEnd'; this.t = END_TIME;
    if (winner >= 0) this.score[winner]++;
    for (const [id, t] of this.teams) this.cash.set(id, Math.min(MAX_MONEY, (this.cash.get(id) || 0) + (t === winner ? WIN_BONUS : LOSS_BONUS)));
    this.room.broadcast({ t: 'actRound', round: this.round, phase: 'end', winner, score: this.score });
    if (this.score[0] >= ROUNDS_TO_WIN || this.score[1] >= ROUNDS_TO_WIN) {
      this.phase = 'post'; this.t = 10;
      const w = this.score[0] > this.score[1] ? 0 : 1;
      for (const [id, t] of this.teams) if (t === w) { const c = this.room.clients.get(id); if (c) { applyReward(c.profile, 'matchWin'); c.dirtyProfile = true; c.send({ t: 'profile', profile: c.profile }); } }
      this.room.broadcast({ t: 'actEnd', winner: w, score: this.score });
    }
    this.broadcast();
  }
  tick(dt) {
    if (this.phase === 'lobby') return;
    this.t -= dt;
    // keep players inside the arena: damage outside the boundary during live rounds
    if (this.phase === 'live') for (const id of this.alive) {
      const c = this.room.clients.get(id);
      if (!c) continue;
      if (Math.abs(c.state.x - venue.x) > venue.halfX || Math.abs(c.state.z - venue.z) > venue.halfZ) { c.oob = (c.oob || 0) + dt; if (c.oob > 1) { c.oob = 0; this.room.mgr.applyDamage(c, 10, null, 'out of bounds', false); } }
    }
    if (this.t > 0) { if (Math.floor(this.t + dt) !== Math.floor(this.t)) this.room.broadcast({ t: 'actClock', t: Math.ceil(this.t), phase: this.phase }); return; }
    if (this.phase === 'buy') { this.phase = 'live'; this.t = ROUND_TIME; this.room.broadcast({ t: 'actRound', round: this.round, phase: 'live', score: this.score }); this.broadcast(); }
    else if (this.phase === 'live') {
      const aliveT = [0, 0]; for (const id of this.alive) aliveT[this.teams.get(id)]++;
      this.endRound(aliveT[0] === aliveT[1] ? -1 : aliveT[0] > aliveT[1] ? 0 : 1);
    } else if (this.phase === 'roundEnd') this.newRound();
    else if (this.phase === 'post') { this.phase = 'lobby'; this.ready.clear(); for (const id of this.teams.keys()) { const c = this.room.clients.get(id); if (c) { c.dead = false; c.hp = 100; } } this.broadcast(); }
  }
}
registerActivity('combat', (room, size) => new CombatActivity(room, size));
