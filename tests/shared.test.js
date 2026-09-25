import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLayout, districtAt, WORLD } from '../shared/map/layout.js';
import { applyPurchase, applyReward, newProfile } from '../shared/economy.js';
import { FootballSim } from '../shared/sports/football.js';
import { BasketballSim } from '../shared/sports/basketball.js';
import { WrestlingSim } from '../shared/sports/wrestling.js';
import { interiorAt, interiorOrigin } from '../shared/interiors.js';

test('city layout is generated from the map and is consistent', () => {
  const L = getLayout();
  assert.ok(L.roads.length > 40, 'roads');
  assert.ok(L.buildings.length > 300, 'buildings');
  assert.ok(L.graph.edges.length > 200, 'road graph');
  for (const key of ['police', 'hospital', 'gunstore1', 'gunstore2', 'safehouse', 'taxi_depot']) assert.ok(L.buildings[L.special[key]], `special ${key}`);
  for (const b of L.buildings) {
    assert.ok(b.x > WORLD.minX && b.x < WORLD.maxX && b.z > WORLD.minZ && b.z < WORLD.maxZ, 'inside world');
    assert.ok(b.door && Number.isFinite(b.door.x), 'has a door');
  }
  assert.equal(districtAt(-150, 0).id, 'downtown');
});

test('interior slots map back to their building', () => {
  for (const id of [0, 5, 23, 24, 150, 376]) { const o = interiorOrigin(id); assert.equal(interiorAt(o.x + 3, o.z - 2), id); }
  assert.equal(interiorAt(0, 0), null);
});

test('economy: purchases are validated', () => {
  const p = newProfile();
  assert.equal(applyPurchase(p, 'ak47').ok, false, 'too expensive at start');
  assert.equal(applyPurchase(p, 'deagle').ok, true);
  assert.equal(applyPurchase(p, 'deagle').ok, false, 'no duplicates');
  assert.ok(p.ammo.deagle > 0);
  assert.equal(applyPurchase(p, 'nope').ok, false);
  const before = p.money;
  applyReward(p, 'taxi', { amount: 99999 });
  assert.ok(p.money - before <= 900, 'taxi pay is clamped');
  applyReward(p, 'arrest', { fine: 999999 });
  assert.ok(p.money >= 0);
});

test('football sim: AI teams play and can score', () => {
  let goals = 0;
  for (let k = 0; k < 4 && !goals; k++) {
    const s = new FootballSim({ perTeam: 5, duration: 240 });
    s.setHumans([]); s.start();
    for (let i = 0; i < 250 * 30; i++) s.step(1 / 30);
    goals += s.score[0] + s.score[1];
    assert.equal(s.phase, 'end');
  }
  assert.ok(goals > 0, 'someone scored');
});

test('football sim: humans kick only when close to the ball', () => {
  const s = new FootballSim({ perTeam: 3 });
  s.setHumans([{ id: 'h', team: 0 }]); s.start();
  s.report('h', 20, 20, 0, 5);
  assert.equal(s.kick('h', 1, 0, 1), false);
  s.player('h').x = 0.5; s.player('h').z = 0;
  assert.equal(s.kick('h', 1, 0, 1), true);
  assert.ok(s.ball.vx > 20);
});

test('basketball sim: shots, rim physics and scoring', () => {
  let pts = 0;
  for (let k = 0; k < 4 && !pts; k++) {
    const s = new BasketballSim({ perTeam: 3, duration: 200 });
    s.setHumans([]); s.start();
    for (let i = 0; i < 200 * 30; i++) s.step(1 / 30);
    pts += s.score[0] + s.score[1];
  }
  assert.ok(pts > 0, 'points scored');
});

test('basketball sim: a perfect open shot from close range goes in', () => {
  let made = 0;
  for (let k = 0; k < 20; k++) {
    const s = new BasketballSim({ perTeam: 1 });
    s.setHumans([{ id: 'h', team: 0 }]); s.phase = 'play';
    const p = s.player('h'); p.x = 8; p.z = 0; p.yaw = Math.PI / 2;
    s.players.filter((q) => q.team === 1).forEach((q) => { q.x = -12; q.z = 5; q.human = true; });
    s.give(p);
    s.shoot('h', 1);
    for (let i = 0; i < 90; i++) s.step(1 / 30);
    if (s.score[0] > 0) made++;
  }
  assert.ok(made >= 12, `made ${made}/20 perfect shots`);
});

test('wrestling sim: matches end by pinfall', () => {
  const s = new WrestlingSim();
  s.setHumans([], 2); s.start();
  let t = 0;
  while (s.phase === 'play' && t < 900) { s.step(1 / 30); t += 1 / 30; }
  assert.equal(s.phase, 'end');
  assert.ok(s.winner);
});
