// Client side of AI NPC conversations. Preferred path: the game server's Gemini proxy
// (server-held key, or the player's own key forwarded per request). Offline path: the
// player's own key directly from this browser. Last resort: built-in fallback dialogue.
export class AIClient {
  constructor(game) {
    this.game = game;
    this.model = localStorage.getItem('bayview.aiModel') || 'gemini-flash-lite-latest';
    this.cache = new Map();
  }
  hasLocalKey() { return !!localStorage.getItem('bayview.geminiKey'); }
  localKey() { return localStorage.getItem('bayview.geminiKey') || ''; }
  setLocalKey(k) { if (k) localStorage.setItem('bayview.geminiKey', k); else localStorage.removeItem('bayview.geminiKey'); }
  setModel(m) { this.model = m; localStorage.setItem('bayview.aiModel', m); }

  async status() {
    const net = this.game.net;
    if (net.connected) {
      const r = await net.request('aiStatus', {});
      if (r.ok && r.serverKey) return { ready: true, detail: `server key · ${r.model}` };
      if (this.hasLocalKey()) return { ready: true, detail: 'your key via server proxy (not yet tested)' };
      return { ready: false, detail: 'no key on server and none entered here — fallback dialogue active' };
    }
    if (this.hasLocalKey()) return { ready: true, detail: 'offline mode · your key, direct from this browser' };
    return { ready: false, detail: 'offline and no key — fallback dialogue active' };
  }
  async test() {
    const r = await this.generate('You are a test. Reply with the single word OK.', [{ role: 'user', text: 'ping' }], 10);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  /** Low-level generate: system prompt + turns [{role:'user'|'model', text}] */
  async generate(system, turns, maxTokens = 160) {
    const net = this.game.net;
    if (net.connected) {
      const r = await net.request('ai', { system, turns, maxTokens, model: this.model, userKey: this.hasLocalKey() ? this.localKey() : undefined }, 25000);
      return r;
    }
    const key = this.localKey();
    if (!key) return { ok: false, error: 'no-key' };
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: turns.map((t) => ({ role: t.role === 'model' ? 'model' : 'user', parts: [{ text: t.text }] })),
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.95 },
        }),
      });
      const j = await res.json();
      if (!res.ok) return { ok: false, error: j.error?.message || `HTTP ${res.status}`, rateLimited: res.status === 429 };
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
      return text ? { ok: true, text } : { ok: false, error: 'empty response' };
    } catch (e) { return { ok: false, error: e.message }; }
  }
}
