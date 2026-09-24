import * as THREE from 'three';

// Collects context interactions from every system each frame, shows the best prompt
// and runs it on E. Also owns the character "special" interactions (Ajan, Rize).
export class Interaction {
  constructor(game) {
    this.game = game;
    this.current = null;
    this.cooldown = 0;
    game.onRemoteFx = (kind, r, a) => this.onRemoteFx(kind, r, a);
  }
  update(dt, playing) {
    const g = this.game;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!playing || !g.player || g.player.mode === 'dead' || g.ui.modalOpen) { g.hud.prompt(null); return; }
    const out = [];
    const pos = g.player.pos;
    if (g.seated) out.push({ label: 'Stand up', key: 'interact', priority: 9, action: () => g.standUp() });
    else {
      for (const s of g.systems) if (s !== this) s.interactions?.(out, pos);
      this.playerInteractions(out);
    }
    out.sort((a, b) => b.priority - a.priority);
    const best = out[0] || null;
    this.current = best;
    if (best) {
      const k = g.settings.binding(best.key || 'interact').replace(/^Key/, '');
      g.hud.prompt(`Press <kbd>${k}</kbd> — ${best.label}`);
      if (g.input.hit(best.key || 'interact') && this.cooldown <= 0) { this.cooldown = 0.35; best.action(); }
    } else g.hud.prompt(null);
  }

  playerInteractions(out) {
    const g = this.game;
    if (g.vehicles?.current) return;
    const r = g.mp.lookTarget(3.2);
    if (!r) return;
    const ch = r.avatar.key;
    if (ch === 'ajan') {
      out.push({ label: 'Interact', key: 'interact', priority: 6, action: () => this.ajanSpecial(r) });
    } else if (ch === 'rize') {
      out.push({ label: 'Interact', key: 'interact', priority: 6, action: () => this.rizeSpecial(r) });
    } else {
      out.push({ label: `Wave at ${r.avatar.name}`, key: 'interact', priority: 1, action: () => { g.avatar.anim.play('wave'); g.net.send('fx', { kind: 'anim', a: { name: 'wave' } }); } });
    }
  }

  // --- Ajan: plays the supplied ajan.mp3 at Ajan's position for everyone nearby
  ajanSpecial(r) {
    const g = this.game;
    this.playAjan(r.avatar);
    g.avatar.anim.play('interact');
    g.net.send('fx', { kind: 'ajan', a: { target: r.id } });
  }
  playAjan(avatar) {
    const g = this.game;
    const p = avatar.position.clone(); p.y += 1.6;
    g.audio.playSample('ajan', p, { volume: 1.2, ref: 6 });
    avatar.anim.play('chestBeat');
  }
  // --- Rize: shows the supplied "Rize did it" clip to nearby players
  rizeSpecial(r) {
    const g = this.game;
    this.showRize(r.avatar.name);
    g.avatar.anim.play('interact');
    r.avatar.anim.play('wave');
    g.net.send('fx', { kind: 'rize', a: { target: r.id } });
  }
  showRize(name) {
    const g = this.game;
    document.getElementById('rize-video')?.remove();
    const wrap = document.createElement('div');
    wrap.id = 'rize-video';
    const v = document.createElement('video');
    v.src = g.assets.url('rizeVideo'); v.autoplay = true; v.playsInline = true;
    v.volume = Math.min(1, g.settings.get('audio.master') * g.settings.get('audio.sfx') + 0.1);
    const label = document.createElement('div'); label.textContent = `${name || 'Rize'} did it.`;
    wrap.append(v, label);
    document.getElementById('ui').append(wrap);
    v.play().catch(() => { v.muted = true; v.play(); });
    v.onended = () => wrap.remove();
    setTimeout(() => wrap.remove(), 30000);
  }
  onRemoteFx(kind, r, a) {
    const g = this.game;
    if (kind === 'ajan') {
      const target = a.target === g.net.id ? g.avatar : g.mp.remotes.get(a.target)?.avatar;
      if (target) this.playAjan(target);
      r.avatar.anim.play('interact');
    } else if (kind === 'rize') {
      const target = a.target === g.net.id ? { name: g.settings.get('player.name') } : g.mp.remotes.get(a.target)?.avatar;
      if (target && target.position ? target.position.distanceTo(g.player.pos) < 40 : true) this.showRize(target?.name);
    } else g.onFx?.(kind, r, a);
  }
}
export { THREE };
