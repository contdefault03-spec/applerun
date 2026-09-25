import * as THREE from 'three';
import { Engine } from './core/Engine.js';
import { Input } from './core/Input.js';
import { AudioManager } from './core/AudioManager.js';
import { CharacterFactory } from './characters/CharacterFactory.js';
import { Avatar } from './characters/Avatar.js';
import { World } from './world/World.js';
import { PlayerController } from './player/PlayerController.js';
import { CameraController } from './player/CameraController.js';
import { UIManager } from './ui/UIManager.js';
import { HUD } from './ui/HUD.js';
import { Showroom } from './ui/Showroom.js';
import { Network } from './net/Network.js';
import { LocalBackend } from './net/LocalBackend.js';
import { AIClient } from './npc/AIClient.js';
import { MultiplayerManager } from './net/MultiplayerManager.js';
import { InteriorManager } from './interiors/InteriorManager.js';
import { Interaction } from './systems/Interaction.js';
import { LightPool } from './fx/LightPool.js';
import { prewarmScene } from './core/Prewarm.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import { Effects } from './fx/Effects.js';
import { VehicleManager } from './vehicles/VehicleManager.js';
import { Traffic } from './vehicles/Traffic.js';
import { NPCManager } from './npc/NPCManager.js';
import { Dialogue } from './npc/Dialogue.js';
import { WeaponManager } from './combat/WeaponManager.js';
import { PoliceManager } from './systems/PoliceManager.js';
import { Jobs } from './systems/Jobs.js';
import { Emergency } from './systems/Emergency.js';
import { Events } from './systems/Events.js';
import { FishingMission } from './systems/FishingMission.js';
import { AdminMenu } from './systems/AdminMenu.js';
import { ATMs } from './systems/ATMs.js';
import { ActivityManager } from './activities/ActivityManager.js';
import { VoiceChat } from './net/VoiceChat.js';
import { districtAt, getLayout } from '../shared/map/layout.js';
import { newProfile } from '../shared/economy.js';

// Top-level orchestrator. Systems register with `addSystem` and receive update(dt).
export class Game {
  constructor(assets, settings) {
    this.assets = assets;
    this.settings = settings;
    this.engine = new Engine(document.getElementById('app'), settings);
    this.input = new Input(this.engine.canvas, settings);
    this.audio = new AudioManager(settings);
    this.factory = new CharacterFactory(assets);
    this.ui = new UIManager(this);
    this.net = new Network(this);
    this.local = new LocalBackend(this);
    this.net.local = this.local;
    this.ai = new AIClient(this);
    this.world = new World(this.engine);
    this.showroom = new Showroom(this.engine, this.factory);
    this.layout = getLayout();
    this.mode = 'loading';
    this.systems = [];
    this.profile = newProfile();
    this.waypoint = null;
    this.player = null;
    this.cam = null;
    this.menuT = 0;
    window.game = this; // handy for debugging / automated tests
  }

  async init(progress) {
    progress(0.55, 'Rigging characters…');
    await tick();
    await MeshoptSimplifier.ready;
    this.factory.init();
    // Pre-build the playable character templates (fast afterwards)
    for (const id of ['max', 'ajan', 'rize', 'masked', 'lucky', 'dex', 'nova']) { this.factory.template(id); await tick(); }
    progress(0.65, 'Building Alfredo Applerun…');
    await this.world.build((msg) => progress(null, msg));
    this.hud = new HUD(this);
    this.lights = new LightPool(this.engine.scene);
    this.mp = this.addSystem(new MultiplayerManager(this));
    this.activities = this.addSystem(new ActivityManager(this));
    this.interiors = this.addSystem(new InteriorManager(this));
    this.fx = new Effects(this.engine.scene, this.lights);
    this.addSystem({ update: (dt) => this.fx.update(dt) });
    this.vehicles = this.addSystem(new VehicleManager(this));
    this.traffic = this.addSystem(new Traffic(this));
    this.npcs = this.addSystem(new NPCManager(this));
    this.weapons = this.addSystem(new WeaponManager(this));
    this.police = this.addSystem(new PoliceManager(this));
    this.jobs = this.addSystem(new Jobs(this));
    this.emergency = this.addSystem(new Emergency(this));
    this.events = this.addSystem(new Events(this));
    this.fishing = this.addSystem(new FishingMission(this));
    this.admin = new AdminMenu(this);
    this.atms = this.addSystem(new ATMs(this));
    this.dialogue = new Dialogue(this);
    progress(0.9, 'Dressing up the citizens of Applerun…');
    await this.npcs.prebuild();
    this.interaction = this.addSystem(new Interaction(this));
    this.voice = this.addSystem(new VoiceChat(this));
    this.audio.addSample('ajan', this.assets.audio.ajan);
    if (this.assets.audio.fish) this.audio.addSample('fish', this.assets.audio.fish);
    this.engine.setPost(this.settings.get('graphics.post') !== false);
    progress(0.93, 'Warming up shaders…');
    await prewarmScene(this);
    progress(0.95, 'Connecting to game server…');
    this.net.on('welcome', (m) => this.setProfile(m.profile));
    await this.net.connect();
    if (!this.net.connected) this.setProfile(this.local.profile);
    this.bindNet();
    this.engine.onUpdate((dt) => this.update(dt));
    this.bindInput();
    this.engine.start();
    progress(1, 'Ready');
  }

  addSystem(s) { this.systems.push(s); return s; }

  bindInput() {
    // Clicking the canvas while playing grabs the mouse
    this.engine.canvas.addEventListener('click', () => { if (this.mode === 'playing' && !this.ui.modalOpen) this.input.lock(); });
    this.input.on((type, code) => {
      if (type === 'lock') {
        if (!code && this.mode === 'playing' && !this.ui.modalOpen && !this.hud.chatInput && !this.hud.mapEl && !this.suppressPause) this.pause();
        this.suppressPause = false;
      }
      if (type !== 'down' || this.mode !== 'playing') return;
      const b = (a) => this.settings.binding(a) === code;
      if (this.hud.chatInput) return;
      if (b('map')) { this.suppressPause = true; this.hud.toggleMap({ detailed: false }); }
      else if (b('bigmap')) { this.suppressPause = true; this.hud.toggleMap({ detailed: true }); }
      else if (this.hud.mapEl) return;
      else if (b('chat')) { this.suppressPause = true; this.hud.openChat((t) => this.sendChat(t)); }
      else if (b('camera')) this.cam.toggleMode();
      else if (b('emote')) this.emote();
      else if (b('phone')) this.ui.showPhone?.();
      else if (b('inventory')) this.ui.showInventory?.();
      else if (b('admin')) { this.suppressPause = true; this.admin.toggle(); }
      else if (b('jump') && this.player) {
        const t = performance.now();
        if (this.lastJumpAt && t - this.lastJumpAt < 350) this.admin.toggleFly(!this.player.flying);
        this.lastJumpAt = t;
      }
    });
  }

  bindNet() {
    this.net.on('disconnected', () => { if (this.mode !== 'menu') this.ui.notify('Lost connection to the game server — reconnecting…', 'bad'); });
    this.net.on('reconnected', () => { this.ui.notify('Reconnected to the game server', 'good'); this.syncProfile(); });
    this.net.on('chat', (m) => this.hud.chatMessage(m.name, m.text, m.sys));
    this.net.on('profile', (m) => this.setProfile(m.profile));
    this.net.on('notice', (m) => this.ui.notify(m.text, m.kind || 'info'));
  }

  async syncProfile() {
    const r = await this.net.request('getProfile');
    if (r.ok) this.setProfile(r.profile);
  }
  setProfile(p) {
    this.profile = p;
    for (const s of this.systems) s.onProfile?.(p);
  }

  // ------------------------------------------------------------------ flow
  setMode(m) {
    this.mode = m;
    this.engine.renderOverride = m === 'showroom' ? () => this.showroom.render() : null;
    this.hud?.show(m === 'playing' || m === 'paused');
  }

  showMenu() {
    this.setMode('menu');
    this.ui.showMainMenu();
    if (!this.settings.get('player.name')) this.ui.askName(() => this.ui.showMainMenu());
  }

  async startAudio() { await this.audio.init(); this.audio.startAmbience(); }

  async quickPlay() {
    if (!this.settings.get('player.name')) return this.ui.askName(() => this.quickPlay());
    await this.startAudio();
    if (this.net.connected) {
      const r = await this.net.request('quickJoin', {});
      if (r.ok) this.onJoined(r);
      else this.ui.notify(`Could not join a world: ${r.error}`, 'bad');
    }
    this.enterWorld();
  }
  async createRoom(opts) {
    await this.startAudio();
    const r = await this.net.request('createRoom', opts);
    if (!r.ok) return this.ui.notify(r.error || 'Could not create room', 'bad');
    this.onJoined(r);
    if (r.room.kind === 'world') this.enterWorld(); else this.activities.enterNet(r);
    this.ui.notify(`Room created — code ${r.room.code}`, 'good');
  }
  async joinRoom(code) {
    await this.startAudio();
    if (this.inActivity && this.activities.s) await this.activities.leave();
    this.activities.rememberWorld?.();
    const r = await this.net.request('joinRoom', { code });
    if (!r.ok) return this.ui.notify(r.error || 'Could not join room', 'bad');
    this.onJoined(r);
    if (r.room.kind === 'world') { this.activities.returnTo = null; this.enterWorld(); } else this.activities.enterNet(r);
  }
  onJoined(r) {
    this.net.room = r.room;
    this.net.wantRoom = r.room.code;
    if (r.profile) this.setProfile(r.profile);
    for (const s of this.systems) s.onJoined?.(r);
  }
  async createActivity(mode, size) {
    if (!this.settings.get('player.name')) return this.ui.askName(() => this.createActivity(mode, size));
    if (this.inActivity) await this.activities.leave();
    if (!this.player) { this.ui.clearMenus(); this.spawnPlayer(); }
    return this.activities.create(mode, size);
  }
  leaveActivity() { return this.activities.leave(); }

  enterWorld() {
    this.ui.clearMenus();
    if (!this.player) this.spawnPlayer();
    this.setMode('playing');
    this.audio.stopMusic();
    this.input.lock();
    if (!this.welcomed) { this.welcomed = true; this.hud.bigMessage('ALFREDO APPLERUN', `Welcome, ${this.settings.get('player.name')}. Press M for the map, P for jobs & activities.`, 5); }
  }

  spawnPlayer() {
    const key = this.settings.get('player.character') || 'max';
    this.avatar = new Avatar(this.factory, key, { name: this.settings.get('player.name'), showTag: false });
    this.engine.scene.add(this.avatar.group);
    this.player = new PlayerController(this, this.avatar);
    this.cam = new CameraController(this.engine.camera, this.input, this.settings, this.world.collision);
    const sp = this.layout.spawnPoints[Math.floor(Math.random() * this.layout.spawnPoints.length)];
    this.player.teleport(sp.x + (Math.random() - 0.5) * 4, null, sp.z + (Math.random() - 0.5) * 4, Math.PI / 2);
    this.weapons.onProfile(this.profile);
    this.weapons.equip('fists');
    this.cam.yaw = -Math.PI / 2 + Math.PI;
    for (const s of this.systems) s.onSpawn?.(this.player);
  }

  onCharacterChanged(key) {
    if (this.avatar) { this.avatar.setCharacter(key); this.weapons?.equip(this.weapons.current); }
    this.net.updateProfile();
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.setMode('paused');
    this.input.unlock();
    this.ui.showPause();
  }
  resume() {
    this.ui.clearMenus();
    this.setMode('playing');
    this.input.lock();
  }
  toMainMenu() {
    if (this.net.room) { this.net.send('leaveRoom'); this.net.room = null; this.net.wantRoom = null; }
    for (const s of this.systems) s.onLeave?.();
    this.input.unlock();
    this.showMenu();
  }
  respawn(reason) {
    const sp = this.layout.spawnPoints[0];
    this.player.teleport(sp.x, null, sp.z);
    void reason;
  }
  sendChat(text) {
    if (this.net.connected && this.net.room) this.net.send('chat', { text });
    else this.hud.chatMessage(this.settings.get('player.name'), text);
  }
  emote() {
    if (!this.player || this.player.mode !== 'foot' || this.vehicles?.current) return;
    const d = this.avatar.char.def;
    const name = d.gorilla ? 'chestBeat' : d.idleStyle === 'flex' ? 'flex' : d.idleStyle === 'silly' ? 'dance' : d.idleStyle === 'bored' ? 'taunt' : 'celebrate';
    this.avatar.anim.play(name);
    this.net.send('fx', { kind: 'anim', a: { name } });
  }

  // ------------------------------------------------------------------ sitting / furniture
  sitOn(seat) {
    if (this.seated) return;
    this.seated = seat;
    this.player.mode = 'seated';
    this.player.pos.set(seat.x, seat.y - 0.05, seat.z);
    this.avatar.yaw = seat.rot;
    this.avatar.anim.setLoop(seat.kind === 'bed' ? 'lie' : 'sit');
    if (seat.kind === 'bed') { this.player.pos.y = seat.y + 0.05; }
  }
  standUp() {
    const s = this.seated;
    if (!s) return;
    this.seated = null;
    this.avatar.anim.setLoop(null);
    this.player.mode = 'foot';
    this.player.pos.set(s.x + Math.sin(s.rot) * 0.8, 0, s.z + Math.cos(s.rot) * 0.8);
    if (!this.player.interior) this.player.pos.y = this.world.collision.groundAt(this.player.pos.x, this.player.pos.z);
  }

  async onUse(u, it) {
    const r = (msg, kind = 'good') => this.ui.notify(msg, kind);
    switch (u.kind) {
      case 'heal': {
        if (this.player.health >= 100) return r('You are already healthy.', 'info');
        if (this.profile.money < 100) return r('Treatment costs $100.', 'bad');
        const res = await this.net.request('reward', { kind: 'hospital' });
        if (res.profile) this.setProfile(res.profile);
        this.setHealth(100); r('Patched up. Good as new.');
        break;
      }
      case 'snack': case 'fridge': {
        this.setHealth(Math.min(100, this.player.health + 25));
        this.avatar.anim.play('interact');
        r(u.kind === 'fridge' ? 'You raid the fridge. Delicious. (+25 health)' : 'Tasty! (+25 health)');
        if (it?.residential && !it.owned) this.police?.reportCrime?.('trespass', 1);
        break;
      }
      case 'save': this.setHealth(100); this.world.env.setTime((this.world.env.time + 8) % 24); r('You slept 8 hours. Progress saved, health restored.'); break;
      case 'hotelCheckin': {
        if (this.profile.money < 60) return r('A room costs $60.', 'bad');
        const res = await this.net.request('reward', { kind: 'hotel' });
        if (res.ok === false) return r(res.error || "Can't check in right now.", 'bad');
        if (res.profile) this.setProfile(res.profile);
        this.hotelCheckedIn = true;
        r("You're checked in. Your room is ready upstairs.");
        break;
      }
      case 'hotelroom': {
        if (!this.hotelCheckedIn) return r('Check in at reception first.', 'bad');
        this.setHealth(100); this.world.env.setTime((this.world.env.time + 8) % 24);
        r('You slept in your hotel room. Progress saved, health restored.');
        break;
      }
      case 'workout': this.avatar.anim.play('flex'); this.player.stamina = 100; r('Feel the burn! Stamina maxed.'); break;
      case 'tv': u.target && (u.target.material.emissiveIntensity = u.target.material.emissiveIntensity > 0.1 ? 0 : 0.6); break;
      case 'light': this.interiors.toggleLights(it); break;
      case 'computer': r(['You check the Applerun news: "Gorilla in tech fleece spotted downtown."', 'You scroll memes for 10 minutes.', 'Stock tip: invest in umbrella hats.'][Math.floor(Math.random() * 3)], 'info'); break;
      case 'dolma': {
        if (this.profile.money < 12) return r('A dolma costs $12.', 'bad');
        if (it?.dolmaMesh && !it.dolmaMesh.visible) return r('Out of dolma right now — wait for a new batch.', 'bad');
        const res = await this.net.request('reward', { kind: 'dolma' });
        if (res.ok === false) return r(res.error || "Can't buy that right now.", 'bad');
        if (res.profile) this.setProfile(res.profile);
        this.setHealth(Math.min(100, this.player.health + 20));
        this.avatar.anim.play('interact');
        if (it?.dolmaMesh) { it.dolmaMesh.visible = false; it.dolmaRespawnT = 15; }
        r('You buy and eat a dolma. Delicious. (+20 health)');
        break;
      }
      case 'grocery': {
        if (this.profile.money < 8) return r('Groceries cost $8.', 'bad');
        const res = await this.net.request('reward', { kind: 'grocery' });
        if (res.ok === false) return r(res.error || "Can't buy that right now.", 'bad');
        if (res.profile) this.setProfile(res.profile);
        this.setHealth(Math.min(100, this.player.health + 20));
        this.avatar.anim.play('interact');
        r('Bought groceries. (+20 health)');
        break;
      }
      case 'haircut': r('Fresh trim. Looking good — no gameplay effect, just style points.', 'good'); this.avatar.anim.play('interact'); break;
      case 'atm': r(`Balance: $${this.profile.money.toLocaleString()}`, 'info'); break;
      case 'movieTicket': {
        if (this.profile.money < 10) return r('A ticket costs $10.', 'bad');
        const res = await this.net.request('reward', { kind: 'movieTicket' });
        if (res.ok === false) return r(res.error || "Can't buy that right now.", 'bad');
        if (res.profile) this.setProfile(res.profile);
        r('Enjoy the show!');
        break;
      }
      case 'cinemaPlay': this.interiors.toggleCinema(); break;
      case 'concertVibe': this.avatar.anim.play('flex'); r('The crowd roars!', 'good'); break;
      case 'arcade': {
        if (this.profile.money < 5) return r('A game costs $5.', 'bad');
        const res = await this.net.request('reward', { kind: 'arcade' });
        if (res.ok === false) return r(res.error || 'Too soon — try again in a moment.', 'bad');
        if (res.profile) this.setProfile(res.profile);
        this.avatar.anim.play('interact');
        r(res.amount > 0 ? `High score! Net +$${res.amount}.` : res.amount < 0 ? `Game over. Net -$${-res.amount}.` : 'Broke even.');
        break;
      }
      case 'rob': {
        this.avatar.anim.play('interact');
        const res = await this.net.request('reward', { kind: 'robbery' });
        if (res.ok) { this.setProfile(res.profile); r(`You grabbed $${res.amount} from the register!`); } else r(res.error || 'Nothing to take.', 'bad');
        this.police?.reportCrime?.('robbery', 2);
        break;
      }
      default: this.handleUse?.(u, it); break;
    }
  }
  setHealth(h) { this.player.health = h; }
  remember(npc, fact) { this.dialogue?.remember(npc, fact); }
  onFx(kind, r, a) {
    if (kind === 'horn') this.audio.horn(r.avatar.position);
    else this.handleFx?.(kind, r, a);
  }
  damageSelf(amount, cause = 'world') {
    if (!this.player || this.player.mode === 'dead' || this.adminGod) return;
    if (this.net.connected && this.net.room) this.net.send('selfDamage', { amount, cause });
    else this.applyLocalDamage(amount, cause);
  }
  onLocalDeath(cause) { this.weapons.localDeath(cause === 'police' ? 'Shot by the police' : cause === 'npc' ? 'Killed in a fight' : `You died (${cause})`); }
  handleUse(u, it) {
    switch (u.kind) {
      case 'gunshop': this.weapons.openShop(); break;
      default: for (const s of this.systems) if (s.onUse?.(u, it)) return; this.ui.notify('Nothing happens.', 'info');
    }
  }
  applyLocalDamage(amount, cause) {
    const p = this.player;
    if (p.armor > 0) { const a = Math.min(p.armor, amount * 0.5); p.armor -= a; amount -= a; }
    p.health = Math.max(0, p.health - amount);
    this.hud.hitFlash(Math.min(1, amount / 40));
    if (p.health <= 0) this.onLocalDeath?.(cause);
  }

  setWaypoint(w) { this.waypoint = w; if (w) this.ui.notify('Waypoint set', 'info'); }

  // ------------------------------------------------------------------ frame
  update(dt) {
    if (this.mode === 'showroom') { this.showroom.update(dt); this.input.endFrame(); return; }
    if (this.mode === 'menu' || this.mode === 'loading') {
      this.menuT += dt;
      const c = this.engine.camera;
      const a = this.menuT * 0.03;
      const center = new THREE.Vector3(-150, 0, 0);
      c.position.set(center.x + Math.cos(a) * 320, 140, center.z + Math.sin(a) * 320);
      c.lookAt(center.x, 20, center.z);
      this.world.update(dt, center);
      this.input.endFrame();
      return;
    }
    const playing = this.mode === 'playing';
    if (playing && this.input.hit('pause') && !this.input.locked) this.pause();
    if (this.player) {
      if (playing && this.input.locked) this.cam.look(dt);
      for (const s of this.systems) s.preUpdate?.(dt, playing);
      const ctl = this.systems.find((s) => s.controlsPlayer?.());
      if (this.seated) {
        this.avatar.update(dt, { speed: 0 });
        this.cam.updateOnFoot(dt, this.avatar, false, false);
      } else if (!ctl) {
        const aiming = playing && this.input.mouse.right && (this.weapons?.canAim() ?? false);
        this.player.update(dt, this.cam, { aiming, allowMove: playing });
        this.avatar.update(dt, this.player.animState(this.cam));
        this.cam.interior = this.player.interior;
        this.cam.updateOnFoot(dt, this.avatar, aiming, this.player.crouch);
      }
      for (const s of this.systems) s.update?.(dt, playing);
      const fwd = new THREE.Vector3(); this.engine.camera.getWorldDirection(fwd);
      this.audio.setListener(this.engine.camera.position, fwd, this.engine.camera.up);
      this.world.update(dt, this.player.pos);
      this.updateAmbience(dt);
      this.hud.update(dt, this.hudState());
    }
    this.input.endFrame();
  }

  updateAmbience(dt) {
    if (!this.audio.amb) return;
    const d = districtAt(this.player.pos.x, this.player.pos.z).id;
    const city = ['downtown', 'midtown', 'eastside', 'redbrick', 'industrial'].includes(d) ? 1 : 0.35;
    const [px] = [this.player.pos.x / 1.2 + 500];
    const ocean = Math.max(0, 1 - Math.max(0, px - 180) / 120);
    const wind = Math.min(1, Math.max(0, this.player.pos.y - 20) / 60);
    this.audio.setAmbience({ city: this.player.interior ? 0.1 : city, ocean: this.player.interior ? 0 : ocean, wind, dt });
  }

  hudState() {
    const p = this.player;
    const w = this.activities?.blocksWeapons() ? { weaponName: '', slots: [], ammo: null } : this.weapons?.hud() || {};
    const blips = [];
    for (const s of this.systems) s.blips?.(blips);
    return {
      health: p.health, armor: p.armor, stamina: p.stamina, money: this.profile.money,
      clock: this.world.env.clock(), name: this.settings.get('player.name'),
      room: this.net.room ? `ROOM ${this.net.room.code} · ${this.mp.remotes.size + 1} player${this.mp.remotes.size ? 's' : ''}` : this.net.connected ? 'ONLINE · not in a room' : 'SOLO',
      wanted: this.police?.level || 0, wantedFlash: this.police?.seen,
      zone: this.player.interior ? this.player.interior.name : districtAt(p.pos.x, p.pos.z).name,
      x: p.pos.x, z: p.pos.z, heading: this.avatar.yaw + Math.PI, camYaw: this.cam.yaw,
      blips, waypoint: this.waypoint, inVehicle: !!this.vehicles?.current,
      vehicle: this.vehicles?.current ? { speed: this.vehicles.current.speed, name: this.vehicles.current.spec.name } : null,
      talking: this.voice?.transmitting, crosshair: !this.vehicles?.current && !this.activities?.blocksWeapons(), ...w,
    };
  }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
