import * as THREE from 'three';
import { NPC } from '../npc/NPC.js';
import { districtAt } from '../../shared/map/layout.js';

// Random world events: arguments, street fights, gang shootouts, robberies, beggars,
// people asking for directions, chases, groups hanging out and people picking fights.
// Rougher districts roll the criminal events more often.
const EVENTS = {
  argument: { w: 3, crime: 0.2 }, streetFight: { w: 2, crime: 0.6 }, shootout: { w: 1, crime: 1, districts: ['eastside', 'industrial', 'redbrick'] },
  robbery: { w: 2, crime: 0.8 }, beggar: { w: 2, crime: 0.3 }, directions: { w: 2, crime: 0 }, chase: { w: 1.5, crime: 0.5 },
  hangout: { w: 3, crime: 0 }, troublemaker: { w: 1.5, crime: 0.5 },
};

export class Events {
  constructor(game) {
    this.game = game;
    this.active = [];
    this.timer = 25;
    this.policeDuty = false;
  }
  setPoliceDuty(on) { this.policeDuty = on; }
  spawnNpc(role, pos, extra = {}) {
    const g = this.game;
    const n = new NPC(g.npcs, { role, variant: Math.floor(Math.random() * 3), x: pos.x, y: g.world.collision.groundAt(pos.x, pos.z), z: pos.z, ...extra });
    g.npcs.add(n); g.npcs.npcs.push(n);
    return n;
  }
  spotNear(minD = 35, maxD = 80) {
    const g = this.game;
    const pp = g.player.pos;
    for (let i = 0; i < 20; i++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = pp.x + Math.cos(a) * d, z = pp.z + Math.sin(a) * d;
      const n = g.layout.roadIndex.nearest(x, z, 25);
      if (!n || n.road.type === 'highway') continue;
      const off = n.road.width / 2 + 1.8;
      const [ax, az] = n.road.pts[n.i], [bx, bz] = n.road.pts[n.i + 1] || n.road.pts[n.i];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      const p = new THREE.Vector3(n.q[0] - ((bz - az) / L) * off, 0, n.q[1] + ((bx - ax) / L) * off);
      if (g.world.collision.isWater(p.x, p.z)) continue;
      return p;
    }
    return null;
  }
  pick() {
    const g = this.game;
    const dist = districtAt(g.player.pos.x, g.player.pos.z);
    const crimeMul = 0.4 + (dist.crime || 0.2) * 2;
    const opts = Object.entries(EVENTS).filter(([, e]) => !e.districts || e.districts.includes(dist.id));
    const weights = opts.map(([k, e]) => [k, e.w * (e.crime ? 1 + (crimeMul - 1) * e.crime : 1)]);
    let r = Math.random() * weights.reduce((s, x) => s + x[1], 0);
    for (const [k, w] of weights) { r -= w; if (r <= 0) return k; }
    return 'hangout';
  }

  update(dt) {
    const g = this.game;
    if (!g.player || g.player.interior || g.inActivity || g.player.mode !== 'foot' && !g.vehicles?.current) return;
    this.timer -= dt;
    if (this.timer <= 0 && this.active.length < 2) { this.timer = 35 + Math.random() * 50; this.start(this.pick()); }
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i];
      e.t += dt;
      e.tick?.(dt);
      if (this.policeDuty) for (const n of e.bounty || []) if (!n.alive && n.killedBy === g.avatar && !n.bountyPaid) {
        n.bountyPaid = true;
        g.net.request('reward', { kind: 'police', amount: 150 }).then((r) => { if (r.ok) { if (r.profile) g.setProfile(r.profile); g.ui.notify(`Criminal neutralized: +$${r.amount}`, 'good'); } });
      }
      const far = e.pos.distanceTo(g.player.pos) > 220;
      if (e.t > (e.life || 80) || far || e.done) { this.active.splice(i, 1); e.end?.(); }
    }
  }

  start(kind) {
    const g = this.game;
    const pos = this.spotNear();
    if (!pos) return;
    const e = { kind, pos, t: 0, npcs: [] };
    const add = (role, dx, dz, extra) => { const n = this.spawnNpc(role, pos.clone().add(new THREE.Vector3(dx, 0, dz)), extra); e.npcs.push(n); return n; };
    const face = (a, b) => { a.heading = Math.atan2(b.position.x - a.position.x, b.position.z - a.position.z); };
    switch (kind) {
      case 'argument': {
        const a = add('civilian', 0, 0), b = add('civilian', 1.4, 0.3);
        for (const n of [a, b]) { n.state = 'idle'; n.timer = 30; n.fixed = true; n.home.copy(n.position); }
        face(a, b); face(b, a); a.homeYaw = a.heading; b.homeYaw = b.heading;
        const lines = [['You scratched my car!', 'It was already scratched!'], ['That was MY parking spot!', 'I was here first!'], ['You still owe me twenty bucks!', 'I paid you back last week!'], ['Pineapple does NOT go on pizza!', 'Say that again!']][Math.floor(Math.random() * 4)];
        let k = 0;
        e.tick = () => { if (e.t > k * 3 && k < 6) { (k % 2 ? b : a).say(lines[k % 2] + (k > 1 ? '!!' : ''), 2.6); (k % 2 ? b : a).avatar.anim.play('taunt'); k++; } if (k === 6 && Math.random() < 0.004) { a.threat = b; a.state = 'fight'; a.timer = 12; b.provoke(a, 'attacked'); k++; } };
        break;
      }
      case 'streetFight': {
        const a = add('civilian', 0, 0), b = add(Math.random() < 0.5 ? 'gang' : 'civilian', 1.2, 0);
        a.threat = b; a.state = 'fight'; a.timer = 25; b.threat = a; b.state = 'fight'; b.timer = 25;
        a.say('Come on then!'); b.say("You're done!");
        g.dialogue?.logEvent(pos, 'a street fight broke out');
        break;
      }
      case 'shootout': {
        const A = [add('gang', -8, 0), add('gang', -9, 2), add('gang', -10, -2)];
        const B = [add('gang', 8, 0), add('gang', 9, 2), add('gang', 10, -2)];
        for (const n of [...A, ...B]) { n.armed = true; n.weapon = Math.random() < 0.4 ? 'ak47' : 'glock'; n.state = 'shoot'; n.timer = 40; }
        A.forEach((n, i) => (n.threat = B[i])); B.forEach((n, i) => (n.threat = A[i]));
        A[0].say('Eastside!!'); B[0].say('Get them!');
        g.ui.notify('Gang shootout nearby!', 'bad');
        g.dialogue?.logEvent(pos, 'a gang shootout happened');
        if (this.policeDuty) e.bounty = [...A, ...B];
        break;
      }
      case 'robbery': {
        const victim = add('civilian', 0, 0), robber = add('gang', 1.3, 0);
        victim.state = 'idle'; victim.timer = 30; victim.handsUp = true; victim.fixed = true; face(victim, robber); victim.homeYaw = victim.heading;
        robber.state = 'idle'; robber.armed = true; robber.weapon = 'glock'; robber.fixed = true; face(robber, victim); robber.homeYaw = robber.heading;
        robber.say('Wallet. Now.'); victim.say('Please! Take it!');
        e.tick = () => {
          if (e.t > 6 && !e.fled) { e.fled = true; robber.fixed = false; robber.state = 'flee'; robber.threat = victim; robber.timer = 20; robber.say('Later, sucker!'); victim.handsUp = false; victim.fixed = false; victim.say('HELP! I got robbed!'); victim.state = 'goto'; victim.target = robber.position.clone(); }
          if (!robber.alive && !e.rewarded) { e.rewarded = true; victim.say('You got him! Thank you!!'); g.remember?.(victim, 'The player stopped the guy who robbed you. You are grateful.'); g.net.request('reward', { kind: 'event', amount: 100 }).then((r) => { if (r.ok) { if (r.profile) g.setProfile(r.profile); g.ui.notify(`Reward for stopping the robber: +$${r.amount}`, 'good'); } }); }
        };
        g.dialogue?.logEvent(pos, 'someone got robbed at gunpoint');
        if (this.policeDuty) g.ui.notify('Dispatch: armed robbery in progress (red blip).', 'bad');
        e.bounty = [robber];
        break;
      }
      case 'beggar': {
        const b = add('junkie', 0, 0);
        b.state = 'goto'; b.target = g.player.pos.clone(); b.after = 'idle'; b.fixed = true;
        e.beggar = b;
        e.tick = () => { if (b.state === 'idle' && !e.asked && b.position.distanceTo(g.player.pos) < 3) { e.asked = true; b.say('Spare five bucks, friend?'); } if (b.state === 'idle') { b.home.copy(b.position); } };
        break;
      }
      case 'directions': {
        const n = add('civilian', 0, 0);
        n.state = 'goto'; n.target = g.player.pos.clone(); n.after = 'idle'; n.fixed = true;
        const places = [['hospital', 'hospital'], ['police station', 'police'], ['gun store', 'gunstore1'], ['gym', 'gym'], ['garage', 'garage']];
        e.place = places[Math.floor(Math.random() * places.length)];
        e.asker = n;
        e.tick = () => { if (n.state === 'idle' && !e.asked && n.position.distanceTo(g.player.pos) < 3.5) { e.asked = true; n.say(`Excuse me, where's the ${e.place[0]}?`, 5); } if (n.state === 'idle') n.home.copy(n.position); };
        break;
      }
      case 'chase': {
        const thief = add('junkie', 0, 0), owner = add('civilian', -4, 0);
        thief.state = 'flee'; thief.threat = owner; thief.timer = 30; thief.say('Gotta go!');
        owner.state = 'goto'; owner.runTo = true; owner.target = thief.position; owner.after = 'wander'; owner.say('STOP! THIEF!');
        e.tick = () => { owner.target = thief.position; };
        e.bounty = [thief];
        break;
      }
      case 'hangout': {
        const n = 3 + Math.floor(Math.random() * 2);
        const members = [];
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; members.push(add(Math.random() < 0.3 ? 'athlete' : 'civilian', Math.cos(a) * 1.3, Math.sin(a) * 1.3)); }
        for (const m of members) { m.state = 'idle'; m.fixed = true; m.home.copy(m.position); m.heading = m.homeYaw = Math.atan2(pos.x - m.position.x, pos.z - m.position.z); m.timer = 999; }
        const chat = ['Did you see the game last night?', 'No way!', 'Hahaha', 'Bro, trust me.', 'That gorilla guy is hilarious.', 'We should hit the beach later.', 'Who wants tacos?'];
        e.tick = () => { if (Math.random() < 0.01) { const m = members[Math.floor(Math.random() * members.length)]; m.say(chat[Math.floor(Math.random() * chat.length)], 2.5); m.avatar.anim.play(Math.random() < 0.5 ? 'taunt' : 'wave'); } };
        e.life = 120;
        break;
      }
      case 'troublemaker': {
        const n = add(Math.random() < 0.5 ? 'gang' : 'athlete', 0, 0);
        n.state = 'goto'; n.target = g.player.pos.clone(); n.runTo = false; n.after = 'idle';
        e.tick = () => {
          if (n.state === 'idle' && !e.challenged && n.position.distanceTo(g.player.pos) < 4) { e.challenged = true; n.say('You looking at me? Put em up!'); setTimeout(() => { if (n.alive) { n.threat = g.avatar; n.state = 'fight'; n.timer = 20; } }, 2500); }
          if (n.state === 'goto') n.target = g.player.pos.clone();
        };
        break;
      }
      default: break;
    }
    e.end = () => { for (const n of e.npcs) { if (n.state === 'idle' && n.fixed) { n.fixed = false; n.state = 'wander'; } n.handsUp = false; } };
    this.active.push(e);
  }

  interactions(out, pos) {
    const g = this.game;
    for (const e of this.active) {
      if (e.kind === 'beggar' && e.asked && !e.given && e.beggar.alive && e.beggar.position.distanceTo(pos) < 3) {
        out.push({ label: 'Give $5', key: 'interact', priority: 6, action: async () => {
          e.given = true;
          if (g.profile.money < 5) return g.ui.notify("You're broke too.", 'bad');
          g.net.request('reward', { kind: 'tip' }).then((r) => r.profile && g.setProfile(r.profile));
          e.beggar.say('Bless you! You are a legend!'); g.remember?.(e.beggar, 'The player gave you $5. They are kind.', 2);
          e.beggar.fixed = false; e.beggar.state = 'wander';
        } });
      }
      if (e.kind === 'directions' && e.asked && !e.answered && e.asker.position.distanceTo(pos) < 3.5) {
        out.push({ label: `Point to the ${e.place[0]}`, key: 'interact', priority: 6, action: () => {
          e.answered = true;
          const b = g.layout.buildings[g.layout.special[e.place[1]]];
          e.asker.say('Oh, over there? Thanks so much!');
          g.avatar.anim.play('interact');
          g.remember?.(e.asker, `The player helped you find the ${e.place[0]}.`, 2);
          e.asker.fixed = false; e.asker.state = 'goto'; e.asker.target = new THREE.Vector3(b.door.x, 0, b.door.z); e.asker.after = 'wander';
        } });
      }
    }
  }
  blips(out) {
    if (!this.policeDuty) return;
    for (const e of this.active) for (const n of e.bounty || []) if (n.alive) out.push({ x: n.position.x, z: n.position.z, color: '#ff4757', size: 5 });
  }
}
