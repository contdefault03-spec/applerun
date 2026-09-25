import { h } from '../ui/dom.js';
import { WEAPONS } from '../../shared/weapons.js';

// Stage 14: an admin/debug menu (key 9) — god mode, fly mode, give weapons, heal, teleport to
// any named place, clear wanted level. In a multiplayer world room this only works for the
// host, or for anyone when the room was created with "cheats allowed"; the server
// (server/rooms.js, the `cheat` request) enforces that, it isn't just a client-side lock.
export class AdminMenu {
  constructor(game) {
    this.game = game;
    this.open = false;
  }

  places() {
    const L = this.game.layout;
    const out = [];
    for (const [key, label] of [['police', 'Police'], ['police2', 'Police (2)'], ['hospital', 'Hospital'], ['gunstore1', 'Gun Store'], ['gunstore2', 'Gun Store (2)'], ['garage', 'Garage'], ['gym', 'Gym'], ['taxi_depot', 'Taxi Depot'], ['safehouse', 'Safehouse'], ['cafe', 'Café'], ['bar', 'Bar'], ['clothing', 'Clothing']]) {
      const b = L.buildings[L.special[key]]; if (b) out.push({ label, x: b.door.x, z: b.door.z });
    }
    const hotel = L.buildings.find((b) => b.type === 'hotel'); if (hotel) out.push({ label: 'Hotel', x: hotel.door.x, z: hotel.door.z });
    for (const [key, label] of [['stadium', 'Stadium'], ['arena', 'Arena'], ['dome', 'Dome'], ['resort', 'Ski Resort'], ['pier', 'Pier'], ['pierEnd', 'Pier End'], ['plazaPark', 'Park']]) {
      const b = L.landmarks[key]; if (b) out.push({ label, x: b.x, z: b.z });
    }
    return out;
  }

  /** Runs a cheat: server-validated in a networked world room, applied directly in solo. */
  async cheat(op, data = {}) {
    const g = this.game;
    if (g.net.connected && g.net.room && g.net.room.kind === 'world') {
      const r = await g.net.request('cheat', { op, ...data });
      if (!r.ok) { g.ui.notify(r.error || 'Cheats are off in this room', 'bad'); return false; }
      if (r.profile) g.setProfile(r.profile);
      return true;
    }
    return true; // solo/local: no room to gate against
  }

  async giveWeapons() {
    const g = this.game;
    const ok = await this.cheat('weapons');
    if (!ok) return;
    if (!g.net.connected || !g.net.room) {
      const weapons = Object.keys(WEAPONS);
      const ammo = { ...g.profile.ammo };
      for (const w of Object.values(WEAPONS)) if (w.mag) ammo[w.id] = (w.mag + (w.reserve || w.mag * 3)) * 3;
      g.setProfile({ ...g.profile, weapons, ammo });
    }
    g.ui.notify('All weapons + max ammo given.', 'good');
  }
  async heal() {
    const g = this.game;
    const ok = await this.cheat('heal');
    if (!ok) return;
    if (!g.net.connected || !g.net.room) { g.setHealth(100); g.player.armor = 100; }
    g.ui.notify('Health and armor restored.', 'good');
  }
  async clearWanted() {
    const g = this.game;
    const ok = await this.cheat('clearWanted');
    if (!ok) return;
    g.police?.clear?.(true);
    g.ui.notify('Wanted level cleared.', 'good');
  }
  toggleGod(on) {
    this.game.adminGod = on;
    this.cheat('god', { on });
    this.game.ui.notify(on ? 'God mode on.' : 'God mode off.', 'info');
  }
  toggleFly(on) {
    const p = this.game.player;
    if (!p) return;
    p.flying = on;
    if (on) p.vel.set(0, 0, 0);
    this.game.ui.notify(on ? 'Fly mode on — Shift up, Ctrl down.' : 'Fly mode off.', 'info');
  }
  teleport(place) { this.game.player?.teleport(place.x, null, place.z); this.render(); }

  // ------------------------------------------------------------------ UI
  toggle() {
    if (this.open) { this.close(); return; }
    this.open = true;
    this.game.input.unlock();
    this.render();
  }
  close() { this.open = false; this.el?.remove(); this.el = null; this.game.input.lock(); }
  render() {
    const g = this.game;
    this.el?.remove();
    const flySpeed = g.player?.flySpeed || 20;
    this.el = h('div.panel', { style: { position: 'fixed', left: '20px', top: '80px', width: 'min(360px, 90vw)', padding: '14px 16px', zIndex: 20 } },
      h('div.row', h('b', 'Admin / Debug Menu'), h('div.spacer'), h('button.btn.small', { onclick: () => this.close() }, '✕')),
      h('label.row', h('input', { type: 'checkbox', checked: !!g.adminGod, onchange: (e) => this.toggleGod(e.target.checked) }), ' God mode (no damage)'),
      h('label.row', h('input', { type: 'checkbox', checked: !!g.player?.flying, onchange: (e) => this.toggleFly(e.target.checked) }), ' Fly mode (or double-tap Space)'),
      h('div.row', h('span.muted', 'Fly speed'), h('input', { type: 'range', min: 5, max: 60, value: flySpeed, style: { flex: 1 }, oninput: (e) => { if (g.player) g.player.flySpeed = +e.target.value; } })),
      h('div.row', { style: { marginTop: '8px' } }, h('button.btn.small.primary', { onclick: () => this.giveWeapons() }, 'Give all weapons + max ammo')),
      h('div.row', h('button.btn.small.primary', { onclick: () => this.heal() }, 'Heal / refill armor')),
      h('div.row', h('button.btn.small.primary', { onclick: () => this.clearWanted() }, 'Clear wanted level')),
      h('div.row', { style: { marginTop: '8px' } }, h('b', 'Teleport to…')),
      h('select', { onchange: (e) => { const p = this.places()[+e.target.value]; if (p) this.teleport(p); e.target.selectedIndex = -1; } },
        h('option', { value: '-1', disabled: true, selected: true }, 'Pick a place'),
        ...this.places().map((p, i) => h('option', { value: String(i) }, p.label))),
    );
    document.getElementById('ui').append(this.el);
  }
}
