// Two independent browser clients join the same room and see each other.
import { chromium } from 'playwright-core';
const out = process.argv[2];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
async function client(name, character) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message, e.stack?.slice(0, 500)));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && !/CERT|favicon/.test(t)) console.log(`[${name}]`, t.slice(0, 300)); });
  await page.addInitScript(([n, c]) => localStorage.setItem('bayview.settings', JSON.stringify({ 'player.name': n, 'player.character': c })), [name, character]);
  await page.goto('http://localhost:5173/?quality=low');
  await page.waitForFunction(() => window.game && window.game.mode === 'menu', null, { timeout: 150000 });
  return page;
}
const [a, b] = await Promise.all([client('Alice', 'ajan'), client('Bob', 'lucky')]);
const ra = await a.evaluate(async () => { await game.quickPlay(); return { code: game.net.room?.code, id: game.net.id }; });
console.log('A joined', ra);
const rb = await b.evaluate(async () => { await game.quickPlay(); return { code: game.net.room?.code, id: game.net.id }; });
console.log('B joined', rb);
// move B next to A, facing
await b.evaluate(() => { const p = game.player.pos; const ap = [-300, 0, -6]; game.player.teleport(ap[0] + 3, null, ap[2], -Math.PI / 2); });
await a.evaluate(() => { game.player.teleport(-300, null, -6, Math.PI / 2); game.cam.yaw = -Math.PI / 2 ; game.cam.pitch = -0.1; });
await a.waitForTimeout(4000);
console.log('A dbg', await a.evaluate(() => { let n=0; game.net.on('snap',()=>n++); return new Promise(r=>setTimeout(()=>r({snaps:n, fps: game.engine.fps, running: game.engine.running, buf:[...game.mp.remotes.values()].map(r=>r.buf.length)}),1000)); }));
const sa = await a.evaluate(() => ({ remotes: [...game.mp.remotes.values()].map((r) => ({ name: r.avatar.name, ch: r.avatar.key, pos: r.avatar.position.toArray().map((v) => +v.toFixed(1)), vis: r.avatar.group.visible })) }));
const sb = await b.evaluate(() => ({ remotes: [...game.mp.remotes.values()].map((r) => ({ name: r.avatar.name, ch: r.avatar.key, pos: r.avatar.position.toArray().map((v) => +v.toFixed(1)) })) }));
console.log('A sees', JSON.stringify(sa));
console.log('B sees', JSON.stringify(sb));
await b.evaluate(() => game.sendChat('hello from Bob'));
await a.waitForTimeout(800);
console.log('A chat', await a.evaluate(() => [...document.querySelectorAll('#chat .log div')].map((d) => d.textContent)));
await a.screenshot({ path: out });
await browser.close();
