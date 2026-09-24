import { h } from './dom.js';
import { toPx, getLayout, districtAt } from '../../shared/map/layout.js';

// In-game HUD: vitals, money, weapon, wanted level, minimap (drawn from the reference map),
// prompts, notifications, kill feed, activity scoreboard, chat and the full-screen map.
export class HUD {
  constructor(game) {
    this.game = game;
    this.mapImg = new Image();
    this.mapImg.src = game.assets.url('mapReference');
    this.el = h('div#hud',
      h('div#hitflash'),
      this.scope = h('div#scope.hidden'),
      this.cross = h('div#crosshair.dot'),
      this.notices = h('div#notices'),
      this.killfeed = h('div#killfeed'),
      this.big = h('div#bigmsg.hidden', h('div.t'), h('div.s')),
      this.activity = h('div#activity.hidden'),
      this.promptEl = h('div#prompt.hidden'),
      this.voice = h('div#voice-ind.hidden', '🎙 Transmitting (V)'),
      this.job = h('div#job.panel.hidden'),
      this.meter = h('div#shotmeter.hidden', h('div.meter', h('i'), h('b'))),
      this.vehicle = h('div#vehicle-hud.hidden', h('div.spd', '0'), h('div.u', 'KM/H'), h('div.vname.muted')),
      h('div.hud-tr',
        this.money = h('div.hud-money', '$0'),
        this.clock = h('div.hud-clock', '12:00'),
        this.wanted = h('div.wanted', ...[0, 1, 2, 3, 4].map(() => h('span.off', '★'))),
        this.zone = h('div.hud-clock', { style: { color: 'var(--muted)', marginTop: '4px' } }),
      ),
      h('div.hud-bl',
        this.mini = h('canvas#minimap', { width: 440, height: 440 }),
        h('div.bars',
          this.nameEl = h('div.hud-name'),
          h('div.bar.hp', this.hp = h('i', { style: { width: '100%' } })),
          h('div.bar.ar', this.ar = h('i', { style: { width: '0%' } })),
          h('div.bar.st', this.st = h('i', { style: { width: '100%' } })),
          this.roomEl = h('div.muted', { style: { fontSize: '12px', fontWeight: 700, marginTop: '4px' } }),
        ),
      ),
      h('div.hud-br',
        this.wname = h('div.weapon-name', 'Fists'),
        this.ammo = h('div.ammo', ''),
        this.slots = h('div.slots'),
      ),
      this.chat = h('div#chat', this.chatLog = h('div.log')),
    );
    this.el.style.display = 'none';
    document.getElementById('ui').append(this.el);
    this.mctx = this.mini.getContext('2d');
    this.chatInput = null;
    this.bigTimer = 0;
  }
  show(v) { this.el.style.display = v ? '' : 'none'; }

  prompt(text) {
    if (!text) { this.promptEl.classList.add('hidden'); this._prompt = null; return; }
    if (this._prompt !== text) { this.promptEl.innerHTML = text; this._prompt = text; }
    this.promptEl.classList.remove('hidden');
  }
  bigMessage(title, sub = '', dur = 3, color = '#fff') {
    this.big.querySelector('.t').textContent = title;
    this.big.querySelector('.t').style.color = color;
    this.big.querySelector('.s').textContent = sub;
    this.big.classList.remove('hidden');
    this.bigTimer = dur;
  }
  kill(text) {
    const d = h('div', text);
    this.killfeed.prepend(d);
    setTimeout(() => d.remove(), 6000);
    while (this.killfeed.children.length > 5) this.killfeed.lastChild.remove();
  }
  hitFlash(v = 0.8) { const f = this.el.querySelector('#hitflash'); f.style.opacity = String(v); setTimeout(() => (f.style.opacity = '0'), 120); }
  hitMarker() { this.cross.classList.add('hit'); clearTimeout(this._hm); this._hm = setTimeout(() => this.cross.classList.remove('hit'), 150); }
  setActivity(html) { if (!html) this.activity.classList.add('hidden'); else { this.activity.classList.remove('hidden'); if (this._act !== html) { this.activity.innerHTML = html; this._act = html; } } }
  setJob(html) { if (!html) this.job.classList.add('hidden'); else { this.job.classList.remove('hidden'); if (this._job !== html) { this.job.innerHTML = html; this._job = html; } } }
  setMeter(v, target = null) {
    if (v === null) { this.meter.classList.add('hidden'); return; }
    this.meter.classList.remove('hidden');
    this.meter.querySelector('b').style.left = `${Math.max(0, Math.min(1, v)) * 100}%`;
  }

  chatMessage(name, text, sys = false) {
    const d = sys ? h('div.sys', text) : h('div', h('b', name + ': '), text);
    this.chatLog.append(d);
    while (this.chatLog.children.length > 10) this.chatLog.firstChild.remove();
    setTimeout(() => { d.style.transition = 'opacity 1s'; d.style.opacity = '0.0'; }, 20000);
  }
  openChat(onSend) {
    if (this.chatInput) return;
    this.chatLog.querySelectorAll('div').forEach((d) => (d.style.opacity = '1'));
    const i = h('input.input', { maxLength: 160, placeholder: 'Say something… (Enter to send, Esc to cancel)' });
    this.chatInput = i;
    this.chat.append(i);
    this.game.input.enabled = false;
    this.game.input.unlock();
    const close = () => { i.remove(); this.chatInput = null; this.game.input.enabled = true; this.game.input.lock(); };
    i.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = i.value.trim(); if (v) onSend(v); close(); }
      if (e.key === 'Escape') close();
    });
    setTimeout(() => i.focus(), 10);
  }

  update(dt, s) {
    this.hp.style.width = `${Math.max(0, s.health)}%`;
    this.ar.style.width = `${Math.max(0, s.armor)}%`;
    this.st.style.width = `${s.stamina}%`;
    this.money.textContent = '$' + Math.floor(s.money).toLocaleString();
    this.clock.textContent = s.clock;
    this.nameEl.textContent = s.name;
    this.roomEl.textContent = s.room || '';
    const w = s.wanted || 0;
    this.wanted.querySelectorAll('span').forEach((e, i) => (e.className = i < w ? 'on' : 'off'));
    this.wanted.classList.toggle('flash', !!s.wantedFlash);
    this.wanted.style.display = w > 0 ? '' : 'none';
    if (this._zoneT === undefined || (this._zoneT -= dt) < 0) { this._zoneT = 0.5; this.zone.textContent = s.zone || ''; }
    // weapon
    this.wname.textContent = s.weaponName || 'Fists';
    this.ammo.innerHTML = s.ammo != null ? `${s.ammo}<small> / ${s.reserve}</small>` : '';
    const sl = (s.slots || []).map((x, i) => `<div class="${x.active ? 'on' : ''}">${i + 1} ${x.short}</div>`).join('');
    if (this._sl !== sl) { this.slots.innerHTML = sl; this._sl = sl; }
    this.cross.classList.toggle('hidden', !s.crosshair);
    this.cross.classList.toggle('dot', !s.aiming);
    this.scope.classList.toggle('hidden', !s.scoped);
    this.voice.classList.toggle('hidden', !s.talking);
    // vehicle
    if (s.vehicle) {
      this.vehicle.classList.remove('hidden');
      this.vehicle.querySelector('.spd').textContent = Math.round(Math.abs(s.vehicle.speed) * 3.6);
      this.vehicle.querySelector('.vname').textContent = s.vehicle.name;
    } else this.vehicle.classList.add('hidden');
    if (this.bigTimer > 0) { this.bigTimer -= dt; if (this.bigTimer <= 0) this.big.classList.add('hidden'); }
    this.drawMinimap(s);
  }

  drawMinimap(s) {
    const g = this.mctx, W = 440, R = W / 2;
    const [px, py] = toPx(s.x, s.z);
    const zoom = s.inVehicle ? 1.6 : 2.4; // canvas px per map px
    g.save();
    g.fillStyle = '#0d3550'; g.fillRect(0, 0, W, W);
    g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
    g.translate(R, R);
    g.rotate(s.camYaw);
    g.scale(zoom, zoom);
    g.translate(-px, -py);
    if (this.mapImg.complete) g.drawImage(this.mapImg, 0, 0, 995, 1091, 0, 0, 995, 1091);
    // waypoint
    if (s.waypoint) {
      const [wx, wy] = toPx(s.waypoint.x, s.waypoint.z);
      g.strokeStyle = '#ff4fd8'; g.lineWidth = 3 / zoom; g.setLineDash([6 / zoom, 5 / zoom]);
      g.beginPath(); g.moveTo(px, py); g.lineTo(wx, wy); g.stroke(); g.setLineDash([]);
    }
    // blips
    for (const b of s.blips || []) {
      const [bx, by] = toPx(b.x, b.z);
      g.fillStyle = b.color; g.strokeStyle = '#000'; g.lineWidth = 1 / zoom;
      g.beginPath(); g.arc(bx, by, (b.size || 4) / zoom * 2, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.restore();
    // player arrow (map rotates with camera so arrow shows avatar heading relative to camera)
    g.save();
    g.translate(R, R);
    g.rotate(-(s.heading - s.camYaw));
    g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -14); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath(); g.fill(); g.stroke();
    g.restore();
    // north marker
    g.save(); g.translate(R, R); g.rotate(s.camYaw);
    g.fillStyle = '#fff'; g.font = 'bold 26px Arial'; g.textAlign = 'center'; g.fillText('N', 0, -R + 30);
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 4; g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.stroke();
  }

  // Full screen map with click-to-set waypoint
  toggleMap(state) {
    if (this.mapEl) { this.mapEl.remove(); this.mapEl = null; this.game.input.enabled = true; this.game.input.lock(); return; }
    this.game.input.unlock();
    this.game.input.enabled = false;
    const c = h('canvas', { width: 995, height: 1091 });
    const L = getLayout();
    const draw = () => {
      const g = c.getContext('2d');
      g.drawImage(this.mapImg, 0, 0, 995, 1091, 0, 0, 995, 1091);
      const st = this.game.hudState();
      const dot = (x, z, col, r = 7, label) => { const [a, b] = toPx(x, z); g.fillStyle = col; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(a, b, r, 0, 7); g.fill(); g.stroke(); if (label) { g.font = 'bold 14px Arial'; g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeText(label, a + 10, b + 5); g.fillText(label, a + 10, b + 5); } };
      for (const [key, col, label] of [['police', '#4fa3ff', 'Police'], ['police2', '#4fa3ff', 'Police'], ['hospital', '#ff4757', 'Hospital'], ['gunstore1', '#ffc53d', 'Guns'], ['gunstore2', '#ffc53d', 'Guns'], ['gym', '#bbb', 'Gym'], ['taxi_depot', '#ffd23f', 'Taxi'], ['garage', '#00e5ff', 'Garage'], ['safehouse', '#80cbc4', 'Safehouse'], ['clothing', '#c86bff', 'Threads']]) {
        const b = L.buildings[L.special[key]]; if (b) dot(b.door.x, b.door.z, col, 6, label);
      }
      for (const [key, label] of [['stadium', 'Stadium (football)'], ['arena', 'Arena (basketball)'], ['dome', 'Dome (wrestling)']]) { const b = L.landmarks[key]; dot(b.x, b.z, '#3ddc84', 8, label); }
      for (const b of st.blips || []) dot(b.x, b.z, b.color, 6);
      if (st.waypoint) dot(st.waypoint.x, st.waypoint.z, '#ff4fd8', 8, 'Waypoint');
      const [a, b] = toPx(st.x, st.z);
      g.save(); g.translate(a, b); g.rotate(-st.heading); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -12); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.stroke(); g.restore();
    };
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * 995, my = ((e.clientY - r.top) / r.height) * 1091;
      const x = (mx - 500) * 1.2, z = (my - 545) * 1.2;
      this.game.setWaypoint({ x, z });
      draw();
    });
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); this.game.setWaypoint(null); draw(); });
    this.mapEl = h('div#bigmap', h('div.wrap', c), h('div.legend.panel', h('b', 'Bayview City'), h('div.muted', 'Click to set a waypoint · right-click to clear · M to close'), h('div', '● You  ', h('span', { style: { color: '#ff4fd8' } }, '● Waypoint')), h('div', { style: { color: '#4fa3ff' } }, '● Players / police'), h('div', { style: { color: '#3ddc84' } }, '● Activities')));
    document.getElementById('ui').append(this.mapEl);
    draw();
    void districtAt;
  }
}
