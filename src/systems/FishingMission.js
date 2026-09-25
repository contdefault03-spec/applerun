import * as THREE from 'three';

// Stage 9/11: the fishing mission. Press E at the boat moored at the end of the pier to start a
// 20 s join window; everyone near the boat during that window comes along. The boat (a real
// drivable vehicle, see VehicleModels.js `boat` spec) is driven ~500 m out to sea to a marker.
// While waiting, a procedural rod+line+bobber rig hangs off the boat's side. After ~30 s the
// player playing Ajan (src/characters/defs.js) gets a bite: a procedural tuna leaps out of the
// water in a scripted, slowed-down jump arc (timed independently of the game's own dt so it
// reads as "cinematic" without touching the global update loop — see STATUS.md for why real
// time-dilation was ruled out) while Ajan's own camera cuts to frame the fish. Only Ajan's
// screen shows the grab prompt; grabbing plays fish.mp3 (positional) for everyone nearby and
// pays out through the server economy (like the game's other "client-simulated job" rewards —
// taxi, paramedic, police — rate-limited and clamped server-side, see shared/economy.js). The
// bite and grab moments are relayed to nearby players over the existing 'fx' channel so their
// screens show the same tuna jump / splash even though each client simulates its own timer.
const JOIN_RADIUS = 18, TRIP_M = 500, ARRIVE_R = 15, FISH_T = 30, WAIT_MULTIPLAYER_JOIN = 20, BITE_DUR = 2.4;

export class FishingMission {
  constructor(game) {
    this.game = game;
    this.state = 'idle'; // idle | countdown | sailing | fishing | biting | grabbed-wait | grabbed
    this.t = 0;
    this.participants = new Set();
    this.isAjanHere = false;
    this.rig = null;
    this.tuna = null;
    this.remoteTunas = [];
    game.handleFx = ((prev) => (kind, r, a) => {
      if (kind === 'fishSplash') this.onRemoteSplash(a);
      else if (kind === 'fishBite') this.onRemoteBite(a);
      else prev?.(kind, r, a);
    })(game.handleFx);
  }

  // ---------------------------------------------------------------- rig prop
  buildRig() {
    const g = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 1.7, 6), new THREE.MeshStandardMaterial({ color: '#4b3421', roughness: 0.7 }));
    rod.rotation.z = Math.PI * 0.32; rod.position.set(0, 0.55, 0);
    g.add(rod);
    const lineMat = new THREE.LineBasicMaterial({ color: '#e8e8e8' });
    const linePts = [new THREE.Vector3(0.62, 1.35, 0), new THREE.Vector3(0.9, -0.55, 0)];
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(linePts), lineMat);
    g.add(line);
    const bobber = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: '#d81e2c', roughness: 0.4 }));
    bobber.position.set(0.9, -0.55, 0);
    g.add(bobber);
    g.userData.line = line; g.userData.bobber = bobber; g.userData.linePts = linePts;
    return g;
  }
  showRig(v) {
    if (this.rig) return;
    this.rig = this.buildRig();
    this.rig.position.set(v.spec.width / 2 + 0.05, 0.85, v.spec.length * 0.22);
    v.group.add(this.rig);
  }
  hideRig() {
    if (!this.rig) return;
    this.rig.parent?.remove(this.rig);
    this.rig = null;
  }

  // ---------------------------------------------------------------- tuna prop
  buildTuna() {
    const t = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: '#2b4a63', metalness: 0.3, roughness: 0.35 });
    const belly = new THREE.MeshStandardMaterial({ color: '#d9dde0', metalness: 0.1, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), bodyMat);
    body.scale.set(1, 0.78, 2.6);
    t.add(body);
    const bellyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 6), belly);
    bellyMesh.scale.set(0.9, 0.55, 2.3); bellyMesh.position.y = -0.08;
    t.add(bellyMesh);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.4, 4), bodyMat);
    tail.rotation.x = Math.PI / 2; tail.rotation.z = Math.PI / 4;
    tail.position.z = 0.66; tail.scale.set(1, 2.1, 0.15);
    t.add(tail);
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.22, 3), bodyMat);
    dorsal.position.set(0, 0.22, -0.05);
    t.add(dorsal);
    return t;
  }

  boatSpawn() {
    if (this._boatSpawn) return this._boatSpawn;
    return (this._boatSpawn = this.game.layout.vehicleSpawns.find((s) => s.fixed === 'fishingBoat'));
  }
  boatPos() { const s = this.boatSpawn(); return new THREE.Vector3(s.x, 0, s.z); }

  interactions(out, pos) {
    if (this.state === 'idle') {
      const b = this.boatPos();
      if (pos.distanceTo(b) < JOIN_RADIUS && !this.game.vehicles?.current) {
        out.push({ label: 'Start the fishing trip', key: 'interact', priority: 3, action: () => this.startCountdown() });
      }
      return;
    }
    if (this.state === 'grabbed-wait' && this.game.avatar.key === 'ajan') {
      out.push({ label: 'Press E to grab the fish', key: 'interact', priority: 7, action: () => this.grab() });
    }
  }

  startCountdown() {
    const g = this.game;
    this.state = 'countdown'; this.t = WAIT_MULTIPLAYER_JOIN;
    this.participants = new Set([g.net.id || 'me']);
    g.ui.notify('Fishing trip leaving in 20 seconds — get to the boat!', 'good');
  }

  hasAjan() {
    const g = this.game;
    if (g.avatar.key === 'ajan' && this.participants.has(g.net.id || 'me')) return true;
    for (const id of this.participants) { const r = g.mp.remotes.get(id); if (r?.avatar.key === 'ajan') return true; }
    return false;
  }

  update(dt, playing) {
    const g = this.game;
    if (!playing || !g.player) return;
    if (this.state === 'countdown') {
      const b = this.boatPos();
      if (g.player.pos.distanceTo(b) < JOIN_RADIUS) this.participants.add(g.net.id || 'me');
      for (const [id, r] of g.mp.remotes) if (r.avatar.position.distanceTo(b) < JOIN_RADIUS) this.participants.add(id);
      this.t -= dt;
      if (this.t <= 0) this.beginTrip();
      return;
    }
    if (this.state === 'sailing') {
      const v = g.vehicles?.current;
      if (v && v.spec.boat && v.position.distanceTo(this.waypoint) < ARRIVE_R) {
        this.state = 'fishing'; this.t = 0;
        g.setWaypoint(null);
        g.avatar.anim.play('interact');
        this.showRig(v);
        g.ui.notify('This looks like a good spot. Cast your line and wait...', 'good');
      }
      return;
    }
    if (this.state === 'fishing') {
      this.t += dt;
      if (this.rig) {
        const b = this.rig.userData.bobber, pts = this.rig.userData.linePts;
        b.position.y = -0.55 + Math.sin(this.t * 2.1) * 0.04;
        pts[1].copy(b.position);
        this.rig.userData.line.geometry.setFromPoints(pts);
      }
      if (this.t >= FISH_T) { this.state = 'biting'; this.t = 0; this.bite(); }
      return;
    }
    if (this.state === 'biting') {
      this.t += dt;
      this.animateTuna(this.tuna, this.t, this.tunaOrigin, this.tunaFacing);
      if (this.cineActive) this.updateCinema(this.t);
      if (this.t >= BITE_DUR) this.settleBite();
      return;
    }
    for (const r of this.remoteTunas) {
      r.t += dt;
      this.animateTuna(r.mesh, r.t, r.origin, r.facing);
      if (r.t >= BITE_DUR) { r.mesh.parent?.remove(r.mesh); }
    }
    if (this.remoteTunas.length) this.remoteTunas = this.remoteTunas.filter((r) => r.t < BITE_DUR);
  }

  // Scripted jump arc — a slow, deliberate parabola timed on its own clock (not global dt
  // scaling) so it reads as a cinematic beat without touching the engine's update loop.
  animateTuna(mesh, t, origin, facing) {
    if (!mesh) return;
    const k = Math.min(1, t / BITE_DUR);
    const arc = Math.sin(Math.PI * k); // 0 → 1 → 0
    mesh.position.set(origin.x + facing.x * k * 1.4, origin.y + arc * 3.1, origin.z + facing.z * k * 1.4);
    mesh.rotation.x = -arc * 0.9 + (k > 0.5 ? (k - 0.5) * 1.6 : 0);
    mesh.rotation.y = Math.atan2(facing.x, facing.z) + Math.sin(t * 14) * 0.15 * (1 - arc);
  }

  updateCinema(t) {
    const g = this.game;
    const cam = g.engine.camera;
    const focus = this.tuna.position;
    const back = this.tunaFacing.clone().multiplyScalar(-3.4);
    const want = this.tunaOrigin.clone().add(back).add(new THREE.Vector3(0, 2.1, 0));
    cam.position.lerp(want, Math.min(1, t * 2.2));
    cam.lookAt(focus.x, focus.y + 0.4, focus.z);
  }

  beginTrip() {
    const g = this.game;
    if (!this.hasAjan()) {
      g.ui.notify('The trip needs someone playing Ajan — no bites without him.', 'bad');
      this.state = 'idle';
      return;
    }
    const b = this.boatPos();
    const pier = g.layout.landmarks.pier;
    const dir = new THREE.Vector3(b.x - pier.x, 0, b.z - pier.z).normalize();
    this.waypoint = b.clone().add(dir.multiplyScalar(TRIP_M));
    if (!g.vehicles.current) {
      const sp = this.boatSpawn();
      const vid = 'p' + sp.id;
      const v = g.vehicles.vehicles.get(vid) || g.vehicles.instantiate(vid);
      if (v) g.vehicles.enter(v, 0);
    }
    this.state = 'sailing';
    g.ui.notify('Head out to sea — follow the marker.', 'good');
    g.setWaypoint({ x: this.waypoint.x, z: this.waypoint.z });
  }

  bite() {
    const g = this.game;
    const v = g.vehicles?.current;
    const pos = v ? v.position.clone() : g.player.pos.clone();
    this.hideRig();
    for (let i = 0; i < 10; i++) g.fx?.spawn(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.2, (Math.random() - 0.5) * 2)), { color: '#dff3ff', size: 0.5, grow: 1.5, life: 0.6, vel: [(Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2], gravity: 9, opacity: 0.8 });
    g.audio.noiseBurst?.(pos, { dur: 0.5, freq: 400, vol: 0.5, bus: 'sfx' });
    g.ui.notify('Something bites — the water erupts!', 'good');
    // scripted jump arc setup
    this.tuna = this.buildTuna();
    this.tunaOrigin = pos.clone(); this.tunaOrigin.y = 0.1;
    const yaw = v ? v.yaw : g.player.yaw || 0;
    this.tunaFacing = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.tuna.position.copy(this.tunaOrigin);
    g.world.outdoor.add(this.tuna);
    // cinematic camera cut, only for the client actually playing Ajan
    if (g.avatar.key === 'ajan') { this.cineActive = true; g.cam.cineActive = true; }
    g.net.send('fx', { kind: 'fishBite', a: { x: pos.x, y: pos.y, z: pos.z, yaw } });
  }

  settleBite() {
    const g = this.game;
    if (this.cineActive) { this.cineActive = false; g.cam.cineActive = false; }
    if (this.tuna) { this.tuna.position.copy(this.tunaOrigin).add(new THREE.Vector3(this.tunaFacing.x * 1.1, 0.15, this.tunaFacing.z * 1.1)); this.tuna.rotation.set(0, Math.atan2(this.tunaFacing.x, this.tunaFacing.z), 0); }
    this.state = 'grabbed-wait';
  }

  onRemoteBite(a) {
    const g = this.game;
    if (!a || this.state !== 'idle' && this.state !== 'fishing') return;
    const pos = new THREE.Vector3(a.x, a.y, a.z);
    if (pos.distanceTo(g.player.pos) > 250) return;
    const mesh = this.buildTuna();
    const origin = pos.clone(); origin.y = 0.1;
    const facing = new THREE.Vector3(Math.sin(a.yaw || 0), 0, Math.cos(a.yaw || 0));
    mesh.position.copy(origin);
    g.world.outdoor.add(mesh);
    this.remoteTunas.push({ mesh, t: 0, origin, facing });
  }

  async grab() {
    const g = this.game;
    const v = g.vehicles?.current;
    const pos = v ? v.position.clone() : g.player.pos.clone();
    this.state = 'grabbed';
    g.avatar.anim.play('interact');
    g.audio.playSample('fish', pos, { volume: 1.3, ref: 8 });
    g.net.send('fx', { kind: 'fishSplash', a: { x: pos.x, y: pos.y, z: pos.z } });
    if (this.tuna) { this.tuna.parent?.remove(this.tuna); this.tuna = null; }
    for (const id of this.participants) {
      const role = g.mp.remotes.get(id)?.avatar.key === 'ajan' || (id === (g.net.id || 'me') && g.avatar.key === 'ajan') ? 'ajan' : 'participant';
      if (id === (g.net.id || 'me')) {
        const res = await g.net.request('reward', { kind: 'fishing', role });
        if (res.profile) g.setProfile(res.profile);
        g.ui.notify(role === 'ajan' ? 'Ajan hauls in a huge tuna! +$25,000' : 'You helped land the catch! +$20,000', 'good');
      }
    }
    g.ui.notify('Head back to the pier — the trip is over.', 'info');
    this.state = 'idle';
  }

  onRemoteSplash(a) {
    const g = this.game;
    if (!a) return;
    const pos = new THREE.Vector3(a.x, a.y, a.z);
    if (pos.distanceTo(g.player.pos) > 400) return;
    g.audio.playSample('fish', pos, { volume: 1.0, ref: 8 });
  }
}
