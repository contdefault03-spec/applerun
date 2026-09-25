// Proximity voice chat over WebRTC (mesh between players in the same room).
// Signaling goes through the game server ('rtc' messages). Push-to-talk on V: the mic
// track is only enabled while the key is held. Each remote voice is spatialised with an
// HRTF panner at the speaker's head and faded out with distance (silent beyond ~45 m).
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const FULL = 6, SILENT = 45;

export class VoiceChat {
  constructor(game) {
    this.game = game;
    this.peers = new Map(); // id -> {pc, polite, makingOffer, ignoreOffer, audioEl, src, gain, panner}
    this.stream = null;
    this.track = null;
    this.transmitting = false;
    this.permission = 'unknown';
    const turn = import.meta.env?.VITE_TURN_URL;
    this.ice = turn ? [...ICE, { urls: turn, username: import.meta.env.VITE_TURN_USER, credential: import.meta.env.VITE_TURN_PASS }] : ICE;
    game.net.on('rtc', (m) => this.onSignal(m.from, m.data));
    game.net.on('playerLeave', (m) => this.onPeerLeft(m.id));
    game.net.on('disconnected', () => this.closeAll());
  }
  get enabled() { return this.game.settings.get('voice.enabled') && this.game.net.connected && !!this.game.net.room && 'RTCPeerConnection' in window; }

  async ensureMic() {
    if (this.stream) return true;
    if (!navigator.mediaDevices?.getUserMedia) { this.permission = 'unsupported'; return false; }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      this.track = this.stream.getAudioTracks()[0];
      this.track.enabled = false;
      this.permission = 'granted';
      for (const p of this.peers.values()) this.attachTrack(p);
      return true;
    } catch (e) {
      this.permission = 'denied';
      this.game.ui.notify('Microphone permission denied — you can still hear others. Enable the mic in your browser to talk.', 'bad');
      return false;
    }
  }
  attachTrack(p) {
    if (!this.track || !p.tx) return;
    p.tx.sender.replaceTrack(this.track).catch(() => {});
  }

  onPeerJoined(id) {
    if (!this.enabled || this.peers.has(id)) return;
    this.createPeer(id);
  }
  createPeer(id) {
    const g = this.game;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const p = { id, pc, polite: g.net.id > id, makingOffer: false, ignoreOffer: false };
    this.peers.set(id, p);
    // The impolite side opens a single audio transceiver (send+receive) and makes the offer;
    // the polite side adopts the offered transceiver. Mic tracks are swapped in later with
    // replaceTrack, so push-to-talk never needs renegotiation.
    if (!p.polite) { p.tx = pc.addTransceiver('audio', { direction: 'sendrecv' }); this.attachTrack(p); }
    pc.onnegotiationneeded = async () => {
      try { p.makingOffer = true; await pc.setLocalDescription(); g.net.send('rtc', { to: id, data: { description: pc.localDescription } }); }
      catch (e) { console.warn('[voice] negotiation', e); } finally { p.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) g.net.send('rtc', { to: id, data: { candidate } }); };
    pc.ontrack = (ev) => this.onTrack(p, ev.streams[0] || new MediaStream([ev.track]));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { pc.restartIce?.(); } };
    return p;
  }
  async onSignal(from, data) {
    if (!this.enabled || !data) return;
    let p = this.peers.get(from) || this.createPeer(from);
    const pc = p.pc;
    try {
      if (data.description) {
        const offerCollision = data.description.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && offerCollision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription(data.description);
        if (!p.tx) { const tr = pc.getTransceivers().find((x) => x.receiver.track?.kind === 'audio'); if (tr) { tr.direction = 'sendrecv'; p.tx = tr; this.attachTrack(p); } }
        if (data.description.type === 'offer') { await pc.setLocalDescription(); this.game.net.send('rtc', { to: from, data: { description: pc.localDescription } }); }
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!p.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn('[voice] signal error', e); }
    void p;
  }
  onTrack(p, stream) {
    const audio = this.game.audio;
    if (!audio.ctx || p.src) return;
    // Chrome only feeds WebRTC audio into WebAudio when the stream is attached to a media element
    const el = new Audio(); el.srcObject = stream; el.muted = true; el.play().catch(() => {});
    p.audioEl = el;
    const c = audio.ctx;
    p.src = c.createMediaStreamSource(stream);
    p.gain = c.createGain(); p.gain.gain.value = 0;
    p.panner = c.createPanner(); p.panner.panningModel = 'HRTF'; p.panner.distanceModel = 'linear'; p.panner.refDistance = 1; p.panner.maxDistance = 1000; p.panner.rolloffFactor = 0;
    p.src.connect(p.gain); p.gain.connect(p.panner); p.panner.connect(audio.bus.voice);
  }
  onPeerLeft(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch { /* ignore */ }
    p.src?.disconnect(); p.gain?.disconnect(); p.panner?.disconnect();
    if (p.audioEl) p.audioEl.srcObject = null;
    this.peers.delete(id);
  }
  closeAll() { for (const id of [...this.peers.keys()]) this.onPeerLeft(id); }
  applyMute(id, muted) { const p = this.peers.get(id); if (p?.gain) p.gain.gain.value = muted ? 0 : p.gain.gain.value; }
  onJoined(r) { this.closeAll(); if (this.enabled) for (const pl of r.players || []) this.onPeerJoined(pl.id); }
  onLeave() { this.closeAll(); }

  async update(dt, playing) {
    const g = this.game;
    if (!this.enabled) { if (this.peers.size) this.closeAll(); if (this.transmitting) this.setTx(false); return; }
    // ensure we're connected to everyone in the room
    for (const id of g.mp.remotes.keys()) if (!this.peers.has(id)) this.onPeerJoined(id);
    const want = playing && g.input.down('talk') && !g.hud.chatInput && !g.dialogue?.npc;
    if (want && !this.transmitting) {
      if (!this.stream && this.permission !== 'denied' && !this.requesting) { this.requesting = true; await this.ensureMic(); this.requesting = false; }
      if (this.track) this.setTx(true);
    } else if (!want && this.transmitting) this.setTx(false);
    // spatialise remote voices
    const me = g.player?.pos;
    if (!me) return;
    const t = g.audio.ctx?.currentTime || 0;
    for (const p of this.peers.values()) {
      if (!p.gain) continue;
      const r = g.mp.remotes.get(p.id);
      let vol = 0;
      if (r && r.avatar.group.visible && !g.mp.muted.has(p.id)) {
        const pos = r.avatar.position;
        const d = pos.distanceTo(me);
        vol = d <= FULL ? 1 : d >= SILENT ? 0 : 1 - (d - FULL) / (SILENT - FULL);
        vol *= vol;
        const hy = pos.y + r.avatar.char.height * 0.9;
        p.panner.positionX.setTargetAtTime(pos.x, t, 0.05); p.panner.positionY.setTargetAtTime(hy, t, 0.05); p.panner.positionZ.setTargetAtTime(pos.z, t, 0.05);
      }
      p.gain.gain.setTargetAtTime(vol, t, 0.08);
    }
  }
  setTx(on) {
    this.transmitting = on;
    if (this.track) this.track.enabled = on;
    this.game.net.send('talking', { on });
    this.game.avatar?.setTalking(on);
  }
}
