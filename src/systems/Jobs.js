import * as THREE from 'three';
import { NPC } from '../npc/NPC.js';
import { h } from '../ui/dom.js';

// Taxi driver job (server-issued jobs, server-validated payment) and paramedic job.
export class Jobs {
  constructor(game) {
    this.game = game;
    this.taxi = null;     // {job, stage, passenger}
    this.medic = null;
    this.markers = [];
    const mk = (color) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 3, 24, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })); m.visible = false; game.engine.scene.add(m); return m; };
    this.marker = mk('#ffd23f');
  }
  get active() { return this.taxi || this.medic; }

  onEnterVehicle(v, seat) {
    const g = this.game;
    if (seat !== 0) return;
    if (v.type === 'taxi' && !this.taxi) g.ui.notify(`Taxi! Press ${g.settings.binding('phone').replace('Key', '')} to start taxi work.`, 'info');
    if (v.type === 'ambulance' && !this.medic) g.ui.notify(`Ambulance! Press ${g.settings.binding('phone').replace('Key', '')} to start paramedic duty.`, 'info');
  }
  onExitVehicle() { if (this.taxi?.stage === 'dropoff') { this.game.ui.notify('Your passenger got out, annoyed. Job failed.', 'bad'); this.endTaxi(); } }

  async startTaxi() {
    const g = this.game;
    const v = g.vehicles?.current;
    if (!v || v.type !== 'taxi' || !v.isDriver) return g.ui.notify('You need to be driving a taxi.', 'bad');
    const r = await g.net.request('taxiJob', {});
    let job = r.ok ? r.job : null;
    if (!r.ok && !g.net.connected) job = this.localTaxiJob();
    if (!job) return g.ui.notify(r.error || 'No fares right now.', 'bad');
    this.taxi = { job, stage: 'pickup' };
    // passenger waiting at the pickup
    const p = new NPC(g.npcs, { role: 'civilian', variant: Math.floor(Math.random() * 8), x: job.from.x, y: g.world.collision.groundAt(job.from.x, job.from.z), z: job.from.z, fixed: true });
    g.npcs.add(p);
    (g.npcs.extra ||= []).push(p);
    p.state = 'idle';
    this.taxi.passenger = p;
    g.setWaypoint({ x: job.from.x, z: job.from.z });
    g.audio.ui('notify');
    g.ui.notify(`New fare! Pick up ${p.persona.short} (${Math.round(Math.hypot(job.from.x - v.position.x, job.from.z - v.position.z))}m away).`, 'good');
  }
  localTaxiJob() {
    const g = this.game;
    const bs = g.layout.buildings;
    const a = bs[Math.floor(Math.random() * bs.length)], b = bs[Math.floor(Math.random() * bs.length)];
    const dist = Math.hypot(b.door.x - a.door.x, b.door.z - a.door.z);
    return { from: { x: a.door.x, z: a.door.z }, to: { x: b.door.x, z: b.door.z }, dist, pay: Math.round(60 + dist * 0.55) };
  }
  endTaxi() {
    const g = this.game;
    if (this.taxi?.passenger) { const p = this.taxi.passenger; g.npcs.extra = (g.npcs.extra || []).filter((x) => x !== p); g.npcs.remove(p); }
    this.taxi = null;
    this.marker.visible = false;
    g.setWaypoint(null);
  }

  update(dt) {
    const g = this.game;
    if (!g.player) return;
    const v = g.vehicles?.current;
    if (g.input.hit('phone') && g.mode === 'playing' && v?.isDriver) {
      if (v.type === 'taxi') { if (this.taxi) { this.endTaxi(); g.ui.notify('Taxi duty ended.', 'info'); } else this.startTaxi(); return; }
      if (v.type === 'ambulance') { this.medic ? this.endMedic() : this.startMedic(); return; }
    }
    this.marker.visible = false;
    if (this.taxi) this.updateTaxi(dt, v);
    if (this.medic) this.updateMedic(dt, v);
    this.marker.rotation.y += dt;
  }
  async updateTaxi(dt, v) {
    const g = this.game;
    const t = this.taxi;
    const target = t.stage === 'pickup' ? t.job.from : t.job.to;
    this.marker.visible = true;
    this.marker.position.set(target.x, g.world.collision.groundAt(target.x, target.z) + 1.5, target.z);
    const pay = Math.round(t.job.pay);
    const d = v ? Math.hypot(target.x - v.position.x, target.z - v.position.z) : Infinity;
    g.hud.setJob(`<b>Taxi — ${t.stage === 'pickup' ? 'pick up passenger' : 'drive to destination'}</b>${t.passenger ? t.passenger.persona.name : ''}<br>Distance: ${Math.round(d)}m · Fare: ~$${pay}<br><span class="muted">P: end shift</span>`);
    if (!v || t.busy) return;
    if (d < 14 && Math.abs(v.speed) < 2.5) {
      t.busy = true;
      if (t.stage === 'pickup') {
        const r = g.net.connected ? await g.net.request('taxiPickup', {}) : { ok: true };
        if (r.ok) {
          t.stage = 'dropoff';
          t.passenger.avatar.group.visible = false;
          t.passenger.collider.disabled = true;
          g.setWaypoint({ x: t.job.to.x, z: t.job.to.z });
          const lines = ['Step on it!', 'Take the scenic route, I dare you.', "Please don't crash, I just got my hair done.", 'Is that a gorilla driving the car next to us?', 'Downtown traffic is the worst.'];
          g.hud.chatMessage(t.passenger.persona.short, lines[Math.floor(Math.random() * lines.length)]);
          t.pickedAt = performance.now();
        } else g.ui.notify(r.error, 'bad');
      } else {
        const r = g.net.connected ? await g.net.request('taxiDropoff', {}) : { ok: true, amount: pay };
        if (r.ok) {
          if (r.profile) g.setProfile(r.profile); else g.profile.money += pay;
          g.audio.cash();
          g.ui.notify(`Fare complete! +$${r.amount}`, 'good');
          const p = t.passenger;
          p.avatar.group.visible = true; p.collider.disabled = false;
          p.position.copy(v.doorWorld(1)); p.state = 'wander'; p.fixed = false;
          g.npcs.extra = (g.npcs.extra || []).filter((x) => x !== p); g.npcs.npcs.push(p);
          t.passenger = null;
          this.taxi = null; g.hud.setJob(null); g.setWaypoint(null);
          setTimeout(() => { if (g.vehicles?.current?.type === 'taxi' && !this.taxi) this.startTaxi(); }, 2500);
        } else g.ui.notify(r.error, 'bad');
      }
      if (this.taxi) this.taxi.busy = false;
    }
  }

  // ---------------- paramedic: drive to injured NPCs and treat them
  startMedic() {
    const g = this.game;
    this.medic = { calls: 0 };
    g.ui.notify('Paramedic duty started. Drive to the patients and stop next to them.', 'good');
    this.newPatient();
  }
  endMedic() {
    const g = this.game;
    if (this.medic?.patient) { const p = this.medic.patient; g.npcs.extra = (g.npcs.extra || []).filter((x) => x !== p); g.npcs.remove(p); }
    this.medic = null; g.hud.setJob(null); g.setWaypoint(null);
    g.ui.notify('Paramedic duty ended.', 'info');
  }
  newPatient() {
    const g = this.game;
    const bs = g.layout.buildings;
    let b;
    for (let i = 0; i < 20; i++) { b = bs[Math.floor(Math.random() * bs.length)]; const d = Math.hypot(b.door.x - g.player.pos.x, b.door.z - g.player.pos.z); if (d > 120 && d < 600) break; }
    const x = b.door.x + Math.sin(b.door.rot) * 3, z = b.door.z + Math.cos(b.door.rot) * 3;
    const p = new NPC(g.npcs, { role: 'civilian', variant: Math.floor(Math.random() * 8), x, y: g.world.collision.groundAt(x, z), z, fixed: true });
    p.state = 'lie';
    g.npcs.add(p); (g.npcs.extra ||= []).push(p);
    this.medic.patient = p; this.medic.t = 90;
    g.setWaypoint({ x, z });
  }
  updateMedic(dt, v) {
    const g = this.game;
    const m = this.medic;
    const p = m.patient;
    if (!p) return;
    m.t -= dt;
    this.marker.visible = true;
    this.marker.position.set(p.position.x, p.position.y + 1.5, p.position.z);
    const d = v ? v.position.distanceTo(p.position) : Infinity;
    g.hud.setJob(`<b>Paramedic — patient ${m.calls + 1}</b>Time left: ${Math.max(0, Math.ceil(m.t))}s · ${Math.round(d)}m away<br><span class="muted">Stop next to the patient. P: end duty</span>`);
    if (m.t <= 0) { g.ui.notify('The patient did not make it. Faster next time.', 'bad'); g.npcs.extra = g.npcs.extra.filter((x) => x !== p); g.npcs.remove(p); this.newPatient(); return; }
    if (v && d < 9 && Math.abs(v.speed) < 2 && !m.busy) {
      m.busy = true;
      p.state = 'idle'; p.avatar.anim.play('getUp'); p.say('Thank you!!');
      g.net.request('reward', { kind: 'paramedic' }).then((r) => { if (r.ok) { if (r.profile) g.setProfile(r.profile); g.audio.cash(); g.ui.notify(`Patient saved! +$${r.amount}`, 'good'); } else if (!g.net.connected) { g.profile.money += 120; g.ui.notify('Patient saved! +$120', 'good'); } });
      m.calls++;
      setTimeout(() => { g.npcs.extra = (g.npcs.extra || []).filter((x) => x !== p); g.npcs.remove(p); m.busy = false; if (this.medic) this.newPatient(); }, 2500);
    }
  }
  blips(out) {
    if (this.taxi) { const t = this.taxi.stage === 'pickup' ? this.taxi.job.from : this.taxi.job.to; out.push({ x: t.x, z: t.z, color: '#ffd23f', size: 7 }); }
    if (this.medic?.patient) out.push({ x: this.medic.patient.position.x, z: this.medic.patient.position.z, color: '#ff4757', size: 7 });
  }
  menu() { return h('div'); }
}
