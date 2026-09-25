import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
async function client(name) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name} pageerror]`, e.message));
  page.on('console', (m) => { if (/voice/.test(m.text())) console.log(`[${name}]`, m.text().slice(0, 200)); });
  await page.addInitScript((n) => localStorage.setItem('bayview.settings', JSON.stringify({ 'player.name': n })), name);
  await page.goto('http://localhost:5173/?quality=low');
  await page.waitForFunction(() => window.game && window.game.mode === 'menu', null, { timeout: 200000 });
  return page;
}
const [a, b] = await Promise.all([client('Alice'), client('Bob')]);
const code = await a.evaluate(async () => { await game.createRoom({ kind: 'world', private: true }); return game.net.room.code; });
await b.evaluate(async (c) => { await game.joinRoom(c); }, code);
await a.evaluate(() => { game.player.teleport(-300, null, -6); });
await b.evaluate(() => { game.player.teleport(-296, null, -6); });
await a.waitForTimeout(3000);
// Alice holds V
await a.evaluate(() => { game.input.locked = true; game.input.keys.add('KeyV'); });
await a.waitForTimeout(6000);
const ra = await a.evaluate(() => ({ tx: game.voice.transmitting, perm: game.voice.permission, peers: [...game.voice.peers.values()].map((p) => p.pc.connectionState) }));
const rb = await b.evaluate(() => ({ peers: [...game.voice.peers.values()].map((p) => ({ state: p.pc.connectionState, hasAudio: !!p.gain, gain: p.gain?.gain.value })), talkingTag: [...game.mp.remotes.values()].map((r) => r.talking) }));
console.log('Alice', JSON.stringify(ra));
console.log('Bob', JSON.stringify(rb));
await browser.close();
