// Alfredo Applerun layout — built from the reference map image (public/assets/maps/reference.jpg).
// All authoring coordinates are in *map pixels* of the left (top-down) panel (≈1000 x 1090 px).
// World space: x = (px - 500) * S, z = (py - 545) * S  (north = -Z, west/ocean = -X).
import { mulberry32, clamp } from '../rng.js';
import { catmullRom, segIntersect, closestOnPoly, pointInPoly, circleVsObb } from './geom.js';

export const S = 1.2; // metres per map pixel
export const MAP_W = 1000, MAP_H = 1090;
export const WORLD = { minX: -500 * S, maxX: 500 * S, minZ: -545 * S, maxZ: 545 * S };
export const WATER_LEVEL = -0.45;
export const wx = (px) => (px - 500) * S;
export const wz = (py) => (py - 545) * S;
export const W = (p) => [wx(p[0]), wz(p[1])];
export const toPx = (x, z) => [x / S + 500, z / S + 545];

export const ROAD_TYPES = {
  highway: { width: 17, lanes: 2, speed: 24, lamp: 40 },
  main: { width: 13, lanes: 1, speed: 15, lamp: 32 },
  street: { width: 10, lanes: 1, speed: 11, lamp: 38 },
  mountain: { width: 8, lanes: 1, speed: 9, lamp: 0 },
};

// ---------------------------------------------------------------- shoreline / water
const SHORE = [[0, 40], [60, 70], [120, 105], [180, 138], [250, 168], [320, 188], [400, 200], [480, 207], [560, 212], [640, 213], [720, 210], [800, 196], [850, 178], [900, 162], [960, 150], [1090, 132]];
export function shoreXpx(py) {
  for (let i = 0; i < SHORE.length - 1; i++) {
    const [y0, x0] = SHORE[i], [y1, x1] = SHORE[i + 1];
    if (py <= y1) return x0 + ((x1 - x0) * (py - y0)) / (y1 - y0);
  }
  return SHORE[SHORE.length - 1][1];
}
export const PORT_BASIN = [[790, 790], [1000, 778], [1000, 955], [930, 952], [850, 942], [800, 915], [790, 860]];
export const MARINA_BASIN = [[100, 615], [225, 612], [228, 818], [100, 818]];

export function isWaterPx(px, py) {
  if (px < shoreXpx(py)) return true;
  if (pointInPoly(px, py, PORT_BASIN)) return true;
  return false;
}

// ---------------------------------------------------------------- districts
export const DISTRICTS = [
  { id: 'downtown', name: 'Downtown', poly: [[262, 398], [485, 398], [485, 690], [262, 690]], style: 'commercial', crime: 0.25 },
  { id: 'midtown', name: 'Midtown South', poly: [[230, 690], [485, 690], [485, 792], [230, 792]], style: 'commercial', crime: 0.2 },
  { id: 'beachfront', name: 'Coastal Beach District', poly: [[150, 150], [258, 150], [258, 1000], [150, 1000]], style: 'beach', crime: 0.1 },
  { id: 'hillcrest', name: 'Hillcrest (Suburbs)', poly: [[268, 212], [445, 150], [480, 230], [512, 312], [488, 394], [268, 394]], style: 'suburb', crime: 0.05 },
  { id: 'northshore', name: 'North Shore Hills', poly: [[60, 0], [430, 0], [440, 140], [265, 205], [150, 160]], style: 'rural', crime: 0.03 },
  { id: 'eastside', name: 'Eastside', poly: [[660, 462], [995, 462], [995, 648], [700, 668], [650, 600]], style: 'rough', crime: 0.8 },
  { id: 'redbrick', name: 'Redbrick (Suburbs)', poly: [[495, 558], [632, 520], [648, 640], [568, 722], [495, 772]], style: 'brick', crime: 0.35 },
  { id: 'industrial', name: 'Industrial District & Port', poly: [[655, 688], [995, 655], [995, 780], [800, 785], [790, 905], [660, 830]], style: 'industrial', crime: 0.45 },
  { id: 'sports', name: 'Sports & Entertainment District', poly: [[190, 792], [485, 792], [485, 1090], [190, 1090]], style: 'sports', crime: 0.1 },
  { id: 'outskirts', name: 'Outskirts', poly: [[495, 812], [645, 760], [790, 790], [800, 950], [995, 962], [995, 1090], [495, 1090]], style: 'rural', crime: 0.1 },
  { id: 'mountain', name: 'North Mountain Region', poly: [[445, 0], [1000, 0], [1000, 462], [655, 462], [600, 400], [520, 300], [470, 200]], style: 'mountain', crime: 0.05 },
];

export function districtAtPx(px, py) {
  // beachfront only west of coastal road
  for (const d of DISTRICTS) if (pointInPoly(px, py, d.poly)) return d;
  return DISTRICTS[DISTRICTS.length - 1];
}
export function districtAt(x, z) { const [px, py] = toPx(x, z); return districtAtPx(px, py); }

// ---------------------------------------------------------------- terrain (raw, before flattening)
import { fbm } from '../rng.js';
export function rawHeightPx(px, py) {
  // Coast
  const d = px - shoreXpx(py);
  let h = 0;
  if (d < 40) {
    if (d < 0) h = Math.max(-7, -1.3 + d * 0.12);
    else h = -1.3 + (d / 40) * 1.3;
  }
  // Port basin + marina basin depth
  if (pointInPoly(px, py, PORT_BASIN)) h = Math.min(h, -5);
  // North mountain
  const mx = (px - 800) / 250, my = (py - 205) / 265;
  const md = Math.sqrt(mx * mx + my * my);
  if (md < 1.25) {
    const mask = clamp(1.25 - md, 0, 1);
    const m = mask * mask * (3 - 2 * mask);
    const peak = Math.exp(-(((px - 785) / 95) ** 2 + ((py - 165) / 110) ** 2));
    const ridge = fbm(px / 70, py / 70, 4, 7);
    const hh = m * (22 + ridge * 70) + peak * 105;
    h = Math.max(h, hh);
  }
  // Small north-west coastal hills
  const nx = (px - 150) / 110, ny = (py - 60) / 80;
  const nd = Math.sqrt(nx * nx + ny * ny);
  if (nd < 1 && d > 30) {
    const m = (1 - nd) * (1 - nd);
    h = Math.max(h, m * (8 + fbm(px / 40, py / 40, 3, 3) * 14));
  }
  // Gentle outskirts undulation
  if (py > 830 && px > 500 && !pointInPoly(px, py, PORT_BASIN)) {
    h += (fbm(px / 60, py / 60, 3, 11) - 0.5) * 3;
  }
  return h;
}

// ---------------------------------------------------------------- road authoring (px)
function circlePts(cx, cy, r, n = 12) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
}
function serpentine(x0, y0, x1, y1, turns, amp) {
  // zig-zag between two points for switchback mountain roads
  const pts = [[x0, y0]];
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
  const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
  for (let i = 0; i < turns; i++) {
    const t0 = (i + 0.25) / turns, t1 = (i + 0.75) / turns;
    const s = i % 2 ? -1 : 1;
    pts.push([x0 + dx * t0 + nx * amp * s, y0 + dy * t0 + ny * amp * s]);
    pts.push([x0 + dx * t1 + nx * amp * s, y0 + dy * t1 + ny * amp * s]);
  }
  pts.push([x1, y1]);
  return pts;
}

export const GRID_X = [258, 305, 350, 395, 440, 485];
export const GRID_Y = [398, 445, 492, 540, 588, 636, 684, 732, 780];

function authorRoads() {
  const R = [];
  const add = (type, pts, opts = {}) => R.push({ type, px: pts, closed: !!opts.closed, name: opts.name || '', smooth: opts.smooth !== false });
  // Highway: from the north, down the east side of downtown, looping to the south roundabout
  add('highway', [[438, -10], [446, 110], [470, 210], [515, 300], [575, 380], [625, 450], [645, 530], [648, 600], [625, 665], [575, 720], [520, 765], [488, 792]], { name: 'Applerun Freeway' });
  // East road to industrial district / port
  add('main', [[575, 720], [650, 712], [760, 684], [880, 664], [1005, 652]], { name: 'Harbor Road' });
  // North-east road past Eastside
  add('main', [[645, 530], [720, 498], [830, 512], [940, 548], [1005, 560]], { name: 'Ridge Road' });
  // Coastal boulevard
  add('main', [[262, 205], [258, 300], [258, 398], [258, 540], [258, 690], [258, 780], [228, 815], [205, 870], [203, 950], [222, 1020], [270, 1058], [360, 1064], [485, 1062]], { name: 'Ocean Boulevard' });
  // Downtown avenue (N-S) all the way south
  add('main', [[500, 318], [490, 360], [485, 398], [485, 540], [485, 690], [485, 792], [485, 900], [485, 1062], [485, 1100]], { name: 'Central Avenue' });
  // Main E-W boulevard (pier -> highway)
  add('main', [[240, 540], [258, 540], [485, 540], [560, 545], [645, 530]], { name: 'Pier Street' });
  // Downtown grid (interior)
  for (const x of GRID_X.slice(1, -1)) add('street', [[x, 398], [x, 780]], { smooth: false });
  for (const y of GRID_Y) if (y !== 540) add('street', [[258, y], [485, y]], { smooth: false });
  // North-west: roundabout road up to North Shore houses and field
  add('street', [[262, 205], [300, 150], [330, 100], [345, 50], [380, 20], [430, 12]]);
  add('street', [[262, 205], [330, 185], [400, 165], [452, 145]], { name: 'Hillcrest Drive' });
  add('street', [[245, 205], [200, 170], [165, 130], [150, 90]]);
  add('street', [[330, 100], [280, 95], [230, 80]]);
  // Hillcrest suburb curvy streets
  add('street', [[258, 250], [320, 245], [380, 232], [440, 212], [478, 225]]);
  add('street', [[258, 300], [330, 300], [400, 290], [470, 270], [510, 300]]);
  add('street', [[258, 350], [340, 352], [420, 345], [488, 360]]);
  add('street', [[305, 398], [305, 350], [312, 300], [318, 245], [322, 183]]);
  add('street', [[395, 398], [398, 345], [402, 290], [398, 232], [395, 170]]);
  add('street', [[440, 398], [448, 350], [455, 280], [445, 212]]);
  // Eastside streets
  add('street', [[660, 495], [720, 498]]);
  add('street', [[680, 560], [760, 555], [840, 565], [920, 580], [990, 600]]);
  add('street', [[690, 615], [780, 610], [860, 622], [940, 632]]);
  add('street', [[720, 498], [712, 560], [700, 640]]);
  add('street', [[800, 505], [795, 560], [785, 640]]);
  add('street', [[880, 522], [875, 580], [868, 640]]);
  add('street', [[955, 550], [950, 600], [945, 650]]);
  add('street', [[648, 600], [690, 615]]);
  // Redbrick (rotated grid)
  {
    const ang = -0.6, cx = 565, cy = 650, sp = 40;
    const c = Math.cos(ang), s = Math.sin(ang);
    const P = (u, v) => [cx + u * c - v * s, cy + u * s + v * c];
    for (const u of [-1.5, -0.5, 0.5, 1.5]) add('street', [P(u * sp, -2.1 * sp), P(u * sp, 2.1 * sp)], { smooth: false });
    for (const v of [-1.5, -0.5, 0.5, 1.5]) add('street', [P(-2.1 * sp, v * sp), P(2.1 * sp, v * sp)], { smooth: false });
  }
  // Industrial grid
  add('street', [[690, 712], [700, 780], [720, 840]]);
  add('street', [[780, 694], [785, 780]]);
  add('street', [[880, 666], [885, 775]]);
  add('street', [[690, 780], [995, 770]]);
  add('street', [[720, 840], [790, 850]]);
  // Sports district / outskirts
  add('street', [[258, 792], [485, 792]], { smooth: false, name: 'Stadium Way' });
  add('street', [[372, 792], [372, 1062]], { smooth: false });
  add('street', [[485, 900], [560, 880], [640, 905], [720, 960], [800, 985], [900, 1000], [1005, 1010]], { name: 'Outskirts Road' });
  add('street', [[560, 880], [575, 960], [560, 1062]]);
  add('street', [[640, 905], [660, 820], [690, 780]]);
  add('street', [[720, 960], [760, 1040], [860, 1070], [1000, 1075]]);
  // Roundabouts
  add('main', circlePts(488, 398, 11), { closed: true, name: 'North Roundabout' });
  add('main', circlePts(486, 792, 12), { closed: true, name: 'South Roundabout' });
  add('street', circlePts(262, 205, 10), { closed: true });
  // Mountain switchbacks
  add('mountain', [[470, 210], [500, 180], ...serpentine(520, 170, 640, 90, 5, 38).slice(1), [700, 120], [735, 160]], { name: 'Summit Road' });
  add('mountain', [[625, 450], [680, 420], ...serpentine(700, 400, 860, 290, 5, 30).slice(1), [890, 270], [905, 240]], { name: 'Eagle Pass' });
  add('mountain', [[446, 110], [480, 75], [540, 60], [600, 55]], { name: 'Summit Road' });
  return R;
}

// ---------------------------------------------------------------- layout builder
let _layout = null;
export function getLayout() {
  if (!_layout) _layout = buildLayout();
  return _layout;
}

function buildLayout() {
  const rand = mulberry32(20240917);
  const roads = [];
  const authored = authorRoads();
  authored.forEach((r, i) => {
    const pw = r.px.map(W);
    const pts = r.smooth ? catmullRom(pw, 4, r.closed) : densify(r.closed ? [...pw, pw[0]] : pw, 6);
    const t = ROAD_TYPES[r.type];
    roads.push({ id: i, type: r.type, name: r.name, width: t.width, speed: t.speed, lanes: t.lanes, closed: r.closed, pts });
  });

  // ---- road heights follow the (smoothed) terrain
  for (const r of roads) {
    const raw = r.pts.map(([x, z]) => { const [px, py] = toPx(x, z); return Math.max(0.02, rawHeightPx(px, py)); });
    const hs = raw.map((_, i) => {
      let s = 0, n = 0;
      for (let k = -5; k <= 5; k++) { const j = i + k; if (j >= 0 && j < raw.length) { s += raw[j]; n++; } }
      return s / n;
    });
    r.hs = hs;
  }

  // ---- road graph: split at intersections
  const graph = buildGraph(roads);

  // ---- buildings
  const buildings = [];
  const colliders = [];
  const blockers = []; // simple circles/boxes preventing placement (landmarks)
  const landmarks = {};

  const roadIndex = makeRoadIndex(roads);
  const nearRoad = (x, z, margin) => roadIndex.nearest(x, z, margin);

  // Landmarks first (they reserve space)
  const lm = (id, px, py, wpx, hpx, extra = {}) => {
    const b = { id, x: wx(px), z: wz(py), hx: (wpx * S) / 2, hz: (hpx * S) / 2, rot: extra.rot || 0, ...extra };
    landmarks[id] = b;
    blockers.push(b);
    return b;
  };
  lm('stadium', 292, 890, 138, 124);
  lm('arena', 420, 878, 70, 75);
  lm('dome', 420, 1010, 60, 55);
  lm('parkingStadium', 300, 1022, 100, 40);
  lm('parkingArena', 420, 825, 60, 30);
  lm('pier', 172, 543, 160, 11);
  lm('pierEnd', 102, 543, 22, 30);
  lm('plazaPark', 328, 468, 38, 38);
  lm('resort', 748, 145, 55, 42);
  lm('fountainPlaza', 282, 468, 34, 38);
  lm('field', 290, 125, 80, 70);
  lm('basketballCourtPark', 540, 470, 26, 16);
  lm('farm1', 695, 940, 40, 36);
  lm('farm2', 870, 1045, 60, 40);
  lm('containerYard', 900, 720, 150, 70);

  const addBuilding = (b) => {
    b.id = buildings.length;
    const [bpx, bpy] = toPx(b.x, b.z);
    b.base = Math.max(0, rawHeightPx(bpx, bpy));
    buildings.push(b);
    colliders.push({ kind: 'building', ref: b.id, x: b.x, z: b.z, hx: b.hx, hz: b.hz, rot: b.rot, y0: b.base - 20, y1: b.base + b.h });
    return b;
  };
  const overlapsExisting = (x, z, hx, hz, rot, pad = 2) => {
    const r = Math.hypot(hx, hz) + pad;
    for (const o of buildings) {
      if (Math.abs(o.x - x) > r + o.hx + o.hz || Math.abs(o.z - z) > r + o.hx + o.hz) continue;
      if (obbOverlap({ x, z, hx: hx + pad, hz: hz + pad, rot }, o)) return true;
    }
    for (const o of blockers) if (obbOverlap({ x, z, hx: hx + pad, hz: hz + pad, rot }, o)) return true;
    return false;
  };
  const clearOfRoads = (x, z, hx, hz, rot) => {
    // check corners + center + edge midpoints distance to roads
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [lx, lz] of [[0, 0], [-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, hz], [0, -hz], [hx, 0], [-hx, 0]]) {
      const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
      const n = nearRoad(px, pz, 30);
      if (n && n.d < n.road.width / 2 + 2.5) return false;
    }
    return true;
  };
  const onLand = (x, z, hx, hz) => {
    for (const [a, b] of [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz], [0, 0]]) {
      const [px, py] = toPx(x + a, z + b);
      if (isWaterPx(px, py) || px - shoreXpx(py) < 36) return false;
    }
    return true;
  };

  // --- Downtown & midtown blocks from the grid
  const dtCenter = W([372, 540]);
  for (let i = 0; i < GRID_X.length - 1; i++) {
    for (let j = 0; j < GRID_Y.length - 1; j++) {
      const x0 = wx(GRID_X[i]), x1 = wx(GRID_X[i + 1]), z0 = wz(GRID_Y[j]), z1 = wz(GRID_Y[j + 1]);
      const mid = [(x0 + x1) / 2, (z0 + z1) / 2];
      const [mpx, mpy] = toPx(mid[0], mid[1]);
      if (Math.abs(mpx - 328) < 20 && Math.abs(mpy - 468) < 20) continue; // park
      if (Math.abs(mpx - 282) < 20 && Math.abs(mpy - 468) < 20) continue; // fountain plaza
      const inset = 9.5;
      const bx0 = x0 + inset, bx1 = x1 - inset, bz0 = z0 + inset, bz1 = z1 - inset;
      const bw = bx1 - bx0, bd = bz1 - bz0;
      const midtown = mpy > 684;
      const nx = bw > 36 ? 2 : 1, nz = bd > 36 ? 2 : 1;
      for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
        const gap = 3;
        const cw = (bw - gap * (nx - 1)) / nx, cd = (bd - gap * (nz - 1)) / nz;
        const cx = bx0 + cw / 2 + a * (cw + gap), cz = bz0 + cd / 2 + b * (cd + gap);
        const dist = Math.hypot(cx - dtCenter[0], cz - dtCenter[1]);
        let h;
        if (midtown) h = 10 + rand() * 22;
        else h = 16 + 150 * Math.exp(-((dist / 150) ** 2)) * (0.55 + rand() * 0.55) + rand() * 12;
        const type = midtown ? pick(rand, ['office', 'apartment', 'shop', 'restaurant', 'office']) : h > 60 ? 'tower' : pick(rand, ['office', 'shop', 'restaurant', 'apartment', 'office']);
        // door faces the nearest street side
        const faces = [[0, -1, cz - bz0], [0, 1, bz1 - cz], [-1, 0, cx - bx0], [1, 0, bx1 - cx]];
        // prefer outward faces of block
        let face = [0, 1];
        const outward = [];
        if (b === 0) outward.push([0, -1]); if (b === nz - 1) outward.push([0, 1]);
        if (a === 0) outward.push([-1, 0]); if (a === nx - 1) outward.push([1, 0]);
        face = outward[Math.floor(rand() * outward.length)] || [0, 1];
        addBuilding({ x: cx, z: cz, hx: cw / 2, hz: cd / 2, rot: 0, h, base: 0, type, district: midtown ? 'midtown' : 'downtown', face, seed: Math.floor(rand() * 1e9) });
      }
    }
  }

  // --- Redbrick courtyard blocks (rotated grid, like the red-brick blocks on the map)
  {
    const ang = -0.6, cx = 565, cy = 650, sp = 40;
    const c = Math.cos(ang), s2 = Math.sin(ang);
    for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) {
      const px = cx + u * sp * c - v * sp * s2, py = cy + u * sp * s2 + v * sp * c;
      const [x, z] = W([px, py]);
      if (districtAtPx(px, py).id !== 'redbrick') continue;
      const rot = -ang;
      const half = (sp * S - 10 - 7) / 2;
      // four wings around a courtyard
      const wing = 5.5;
      for (const [lx, lz, hx, hz, fx, fz] of [[0, -half + wing, half, wing, 0, -1], [0, half - wing, half, wing, 0, 1], [-half + wing, 0, wing, half - 2 * wing - 1, -1, 0], [half - wing, 0, wing, half - 2 * wing - 1, 1, 0]]) {
        const cc = Math.cos(rot), ss = Math.sin(rot);
        const bx = x + lx * cc + lz * ss, bz = z - lx * ss + lz * cc;
        if (overlapsExisting(bx, bz, hx, hz, rot, 0.5)) continue;
        addBuilding({ x: bx, z: bz, hx, hz, rot, h: 12 + rand() * 9, base: 0, type: 'brick_apartment', district: 'redbrick', face: [fx, fz], seed: Math.floor(rand() * 1e9) });
      }
    }
  }

  // --- Residential / other districts: place along streets
  const placeAlong = (districtIds, spec) => {
    for (const road of roads) {
      if (road.type === 'highway') continue;
      const pts = road.pts;
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const seg = Math.hypot(bx - ax, bz - az);
        acc += seg;
        if (acc < spec.spacing) continue;
        acc = 0;
        const tx = (bx - ax) / seg, tz = (bz - az) / seg;
        for (const side of [-1, 1]) {
          if (rand() > spec.density) continue;
          const w = spec.w[0] + rand() * (spec.w[1] - spec.w[0]);
          const d = spec.d[0] + rand() * (spec.d[1] - spec.d[0]);
          const off = road.width / 2 + spec.setback + d / 2;
          const nx = -tz * side, nz = tx * side; // normal pointing to side
          const cx = bx + nx * off, cz = bz + nz * off;
          const [px, py] = toPx(cx, cz);
          const dist = districtAtPx(px, py);
          if (!districtIds.includes(dist.id)) continue;
          // building faces the road: local +z is the front (door side) -> towards -normal
          const rot = Math.atan2(-nx, -nz);
          if (!onLand(cx, cz, w / 2, d / 2)) continue;
          if (!clearOfRoads(cx, cz, w / 2, d / 2, rot)) continue;
          if (overlapsExisting(cx, cz, w / 2, d / 2, rot, spec.pad)) continue;
          const type = typeof spec.type === 'function' ? spec.type(rand, dist) : spec.type;
          const h = spec.h[0] + rand() * (spec.h[1] - spec.h[0]);
          addBuilding({ x: cx, z: cz, hx: w / 2, hz: d / 2, rot, h, base: 0, type, district: dist.id, face: [0, 1], seed: Math.floor(rand() * 1e9) });
        }
      }
    }
  };
  placeAlong(['hillcrest'], { spacing: 20, density: 0.95, w: [11, 15], d: [10, 13], h: [6, 9], setback: 7, pad: 3, type: (r) => (r() < 0.85 ? 'house' : 'villa') });
  placeAlong(['northshore'], { spacing: 26, density: 0.8, w: [11, 16], d: [10, 14], h: [6, 9], setback: 8, pad: 5, type: (r) => (r() < 0.6 ? 'villa' : 'house') });
  placeAlong(['beachfront'], { spacing: 24, density: 0.9, w: [14, 22], d: [12, 16], h: [10, 26], setback: 4, pad: 3, type: (r) => (r() < 0.4 ? 'beach_house' : r() < 0.5 ? 'restaurant' : 'apartment') });
  placeAlong(['eastside'], { spacing: 18, density: 0.95, w: [12, 22], d: [11, 16], h: [7, 22], setback: 4, pad: 2, type: (r) => (r() < 0.5 ? 'rough_apartment' : r() < 0.4 ? 'shop' : 'rough_house') });
  placeAlong(['redbrick'], { spacing: 20, density: 1, w: [16, 26], d: [12, 16], h: [10, 18], setback: 4, pad: 2, type: (r) => (r() < 0.8 ? 'brick_apartment' : 'shop') });
  placeAlong(['industrial'], { spacing: 34, density: 0.9, w: [26, 44], d: [20, 30], h: [9, 16], setback: 6, pad: 5, type: (r) => (r() < 0.6 ? 'warehouse' : 'factory') });
  placeAlong(['outskirts'], { spacing: 40, density: 0.55, w: [11, 15], d: [10, 13], h: [6, 8], setback: 10, pad: 10, type: (r) => (r() < 0.7 ? 'farmhouse' : 'house') });
  placeAlong(['mountain'], { spacing: 35, density: 0.35, w: [10, 13], d: [9, 12], h: [6, 8], setback: 6, pad: 6, type: 'cabin' });
  placeAlong(['sports'], { spacing: 30, density: 0.6, w: [16, 24], d: [14, 18], h: [8, 14], setback: 6, pad: 4, type: (r) => pick(r, ['shop', 'restaurant', 'gym']) });

  // --- Assign special buildings (closest suitable building to a target point)
  const special = {};
  const assign = (key, px, py, type, allow) => {
    const [tx, tz] = W([px, py]);
    let best = null, bd = Infinity;
    for (const b of buildings) {
      if (b.special) continue;
      if (allow && !allow.includes(b.type)) continue;
      const d = Math.hypot(b.x - tx, b.z - tz);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) {
      best.type = type; best.special = key;
      if (['police', 'hospital'].includes(type)) best.h = Math.min(Math.max(best.h, 14), 24);
      if (['gunstore', 'gym', 'garage', 'taxi_depot', 'cafe', 'restaurant', 'clothing'].includes(type)) best.h = Math.min(best.h, 12 + (best.h > 30 ? 6 : 0));
      special[key] = best.id;
      colliders[best.id].y1 = best.base + best.h;
    }
    return best;
  };
  assign('police', 330, 710, 'police');
  assign('hospital', 440, 740, 'hospital');
  assign('gunstore1', 465, 610, 'gunstore');
  assign('gunstore2', 830, 540, 'gunstore');
  assign('gym', 430, 830, 'gym');
  assign('taxi_depot', 285, 760, 'taxi_depot');
  assign('garage', 740, 700, 'garage');
  assign('cafe', 280, 420, 'cafe');
  assign('diner', 205, 600, 'restaurant');
  assign('bar', 760, 620, 'bar');
  assign('nightclub', 690, 570, 'nightclub');
  assign('clothing', 420, 520, 'clothing');
  assign('police2', 900, 610, 'police');
  assign('safehouse', 360, 300, 'safehouse', ['house', 'villa']);
  assign('hotel', 220, 500, 'hotel', ['apartment', 'beach_house']);
  assign('clinic', 350, 560, 'clinic');
  assign('dentist', 380, 590, 'dentist');
  assign('pharmacy', 400, 540, 'pharmacy');
  assign('supermarket', 320, 480, 'supermarket');
  assign('barber', 450, 570, 'barber');
  assign('bank', 470, 500, 'bank');
  assign('arcade', 240, 560, 'arcade');
  assign('cinema', 300, 500, 'cinema');
  assign('concert', 480, 460, 'concert');

  // --- Doors
  for (const b of buildings) {
    const [fx, fz] = b.face;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const lx = fx * (b.hx + 0.6), lz = fz * (b.hz + 0.6);
    b.door = { x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c, rot: b.rot + Math.atan2(fx, fz) };
  }

  // ---- landmark colliders (stadium ring etc.)
  addLandmarkColliders(landmarks, colliders);

  // ---- props: trees, lamps, parked cars, etc.
  const props = buildProps(rand, roads, buildings, landmarks, roadIndex, overlapsExisting, onLand, graph);

  // ---- vehicle spawns (parked cars)
  const vehicleSpawns = buildVehicleSpawns(rand, roads, buildings, landmarks, special, roadIndex, overlapsExisting);

  // ---- spawn points
  const spawnPoints = [W([266, 544]), W([250, 541]), W([282, 480]), W([318, 541]), W([372, 541])].map(([x, z]) => ({ x, z }));

  // ---- activity venues
  const venues = buildVenues(landmarks);

  return { S, roads, graph, buildings, colliders, landmarks, props, vehicleSpawns, special, spawnPoints, venues, roadIndex };
}

function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }

function densify(pts, spacing) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / spacing));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  return out;
}

export function obbOverlap(a, b) {
  // SAT for two oriented rectangles
  const axes = [];
  for (const o of [a, b]) {
    const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
    axes.push([c, -s], [s, c]);
  }
  const proj = (o, ax) => {
    const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
    const center = o.x * ax[0] + o.z * ax[1];
    const ex = Math.abs(c * ax[0] - s * ax[1]) * o.hx + Math.abs(s * ax[0] + c * ax[1]) * o.hz;
    return [center - ex, center + ex];
  };
  for (const ax of axes) {
    const [a0, a1] = proj(a, ax), [b0, b1] = proj(b, ax);
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}

// Spatial index over road sample segments
function makeRoadIndex(roads) {
  const CELL = 40;
  const grid = new Map();
  const key = (i, j) => i * 100003 + j;
  roads.forEach((road) => {
    for (let i = 0; i < road.pts.length - 1; i++) {
      const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1];
      const i0 = Math.floor(Math.min(ax, bx) / CELL), i1 = Math.floor(Math.max(ax, bx) / CELL);
      const j0 = Math.floor(Math.min(az, bz) / CELL), j1 = Math.floor(Math.max(az, bz) / CELL);
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) {
        const k = key(a, b);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([road, i]);
      }
    }
  });
  return {
    nearest(x, z, maxD = 40) {
      let best = null;
      const r = Math.ceil(maxD / CELL);
      const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
      for (let a = ci - r; a <= ci + r; a++) for (let b = cj - r; b <= cj + r; b++) {
        const list = grid.get(key(a, b));
        if (!list) continue;
        for (const [road, i] of list) {
          const [ax, az] = road.pts[i], [bx, bz] = road.pts[i + 1];
          const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-9;
          let t = ((x - ax) * dx + (z - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + dx * t, qz = az + dz * t;
          const d = Math.hypot(x - qx, z - qz) - road.width / 2;
          if (!best || d < best.edge) best = { road, i, t, q: [qx, qz], d: d + road.width / 2, edge: d };
        }
      }
      return best;
    },
  };
}

// ---------------------------------------------------------------- road graph
function buildGraph(roads) {
  // cut points per road: list of {idx (fractional sample index), nodeId}
  const nodes = [];
  const addNode = (x, z) => {
    for (const n of nodes) if (Math.hypot(n.x - x, n.z - z) < 6) return n.id;
    nodes.push({ id: nodes.length, x, z, edges: [] });
    return nodes.length - 1;
  };
  const cuts = roads.map(() => []);
  // Intersections between different roads
  for (let a = 0; a < roads.length; a++) {
    const A = roads[a].pts;
    for (let b = a + 1; b < roads.length; b++) {
      const B = roads[b].pts;
      // quick bbox reject
      if (!bboxOverlap(A, B)) continue;
      for (let i = 0; i < A.length - 1; i++) {
        for (let j = 0; j < B.length - 1; j++) {
          const r = segIntersect(A[i], A[i + 1], B[j], B[j + 1]);
          if (!r) continue;
          const id = addNode(r.p[0], r.p[1]);
          cuts[a].push({ f: i + r.t, id });
          cuts[b].push({ f: j + r.u, id });
        }
      }
    }
  }
  // T-junctions: endpoints close to other roads
  roads.forEach((road, a) => {
    if (road.closed) return;
    for (const endIdx of [0, road.pts.length - 1]) {
      const p = road.pts[endIdx];
      let found = false;
      for (let b = 0; b < roads.length && !found; b++) {
        if (b === a) continue;
        const c = closestOnPoly(p, roads[b].pts);
        if (c.d < roads[b].width / 2 + 5) {
          const id = addNode(c.q[0], c.q[1]);
          cuts[b].push({ f: c.i + c.t, id });
          cuts[a].push({ f: endIdx, id });
          // snap endpoint onto the junction
          road.pts[endIdx] = [nodes[id].x, nodes[id].z];
          found = true;
        }
      }
      if (!found) cuts[a].push({ f: endIdx, id: addNode(p[0], p[1]) });
    }
    if (road.closed && cuts[a].length === 0) cuts[a].push({ f: 0, id: addNode(road.pts[0][0], road.pts[0][1]) });
  });
  // Build edges
  const edges = [];
  roads.forEach((road, ri) => {
    const cs = cuts[ri].sort((p, q) => p.f - q.f);
    const uniq = [];
    for (const c of cs) if (!uniq.length || uniq[uniq.length - 1].id !== c.id || Math.abs(uniq[uniq.length - 1].f - c.f) > 1) uniq.push(c);
    const list = road.closed && uniq.length ? [...uniq, { f: uniq[0].f + road.pts.length - 1, id: uniq[0].id }] : uniq;
    for (let k = 0; k < list.length - 1; k++) {
      const c0 = list[k], c1 = list[k + 1];
      if (c0.id === c1.id && c1.f - c0.f < 2) continue;
      const pts = slicePoly(road.pts, c0.f, c1.f, road.closed);
      if (pts.length < 2) continue;
      const len = pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
      if (len < 3) continue;
      const e = { id: edges.length, a: c0.id, b: c1.id, road: ri, pts, len, speed: road.speed, lanes: road.lanes, width: road.width, oneway: false };
      edges.push(e);
      nodes[c0.id].edges.push(e.id);
      nodes[c1.id].edges.push(e.id);
    }
  });
  return { nodes, edges };
}

function bboxOverlap(A, B) {
  let ax0 = Infinity, ax1 = -Infinity, az0 = Infinity, az1 = -Infinity;
  for (const p of A) { ax0 = Math.min(ax0, p[0]); ax1 = Math.max(ax1, p[0]); az0 = Math.min(az0, p[1]); az1 = Math.max(az1, p[1]); }
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const p of B) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
  return !(ax1 < bx0 - 5 || bx1 < ax0 - 5 || az1 < bz0 - 5 || bz1 < az0 - 5);
}

function slicePoly(pts, f0, f1, closed) {
  const n = pts.length - 1;
  const at = (f) => {
    let ff = f;
    if (closed) ff = ((f % n) + n) % n;
    const i = Math.min(Math.floor(ff), pts.length - 2), t = ff - i;
    return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
  };
  const out = [at(f0)];
  for (let k = Math.floor(f0) + 1; k < f1; k++) out.push(at(k));
  out.push(at(f1));
  return out;
}

// ---------------------------------------------------------------- landmark colliders
// Shared footprint for the CS-style combat arena (Stage 12) — used by both the venue definition
// (buildVenues, for round logic/OOB checks) and the collider walls below, so they always agree.
export function combatArenaGeom() {
  const cx = wx(835), cz = wz(730);
  return { cx, cz, halfX: 95, halfZ: 58, spawnA: [cx - 72, cz], spawnB: [cx + 72, cz] };
}

function addLandmarkColliders(L, colliders) {
  const box = (kind, x, z, hx, hz, rot, y0, y1, extra = {}) => colliders.push({ kind, x, z, hx, hz, rot, y0, y1, ...extra });
  // Combat arena: perimeter wall (with entrance gaps at both spawn ends) + mid-lane cover blocks
  // + two small buildings flanking the lane, so the arena is real walkable/collidable geometry,
  // not just an invisible bounding box (see CombatArena.js for the matching visual meshes).
  {
    const { cx, cz, halfX, halfZ } = combatArenaGeom();
    const wt = 1.2, wh = 6;
    // north & south perimeter walls, full length (no gaps needed — entrances are at the ends)
    box('arenaWall', cx, cz - halfZ, halfX, wt / 2, 0, 0, wh);
    box('arenaWall', cx, cz + halfZ, halfX, wt / 2, 0, 0, wh);
    // east & west end walls, split with a gate gap in the middle for spawn access
    for (const sx of [-1, 1]) {
      const ex = cx + sx * halfX;
      const seg = (halfZ * 2 - 10) / 2;
      box('arenaWall', ex, cz - 5 - seg / 2, wt / 2, seg / 2, 0, 0, wh);
      box('arenaWall', ex, cz + 5 + seg / 2, wt / 2, seg / 2, 0, 0, wh);
    }
    // mid-lane cover: staggered crates/containers down the centre so there's no clean sightline
    // end-to-end, plus two flanking buildings for alleys/corners.
    const coverX = [-45, -20, 0, 20, 45];
    for (let i = 0; i < coverX.length; i++) {
      const zoff = i % 2 === 0 ? -14 : 14;
      box('arenaCover', cx + coverX[i], cz + zoff, 3, 3, 0, -1, 2.2);
    }
    box('arenaBldg', cx - 30, cz - halfZ + 12, 9, 8, 0, -1, 7);
    box('arenaBldg', cx + 30, cz + halfZ - 12, 9, 8, 0, -1, 7);
    box('arenaBldg', cx - 12, cz + halfZ - 10, 7, 6, 0, -1, 6);
    box('arenaBldg', cx + 12, cz - halfZ + 10, 7, 6, 0, -1, 6);
  }
  // Stadium: ring of stands (4 sides) with gaps for entrances
  const st = L.stadium;
  const t = 14; // stand thickness
  const hgt = 26;
  // north & south stands with central gap
  for (const sz of [-1, 1]) {
    const z = st.z + sz * (st.hz - t / 2);
    const segW = (st.hx * 2 - 16) / 2;
    box('stadium', st.x - 8 - segW / 2, z, segW / 2, t / 2, 0, -1, hgt);
    box('stadium', st.x + 8 + segW / 2, z, segW / 2, t / 2, 0, -1, hgt);
  }
  for (const sx of [-1, 1]) {
    const x = st.x + sx * (st.hx - t / 2);
    const segD = (st.hz * 2 - 2 * t - 16) / 2;
    box('stadium', x, st.z - 8 - segD / 2, t / 2, segD / 2, 0, -1, hgt);
    box('stadium', x, st.z + 8 + segD / 2, t / 2, segD / 2, 0, -1, hgt);
  }
  // Arena: open-air basketball court with a ring of stands and entrances north/south
  const ar = L.arena;
  const at = 9, ah = 9;
  for (const sz of [-1, 1]) {
    const segW = (ar.hx * 2 - 12) / 2;
    box('arena', ar.x - 6 - segW / 2, ar.z + sz * (ar.hz - at / 2), segW / 2, at / 2, 0, -1, ah);
    box('arena', ar.x + 6 + segW / 2, ar.z + sz * (ar.hz - at / 2), segW / 2, at / 2, 0, -1, ah);
  }
  for (const sx of [-1, 1]) box('arena', ar.x + sx * (ar.hx - at / 2), ar.z, at / 2, ar.hz - at, 0, -1, ah);
  const dm = L.dome;
  box('dome', dm.x, dm.z, dm.hx, dm.hz, 0, -1, 20, { enterable: 'dome' });
  // Pier deck: walkable support
  const p = L.pier;
  box('support', p.x, p.z, p.hx, p.hz, 0, -3, 0.9, { walk: true });
  const pe = L.pierEnd;
  box('support', pe.x, pe.z, pe.hx, pe.hz, 0, -3, 0.9, { walk: true });
  // Marina walkways
  box('support', wx(160), wz(614), 64 * S, 3, 0, -3, 0.6, { walk: true });
  box('support', wx(92), wz(716), 3, 102 * S, 0, -3, 0.6, { walk: true });
  box('support', wx(140), wz(816), 50 * S, 3, 0, -3, 0.6, { walk: true });
  for (let i = 0; i < 6; i++) box('support', wx(165), wz(645 + i * 30), 42 * S, 1.3, 0, -3, 0.5, { walk: true, pontoon: true });
}

// ---------------------------------------------------------------- props
function buildProps(rand, roads, buildings, L, roadIndex, overlaps, onLand, graph) {
  const trees = [], palms = [], lamps = [], benches = [], lights = [], containers = [], cranes = [], boats = [], rocks = [], hydrants = [], bins = [], graffiti = [], fences = [];
  const bollards = [], bikeRacks = [], busStops = [], signs = [], atms = [];
  // Street lamps along roads
  for (const r of roads) {
    const t = ROAD_TYPES[r.type];
    if (!t.lamp) continue;
    let acc = t.lamp / 2, side = 1;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      const seg = Math.hypot(bx - ax, bz - az);
      acc += seg;
      if (acc < t.lamp) continue;
      acc = 0; side = -side;
      const tx = (bx - ax) / seg, tz = (bz - az) / seg;
      const off = r.width / 2 + 1.2;
      const x = bx - tz * side * off, z = bz + tx * side * off;
      const [px, py] = toPx(x, z);
      if (isWaterPx(px, py)) continue;
      const n = roadIndex.nearest(x, z, 20);
      if (n && n.d < n.road.width / 2 + 0.5) continue;
      lamps.push({ x, z, rot: Math.atan2(tz * side, -tx * side) + Math.PI / 2 });
    }
  }
  // Scatter trees by district type
  const tryTree = (x, z, kind = 'tree') => {
    const [px, py] = toPx(x, z);
    if (isWaterPx(px, py)) return false;
    const n = roadIndex.nearest(x, z, 20);
    if (n && n.d < n.road.width / 2 + 2) return false;
    if (overlaps(x, z, 1.2, 1.2, 0, 0.5)) return false;
    const s = 0.8 + rand() * 0.7;
    (kind === 'palm' ? palms : trees).push({ x, z, s, r: rand() * 6.28, v: rand() });
    return true;
  };
  for (let i = 0; i < 9000; i++) {
    const px = rand() * 1000, py = rand() * 1090;
    const d = districtAtPx(px, py);
    const dens = { mountain: 0.55, northshore: 0.35, hillcrest: 0.2, outskirts: 0.3, redbrick: 0.06, eastside: 0.04, industrial: 0.02, downtown: 0.0, midtown: 0.01, sports: 0.08, beachfront: 0 }[d.id] ?? 0.05;
    if (rand() > dens) continue;
    // snow line / steep rock areas get rocks instead
    const h = rawHeightPx(px, py);
    if (h > 95) { if (rand() < 0.15) rocks.push({ x: wx(px), z: wz(py), s: 1 + rand() * 3, r: rand() * 6 }); continue; }
    if (px > 240 && px < 490 && py > 400 && py < 690) continue;
    tryTree(wx(px), wz(py));
  }
  // Park blocks
  for (const key of ['plazaPark']) {
    const b = L[key];
    for (let i = 0; i < 26; i++) tryTreeFree(trees, b.x + (rand() - 0.5) * b.hx * 1.8, b.z + (rand() - 0.5) * b.hz * 1.8, rand);
    for (let i = 0; i < 6; i++) benches.push({ x: b.x + (rand() - 0.5) * b.hx * 1.4, z: b.z + (rand() - 0.5) * b.hz * 1.4, rot: Math.floor(rand() * 4) * Math.PI / 2 });
  }
  // Palms along the beach & coastal road
  for (let py = 210; py < 1000; py += 9) {
    if (py > 530 && py < 556) continue;
    for (const o of [30, 44]) tryTree(wx(shoreXpx(py) + o + (rand() - 0.5) * 4), wz(py), 'palm');
  }
  // Beach benches / lifeguard towers
  const lifeguards = [];
  for (const py of [300, 450, 680, 900]) lifeguards.push({ x: wx(shoreXpx(py) + 22), z: wz(py), rot: Math.PI / 2 });
  // Port containers
  const cy = L.containerYard;
  for (let i = 0; i < 16; i++) for (let j = 0; j < 5; j++) {
    if (rand() < 0.2) continue;
    const stack = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < stack; k++) containers.push({ x: cy.x - cy.hx + 8 + i * 13, z: cy.z - cy.hz + 10 + j * 16, y: k * 2.6, rot: 0, c: Math.floor(rand() * 6) });
  }
  // Docks cranes along the port basin north edge
  for (const px of [820, 880, 940]) cranes.push({ x: wx(px), z: wz(795), rot: 0 });
  // Marina boats
  for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) if (rand() < 0.75) boats.push({ x: wx(118 + j * 20), z: wz(652 + i * 30) + (rand() < 0.5 ? -4 : 4), rot: Math.PI / 2 + (rand() - 0.5) * 0.1, s: 0.8 + rand() * 0.5, c: Math.floor(rand() * 4) });
  boats.push({ x: wx(60), z: wz(575), rot: 0.2, s: 2.2, c: 0 });
  boats.push({ x: wx(40), z: wz(690), rot: 1.2, s: 1.3, c: 1 });
  boats.push({ x: wx(900), z: wz(870), rot: 0.2, s: 2.5, c: 2, ship: true });
  // Graffiti on rough buildings
  for (const b of buildings) {
    if (b.type === 'rough_apartment' || b.type === 'rough_house' || (b.type === 'warehouse' && rand() < 0.4)) graffiti.push({ b: b.id, v: Math.floor(rand() * 6) });
  }
  // Hydrants & bins downtown
  for (let i = 0; i < 120; i++) {
    const r = roads[Math.floor(rand() * roads.length)];
    if (r.type !== 'street' && r.type !== 'main') continue;
    const k = Math.floor(rand() * (r.pts.length - 1));
    const [ax, az] = r.pts[k], [bx, bz] = r.pts[k + 1];
    const L2 = Math.hypot(bx - ax, bz - az) || 1;
    const side = rand() < 0.5 ? 1 : -1;
    const x = ax - ((bz - az) / L2) * side * (r.width / 2 + 1.4), z = az + ((bx - ax) / L2) * side * (r.width / 2 + 1.4);
    const [px, py] = toPx(x, z);
    if (isWaterPx(px, py)) continue;
    (rand() < 0.5 ? hydrants : bins).push({ x, z, rot: rand() * 6 });
  }
  // Bollards along street/main road shoulders, bike racks near shops, bus stops and
  // corner signs at minor junctions
  for (const r of roads) {
    if (r.type !== 'street' && r.type !== 'main') continue;
    let acc = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
      const seg = Math.hypot(bx - ax, bz - az);
      acc += seg;
      if (acc < 30) continue;
      acc = 0;
      const tx = (bx - ax) / seg, tz = (bz - az) / seg;
      for (const side of [-1, 1]) {
        const off = r.width / 2 + 1.1;
        const x = bx - tz * side * off, z = bz + tx * side * off;
        const [px, py] = toPx(x, z);
        if (isWaterPx(px, py)) continue;
        if (rand() < 0.35) bollards.push({ x, z, rot: 0 });
      }
    }
    if (r.type === 'main') {
      let acc2 = 60;
      for (let i = 1; i < r.pts.length; i++) {
        const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
        const seg = Math.hypot(bx - ax, bz - az);
        acc2 += seg;
        if (acc2 < 140) continue;
        acc2 = 0;
        const tx = (bx - ax) / seg, tz = (bz - az) / seg;
        const side = rand() < 0.5 ? 1 : -1;
        const off = r.width / 2 + 1.6;
        const x = bx - tz * side * off, z = bz + tx * side * off;
        const [px, py] = toPx(x, z);
        if (isWaterPx(px, py)) continue;
        busStops.push({ x, z, rot: Math.atan2(-tz * side, tx * side) });
      }
    }
  }
  // Bike racks and shop/stop signs near buildings that face the street
  for (const b of buildings) {
    if (rand() < (b.type === 'shop' || b.type === 'clothing' || b.type === 'cafe' ? 0.5 : 0.04)) {
      const [fx, fz] = b.face;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const lx = fx * (b.hx + 2.2), lz = fz * (b.hz + 2.2);
      const x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c;
      const [px, py] = toPx(x, z);
      if (!isWaterPx(px, py)) bikeRacks.push({ x, z, rot: b.rot });
    }
    // ATMs: outside banks always, and occasionally outside other commercial buildings
    const atmChance = b.type === 'bank' ? 1 : ['shop', 'clothing', 'cafe', 'restaurant', 'supermarket'].includes(b.type) ? 0.12 : 0;
    if (rand() < atmChance) {
      const [fx, fz] = b.face;
      const c2 = Math.cos(b.rot), s2 = Math.sin(b.rot);
      const lx2 = fx * (b.hx + 1.3) - fz * 1.5, lz2 = fz * (b.hz + 1.3) + fx * 1.5;
      const x2 = b.x + lx2 * c2 + lz2 * s2, z2 = b.z - lx2 * s2 + lz2 * c2;
      const [px2, py2] = toPx(x2, z2);
      if (!isWaterPx(px2, py2)) atms.push({ x: x2, z: z2, rot: b.rot });
    }
  }
  for (const n of graph.nodes) {
    if (n.edges.length < 3) continue;
    const types = n.edges.map((e) => roads[graph.edges[e].road].type);
    if (types.includes('main') || types.includes('highway')) continue; // those get traffic lights
    if (rand() < 0.5) signs.push({ x: n.x + 2.5, z: n.z + 2.5, rot: rand() * 6.28 });
  }
  // Plants: bushes/hedges around house gardens, flower/grass patches in parks
  const plants = [];
  const houseTypes = new Set(['house', 'villa', 'beach_house', 'cabin', 'farmhouse']);
  for (const b of buildings) {
    if (!houseTypes.has(b.type)) continue;
    const n = 3 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const edge = Math.floor(rand() * 4);
      const along = (rand() - 0.5) * 2;
      const lx = edge < 2 ? (edge === 0 ? -1 : 1) * (b.hx + 0.9 + rand() * 0.6) : along * b.hx * 0.85;
      const lz = edge >= 2 ? (edge === 2 ? -1 : 1) * (b.hz + 0.9 + rand() * 0.6) : along * b.hz * 0.85;
      const c = Math.cos(b.rot), s = Math.sin(b.rot);
      const x = b.x + lx * c + lz * s, z = b.z - lx * s + lz * c;
      const [px, py] = toPx(x, z);
      if (isWaterPx(px, py)) continue;
      const n2 = roadIndex.nearest(x, z, 6);
      if (n2 && n2.d < n2.road.width / 2 + 0.5) continue;
      plants.push({ x, z, r: rand() * 6.28, s: 0.7 + rand() * 0.6, kind: rand() < 0.3 ? 'flower' : 'bush' });
    }
  }
  for (const key of ['plazaPark']) {
    const b = L[key];
    for (let i = 0; i < 40; i++) plants.push({ x: b.x + (rand() - 0.5) * b.hx * 1.8, z: b.z + (rand() - 0.5) * b.hz * 1.8, r: rand() * 6.28, s: 0.6 + rand() * 0.6, kind: rand() < 0.35 ? 'flower' : 'grass' });
  }
  // Garden fences around houses: the perimeter at a small setback, with a gap on the door side
  for (const b of buildings) {
    if (!houseTypes.has(b.type)) continue;
    const fx0 = b.hx + 2.0, fz0 = b.hz + 2.0;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    const W2 = (lx, lz) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
    const corners = [W2(-fx0, -fz0), W2(fx0, -fz0), W2(fx0, fz0), W2(-fx0, fz0)];
    const [dfx, dfz] = b.face;
    const doorWx = dfx * c + dfz * s, doorWz = -dfx * s + dfz * c;
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      const mx = (ax + bx) / 2 - b.x, mz = (az + bz) / 2 - b.z;
      const mlen = Math.hypot(mx, mz) || 1;
      if ((mx * doorWx + mz * doorWz) / mlen > 0.7) continue; // gap for the path to the door
      fences.push({ x1: ax, z1: az, x2: bx, z2: bz });
    }
  }
  return { trees, palms, lamps, benches, containers, cranes, boats, rocks, hydrants, bins, graffiti, lifeguards, fences, plants, bollards, bikeRacks, busStops, signs, atms };
}
function tryTreeFree(arr, x, z, rand) { arr.push({ x, z, s: 0.8 + rand() * 0.6, r: rand() * 6.28, v: rand() }); }

// ---------------------------------------------------------------- parked vehicles
function buildVehicleSpawns(rand, roads, buildings, L, special, roadIndex, overlaps) {
  const spawns = [];
  const typeFor = (dist) => {
    const r = rand();
    if (dist === 'hillcrest' || dist === 'northshore') return r < 0.3 ? 'sports' : r < 0.6 ? 'suv' : 'sedan';
    if (dist === 'eastside') return r < 0.5 ? 'sedan_old' : r < 0.75 ? 'van' : 'motorcycle';
    if (dist === 'industrial') return r < 0.5 ? 'truck' : 'van';
    if (dist === 'downtown' || dist === 'midtown') return r < 0.2 ? 'taxi' : r < 0.35 ? 'sports' : r < 0.5 ? 'motorcycle' : 'sedan';
    return r < 0.45 ? 'sedan' : r < 0.7 ? 'suv' : r < 0.85 ? 'motorcycle' : 'van';
  };
  // Driveway / curbside parking near buildings
  for (const b of buildings) {
    if (rand() > 0.33) continue;
    const n = roadIndex.nearest(b.door.x, b.door.z, 30);
    if (!n || n.road.type === 'highway' || n.road.type === 'mountain' && rand() < 0.5) continue;
    const r = n.road;
    const i = Math.min(n.i, r.pts.length - 2);
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
    const L2 = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / L2, tz = (bz - az) / L2;
    // side of the road the building is on
    const side = Math.sign((b.x - n.q[0]) * -tz + (b.z - n.q[1]) * tx) || 1;
    const off = r.width / 2 - 1.3;
    const x = n.q[0] - tz * side * off + tx * (rand() - 0.5) * 6, z = n.q[1] + tx * side * off + tz * (rand() - 0.5) * 6;
    if (spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 7)) continue;
    spawns.push({ x, z, rot: Math.atan2(tx, tz), type: typeFor(b.district) });
  }
  // Parking lots
  for (const key of ['parkingStadium', 'parkingArena']) {
    const p = L[key];
    for (let i = 0; i < 14; i++) for (let j = 0; j < 2; j++) {
      if (rand() < 0.45) continue;
      spawns.push({ x: p.x - p.hx + 4 + i * 3.4 * (p.hx * 2 / 50), z: p.z + (j ? 1 : -1) * p.hz * 0.5, rot: j ? Math.PI : 0, type: typeFor('sports') });
    }
  }
  // Emergency vehicles at police stations / hospital, taxis at depot
  const near = (id, type, n) => {
    const b = buildings[special[id]];
    if (!b) return;
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    for (let k = 0; k < n; k++) {
      const lx = -b.hx + 3 + k * 3.2, lz = b.hz + 5.5;
      spawns.push({ x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c, rot: b.rot + Math.PI / 2, type, fixed: id });
    }
  };
  near('police', 'police', 3);
  near('police2', 'police', 2);
  near('hospital', 'ambulance', 2);
  near('taxi_depot', 'taxi', 4);
  near('garage', 'sports', 2);
  // Fishing-mission boat, moored at the very end of the pier (Stage 9)
  { const e = L.pierEnd; spawns.push({ x: e.x - e.hx + 4, z: e.z, rot: Math.PI / 2, type: 'boat', fixed: 'fishingBoat' }); }
  spawns.forEach((s, i) => (s.id = i));
  return spawns;
}

// ---------------------------------------------------------------- venues for activities
function buildVenues(L) {
  const st = L.stadium, ar = L.arena, dm = L.dome;
  return {
    football: { x: st.x, z: st.z, halfLength: 52, halfWidth: 33, goalWidth: 7.32, goalHeight: 2.44, axis: 'x' },
    basketball: { x: ar.x, z: ar.z, halfLength: 14, halfWidth: 7.5, rimHeight: 3.05, axis: 'x' },
    streetball: { x: L.basketballCourtPark.x, z: L.basketballCourtPark.z, halfLength: 14, halfWidth: 7.5, rimHeight: 3.05, axis: 'x' },
    wrestling: { x: dm.x, z: dm.z, half: 3.2, height: 1.2 },
    // Desert-town/industrial CS-style arena (Stage 12): a real walled compound (not just a
    // bounding box) — two spawn courtyards at opposite ends connected by a mid lane with cover,
    // see combatArenaGeom() above (shared with the collider walls) and CombatArena.js (visuals).
    combat: (() => { const a = combatArenaGeom(); return { x: a.cx, z: a.cz, halfX: a.halfX, halfZ: a.halfZ, spawnA: a.spawnA, spawnB: a.spawnB }; })(),
  };
}

// Convenience used by client & server
export function nearestRoadPoint(x, z) { return getLayout().roadIndex.nearest(x, z, 60); }
export { circleVsObb };
