// WebAudio sound system: volume buses, 3D spatial sources, procedural SFX synthesis,
// ambience and decoded sample playback (ajan.mp3).
export class AudioManager {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.buffers = {};
    this.pendingRaw = {};
    this.loops = new Set();
    settings.onChange((k) => { if (k.startsWith('audio.')) this.applyVolumes(); });
  }

  /** Must be called from a user gesture. */
  async init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.comp.connect(this.master);
    this.bus = {};
    for (const b of ['music', 'sfx', 'voice', 'ambient']) { this.bus[b] = c.createGain(); this.bus[b].connect(this.comp); }
    this.applyVolumes();
    this.noiseBuf = this.makeNoise(2);
    for (const [id, raw] of Object.entries(this.pendingRaw)) await this.decode(id, raw);
    this.pendingRaw = {};
    this.warmup();
  }
  // Build one of every node type we use (HRTF panner, filters, oscillators, buffer sources)
  // through a muted gain, so the first gunshot/engine/sample doesn't pay the setup cost
  // (Chrome loads its HRTF database when the first HRTF panner is created).
  warmup() {
    const c = this.ctx, t = c.currentTime;
    const mute = c.createGain(); mute.gain.value = 0; mute.connect(c.destination);
    const p = c.createPanner(); p.panningModel = 'HRTF'; p.connect(mute);
    const f = c.createBiquadFilter(); f.connect(p);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.connect(f); s.start(t); s.stop(t + 0.05);
    const o = c.createOscillator(); o.connect(f); o.start(t); o.stop(t + 0.05);
    for (const id of Object.keys(this.buffers)) { const b = c.createBufferSource(); b.buffer = this.buffers[id]; b.connect(mute); b.start(t); b.stop(t + 0.01); }
    setTimeout(() => { try { mute.disconnect(); } catch { /* ignore */ } }, 300);
  }
  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.get('audio.master');
    this.bus.music.gain.value = s.get('audio.music');
    this.bus.sfx.gain.value = s.get('audio.sfx');
    this.bus.voice.gain.value = s.get('audio.voice');
    this.bus.ambient.gain.value = s.get('audio.ambient');
  }
  async addSample(id, arrayBuffer) {
    if (!this.ctx) { this.pendingRaw[id] = arrayBuffer; return; }
    await this.decode(id, arrayBuffer);
  }
  async decode(id, raw) {
    try { this.buffers[id] = await this.ctx.decodeAudioData(raw.slice(0)); }
    catch (e) { console.error(`Audio "${id}" failed to decode:`, e); }
  }
  makeNoise(sec) {
    const c = this.ctx, n = c.sampleRate * sec;
    const b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  setListener(pos, fwd, up) {
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.02); l.positionY.setTargetAtTime(pos.y, t, 0.02); l.positionZ.setTargetAtTime(pos.z, t, 0.02);
      l.forwardX.setTargetAtTime(fwd.x, t, 0.02); l.forwardY.setTargetAtTime(fwd.y, t, 0.02); l.forwardZ.setTargetAtTime(fwd.z, t, 0.02);
      l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z;
    } else { l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
  }

  /** Output node: spatial panner at pos (or plain bus). */
  out(bus = 'sfx', pos = null, { ref = 6, max = 400, rolloff = 1.2 } = {}) {
    const c = this.ctx;
    if (!pos) return this.bus[bus];
    const p = c.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.maxDistance = max; p.rolloffFactor = rolloff;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    p.connect(this.bus[bus]);
    return p;
  }

  playSample(id, pos = null, { volume = 1, bus = 'sfx', ref = 5 } = {}) {
    if (!this.ctx || !this.buffers[id]) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.buffers[id];
    const g = this.ctx.createGain(); g.gain.value = volume;
    s.connect(g); g.connect(this.out(bus, pos, { ref }));
    s.start();
    return s;
  }

  // ---------------------------------------------------------------- synthesised SFX
  noiseBurst(pos, { dur = 0.2, freq = 1000, q = 0.8, type = 'bandpass', vol = 0.6, attack = 0.002, bus = 'sfx', ref = 6, sweep = 0 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.out(bus, pos, { ref }));
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  tone(pos, { freq = 440, dur = 0.2, type = 'sine', vol = 0.3, slide = 0, bus = 'sfx', ref = 6, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.out(bus, pos, { ref }));
    o.start(t); o.stop(t + dur + 0.05);
  }

  footstep(pos, surface = 'hard', vol = 0.25) {
    const f = surface === 'grass' ? 700 : surface === 'sand' ? 500 : surface === 'wood' ? 900 : 1500;
    this.noiseBurst(pos, { dur: 0.09, freq: f * (0.85 + Math.random() * 0.3), q: 1.2, vol, ref: 3 });
  }
  jump(pos) { this.noiseBurst(pos, { dur: 0.12, freq: 600, vol: 0.2, ref: 3 }); }
  land(pos) { this.noiseBurst(pos, { dur: 0.15, freq: 300, type: 'lowpass', vol: 0.5, ref: 3 }); }

  gunshot(pos, weapon = 'pistol') {
    const P = {
      ak47: { f: 900, d: 0.35, v: 1.0, low: 70 }, m4a1: { f: 1400, d: 0.28, v: 0.85, low: 90 },
      glock: { f: 1700, d: 0.2, v: 0.7, low: 120 }, deagle: { f: 800, d: 0.45, v: 1.1, low: 55 }, pistol: { f: 1500, d: 0.22, v: 0.75, low: 110 },
      bolt: { f: 700, d: 0.9, v: 1.2, low: 45 }, semisniper: { f: 900, d: 0.6, v: 1.05, low: 55 }, shotgun: { f: 600, d: 0.5, v: 1.1, low: 50 },
    }[weapon] || { f: 1200, d: 0.3, v: 0.8, low: 90 };
    this.noiseBurst(pos, { dur: P.d, freq: P.f, q: 0.5, vol: P.v, attack: 0.001, ref: 12, sweep: 0.3 });
    this.tone(pos, { freq: P.low * 2, slide: 0.3, dur: P.d * 0.8, type: 'triangle', vol: P.v * 0.8, ref: 12, attack: 0.001 });
    if (P.d > 0.5) this.noiseBurst(pos, { dur: 1.4, freq: 400, type: 'lowpass', vol: 0.25, attack: 0.08, ref: 20 }); // echo tail
  }
  reload(pos, dur = 1.6) {
    if (!this.ctx) return;
    const steps = [0.1, dur * 0.35, dur * 0.7, dur * 0.9];
    steps.forEach((t, i) => setTimeout(() => this.noiseBurst(pos, { dur: 0.05, freq: 2500 + i * 400, q: 4, vol: 0.4, ref: 3 }), t * 1000));
  }
  dryFire(pos) { this.noiseBurst(pos, { dur: 0.04, freq: 3000, q: 5, vol: 0.3, ref: 3 }); }
  impact(pos, kind = 'hard') {
    if (kind === 'flesh') this.noiseBurst(pos, { dur: 0.12, freq: 350, type: 'lowpass', vol: 0.6, ref: 4 });
    else if (kind === 'metal') this.tone(pos, { freq: 1800 + Math.random() * 600, dur: 0.25, type: 'square', vol: 0.15, slide: 0.8, ref: 4 });
    else this.noiseBurst(pos, { dur: 0.08, freq: 2200, q: 1.5, vol: 0.35, ref: 4 });
  }
  punch(pos) { this.noiseBurst(pos, { dur: 0.1, freq: 250, type: 'lowpass', vol: 0.8, ref: 4 }); this.tone(pos, { freq: 120, slide: 0.5, dur: 0.12, vol: 0.4, ref: 4 }); }
  slam(pos) { this.noiseBurst(pos, { dur: 0.4, freq: 180, type: 'lowpass', vol: 1.0, ref: 6 }); this.tone(pos, { freq: 70, slide: 0.5, dur: 0.4, vol: 0.7, ref: 6 }); }
  kickBall(pos, power = 1) { this.tone(pos, { freq: 180, slide: 0.6, dur: 0.1, vol: 0.4 + power * 0.3, ref: 5 }); this.noiseBurst(pos, { dur: 0.05, freq: 900, vol: 0.2, ref: 5 }); }
  bounce(pos, vol = 0.5) { this.tone(pos, { freq: 140, slide: 0.7, dur: 0.12, vol, ref: 5, type: 'sine' }); this.noiseBurst(pos, { dur: 0.04, freq: 1600, vol: vol * 0.3, ref: 5 }); }
  swish(pos) { this.noiseBurst(pos, { dur: 0.3, freq: 3000, q: 0.6, vol: 0.4, ref: 5, sweep: 0.4 }); }
  door(pos) { this.noiseBurst(pos, { dur: 0.25, freq: 500, vol: 0.5, ref: 4 }); this.tone(pos, { freq: 90, dur: 0.2, vol: 0.4, ref: 4 }); }
  crash(pos, vol = 1) { this.noiseBurst(pos, { dur: 0.6, freq: 700, q: 0.4, vol, ref: 10, sweep: 0.2 }); this.tone(pos, { freq: 60, slide: 0.5, dur: 0.5, vol: vol * 0.8, ref: 10 }); this.noiseBurst(pos, { dur: 0.4, freq: 5000, q: 2, vol: vol * 0.3, ref: 10 }); }
  horn(pos) { this.tone(pos, { freq: 392, dur: 0.45, type: 'sawtooth', vol: 0.25, ref: 10 }); this.tone(pos, { freq: 494, dur: 0.45, type: 'sawtooth', vol: 0.2, ref: 10 }); }
  cash() { this.tone(null, { freq: 1318, dur: 0.12, type: 'triangle', vol: 0.3 }); setTimeout(() => this.tone(null, { freq: 1760, dur: 0.25, type: 'triangle', vol: 0.3 }), 90); }
  ui(kind = 'click') {
    if (kind === 'hover') this.tone(null, { freq: 880, dur: 0.04, vol: 0.05, type: 'sine' });
    else if (kind === 'error') this.tone(null, { freq: 180, dur: 0.2, vol: 0.2, type: 'square' });
    else if (kind === 'notify') { this.tone(null, { freq: 660, dur: 0.1, vol: 0.15 }); setTimeout(() => this.tone(null, { freq: 990, dur: 0.15, vol: 0.15 }), 100); }
    else this.tone(null, { freq: 520, dur: 0.06, vol: 0.12, type: 'triangle' });
  }
  hitmarker() { this.tone(null, { freq: 2200, dur: 0.05, vol: 0.2, type: 'square' }); }
  whistle(pos) { this.tone(pos, { freq: 2600, dur: 0.6, type: 'square', vol: 0.15, ref: 20 }); }
  crowd(vol = 0.5) { this.noiseBurst(null, { dur: 2.5, freq: 900, q: 0.3, vol, attack: 0.3, bus: 'ambient' }); }
  bell() { this.tone(null, { freq: 1200, dur: 1.2, type: 'sine', vol: 0.4 }); this.tone(null, { freq: 1810, dur: 1.0, type: 'sine', vol: 0.2 }); }

  // ---------------------------------------------------------------- continuous sources
  /** Engine loop for a vehicle; returns controller {update(pos, rpm, throttle), stop()} */
  engineLoop(kind = 'car') {
    if (!this.ctx) return null;
    const c = this.ctx;
    const p = this.out('sfx', { x: 0, y: 0, z: 0 }, { ref: 5, max: 250 });
    const g = c.createGain(); g.gain.value = 0; g.connect(p);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800; f.connect(g);
    const o1 = c.createOscillator(); o1.type = 'sawtooth';
    const o2 = c.createOscillator(); o2.type = 'square';
    const base = kind === 'motorcycle' ? 55 : kind === 'truck' ? 28 : kind === 'sports' ? 45 : 35;
    o1.connect(f); o2.connect(f); o1.start(); o2.start();
    const tire = c.createBufferSource(); tire.buffer = this.noiseBuf; tire.loop = true;
    const tf = c.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 1400; tf.Q.value = 3;
    const tg = c.createGain(); tg.gain.value = 0;
    tire.connect(tf); tf.connect(tg); tg.connect(p); tire.start();
    const ctl = {
      update(pos, rpm, throttle, skid = 0) {
        const t = c.currentTime;
        p.positionX.setTargetAtTime(pos.x, t, 0.03); p.positionY.setTargetAtTime(pos.y, t, 0.03); p.positionZ.setTargetAtTime(pos.z, t, 0.03);
        o1.frequency.setTargetAtTime(base * (1 + rpm * 3), t, 0.05);
        o2.frequency.setTargetAtTime(base * 0.5 * (1 + rpm * 3), t, 0.05);
        f.frequency.setTargetAtTime(400 + rpm * 1800 + throttle * 600, t, 0.05);
        g.gain.setTargetAtTime(0.06 + throttle * 0.1 + rpm * 0.06, t, 0.05);
        tg.gain.setTargetAtTime(Math.min(0.35, skid * 0.4), t, 0.05);
      },
      stop() { const t = c.currentTime; g.gain.setTargetAtTime(0, t, 0.1); tg.gain.setTargetAtTime(0, t, 0.05); setTimeout(() => { try { o1.stop(); o2.stop(); tire.stop(); p.disconnect(); } catch { /* ignore */ } }, 500); },
    };
    return ctl;
  }

  siren(kind = 'police') {
    if (!this.ctx) return null;
    const c = this.ctx;
    const p = this.out('sfx', { x: 0, y: 0, z: 0 }, { ref: 15, max: 600 });
    const g = c.createGain(); g.gain.value = 0.12; g.connect(p);
    const o = c.createOscillator(); o.type = 'square';
    const lfo = c.createOscillator(); lfo.frequency.value = kind === 'police' ? 0.9 : 0.45;
    const lg = c.createGain(); lg.gain.value = kind === 'police' ? 350 : 200;
    o.frequency.value = kind === 'police' ? 950 : 750;
    lfo.connect(lg); lg.connect(o.frequency);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2500;
    o.connect(f); f.connect(g); o.start(); lfo.start();
    return {
      update(pos) { const t = c.currentTime; p.positionX.setTargetAtTime(pos.x, t, 0.05); p.positionY.setTargetAtTime(pos.y, t, 0.05); p.positionZ.setTargetAtTime(pos.z, t, 0.05); },
      stop() { try { o.stop(); lfo.stop(); p.disconnect(); } catch { /* ignore */ } },
    };
  }

  /** Ambient bed: city hum + ocean + wind, levels set per frame by setAmbience. */
  startAmbience() {
    if (!this.ctx || this.amb) return;
    const c = this.ctx;
    const mk = (type, freq, q) => {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(this.bus.ambient); s.start();
      return { g, f };
    };
    this.amb = { city: mk('lowpass', 350, 0.5), ocean: mk('lowpass', 600, 0.3), wind: mk('bandpass', 400, 0.4) };
    this.ambT = 0;
  }
  setAmbience({ city = 0, ocean = 0, wind = 0, dt = 0.016 }) {
    if (!this.amb) return;
    const t = this.ctx.currentTime;
    this.ambT += dt;
    this.amb.city.g.gain.setTargetAtTime(city * 0.18, t, 0.5);
    this.amb.ocean.g.gain.setTargetAtTime(ocean * (0.18 + 0.12 * Math.sin(this.ambT * 0.5)), t, 0.3);
    this.amb.wind.g.gain.setTargetAtTime(wind * 0.15, t, 0.5);
    // random birds by day / car horns in the city
    if (Math.random() < dt * 0.15 * (1 - city * 0.5)) this.tone(null, { freq: 2400 + Math.random() * 1200, dur: 0.08, vol: 0.03, bus: 'ambient', slide: 1.3 });
    if (Math.random() < dt * 0.04 * city) this.tone(null, { freq: 380 + Math.random() * 80, dur: 0.3, type: 'sawtooth', vol: 0.02, bus: 'ambient' });
  }

  /** Minimal generative menu music (soft chord pad). */
  startMusic() {
    if (!this.ctx || this.music) return;
    const c = this.ctx;
    const chords = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [196, 247, 330]];
    let i = 0;
    const g = c.createGain(); g.gain.value = 0.05; g.connect(this.bus.music);
    const play = () => {
      if (!this.music) return;
      const t = c.currentTime;
      for (const f of chords[i % chords.length]) {
        const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
        const e = c.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(0.5, t + 0.8); e.gain.linearRampToValueAtTime(0, t + 3.8);
        o.connect(e); e.connect(g); o.start(t); o.stop(t + 4);
      }
      i++;
    };
    this.music = setInterval(play, 3800);
    play();
    this.musicGain = g;
  }
  stopMusic() { if (this.music) { clearInterval(this.music); this.music = null; } }

  /** Generative club beat (kick + hat + a bassline note), positional so it's louder near the
   * DJ booth and fades with distance like any other 3D sound. getPos() is polled each beat so
   * the source can follow a moving reference (unused here, but kept consistent with other spatial
   * loops). Returns { stop() }. */
  clubBeat(getPos, bpm = 126) {
    if (!this.ctx) return { stop() {} };
    const step = 60 / bpm / 2;
    const bass = [55, 55, 82.4, 65.4];
    let i = 0, alive = true;
    const tick = () => {
      if (!alive) return;
      const pos = getPos();
      this.noiseBurst(pos, { dur: 0.09, freq: 120, type: 'lowpass', vol: 0.5, bus: 'music', ref: 8, max: 60 });
      this.tone(pos, { freq: bass[i % bass.length], dur: step * 1.8, type: 'sawtooth', vol: 0.22, bus: 'music', ref: 8, max: 60 });
      if (i % 2 === 1) this.noiseBurst(pos, { dur: 0.04, freq: 7000, type: 'highpass', vol: 0.12, bus: 'music', ref: 8, max: 60 });
      i++;
    };
    tick();
    const h = setInterval(tick, step * 1000);
    return { stop: () => { alive = false; clearInterval(h); } };
  }
}
