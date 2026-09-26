// Persistent player settings (localStorage), with change listeners.
export const DEFAULT_BINDINGS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  sprint: 'ShiftLeft', crouch: 'ControlLeft', jump: 'Space', interact: 'KeyE', talk: 'KeyV',
  vehicle: 'KeyF', reload: 'KeyR', drop: 'KeyG', inventory: 'Tab', pause: 'Escape',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Digit5',
  chat: 'KeyT', map: 'KeyM', bigmap: 'KeyK', camera: 'KeyC', emote: 'KeyB', phone: 'KeyP', horn: 'KeyH', admin: 'Digit9', grenade: 'KeyQ',
};
export const BINDING_LABELS = {
  forward: 'Move forward', back: 'Move backward', left: 'Move left', right: 'Move right', sprint: 'Sprint', crouch: 'Crouch',
  jump: 'Jump / handbrake', interact: 'Interact / talk', talk: 'Push-to-talk (voice)', vehicle: 'Enter / exit vehicle', reload: 'Reload',
  drop: 'Drop weapon / context', inventory: 'Inventory / player list', pause: 'Pause menu', slot1: 'Weapon slot 1', slot2: 'Weapon slot 2',
  slot3: 'Weapon slot 3', slot4: 'Weapon slot 4', slot5: 'Weapon slot 5', chat: 'Text chat', map: 'Map', camera: 'Toggle 1st / 3rd person',
  emote: 'Emote / special move', phone: 'Jobs & activities menu', horn: 'Horn / siren', bigmap: 'Detailed map (zoom/pan)', admin: 'Admin / debug menu',
  grenade: 'Throw grenade',
};
const DEFAULTS = {
  'player.name': '',
  'player.character': 'max',
  'graphics.quality': 'high',
  'graphics.fov': 70,
  'graphics.shadows': true,
  'graphics.post': true,
  'audio.master': 0.8, 'audio.music': 0.4, 'audio.sfx': 0.8, 'audio.voice': 1.0, 'audio.ambient': 0.6,
  'controls.sensitivity': 1.0, 'controls.invertY': false,
  'controls.bindings': DEFAULT_BINDINGS,
  'voice.enabled': true,
  'ai.responseLength': 'short',
  'server.url': '',
  'camera.mode': 'third',
};

export class Settings {
  constructor() {
    this.data = { ...DEFAULTS };
    this.listeners = new Set();
    try {
      const saved = JSON.parse(localStorage.getItem('bayview.settings') || '{}');
      Object.assign(this.data, saved);
      this.data['controls.bindings'] = { ...DEFAULT_BINDINGS, ...(saved['controls.bindings'] || {}) };
    } catch { /* ignore */ }
    if (!this.data['graphics.quality'] || this.data['graphics.quality'] === 'auto') this.data['graphics.quality'] = 'high';
    const q = new URLSearchParams(location.search).get('quality');
    if (q) this.data['graphics.quality'] = q;
  }
  get(k) { return this.data[k]; }
  set(k, v) {
    this.data[k] = v;
    this.save();
    for (const l of this.listeners) l(k, v);
  }
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  save() { try { localStorage.setItem('bayview.settings', JSON.stringify(this.data)); } catch { /* ignore */ } }
  binding(action) { return this.data['controls.bindings'][action]; }
  resetBindings() { this.set('controls.bindings', { ...DEFAULT_BINDINGS }); }
}
