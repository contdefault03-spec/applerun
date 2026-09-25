// Captures a fixed set of comparison screenshots (used for before/after shots of each stage).
// Usage: node tools/views.mjs <outDir> [url] [onlyViewNames,comma,separated]
// The camera is overridden right before each render so it works on any version of the game.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [outDir = 'shots', url = 'http://localhost:5173/?quality=high', only] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
// world coords: x = (px - 500) * 1.2, z = (py - 545) * 1.2 on the reference map
export const VIEWS = [
  { name: 'menu', menu: true },
  { name: 'street', player: [0, 0], cam: [8, 6, 22], look: [0, 3, -20], time: 11 },
  { name: 'aerial', player: [0, 0], cam: [260, 520, 720], look: [0, 0, 0], time: 11 },
  { name: 'mountain-edge', player: [480, -450], cam: [760, 160, -120], look: [440, 60, -460], time: 11 },
  { name: 'north-edge', player: [0, -560], cam: [60, 90, -470], look: [-40, 0, -760], time: 11 },
  { name: 'pier', player: [-380, 0], cam: [-300, 25, 40], look: [-420, 2, 0], time: 17.5 },
  { name: 'night', player: [0, 0], cam: [10, 8, 24], look: [0, 4, -30], time: 22.5 },
];
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +(process.env.VW || 1280), height: +(process.env.VH || 720) } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => localStorage.setItem('bayview.settings', JSON.stringify({ 'player.name': 'Tester' })));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.mode === 'menu', null, { timeout: 240000 });
await page.waitForTimeout(3000);
for (const v of VIEWS) {
  if (only && !only.split(',').includes(v.name)) continue;
  if (v.menu) { await page.screenshot({ path: `${outDir}/${v.name}.png` }); console.log('saved', v.name); continue; }
  await page.evaluate(async (v) => {
    const g = window.game;
    if (g.mode !== 'playing') await g.quickPlay();
    g.ui.closeModal?.();
    const [px, pz] = v.player;
    g.player.teleport(px, g.world.collision.groundAt(px, pz) + 0.1, pz, 0);
    g.world.env.setTime(v.time);
    const cam = g.engine.camera, r = g.engine.renderer;
    if (!r.__orig) r.__orig = r.render.bind(r);
    r.render = (s, c) => {
      if (window.__view && c === cam) { cam.position.set(...window.__view.cam); cam.lookAt(...window.__view.look); cam.updateMatrixWorld(); }
      return r.__orig(s, c);
    };
    window.__view = v;
    document.querySelectorAll('#hud, .hud, #chat, .toast, .notify').forEach((e) => { e.style.visibility = 'hidden'; });
  }, v);
  await page.waitForTimeout(+(process.env.WAIT || 6000));
  await page.screenshot({ path: `${outDir}/${v.name}.png`, timeout: 180000 });
  console.log('saved', v.name);
}
await browser.close();
