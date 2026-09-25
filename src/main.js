import { Assets } from './core/Assets.js';
import { Settings } from './core/Settings.js';
import { Game } from './Game.js';
import { UIManager } from './ui/UIManager.js';

// Boot: load supplied assets, build the city, connect, then show the main menu.
const settings = new Settings();
const bootUI = new UIManager({ settings, audio: { ui() {} }, input: {}, net: {} });
bootUI.showLoading();

async function boot() {
  const assets = new Assets();
  try {
    await assets.loadAll((p, label) => bootUI.setLoading(p * 0.5, `Loading ${label}…`));
  } catch (e) {
    bootUI.loadingError(e.message);
    console.error(e);
    return;
  }
  let game;
  try {
    game = new Game(assets, settings);
    await game.init((p, msg) => bootUI.setLoading(p, msg));
  } catch (e) {
    bootUI.loadingError('Startup failed: ' + (e.stack || e.message));
    console.error(e);
    return;
  }
  bootUI.hideLoading();
  game.showMenu();
  // Invite links: https://your-site/?room=CODE joins that room straight away
  const invite = new URLSearchParams(location.search).get('room');
  if (invite) {
    const join = () => game.joinRoom(invite.toUpperCase());
    if (game.settings.get('player.name')) game.ui.notify(`Invite for room ${invite.toUpperCase()} — click Play or press Join`, 'info');
    game.pendingInvite = invite.toUpperCase();
    game.ui.modal('Join your friend?', (() => {
      const d = document.createElement('div');
      d.innerHTML = `<p>You were invited to room <b>${invite.toUpperCase().replace(/[^A-Z0-9]/g, '')}</b>.</p>`;
      const b = document.createElement('button'); b.className = 'btn primary'; b.textContent = 'Join room';
      b.onclick = () => { game.ui.closeModal(); if (!game.settings.get('player.name')) game.ui.askName(join); else join(); };
      d.append(b); return d;
    })());
  }
}
boot();
