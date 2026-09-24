// WebSocket client for the Bayview game server. Handles identity, rooms, snapshots,
// request/response calls and reconnection. When the server is unreachable the game
// runs in solo mode and `request()` is answered by the local backend.
export class Network {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.connected = false;
    this.id = null;
    this.room = null;
    this.handlers = new Map();
    this.pending = new Map();
    this.reqId = 1;
    this.token = localStorage.getItem('bayview.token') || null;
    this.serverUrl = '';
    this.reconnectTimer = null;
    this.wantRoom = null;
    this.ping = 0;
    this.local = null; // LocalBackend (set by Game)
  }

  resolveUrl() {
    const s = this.game.settings.get('server.url');
    if (s) return s.replace(/^http/, 'ws');
    const env = import.meta.env?.VITE_SERVER_URL;
    if (env) return env.replace(/^http/, 'ws');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Vite dev server runs on 5173; the game server on 8787
    if (location.port === '5173' || location.port === '4173') return `${proto}//${location.hostname}:8787/ws`;
    return `${proto}//${location.host}/ws`;
  }

  connect(force = false) {
    if (this.connected && !force) return Promise.resolve(true);
    if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch { /* ignore */ } }
    const url = this.resolveUrl();
    this.serverUrl = url.replace(/^wss?:\/\//, '').replace(/\/ws$/, '');
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      let ws;
      try { ws = new WebSocket(url); } catch { finish(false); return; }
      this.ws = ws;
      const to = setTimeout(() => { if (!this.connected) { try { ws.close(); } catch { /* ignore */ } finish(false); } }, 4000);
      ws.onopen = () => {
        this.sendRaw({ t: 'hello', token: this.token, name: this.game.settings.get('player.name') || 'Player', character: this.game.settings.get('player.character'), v: 1 });
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') {
          clearTimeout(to);
          this.connected = true;
          this.id = m.id;
          this.token = m.token;
          localStorage.setItem('bayview.token', m.token);
          this.emit('welcome', m);
          finish(true);
          // resume room after reconnect
          if (this.wantRoom && !this.room) this.request('joinRoom', { code: this.wantRoom }).then((r) => r.ok && this.emit('rejoined', r));
          return;
        }
        if (m.t === 'res') {
          const p = this.pending.get(m.id);
          if (p) { this.pending.delete(m.id); p(m.data); }
          return;
        }
        if (m.t === 'pong') { this.ping = performance.now() - m.c; return; }
        this.emit(m.t, m);
      };
      ws.onclose = () => {
        clearTimeout(to);
        const was = this.connected;
        this.connected = false;
        for (const p of this.pending.values()) p({ ok: false, error: 'disconnected' });
        this.pending.clear();
        if (this.room) this.wantRoom = this.room.code;
        this.room = null;
        if (was) this.emit('disconnected', {});
        finish(false);
        if (was) this.scheduleReconnect();
      };
      ws.onerror = () => { /* onclose handles it */ };
    });
  }
  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    let delay = 1500;
    const tryIt = async () => {
      const ok = await this.connect(true);
      if (!ok) { delay = Math.min(15000, delay * 1.6); this.reconnectTimer = setTimeout(tryIt, delay); }
      else this.emit('reconnected', {});
    };
    this.reconnectTimer = setTimeout(tryIt, delay);
  }

  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); return () => this.handlers.get(type).delete(fn); }
  emit(type, m) { const hs = this.handlers.get(type); if (hs) for (const f of hs) { try { f(m); } catch (e) { console.error('handler', type, e); } } }
  sendRaw(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  send(t, data = {}) { if (this.connected) this.sendRaw({ t, ...data }); }
  /** Request with response. Falls back to the local backend when offline. */
  request(t, data = {}, timeout = 12000) {
    if (!this.connected) return this.local ? this.local.handle(t, data) : Promise.resolve({ ok: false, error: 'offline' });
    const id = this.reqId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.sendRaw({ t: 'req', id, op: t, data });
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolve({ ok: false, error: 'timeout' }); } }, timeout);
    });
  }
  async listRooms() { const r = await this.request('listRooms'); return r.ok ? r.rooms : []; }
  updateProfile() { this.send('profile', { name: this.game.settings.get('player.name'), character: this.game.settings.get('player.character') }); }
  measurePing() { this.send('ping', { c: performance.now() }); }
}
