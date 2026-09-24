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
}
boot();
