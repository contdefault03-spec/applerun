import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const PORT = 18000 + Math.floor(Math.random() * 1000);
let proc;
before(async () => {
  proc = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(PORT), GEMINI_API_KEY: '', DATA_FILE: path.join(os.tmpdir(), `bayview-test-${PORT}.json`) }, stdio: 'pipe' });
  await new Promise((res, rej) => { proc.stdout.on('data', (d) => String(d).includes('listening') && res()); proc.on('exit', rej); setTimeout(() => rej(new Error('server start timeout')), 15000); });
});
after(() => proc?.kill());

function client(name, character = 'max') {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws`);
  const c = { ws, msgs: [], id: null, pending: new Map(), n: 1 };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'res') { c.pending.get(m.id)?.(m.data); return; }
    c.msgs.push(m);
  });
  c.send = (t, d = {}) => ws.send(JSON.stringify({ t, ...d }));
  c.req = (op, data = {}) => new Promise((res) => { const id = c.n++; c.pending.set(id, res); ws.send(JSON.stringify({ t: 'req', id, op, data })); });
  c.wait = (t, pred = () => true, ms = 4000) => new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => { const m = c.msgs.find((x) => x.t === t && pred(x)); if (m) { clearInterval(iv); res(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error('timeout waiting for ' + t)); } }, 20);
  });
  c.ready = new Promise((res) => ws.on('open', () => { c.send('hello', { name, character }); c.wait('welcome').then((w) => { c.id = w.id; res(c); }); }));
  return c;
}

test('two players join the same room, see each other and chat', async () => {
  const a = await client('Alice', 'ajan').ready;
  const b = await client('Bob', 'lucky').ready;
  const ra = await a.req('createRoom', { kind: 'world', private: true });
  assert.ok(ra.ok && ra.room.code.length === 5);
  const rb = await b.req('joinRoom', { code: ra.room.code });
  assert.ok(rb.ok);
  assert.equal(rb.players[0].name, 'Alice');
  a.send('state', { p: [10, 0, 10], r: 0, s: 0, a: 1, w: 'fists' });
  const snap = await b.wait('snap', (m) => m.p.some((p) => p[0] === a.id && p[1] === 10));
  assert.ok(snap);
  b.send('chat', { text: 'hi alice' });
  const chat = await a.wait('chat', (m) => m.text === 'hi alice');
  assert.equal(chat.name, 'Bob');
  a.ws.close(); b.ws.close();
});

test('server validates purchases, movement and gunfire', async () => {
  const a = await client('Shooter').ready;
  const b = await client('Target').ready;
  const r = await a.req('createRoom', { kind: 'world', private: true });
  await b.req('joinRoom', { code: r.room.code });
  // buying outside a gun store is rejected
  const buy = await a.req('buy', { item: 'deagle' });
  assert.equal(buy.ok, false);
  // teleport hack is rejected
  a.send('state', { p: [0, 0, 0], r: 0, s: 0, a: 1, w: 'pistol' });
  await new Promise((res) => setTimeout(res, 150));
  a.send('state', { p: [400, 0, 400], r: 0, s: 0, a: 1, w: 'pistol' });
  // (grace period after joining allows it — wait it out and try again)
  await new Promise((res) => setTimeout(res, 4200));
  a.send('state', { p: [0, 0, 0], r: 0, s: 0, a: 1, w: 'pistol' });
  await new Promise((res) => setTimeout(res, 120));
  a.send('state', { p: [900, 0, 900], r: 0, s: 0, a: 1, w: 'pistol' });
  await a.wait('correct');
  a.ws.close(); b.ws.close();
});

test('server-side hit validation with line checks and weapon ownership', async () => {
  const a = await client('Shooter2').ready;
  const b = await client('Target2').ready;
  const r = await a.req('createRoom', { kind: 'world', private: true });
  await b.req('joinRoom', { code: r.room.code });
  // valid shot: shooter at (-100,-300) facing target 10 m away — away from safe zones (still in join grace)
  a.send('state', { p: [-262, 0, 414], r: 0, s: 0, a: 1, w: 'pistol' });
  b.send('state', { p: [-252, 0, 414], r: 0, s: 0, a: 1, w: 'fists' });
  await new Promise((res) => setTimeout(res, 300));
  a.send('shoot', { w: 'pistol', o: [-262, 1.5, 414], d: [1, 0, 0], hit: { id: b.id, head: false } });
  const hit = await b.wait('hit', (m) => m.to === b.id);
  assert.ok(hit.dmg > 10 && hit.hp < 100);
  // a shot that doesn't actually line up with the target is rejected
  await new Promise((res) => setTimeout(res, 400));
  const before = b.msgs.filter((m) => m.t === 'hit').length;
  a.send('shoot', { w: 'pistol', o: [-262, 1.5, 414], d: [0, 0, 1], hit: { id: b.id, head: true } });
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(b.msgs.filter((m) => m.t === 'hit').length, before, 'miss not counted as hit');
  // weapons the player doesn't own can't be fired
  a.send('shoot', { w: 'bolt', o: [-262, 1.5, 414], d: [1, 0, 0], hit: { id: b.id } });
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(b.msgs.filter((m) => m.t === 'hit').length, before);
  a.ws.close(); b.ws.close();
});

test('activity rooms run the football sim on the server', async () => {
  const a = await client('Host').ready;
  const r = await a.req('createRoom', { kind: 'activity', mode: 'football', size: '1v1', private: true });
  assert.ok(r.ok);
  const st = await a.req('actStart', {});
  assert.ok(st.ok);
  const act = await a.wait('act', (m) => m.snap?.p?.length >= 2);
  assert.equal(act.snap.ph, 'kickoff');
  a.ws.close();
});
