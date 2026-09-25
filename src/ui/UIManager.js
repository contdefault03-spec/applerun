import { h, keyLabel } from './dom.js';
import { PLAYABLE, PLAYABLE_BY_ID } from '../characters/defs.js';
import { BINDING_LABELS } from '../core/Settings.js';

// Screens, modals and notifications. Every button here is wired to real game functionality.
export class UIManager {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.layers = {};
    this.modalStack = [];
  }
  get settings() { return this.game.settings; }
  click() { this.game.audio.ui('click'); }

  // ------------------------------------------------------------ loading
  showLoading() {
    this.loading = h('div#loading', h('div.logo', 'BAYVIEW'), h('div.sub', 'Multiplayer Open World'), h('div.bar', h('i')), h('div.msg', 'Loading…'), h('div.err'));
    document.body.append(this.loading);
  }
  setLoading(p, msg) {
    if (!this.loading) return;
    if (p !== null) this.loading.querySelector('.bar i').style.width = `${Math.round(p * 100)}%`;
    if (msg) this.loading.querySelector('.msg').textContent = msg;
  }
  loadingError(msg) { if (this.loading) this.loading.querySelector('.err').textContent = msg; }
  hideLoading() { this.loading?.remove(); this.loading = null; }

  // ------------------------------------------------------------ layers
  setLayer(name, el) {
    this.layers[name]?.remove();
    if (el) { this.layers[name] = el; this.root.append(el); } else delete this.layers[name];
    return el;
  }
  clearMenus() { for (const k of ['menu', 'chars', 'modal']) this.setLayer(k, null); this.modalStack = []; }

  // ------------------------------------------------------------ main menu
  showMainMenu() {
    this.clearMenus();
    const g = this.game;
    const net = g.net;
    const item = (label, sub, fn) => h('button.menu-btn', { onclick: () => { this.click(); fn(); }, onmouseenter: () => g.audio.ui('hover') }, label, sub ? h('small', sub) : null);
    const status = h('div', h('span.status-dot' + (net.connected ? '.on' : '.off')), net.connected ? `Online · ${net.serverUrl}` : 'Game server offline — solo mode available');
    const def = PLAYABLE_BY_ID[this.settings.get('player.character')] || PLAYABLE[0];
    const el = h('div.screen',
      h('div.menu-left',
        h('div.logo', 'BAYVIEW'),
        h('div.tagline', 'Multiplayer open-world sandbox'),
        item('Play', 'Free roam with friends', () => g.quickPlay()),
        item('Character', def.name, () => this.showCharacterSelect(() => this.showMainMenu())),
        item('Multiplayer', 'Rooms · codes · browser', () => this.showMultiplayer()),
        item('Activities', 'CS · football · basketball · wrestling', () => this.showActivities()),
        item('Settings', '', () => this.showSettings()),
        item('Controls', '', () => this.showControls()),
        item('Credits', '', () => this.showCredits()),
        h('div.menu-foot',
          status,
          h('div', `Playing as `, h('b', this.settings.get('player.name') || '—'), ' · ', h('a', { href: '#', style: { color: 'var(--accent2)' }, onclick: (e) => { e.preventDefault(); this.askName(() => this.showMainMenu()); } }, 'change name')),
          h('div', 'Tip: invite friends with a room code or share this page link.'),
        ),
      ),
    );
    this.setLayer('menu', el);
  }

  askName(done) {
    const input = h('input.input', { maxLength: 18, value: this.settings.get('player.name') || '', placeholder: 'Your name' });
    const go = () => {
      const v = input.value.trim().replace(/[^\w .\-]/g, '').slice(0, 18);
      if (!v) { input.focus(); return; }
      this.settings.set('player.name', v);
      this.game.net.updateProfile?.();
      this.closeModal();
      done?.();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    this.modal('Who are you?', h('div', h('p.muted', 'Pick a display name. Other players see it above your head.'), input, h('div.row', { style: { marginTop: '16px' } }, h('div.spacer'), h('button.btn.primary', { onclick: go }, 'Continue'))), { closable: !!this.settings.get('player.name') });
    setTimeout(() => input.focus(), 50);
  }

  // ------------------------------------------------------------ character select
  showCharacterSelect(onDone, { confirmLabel = 'Select' } = {}) {
    this.clearMenus();
    const g = this.game;
    let sel = this.settings.get('player.character');
    if (!PLAYABLE_BY_ID[sel]) sel = 'max';
    g.showroom.show(sel);
    g.setMode('showroom');
    const info = h('div.char-info');
    const renderInfo = () => {
      const d = PLAYABLE_BY_ID[sel];
      info.replaceChildren(
        h('div.tag', { style: { background: d.accent, color: '#111', alignSelf: 'flex-start' } }, 'Playable'),
        h('div.name', d.name),
        h('div', { style: { fontWeight: 800, color: d.accent, margin: '6px 0 10px' } }, d.tagline),
        h('p', d.description),
        ...Object.entries(d.stats).map(([k, v]) => h('div.stat', h('div.t', h('span', k), h('span', Math.round(v * 100))), h('div.b', h('i', { style: { width: `${Math.min(100, v * 70)}%` } })))),
        h('div.row', { style: { marginTop: '20px' } },
          h('button.btn', { onclick: () => { this.click(); g.setMode('menu'); onDone?.(false); } }, 'Back'),
          h('div.spacer'),
          h('button.btn.primary', { onclick: () => { this.click(); this.settings.set('player.character', sel); g.onCharacterChanged(sel); g.setMode('menu'); onDone?.(true); } }, confirmLabel),
        ),
      );
    };
    const cards = PLAYABLE.map((d) => h('div.char-card' + (d.id === sel ? '.on' : ''), {
      onclick: (e) => { sel = d.id; g.showroom.show(sel); g.audio.ui('click'); list.querySelectorAll('.char-card').forEach((c) => c.classList.remove('on')); e.currentTarget.classList.add('on'); renderInfo(); },
    }, h('div.sw', { style: { background: d.accent } }, d.name[0]), h('div', h('b', d.name), h('span', d.tagline))));
    const list = h('div.char-list', h('h2', 'Choose your character'), ...cards);
    const el = h('div.char-screen', list, h('div', { style: { pointerEvents: 'none' } }), info);
    renderInfo();
    this.setLayer('chars', el);
  }

  // ------------------------------------------------------------ modals
  modal(title, body, { closable = true, onClose, wide = false } = {}) {
    const box = h('div.panel.modal', { style: wide ? { width: 'min(1000px, 96vw)' } : {} },
      closable ? h('button.btn.small.close', { onclick: () => { this.click(); this.closeModal(); onClose?.(); } }, '✕ Close') : null,
      h('h2', title), body);
    const wrap = h('div.modal-wrap', box);
    this.modalStack.push({ wrap, onClose });
    this.root.append(wrap);
    this.game.input.enabled = false;
    return box;
  }
  closeModal() {
    const m = this.modalStack.pop();
    m?.wrap.remove();
    if (!this.modalStack.length) this.game.input.enabled = true;
  }
  closeAllModals() { while (this.modalStack.length) this.closeModal(); }
  get modalOpen() { return this.modalStack.length > 0; }

  // ------------------------------------------------------------ settings
  showSettings(tab = 'graphics') {
    const s = this.settings;
    const body = h('div');
    const tabs = ['graphics', 'audio', 'controls', 'ai', 'multiplayer'];
    const names = { graphics: 'Graphics', audio: 'Audio', controls: 'Controls', ai: 'Gemini AI', multiplayer: 'Multiplayer' };
    const tabBar = h('div.tabs', ...tabs.map((t) => h('button' + (t === tab ? '.on' : ''), { onclick: () => { this.closeModal(); this.showSettings(t); } }, names[t])));
    const slider = (key, label, min, max, step) => {
      const val = h('span.muted', String(s.get(key)));
      return h('div', h('label.lbl', label, ' ', val), h('input', { type: 'range', min, max, step, value: s.get(key), oninput: (e) => { s.set(key, +e.target.value); val.textContent = e.target.value; } }));
    };
    const check = (key, label) => h('label.row', { style: { marginTop: '12px', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: !!s.get(key), onchange: (e) => s.set(key, e.target.checked) }), label);
    if (tab === 'graphics') {
      body.append(
        h('label.lbl', 'Quality preset (applies after reload)'),
        h('select.input', { onchange: (e) => { s.set('graphics.quality', e.target.value); this.notify('Quality changes apply after reloading the page.', 'info'); } },
          ...['low', 'medium', 'high'].map((q) => h('option', { value: q, selected: s.get('graphics.quality') === q }, q[0].toUpperCase() + q.slice(1)))),
        slider('graphics.fov', 'Field of view', 55, 100, 1),
        h('label.lbl', 'Time of day'),
        h('div.row', ...[['Morning', 8], ['Noon', 13], ['Sunset', 18.6], ['Night', 22.5]].map(([n, t]) => h('button.btn.small', { onclick: () => { this.game.world?.env.setTime(t); this.game.net.send?.('setTime', { t }); } }, n))),
        check('camera.first', 'Start in first-person view'),
        h('p.muted', { style: { fontSize: '13px' } }, `Current FPS: ${Math.round(this.game.engine.fps)}`),
      );
    } else if (tab === 'audio') {
      body.append(slider('audio.master', 'Master', 0, 1, 0.05), slider('audio.music', 'Music', 0, 1, 0.05), slider('audio.sfx', 'Sound effects', 0, 1, 0.05), slider('audio.voice', 'Voice chat', 0, 1.5, 0.05), slider('audio.ambient', 'Ambience', 0, 1, 0.05), check('voice.enabled', 'Enable proximity voice chat (push-to-talk)'));
    } else if (tab === 'controls') {
      body.append(slider('controls.sensitivity', 'Mouse sensitivity', 0.2, 3, 0.05), check('controls.invertY', 'Invert mouse Y'), h('div', { style: { marginTop: '14px' } }, h('button.btn', { onclick: () => { this.closeModal(); this.showControls(); } }, 'Edit key bindings…')));
    } else if (tab === 'ai') {
      body.append(this.aiSettings());
    } else if (tab === 'multiplayer') {
      const url = h('input.input', { value: s.get('server.url') || '', placeholder: 'auto (same host) — e.g. wss://my-bayview-server.onrender.com' });
      body.append(
        h('label.lbl', 'Game server URL'), url,
        h('p.muted', { style: { fontSize: '13px' } }, 'Leave empty to use the server that served this page (or the one configured at build time). Multiplayer, voice chat, AI NPCs and server-validated economy all go through this server.'),
        h('div.row', h('span.status-dot' + (this.game.net.connected ? '.on' : '.off')), this.game.net.connected ? `Connected (${this.game.net.serverUrl})` : 'Not connected', h('div.spacer'),
          h('button.btn', { onclick: async () => { s.set('server.url', url.value.trim()); const ok = await this.game.net.connect(true); this.notify(ok ? 'Connected to game server' : 'Could not reach the game server', ok ? 'good' : 'bad'); this.closeModal(); this.showSettings('multiplayer'); } }, 'Save & reconnect')),
      );
    }
    this.modal('Settings', h('div', tabBar, body));
  }

  aiSettings() {
    const g = this.game;
    const st = h('div', 'Checking…');
    const refresh = async () => {
      const r = await g.ai.status();
      st.replaceChildren(
        h('div.row', h('span.status-dot' + (r.ready ? '.on' : '.off')), h('b', r.ready ? 'Gemini connected' : 'Gemini not configured'), h('span.muted', `· ${r.detail}`)),
      );
    };
    refresh();
    const keyIn = h('input.input', { type: 'password', placeholder: g.ai.hasLocalKey() ? '•••••••• (saved in this browser)' : 'Paste your Gemini API key', autocomplete: 'off' });
    const model = h('select.input', { onchange: (e) => g.ai.setModel(e.target.value) }, ...['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'].map((m) => h('option', { value: m, selected: g.ai.model === m }, m)));
    const len = h('select.input', { onchange: (e) => this.settings.set('ai.responseLength', e.target.value) }, ...['short', 'medium', 'long'].map((m) => h('option', { value: m, selected: this.settings.get('ai.responseLength') === m }, m)));
    return h('div',
      h('p.muted', { style: { fontSize: '13px', lineHeight: 1.55 } }, 'NPC conversations use Google Gemini. The recommended setup is a key stored on the game server (GEMINI_API_KEY environment variable) — it never reaches any browser. You can also use your own key: it is kept only in this browser and sent over the encrypted game connection to the server proxy for your requests only; it is never stored on the server or shown to other players.'),
      st,
      h('label.lbl', 'Your own API key (optional)'), keyIn,
      h('div.row', { style: { marginTop: '10px' } },
        h('button.btn.primary', { onclick: async () => { if (keyIn.value.trim()) g.ai.setLocalKey(keyIn.value.trim()); keyIn.value = ''; st.textContent = 'Testing…'; const r = await g.ai.test(); this.notify(r.ok ? 'Gemini connection works!' : `Gemini test failed: ${r.error}`, r.ok ? 'good' : 'bad'); refresh(); } }, 'Save & test connection'),
        h('button.btn.danger', { onclick: () => { g.ai.setLocalKey(''); this.notify('Local key removed', 'info'); refresh(); } }, 'Remove my key'),
      ),
      h('label.lbl', 'Model'), model,
      h('label.lbl', 'NPC response length'), len,
      h('p.muted', { style: { fontSize: '12px' } }, 'If Gemini is unavailable, NPCs fall back to built-in dialogue so the world keeps working.'),
    );
  }

  showControls() {
    const s = this.settings;
    const b = s.get('controls.bindings');
    const rows = Object.keys(BINDING_LABELS).map((action) => {
      const btn = h('button.btn.small', {
        onclick: () => {
          btn.textContent = 'Press a key…';
          const handler = (e) => {
            e.preventDefault(); e.stopPropagation();
            window.removeEventListener('keydown', handler, true);
            if (e.code === 'Escape' && action !== 'pause') { btn.textContent = keyLabel(s.binding(action)); return; }
            const nb = { ...s.get('controls.bindings'), [action]: e.code };
            s.set('controls.bindings', nb);
            btn.textContent = keyLabel(e.code);
          };
          window.addEventListener('keydown', handler, true);
        },
      }, keyLabel(b[action]));
      return h('tr', h('td', BINDING_LABELS[action]), h('td', { style: { textAlign: 'right' } }, btn));
    });
    this.modal('Controls', h('div',
      h('p.muted', 'Click a binding, then press the new key. Mouse: look · Left click: attack / shoot / pass · Right click: aim / shoot (sports) · Wheel: switch weapon.'),
      h('table.kb-table', ...rows),
      h('h3', 'Vehicles'), h('p.muted', 'W accelerate · S brake/reverse · A/D steer · Space handbrake · Shift boost · H horn/siren · F exit'),
      h('h3', 'Football'), h('p.muted', 'Left click pass (hold = stronger) · Right click shoot (hold = power) · Shift sprint · E tackle · Space switch player'),
      h('h3', 'Basketball'), h('p.muted', 'Hold & release right click to shoot (timing meter) · Left click pass · E steal / block · Space jump'),
      h('h3', 'Wrestling'), h('p.muted', 'Left click punch · R kick · E grapple (then left = throw, right = slam, R = suplex) · Q/right click reversal · Space pin a downed opponent'),
      h('div.row', { style: { marginTop: '14px' } }, h('button.btn', { onclick: () => { s.resetBindings(); this.closeModal(); this.showControls(); } }, 'Reset to defaults')),
    ));
  }

  showCredits() {
    this.modal('Credits', h('div', { style: { lineHeight: 1.7 } },
      h('p', h('b', 'Bayview'), ' — an original multiplayer open-world sandbox.'),
      h('p.muted', 'Characters: Max (supplied scan, auto-rigged in-engine), HumanModels.glb (supplied rigged man & woman) used as the base for Ajan, Rize, Masked, Lucky, Dex, Nova and every NPC. Audio: supplied ajan.mp3 + procedurally synthesised effects. Video: supplied rize_did_it.mp4. City layout recreated from the supplied map.'),
      h('p.muted', 'Tech: Three.js, Vite, Node.js WebSocket game server, WebRTC voice, Google Gemini, optional Firebase persistence.'),
    ));
  }

  // ------------------------------------------------------------ multiplayer
  showMultiplayer() {
    const g = this.game;
    const net = g.net;
    if (!net.connected) {
      this.modal('Multiplayer', h('div',
        h('p', 'The game server is not reachable, so multiplayer is unavailable right now.'),
        h('p.muted', 'Solo free roam still works. To play with friends, run the game server (npm start) or set its URL in Settings → Multiplayer.'),
        h('div.row', h('button.btn', { onclick: async () => { const ok = await net.connect(true); this.closeModal(); if (ok) this.showMultiplayer(); else this.notify('Still offline', 'bad'); } }, 'Retry'), h('button.btn', { onclick: () => { this.closeModal(); this.showSettings('multiplayer'); } }, 'Server settings')),
      ));
      return;
    }
    const code = h('input.input', { placeholder: 'ROOM CODE', maxLength: 6, style: { textTransform: 'uppercase', fontSize: '22px', letterSpacing: '.3em', textAlign: 'center' } });
    const list = h('div.list', h('div.muted', 'Loading public rooms…'));
    const refresh = async () => {
      const rooms = await net.listRooms();
      list.replaceChildren(...(rooms.length ? rooms.map((r) => h('div.item',
        h('div', h('b', r.name), h('div.muted', { style: { fontSize: '12px' } }, `${r.kind === 'world' ? 'Free roam' : r.mode} · ${r.players}/${r.max} players · code ${r.code}`)),
        h('div.spacer'), h('button.btn.small.primary', { disabled: r.players >= r.max, onclick: () => { this.closeModal(); g.joinRoom(r.code); } }, 'Join'))) : [h('div.muted', 'No public rooms yet — create one!')]));
    };
    refresh();
    const priv = h('input', { type: 'checkbox', checked: true });
    this.modal('Multiplayer', h('div',
      h('h3', 'Join with a code'),
      h('div.row', code, h('button.btn.primary', { onclick: () => { const c = code.value.trim().toUpperCase(); if (c.length < 4) return; this.closeModal(); g.joinRoom(c); } }, 'Join')),
      h('h3', 'Create a free-roam world'),
      h('div.row', h('label.row', priv, 'Private (invite with code)'), h('div.spacer'), h('button.btn.primary', { onclick: () => { this.closeModal(); g.createRoom({ kind: 'world', private: priv.checked }); } }, 'Create room')),
      h('h3.row', 'Public server browser'),
      h('div.row', h('div.spacer'), h('button.btn.small', { onclick: refresh }, 'Refresh')),
      list,
    ), { wide: true });
  }

  showActivities() {
    const g = this.game;
    const card = (title, desc, mode, sizes) => h('div.shop-item',
      h('b', title), h('div.muted', { style: { fontSize: '13px' } }, desc),
      h('div.row', { style: { flexWrap: 'wrap', gap: '6px' } }, ...sizes.map((sz) => h('button.btn.small', { onclick: () => { this.closeModal(); g.createActivity(mode, sz); } }, sz))),
      h('button.btn.small.primary', { onclick: () => { this.closeModal(); g.createActivity(mode, 'solo'); } }, 'Quick play vs AI'),
    );
    this.modal('Activities', h('div',
      h('p.muted', 'Create a private activity room and share the code, or quick-play against AI. Your free-roam character is kept safe while you are in an activity.'),
      h('div.shop-grid',
        card('Gunfight (CS-style)', 'Team deathmatch rounds in the industrial district. Buy weapons in the lobby.', 'combat', ['1v1', '2v2', '3v3', '5v5']),
        card('Football', '5-a-side or full squads at Bayview Stadium, AI fills empty spots.', 'football', ['1v1', '3v3', '5v5']),
        card('Basketball', 'Streetball / full court at Bayview Arena with a shot meter.', 'basketball', ['1v1', '2v2', '3v3']),
        card('Wrestling', 'Ridiculous wrestling in the Dome ring. Grapples, slams, pins.', 'wrestling', ['1v1', 'FFA']),
      ),
      h('h3', 'Join an activity with a code'),
      (() => { const i = h('input.input', { placeholder: 'CODE', maxLength: 6, style: { textTransform: 'uppercase' } }); return h('div.row', i, h('button.btn', { onclick: () => { this.closeModal(); g.joinRoom(i.value.trim().toUpperCase()); } }, 'Join')); })(),
    ), { wide: true });
  }

  // ------------------------------------------------------------ pause
  showPause() {
    const g = this.game;
    const room = g.net.room;
    this.modal('Paused', h('div.col',
      room ? h('div.panel', { style: { padding: '12px 14px' } }, h('div.muted', 'Room code'), h('div', { style: { fontFamily: 'var(--display)', fontSize: '44px', letterSpacing: '.2em' } }, room.code), h('div.muted', { style: { fontSize: '12px' } }, `${room.kind === 'world' ? 'Free roam' : room.mode} · ${room.private ? 'private' : 'public'} · share this code with friends`),
        h('button.btn.small', { style: { marginTop: '8px' }, onclick: async (e) => { const url = `${location.origin}${location.pathname}?room=${room.code}`; try { await navigator.clipboard.writeText(url); e.target.textContent = 'Invite link copied!'; } catch { e.target.textContent = url; } } }, 'Copy invite link')) : h('div.muted', 'Solo session (not connected to a room)'),
      h('button.btn.primary', { onclick: () => { this.closeModal(); g.resume(); } }, 'Resume'),
      h('button.btn', { onclick: () => { this.closeModal(); this.showCharacterSelect(() => g.resume(), { confirmLabel: 'Play as this character' }); } }, 'Change character'),
      h('button.btn', { onclick: () => this.showSettings() }, 'Settings'),
      h('button.btn', { onclick: () => this.showControls() }, 'Controls'),
      h('button.btn', { onclick: () => { this.closeModal(); this.showMultiplayer(); } }, 'Multiplayer / rooms'),
      h('button.btn', { onclick: () => { this.closeModal(); this.showActivities(); } }, 'Activities'),
      g.inActivity ? h('button.btn.danger', { onclick: () => { this.closeModal(); g.leaveActivity(); } }, 'Leave activity') : null,
      h('button.btn.danger', { onclick: () => { this.closeModal(); g.toMainMenu(); } }, 'Quit to main menu'),
    ), { onClose: () => g.resume() });
  }

  // ------------------------------------------------------------ phone (jobs, activities, GPS, passive mode)
  showPhone() {
    const g = this.game;
    const v = g.vehicles?.current;
    if (v?.isDriver && (v.type === 'taxi' || v.type === 'ambulance')) return; // P is the job key in those vehicles
    g.suppressPause = true; g.input.unlock();
    const L = g.layout;
    const gps = (label, key, lm) => h('button.btn.small', { onclick: () => { const b = lm ? L.landmarks[key] : L.buildings[L.special[key]]; const p = lm ? b : b.door; g.setWaypoint({ x: p.x, z: p.z }); this.closeModal(); g.input.lock(); } }, label);
    const passive = h('button.btn.small', { onclick: async () => { const r = await g.net.request('setPassive', { on: !g.passive }); if (r.ok) { g.passive = r.passive; this.notify(r.passive ? 'Passive mode ON — players cannot hurt you (and you cannot hurt them).' : 'Passive mode OFF', 'info'); passive.textContent = `Passive mode: ${g.passive ? 'ON' : 'OFF'}`; } else this.notify(r.error || 'Only available online', 'bad'); } }, `Passive mode: ${g.passive ? 'ON' : 'OFF'}`);
    this.modal('Phone', h('div.col',
      h('h3', 'Jobs'),
      h('div.muted', { style: { fontSize: '13px' } }, 'Taxi: get in any taxi (depot marked on the map) and press P. Paramedic: take an ambulance from the hospital and press P. Police duty: sign up at a police station.'),
      h('div.row', { style: { flexWrap: 'wrap' } }, gps('Taxi depot', 'taxi_depot'), gps('Hospital', 'hospital'), gps('Police station', 'police')),
      h('h3', 'GPS'),
      h('div.row', { style: { flexWrap: 'wrap' } }, gps('Gun store (downtown)', 'gunstore1'), gps('Gun store (Eastside)', 'gunstore2'), gps('Safehouse', 'safehouse'), gps('Gym', 'gym'), gps('Garage', 'garage'), gps('Stadium', 'stadium', true), gps('Arena', 'arena', true), gps('Dome', 'dome', true)),
      h('h3', 'Activities & multiplayer'),
      h('div.row', { style: { flexWrap: 'wrap' } }, h('button.btn.small.primary', { onclick: () => { this.closeModal(); this.showActivities(); } }, 'Start an activity'), h('button.btn.small', { onclick: () => { this.closeModal(); this.showMultiplayer(); } }, 'Rooms'), passive),
    ), { onClose: () => g.input.lock() });
  }

  showInventory() {
    const g = this.game;
    g.suppressPause = true; g.input.unlock();
    const p = g.profile;
    const W = g.weapons;
    const players = [...g.mp.remotes.values()];
    this.modal('Inventory', h('div',
      h('div.row', { style: { gap: '24px', flexWrap: 'wrap' } },
        h('div', h('div.muted', 'Cash'), h('div', { style: { fontFamily: 'var(--display)', fontSize: '40px', color: '#7dff9b' } }, `$${p.money.toLocaleString()}`)),
        h('div', h('div.muted', 'Health / Armor'), h('div', { style: { fontSize: '22px', fontWeight: 800 } }, `${Math.round(g.player.health)} / ${Math.round(g.player.armor)}`)),
        h('div', h('div.muted', 'Medkits (key 5)'), h('div', { style: { fontSize: '22px', fontWeight: 800 } }, p.medkits || 0)),
        h('div', h('div.muted', 'Stats'), h('div', { style: { fontSize: '13px' } }, `Kills ${p.stats?.kills || 0} · Deaths ${p.stats?.deaths || 0} · Taxi fares ${p.stats?.taxiRides || 0} · Goals ${p.stats?.goals || 0} · Arrests ${p.stats?.arrests || 0}`)),
      ),
      h('h3', 'Weapons'),
      h('div.list', ...W.owned.map((w) => h('div.item', h('b', W.name(w)), h('span.muted', w === 'fists' ? 'melee' : `${W.mags[w] ?? 0} / ${Math.max(0, W.total(w) - (W.mags[w] ?? 0))}`), h('div.spacer'), h('button.btn.small' + (W.current === w ? '.primary' : ''), { onclick: () => { W.equip(w); this.closeModal(); g.input.lock(); } }, W.current === w ? 'Equipped' : 'Equip')))),
      h('h3', `Players in room ${g.net.room ? g.net.room.code : '(solo)'}`),
      players.length ? h('div.list', ...players.map((r) => h('div.item', h('b', r.avatar.name), h('span.muted', r.avatar.key), r.info.wanted ? h('span.tag.warn', `${r.info.wanted}★`) : null, h('div.spacer'),
        h('button.btn.small', { onclick: (e) => { const m = g.mp.toggleMute(r.id); e.target.textContent = m ? 'Unmute' : 'Mute'; } }, g.mp.muted.has(r.id) ? 'Unmute' : 'Mute'),
        h('button.btn.small', { onclick: () => { g.setWaypoint({ x: r.avatar.position.x, z: r.avatar.position.z }); } }, 'Waypoint')))) : h('div.muted', 'No other players here. Share your room code to invite friends!'),
    ), { onClose: () => g.input.lock() });
  }

  // ------------------------------------------------------------ feedback
  notify(text, kind = '') {
    const box = this.game.hud?.notices || this.root;
    const n = h('div.notice' + (kind ? '.' + kind : ''), text);
    box.append(n);
    if (kind === 'bad') this.game.audio.ui('error'); else this.game.audio.ui('notify');
    setTimeout(() => { n.style.transition = 'opacity .4s'; n.style.opacity = '0'; setTimeout(() => n.remove(), 400); }, 4200);
    while (box.children.length > 6) box.firstChild.remove();
  }
}
