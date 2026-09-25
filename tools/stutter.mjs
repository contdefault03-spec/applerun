// First-use stutter probe: spawns, then performs each "first time" action and reports the
// number of new shader programs it caused (each one is a
// compile hitch on a real GPU) plus the time the call itself took. Usage: node tools/stutter.mjs [url]
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:5173/?quality=low&offline=1';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => localStorage.setItem('bayview.settings', JSON.stringify({ 'player.name': 'Tester' })));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.mode === 'menu', null, { timeout: 180000 });
const res = await page.evaluate(async () => {
  const g = window.game;
  await g.quickPlay();
  await g.audio.init?.();
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const measure = async (label, fn) => {
    await wait(1500);
    const progs0 = g.engine.renderer.info.programs.length;
    const t0 = performance.now();
    await fn();
    const call = performance.now() - t0;
    await wait(1500);
    return { label, callMs: Math.round(call), newShaderPrograms: g.engine.renderer.info.programs.length - progs0 };
  };
  const out = [];
  g.weapons.owned.push('pistol', 'ak47'); g.profile.ammo = { ...(g.profile.ammo || {}), pistol: 50, ak47: 90 }; g.weapons.mags.pistol = 13; g.weapons.mags.ak47 = 30;
  out.push(await measure('equip pistol', () => g.weapons.equip('pistol')));
  out.push(await measure('first shot', () => { g.weapons.cooldown = 0; g.weapons.fire(); }));
  out.push(await measure('second shot', () => { g.weapons.cooldown = 0; g.weapons.fire(); }));
  out.push(await measure('explosion', () => g.fx.explosion(g.player.pos.clone().add({ x: 6, y: 0, z: 6 }))));
  const v = g.vehicles.nearest(g.player.pos, 400) || [...g.vehicles.vehicles.values()][0];
  if (v) {
    g.player.teleport(v.position.x + 2, v.position.y, v.position.z, 0);
    out.push(await measure('first vehicle entry', () => g.vehicles.enter(v, 0)));
    out.push(await measure('vehicle exit', () => { g.vehicles.toggleCd = 0; g.vehicles.exitLocal(true); }));
  }
  out.push(await measure('spawn fleeing NPC', () => g.npcs.spawnFleeing(g.player.pos.clone().add({ x: 4, y: 0, z: 4 }), 'test')));
  out.push(await measure('police wanted 3', () => g.police.setWanted ? g.police.setWanted(3) : g.police.reportCrime('assault', 3, g.player.pos)));
  out.push(await measure('enter interior', () => g.interiors.enter(g.layout.buildings[5].id)));
  out.push(await measure('exit interior', () => g.interiors.exit()));
  return out;
});
console.table(res);
await browser.close();
