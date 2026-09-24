// Usage: node tools/shot.mjs <url> <out.png> [waitMs] [evalJs]
import { chromium } from 'playwright-core';
const [url, out, wait = '4000', js] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: +(process.env.VW||1280), height: +(process.env.VH||720) } });
page.on('console', m => { const t = m.text(); if (!t.includes('GPU stall')) console.log('[console]', m.type(), t.slice(0, 400)); });
page.on('pageerror', e => console.log('[pageerror]', e.message, e.stack?.slice(0, 600)));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+wait);
if (js) { const r = await page.evaluate(js); if (r !== undefined) console.log('[eval]', JSON.stringify(r).slice(0, 3000)); await page.waitForTimeout(1500); }
await page.screenshot({ path: out });
await browser.close();
