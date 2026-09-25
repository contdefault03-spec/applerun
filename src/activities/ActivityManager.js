import * as THREE from 'three';
import { Avatar } from '../characters/Avatar.js';
import { FootballSim, HL, HW } from '../../shared/sports/football.js';
import { BasketballSim, HALF_L, HALF_W } from '../../shared/sports/basketball.js';
import { WrestlingSim, ROPE } from '../../shared/sports/wrestling.js';
import { WEAPONS } from '../../shared/weapons.js';
import { NPC } from '../npc/NPC.js';
import { DOME_ID } from '../interiors/InteriorManager.js';
import { h } from '../ui/dom.js';

// Activities: football, basketball, wrestling (shared sims — server-run in rooms, local in
// solo quick play) and CS-style combat (server rounds in rooms, local bots in solo).
const MODE_NAMES = { football: 'Football', basketball: 'Basketball', wrestling: 'Wrestling', combat: 'Gunfight' };

export class ActivityManager {
  constructor(game) {
    this.game = game;
    this.s = null; // session
    const net = game.net;
    net.on('actLobby', (m) => { if (this.s?.kind === 'net') { this.s.lobby = m.lobby; this.renderLobby(); this.updateTeamTags(); } });
    net.on('actStart', (m) => { if (this.s?.kind === 'net') { this.s.lobby = m.lobby; this.beginMatch(m.snap); } });
    net.on('act', (m) => { if (this.s?.kind === 'net') this.onSnap(m.snap, m.ev); });
    net.on('actRound', (m) => this.onRound(m));
    net.on('actEnd', (m) => { const my = this.myTeam(); this.game.hud.bigMessage(m.winner === my ? 'VICTORY' : 'DEFEAT', `Final score ${m.score[0]} - ${m.score[1]}`, 6, m.winner === my ? '#7dff9b' : '#ff4757'); });
    net.on('actLoadout', (m) => { if (this.s?.mode === 'combat') this.game.weapons.setLoadout({ weapons: m.loadout, ammo: m.ammo }); });
    net.on('actClock', (m) => { if (this.s) this.s.clock = m.t; });
    this.ballMesh = null;
  }
  get inActivity() { return !!this.s; }

  // ------------------------------------------------------------------ entering / leaving
  async create(mode, size) {
    const g = this.game;
    await g.startAudio();
    if (size === 'solo' || !g.net.connected) return this.startLocal(mode, size === 'solo' ? null : size);
    this.rememberWorld();
    const r = await g.net.request('createRoom', { kind: 'activity', mode, size, private: true, name: `${MODE_NAMES[mode]} ${size}` });
    if (!r.ok) return g.ui.notify(r.error || 'Could not create activity', 'bad');
    g.onJoined(r);
    this.enterNet(r);
    g.ui.notify(`${MODE_NAMES[mode]} room created — code ${r.room.code}. Share it with friends!`, 'good');
  }
  rememberWorld() {
    const g = this.game;
    this.returnTo = { pos: g.player ? g.player.pos.clone() : null, room: g.net.room?.kind === 'world' ? g.net.room.code : null };
  }
  enterNet(r) {
    const g = this.game;
    if (!this.returnTo) this.rememberWorld();
    if (!g.player) g.spawnPlayer();
    this.s = { kind: 'net', mode: r.room.mode, size: r.room.size, code: r.room.code, lobby: r.activity?.lobby, snap: null, prev: null, avatars: new Map(), clock: 0 };
    g.inActivity = true;
    g.ui.clearMenus();
    g.setMode('playing');
    this.placeInLobby();
    this.renderLobby();
    if (r.activity?.snap) this.beginMatch(r.activity.snap);
  }
  placeInLobby() {
    const g = this.game;
    const v = g.layout.venues;
    const m = this.s.mode;
    if (m === 'wrestling') { g.interiors.enter(DOME_ID).then(() => g.player.teleport(g.interiors.current.origin.x + 5, 0, g.interiors.current.origin.z + 6)); return; }
    const p = m === 'football' ? { x: v.football.x - 30, z: v.football.z + HW + 6 } : m === 'basketball' ? { x: v.basketball.x, z: v.basketball.z + HALF_W + 3 } : { x: v.combat.spawnA[0], z: v.combat.spawnA[1] };
    if (g.interiors.current) g.interiors.exit();
    g.player.teleport(p.x, null, p.z);
  }

  async startLocal(mode, size) {
    const g = this.game;
    this.rememberWorld();
    if (!g.player) g.spawnPlayer();
    if (g.net.room) { g.net.send('leaveRoom'); g.net.room = null; g.mp.clear(); }
    this.s = { kind: 'local', mode, size: size || 'solo', avatars: new Map(), clock: 0, bots: [] };
    g.inActivity = true;
    g.ui.clearMenus();
    g.setMode('playing');
    g.input.lock();
    const me = { id: 'me', team: 0, name: g.settings.get('player.name'), strength: g.avatar.char.def.stats?.strength || 1 };
    if (mode === 'football') { this.s.sim = new FootballSim({ perTeam: 5, duration: 240 }); this.s.sim.setHumans([me]); }
    else if (mode === 'basketball') { this.s.sim = new BasketballSim({ perTeam: 3, duration: 240 }); this.s.sim.setHumans([me]); }
    else if (mode === 'wrestling') { await this.game.interiors.enter(DOME_ID); this.s.sim = new WrestlingSim({}); this.s.sim.setHumans([me], 1); }
    if (this.s.sim) { this.s.sim.start(); this.beginMatch(this.s.sim.snapshot()); }
    else if (mode === 'combat') this.startLocalCombat();
  }

  async leave() {
    const g = this.game;
    const s = this.s;
    if (!s) return;
    this.cleanup();
    this.s = null;
    g.inActivity = false;
    g.weapons.setLoadout(null);
    g.hud.setActivity(null);
    g.hud.setMeter(null);
    this.lobbyEl?.remove(); this.lobbyEl = null;
    this.removeScoreboard();
    g.avatar.anim.setLoop(null);
    g.player.mode = 'foot';
    if (g.interiors.current) await g.interiors.exit();
    if (s.kind === 'net') { g.net.send('leaveRoom'); g.net.room = null; g.mp.clear(); }
    if (g.net.connected) {
      const r = this.returnTo?.room ? await g.net.request('joinRoom', { code: this.returnTo.room }) : await g.net.request('quickJoin', {});
      if (r.ok) g.onJoined(r);
    }
    const back = this.returnTo?.pos || g.layout.spawnPoints[0];
    g.player.teleport(back.x, null, back.z);
    this.returnTo = null;
    g.ui.notify('Back to free roam.', 'info');
  }
  cleanup() {
    const g = this.game;
    for (const a of this.s?.avatars.values() || []) a.dispose();
    if (this.ballMesh) { this.ballMesh.removeFromParent(); this.ballMesh = null; }
    for (const b of this.s?.bots || []) { g.npcs.extra = (g.npcs.extra || []).filter((x) => x !== b); g.npcs.remove(b); }
  }

  // ------------------------------------------------------------------ lobby UI (non-blocking panel)
  // Combat scoreboard (Tab), shown during live rounds when the buy/team lobby panel is hidden:
  // kills, deaths and match money per player. There's no assist tracking on the server yet, so
  // that column always reads "–".
  renderScoreboard() {
    const g = this.game, s = this.s, L = s?.lobby;
    if (!s || s.mode !== 'combat' || !L) return;
    const teamOf = new Map(L.teams), cashOf = new Map(L.cash || []);
    const row = (id) => {
      const kd = L.kd?.find((k) => k[0] === id) || [id, 0, 0];
      const nm = id === g.net.id ? `${g.settings.get('player.name')} (you)` : g.mp.remotes.get(id)?.avatar.name || id;
      return h('tr', h('td', nm), h('td', kd[1]), h('td', kd[2]), h('td', '–'), h('td', `$${cashOf.get(id) ?? 0}`));
    };
    const ids = (t) => [...teamOf.entries()].filter(([, x]) => x === t).map(([id]) => id);
    const table = (label, t) => h('div', h('h4', label), h('table.scoreboard', h('tr', h('th', 'Player'), h('th', 'K'), h('th', 'D'), h('th', 'A'), h('th', 'Money')), ...ids(t).map(row)));
    const body = h('div.panel', { style: { position: 'fixed', left: '50%', top: '90px', transform: 'translateX(-50%)', width: 'min(560px, 92vw)', padding: '14px 18px', zIndex: 15 } },
      h('div.row', h('b', 'Scoreboard'), h('div.spacer'), h('span.tag', `${L.score[0]} - ${L.score[1]}`)),
      table('Team A', 0), table('Team B', 1),
    );
    this.scoreboardEl?.remove();
    this.scoreboardEl = body;
    document.getElementById('ui').append(body);
  }
  removeScoreboard() { this.scoreboardEl?.remove(); this.scoreboardEl = null; this.scoreboardOn = false; }

  renderLobby() {
    const g = this.game;
    const s = this.s;
    if (!s || s.kind !== 'net' || !s.lobby) return;
    const L = s.lobby;
    if (L.phase === 'match' || (s.mode === 'combat' && ['live', 'roundEnd'].includes(L.phase))) { this.lobbyEl?.remove(); this.lobbyEl = null; if (s.mode !== 'combat') return; }
    const isHost = L.host === g.net.id;
    const teamOf = new Map(L.teams);
    const names = (t) => [...teamOf.entries()].filter(([, x]) => x === t).map(([id]) => {
      const nm = id === g.net.id ? `${g.settings.get('player.name')} (you)` : g.mp.remotes.get(id)?.avatar.name || id;
      const kd = L.kd?.find((k) => k[0] === id);
      return h('div', `${L.ready.includes(id) ? '✅' : '⬜'} ${nm}${kd ? ` — ${kd[1]}/${kd[2]}` : ''}${id === L.host ? ' ★' : ''}`);
    });
    const my = teamOf.get(g.net.id);
    const cash = L.cash ? new Map(L.cash).get(g.net.id) : null;
    const buy = s.mode === 'combat' && (L.phase === 'lobby' || L.phase === 'buy') ? h('div', h('h3', `Buy menu — match money $${cash ?? 0}`),
      h('div.shop-grid', ...Object.values(WEAPONS).filter((w) => w.price && w.id !== 'knife').map((w) => h('div.shop-item', h('b', w.name), h('div.muted', { style: { fontSize: '12px' } }, `Dmg ${w.damage} · ${w.rpm} rpm`), h('div.price', `$${w.price}`),
        h('button.btn.small.primary', { onclick: async () => { const r = await g.net.request('actBuy', { item: w.id }); if (r.ok) { g.weapons.setLoadout({ weapons: r.loadout, ammo: r.ammo }); g.audio.cash(); } else g.ui.notify(r.error, 'bad'); } }, 'Buy'))))) : null;
    const body = h('div.panel', { style: { position: 'fixed', right: '20px', top: '80px', width: 'min(460px, 92vw)', padding: '16px 18px', zIndex: 15, maxHeight: '80vh', overflow: 'auto' } },
      h('div.row', h('b', { style: { fontFamily: 'var(--display)', fontSize: '30px' } }, `${MODE_NAMES[s.mode]} ${s.size}`), h('div.spacer'), h('span.tag', `CODE ${s.code}`)),
      s.mode === 'combat' && L.phase !== 'lobby' ? h('div.muted', `Round ${L.round} · ${L.phase} · ${L.score[0]} - ${L.score[1]} · ${L.t}s`) : h('div.muted', { style: { fontSize: '13px' } }, 'Pick a team, ready up — the host starts the match. Empty spots are filled with AI.'),
      s.mode === 'wrestling' ? h('div.team.a', h('h4', 'Wrestlers'), ...names(0), ...names(1)) :
        h('div.team-cols', h('div.team.a', h('h4', s.mode === 'combat' ? 'Team A' : 'Blue'), ...names(0), L.phase === 'lobby' && my !== 0 ? h('button.btn.small', { onclick: () => g.net.request('actTeam', { team: 0 }) }, 'Join') : null),
          h('div.team.b', h('h4', s.mode === 'combat' ? 'Team B' : 'Red'), ...names(1), L.phase === 'lobby' && my !== 1 ? h('button.btn.small', { onclick: () => g.net.request('actTeam', { team: 1 }) }, 'Join') : null)),
      buy,
      L.phase === 'lobby' ? h('div.row', { style: { marginTop: '12px' } }, h('button.btn', { onclick: () => g.net.request('actReady') }, L.ready.includes(g.net.id) ? 'Unready' : 'Ready'), h('div.spacer'), isHost ? h('button.btn.primary', { onclick: async () => { const r = await g.net.request('actStart'); if (!r.ok) g.ui.notify(r.error, 'bad'); } }, 'Start match') : h('span.muted', 'Waiting for host…')) : null,
      h('div.row', { style: { marginTop: '10px' } }, h('div.muted', { style: { fontSize: '12px' } }, 'Tab: close this panel · Esc: menu (leave activity)'), h('div.spacer'), h('button.btn.small.danger', { onclick: () => this.leave() }, 'Leave')),
    );
    this.lobbyEl?.remove();
    this.lobbyEl = body;
    document.getElementById('ui').append(body);
  }
  updateTeamTags() {
    const g = this.game;
    const L = this.s?.lobby;
    if (!L) return;
    for (const [id, t] of L.teams) { const r = g.mp.remotes.get(id); if (r) { r.info.team = t === 0 ? 'A' : 'B'; g.mp.tagColor(r); } }
  }

  // ------------------------------------------------------------------ match lifecycle
  async beginMatch(snap) {
    const g = this.game;
    const s = this.s;
    if (s.mode === 'wrestling' && !g.interiors.current) await g.interiors.enter(DOME_ID);
    this.lobbyEl?.remove(); this.lobbyEl = null;
    s.snap = snap; s.prev = snap;
    s.started = true;
    if (s.mode === 'football' || s.mode === 'basketball') {
      const ball = s.mode === 'football' ? footballMesh() : basketballMesh();
      g.engine.scene.add(ball);
      this.ballMesh = ball;
    }
    // move my avatar to my sim position
    const me = this.myId();
    const sp = this.simPlayer(snap, me);
    if (sp) { const w = this.toWorld(sp.x, sp.z); g.player.teleport(w.x, w.y, w.z); }
    g.hud.bigMessage(MODE_NAMES[s.mode].toUpperCase(), s.mode === 'football' ? 'LMB pass · RMB shoot (hold for power) · E tackle' : s.mode === 'basketball' ? 'Hold & release RMB to shoot (meter) · LMB pass · E steal/block' : 'LMB punch · R kick · E grapple → LMB throw / RMB slam / R suplex · Q reverse · Space pin', 5);
    g.audio.whistle(g.player.pos); g.audio.crowd(0.4);
  }
  myId() { return this.s.kind === 'local' ? 'me' : this.game.net.id; }
  myTeam() { const L = this.s?.lobby; if (!L) return 0; return new Map(L.teams).get(this.game.net.id) ?? 0; }

  // coordinate transforms: sim-local <-> world
  toWorld(x, z) {
    const g = this.game;
    const v = g.layout.venues;
    if (this.s.mode === 'football') return new THREE.Vector3(v.football.x + x, 0.05, v.football.z + z);
    if (this.s.mode === 'basketball') return new THREE.Vector3(v.basketball.x + x, 0.06, v.basketball.z + z);
    if (this.s.mode === 'wrestling') { const o = g.interiors.current?.origin || { x: 0, z: 0 }; return new THREE.Vector3(o.x + x, 1.2, o.z + z); }
    return new THREE.Vector3(x, 0, z);
  }
  toLocal(p) {
    const g = this.game;
    const v = g.layout.venues;
    if (this.s.mode === 'football') return { x: p.x - v.football.x, z: p.z - v.football.z };
    if (this.s.mode === 'basketball') return { x: p.x - v.basketball.x, z: p.z - v.basketball.z };
    if (this.s.mode === 'wrestling') { const o = g.interiors.current?.origin || { x: 0, z: 0 }; return { x: p.x - o.x, z: p.z - o.z }; }
    return { x: p.x, z: p.z };
  }
  simPlayer(snap, id) {
    if (!snap) return null;
    if (this.s.mode === 'wrestling') { const w = snap.w?.find((x) => x[0] === id); return w ? { x: w[2], z: w[3], yaw: w[4], hp: w[5], st: w[6], state: w[7], grab: w[8], speed: w[9], name: w[10], human: w[1] } : null; }
    const p = snap.p?.find((x) => x[0] === id);
    return p ? { team: p[1], human: p[2], x: p[3], z: p[4], yaw: p[5], speed: p[6], role: p[7] } : null;
  }

  onSnap(snap, ev) {
    const s = this.s;
    if (!s) return;
    if (!s.started && snap) this.beginMatch(snap);
    s.prev = s.snap; s.prevT = s.snapT; s.snap = snap; s.snapT = performance.now();
    for (const e of ev || []) this.onEvent(e);
  }
  onRound(m) {
    const g = this.game;
    if (!this.s || this.s.mode !== 'combat') return;
    if (m.phase === 'buy') { g.hud.bigMessage(`ROUND ${m.round}`, `Buy phase — ${m.score[0]} : ${m.score[1]}`, 3); this.renderLobby(); }
    if (m.phase === 'live') { g.hud.bigMessage('GO GO GO!', '', 1.5, '#ffd23f'); this.lobbyEl?.remove(); this.lobbyEl = null; g.audio.bell(); }
    if (m.phase === 'end') { const my = this.myTeam(); g.hud.bigMessage(m.winner === -1 ? 'DRAW' : m.winner === my ? 'ROUND WON' : 'ROUND LOST', `${m.score[0]} : ${m.score[1]}`, 3, m.winner === my ? '#7dff9b' : '#ff4757'); }
  }

  onEvent(e) {
    const g = this.game;
    const s = this.s;
    const av = (id) => (id === this.myId() ? g.avatar : s.avatars.get(id) || g.mp.remotes.get(id)?.avatar);
    const bp = this.ballMesh ? this.ballMesh.position : g.player.pos;
    switch (e.type) {
      case 'kick': av(e.id)?.anim.play(e.power > 0.6 ? 'shootBall' : 'kickBall'); g.audio.kickBall(bp, e.power); break;
      case 'tackle': av(e.id)?.anim.play('tackle'); break;
      case 'bounce': g.audio.bounce(bp, 0.3); break;
      case 'dribble': g.audio.bounce(bp, 0.25); break;
      case 'goal': {
        const my = s.kind === 'local' ? 0 : this.myTeam();
        g.hud.bigMessage('GOAL!', `${e.score[0]} - ${e.score[1]}`, 3, e.team === my ? '#7dff9b' : '#ff4757');
        g.audio.crowd(1); g.audio.whistle(bp);
        av(e.by)?.anim.play('celebrate');
        if (s.kind === 'local' && e.by === 'me') g.net.request('reward', { kind: 'event', amount: 50 }).then((r) => r.profile && g.setProfile(r.profile));
        break;
      }
      case 'kickoff': g.audio.whistle(bp); break;
      case 'out': g.audio.whistle(bp); break;
      case 'shot': av(e.id)?.anim.play('jumpShot'); break;
      case 'pass': av(e.id)?.anim.play('pass'); break;
      case 'rim': g.audio.impact(bp, 'metal'); break;
      case 'board': g.audio.impact(bp); break;
      case 'score': g.audio.swish(bp); g.audio.crowd(0.8); g.hud.bigMessage(`+${e.pts}`, `${e.score[0]} - ${e.score[1]}`, 1.8, '#ffd23f'); if (s.kind === 'local' && e.by === 'me') g.net.request('reward', { kind: 'event', amount: 20 * e.pts }).then((r) => r.profile && g.setProfile(r.profile)); break;
      case 'steal': case 'block': av(e.id)?.anim.play('interact'); g.hud.bigMessage(e.type === 'steal' ? 'STEAL!' : 'BLOCKED!', '', 1.2); break;
      case 'swing': av(e.id)?.anim.play(e.move === 'kick' ? 'kick' : e.move === 'dropkick' ? 'dropkick' : Math.random() < 0.5 ? 'punch' : 'punchL'); break;
      case 'hit': {
        const a = av(e.id), v = av(e.victim);
        if (['throw', 'slam', 'suplex'].includes(e.move)) { a?.anim.play(e.move === 'throw' ? 'throw' : 'slam'); g.audio.slam(v?.position || bp); g.cam.addShake(0.35); }
        else { g.audio.punch(v?.position || bp); v?.anim.play('hit'); }
        if (e.victim === this.myId()) g.hud.hitFlash(Math.min(0.8, e.dmg / 25));
        break;
      }
      case 'grapple': g.audio.punch(bp); break;
      case 'reversal': av(e.id)?.anim.play('reversal'); g.hud.bigMessage('REVERSAL!', '', 1.2, '#ffd23f'); break;
      case 'ropes': g.audio.impact(bp); break;
      case 'pin': g.audio.slam(bp); break;
      case 'count': g.hud.bigMessage(String(e.n), 'The referee counts…', 0.9, '#ffffff'); g.audio.slam(bp); break;
      case 'kickout': g.hud.bigMessage('KICK OUT!', '', 1.4, '#ffd23f'); g.audio.crowd(0.9); break;
      case 'win': g.hud.bigMessage(e.id === this.myId() ? 'YOU WIN!' : `${e.name || 'They'} WINS`, 'Pinfall 1-2-3!', 6, e.id === this.myId() ? '#7dff9b' : '#ff4757'); g.audio.bell(); g.audio.crowd(1); if (s.kind === 'local' && e.id === 'me') g.net.request('reward', { kind: 'event', amount: 150 }).then((r) => r.profile && g.setProfile(r.profile)); break;
      case 'end': { const my = s.kind === 'local' ? 0 : this.myTeam(); const win = e.score[my] > e.score[1 - my]; g.hud.bigMessage(e.score[0] === e.score[1] ? 'DRAW' : win ? 'VICTORY' : 'DEFEAT', `Final ${e.score[0]} - ${e.score[1]}`, 6, win ? '#7dff9b' : '#ff4757'); g.audio.whistle(bp); break; }
      default: break;
    }
  }

  // ------------------------------------------------------------------ per frame
  controlsPlayer() { return false; }
  blocksWeapons() { return !!this.s && this.s.mode !== 'combat'; }
  respawnDelay() { return this.s?.mode === 'combat' ? (this.s.kind === 'local' ? 4 : 999) : null; }
  spawnPoint() { if (this.s?.mode !== 'combat') return null; const v = this.game.layout.venues.combat; return { x: v.spawnA[0], z: v.spawnA[1] }; }

  update(dt, playing) {
    const g = this.game;
    const s = this.s;
    if (!s) return;
    if (playing && g.input.hit('inventory') && this.lobbyEl) { this.lobbyEl.remove(); this.lobbyEl = null; }
    if (s.mode === 'combat') { this.updateCombat(dt, playing); return; }
    if (s.kind === 'local' && s.sim) {
      const me = g.player.pos;
      const lp = this.toLocal(me);
      if (s.mode !== 'wrestling' || this.simPlayer(s.sim.snapshot(), 'me')?.state === 'stand') s.sim.report('me', lp.x, lp.z, g.avatar.yaw, dt);
      s.sim.step(dt);
      const ev = s.sim.drainEvents();
      s.prev = s.snap; s.snap = s.sim.snapshot(); s.prevT = s.snapT; s.snapT = performance.now();
      for (const e of ev) this.onEvent(e);
    } else if (s.kind === 'net' && s.started && s.snap?.ph !== 'lobby') {
      s.sendT = (s.sendT || 0) + dt;
      if (s.sendT > 0.1) { s.sendT = 0; const lp = this.toLocal(g.player.pos); g.net.send('act', { a: 'pos', x: +lp.x.toFixed(2), z: +lp.z.toFixed(2), yaw: +g.avatar.yaw.toFixed(2) }); }
    }
    if (!s.snap || !s.started) return;
    this.renderSim(dt);
    if (playing && g.input.locked && !g.ui.modalOpen) this.controls(dt);
    this.hudUpdate();
    if (s.kind === 'local' && s.snap.ph === 'end' && !s.endT) s.endT = performance.now();
    if (s.endT && performance.now() - s.endT > 7000) this.leave();
  }

  renderSim(dt) {
    const g = this.game;
    const s = this.s;
    const snap = s.snap;
    const me = this.myId();
    const list = s.mode === 'wrestling' ? snap.w.map((w) => ({ id: w[0], human: w[1], x: w[2], z: w[3], yaw: w[4], state: w[7], grab: w[8], speed: w[9], team: 0 })) : snap.p.map((p) => ({ id: p[0], team: p[1], human: p[2], x: p[3], z: p[4], yaw: p[5], speed: p[6], jump: p[7] }));
    const seen = new Set();
    for (const p of list) {
      if (p.id === me) { this.applyMyState(p); continue; }
      if (p.human && s.kind === 'net') continue; // other humans are rendered by the multiplayer manager
      seen.add(p.id);
      let a = s.avatars.get(p.id);
      if (!a) {
        const key = s.mode === 'wrestling' ? `npc:wrestler:${s.avatars.size % 3}` : `npc:${p.team === 0 ? 'teamA' : 'teamB'}:${s.avatars.size % 2}`;
        a = new Avatar(g.factory, key, { name: '', showTag: false });
        g.engine.scene.add(a.group);
        s.avatars.set(p.id, a);
        a.position.copy(this.toWorld(p.x, p.z));
      }
      const target = this.toWorld(p.x, p.z);
      a.position.lerp(target, Math.min(1, dt * 12));
      let dy = p.yaw - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); a.yaw += dy * Math.min(1, dt * 10);
      if (s.mode === 'wrestling') a.anim.setLoop(stateLoop(p.state));
      if (s.mode === 'basketball') a.anim.setLoop(snap.b[3] === p.id ? 'dribble' : null);
      a.update(dt, { speed: p.speed, grounded: true });
    }
    for (const [id, a] of s.avatars) if (!seen.has(id)) { a.dispose(); s.avatars.delete(id); }
    // ball
    if (this.ballMesh && snap.b) {
      const b = snap.b;
      const wpos = this.toWorld(b[0], b[2]);
      wpos.y += b[1] - (s.mode === 'football' ? 0.05 : 0.06) + (s.mode === 'football' ? 0 : 0.06);
      if (s.kind === 'net' && s.mode === 'football' && b[3] !== undefined) {
        const age = Math.min(0.15, (performance.now() - (s.snapT || 0)) / 1000);
        wpos.x += b[3] * age; wpos.z += b[5] * age; wpos.y = Math.max(0.11, wpos.y + b[4] * age);
      }
      const old = this.ballMesh.position.clone();
      this.ballMesh.position.lerp(wpos, s.kind === 'local' ? 1 : Math.min(1, dt * 18));
      const mv = this.ballMesh.position.clone().sub(old);
      this.ballMesh.rotation.x += mv.z * 6; this.ballMesh.rotation.z -= mv.x * 6;
    }
  }

  applyMyState(p) {
    const g = this.game;
    const s = this.s;
    if (s.mode === 'wrestling') {
      const loop = stateLoop(p.state);
      if (g.avatar.anim.loop !== loop) g.avatar.anim.setLoop(loop);
      g.player.mode = p.state === 'stand' ? 'foot' : 'frozen';
      const w = this.toWorld(p.x, p.z);
      if (p.state !== 'stand' || g.player.pos.distanceTo(w) > 1.2) { g.player.pos.x = w.x; g.player.pos.z = w.z; g.avatar.yaw = p.yaw; }
      // keep inside the ropes
      const lp = this.toLocal(g.player.pos);
      if (Math.abs(lp.x) > ROPE || Math.abs(lp.z) > ROPE) { const c = this.toWorld(Math.max(-ROPE, Math.min(ROPE, lp.x)), Math.max(-ROPE, Math.min(ROPE, lp.z))); g.player.pos.x = c.x; g.player.pos.z = c.z; }
    } else {
      // keep inside the playing area
      const lp = this.toLocal(g.player.pos);
      const [hx, hz] = s.mode === 'football' ? [HL + 3, HW + 3] : [HALF_L + 1.5, HALF_W + 1.5];
      if (Math.abs(lp.x) > hx || Math.abs(lp.z) > hz) { const c = this.toWorld(Math.max(-hx, Math.min(hx, lp.x)), Math.max(-hz, Math.min(hz, lp.z))); g.player.pos.x = c.x; g.player.pos.z = c.z; }
      if (s.mode === 'basketball') g.avatar.anim.setLoop(s.snap.b[3] === this.myId() ? 'dribble' : null);
    }
  }

  send(a, extra = {}) {
    const s = this.s;
    if (s.kind === 'local') {
      const sim = s.sim;
      switch (a) {
        case 'kick': sim.kick('me', extra.dx, extra.dz, extra.power, extra.loft); break;
        case 'tackle': sim.tackle('me'); break;
        case 'shoot': sim.shoot('me', extra.q); break;
        case 'pass': sim.pass('me', null); break;
        case 'steal': sim.steal('me'); break;
        case 'act': sim.act('me', extra.move); break;
        default: break;
      }
    } else this.game.net.send('act', { a, ...extra });
  }

  controls(dt) {
    const g = this.game;
    const s = this.s;
    const inp = g.input;
    const m = inp.mouse;
    const yaw = g.avatar.yaw;
    const fwd = { x: Math.sin(yaw), z: Math.cos(yaw) };
    if (s.mode === 'football') {
      // hold to charge, release to kick
      if (m.leftPressed || m.rightPressed) s.charge = 0;
      if (m.left || m.right) { s.charge = Math.min(1, (s.charge || 0) + dt * 1.2); g.hud.setMeter(s.charge); }
      const camF = new THREE.Vector3(); g.engine.camera.getWorldDirection(camF);
      if (m.leftReleased) { this.send('kick', { dx: camF.x, dz: camF.z, power: 0.25 + (s.charge || 0) * 0.45, loft: Math.max(0, (s.charge || 0) - 0.25) * 0.5 }); g.hud.setMeter(null); }
      if (m.rightReleased) { this.send('kick', { dx: camF.x, dz: camF.z, power: 0.55 + (s.charge || 0) * 0.45, loft: 0.15 + Math.max(0, g.cam.pitch + 0.1) }); g.hud.setMeter(null); }
      if (inp.hit('interact')) { this.send('tackle'); g.avatar.anim.play('tackle'); }
    } else if (s.mode === 'basketball') {
      const hasBall = s.snap.b[3] === this.myId();
      if (m.rightPressed && hasBall) s.meterT = 0;
      if (m.right && hasBall && s.meterT !== undefined) {
        s.meterT += dt;
        const v = Math.abs(Math.sin(s.meterT * 2.2)); // oscillating meter; perfect at the top
        s.meter = v; g.hud.setMeter(v);
      }
      if (m.rightReleased && s.meterT !== undefined) {
        const q = s.meter ?? 0.5;
        this.send('shoot', { q: q > 0.92 ? 1 : q });
        if (q > 0.92) g.hud.bigMessage('GREEN!', '', 0.8, '#7dff9b');
        s.meterT = undefined; g.hud.setMeter(null);
        g.avatar.anim.play('jumpShot');
      }
      if (m.leftPressed && hasBall) { this.send('pass'); g.avatar.anim.play('pass'); }
      if (inp.hit('interact')) { this.send('steal'); g.avatar.anim.play('interact'); }
      if (inp.hit('jump')) g.avatar.anim.play('jumpShot');
    } else if (s.mode === 'wrestling') {
      const me = this.simPlayer(s.snap, this.myId());
      if (!me) return;
      if (me.state === 'grappling') {
        if (m.leftPressed) this.send('act', { move: 'throw' });
        else if (m.rightPressed) this.send('act', { move: 'slam' });
        else if (inp.hit('reload')) this.send('act', { move: 'suplex' });
      } else {
        if (m.leftPressed) this.send('act', { move: 'punch' });
        if (inp.hit('reload')) this.send('act', { move: g.player.speed > 3 ? 'dropkick' : 'kick' });
        if (inp.hit('interact')) this.send('act', { move: 'grapple' });
        if (inp.hit('jump')) this.send('act', { move: 'pin' });
      }
      if (inp.keys.has('KeyQ') && inp.pressed.has('KeyQ') || m.rightPressed && me.state !== 'grappling') this.send('act', { move: 'reversal' });
    }
    void fwd;
  }

  hudUpdate() {
    const g = this.game;
    const s = this.s;
    const snap = s.snap;
    const tfmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    if (s.mode === 'football' || s.mode === 'basketball') {
      const left = Math.max(0, (snap.dur || 0) - (snap.t || 0));
      g.hud.setActivity(`<span style="color:#6fb6ff">BLUE</span><span class="score">${snap.s[0]} - ${snap.s[1]}</span><span style="color:#ff6b7a">RED</span><span class="muted">${tfmt(left)}</span>`);
    } else if (s.mode === 'wrestling') {
      const parts = snap.w.map((w) => `<span>${w[0] === this.myId() ? 'YOU' : (w[10] || 'Wrestler')}: ❤ ${w[5]} ⚡ ${w[6]}${w[7] !== 'stand' ? ` (${w[7]})` : ''}</span>`);
      g.hud.setActivity(parts.join(' <span class="muted">vs</span> '));
    }
  }

  // ------------------------------------------------------------------ combat (local bots or server rounds)
  startLocalCombat() {
    const g = this.game;
    const s = this.s;
    const v = g.layout.venues.combat;
    s.round = 0; s.score = [0, 0];
    g.weapons.setLoadout({ weapons: ['knife', 'glock', 'ak47'], ammo: { glock: 80, ak47: 120 } });
    this.localRound();
    void v;
  }
  localRound() {
    const g = this.game;
    const s = this.s;
    const v = g.layout.venues.combat;
    for (const b of s.bots) { g.npcs.extra = (g.npcs.extra || []).filter((x) => x !== b); g.npcs.remove(b); }
    s.bots = [];
    s.round++;
    g.player.health = 100; g.player.mode = 'foot'; g.avatar.anim.setLoop(null);
    g.player.teleport(v.spawnA[0], null, v.spawnA[1]);
    g.cam.yaw = Math.atan2(v.spawnA[0] - v.spawnB[0], v.spawnA[1] - v.spawnB[1]);
    const mk = (team, i) => {
      const sp = team === 0 ? v.spawnA : v.spawnB;
      const n = new NPC(g.npcs, { role: team === 0 ? 'police' : 'gang', variant: i % 2, x: sp[0] + (Math.random() - 0.5) * 10, y: 0, z: sp[1] + (Math.random() - 0.5) * 10 });
      n.position.y = g.world.collision.groundAt(n.position.x, n.position.z);
      n.armed = true; n.weapon = Math.random() < 0.5 ? 'ak47' : 'glock'; n.team = team; n.hp = 100;
      g.npcs.add(n); (g.npcs.extra ||= []).push(n); s.bots.push(n);
      return n;
    };
    const mates = [mk(0, 0), mk(0, 1)];
    const foes = [mk(1, 0), mk(1, 1), mk(1, 2)];
    s.teamBots = { mates, foes };
    s.phase = 'buy'; s.clock = 5;
    g.hud.bigMessage(`ROUND ${s.round}`, `Score ${s.score[0]} : ${s.score[1]} — 3v3 vs bots`, 3);
  }
  updateCombat(dt, playing) {
    const g = this.game;
    const s = this.s;
    if (s.kind === 'net') {
      const L = s.lobby;
      if (L) g.hud.setActivity(`<span style="color:#6fb6ff">A</span><span class="score">${L.score?.[0] ?? 0} : ${L.score?.[1] ?? 0}</span><span style="color:#ff6b7a">B</span><span class="muted">R${L.round || 0} · ${L.phase} · ${s.clock || L.t || 0}s</span>`);
      // freeze during buy phase
      if (L?.phase === 'buy') g.activeSlowdown = 0; else g.activeSlowdown = null;
      if (playing && g.input.hit('inventory')) { this.scoreboardOn = !this.scoreboardOn; if (this.scoreboardOn) this.renderScoreboard(); else this.removeScoreboard(); }
      if (this.scoreboardOn) this.renderScoreboard();
      return;
    }
    void playing;
    const { mates, foes } = s.teamBots;
    s.clock -= dt;
    if (s.phase === 'buy') { g.activeSlowdown = 0; if (s.clock <= 0) { s.phase = 'live'; g.activeSlowdown = null; g.hud.bigMessage('GO GO GO!', '', 1.2, '#ffd23f'); g.audio.bell(); } }
    else if (s.phase === 'live') {
      // bots pick targets
      const aliveFoes = foes.filter((n) => n.alive), aliveMates = mates.filter((n) => n.alive);
      const meAlive = g.player.mode !== 'dead';
      for (const n of aliveMates) if (!n.threat?.alive || n.state !== 'shoot') { const t = nearest(n, aliveFoes); if (t) { n.threat = t; n.state = 'shoot'; n.timer = 60; } }
      for (const n of aliveFoes) {
        const cands = [...aliveMates]; if (meAlive) cands.push({ position: g.player.pos, alive: true, me: true });
        const t = nearest(n, cands);
        if (t) { n.threat = t.me ? g.avatar : t; if (n.state !== 'shoot') { n.state = 'shoot'; n.timer = 60; } }
      }
      const teamAlive = aliveMates.length + (meAlive ? 1 : 0);
      if (!aliveFoes.length || !teamAlive) {
        const won = !aliveFoes.length;
        s.score[won ? 0 : 1]++;
        g.hud.bigMessage(won ? 'ROUND WON' : 'ROUND LOST', `${s.score[0]} : ${s.score[1]}`, 3, won ? '#7dff9b' : '#ff4757');
        s.phase = 'end'; s.clock = 4;
        if (s.score[0] >= 5 || s.score[1] >= 5) { s.phase = 'post'; s.clock = 6; g.hud.bigMessage(s.score[0] >= 5 ? 'VICTORY' : 'DEFEAT', `Final ${s.score[0]} : ${s.score[1]}`, 6); if (s.score[0] >= 5) g.net.request('reward', { kind: 'event', amount: 150 }).then((r) => r.profile && g.setProfile(r.profile)); }
      }
    } else if (s.phase === 'end' && s.clock <= 0) this.localRound();
    else if (s.phase === 'post' && s.clock <= 0) this.leave();
    g.hud.setActivity(`<span style="color:#6fb6ff">YOU</span><span class="score">${s.score[0]} : ${s.score[1]}</span><span style="color:#ff6b7a">BOTS</span><span class="muted">R${s.round} · ${s.phase === 'buy' ? `starts in ${Math.ceil(s.clock)}` : s.phase}</span>`);
  }
  onRespawn() { if (this.s?.kind === 'local' && this.s.mode === 'combat' && this.s.phase === 'live') { this.game.player.mode = 'dead'; } }

  // ------------------------------------------------------------------ interactions & ring
  interactions(out) {
    const g = this.game;
    if (this.s) return;
    const it = g.interiors?.current;
    void it;
  }
  onUse(u) {
    if (u.kind === 'wrestling') { this.game.ui.showActivities(); return true; }
    return false;
  }
  buildRing() {
    const g = new THREE.Group();
    const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
    const mat = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.2, 7.4), [M('#1a237e'), M('#1a237e'), M('#e8eaf6'), M('#1a237e'), M('#1a237e'), M('#1a237e')]);
    mat.position.y = 0.6; mat.receiveShadow = true; g.add(mat);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(7.6, 1.1, 7.6), M('#b71c1c')); skirt.position.y = 0.55; g.add(skirt);
    for (const [x, z] of [[-3.6, -3.6], [3.6, -3.6], [3.6, 3.6], [-3.6, 3.6]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.6), M('#cfd8dc', { metalness: 0.8 })); post.position.set(x, 2.0, z); g.add(post);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.9, 0.25), M('#ffd600')); pad.position.set(x * 0.97, 2.0, z * 0.97); g.add(pad);
    }
    const cols = ['#e53935', '#ffffff', '#1e88e5'];
    for (let i = 0; i < 3; i++) {
      const y = 1.55 + i * 0.4;
      for (const [x, z, rot] of [[0, -3.6, 0], [0, 3.6, 0], [-3.6, 0, Math.PI / 2], [3.6, 0, Math.PI / 2]]) {
        const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 7.2, 6), M(cols[i]));
        rope.rotation.z = Math.PI / 2; rope.rotation.y = rot; rope.position.set(x, y, z); g.add(rope);
      }
    }
    const steps = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 0.8), M('#455a64')); steps.position.set(0, 0.3, 4.2); g.add(steps);
    return g;
  }
}

function stateLoop(state) { return state === 'down' ? 'knockedDown' : state === 'pinned' ? 'pinned' : state === 'pinning' ? 'pinning' : state === 'grappling' ? 'grapple' : state === 'grappled' ? 'grappled' : null; }
function nearest(n, list) { let best = null, bd = Infinity; for (const o of list) { const d = n.position.distanceTo(o.position); if (d < bd) { bd = d; best = o; } } return best; }

function footballMesh() {
  const geo = new THREE.IcosahedronGeometry(0.11, 1);
  const cols = new Float32Array(geo.attributes.position.count * 3);
  for (let f = 0; f < geo.attributes.position.count / 3; f++) { const dark = f % 5 === 0; for (let k = 0; k < 3; k++) cols.set(dark ? [0.08, 0.08, 0.08] : [0.97, 0.97, 0.97], (f * 3 + k) * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, flatShading: true }));
  m.castShadow = true;
  return m;
}
function basketballMesh() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#e8702a'; x.fillRect(0, 0, 256, 128);
  x.strokeStyle = '#1b1b1b'; x.lineWidth = 4;
  for (const X of [64, 128, 192]) { x.beginPath(); x.moveTo(X, 0); x.lineTo(X, 128); x.stroke(); }
  x.beginPath(); x.moveTo(0, 64); x.lineTo(256, 64); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
  m.castShadow = true;
  return m;
}
export { HALF_L, HALF_W };
