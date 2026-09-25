// Generates the game's tileable PBR texture sets procedurally and writes them as KTX2
// (Basis Universal: ETC1S for colour, UASTC+zstd for normal maps) to public/assets/textures/.
// These stand in for ambientCG / Poly Haven texture packs (blocked on some networks);
// everything here is original, generated from noise.
// Usage: node tools/gen-textures.mjs [names...] [--preview]  (PNG previews → shots/textures/)
import fs from 'node:fs';
import path from 'node:path';
import { encodeToKTX2 } from 'ktx2-encoder';
import { Img, normalFromHeight, toRGBA8, writePNG } from './texgen/image.mjs';
import { vnoise, fbm, ridged, worley, hash2, smooth, clamp01, lerp, mix3, hex, rng } from './texgen/noise.mjs';

const OUT = path.resolve('public/assets/textures');
const PREVIEW = path.resolve('shots/textures');
const args = process.argv.slice(2);
const preview = args.includes('--preview');
const only = args.filter((a) => !a.startsWith('--'));

const tone = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ---------------------------------------------------------------- ground materials
const MATERIALS = {
  grass(S) {
    const alb = new Img(S, S, 3), h = new Img(S, S, 1), r = new Img(S, S, 1, 0.9);
    const G1 = hex('#3a5a1f'), G2 = hex('#5a7f2b'), DRY = hex('#8d8a45'), SOIL = hex('#3b2e20');
    alb.fill((u, v) => {
      const p = fbm(u, v, 4, 5, 1), dry = smooth(0.58, 0.8, fbm(u, v, 3, 4, 9));
      let c = mix3(G1, G2, p);
      c = mix3(c, DRY, dry * 0.55);
      const soil = smooth(0.72, 0.85, fbm(u, v, 24, 3, 5));
      return mix3(c, SOIL, soil * 0.7);
    });
    h.fill((u, v) => fbm(u, v, 8, 4, 3) * 0.25);
    const R = rng(11);
    const n = (S * S) / 10;
    for (let i = 0; i < n; i++) {
      const x = R() * S, y = R() * S;
      const len = 5 + R() * 12, a = R() * Math.PI * 2;
      const base = [alb.get(Math.floor(x), Math.floor(y), 0), alb.get(Math.floor(x), Math.floor(y), 1), alb.get(Math.floor(x), Math.floor(y), 2)];
      const k = 0.72 + R() * 0.45;
      const col = [base[0] * k * (0.9 + R() * 0.15), base[1] * k, base[2] * k * (0.85 + R() * 0.2)];
      const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len;
      alb.stroke(x, y, x1, y1, 0.8, col, 0.85);
      h.stroke(x, y, x1, y1, 0.9, 0.35 + R() * 0.65, 1, 'max');
      if (R() < 0.3) r.stroke(x, y, x1, y1, 0.8, 0.7, 0.6);
    }
    return { alb, h, r, strength: 3.5 };
  },
  dirt(S) {
    const alb = new Img(S, S, 3), h = new Img(S, S, 1), r = new Img(S, S, 1);
    const A = hex('#553f2c'), B = hex('#7b5d41'), DAMP = hex('#3f2e21');
    alb.fill((u, v) => {
      let c = mix3(A, B, fbm(u, v, 6, 5, 2));
      c = mix3(c, DAMP, smooth(0.6, 0.8, fbm(u, v, 3, 4, 8)) * 0.6);
      const peb = worley(u, v, 48, 4);
      if (peb.f1 < 0.3) c = mix3(c, tone(hex('#8a7d6c'), 0.8 + peb.id * 0.5), smooth(0.3, 0.2, peb.f1) * 0.8);
      const st = worley(u, v, 12, 6);
      if (st.f1 < 0.2) c = mix3(c, tone(hex('#7c7266'), 0.8 + st.id * 0.4), smooth(0.2, 0.14, st.f1));
      const cr = worley(u, v, 9, 3);
      c = tone(c, 1 - 0.4 * smooth(0.035, 0.0, cr.f2 - cr.f1));
      return c.map((x) => x * (0.92 + hash2(Math.floor(u * S), Math.floor(v * S), 1) * 0.16));
    });
    h.fill((u, v) => {
      const peb = worley(u, v, 48, 4), st = worley(u, v, 12, 6), cr = worley(u, v, 9, 3);
      return fbm(u, v, 8, 5, 3) * 0.3 + Math.sqrt(clamp01((0.3 - peb.f1) / 0.3)) * 0.35 + Math.sqrt(clamp01((0.2 - st.f1) / 0.2)) * 0.6 - smooth(0.035, 0, cr.f2 - cr.f1) * 0.25;
    });
    r.fill((u, v) => { const st = worley(u, v, 12, 6); return st.f1 < 0.18 ? 0.72 : 0.94; });
    return { alb, h, r, strength: 4 };
  },
  sand(S) {
    const alb = new Img(S, S, 3), h = new Img(S, S, 1), r = new Img(S, S, 1);
    const A = hex('#d3bd92'), B = hex('#e3d3ae'), W = hex('#b9a47c');
    const rip = (u, v) => Math.sin(2 * Math.PI * (17 * u + 5 * v) + fbm(u, v, 3, 3, 4) * 6);
    h.fill((u, v) => rip(u, v) * 0.12 + fbm(u, v, 5, 5, 2) * 0.25 + hash2(Math.floor(u * S), Math.floor(v * S), 3) * 0.05);
    alb.fill((u, v, x, y) => {
      let c = mix3(A, B, fbm(u, v, 5, 4, 1));
      c = mix3(c, W, smooth(0.62, 0.8, fbm(u, v, 3, 3, 7)) * 0.5);
      const g = hash2(x, y, 9);
      if (g > 0.985) c = hex(g > 0.995 ? '#f4efe4' : '#6f6556');
      return tone(c, 0.94 + rip(u, v) * 0.03 + hash2(x, y, 2) * 0.08);
    });
    r.fill((u, v, x, y) => 0.88 + hash2(x, y, 5) * 0.08);
    return { alb, h, r, strength: 3 };
  },
  rock(S) {
    const alb = new Img(S, S, 3), h = new Img(S, S, 1), r = new Img(S, S, 1);
    const A = hex('#6c675f'), B = hex('#9a948a'), BR = hex('#7d6a55'), LI = hex('#6f7c4c');
    const hf = (u, v) => {
      const rd = ridged(u, v, 3, 6, 1);
      const strata = Math.sin(2 * Math.PI * (7 * v + fbm(u, v, 2, 3, 5) * 1.3)) * 0.5 + 0.5;
      const cr = worley(u, v, 6, 2);
      return rd * 0.8 + strata * 0.12 - smooth(0.05, 0.0, cr.f2 - cr.f1) * 0.45;
    };
    h.fill(hf);
    alb.fill((u, v, x, y) => {
      const hv = hf(u, v);
      let c = mix3(A, B, clamp01(hv * 1.2));
      c = mix3(c, BR, smooth(0.5, 0.75, fbm(u, v, 4, 4, 9)) * 0.5);
      c = mix3(c, LI, smooth(0.7, 0.82, fbm(u, v, 8, 4, 12)) * 0.55);
      return tone(c, 0.9 + hash2(x, y, 4) * 0.14);
    });
    r.fill((u, v) => 0.72 + fbm(u, v, 8, 3, 3) * 0.2);
    return { alb, h, r, strength: 7 };
  },
  snow(S) {
    const alb = new Img(S, S, 3), h = new Img(S, S, 1), r = new Img(S, S, 1);
    h.fill((u, v) => fbm(u, v, 4, 6, 1) * 0.6 + fbm(u, v, 24, 3, 2) * 0.12);
    alb.fill((u, v) => mix3(hex('#c3d0df'), hex('#f3f6fa'), smooth(0.25, 0.6, h.get(Math.floor(u * S), Math.floor(v * S)))));
    r.fill((u, v, x, y) => (hash2(x, y, 8) > 0.992 ? 0.12 : 0.45 + fbm(u, v, 12, 3, 4) * 0.3));
    return { alb, h, r, strength: 2.5 };
  },
  asphalt(S) {
    const alb = new Img(S, S, 3), h = new Img(S, S, 1), r = new Img(S, S, 1, 0.88);
    const A = hex('#2f3032'), B = hex('#3b3c3e');
    alb.fill((u, v) => {
      let c = mix3(A, B, fbm(u, v, 5, 5, 1));
      c = tone(c, 1 - 0.25 * smooth(0.62, 0.8, fbm(u, v, 3, 4, 6))); // oil / patches
      c = tone(c, 1 + 0.18 * smooth(0.6, 0.8, fbm(u, v, 2, 3, 13))); // sun-bleached wear
      return c;
    });
    h.fill((u, v) => fbm(u, v, 16, 3, 2) * 0.15);
    const R = rng(5);
    for (let i = 0; i < (S * S) / 5; i++) {
      const x = R() * S, y = R() * S, rad = 0.5 + R() * 1.4, light = R() < 0.65;
      const g = light ? 0.3 + R() * 0.35 : 0.08 + R() * 0.08;
      alb.stamp(x, y, rad, rad * (0.6 + R() * 0.5), R() * 3, [g, g * 0.99, g * 0.97], 0.9, 0.7);
      h.stamp(x, y, rad, rad, 0, 0.3 + R() * 0.3, 1, 0.5, 'max');
      if (light) r.stamp(x, y, rad, rad, 0, 0.62, 0.8, 0.5);
    }
    // hairline cracks
    alb.fill((u, v, x, y) => { const cr = worley(u, v, 4, 7); const k = smooth(0.012, 0, cr.f2 - cr.f1) * smooth(0.55, 0.7, fbm(u, v, 3, 3, 21)); return tone([alb.get(x, y, 0), alb.get(x, y, 1), alb.get(x, y, 2)], 1 - 0.55 * k); });
    return { alb, h, r, strength: 3 };
  },
  pavement(S) {
    const alb = new Img(S, S, 3), h = new Img(S, S, 1), r = new Img(S, S, 1);
    const N = 4, gw = 1.6 / S * N; // slabs per tile, groove width in slab units
    const slab = (u, v) => {
      const su = u * N, sv = v * N, fu = su - Math.floor(su), fv = sv - Math.floor(sv);
      const edge = Math.min(fu, 1 - fu, fv, 1 - fv);
      return { id: hash2(Math.floor(su), Math.floor(sv), 3), edge };
    };
    alb.fill((u, v, x, y) => {
      const s = slab(u, v);
      let c = mix3(hex('#9f9b93'), hex('#bdb8ae'), s.id);
      c = tone(c, 0.92 + fbm(u, v, 16, 3, 2) * 0.12 + hash2(x, y, 1) * 0.06);
      c = mix3(c, hex('#5d574d'), smooth(gw * 1.8, gw * 0.6, s.edge) * 0.8);
      c = mix3(c, hex('#6f6a5f'), smooth(0.65, 0.85, fbm(u, v, 3, 4, 8)) * 0.35);
      return c;
    });
    h.fill((u, v) => { const s = slab(u, v); return 0.6 + s.id * 0.08 - smooth(gw * 1.5, 0, s.edge) * 0.6 + fbm(u, v, 32, 2, 5) * 0.04; });
    r.fill((u, v) => 0.82 + fbm(u, v, 8, 3, 4) * 0.12);
    return { alb, h, r, strength: 4 };
  },
  concrete(S) {
    const alb = new Img(S, S, 3), h = new Img(S, S, 1), r = new Img(S, S, 1);
    alb.fill((u, v, x, y) => {
      let c = mix3(hex('#9c9993'), hex('#b8b5ae'), fbm(u, v, 4, 5, 1));
      c = mix3(c, hex('#7e7a72'), smooth(0.66, 0.85, fbm(u, v, 3, 4, 7)) * 0.4);
      if (hash2(x, y, 3) > 0.994) c = tone(c, 0.55);
      return tone(c, 0.95 + hash2(x, y, 5) * 0.08);
    });
    h.fill((u, v, x, y) => fbm(u, v, 12, 4, 2) * 0.2 - (hash2(x, y, 3) > 0.994 ? 0.4 : 0));
    r.fill((u, v) => 0.86 + fbm(u, v, 6, 3, 9) * 0.1);
    return { alb, h, r, strength: 3 };
  },
  bark(S) {
    const alb = new Img(S, S, 3), h = new Img(S, S, 1), r = new Img(S, S, 1, 0.95);
    const hf = (u, v) => {
      const warp = fbm(u, v, 3, 3, 2) * 0.9 + fbm(u, v, 12, 2, 4) * 0.2;
      const ridge = Math.abs(Math.sin(Math.PI * (9 * u + warp)));
      const plates = vnoise(u, v, 24, 7) * 0.3;
      return Math.pow(ridge, 0.6) * 0.8 + plates;
    };
    h.fill(hf);
    alb.fill((u, v, x, y) => {
      const hv = hf(u, v);
      let c = mix3(hex('#2e241c'), hex('#6e5a48'), smooth(0.15, 0.85, hv));
      c = mix3(c, hex('#7a7a6a'), smooth(0.7, 0.85, fbm(u, v, 6, 3, 11)) * 0.35); // grey weathering
      return tone(c, 0.92 + hash2(x, y, 6) * 0.14);
    });
    return { alb, h, r, strength: 6 };
  },
};

// ---------------------------------------------------------------- foliage atlas (RGBA colour+alpha, normal)
function foliageAtlas(S = 1024) {
  const col = new Img(S, S, 3), a = new Img(S, S, 1), h = new Img(S, S, 1);
  const leaf = (cx, cy, len, wid, ang, c, R) => {
    const steps = Math.ceil(len);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, w = wid * Math.sin(Math.PI * Math.min(1, t * 1.05)) + 0.3;
      const x = cx + Math.cos(ang) * (t - 0.5) * len, y = cy + Math.sin(ang) * (t - 0.5) * len;
      const shade = 0.85 + 0.3 * (1 - Math.abs(t - 0.45));
      col.stamp(x, y, w, w, 0, tone(c, shade), 1, 0.7);
      a.stamp(x, y, w, w, 0, 1, 1, 0.7, 'max');
      h.stamp(x, y, w, w, 0, 0.5 + 0.5 * Math.sin(Math.PI * t), 1, 0.3, 'max');
    }
    col.stroke(cx - Math.cos(ang) * len * 0.45, cy - Math.sin(ang) * len * 0.45, cx + Math.cos(ang) * len * 0.4, cy + Math.sin(ang) * len * 0.4, 0.5, tone(c, 0.6), 0.6);
    void R;
  };
  const cluster = (ox, oy, size, palette, leafLen, count, seed) => {
    const R = rng(seed), cx = ox + size / 2, cy = oy + size / 2, rad = size * 0.46;
    for (let i = 0; i < count; i++) {
      const rr = Math.sqrt(R()) * rad, th = R() * Math.PI * 2;
      const x = cx + Math.cos(th) * rr, y = cy + Math.sin(th) * rr * 0.92;
      const c = palette[Math.floor(R() * palette.length)];
      leaf(x, y, leafLen * (0.7 + R() * 0.6), leafLen * 0.22 * (0.8 + R() * 0.4), th + (R() - 0.5) * 1.2, tone(c, 0.85 + R() * 0.3), R);
    }
  };
  // background colour (bleeds into mips instead of black fringes)
  col.fill(() => hex('#44652c'));
  // [0,0] broadleaf cluster, [512,0] small-leaf cluster (bushes/hedges)
  cluster(0, 0, S / 2, [hex('#3e6a26'), hex('#4f7d2d'), hex('#5f8c34'), hex('#6d9638'), hex('#86a445')], 34, 700, 1);
  cluster(S / 2, 0, S / 2, [hex('#2f5a22'), hex('#3c6b28'), hex('#4b7a2e'), hex('#5a8a34')], 20, 1500, 2);
  // [0,512] pine branch
  {
    const R = rng(3), ox = 0, oy = S / 2, W = S / 2;
    for (let b = 0; b < 3; b++) {
      const y0 = oy + W * (0.3 + b * 0.2), x0 = ox + 12, x1 = ox + W - 20;
      col.stroke(x0, y0, x1, y0 + (R() - 0.5) * 20, 2.2, hex('#4a3526'), 1); a.stroke(x0, y0, x1, y0, 2.2, 1, 1, 'max');
      for (let i = 0; i < 520; i++) {
        const t = R(), x = lerp(x0, x1, t), y = y0 + (R() - 0.5) * 6;
        const len = (48 + R() * 40) * (1 - t * 0.55), side = R() < 0.5 ? -1 : 1, ang = side * (0.7 + R() * 0.5) - 0.25;
        const c = tone([hex('#24442a'), hex('#2e5332'), hex('#3a6338'), hex('#456f3f')][Math.floor(R() * 4)], 0.8 + R() * 0.35);
        const xe = x + Math.cos(ang) * len * 0.6, ye = y + Math.sin(ang) * len;
        col.stroke(x, y, xe, ye, 0.9, c, 1); a.stroke(x, y, xe, ye, 1.0, 1, 1, 'max'); h.stroke(x, y, xe, ye, 1, 0.8, 1, 'max');
      }
    }
  }
  // [512,512] top: palm frond; bottom-left: grass tuft; bottom-right: flowers
  {
    const R = rng(4), ox = S / 2, oy = S / 2, W = S / 2;
    const y0 = oy + W * 0.25;
    col.stroke(ox + 8, y0, ox + W - 8, y0 + 18, 2.5, hex('#6d6a3a'), 1); a.stroke(ox + 8, y0, ox + W - 8, y0 + 18, 2.5, 1, 1, 'max');
    for (let i = 0; i < 90; i++) {
      const t = i / 90, x = lerp(ox + 16, ox + W - 12, t), y = y0 + t * 18;
      for (const side of [-1, 1]) {
        const len = 110 * (1 - t * 0.7) * (0.85 + R() * 0.3), ang = side * (1.05 + R() * 0.15);
        const c = tone([hex('#4d7a2e'), hex('#5c8a35'), hex('#6b973b')][Math.floor(R() * 3)], 0.85 + R() * 0.3);
        const xe = x + Math.cos(ang) * len * 0.45, ye = y + Math.sin(ang) * len;
        if (ye < oy + 2 || ye > oy + W / 2 - 2) continue;
        col.stroke(x, y, xe, ye, 2.2, c, 1); a.stroke(x, y, xe, ye, 2.4, 1, 1, 'max'); h.stroke(x, y, xe, ye, 2, 0.8, 1, 'max');
      }
    }
    // grass tuft
    const gx = ox + W * 0.25, gy = oy + W - 6;
    for (let i = 0; i < 160; i++) {
      const bx = gx + (R() - 0.5) * 60, len = 90 + R() * 130, lean = (R() - 0.5) * 1.1;
      const c = tone([hex('#4c7a2b'), hex('#5f8d33'), hex('#7a9a45'), hex('#3f6a26')][Math.floor(R() * 4)], 0.85 + R() * 0.3);
      const steps = 10;
      let px = bx, py = gy;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps, nx = bx + lean * len * t * t, ny = gy - len * t, w = 2.2 * (1 - t) + 0.4;
        col.stroke(px, py, nx, ny, w, tone(c, 0.7 + t * 0.5), 1); a.stroke(px, py, nx, ny, w, 1, 1, 'max');
        px = nx; py = ny;
      }
    }
    // flowers: stems + blossoms
    const fx = ox + W * 0.75;
    const petals = [hex('#e53950'), hex('#f6c343'), hex('#f2f2f2'), hex('#a44bd6'), hex('#ff7f3f')];
    for (let i = 0; i < 26; i++) {
      const bx = fx + (R() - 0.5) * 100, top = gy - 60 - R() * 150;
      col.stroke(bx, gy, bx + (R() - 0.5) * 20, top, 1.4, hex('#3f6a26'), 1); a.stroke(bx, gy, bx, top, 1.4, 1, 1, 'max');
      const pc = petals[Math.floor(R() * petals.length)];
      for (let p = 0; p < 6; p++) { const th = (p / 6) * Math.PI * 2; col.stamp(bx + Math.cos(th) * 7, top + Math.sin(th) * 7, 6, 4, th, pc, 1, 0.6); a.stamp(bx + Math.cos(th) * 7, top + Math.sin(th) * 7, 6, 4, th, 1, 1, 0.6, 'max'); }
      col.stamp(bx, top, 4, 4, 0, hex('#f5d142'), 1, 0.6);
    }
  }
  const alpha = new Img(S, S, 1); alpha.d.set(a.d.map((x) => (x > 0.35 ? 1 : 0)));
  return { col, alpha, h };
}

// ---------------------------------------------------------------- street parts atlas (manhole, drain)
function streetParts(S = 512) {
  const W = S, H = S / 2;
  const alb = new Img(W, H, 3), h = new Img(W, H, 1), r = new Img(W, H, 1, 0.6);
  alb.fill((u, v, x, y) => {
    const lx = x < H ? x : x - H, ly = y, c = H / 2;
    const d = Math.hypot(lx - c, ly - c);
    if (x < H) { // manhole cover
      let col = hex('#3b3935');
      const ring = d > c * 0.86 && d < c * 0.95;
      const grid = (Math.abs(((lx + 3) % 18) - 9) < 2 || Math.abs(((ly + 3) % 18) - 9) < 2) && d < c * 0.8;
      if (ring || grid) col = hex('#55524c');
      if (d > c * 0.97) col = hex('#6f6c66');
      return tone(col, 0.85 + fbm(u, v, 8, 3, 2) * 0.3);
    }
    // drain grate: slits
    const slit = Math.abs(((lx - 20) % 26) - 13) < 7 && ly > 30 && ly < H - 30 && lx > 14 && lx < H - 14;
    return tone(slit ? hex('#0f0f0f') : hex('#44423d'), 0.85 + fbm(u, v, 8, 3, 3) * 0.3);
  });
  h.fill((u, v, x, y) => { const g = alb.get(x, y, 0); return g * 1.5; });
  return { alb, h, r, W, H };
}

/** 2x2 box-downsample of a normal map (renormalised). */
function halve(img, doIt = true) {
  if (!doIt) return img;
  const o = new Img(img.w / 2, img.h / 2, 3);
  for (let y = 0; y < o.h; y++) for (let x = 0; x < o.w; x++) {
    let v = [0, 0, 0];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) for (let c = 0; c < 3; c++) v[c] += img.get(x * 2 + dx, y * 2 + dy, c) * 2 - 1;
    const l = Math.hypot(...v) || 1;
    for (let c = 0; c < 3; c++) o.set(x, y, (v[c] / l) * 0.5 + 0.5, c);
  }
  return o;
}

// ---------------------------------------------------------------- encode
async function ktx2(rgba, w, h, { normal = false, srgb = true } = {}) {
  const imageDecoder = async () => ({ data: rgba, width: w, height: h });
  return encodeToKTX2(new Uint8Array(1), normal
    ? { isUASTC: true, needSupercompression: true, enableRDO: true, rdoQualityLevel: 2.0, generateMipmap: true, isNormalMap: true, isPerceptual: false, isSetKTX2SRGBTransferFunc: false, imageDecoder }
    : { isUASTC: false, qualityLevel: 200, generateMipmap: true, isPerceptual: srgb, isSetKTX2SRGBTransferFunc: srgb, imageDecoder });
}
async function save(name, rgba, w, h, opts) {
  const data = await ktx2(rgba, w, h, opts);
  fs.writeFileSync(path.join(OUT, name + '.ktx2'), data);
  if (preview) writePNG(path.join(PREVIEW, name + '.png'), rgba, w, h);
  console.log('  ', name + '.ktx2', (data.length / 1024).toFixed(0) + ' KB');
}

fs.mkdirSync(OUT, { recursive: true });
if (preview) fs.mkdirSync(PREVIEW, { recursive: true });
const want = (n) => !only.length || only.includes(n);
for (const [name, fn] of Object.entries(MATERIALS)) {
  if (!want(name)) continue;
  const S = name === 'bark' || name === 'concrete' ? 512 : 1024;
  const t0 = Date.now();
  const m = fn(S);
  // normals at half resolution (1024 → 512): high-frequency normal detail barely shows at
  // these tiling scales and UASTC normal maps are the largest files
  const n = halve(normalFromHeight(m.h, m.strength), S > 512);
  const NS = n.w;
  await save(`${name}_ar`, toRGBA8([{ img: m.alb, c: 0 }, { img: m.alb, c: 1 }, { img: m.alb, c: 2 }, { img: m.r, c: 0 }], S, S), S, S, {});
  await save(`${name}_n`, toRGBA8([{ img: n, c: 0 }, { img: n, c: 1 }, { img: n, c: 2 }, 1], NS, NS), NS, NS, { normal: true });
  console.log(name, 'done in', ((Date.now() - t0) / 1000).toFixed(1) + 's');
}
if (want('foliage')) {
  const f = foliageAtlas(1024);
  const n = normalFromHeight(f.h, 3);
  await save('foliage_ca', toRGBA8([{ img: f.col, c: 0 }, { img: f.col, c: 1 }, { img: f.col, c: 2 }, { img: f.alpha, c: 0 }], 1024, 1024), 1024, 1024, {});
  await save('foliage_n', toRGBA8([{ img: n, c: 0 }, { img: n, c: 1 }, { img: n, c: 2 }, 1], 1024, 1024), 1024, 1024, { normal: true });
}
if (want('street')) {
  const s = streetParts(512);
  const n = normalFromHeight(s.h, 3);
  await save('street_ar', toRGBA8([{ img: s.alb, c: 0 }, { img: s.alb, c: 1 }, { img: s.alb, c: 2 }, { img: s.r, c: 0 }], s.W, s.H), s.W, s.H, {});
  await save('street_n', toRGBA8([{ img: n, c: 0 }, { img: n, c: 1 }, { img: n, c: 2 }, 1], s.W, s.H), s.W, s.H, { normal: true });
}
