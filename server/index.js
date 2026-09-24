// Bayview game server: static hosting of the built client + authoritative WebSocket game server.
//   node server/index.js           (PORT, GEMINI_API_KEY, FIREBASE_SERVICE_ACCOUNT, ALLOWED_ORIGINS in env / .env)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createStore, freshProfile } from './store.js';
import { geminiGenerate, geminiStatus } from './gemini.js';
import { RoomManager } from './rooms.js';

loadDotEnv();
const PORT = +process.env.PORT || 8787;
const ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const DIST = path.resolve('dist');

function loadDotEnv() {
  for (const f of ['.env', '.env.local']) {
    try {
      for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch { /* no file */ }
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const store = await createStore();
const rooms = new RoomManager(store);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const cors = () => {
    const o = req.headers.origin;
    if (o && (ORIGINS.length === 0 || ORIGINS.includes(o))) res.setHeader('Access-Control-Allow-Origin', o);
  };
  if (url.pathname === '/api/health') {
    cors();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: rooms.clients.size, rooms: rooms.rooms.size, store: store.kind, ai: geminiStatus().serverKey }));
    return;
  }
  if (url.pathname === '/api/rooms') {
    cors();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rooms.publicList()));
    return;
  }
  // Static files (production build)
  let p = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!p.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(DIST, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Bayview game server is running. Build the client (npm run build) to serve it from here, or run the Vite dev server.'); return; }
  const ext = path.extname(p);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
  fs.createReadStream(p).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  const origin = req.headers.origin;
  if (ORIGINS.length && origin && !ORIGINS.includes(origin)) { ws.close(1008, 'origin not allowed'); return; }
  let client = null;
  let msgBudget = 60, lastRefill = Date.now();
  ws.on('message', async (raw) => {
    // simple flood protection: ~60 msgs/sec
    const now = Date.now();
    msgBudget = Math.min(90, msgBudget + ((now - lastRefill) / 1000) * 60); lastRefill = now;
    if (msgBudget < 1) return;
    msgBudget--;
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    if (!client) {
      if (m.t !== 'hello') return;
      client = await hello(ws, m);
      return;
    }
    try {
      if (m.t === 'req') {
        const data = await handleRequest(client, m.op, m.data || {});
        ws.readyState === 1 && ws.send(JSON.stringify({ t: 'res', id: m.id, data }));
      } else rooms.handleMessage(client, m);
    } catch (e) {
      console.error('[server] handler error', m.t, m.op, e);
      if (m.t === 'req') ws.readyState === 1 && ws.send(JSON.stringify({ t: 'res', id: m.id, data: { ok: false, error: 'server error' } }));
    }
  });
  ws.on('close', () => { if (client) rooms.disconnect(client); });
  ws.on('error', () => {});
});

async function hello(ws, m) {
  let token = typeof m.token === 'string' && m.token.length > 20 ? m.token : null;
  let id = token ? await store.idForToken(token) : null;
  if (!id) {
    id = 'p_' + crypto.randomBytes(6).toString('hex');
    token = crypto.randomBytes(24).toString('base64url');
    await store.bindToken(token, id);
  }
  let profile = await store.loadProfile(id);
  if (!profile) { profile = freshProfile(); await store.saveProfile(id, profile); }
  const client = rooms.connect(ws, { id, name: m.name, character: m.character, profile });
  ws.send(JSON.stringify({ t: 'welcome', id, token, profile, ai: geminiStatus() }));
  return client;
}

async function handleRequest(c, op, d) {
  switch (op) {
    case 'aiStatus': return { ok: true, ...geminiStatus() };
    case 'ai': return geminiGenerate(c.id, d);
    default: return rooms.request(c, op, d);
  }
}

server.listen(PORT, () => console.log(`[server] Bayview listening on :${PORT} (ws path /ws) — AI ${geminiStatus().serverKey ? 'enabled' : 'disabled (no GEMINI_API_KEY)'}`));
const shutdown = () => { rooms.saveAll(); store.flush?.(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
