// Small 2D geometry helpers (no three.js dependency so the server can use them).

export function catmullRom(points, spacing = 4, closed = false) {
  // points: [[x,z],...] -> resampled smooth polyline with ~spacing between samples
  if (points.length < 2) return points.slice();
  const pts = closed ? [...points, points[0]] : points;
  const out = [];
  const get = (i) => {
    if (closed) return points[((i % points.length) + points.length) % points.length];
    return pts[Math.max(0, Math.min(pts.length - 1, i))];
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(segLen / spacing));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(closed ? out[0].slice() : pts[pts.length - 1].slice());
  return out;
}

export function polyLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

export function segIntersect(a, b, c, d) {
  const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1];
  const den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den;
  const u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u, p: [a[0] + r0 * t, a[1] + r1 * t] };
}

export function closestOnSeg(p, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1e-9;
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2;
  t = Math.max(0, Math.min(1, t));
  const q = [a[0] + dx * t, a[1] + dz * t];
  return { t, q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

export function closestOnPoly(p, pts) {
  let best = { d: Infinity, i: 0, t: 0, q: pts[0] };
  for (let i = 0; i < pts.length - 1; i++) {
    const r = closestOnSeg(p, pts[i], pts[i + 1]);
    if (r.d < best.d) best = { d: r.d, i, t: r.t, q: r.q };
  }
  return best;
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Oriented box (center x,z, half extents hx,hz, rotation rot around Y) -> corner list
export function obbCorners(b) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const out = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = sx * b.hx, lz = sz * b.hz;
    out.push([b.x + lx * c + lz * s, b.z - lx * s + lz * c]);
  }
  return out;
}

// Does a circle overlap an oriented box (2D)? returns push vector or null
export function circleVsObb(px, pz, r, b) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const dx = px - b.x, dz = pz - b.z;
  // world -> local (inverse rotation)
  const lx = dx * c - dz * s, lz = dx * s + dz * c;
  const cx = Math.max(-b.hx, Math.min(b.hx, lx)), cz = Math.max(-b.hz, Math.min(b.hz, lz));
  let ox = lx - cx, oz = lz - cz;
  let d2 = ox * ox + oz * oz;
  if (d2 > r * r) return null;
  let nx, nz, pen;
  if (d2 < 1e-10) {
    // center inside: push out along smallest axis
    const px1 = b.hx - Math.abs(lx), pz1 = b.hz - Math.abs(lz);
    if (px1 < pz1) { nx = Math.sign(lx) || 1; nz = 0; pen = px1 + r; }
    else { nx = 0; nz = Math.sign(lz) || 1; pen = pz1 + r; }
  } else {
    const d = Math.sqrt(d2); nx = ox / d; nz = oz / d; pen = r - d;
  }
  // local -> world
  return { x: (nx * c + nz * s) * pen, z: (-nx * s + nz * c) * pen };
}

// Ray (origin o, dir d normalized, 3D) vs oriented box with y range. Returns t or -1.
export function rayVsObb(o, d, b, maxT = Infinity) {
  const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
  const ox = o[0] - b.x, oz = o[2] - b.z;
  const lox = ox * c - oz * s, loz = ox * s + oz * c;
  const ldx = d[0] * c - d[2] * s, ldz = d[0] * s + d[2] * c;
  let tmin = 0, tmax = maxT;
  const axes = [[lox, ldx, -b.hx, b.hx], [o[1], d[1], b.y0, b.y1], [loz, ldz, -b.hz, b.hz]];
  for (const [p, v, lo, hi] of axes) {
    if (Math.abs(v) < 1e-9) { if (p < lo || p > hi) return -1; continue; }
    let t1 = (lo - p) / v, t2 = (hi - p) / v;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  return tmin;
}
