// Football (soccer) simulation shared by the server (multiplayer rooms) and the client
// (solo quick play). Pitch-local coordinates: x along the length (goals at ±HL), z across.
// Human players report their own positions; the sim validates kicks/tackles by distance,
// runs AI teammates/opponents, ball physics, goals, kickoffs and the match clock.
export const HL = 52.5, HW = 34, GOAL_W = 7.32, GOAL_H = 2.44;
const BALL_R = 0.11;

const FORMATIONS = {
  1: [['FWD', -12, 0]],
  3: [['GK', -48, 0], ['DEF', -24, 0], ['FWD', -6, 0]],
  5: [['GK', -49, 0], ['DEF', -32, -12], ['DEF', -32, 12], ['MID', -16, 0], ['FWD', -5, 0]],
  7: [['GK', -49, 0], ['DEF', -34, -14], ['DEF', -34, 14], ['MID', -20, -18], ['MID', -20, 18], ['MID', -14, 0], ['FWD', -5, 0]],
};

export class FootballSim {
  constructor({ perTeam = 5, duration = 300 } = {}) {
    this.perTeam = FORMATIONS[perTeam] ? perTeam : 5;
    this.duration = duration;
    this.players = []; // {id, team:0|1, human, role, hx,hz (home), x,z, vx,vz, yaw, cool}
    this.ball = { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0 };
    this.score = [0, 0];
    this.phase = 'lobby'; // lobby | kickoff | play | goal | end
    this.time = 0; this.phaseT = 0;
    this.kickoffTeam = 0;
    this.lastTouch = null;
    this.possessor = null; // id of the player the ball is stuck to (close dribble control), or null when loose
    this.events = [];
  }
  // ------------------------------------------------------------------ roster
  setHumans(humans) {
    // humans: [{id, team}] — fill each team up to perTeam with AI
    this.players = this.players.filter((p) => !p.human);
    const form = FORMATIONS[this.perTeam];
    const teams = [[], []];
    for (const h of humans) teams[h.team === 1 ? 1 : 0].push(h);
    this.players = [];
    for (const t of [0, 1]) {
      form.forEach(([role, fx, fz], i) => {
        const h = teams[t][i];
        const sign = t === 0 ? 1 : -1;
        this.players.push({ id: h ? h.id : `ai${t}${i}`, name: h?.name, team: t, human: !!h, role, hx: fx * sign, hz: fz * sign, x: fx * sign, z: fz * sign, vx: 0, vz: 0, yaw: t === 0 ? Math.PI / 2 : -Math.PI / 2, cool: 0, stun: 0 });
      });
      // extra humans beyond formation size play as midfielders
      for (let i = form.length; i < teams[t].length; i++) { const h = teams[t][i]; const sign = t === 0 ? 1 : -1; this.players.push({ id: h.id, name: h.name, team: t, human: true, role: 'MID', hx: -15 * sign, hz: (i - form.length) * 8, x: -15 * sign, z: 0, vx: 0, vz: 0, yaw: 0, cool: 0, stun: 0 }); }
    }
  }
  start() { this.score = [0, 0]; this.time = 0; this.kickoff(0); }
  kickoff(team) {
    this.phase = 'kickoff'; this.phaseT = 0; this.kickoffTeam = team;
    Object.assign(this.ball, { x: 0, y: BALL_R, z: 0, vx: 0, vy: 0, vz: 0 });
    this.possessor = null;
    for (const p of this.players) { p.x = p.hx * (p.role === 'FWD' && p.team === team ? 0.2 : 1); p.z = p.hz; p.vx = p.vz = 0; }
    this.events.push({ type: 'kickoff', team });
  }
  player(id) { return this.players.find((p) => p.id === id); }

  // ------------------------------------------------------------------ inputs
  /** Human position report (client-authoritative movement, speed-clamped). */
  report(id, x, z, yaw, dt = 0.1) {
    const p = this.player(id);
    if (!p || !p.human) return;
    const max = 10 * Math.max(dt, 0.05) + 1.5;
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    const k = d > max ? max / d : 1;
    p.vx = (dx * k) / Math.max(dt, 0.05); p.vz = (dz * k) / Math.max(dt, 0.05);
    p.x += dx * k; p.z += dz * k; p.yaw = yaw;
    p.x = Math.max(-HL - 4, Math.min(HL + 4, p.x)); p.z = Math.max(-HW - 4, Math.min(HW + 4, p.z));
  }
  /** kick: {dx,dz} direction, power 0..1, loft 0..1 */
  kick(id, dx, dz, power, loft = 0, speedOverride = 0) {
    const p = this.player(id);
    if (!p || this.phase === 'goal' || this.phase === 'end' || this.phase === 'lobby') return false;
    const b = this.ball;
    if (Math.hypot(b.x - p.x, b.z - p.z) > 1.7 || b.y > 1.6 || p.cool > 0) return false;
    if (this.phase === 'kickoff') { if (p.team !== this.kickoffTeam) return false; this.phase = 'play'; }
    this.possessor = null;
    const L = Math.hypot(dx, dz) || 1;
    power = Math.max(0.15, Math.min(1, power));
    const speed = speedOverride || 8 + power * 22;
    b.vx = (dx / L) * speed; b.vz = (dz / L) * speed;
    b.vy = loft * (3 + power * 7);
    p.cool = 0.35;
    this.lastTouch = p.id;
    this.events.push({ type: 'kick', id: p.id, power });
    return true;
  }
  tackle(id) {
    const p = this.player(id);
    if (!p || p.cool > 0) return false;
    p.cool = 0.9;
    this.events.push({ type: 'tackle', id });
    const b = this.ball;
    if (Math.hypot(b.x - p.x, b.z - p.z) < 2.2) {
      const owner = this.nearestTo(b.x, b.z, (q) => q !== p);
      if (owner && Math.hypot(owner.x - b.x, owner.z - b.z) < 1.4 && owner.team !== p.team) {
        owner.stun = 0.8;
        // win the ball outright ~55% of the time: it sticks to the tackler instead of the
        // owner; otherwise it just squirts loose for anyone to chase
        if (Math.random() < 0.55) { this.possessor = p.id; this.lastTouch = p.id; return true; }
      }
      this.possessor = null;
      const a = Math.random() * Math.PI * 2;
      b.vx = Math.cos(a) * 6 + (b.x - p.x) * 2; b.vz = Math.sin(a) * 6 + (b.z - p.z) * 2;
      this.lastTouch = p.id;
      return true;
    }
    return false;
  }
  nearestTo(x, z, filter = () => true) {
    let best = null, bd = Infinity;
    for (const p of this.players) { if (!filter(p)) continue; const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  // ------------------------------------------------------------------ step
  step(dt) {
    if (this.phase === 'lobby' || this.phase === 'end') return;
    this.phaseT += dt;
    if (this.phase === 'play' || this.phase === 'kickoff') this.time += dt;
    if (this.time >= this.duration && this.phase !== 'goal') { this.phase = 'end'; this.events.push({ type: 'end', score: [...this.score] }); return; }
    if (this.phase === 'goal' && this.phaseT > 3) this.kickoff(this.kickoffTeam);
    if (this.phase === 'kickoff' && this.phaseT > 6) this.phase = 'play'; // auto-start if nobody kicks
    for (const p of this.players) { p.cool = Math.max(0, p.cool - dt); p.stun = Math.max(0, p.stun - dt); }
    this.stepAI(dt);
    this.stepBall(dt);
  }

  stepBall(dt) {
    const b = this.ball;
    // Possession: a loose, low, slow-enough ball sticks to whoever gets close (close dribble
    // control) until they pass, shoot, or a tackle wins it off them — see kick()/tackle().
    if (this.phase === 'play' && !this.possessor && b.y < 0.6 && Math.hypot(b.vx, b.vz) < 7) {
      for (const p of this.players) {
        if (p.stun > 0 || p.cool > 0) continue;
        if (Math.hypot(b.x - p.x, b.z - p.z) < 0.85) { this.possessor = p.id; break; }
      }
    }
    if (this.possessor) {
      const p = this.player(this.possessor);
      if (!p) this.possessor = null;
      else {
        const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
        const tx = p.x + fx * 0.55, tz = p.z + fz * 0.55;
        b.x += (tx - b.x) * Math.min(1, dt * 12); b.z += (tz - b.z) * Math.min(1, dt * 12);
        b.y += (BALL_R - b.y) * Math.min(1, dt * 12);
        b.vx = p.vx; b.vz = p.vz; b.vy = 0;
        this.lastTouch = p.id;
        return; // no free-flight physics while possessed
      }
    }
    b.vy -= 9.8 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y < BALL_R) { b.y = BALL_R; if (b.vy < -1.5) { b.vy = -b.vy * 0.55; this.events.push({ type: 'bounce' }); } else b.vy = 0; }
    const fr = b.y <= BALL_R + 0.01 ? 0.985 : 0.998;
    const f = Math.pow(fr, dt * 60);
    b.vx *= f; b.vz *= f;
    // goals
    for (const side of [1, -1]) {
      if (b.x * side > HL && Math.abs(b.z) < GOAL_W / 2 && b.y < GOAL_H && this.phase === 'play') {
        const scoringTeam = side === 1 ? 0 : 1;
        this.score[scoringTeam]++;
        this.phase = 'goal'; this.phaseT = 0; this.kickoffTeam = 1 - scoringTeam;
        this.events.push({ type: 'goal', team: scoringTeam, by: this.lastTouch, score: [...this.score] });
        b.vx *= 0.2; b.vz *= 0.2;
        return;
      }
    }
    // out of bounds -> simple restart inside the line (throw-in / goal kick)
    if (this.phase === 'play' && (Math.abs(b.z) > HW + 0.5 || Math.abs(b.x) > HL + 0.5)) {
      b.x = Math.max(-HL + 5, Math.min(HL - 5, b.x)); b.z = Math.max(-HW + 1.5, Math.min(HW - 1.5, b.z));
      b.vx = b.vy = b.vz = 0; b.y = BALL_R;
      this.events.push({ type: 'out' });
    }
    if (this.phase === 'goal') { b.x = Math.max(-HL - 2, Math.min(HL + 2, b.x)); b.z = Math.max(-GOAL_W / 2, Math.min(GOAL_W / 2, b.z)); }
  }

  stepAI(dt) {
    const b = this.ball;
    const chasers = [null, null];
    for (const t of [0, 1]) chasers[t] = this.nearestTo(b.x, b.z, (p) => p.team === t && p.role !== 'GK' && p.stun <= 0);
    for (const p of this.players) {
      if (p.human) continue;
      if (p.stun > 0) { p.vx *= 0.8; p.vz *= 0.8; continue; }
      const dir = p.team === 0 ? 1 : -1; // attacking direction (+x for team 0)
      let tx, tz, speed = 6.2;
      const dBall = Math.hypot(b.x - p.x, b.z - p.z);
      if (this.phase === 'kickoff' && p.team !== this.kickoffTeam) { tx = p.hx; tz = p.hz; speed = 3; }
      else if (this.phase === 'goal') { tx = p.hx; tz = p.hz; speed = 2; }
      else if (p.role === 'GK') {
        tx = -HL * dir + 1.5 * dir; tz = Math.max(-GOAL_W / 2, Math.min(GOAL_W / 2, b.z * 0.6));
        if (dBall < 12 && (b.x * dir) < -HL + 18) { tx = b.x; tz = b.z; speed = 7; }
      } else if (chasers[p.team] === p || dBall < 3) { tx = b.x - dir * 0.6; tz = b.z; speed = 7.2; }
      else {
        // hold shape, shifted with the ball
        tx = p.hx + b.x * 0.55; tz = p.hz * 0.8 + b.z * 0.35;
        if (p.role === 'FWD') tx = Math.max(tx, b.x + dir * 8);
        speed = 5;
      }
      const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
      const sp = d > 0.4 ? Math.min(speed, d * 3) : 0;
      const tvx = d > 0 ? (dx / d) * sp : 0, tvz = d > 0 ? (dz / d) * sp : 0;
      p.vx += (tvx - p.vx) * Math.min(1, dt * 5); p.vz += (tvz - p.vz) * Math.min(1, dt * 5);
      p.x += p.vx * dt; p.z += p.vz * dt;
      if (Math.hypot(p.vx, p.vz) > 0.3) p.yaw = Math.atan2(p.vx, p.vz);
      // decisions with the ball
      const lastP = this.lastTouch ? this.player(this.lastTouch) : null;
      const oppControls = lastP && lastP.team !== p.team && Math.hypot(lastP.x - b.x, lastP.z - b.z) < 1.6 && Math.hypot(b.vx, b.vz) < 9;
      if (oppControls && dBall < 1.8 && p.cool <= 0 && this.phase === 'play') { if (Math.random() < dt * 3) this.tackle(p.id); continue; }
      if (dBall < 1.3 && p.cool <= 0 && (this.phase === 'play' || (this.phase === 'kickoff' && p.team === this.kickoffTeam && this.phaseT > 1.5))) {
        const goalX = HL * dir;
        const toGoal = Math.hypot(goalX - p.x, 0 - p.z);
        if (toGoal < 26 || p.role === 'GK') {
          const aimZ = (Math.random() - 0.5) * GOAL_W * 0.8;
          this.kick(p.id, goalX - p.x, aimZ - p.z, p.role === 'GK' ? 0.9 : 0.7 + Math.random() * 0.3, p.role === 'GK' ? 0.6 : Math.random() * 0.3);
        } else {
          // pass to the most advanced open teammate, else dribble forward
          let mate = null, best = -Infinity;
          for (const q of this.players) {
            if (q === p || q.team !== p.team || q.role === 'GK') continue;
            const adv = (q.x - p.x) * dir;
            const open = Math.min(...this.players.filter((o) => o.team !== p.team).map((o) => Math.hypot(o.x - q.x, o.z - q.z)));
            const score = adv * 0.5 + open - Math.hypot(q.x - p.x, q.z - p.z) * 0.15;
            if (adv > 2 && open > 4 && score > best) { best = score; mate = q; }
          }
          if (mate && Math.random() < 0.6) {
            const d2 = Math.hypot(mate.x - p.x, mate.z - p.z);
            this.kick(p.id, mate.x + mate.vx * 0.5 - p.x, mate.z + mate.vz * 0.5 - p.z, Math.min(1, 0.25 + d2 / 40), d2 > 25 ? 0.3 : 0);
          } else {
            // dribble: touch the ball ahead, steering away from the nearest opponent
            const opp = this.nearestTo(p.x, p.z, (o) => o.team !== p.team);
            const away = opp && Math.hypot(opp.x - p.x, opp.z - p.z) < 5 ? Math.sign(p.z - opp.z || 1) * 0.6 : 0;
            this.kick(p.id, dir, -p.z * 0.03 + away + (Math.random() - 0.5) * 0.3, 0.1, 0, 7.5);
            p.cool = 0.35;
          }
        }
      }

    }
  }

  snapshot() {
    const b = this.ball;
    return {
      ph: this.phase, t: Math.round(this.time * 10) / 10, dur: this.duration, s: this.score, kt: this.kickoffTeam,
      b: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2), +b.vx.toFixed(1), +b.vy.toFixed(1), +b.vz.toFixed(1)],
      p: this.players.map((p) => [p.id, p.team, p.human ? 1 : 0, +p.x.toFixed(2), +p.z.toFixed(2), +p.yaw.toFixed(2), +Math.hypot(p.vx, p.vz).toFixed(1), p.role]),
    };
  }
  drainEvents() { const e = this.events; this.events = []; return e; }
}
