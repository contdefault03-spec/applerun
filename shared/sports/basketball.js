// Basketball simulation (shared server/client). Court-local coords: x along the length,
// hoops at x = ±RIM_X. Possession is explicit: the ball is either held by a player or
// flying/bouncing with real physics (rim + backboard collisions, net detection).
export const HALF_L = 14, HALF_W = 7.5, RIM_X = 12.43, RIM_Y = 3.05, RIM_R = 0.23, BOARD_X = 12.8;
const BALL_R = 0.12, G = 9.8;

export class BasketballSim {
  constructor({ perTeam = 3, duration = 300 } = {}) {
    this.perTeam = Math.max(1, Math.min(5, perTeam));
    this.duration = duration;
    this.players = [];
    this.ball = { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, holder: null, lastShooter: null, shotFrom: 0, scoredThisShot: false, noPick: 0 };
    this.score = [0, 0];
    this.phase = 'lobby';
    this.time = 0; this.phaseT = 0;
    this.possessionTeam = 0;
    this.events = [];
  }
  setHumans(humans) {
    const teams = [[], []];
    for (const h of humans) teams[h.team === 1 ? 1 : 0].push(h);
    this.players = [];
    const spots = [[-3, 0], [-6, -4], [-6, 4], [-9, -2], [-9, 2]];
    for (const t of [0, 1]) {
      const n = Math.max(this.perTeam, teams[t].length);
      for (let i = 0; i < n; i++) {
        const h = teams[t][i];
        const s = t === 0 ? 1 : -1;
        const [sx, sz] = spots[i % spots.length];
        this.players.push({ id: h ? h.id : `ai${t}${i}`, name: h?.name, team: t, human: !!h, x: sx * s, z: sz * s, vx: 0, vz: 0, yaw: 0, cool: 0, jump: 0, stun: 0, hx: sx * s, hz: sz * s });
      }
    }
  }
  start() { this.score = [0, 0]; this.time = 0; this.tipoff(); }
  tipoff() {
    this.phase = 'play'; this.phaseT = 0;
    Object.assign(this.ball, { x: 0, y: 3.5, z: 0, vx: 0, vy: 2, vz: 0, holder: null, noPick: 0.5 });
    for (const p of this.players) { p.x = p.hx; p.z = p.hz; }
    this.events.push({ type: 'tipoff' });
  }
  inbound(team) {
    // after a score the other team gets the ball under their own basket
    const p = this.players.find((q) => q.team === team && !q.human) || this.players.find((q) => q.team === team);
    const own = team === 0 ? -1 : 1; // team 0 attacks +x
    if (p) { p.x = own * (HALF_L - 1.5); p.z = 0; this.give(p); }
    this.possessionTeam = team;
  }
  player(id) { return this.players.find((p) => p.id === id); }
  give(p) {
    const b = this.ball;
    const takeaway = this.possessionTeam !== p.team && this.possessionTeam !== undefined; // rebound/steal off the other team → fast break
    b.holder = p.id; b.vx = b.vy = b.vz = 0; this.possessionTeam = p.team;
    if (takeaway) for (const q of this.players) if (q.team === p.team) q.fastBreak = 2.2;
    this.events.push({ type: 'possession', id: p.id, team: p.team });
  }
  holderP() { return this.ball.holder ? this.player(this.ball.holder) : null; }

  report(id, x, z, yaw, dt = 0.1) {
    const p = this.player(id);
    if (!p || !p.human) return;
    const max = 9 * Math.max(dt, 0.05) + 1.2;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    const k = d > max ? max / d : 1;
    p.vx = (dx * k) / Math.max(dt, 0.05); p.vz = (dz * k) / Math.max(dt, 0.05);
    p.x += dx * k; p.z += dz * k; p.yaw = yaw;
  }

  /** quality 0..1 from the shot meter (1 = perfect release). */
  shoot(id, quality) {
    const p = this.player(id);
    const b = this.ball;
    if (!p || b.holder !== id || this.phase !== 'play') return false;
    const dir = p.team === 0 ? 1 : -1;
    const rim = { x: RIM_X * dir, z: 0 };
    const dist = Math.hypot(rim.x - p.x, rim.z - p.z);
    // contest: nearest defender reduces accuracy
    const def = Math.min(...this.players.filter((q) => q.team !== p.team).map((q) => Math.hypot(q.x - p.x, q.z - p.z)), 9);
    quality = Math.max(0, Math.min(1, quality)) * (def < 1.2 ? 0.7 : def < 2.2 ? 0.88 : 1);
    const err = (1 - quality) * (0.35 + dist * 0.045) + dist * 0.004;
    // ideal velocity for an arc with apex above the rim
    const sx = p.x + Math.sin(p.yaw) * 0.3, sz = p.z + Math.cos(p.yaw) * 0.3, sy = 2.35;
    const tx = rim.x - dir * 0.02 + (Math.random() - 0.5) * err * 2, tz = rim.z + (Math.random() - 0.5) * err * 2;
    const flight = 0.75 + dist * 0.055;
    const ty = RIM_Y + 0.05 + (Math.random() - 0.5) * err * 0.6;
    b.x = sx; b.y = sy; b.z = sz;
    b.vx = (tx - sx) / flight; b.vz = (tz - sz) / flight;
    b.vy = (ty - sy + 0.5 * G * flight * flight) / flight;
    b.holder = null; b.lastShooter = id; b.shotFrom = dist; b.scoredThisShot = false; b.noPick = 0.35; b.shotTeam = p.team;
    p.jump = 0.5;
    this.events.push({ type: 'shot', id, quality });
    return true;
  }
  pass(id, toId) {
    const p = this.player(id), q = toId ? this.player(toId) : null;
    const b = this.ball;
    if (!p || b.holder !== id) return false;
    let tgt = q;
    if (!tgt) { // pass to the teammate in front
      let best = -Infinity;
      for (const o of this.players) { if (o === p || o.team !== p.team) continue; const dx = o.x - p.x, dz = o.z - p.z; const s = (dx * Math.sin(p.yaw) + dz * Math.cos(p.yaw)) / (Math.hypot(dx, dz) + 1); if (s > best) { best = s; tgt = o; } }
    }
    if (!tgt) return false;
    const d = Math.hypot(tgt.x - p.x, tgt.z - p.z);
    const t = 0.25 + d / 16;
    b.x = p.x; b.y = 1.3; b.z = p.z;
    b.vx = (tgt.x + tgt.vx * t - p.x) / t; b.vz = (tgt.z + tgt.vz * t - p.z) / t; b.vy = (1.3 - 1.3 + 0.5 * G * t * t) / t;
    b.holder = null; b.noPick = 0.15; b.passFrom = id;
    this.events.push({ type: 'pass', id, to: tgt.id });
    return true;
  }
  steal(id) {
    const p = this.player(id);
    const h = this.holderP();
    if (!p || p.cool > 0) return false;
    p.cool = 1.2;
    if (h && h.team !== p.team && Math.hypot(h.x - p.x, h.z - p.z) < 1.6 && Math.random() < 0.38) { this.give(p); h.stun = 0.6; this.events.push({ type: 'steal', id }); return true; }
    // block a shot in flight
    const b = this.ball;
    if (!b.holder && Math.hypot(b.x - p.x, b.z - p.z) < 1.2 && b.y < 3.1 && b.vy > 0) { b.vx = -b.vx * 0.4; b.vz = (Math.random() - 0.5) * 4; b.vy = 1; this.events.push({ type: 'block', id }); return true; }
    return false;
  }

  step(dt) {
    if (this.phase === 'lobby' || this.phase === 'end') return;
    this.phaseT += dt;
    this.time += dt;
    if (this.time >= this.duration) { this.phase = 'end'; this.events.push({ type: 'end', score: [...this.score] }); return; }
    for (const p of this.players) { p.cool = Math.max(0, p.cool - dt); p.jump = Math.max(0, p.jump - dt); p.stun = Math.max(0, p.stun - dt); }
    this.stepAI(dt);
    this.stepBall(dt);
  }

  stepBall(dt) {
    const b = this.ball;
    const h = this.holderP();
    b.noPick = Math.max(0, b.noPick - dt);
    if (h) {
      // dribble in front of the holder
      const t = performance?.now ? performance.now() / 1000 : Date.now() / 1000;
      b.x = h.x + Math.sin(h.yaw) * 0.45 + Math.cos(h.yaw) * 0.25; b.z = h.z + Math.cos(h.yaw) * 0.45 - Math.sin(h.yaw) * 0.25;
      b.y = 0.2 + Math.abs(Math.sin(t * 7)) * 0.75;
      if (b.y < 0.25 && !b._bounced) { this.events.push({ type: 'dribble' }); b._bounced = true; } else if (b.y > 0.5) b._bounced = false;
      return;
    }
    const sub = 4;
    for (let i = 0; i < sub; i++) {
      const h2 = dt / sub;
      const prevY = b.y;
      b.vy -= G * h2;
      b.x += b.vx * h2; b.y += b.vy * h2; b.z += b.vz * h2;
      for (const side of [1, -1]) {
        const rx = RIM_X * side;
        // net detection: crossing the rim plane downward inside the ring
        if (prevY >= RIM_Y && b.y < RIM_Y && Math.hypot(b.x - rx, b.z) < RIM_R - BALL_R * 0.4 && !b.scoredThisShot) {
          b.scoredThisShot = true;
          const team = side === 1 ? 0 : 1;
          const pts = b.shotFrom > 6.75 ? 3 : 2;
          this.score[team] += pts;
          b.vx *= 0.2; b.vz *= 0.2; b.vy = Math.min(b.vy, -1);
          this.events.push({ type: 'score', team, pts, by: b.lastShooter, score: [...this.score] });
          this.pendingInbound = { team: 1 - team, t: 1.6 };
        }
        // rim collision (torus approximated by sampling the ring)
        const dxr = b.x - rx, dzr = b.z;
        const rd = Math.hypot(dxr, dzr) || 1e-6;
        const cx = rx + (dxr / rd) * RIM_R, cz = (dzr / rd) * RIM_R;
        const ddx = b.x - cx, ddy = b.y - RIM_Y, ddz = b.z - cz;
        const dd = Math.hypot(ddx, ddy, ddz);
        if (dd < BALL_R + 0.02) {
          const nx = ddx / dd, ny = ddy / dd, nz = ddz / dd;
          const vn = b.vx * nx + b.vy * ny + b.vz * nz;
          if (vn < 0) { b.vx -= 1.6 * vn * nx; b.vy -= 1.6 * vn * ny; b.vz -= 1.6 * vn * nz; b.vx *= 0.8; b.vz *= 0.8; this.events.push({ type: 'rim' }); }
          b.x = cx + nx * (BALL_R + 0.021); b.y = RIM_Y + ny * (BALL_R + 0.021); b.z = cz + nz * (BALL_R + 0.021);
        }
        // backboard
        const bx = BOARD_X * side;
        if (Math.abs(b.x - bx) < BALL_R && b.y > 2.9 && b.y < 4.0 && Math.abs(b.z) < 0.92 && b.vx * side > 0) { b.vx = -b.vx * 0.6; b.x = bx - side * BALL_R; this.events.push({ type: 'board' }); }
      }
      if (b.y < BALL_R) { b.y = BALL_R; if (b.vy < -1) { b.vy = -b.vy * 0.7; this.events.push({ type: 'bounce' }); } else b.vy = 0; b.vx *= 0.9; b.vz *= 0.9; }
      // walls
      if (Math.abs(b.x) > HALF_L + 2) { b.vx = -b.vx * 0.5; b.x = Math.sign(b.x) * (HALF_L + 2); }
      if (Math.abs(b.z) > HALF_W + 2) { b.vz = -b.vz * 0.5; b.z = Math.sign(b.z) * (HALF_W + 2); }
    }
    if (this.pendingInbound) { this.pendingInbound.t -= dt; if (this.pendingInbound.t <= 0) { this.inbound(this.pendingInbound.team); this.pendingInbound = null; } return; }
    // pickups (rebounds / catches)
    if (b.noPick <= 0 && b.y < 2.4) {
      let best = null, bd = 1.1;
      for (const p of this.players) { if (p.stun > 0) continue; const d = Math.hypot(b.x - p.x, b.z - p.z); if (d < bd) { bd = d; best = p; } }
      if (best) this.give(best);
    }
  }

  /** Dynamic man-to-man assignment (recomputed periodically → reads as "switching" when
   * offensive players cross paths or set screens), instead of a fixed index-based pairing. */
  assignDefense() {
    const byTeam = [this.players.filter((q) => q.team === 0), this.players.filter((q) => q.team === 1)];
    this._marks = new Map();
    for (const t of [0, 1]) {
      const defenders = byTeam[t].slice();
      const attackers = byTeam[1 - t].slice();
      for (const d of defenders) {
        attackers.sort((a, c) => Math.hypot(a.x - d.x, a.z - d.z) - Math.hypot(c.x - d.x, c.z - d.z));
        const pick = attackers.find((a) => !this._marks.has(a.id)) || attackers[0];
        if (pick) this._marks.set(pick.id, d.id);
      }
    }
  }
  stepAI(dt) {
    const b = this.ball;
    const h = this.holderP();
    if (this._matchupT === undefined || (this._matchupT -= dt) <= 0) { this.assignDefense(); this._matchupT = 1.4; }
    // rebound crash: while a shot is live in the air, everyone near the hoop abandons their
    // offensive spot / defensive assignment and fights for the ball instead of standing still
    const shotLive = !h && !this.pendingInbound && this.ball.lastShooter != null && Math.abs(b.vy) > 0.05 && b.y < RIM_Y + 3;
    for (const p of this.players) {
      if (p.human || p.stun > 0) continue;
      p.fastBreak = Math.max(0, (p.fastBreak || 0) - dt);
      const dir = p.team === 0 ? 1 : -1;
      let tx, tz, speed = 5.5;
      if (shotLive && Math.hypot(RIM_X * (b.shotTeam === 0 ? 1 : -1) - p.x, p.z) < 11) {
        // crash the boards: cluster toward the likely landing area under/around the rim
        const rimX = RIM_X * (b.shotTeam === 0 ? 1 : -1);
        tx = rimX - (b.shotTeam === 0 ? 1 : -1) * (1.5 + Math.random() * 2.5); tz = (Math.random() - 0.5) * 4; speed = 6.3;
      } else if (!h) { // loose ball
        const nearest = this.players.filter((q) => q.team === p.team).sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
        if (nearest === p || Math.hypot(b.x - p.x, b.z - p.z) < 4) { tx = b.x; tz = b.z; speed = 6.5; } else { tx = p.hx * 0.6 + dir * 4; tz = p.hz; }
      } else if (h.team === p.team) {
        if (h === p) {
          const rimX = RIM_X * dir;
          const dRim = Math.hypot(rimX - p.x, p.z);
          const def = Math.min(...this.players.filter((q) => q.team !== p.team).map((q) => Math.hypot(q.x - p.x, q.z - p.z)), 9);
          tx = rimX - dir * 1.2; tz = 0; speed = p.fastBreak > 0 ? 6.8 : 4.5;
          // smarter shot selection: good look (uncontested or close) shoots now; otherwise look
          // to pass into a cutter/open teammate before forcing a contested shot
          const openMate = this.players.find((q) => q !== p && q.team === p.team && q.cutting && Math.hypot(RIM_X * dir - q.x, q.z) < 5 && !this.players.some((r) => r.team !== p.team && Math.hypot(r.x - q.x, r.z - q.z) < 1.8));
          if (p.cool <= 0 && openMate && def < 3 && Math.random() < dt * 1.6) { this.pass(p.id, openMate.id); p.cool = 0.8; }
          else if (p.cool <= 0 && (dRim < 2.2 || (dRim < 7.5 && def > 2.2 && Math.random() < dt * 1.2) || (def < 1.3 && Math.random() < dt * 0.8))) {
            p.yaw = Math.atan2(rimX - p.x, -p.z);
            if (def < 1.3 && Math.random() < 0.6) this.pass(p.id); else this.shoot(p.id, 0.55 + Math.random() * 0.45);
            p.cool = 1;
          }
        } else {
          const spotX = RIM_X * dir - dir * (4 + Math.abs(p.hz)), spotZ = p.hz * 1.2;
          // off-ball movement: spacing by default, with occasional backdoor cuts to the rim when
          // this player's own defender has drifted away (an "open" read), and light screen-setting
          // for the ball handler when their defender is draped on them.
          p.cutT = (p.cutT ?? Math.random() * 2.5) - dt;
          const myDef = this._marks.get(p.id) ? this.player(this._marks.get(p.id)) : null;
          if (!p.cutting && p.cutT <= 0) {
            p.cutT = 2 + Math.random() * 3.5;
            if (myDef && Math.hypot(myDef.x - p.x, myDef.z - p.z) > 3.2 && Math.random() < 0.6) { p.cutting = true; p.cutTimer = 1.1; }
          }
          if (p.cutting) {
            tx = RIM_X * dir - dir * 1.4; tz = p.hz * 0.25; speed = 6.4;
            p.cutTimer -= dt;
            if (p.cutTimer <= 0 || Math.hypot(p.x - tx, p.z - tz) < 1.1) p.cutting = false;
          } else {
            tx = spotX; tz = spotZ; speed = 4.5;
            if (h !== p) {
              const ballDef = this._marks.get(h.id) ? this.player(this._marks.get(h.id)) : null;
              if (ballDef && Math.hypot(ballDef.x - h.x, ballDef.z - h.z) < 2 && Math.hypot(p.x - h.x, p.z - h.z) < 6.5) {
                tx = ballDef.x * 0.55 + h.x * 0.45; tz = ballDef.z * 0.55 + h.z * 0.45; speed = 4;
              }
            }
          }
        }
      } else {
        // man-to-man defence on the dynamically (re)assigned mark; switches naturally as
        // assignDefense() re-picks the nearest attacker each cycle
        const mark = this._marks.get(p.id) ? this.player(this._marks.get(p.id)) : null;
        if (!mark) { tx = p.hx; tz = p.hz; }
        else {
          const ownRim = -RIM_X * dir;
          tx = mark.x + (ownRim - mark.x) * 0.25; tz = mark.z * 0.8;
          if (mark === h && Math.hypot(h.x - p.x, h.z - p.z) < 1.5 && Math.random() < dt * 0.8) this.steal(p.id);
        }
        speed = p.fastBreak > 0 ? 6.6 : 5.8;
      }
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      const sp = d > 0.3 ? Math.min(speed, d * 3) : 0;
      p.vx += ((d ? dx / d : 0) * sp - p.vx) * Math.min(1, dt * 6); p.vz += ((d ? dz / d : 0) * sp - p.vz) * Math.min(1, dt * 6);
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.x = Math.max(-HALF_L, Math.min(HALF_L, p.x)); p.z = Math.max(-HALF_W, Math.min(HALF_W, p.z));
      if (Math.hypot(p.vx, p.vz) > 0.3) p.yaw = Math.atan2(p.vx, p.vz);
    }
  }
  snapshot() {
    const b = this.ball;
    return {
      ph: this.phase, t: Math.round(this.time * 10) / 10, dur: this.duration, s: this.score,
      b: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2), b.holder || 0],
      p: this.players.map((p) => [p.id, p.team, p.human ? 1 : 0, +p.x.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), +Math.hypot(p.vx, p.vz).toFixed(1), p.jump > 0 ? 1 : 0]),
    };
  }
  drainEvents() { const e = this.events; this.events = []; return e; }
}
