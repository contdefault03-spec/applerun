// Rooms, player sessions, snapshot sync and server-authoritative gameplay validation.
import crypto from 'node:crypto';
import { getLayout } from '../shared/map/layout.js';
import { rayVsObb } from '../shared/map/geom.js';
import { WEAPONS, HEADSHOT_MULT } from '../shared/weapons.js';
import { applyPurchase, applyReward } from '../shared/economy.js';
import { interiorAt, interiorOrigin } from '../shared/interiors.js';
import { createActivity } from './activities/index.js';

const TICK = 1000 / 15;
const VIEW_DIST = 420;
const MAX_FOOT_SPEED = 16;   // generous (sprint + lag spikes)
const MAX_VEH_SPEED = 75;
const RESPAWN_MS = 5000;
const SAFE_ZONES = [];       // filled from layout below
const layout = getLayout();
{
  const sp = layout.spawnPoints[0];
  SAFE_ZONES.push({ x: sp.x, z: sp.z, r: 35, name: 'Pier Plaza' });
  const hb = layout.buildings[layout.special.hospital];
  if (hb) SAFE_ZONES.push({ x: hb.x, z: hb.z, r: 30, name: 'Hospital' });
}
const buildingColliders = layout.colliders.filter((c) => c.kind === 'building' || c.kind === 'stadium' || c.kind === 'arena' || c.kind === 'dome');

const now = () => Date.now();
const code6 = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += A[crypto.randomInt(A.length)]; return s; };
const clean = (s, n = 24) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const PLAYABLE = new Set(['max', 'ajan', 'rize', 'masked', 'lucky', 'dex', 'nova']);

class Client {
  constructor(ws, { id, name, character, profile }) {
    this.ws = ws; this.id = id;
    this.name = clean(name, 18) || 'Player';
    this.character = PLAYABLE.has(character) ? character : 'max';
    this.profile = profile;
    this.room = null;
    this.state = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, anim: 0, w: 'fists', v: null, seat: 0, flags: 0, act: '' };
    this.lastStateAt = 0;
    this.hp = 100; this.armor = profile.armor || 0; this.dead = false; this.deadAt = 0;
    this.history = []; // [{t,x,y,z}] for lag-compensated hit checks
    this.lastShot = {};
    this.teleportGrace = now() + 3000;
    this.passive = false; this.passiveChangedAt = 0;
    this.wanted = 0;
    this.team = null;
    this.talking = false;
    this.chatBudget = 5; this.chatAt = now();
    this.taxi = null;
    this.loadout = null; // activity-specific weapons
    this.dirtyProfile = false;
  }
  send(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
}

class Room {
  constructor(mgr, { kind = 'world', mode = 'freeroam', size = '', private: priv = false, name, hostId }) {
    this.mgr = mgr;
    this.code = code6();
    while (mgr.rooms.has(this.code)) this.code = code6();
    this.kind = kind; this.mode = mode; this.size = size;
    this.private = !!priv;
    this.name = clean(name, 32) || (kind === 'world' ? 'Bayview Free Roam' : `${mode} ${size}`);
    this.max = kind === 'world' ? 24 : 12;
    this.hostId = hostId;
    this.clients = new Map();
    this.vehicles = new Map(); // id -> vehicle
    this.dynCounter = 1;
    this.time = 13;
    this.created = now();
    this.pvp = kind === 'world' ? true : mode === 'combat';
    this.activity = kind === 'activity' ? createActivity(this, mode, size) : null;
  }
  info() { return { code: this.code, kind: this.kind, mode: this.mode, size: this.size, private: this.private, name: this.name, players: this.clients.size, max: this.max, hostId: this.hostId, pvp: this.pvp }; }
  broadcast(o, except = null) { const s = JSON.stringify(o); for (const c of this.clients.values()) if (c !== except && c.ws.readyState === 1) c.ws.send(s); }
  near(o, x, z, dist, except = null) { const s = JSON.stringify(o); for (const c of this.clients.values()) if (c !== except && c.ws.readyState === 1 && Math.hypot(c.state.x - x, c.state.z - z) < dist) c.ws.send(s); }
  playerInfo(c) { return { id: c.id, name: c.name, character: c.character, team: c.team, hp: c.hp, dead: c.dead, passive: c.passive, wanted: c.wanted }; }
  vehicleInfo(v) { return { id: v.id, type: v.type, s: v.s, driver: v.driver, passengers: v.passengers, dmg: v.dmg | 0 }; }
}

export class RoomManager {
  constructor(store) {
    this.store = store;
    this.rooms = new Map();
    this.clients = new Map();
    setInterval(() => this.tick(), TICK).unref?.();
    setInterval(() => this.saveAll(), 15000).unref?.();
  }

  connect(ws, info) {
    const old = this.clients.get(info.id);
    if (old) { old.send({ t: 'kicked', reason: 'Signed in from another tab/device' }); try { old.ws.close(4000, 'duplicate session'); } catch { /* ignore */ } this.disconnect(old); }
    const c = new Client(ws, info);
    this.clients.set(c.id, c);
    return c;
  }
  disconnect(c) {
    if (this.clients.get(c.id) === c) this.clients.delete(c.id);
    this.leave(c);
    this.saveProfile(c);
  }
  saveProfile(c) { if (c.dirtyProfile) { c.dirtyProfile = false; this.store.saveProfile(c.id, c.profile); } }
  saveAll() { for (const c of this.clients.values()) this.saveProfile(c); this.store.flush?.(); }
  publicList() { return [...this.rooms.values()].filter((r) => !r.private).map((r) => r.info()); }

  // ------------------------------------------------------------------ rooms
  join(c, room) {
    if (room.clients.size >= room.max) return { ok: false, error: 'Room is full' };
    this.leave(c);
    c.room = room;
    c.team = null;
    c.hp = 100; c.dead = false; c.teleportGrace = now() + 4000; c.history = [];
    room.clients.set(c.id, c);
    room.broadcast({ t: 'playerJoin', player: room.playerInfo(c) }, c);
    room.broadcast({ t: 'chat', sys: true, text: `${c.name} joined` }, c);
    room.activity?.onJoin?.(c);
    return {
      ok: true, room: room.info(), you: c.id, profile: c.profile, time: room.time,
      players: [...room.clients.values()].filter((o) => o !== c).map((o) => room.playerInfo(o)),
      vehicles: [...room.vehicles.values()].map((v) => room.vehicleInfo(v)),
      activity: room.activity?.fullState?.(c),
    };
  }
  leave(c) {
    const room = c.room;
    if (!room) return;
    room.clients.delete(c.id);
    c.room = null;
    // free vehicles
    for (const v of room.vehicles.values()) {
      if (v.driver === c.id) { v.driver = null; room.broadcast({ t: 'vehicle', v: room.vehicleInfo(v) }); }
      if (v.passengers.includes(c.id)) { v.passengers = v.passengers.filter((p) => p !== c.id); room.broadcast({ t: 'vehicle', v: room.vehicleInfo(v) }); }
    }
    room.activity?.onLeave?.(c);
    room.broadcast({ t: 'playerLeave', id: c.id });
    room.broadcast({ t: 'chat', sys: true, text: `${c.name} left` });
    if (room.clients.size === 0) this.rooms.delete(room.code);
    else if (room.hostId === c.id) { room.hostId = room.clients.keys().next().value; room.broadcast({ t: 'host', id: room.hostId }); }
  }

  // ------------------------------------------------------------------ requests (with response)
  async request(c, op, d) {
    const room = c.room;
    switch (op) {
      case 'listRooms': return { ok: true, rooms: this.publicList() };
      case 'quickJoin': {
        let r = [...this.rooms.values()].find((x) => x.kind === 'world' && !x.private && x.clients.size < x.max);
        if (!r) { r = new Room(this, { kind: 'world', name: 'Bayview Public', hostId: c.id }); this.rooms.set(r.code, r); }
        return this.join(c, r);
      }
      case 'createRoom': {
        const kind = d.kind === 'activity' ? 'activity' : 'world';
        const mode = kind === 'world' ? 'freeroam' : (['combat', 'football', 'basketball', 'wrestling'].includes(d.mode) ? d.mode : 'combat');
        const r = new Room(this, { kind, mode, size: clean(d.size, 6), private: d.private !== false, name: d.name, hostId: c.id });
        this.rooms.set(r.code, r);
        return this.join(c, r);
      }
      case 'joinRoom': {
        const r = this.rooms.get(String(d.code || '').toUpperCase());
        if (!r) return { ok: false, error: 'No room with that code' };
        return this.join(c, r);
      }
      case 'getProfile': return { ok: true, profile: c.profile };
      case 'buy': {
        // must be inside a gun store interior (or in an activity lobby, handled by the activity)
        const bid = interiorAt(c.state.x, c.state.z);
        const b = bid !== null ? layout.buildings[bid] : null;
        const nearStore = b && b.type === 'gunstore';
        if (!nearStore) return { ok: false, error: 'You need to be inside a gun store' };
        const r = applyPurchase(c.profile, d.item, d.qty);
        if (r.ok) { c.dirtyProfile = true; if (r.item.kind === 'armor') c.armor = 100; }
        return { ...r, profile: c.profile };
      }
      case 'useMedkit': {
        if ((c.profile.medkits | 0) <= 0) return { ok: false, error: 'No medkits' };
        if (c.dead) return { ok: false, error: 'dead' };
        c.profile.medkits--; c.hp = 100; c.dirtyProfile = true;
        room?.broadcast({ t: 'hp', id: c.id, hp: c.hp, armor: c.armor });
        return { ok: true, profile: c.profile, hp: c.hp };
      }
      case 'setPassive': {
        if (now() - c.passiveChangedAt < 8000) return { ok: false, error: 'Wait a few seconds before switching again' };
        c.passive = !!d.on; c.passiveChangedAt = now();
        room?.broadcast({ t: 'playerMeta', id: c.id, passive: c.passive });
        return { ok: true, passive: c.passive };
      }
      case 'vehEnter': return this.vehEnter(c, d);
      case 'vehSpawn': {
        if (!room) return { ok: false, error: 'not in room' };
        const type = clean(d.type, 16);
        const id = 'd' + room.dynCounter++;
        const v = { id, type, s: [num(d.x), num(d.y), num(d.z), num(d.yaw), 0, 0, 0, 0, 0], driver: null, passengers: [], dmg: 0, dyn: true, touched: now() };
        room.vehicles.set(id, v);
        room.broadcast({ t: 'vehicle', v: room.vehicleInfo(v) });
        return this.vehEnter(c, { id, seat: 0 });
      }
      case 'taxiJob': return this.taxiJob(c);
      case 'taxiPickup': return this.taxiPickup(c);
      case 'taxiDropoff': return this.taxiDropoff(c);
      case 'reward': {
        const kind = d.kind;
        if (kind === 'arrest') { const r = applyReward(c.profile, 'arrest', { fine: num(d.fine) }); c.dirtyProfile = true; c.wanted = 0; return { ...r, profile: c.profile }; }
        if (kind === 'hospital') { const r = applyReward(c.profile, 'hospital'); c.dirtyProfile = true; return { ...r, profile: c.profile }; }
        if (kind === 'robbery') {
          const bid = interiorAt(c.state.x, c.state.z);
          const b = bid !== null ? layout.buildings[bid] : null;
          if (!b || !['shop', 'cafe', 'restaurant', 'bar', 'clothing'].includes(b.type)) return { ok: false, error: 'Nothing to rob here' };
          c.robbed ??= {};
          if (now() - (c.robbed[bid] || 0) < 5 * 60000) return { ok: false, error: 'The register is empty — come back later' };
          c.robbed[bid] = now();
          const r = applyReward(c.profile, 'robbery', { amount: 150 + Math.floor(Math.random() * 300) });
          c.dirtyProfile = true;
          return { ...r, profile: c.profile };
        }
        return { ok: false, error: 'not allowed' };
      }
      case 'npcMemory': {
        const mem = (c.profile.npcMemory ||= {});
        const key = clean(d.npc, 40);
        if (d.set && typeof d.set === 'object') {
          mem[key] = { facts: (Array.isArray(d.set.facts) ? d.set.facts : []).slice(-8).map((f) => clean(f, 140)), rel: Math.max(-5, Math.min(5, num(d.set.rel))), met: num(d.set.met) };
          const keys = Object.keys(mem);
          if (keys.length > 200) delete mem[keys[0]];
          c.dirtyProfile = true;
        }
        return { ok: true, memory: mem[key] || null };
      }
      default:
        if (room?.activity?.request) return room.activity.request(c, op, d);
        return { ok: false, error: 'unknown op ' + op };
    }
  }

  // ------------------------------------------------------------------ fire-and-forget messages
  handleMessage(c, m) {
    const room = c.room;
    switch (m.t) {
      case 'ping': c.send({ t: 'pong', c: m.c }); return;
      case 'profile': {
        if (m.name) c.name = clean(m.name, 18) || c.name;
        if (PLAYABLE.has(m.character)) c.character = m.character;
        room?.broadcast({ t: 'playerMeta', id: c.id, name: c.name, character: c.character });
        return;
      }
      case 'leaveRoom': this.leave(c); return;
    }
    if (!room) return;
    switch (m.t) {
      case 'state': return this.onState(c, m);
      case 'chat': {
        const t = now();
        c.chatBudget = Math.min(5, c.chatBudget + (t - c.chatAt) / 2000); c.chatAt = t;
        if (c.chatBudget < 1) return c.send({ t: 'chat', sys: true, text: 'You are sending messages too fast.' });
        c.chatBudget--;
        const text = clean(m.text, 160);
        if (text) room.broadcast({ t: 'chat', id: c.id, name: c.name, text });
        return;
      }
      case 'fx': {
        // visual/audio events relayed to nearby players (emotes, actions, Ajan/Rize specials, sounds)
        const kind = clean(m.kind, 24);
        room.near({ t: 'fx', id: c.id, kind, a: m.a && typeof m.a === 'object' ? m.a : undefined }, c.state.x, c.state.z, 250, c);
        return;
      }
      case 'talking': c.talking = !!m.on; room.near({ t: 'talking', id: c.id, on: c.talking }, c.state.x, c.state.z, 200, c); return;
      case 'rtc': {
        const to = room.clients.get(m.to);
        if (to && m.data && JSON.stringify(m.data).length < 16000) to.send({ t: 'rtc', from: c.id, data: m.data });
        return;
      }
      case 'shoot': return this.onShoot(c, m);
      case 'melee': return this.onMelee(c, m);
      case 'vehExit': return this.vehExit(c);
      case 'vehHit': {
        const v = room.vehicles.get(m.id);
        if (v) { v.dmg = Math.min(100, (v.dmg | 0) + Math.max(0, Math.min(40, num(m.d)))); }
        return;
      }
      case 'selfDamage': {
        // damage from world hazards / NPCs (client-side AI) — only ever hurts the sender
        if (c.dead) return;
        const dmg = Math.max(0, Math.min(200, num(m.amount)));
        this.applyDamage(c, dmg, null, clean(m.cause, 20), false);
        return;
      }
      case 'respawnReq': {
        if (c.dead && now() - c.deadAt > RESPAWN_MS - 200) this.respawn(c);
        return;
      }
      case 'wanted': {
        c.wanted = Math.max(0, Math.min(5, m.level | 0));
        room.broadcast({ t: 'playerMeta', id: c.id, wanted: c.wanted }, c);
        return;
      }
      case 'setTime': {
        if (room.hostId !== c.id) return;
        room.time = Math.max(0, Math.min(24, num(m.t)));
        room.broadcast({ t: 'time', time: room.time });
        return;
      }
      case 'act': room.activity?.input?.(c, m); return;
      default: return;
    }
  }

  onState(c, m) {
    const t = now();
    const s = c.state;
    const x = num(m.p?.[0], s.x), y = num(m.p?.[1], s.y), z = num(m.p?.[2], s.z);
    const dt = Math.max(0.03, (t - (c.lastStateAt || t)) / 1000);
    const dist = Math.hypot(x - s.x, z - s.z);
    const inVeh = !!m.v;
    const maxSpeed = inVeh ? MAX_VEH_SPEED : MAX_FOOT_SPEED;
    const interiorJump = (interiorAt(x, z) !== null) !== (interiorAt(s.x, s.z) !== null); // entering/leaving interiors teleports
    if (c.lastStateAt && dist / dt > maxSpeed * 1.6 + 5 && t > c.teleportGrace && !interiorJump && !c.dead) {
      // reject impossible movement; tell the client to snap back
      c.send({ t: 'correct', p: [s.x, s.y, s.z] });
      c.suspicion = (c.suspicion || 0) + 1;
      return;
    }
    s.x = x; s.y = y; s.z = z;
    s.yaw = num(m.r); s.speed = num(m.s); s.anim = m.a | 0; s.w = WEAPONS[m.w] ? m.w : 'fists';
    s.act = typeof m.act === 'string' ? m.act.slice(0, 16) : '';
    s.aim = num(m.ap); s.ch = PLAYABLE.has(m.ch) ? m.ch : c.character;
    c.lastStateAt = t;
    c.history.push({ t, x, y, z });
    while (c.history.length && t - c.history[0].t > 1000) c.history.shift();
    // vehicle state from its driver
    if (m.v && m.vs) {
      const v = c.room.vehicles.get(m.v);
      if (v && v.driver === c.id && Array.isArray(m.vs)) { v.s = m.vs.slice(0, 10).map((n) => num(n)); v.touched = t; }
    }
  }

  tick() {
    const t = now();
    for (const room of this.rooms.values()) {
      room.activity?.tick?.(TICK / 1000);
      // per-client snapshot with interest management
      const all = [...room.clients.values()];
      for (const c of all) {
        if (c.ws.readyState !== 1) continue;
        const ps = [];
        for (const o of all) {
          if (o === c) continue;
          const s = o.state;
          if (room.kind === 'world' && Math.hypot(s.x - c.state.x, s.z - c.state.z) > VIEW_DIST) continue;
          ps.push([o.id, +s.x.toFixed(2), +s.y.toFixed(2), +s.z.toFixed(2), +s.yaw.toFixed(3), +s.speed.toFixed(2), s.anim, s.w, o.state.v || 0, s.seat || 0, o.hp | 0, s.act || '', +(s.aim || 0).toFixed(2)]);
        }
        const vs = [];
        for (const v of room.vehicles.values()) {
          if (!v.driver) continue;
          if (room.kind === 'world' && Math.hypot(v.s[0] - c.state.x, v.s[2] - c.state.z) > VIEW_DIST) continue;
          vs.push([v.id, ...v.s.map((n) => +(+n).toFixed(3))]);
        }
        c.send({ t: 'snap', ts: t, p: ps, v: vs });
      }
      // respawns
      for (const c of all) if (c.dead && t - c.deadAt > RESPAWN_MS + 15000) this.respawn(c);
      // remove abandoned dynamic vehicles
      for (const v of room.vehicles.values()) if (v.dyn && !v.driver && !v.passengers.length && t - v.touched > 10 * 60000) { room.vehicles.delete(v.id); room.broadcast({ t: 'vehicleGone', id: v.id }); }
    }
  }

  // ------------------------------------------------------------------ vehicles
  vehEnter(c, d) {
    const room = c.room;
    if (!room) return { ok: false, error: 'not in room' };
    let v = room.vehicles.get(d.id);
    if (!v && typeof d.id === 'string' && d.id.startsWith('p')) {
      const sp = layout.vehicleSpawns[+d.id.slice(1)];
      if (!sp) return { ok: false, error: 'no such vehicle' };
      v = { id: d.id, type: sp.type, s: [sp.x, 0, sp.z, sp.rot, 0, 0, 0, 0, 0], driver: null, passengers: [], dmg: 0, touched: now() };
      room.vehicles.set(v.id, v);
    }
    if (!v) return { ok: false, error: 'no such vehicle' };
    if (Math.hypot(v.s[0] - c.state.x, v.s[2] - c.state.z) > 12 && d.id[0] !== 'd') return { ok: false, error: 'too far' };
    this.vehExit(c, true);
    const seat = d.seat | 0;
    if (seat === 0) {
      if (v.driver && v.driver !== c.id) return { ok: false, error: 'Someone is driving' };
      v.driver = c.id;
    } else {
      if (v.passengers.length >= 3) return { ok: false, error: 'Vehicle is full' };
      v.passengers.push(c.id);
    }
    c.state.v = v.id; c.state.seat = seat;
    v.touched = now();
    room.broadcast({ t: 'vehicle', v: room.vehicleInfo(v) });
    return { ok: true, v: room.vehicleInfo(v) };
  }
  vehExit(c, silent = false) {
    const room = c.room;
    if (!room || !c.state.v) return;
    const v = room.vehicles.get(c.state.v);
    c.state.v = null; c.state.seat = 0;
    if (!v) return;
    if (v.driver === c.id) v.driver = null;
    v.passengers = v.passengers.filter((p) => p !== c.id);
    v.touched = now();
    if (!silent) room.broadcast({ t: 'vehicle', v: room.vehicleInfo(v) });
  }

  // ------------------------------------------------------------------ combat
  pvpAllowed(a, b) {
    const room = a.room;
    if (!room || !room.pvp) return false;
    if (room.kind === 'activity') return room.activity?.canDamage ? room.activity.canDamage(a, b) : a.team !== b.team;
    if (a.passive || b.passive) return false;
    for (const z of SAFE_ZONES) if (Math.hypot(b.state.x - z.x, b.state.z - z.z) < z.r) return false;
    return true;
  }
  ownsWeapon(c, w) {
    if (w === 'fists') return true;
    if (c.room?.kind === 'activity' && c.loadout) return c.loadout.includes(w);
    return c.profile.weapons.includes(w);
  }
  onShoot(c, m) {
    const room = c.room;
    if (c.dead) return;
    const w = WEAPONS[m.w];
    if (!w || w.type === 'melee' || !this.ownsWeapon(c, m.w)) return;
    const t = now();
    const minGap = (60000 / w.rpm) * 0.75;
    if (t - (c.lastShot[m.w] || 0) < minGap) return;
    c.lastShot[m.w] = t;
    // ammo (server-tracked total rounds)
    const ammoStore = c.room.kind === 'activity' && c.loadout ? (c.actAmmo ||= {}) : c.profile.ammo;
    if ((ammoStore[m.w] | 0) <= 0) return c.send({ t: 'ammo', w: m.w, n: 0 });
    ammoStore[m.w]--;
    if (ammoStore === c.profile.ammo) c.dirtyProfile = true;
    const o = [num(m.o?.[0]), num(m.o?.[1]), num(m.o?.[2])];
    let d = [num(m.d?.[0]), num(m.d?.[1]), num(m.d?.[2])];
    const dl = Math.hypot(...d) || 1; d = d.map((x) => x / dl);
    // origin must be near the shooter
    if (Math.hypot(o[0] - c.state.x, o[2] - c.state.z) > 4 || Math.abs(o[1] - c.state.y) > 4) return;
    room.near({ t: 'shot', id: c.id, w: m.w, o, d }, o[0], o[2], 300, c);
    const hit = m.hit;
    if (!hit || typeof hit.id !== 'string') return;
    const target = room.clients.get(hit.id);
    if (!target || target.dead || target === c || !this.pvpAllowed(c, target)) return;
    // lag-compensated check: closest approach of the ray to the target's recent positions
    let best = Infinity, bestT = 0;
    const samples = target.history.length ? target.history.filter((h) => t - h.t < 450) : [{ ...target.state }];
    for (const s of samples.length ? samples : [target.state]) {
      for (const hy of [0.3, 0.9, 1.5]) {
        const px = s.x - o[0], py = s.y + hy - o[1], pz = s.z - o[2];
        const along = px * d[0] + py * d[1] + pz * d[2];
        if (along < 0) continue;
        const cx = px - d[0] * along, cy = py - d[1] * along, cz = pz - d[2] * along;
        const dist = Math.hypot(cx, cy, cz);
        if (dist < best) { best = dist; bestT = along; }
      }
    }
    if (best > 1.25 || bestT > w.range * 1.3) return;
    // line of sight through buildings
    for (const col of buildingColliders) {
      if (Math.abs(col.x - o[0]) > bestT + 60 && Math.abs(col.x - (o[0] + d[0] * bestT)) > 60) continue;
      const th = rayVsObb(o, d, col, bestT - 0.5);
      if (th >= 0 && th < bestT - 0.5) return;
    }
    const falloff = 1 - (1 - (w.falloff ?? 1)) * Math.min(1, bestT / w.range);
    let dmg = w.damage * falloff * (hit.head ? HEADSHOT_MULT[w.type] || 2 : 1);
    this.applyDamage(target, dmg, c, m.w, !!hit.head);
  }
  onMelee(c, m) {
    const room = c.room;
    if (c.dead) return;
    const w = WEAPONS[m.w === 'knife' && this.ownsWeapon(c, 'knife') ? 'knife' : 'fists'];
    const t = now();
    if (t - (c.lastShot.melee || 0) < (60000 / w.rpm) * 0.7) return;
    c.lastShot.melee = t;
    const target = room.clients.get(m.target);
    if (!target || target.dead || target === c || !this.pvpAllowed(c, target)) return;
    if (Math.hypot(target.state.x - c.state.x, target.state.z - c.state.z) > 3.2) return;
    const str = { ajan: 1.35, masked: 1.2 }[c.character] || 1;
    this.applyDamage(target, w.damage * str, c, w.id, false, { knock: true });
  }
  applyDamage(target, dmg, attacker, cause, head, extra = {}) {
    const room = target.room;
    if (!room || target.dead) return;
    if (target.armor > 0 && attacker) { const a = Math.min(target.armor, dmg * 0.5); target.armor -= a; dmg -= a; target.profile.armor = Math.round(target.armor); target.dirtyProfile = true; }
    target.hp = Math.max(0, target.hp - dmg);
    room.broadcast({ t: 'hit', to: target.id, from: attacker?.id || null, dmg: Math.round(dmg), hp: Math.round(target.hp), armor: Math.round(target.armor), head, cause, knock: !!extra.knock });
    if (target.hp <= 0) {
      target.dead = true; target.deadAt = now();
      room.broadcast({ t: 'kill', victim: target.id, killer: attacker?.id || null, cause, head, vname: target.name, kname: attacker?.name || null });
      applyReward(target.profile, 'death'); target.dirtyProfile = true;
      if (attacker) { applyReward(attacker.profile, 'kill'); attacker.dirtyProfile = true; }
      room.activity?.onKill?.(target, attacker);
    }
  }
  respawn(c) {
    const room = c.room;
    if (!room) return;
    c.dead = false; c.hp = 100; c.teleportGrace = now() + 4000;
    let spot;
    if (room.activity?.spawnFor) spot = room.activity.spawnFor(c);
    if (!spot) {
      const hb = layout.buildings[layout.special.hospital];
      spot = hb ? { x: hb.door.x + Math.sin(hb.door.rot) * 3, z: hb.door.z + Math.cos(hb.door.rot) * 3 } : layout.spawnPoints[0];
      if (room.kind === 'world') { applyReward(c.profile, 'hospital'); c.dirtyProfile = true; }
    }
    c.state.x = spot.x; c.state.z = spot.z;
    room.broadcast({ t: 'respawn', id: c.id, p: [spot.x, 0, spot.z], hp: 100 });
    c.send({ t: 'profile', profile: c.profile });
  }

  // ------------------------------------------------------------------ taxi jobs (server-issued, server-paid)
  taxiJob(c) {
    const v = c.room?.vehicles.get(c.state.v);
    if (!v || v.type !== 'taxi' || v.driver !== c.id) return { ok: false, error: 'You need to be driving a taxi' };
    const bs = layout.buildings.filter((b) => !['cabin', 'warehouse', 'factory'].includes(b.type));
    const pick = (fn) => { for (let i = 0; i < 40; i++) { const b = bs[Math.floor(Math.random() * bs.length)]; if (fn(b)) return b; } return bs[0]; };
    const from = pick((b) => { const d = Math.hypot(b.door.x - c.state.x, b.door.z - c.state.z); return d > 60 && d < 350; });
    const to = pick((b) => { const d = Math.hypot(b.door.x - from.door.x, b.door.z - from.door.z); return d > 180 && d < 900; });
    const dist = Math.hypot(to.door.x - from.door.x, to.door.z - from.door.z);
    c.taxi = { from: { x: from.door.x, z: from.door.z }, to: { x: to.door.x, z: to.door.z }, dist, pay: Math.round(60 + dist * 0.55), stage: 'pickup', startedAt: now() };
    return { ok: true, job: c.taxi };
  }
  taxiPickup(c) {
    const j = c.taxi;
    if (!j || j.stage !== 'pickup') return { ok: false, error: 'No pickup pending' };
    if (Math.hypot(j.from.x - c.state.x, j.from.z - c.state.z) > 18) return { ok: false, error: 'Not at the pickup' };
    j.stage = 'dropoff'; j.pickedAt = now();
    return { ok: true, job: j };
  }
  taxiDropoff(c) {
    const j = c.taxi;
    if (!j || j.stage !== 'dropoff') return { ok: false, error: 'No passenger' };
    if (Math.hypot(j.to.x - c.state.x, j.to.z - c.state.z) > 20) return { ok: false, error: 'Not at the destination' };
    const secs = (now() - j.pickedAt) / 1000;
    if (secs < j.dist / 60) return { ok: false, error: 'That was impossibly fast…' };
    // bonus for speed, penalty for very slow rides
    const expected = j.dist / 14;
    const mult = secs < expected ? 1.25 : secs > expected * 3 ? 0.7 : 1;
    const r = applyReward(c.profile, 'taxi', { amount: j.pay * mult });
    c.dirtyProfile = true;
    c.taxi = null;
    return { ...r, profile: c.profile };
  }
}

export { interiorOrigin };
