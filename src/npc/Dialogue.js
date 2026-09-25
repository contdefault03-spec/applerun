import { h } from '../ui/dom.js';
import { districtAt } from '../../shared/map/layout.js';
import { PLAYABLE_BY_ID } from '../characters/defs.js';

// AI-powered NPC conversations: builds a concise, observation-limited context for the
// NPC, keeps short conversation history, persists memory facts, and falls back to
// built-in lines when Gemini is unavailable.
const LOOKS = {
  max: 'a long-haired guy in a black tee and jeans',
  ajan: 'a fat gorilla wearing a grey tech fleece (yes, an actual gorilla)',
  rize: 'a bored-looking teenager with a cloud of fluffy hair and a green hoodie',
  masked: 'a very tall, lean, jacked man in a black ski mask wearing a "JackedXhan" shirt',
  lucky: 'a short, silly-looking guy wearing a cute rainbow umbrella hat',
  dex: 'a guy in a navy bomber jacket and a red cap',
  nova: 'a woman with a purple ponytail in racing gear',
};

export class Dialogue {
  constructor(game) {
    this.game = game;
    this.npc = null;
    this.history = [];
    this.events = []; // recent world events for NPC awareness {t, pos, text}
    this.busy = false;
  }
  logEvent(pos, text) {
    this.events.push({ t: performance.now(), pos: pos.clone ? pos.clone() : pos, text });
    if (this.events.length > 30) this.events.shift();
  }

  async open(npc) {
    const g = this.game;
    if (this.npc) this.close();
    this.npc = npc;
    npc.talkingTo = g.avatar;
    npc.prevState = npc.state === 'sit' || npc.state === 'lie' ? npc.state : null;
    if (!npc.prevState) npc.state = 'talkPlayer';
    this.history = [];
    g.suppressPause = true;
    g.input.unlock();
    g.input.enabled = false;
    const p = npc.persona;
    this.linesEl = h('div.lines');
    this.input = h('input.input', { placeholder: `Say something to ${p.short}… (Enter to send)`, maxLength: 240 });
    this.status = h('span.muted', { style: { fontSize: '12px' } });
    const mic = (window.SpeechRecognition || window.webkitSpeechRecognition) ? h('button.btn.small', { title: 'Voice input', onclick: () => this.listen() }, '🎤') : null;
    this.el = h('div#dialogue.panel',
      h('div.who', h('b', p.name), h('span.muted', `${p.job} · ${p.trait}`), h('div.spacer'), this.status),
      this.linesEl,
      h('div.row', this.input, mic, h('button.btn.small.primary', { onclick: () => this.send() }, 'Send'), h('button.btn.small', { onclick: () => this.close() }, 'Leave (Esc)')),
    );
    document.getElementById('ui').append(this.el);
    this.input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.send(); if (e.key === 'Escape') this.close(); });
    setTimeout(() => this.input?.focus(), 30);
    // memory + greeting (no API call until the player speaks)
    const mem = await g.net.request('npcMemory', { npc: npc.identity });
    this.memory = (mem.ok && mem.memory) || { facts: [], rel: 0, met: 0 };
    if (!this.npc) return;
    const greet = this.memory.met ? (this.memory.rel < 0 ? `Oh great, you again, ${g.settings.get('player.name')}.` : `Hey, ${g.settings.get('player.name')}! Good to see you again.`) : npc.memoryHint ? npc.fallbackLine() : greeting(npc);
    this.addLine('npc', greet);
    this.history.push({ role: 'model', text: greet });
    const st = await g.ai.status();
    this.status.textContent = st.ready ? 'AI conversation' : 'offline dialogue';
    this.aiReady = st.ready;
  }

  addLine(who, text) {
    if (!this.linesEl) return;
    this.linesEl.append(h('div.line.' + who, text));
    this.linesEl.scrollTop = 1e6;
  }

  async send() {
    const g = this.game;
    const text = this.input.value.trim();
    if (!text || this.busy || !this.npc) return;
    this.input.value = '';
    this.addLine('me', text);
    this.history.push({ role: 'user', text });
    this.busy = true;
    const typing = h('div.typing', `${this.npc.persona.short} is thinking…`);
    this.linesEl.append(typing);
    const npc = this.npc;
    const len = g.settings.get('ai.responseLength');
    const maxTokens = len === 'long' ? 260 : len === 'medium' ? 150 : 90;
    let reply;
    const r = this.aiReady !== false ? await g.ai.generate(this.systemPrompt(npc), this.history.slice(-12), maxTokens) : { ok: false, error: 'no-key' };
    typing.remove();
    if (!this.npc || this.npc !== npc) { this.busy = false; return; }
    if (r.ok) reply = r.text.replace(/^["']|["']$/g, '');
    else {
      reply = npc.fallbackLine();
      if (r.error && r.error !== 'no-key') this.status.textContent = r.rateLimited ? 'AI rate-limited — fallback reply' : `AI error — fallback (${String(r.error).slice(0, 40)})`;
    }
    this.addLine('npc', reply);
    this.history.push({ role: 'model', text: reply });
    npc.avatar.anim.play(Math.random() < 0.5 ? 'interact' : 'taunt');
    this.busy = false;
    // memory facts
    this.memory.facts = [...(this.memory.facts || []), `They said: "${text.slice(0, 80)}"`].slice(-6);
  }

  systemPrompt(npc) {
    const g = this.game;
    const p = npc.persona;
    const me = g.settings.get('player.name');
    const ch = g.avatar.key;
    const def = PLAYABLE_BY_ID[ch];
    const pos = g.player.pos;
    const where = g.player.interior ? `inside ${g.player.interior.name}` : `on the street in the ${districtAt(pos.x, pos.z).name} area`;
    const clock = g.world.env.clock();
    const ctx = [];
    ctx.push(`It is ${clock}. You are ${where}.`);
    if (npc.role === 'shopkeeper') ctx.push('You work behind the counter here.');
    if (g.player.interior?.residential && !g.player.interior.owned && npc.interior) ctx.push(`${me} walked into YOUR home uninvited and is standing in it right now.`);
    const w = g.weapons?.currentId?.();
    if (w && w !== 'fists') ctx.push(`${me} is visibly holding a ${g.weapons.name(w)}.`);
    if (g.police?.level) ctx.push(`Police sirens are around; ${me} looks like they're wanted by the police (${g.police.level} stars).`);
    if (g.vehicles?.current) ctx.push(`${me} is talking to you from inside a ${g.vehicles.current.spec.name}.`);
    const now = performance.now();
    const seen = this.events.filter((e) => now - e.t < 90000 && (!e.pos.distanceTo || e.pos.distanceTo(npc.position) < 70)).slice(-4).map((e) => e.text);
    if (seen.length) ctx.push(`Recently, nearby: ${seen.join('; ')}.`);
    if (npc.memoryHint) ctx.push(npc.memoryHint);
    const facts = (this.memory?.facts || []).slice(-5);
    const len = g.settings.get('ai.responseLength');
    const lenRule = len === 'long' ? 'Reply in 2-4 sentences.' : len === 'medium' ? 'Reply in 1-3 sentences.' : 'Reply in 1-2 short sentences.';
    return [
      `You are ${p.name}, a ${p.age}-year-old ${p.job} living in Applerun, a fictional coastal city in a sandbox video game.`,
      `Personality: ${p.trait} and ${p.trait2}. Quirk: ${p.quirk}. Speech style: ${p.style}.`,
      `You are talking face to face with ${me}, who looks like ${LOOKS[ch] || 'an ordinary person'}.${def?.personality ? ` (Known around town: ${def.personality.split('.')[0]}.)` : ''}`,
      `Situation: ${ctx.join(' ')}`,
      facts.length || this.memory?.met ? `What you remember about ${me}: ${facts.join('; ') || 'you have met before'}. Relationship: ${this.memory.rel > 1 ? 'friendly' : this.memory.rel < -1 ? 'hostile' : 'neutral'}.` : `You have never met ${me} before.`,
      'Stay fully in character as a real person in this city. Never say you are an AI, a language model or an NPC. Only know what your character could plausibly know or observe; do not invent facts about the player.',
      `${lenRule} No stage directions, no quotes, no emojis. Keep it PG-13.`,
    ].join('\n');
  }

  async close() {
    const g = this.game;
    const npc = this.npc;
    if (!npc) return;
    this.npc = null;
    this.el?.remove(); this.el = null; this.linesEl = null;
    g.input.enabled = true;
    if (g.mode === 'playing') g.input.lock();
    if (npc.alive) {
      npc.talkingTo = null;
      if (npc.prevState) npc.state = npc.prevState;
      else if (npc.state === 'talkPlayer') npc.state = npc.fixed ? 'idle' : 'wander';
    }
    // persist memory
    const turns = this.history.filter((t) => t.role === 'user').length;
    if (turns > 0) {
      const rel = (this.memory.rel || 0) + (turns > 1 ? 1 : 0);
      g.net.request('npcMemory', { npc: npc.identity, set: { facts: this.memory.facts, rel, met: (this.memory.met || 0) + 1 } });
    }
  }
  listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = false;
    this.status.textContent = 'Listening…';
    rec.onresult = (e) => { this.input.value = e.results[0][0].transcript; this.status.textContent = ''; this.send(); };
    rec.onerror = () => { this.status.textContent = 'Voice input unavailable'; };
    rec.start();
  }
  /** Remember something that happened between the player and this NPC. */
  async remember(npc, fact, relDelta = -2) {
    const g = this.game;
    const mem = await g.net.request('npcMemory', { npc: npc.identity });
    const m = (mem.ok && mem.memory) || { facts: [], rel: 0, met: 0 };
    m.facts = [...(m.facts || []), fact].slice(-6);
    m.rel = (m.rel || 0) + relDelta;
    g.net.request('npcMemory', { npc: npc.identity, set: m });
  }
}

function greeting(npc) {
  const r = npc.role;
  const G = {
    shopkeeper: ['Welcome! What can I get you?', 'Hey there, browsing or buying?'],
    police: ['Something I can help you with, citizen?', 'Make it quick.'],
    gang: ["You lost or something?", 'What you want?'],
    junkie: ['Hey... hey you... got a sec?'],
    resident: ['Uh... hello? Who are you?'],
    medic: ['Hi, are you hurt?'],
    worker: ['Yeah? What is it?'],
    athlete: ["What's up! You work out?"],
  }[r] || ['Hey.', 'Hi there!', 'Oh, hello.', 'Can I help you?', 'Yeah?'];
  return G[Math.floor(Math.random() * G.length)];
}
