// Persistence: Firebase Firestore when FIREBASE_SERVICE_ACCOUNT is configured,
// otherwise a local JSON file (data/store.json). Profiles are keyed by player id;
// session tokens map to player ids.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { newProfile } from '../shared/economy.js';

class FileStore {
  constructor(file) {
    this.file = file;
    this.kind = 'file';
    try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.data = { tokens: {}, profiles: {} }; }
    this.dirty = false;
    setInterval(() => this.flush(), 5000).unref();
  }
  async init() {}
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data));
    fs.renameSync(this.file + '.tmp', this.file);
  }
  async idForToken(token) { return this.data.tokens[hash(token)] || null; }
  async bindToken(token, id) { this.data.tokens[hash(token)] = id; this.dirty = true; }
  async loadProfile(id) { return this.data.profiles[id] || null; }
  async saveProfile(id, p) { this.data.profiles[id] = p; this.dirty = true; }
}

class FirestoreStore {
  constructor(admin) { this.admin = admin; this.kind = 'firestore'; this.db = admin.firestore(); this.cache = new Map(); this.pending = new Map(); setInterval(() => this.flush(), 5000).unref(); }
  async init() {}
  async idForToken(token) { const d = await this.db.collection('tokens').doc(hash(token)).get(); return d.exists ? d.data().id : null; }
  async bindToken(token, id) { await this.db.collection('tokens').doc(hash(token)).set({ id, at: Date.now() }); }
  async loadProfile(id) { const d = await this.db.collection('profiles').doc(id).get(); return d.exists ? d.data() : null; }
  async saveProfile(id, p) { this.pending.set(id, JSON.parse(JSON.stringify(p))); }
  async flush() {
    const batch = [...this.pending.entries()];
    this.pending.clear();
    for (const [id, p] of batch) { try { await this.db.collection('profiles').doc(id).set(p); } catch (e) { console.error('[store] firestore save failed', e.message); } }
  }
}

const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 40);

export async function createStore() {
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (sa) {
    try {
      const admin = (await import('firebase-admin')).default;
      const cred = sa.trim().startsWith('{') ? JSON.parse(sa) : JSON.parse(fs.readFileSync(sa, 'utf8'));
      if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(cred) });
      const s = new FirestoreStore(admin);
      await s.init();
      console.log('[store] using Firebase Firestore');
      return s;
    } catch (e) {
      console.error('[store] Firebase init failed, falling back to file store:', e.message);
    }
  }
  const file = process.env.DATA_FILE || path.resolve('data/store.json');
  console.log('[store] using file store at', file);
  return new FileStore(file);
}

export function freshProfile() { return newProfile(); }
