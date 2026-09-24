// Usage: node tools/play.mjs <out.png> [js-to-run-after-spawn] [waitMs]
import { chromium } from 'playwright-core';
const [out, js = '', wait = '1500', url = 'http://localhost:5173/?quality=low'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +(process.env.VW || 960), height: +(process.env.VH || 540) } });
page.on('console', (m) => { const t = m.text(); if (!/GPU stall|CERT|deprecated|vite|ERR_CONNECTION_REFUSED/.test(t)) console.log('[console]', m.type(), t.slice(0, 500)); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.slice(0, 800)));
await page.addInitScript(() => { localStorage.setItem('bayview.settings', JSON.stringify({ 'player.name': 'Tester', ...(JSON.parse(localStorage.getItem('bayview.settings') || '{}')) })); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.game && window.game.mode === 'menu', null, { timeout: 120000 });
const r = await page.evaluate(async (code) => {
  const g = window.game;
  await g.quickPlay();
  const f = new Function('g', 'return (async()=>{' + code + '})()');
  return await f(g);
}, js);
if (r !== undefined) console.log('[result]', JSON.stringify(r).slice(0, 3000));
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, timeout: 60000 });
await browser.close();
