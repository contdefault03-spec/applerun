// Server-side Gemini proxy. The server key (GEMINI_API_KEY) never leaves the server.
// A player may pass their own key per request; it is used for that request only and
// never logged, stored or relayed.
const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
const ALLOWED_MODELS = new Set(['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-3.1-flash-lite']);

export function geminiStatus() {
  return { serverKey: !!process.env.GEMINI_API_KEY, model: DEFAULT_MODEL };
}

const buckets = new Map(); // playerId -> {tokens, last}
function allow(id, perMin = 14) {
  const now = Date.now();
  const b = buckets.get(id) || { tokens: perMin, last: now };
  b.tokens = Math.min(perMin, b.tokens + ((now - b.last) / 60000) * perMin);
  b.last = now;
  if (b.tokens < 1) { buckets.set(id, b); return false; }
  b.tokens -= 1;
  buckets.set(id, b);
  return true;
}

export async function geminiGenerate(playerId, { system, turns, maxTokens = 160, model, userKey }) {
  const key = (typeof userKey === 'string' && userKey.length > 20 && userKey.length < 200) ? userKey : process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, error: 'no-key' };
  if (!allow(playerId)) return { ok: false, error: 'rate-limited', rateLimited: true };
  const m = ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
  const sys = String(system || '').slice(0, 6000);
  const contents = (Array.isArray(turns) ? turns : []).slice(-16).map((t) => ({ role: t.role === 'model' ? 'model' : 'user', parts: [{ text: String(t.text || '').slice(0, 1200) }] }));
  if (!contents.length) return { ok: false, error: 'empty' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sys }] },
        contents,
        generationConfig: { maxOutputTokens: Math.max(16, Math.min(400, maxTokens | 0)), temperature: 0.95 },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: j.error?.message?.slice(0, 200) || `HTTP ${res.status}`, rateLimited: res.status === 429 };
    const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) return { ok: false, error: j.candidates?.[0]?.finishReason || 'empty response' };
    return { ok: true, text: text.slice(0, 1500), model: m };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally { clearTimeout(to); }
}
