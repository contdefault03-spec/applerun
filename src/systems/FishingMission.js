import * as THREE from 'three';

// Stage 9: the fishing mission. Press E at the boat moored at the end of the pier to start a
// 20 s join window; everyone near the boat during that window comes along. The boat (a real
// drivable vehicle, see VehicleModels.js `boat` spec) is driven ~500 m out to sea to a marker,
// everyone "casts" (a notification + idle wait — there's no modelled rod, see STATUS.md), and
// after ~30 s the player playing Ajan (src/characters/defs.js) gets a bite. Only Ajan's screen
// shows the grab prompt; grabbing plays fish.mp3 (positional) for everyone nearby and pays out
// through the server economy (like the game's other "client-simulated job" rewards — taxi,
// paramedic, police — rate-limited and clamped server-side, see shared/economy.js).
const JOIN_RADIUS = 18, TRIP_M = 500, ARRIVE_R = 15, FISH_T = 30, WAIT_MULTIPLAYER_JOIN = 20;

export class FishingMission {
  constructor(game) {
    this.game = game;
    this.state = 'idle'; // idle | countdown | sailing | fishing | biting | grabbed
    this.t = 0;
    this.participants = new Set();
    this.isAjanHere = false;
    game.handleFx = ((prev) => (kind, r, a) => {
      if (kind === 'fishSplash') this.onRemoteSplash(a);
      else prev?.(kind, r, a);
    })(game.handleFx);
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
        g.ui.notify('This looks like a good spot. Cast your line and wait...', 'good');
      }
      return;
    }
    if (this.state === 'fishing') {
      this.t += dt;
      if (this.t >= FISH_T) { this.state = 'biting'; this.t = 0; this.bite(); }
      return;
    }
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
    for (let i = 0; i < 10; i++) g.fx?.spawn(pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0.2, (Math.random() - 0.5) * 2)), { color: '#dff3ff', size: 0.5, grow: 1.5, life: 0.6, vel: [(Math.random() - 0.5) * 2, 3 + Math.random() * 2, (Math.random() - 0.5) * 2], gravity: 9, opacity: 0.8 });
    g.audio.noiseBurst?.(pos, { dur: 0.5, freq: 400, vol: 0.5, bus: 'sfx' });
    g.ui.notify('Something bites — the water erupts!', 'good');
    this.state = 'grabbed-wait';
  }

  async grab() {
    const g = this.game;
    const v = g.vehicles?.current;
    const pos = v ? v.position.clone() : g.player.pos.clone();
    this.state = 'grabbed';
    g.avatar.anim.play('interact');
    g.audio.playSample('fish', pos, { volume: 1.3, ref: 8 });
    g.net.send('fx', { kind: 'fishSplash', a: { x: pos.x, y: pos.y, z: pos.z } });
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
