import * as THREE from 'three';
import { buildVehicle, SPECS } from './VehicleModels.js';
import { heightAt } from '../../shared/map/terrain.js';

// Client-side AI traffic following lanes on the shared road graph, obeying traffic
// lights, keeping distance, braking for pedestrians and reacting to collisions.
const TYPES = [['sedan', 30], ['suv', 14], ['taxi', 10], ['van', 8], ['truck', 5], ['sedan_old', 10], ['sports', 7], ['hypercar', 2], ['motorcycle', 6], ['police', 4]];
const TOTAL_W = TYPES.reduce((s, t) => s + t[1], 0);
const SIGNAL_GREEN = new THREE.Color('#2e7d32'), SIGNAL_AMBER = new THREE.Color('#f9a825'), SIGNAL_RED = new THREE.Color('#c62828');

export class Traffic {
  constructor(game) {
    this.game = game;
    this.graph = game.layout.graph;
    this.roads = game.layout.roads;
    this.cars = [];
    this.target = game.engine.quality === 'low' ? 20 : game.engine.quality === 'medium' ? 32 : 46;
    this.time = 0;
    this.pools = new Map();
    // cumulative lengths per edge
    for (const e of this.graph.edges) {
      e.cum = [0];
      for (let i = 1; i < e.pts.length; i++) e.cum.push(e.cum[i - 1] + Math.hypot(e.pts[i][0] - e.pts[i - 1][0], e.pts[i][1] - e.pts[i - 1][1]));
      e.len = e.cum[e.cum.length - 1];
      e.type = this.roads[e.road].type;
      e.hs = null;
    }
    this.lightNodes = new Set();
    for (const n of this.graph.nodes) {
      if (n.edges.length < 3) continue;
      const types = n.edges.map((i) => this.graph.edges[i].type);
      if ((types.includes('main') || types.includes('highway')) && !types.includes('mountain')) this.lightNodes.add(n.id);
    }
    this.spawnable = this.graph.edges.filter((e) => e.len > 25);
  }

  sample(e, s, dir, out) {
    // point + tangent at distance s along the edge in travel direction
    const d = dir > 0 ? s : e.len - s;
    let i = 1;
    while (i < e.cum.length - 1 && e.cum[i] < d) i++;
    const a = e.pts[i - 1], b = e.pts[i];
    const seg = e.cum[i] - e.cum[i - 1] || 1;
    const t = Math.max(0, Math.min(1, (d - e.cum[i - 1]) / seg));
    out.x = a[0] + (b[0] - a[0]) * t; out.z = a[1] + (b[1] - a[1]) * t;
    out.tx = (b[0] - a[0]) / seg * dir; out.tz = (b[1] - a[1]) / seg * dir;
    return out;
  }
  laneOffset(e, lane) {
    const w = this.roads[e.road].width;
    return e.lanes > 1 ? w / 4 + (lane - 0.5) * (w / 4) * 0.9 : w / 4;
  }

  pickType() { let r = Math.random() * TOTAL_W; for (const [t, w] of TYPES) { r -= w; if (r <= 0) return t; } return 'sedan'; }
  model(type) {
    const pool = this.pools.get(type) || [];
    if (pool.length) return pool.pop();
    const s = SPECS[type];
    const color = s.colors[Math.floor(Math.random() * s.colors.length)];
    const accent = (type === 'sports' || type === 'sedan' || type === 'hypercar') && Math.random() < 0.3 ? ['#ffffff', '#111111', '#f5c400'][Math.floor(Math.random() * 3)] : null;
    return buildVehicle(type, color, accent, true); // v1.3: every ambient traffic vehicle gets a visible driver
  }
  release(car) {
    this.game.engine.scene.remove(car.m.group);
    this.game.world.collision.remove(car.collider);
    if (!this.pools.has(car.type)) this.pools.set(car.type, []);
    this.pools.get(car.type).push(car.m);
  }

  spawn(nearPos) {
    for (let tries = 0; tries < 12; tries++) {
      const e = this.spawnable[Math.floor(Math.random() * this.spawnable.length)];
      const mid = e.pts[Math.floor(e.pts.length / 2)];
      const d = Math.hypot(mid[0] - nearPos.x, mid[1] - nearPos.z);
      if (d < 70 || d > 260) continue;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const s = Math.random() * e.len;
      if (this.cars.some((c) => c.edge === e && Math.abs(c.s - s) < 15)) continue;
      const type = this.pickType();
      const m = this.model(type);
      const spec = SPECS[type];
      const car = { type, spec, m, edge: e, dir, s, lane: e.lanes > 1 ? Math.floor(Math.random() * 2) : 0, speed: e.speed * 0.8, wait: 0, stopped: 0, honk: 0, p: { x: 0, z: 0, tx: 0, tz: 1 }, yaw: 0, spin: 0 };
      car.collider = { kind: 'vehicle', dynamic: true, x: 0, z: 0, hx: spec.width / 2, hz: spec.length / 2, rot: 0, y0: -1, y1: 3, traffic: car, noCamera: true };
      this.game.engine.scene.add(m.group);
      this.game.world.collision.add(car.collider);
      this.cars.push(car);
      this.place(car, 0);
      return car;
    }
    return null;
  }

  lightGreen(node, tx, tz) {
    const cycle = 26, t = (this.time + node.id * 7.3) % cycle;
    const phase = t < cycle / 2 ? 0 : 1;
    const tt = t % (cycle / 2);
    const group = Math.abs(tx) > Math.abs(tz) ? 0 : 1;
    return group === phase && tt < cycle / 2 - 3;
  }

  /** Colours the traffic-light signal heads (src/world/Props.js) to match lightGreen()'s
   * red/green cycle, with a 3 s amber before each group's light goes red. */
  updateLights() {
    const w = this.game.world;
    const heads = w?.trafficLightHeads, poles = w?.trafficLights;
    if (!heads?.instanceColor || !poles) return;
    const cycle = 26;
    for (let i = 0; i < poles.length; i++) {
      const p = poles[i];
      const t = (this.time + p.node * 7.3) % cycle, phase = t < cycle / 2 ? 0 : 1, tt = t % (cycle / 2);
      const col = p.group !== phase ? SIGNAL_RED : tt < cycle / 2 - 3 ? SIGNAL_GREEN : SIGNAL_AMBER;
      col.toArray(heads.instanceColor.array, i * 3);
    }
    heads.instanceColor.needsUpdate = true;
  }

  update(dt) {
    const g = this.game;
    if (!g.player || g.player.interior || g.inActivity) { if (this.cars.length && (g.player?.interior || g.inActivity)) this.clearAll(); return; }
    this.time += dt;
    this.updateLights();
    const pp = g.player.pos;
    // maintain population
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (Math.hypot(c.p.x - pp.x, c.p.z - pp.z) > 330) { this.release(c); this.cars.splice(i, 1); }
    }
    if (this.cars.length < this.target && Math.random() < 0.5) this.spawn(pp);
    const peds = [pp, ...[...g.mp.remotes.values()].filter((r) => r.avatar.group.visible && !r.vehicle).map((r) => r.avatar.position), ...(g.npcs?.positions?.() || [])];
    const myVeh = g.vehicles?.current;
    for (const c of this.cars) {
      if (c.wrecked) { c.wreckT += dt; continue; }
      const e = c.edge;
      let target = e.speed * (c.type === 'truck' ? 0.75 : c.type === 'sports' ? 1.15 : 1);
      // car ahead
      let gap = Infinity;
      for (const o of this.cars) {
        if (o === c || o.edge !== e || o.dir !== c.dir || o.lane !== c.lane) continue;
        const ds = o.s - c.s;
        if (ds > 0 && ds < gap) gap = ds;
      }
      // player vehicles / pedestrians ahead
      const fx = c.p.tx, fz = c.p.tz;
      const obst = (x, z, lateral = 2.2) => {
        const dx = x - c.p.x, dz = z - c.p.z;
        const along = dx * fx + dz * fz, lat = Math.abs(dx * -fz + dz * fx);
        if (along > 0 && along < 22 && lat < lateral) gap = Math.min(gap, along);
      };
      for (const p of peds) obst(p.x, p.z, 2.0);
      if (myVeh) obst(myVeh.position.x, myVeh.position.z, 2.8);
      for (const v of g.vehicles?.vehicles.values() || []) if (v.remote && v !== myVeh) obst(v.position.x, v.position.z, 2.8);
      if (gap < Infinity) {
        target = Math.min(target, Math.max(0, (gap - c.spec.length - 3) * 1.1));
        if (gap < 12 && peds.some((p) => Math.hypot(p.x - c.p.x, p.z - c.p.z) < 12)) { c.honk -= dt; if (c.honk < 0 && c.speed < 1) { c.honk = 4 + Math.random() * 4; if (Math.hypot(c.p.x - pp.x, c.p.z - pp.z) < 40) g.audio.horn(new THREE.Vector3(c.p.x, 1, c.p.z)); } }
      }
      // intersection at the end of the edge
      const endNode = this.graph.nodes[c.dir > 0 ? e.b : e.a];
      const toEnd = e.len - c.s;
      if (toEnd < 22) {
        if (this.lightNodes.has(endNode.id) && !this.lightGreen(endNode, fx, fz) && toEnd > 4) target = Math.min(target, Math.max(0, (toEnd - 9) * 0.9));
        else if (endNode.edges.length >= 3) target = Math.min(target, 8);
      }
      if (c.stopped > 0) { c.stopped -= dt; target = 0; }
      const acc = target > c.speed ? 3.2 : 8;
      c.speed += Math.sign(target - c.speed) * Math.min(Math.abs(target - c.speed), acc * dt);
      c.s += c.speed * dt;
      if (c.s >= e.len) this.nextEdge(c);
      this.place(c, dt);
    }
    // cleanup wrecks
    for (let i = this.cars.length - 1; i >= 0; i--) if (this.cars[i].wrecked && this.cars[i].wreckT > 60) { this.release(this.cars[i]); this.cars.splice(i, 1); }
  }

  nextEdge(c) {
    const node = this.graph.nodes[c.dir > 0 ? c.edge.b : c.edge.a];
    const options = node.edges.map((i) => this.graph.edges[i]).filter((e) => e !== c.edge || node.edges.length === 1);
    const e = options.length ? options[Math.floor(Math.random() * options.length)] : c.edge;
    const over = c.s - c.edge.len;
    c.dir = e.a === node.id ? 1 : -1;
    if (e === c.edge) c.dir = -c.dir; // dead end: turn around
    c.edge = e;
    c.s = Math.max(0, over);
    if (e.lanes < 2) c.lane = 0;
  }

  place(c, dt) {
    this.sample(c.edge, Math.min(c.s, c.edge.len), c.dir, c.p);
    const off = this.laneOffset(c.edge, c.lane);
    // right-hand traffic: offset to the right of travel direction
    const x = c.p.x - c.p.tz * off, z = c.p.z + c.p.tx * off;
    const yaw = Math.atan2(c.p.tx, c.p.tz);
    let dy = yaw - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    c.yaw += dt ? dy * Math.min(1, dt * 6) : dy;
    const g = c.m.group;
    g.position.set(x, heightAt(x, z) + 0.02, z);
    g.rotation.set(0, c.yaw, 0);
    c.spin += (c.speed * dt) / c.spec.wheelR;
    for (const w of c.m.wheels) w.spin.rotation.x = c.spin;
    const night = this.game.world.env.nightFactor > 0.5;
    if (c.m.lights.head) c.m.lights.head.material.emissiveIntensity = night ? 2.5 : 0.3;
    if (c.m.lights.tail) c.m.lights.tail.material.emissiveIntensity = c.speed < 2 ? 2.5 : night ? 1.2 : 0.4;
    const col = c.collider;
    col.x = x; col.z = z; col.rot = c.yaw; col.y0 = g.position.y - 0.5; col.y1 = g.position.y + c.spec.height;
  }

  nearest(pos, maxD) {
    let best = null, bd = maxD;
    for (const c of this.cars) {
      if (c.wrecked) continue;
      const d = Math.hypot(c.m.group.position.x - pos.x, c.m.group.position.z - pos.z) - c.spec.length * 0.3;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  takeOver(c) {
    const i = this.cars.indexOf(c);
    if (i < 0) return null;
    this.cars.splice(i, 1);
    const p = c.m.group.position;
    const st = { type: c.type, x: p.x, y: p.y, z: p.z, yaw: c.yaw, speed: c.speed };
    // the driver bails out
    this.game.npcs?.spawnFleeing?.(new THREE.Vector3(p.x + Math.cos(c.yaw) * 2, p.y, p.z - Math.sin(c.yaw) * 2), 'carjacked');
    this.release(c);
    return st;
  }
  onRammed(c, impact) {
    c.stopped = 3 + Math.random() * 4;
    c.speed = 0;
    if (impact > 16) { c.wrecked = true; c.wreckT = 0; }
    this.game.npcs?.angryDriver?.(c);
  }
  clearAll() { for (const c of this.cars) this.release(c); this.cars = []; }
  blips() {}
}
