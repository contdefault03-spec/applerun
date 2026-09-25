// Reports draw calls / triangles / programs at a few fixed views. Usage: node tools/perf.mjs [url]
import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:5173/?quality=high';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(() => localStorage.setItem('bayview.settings', JSON.stringify({ 'player.name': 'Tester' })));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.mode === 'menu', null, { timeout: 240000 });
const views = { street: [[0, 0], [8, 6, 22], [0, 3, -20]], downtownUp: [[-150, 0], [-150, 40, 120], [-150, 0, -100]], aerial: [[0, 0], [260, 520, 720], [0, 0, 0]], mountain: [[480, -450], [760, 160, -120], [440, 60, -460]] };
const res = await page.evaluate(async (views) => {
  const g = window.game; await g.quickPlay();
  const r = g.engine.renderer, cam = g.engine.camera, out = {};
  const orig = r.render.bind(r);
  let view = null, info = null;
  r.render = (s, c) => { if (view && c === cam) { cam.position.set(...view[1]); cam.lookAt(...view[2]); cam.updateMatrixWorld(); } const t0 = performance.now(); const ret = orig(s, c); if (c === cam) info = { calls: r.info.render.calls, tris: r.info.render.triangles, ms: +(performance.now() - t0).toFixed(1) }; return ret; };
  for (const [name, v] of Object.entries(views)) {
    g.player.teleport(v[0][0], g.world.collision.groundAt(v[0][0], v[0][1]) + 0.1, v[0][1], 0);
    view = v; await new Promise((res) => setTimeout(res, 5000));
    out[name] = { ...info, programs: r.info.programs.length, geometries: r.info.memory.geometries, textures: r.info.memory.textures };
  }
  return out;
}, views);
console.table(res);
await browser.close();
