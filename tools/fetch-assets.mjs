// Downloads the free (CC0 / CC-BY) third-party assets into public/assets/.
// Each entry lists the original source first; if that host is unreachable (some networks
// block polyhaven.com / ambientcg.com) the script falls back to a public mirror of the SAME
// file on GitHub. Every entry is also listed in CREDITS.md.
// Usage: node tools/fetch-assets.mjs [--force]
import fs from 'node:fs';
import path from 'node:path';

const PH = 'https://dl.polyhaven.org/file/ph-assets/HDRIs';
const THREE_EX = 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples';
const PMNDRS = 'https://raw.githubusercontent.com/pmndrs/assets/main/src';
const DREI = 'https://raw.githubusercontent.com/pmndrs/drei-assets/master';
const KHR = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models';

export const ASSETS = [
  // ---- sky (Stage 2)
  { dest: 'hdri/day_sky_1k.hdr', urls: [`${PMNDRS}/hdri/sky.hdr`], license: 'CC0', author: 'Poly Haven (via @pmndrs/assets)', what: 'Daytime partly-cloudy pure sky HDRI' },
  { dest: 'hdri/kiara_1_dawn_1k.hdr', urls: [`${PH}/hdr/1k/kiara_1_dawn_1k.hdr`, `${DREI}/hdri/kiara_1_dawn_1k.hdr`], license: 'CC0', author: 'Greg Zaal / Poly Haven (kiara_1_dawn)', what: 'Dawn/dusk twilight sky HDRI' },
  { dest: 'hdri/dikhololo_night_1k.hdr', urls: [`${PH}/hdr/1k/dikhololo_night_1k.hdr`, `${DREI}/hdri/dikhololo_night_1k.hdr`], license: 'CC0', author: 'Greg Zaal / Poly Haven (dikhololo_night)', what: 'Night sky HDRI with stars' },
];

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../public/assets');
const force = process.argv.includes('--force');

async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  let ok = 0, fail = 0;
  for (const a of ASSETS) {
    const out = path.join(root, a.dest);
    if (!force && fs.existsSync(out)) { ok++; continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let done = false;
    for (const u of a.urls) {
      try { fs.writeFileSync(out, await get(u)); console.log('✓', a.dest, '←', u); done = true; break; } catch (e) { console.log('  …', e.message); }
    }
    if (done) ok++; else { fail++; console.log('✗', a.dest, '(all sources failed)'); }
  }
  console.log(`${ok} ok, ${fail} failed`);
  if (fail) process.exitCode = 1;
}
