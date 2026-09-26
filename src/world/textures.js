import * as THREE from 'three';

// Procedural canvas textures for the city (no external image assets required).
const cache = new Map();
function canvasTex(key, w, h, draw, { repeat = true, srgb = true, aniso = 8 } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, t);
  return t;
}
let seed = 12345;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function noise(g, w, h, amount, alpha = 0.08) {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(rnd() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 3, 1 + rnd() * 3);
  }
}

// Facade: one tile = one bay (≈4m wide) x one floor (≈3.4m tall)
export const FACADE_STYLES = {
  glass: { wall: '#5a7089', frame: '#2c3440', win: ['#9fc4e8', '#7fa6cf', '#b5d2ee'], bay: 4, floor: 3.6, winW: 0.92, winH: 0.9 },
  office: { wall: '#b9b3a8', frame: '#6f6b64', win: ['#4f6a86', '#5b7896', '#3f5570'], bay: 4, floor: 3.6, winW: 0.62, winH: 0.58 },
  apartment: { wall: '#e3d7c3', frame: '#8c7f6b', win: ['#3c4f63', '#4a5f75', '#546c85'], bay: 4, floor: 3.2, winW: 0.45, winH: 0.5, balcony: true },
  brick: { wall: '#9a4a36', frame: '#e8e0d0', win: ['#2f3b48', '#3a4756'], bay: 3.5, floor: 3.2, winW: 0.42, winH: 0.52, bricks: true },
  rough: { wall: '#8d8373', frame: '#5b5347', win: ['#2b2f33', '#3a3f45', '#23272a'], bay: 3.5, floor: 3.1, winW: 0.42, winH: 0.5, grime: true },
  house: { wall: '#f0ebe0', frame: '#ffffff', win: ['#4b6076', '#56708a'], bay: 4.5, floor: 3.0, winW: 0.38, winH: 0.45, siding: true },
  villa: { wall: '#f6efe3', frame: '#c9b79c', win: ['#35536f', '#46657f'], bay: 5, floor: 3.2, winW: 0.55, winH: 0.62 },
  warehouse: { wall: '#8e979c', frame: '#6d7479', win: ['#3d4449'], bay: 6, floor: 5, winW: 0.3, winH: 0.18, corrugated: true, highWin: true },
  shop: { wall: '#d7c9b4', frame: '#4b3f35', win: ['#8fb3cc', '#a7c5d9'], bay: 4, floor: 3.4, winW: 0.8, winH: 0.62 },
  cabin: { wall: '#8a5a36', frame: '#5a3a22', win: ['#3d4b56'], bay: 4, floor: 3, winW: 0.35, winH: 0.4, logs: true },
};

export function facadeTexture(style) {
  const s = FACADE_STYLES[style] || FACADE_STYLES.office;
  return canvasTex('facade_' + style, 128, 128, (g, w, h) => {
    g.fillStyle = s.wall; g.fillRect(0, 0, w, h);
    if (s.bricks) {
      g.fillStyle = 'rgba(0,0,0,0.12)';
      for (let y = 0; y < h; y += 6) { g.fillRect(0, y, w, 1); for (let x = (y / 6) % 2 ? 0 : 7; x < w; x += 14) g.fillRect(x, y, 1, 6); }
    }
    if (s.siding) { g.fillStyle = 'rgba(0,0,0,0.07)'; for (let y = 0; y < h; y += 5) g.fillRect(0, y, w, 1); }
    if (s.corrugated) { for (let x = 0; x < w; x += 4) { g.fillStyle = x % 8 ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'; g.fillRect(x, 0, 2, h); } }
    if (s.logs) { for (let y = 0; y < h; y += 10) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, y + 3, w, 3); } }
    noise(g, w, h, 500, 0.05);
    const ww = w * s.winW, wh = h * s.winH;
    const x0 = (w - ww) / 2, y0 = s.highWin ? h * 0.12 : (h - wh) / 2 - h * 0.04;
    g.fillStyle = s.frame; g.fillRect(x0 - 3, y0 - 3, ww + 6, wh + 6);
    const grd = g.createLinearGradient(x0, y0, x0 + ww, y0 + wh);
    grd.addColorStop(0, s.win[0]); grd.addColorStop(0.55, s.win[1] || s.win[0]); grd.addColorStop(1, s.win[2] || s.win[0]);
    g.fillStyle = grd; g.fillRect(x0, y0, ww, wh);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.moveTo(x0, y0 + wh); g.lineTo(x0 + ww * 0.35, y0); g.lineTo(x0 + ww * 0.5, y0); g.lineTo(x0 + ww * 0.15, y0 + wh); g.fill();
    if (style !== 'glass') { g.fillStyle = s.frame; g.fillRect(x0 + ww / 2 - 1, y0, 2, wh); }
    if (s.balcony) { g.fillStyle = 'rgba(60,60,60,0.8)'; g.fillRect(x0 - 8, y0 + wh + 2, ww + 16, 3); for (let x = x0 - 8; x < x0 + ww + 8; x += 5) g.fillRect(x, y0 + wh * 0.72, 1, wh * 0.3); }
    if (s.grime) { g.fillStyle = 'rgba(40,30,20,0.18)'; for (let i = 0; i < 6; i++) g.fillRect(rnd() * w, y0 + wh, 4 + rnd() * 6, 20 + rnd() * 30); }
    // floor slab line
    g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, h - 3, w, 3);
  });
}

// Emissive window mask for night lighting (same layout as facadeTexture)
export function facadeEmissive(style) {
  const s = FACADE_STYLES[style] || FACADE_STYLES.office;
  return canvasTex('facadeE_' + style, 64, 64, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const ww = w * s.winW, wh = h * s.winH;
    const x0 = (w - ww) / 2, y0 = s.highWin ? h * 0.12 : (h - wh) / 2 - h * 0.04;
    g.fillStyle = '#ffd89a'; g.fillRect(x0, y0, ww, wh);
  });
}

// Random-lit-windows emissive mask: a grid of `cols`x`rows` window cells (each one whole
// bay/floor, same window geometry as facadeTexture), each independently on or off. Applied with
// emissiveMap.repeat = (1/cols, 1/rows) so several bays share one supertile instead of every
// window lighting identically — avoids the "uniform glowing grid" look at night.
export function facadeEmissiveRandom(style, cols = 4, rows = 4) {
  const s = FACADE_STYLES[style] || FACADE_STYLES.office;
  const cw = 32, ch = 32; // px per cell
  return canvasTex(`facadeER_${style}_${cols}x${rows}`, cw * cols, ch * rows, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const ww = cw * s.winW, wh = ch * s.winH;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (rnd() > 0.4) continue; // ~40% of windows lit
      const x0 = c * cw + (cw - ww) / 2, y0 = r * ch + (s.highWin ? ch * 0.12 : (ch - wh) / 2 - ch * 0.04);
      g.fillStyle = '#ffd89a'; g.fillRect(x0, y0, ww, wh);
    }
  }, { srgb: false });
}

export function storefrontTexture() {
  return canvasTex('storefront', 256, 128, (g, w, h) => {
    g.fillStyle = '#3b3530'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#9ec3d8'; g.fillRect(12, 30, w - 24, h - 40);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(12, 30, 40, h - 40);
    g.fillStyle = '#2a2521'; for (let x = 12; x < w - 12; x += 58) g.fillRect(x, 30, 4, h - 40);
  }, { repeat: true });
}

export function asphaltTexture() {
  return canvasTex('asphalt', 256, 256, (g, w, h) => {
    g.fillStyle = '#3a3c3f'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 5000, 0.07);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 12; i++) { g.beginPath(); g.arc(rnd() * w, rnd() * h, 6 + rnd() * 18, 0, 7); g.fill(); }
  });
}

// Road with markings: u across (0..1), v along (repeats every 12m)
export function roadTexture(kind) {
  return canvasTex('road_' + kind, 256, 512, (g, w, h) => {
    g.fillStyle = kind === 'mountain' ? '#46443f' : '#3b3d40'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 7000, 0.07);
    g.fillStyle = 'rgba(0,0,0,0.1)';
    for (let i = 0; i < 8; i++) { g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 10 + rnd() * 20, 20 + rnd() * 40, 0, 0, 7); g.fill(); }
    // tyre tracks
    g.fillStyle = 'rgba(0,0,0,0.1)';
    for (const x of [0.2, 0.33, 0.67, 0.8]) g.fillRect(w * x - 8, 0, 16, h);
    // edge lines
    g.fillStyle = '#e8e8e0';
    g.fillRect(6, 0, 5, h); g.fillRect(w - 11, 0, 5, h);
    if (kind === 'highway') {
      g.fillStyle = '#e8c547'; g.fillRect(w / 2 - 6, 0, 4, h); g.fillRect(w / 2 + 2, 0, 4, h);
      g.fillStyle = '#e8e8e0'; for (let y = 0; y < h; y += 128) { g.fillRect(w * 0.25 - 2, y, 4, 64); g.fillRect(w * 0.75 - 2, y, 4, 64); }
    } else if (kind === 'main') {
      g.fillStyle = '#e8c547'; g.fillRect(w / 2 - 6, 0, 4, h); g.fillRect(w / 2 + 2, 0, 4, h);
    } else {
      g.fillStyle = '#e8e8e0'; for (let y = 0; y < h; y += 128) g.fillRect(w / 2 - 2, y, 4, 64);
    }
  });
}

export function sidewalkTexture() {
  return canvasTex('sidewalk', 128, 128, (g, w, h) => {
    g.fillStyle = '#b5b0a6'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 1500, 0.06);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i <= 4; i++) { g.fillRect(0, i * 32, w, 1); g.fillRect(i * 32, 0, 1, h); }
  });
}

export function groundDetailTexture() {
  return canvasTex('grounddetail', 256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 6000; i++) { const v = 205 + Math.floor(rnd() * 50); g.fillStyle = `rgba(${v},${v},${v},0.55)`; g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2); }
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(150,150,150,0.07)'; g.beginPath(); g.arc(rnd() * w, rnd() * h, 10 + rnd() * 25, 0, 7); g.fill(); }
  });
}

export function grassTexture() {
  return canvasTex('grass', 256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      const v = 190 + Math.floor(rnd() * 65);
      g.fillStyle = `rgba(${v},${v},${v},0.5)`;
      g.fillRect(rnd() * w, rnd() * h, 1, 2 + rnd() * 3);
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(120,120,120,0.08)'; g.beginPath(); g.arc(rnd() * w, rnd() * h, 8 + rnd() * 20, 0, 7); g.fill(); }
  }, { srgb: true });
}

export function roofTexture(kind = 'tiles') {
  return canvasTex('roof_' + kind, 128, 128, (g, w, h) => {
    if (kind === 'tiles') {
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 10) for (let x = (y / 10) % 2 ? 0 : 8; x < w; x += 16) {
        g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x, y + 8, 16, 2); g.fillRect(x, y, 1, 10);
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 2, y + 1, 12, 2);
      }
    } else {
      g.fillStyle = '#8c8c88'; g.fillRect(0, 0, w, h); noise(g, w, h, 3000, 0.08);
      g.fillStyle = 'rgba(0,0,0,0.1)'; for (let i = 0; i < 8; i++) g.fillRect(rnd() * w, rnd() * h, 20, 20);
    }
  });
}

export function pitchTexture() {
  return canvasTex('pitch', 1024, 660, (g, w, h) => {
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#3f9b43' : '#46a84a'; g.fillRect((i * w) / 12, 0, w / 12 + 1, h); }
    g.strokeStyle = '#f4f4f4'; g.lineWidth = 5;
    const m = 20;
    g.strokeRect(m, m, w - 2 * m, h - 2 * m);
    g.beginPath(); g.moveTo(w / 2, m); g.lineTo(w / 2, h - m); g.stroke();
    g.beginPath(); g.arc(w / 2, h / 2, 90, 0, 7); g.stroke();
    for (const s of [0, 1]) {
      const x = s ? w - m : m, d = s ? -1 : 1;
      g.strokeRect(s ? x - 160 : x, h / 2 - 200, 160, 400);
      g.strokeRect(s ? x - 55 : x, h / 2 - 90, 55, 180);
      g.beginPath(); g.arc(x + d * 110, h / 2, 90, s ? Math.PI * 0.62 : -Math.PI * 0.38, s ? Math.PI * 1.38 : Math.PI * 0.38); g.stroke();
    }
    g.fillStyle = '#f4f4f4'; g.beginPath(); g.arc(w / 2, h / 2, 6, 0, 7); g.fill();
  }, { repeat: false });
}

export function courtTexture() {
  return canvasTex('court', 1024, 560, (g, w, h) => {
    g.fillStyle = '#c9803f'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { g.fillStyle = x % 32 ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)'; g.fillRect(x, 0, 16, h); }
    g.fillStyle = '#2d5fa8';
    g.fillRect(0, h / 2 - 90, 190, 180); g.fillRect(w - 190, h / 2 - 90, 190, 180);
    g.strokeStyle = '#ffffff'; g.lineWidth = 5;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.beginPath(); g.moveTo(w / 2, 6); g.lineTo(w / 2, h - 6); g.stroke();
    g.beginPath(); g.arc(w / 2, h / 2, 65, 0, 7); g.stroke();
    for (const s of [0, 1]) {
      const x = s ? w - 6 : 6;
      g.beginPath(); g.arc(x + (s ? -50 : 50), h / 2, 250, s ? Math.PI / 2 : -Math.PI / 2, s ? Math.PI * 1.5 : Math.PI / 2, false); g.stroke();
      g.beginPath(); g.arc(x + (s ? -190 : 190), h / 2, 65, 0, 7); g.stroke();
    }
  }, { repeat: false });
}

export function graffitiTexture(v) {
  return canvasTex('graffiti' + v, 256, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cols = ['#ff2d95', '#00e5ff', '#ffe600', '#7cff00', '#ff6a00', '#b388ff'];
    const words = ['APPLERUN', 'EASTSIDE', 'RIZE', 'AJAN', 'LUCKY', 'XHAN', 'GG', 'LOL', 'KINGS'];
    g.lineJoin = 'round';
    g.font = 'bold 58px Arial, sans-serif';
    g.textAlign = 'center';
    const word = words[v % words.length];
    g.save(); g.translate(w / 2, h / 2 + 20); g.rotate(-0.08 + (v % 3) * 0.06);
    g.lineWidth = 12; g.strokeStyle = '#111'; g.strokeText(word, 0, 0);
    g.fillStyle = cols[v % cols.length]; g.fillText(word, 0, 0);
    g.lineWidth = 3; g.strokeStyle = cols[(v + 2) % cols.length]; g.strokeText(word, 0, 0);
    g.restore();
  }, { repeat: false });
}

// v1.2 Stage 14: a spray-painted flag/tag for the fictional "Talon Crew" gang — invented colours
// and a claw-mark emblem, no real-world flag or nationality involved (see STATUS.md).
export function gangFlagTexture() {
  return canvasTex('gangFlag', 256, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h / 2); g.rotate(-0.05);
    // diagonal two-tone flag shape, spray-can edges
    g.fillStyle = '#141414'; g.fillRect(-110, -55, 220, 110);
    g.fillStyle = '#b3121f';
    g.beginPath(); g.moveTo(-110, 55); g.lineTo(60, -55); g.lineTo(110, -55); g.lineTo(110, 55); g.closePath(); g.fill();
    // three claw-slash marks (the crew's mark) in pale gold
    g.strokeStyle = '#e8c15a'; g.lineWidth = 9; g.lineCap = 'round';
    for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(-30 + i * 22, -40); g.lineTo(10 + i * 22, 40); g.stroke(); }
    g.restore();
    // spray drips
    g.fillStyle = 'rgba(20,20,20,0.5)';
    for (let i = 0; i < 8; i++) { const x = 20 + Math.random() * (w - 40); g.fillRect(x, h * 0.7, 3, 8 + Math.random() * 20); }
  }, { repeat: false });
}

// v1.2 Stage 15: billboard/roadside advertisements for fictional in-game brands (procedurally
// drawn — no real photos were available/usable, see STATUS.md). Each is a distinct little poster
// design (logo mark + tagline), not just a word like the generic sign/graffiti textures.
const AD_BRANDS = [
  { bg: '#c62828', fg: '#ffffff', name: 'SPARKLE COLA', tag: 'Taste the Fizz', mark: 'bubbles' },
  { bg: '#1565c0', fg: '#ffffff', name: 'ZOOMOTORS', tag: 'Drive Bold', mark: 'chevron' },
  { bg: '#6a1b9a', fg: '#ffe4fb', name: 'THREADCO', tag: 'Fresh Fits', mark: 'hanger' },
  { bg: '#00838f', fg: '#faff70', name: 'PIXEL ARCADE', tag: 'Game On', mark: 'joystick' },
];
export function adTexture(variant) {
  const b = AD_BRANDS[variant % AD_BRANDS.length];
  return canvasTex('ad' + variant, 512, 288, (g, w, h) => {
    g.fillStyle = b.bg; g.fillRect(0, 0, w, h);
    // a soft diagonal band for visual interest, plus a border frame
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.moveTo(0, h * 0.55); g.lineTo(w, h * 0.15); g.lineTo(w, h * 0.4); g.lineTo(0, h * 0.8); g.closePath(); g.fill();
    g.strokeStyle = b.fg; g.lineWidth = 6; g.strokeRect(10, 10, w - 20, h - 20);
    // a simple procedural mark per brand
    g.fillStyle = b.fg; g.strokeStyle = b.fg;
    const mx = 70, my = h / 2 - 10;
    if (b.mark === 'bubbles') { for (const [dx, dy, r] of [[-20, -20, 16], [15, -35, 10], [0, 15, 22], [30, 5, 8]]) { g.beginPath(); g.arc(mx + dx, my + dy, r, 0, 7); g.fill(); } }
    else if (b.mark === 'chevron') { g.lineWidth = 14; for (const off of [-22, 0, 22]) { g.beginPath(); g.moveTo(mx - 26, my - 30 + off); g.lineTo(mx + 10, my + off); g.lineTo(mx - 26, my + 30 + off); g.stroke(); } }
    else if (b.mark === 'hanger') { g.lineWidth = 8; g.beginPath(); g.arc(mx, my - 28, 6, 0, 7); g.moveTo(mx, my - 22); g.lineTo(mx, my - 12); g.lineTo(mx - 34, my + 18); g.lineTo(mx + 34, my + 18); g.lineTo(mx, my - 12); g.stroke(); }
    else { g.fillRect(mx - 6, my - 30, 12, 45); g.beginPath(); g.arc(mx, my + 15, 26, 0, 7); g.fill(); g.fillStyle = b.bg; g.beginPath(); g.arc(mx - 9, my + 10, 5, 0, 7); g.arc(mx + 9, my + 10, 5, 0, 7); g.fill(); }
    g.fillStyle = b.fg; g.textAlign = 'left';
    g.font = 'bold 46px Arial, sans-serif'; g.fillText(b.name, 130, h / 2 - 8);
    g.font = 'italic 28px Arial, sans-serif'; g.fillText(b.tag, 130, h / 2 + 36);
  }, { repeat: false, srgb: true });
}

export function signTexture(text, bg = '#1d2b3a', fg = '#ffffff') {
  return canvasTex('sign_' + text + bg, 512, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = fg; g.font = 'bold 64px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
  }, { repeat: false });
}

export function sandTexture() {
  return canvasTex('sand', 128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 4000, 0.12);
  });
}

export function parkingTexture() {
  return canvasTex('parking', 256, 256, (g, w, h) => {
    g.fillStyle = '#44464a'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 5000, 0.06);
    g.fillStyle = '#e0e0e0';
    for (let x = 0; x <= w; x += 32) { g.fillRect(x, 0, 3, 90); g.fillRect(x, h - 90, 3, 90); }
  });
}
