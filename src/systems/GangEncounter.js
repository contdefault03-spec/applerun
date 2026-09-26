import * as THREE from 'three';
import { NPC } from '../npc/NPC.js';

// v1.2 Stage 14: random neighbourhood gang events. Which of the two candidate neighbourhoods
// (see shared/map/layout.js buildGangSites()) actually has a gang is decided once, deterministically,
// when the world is generated (the same seeded rand() every client/server already uses for the
// rest of the map) — so "50% spawn chance" means "coin-flipped per world", consistent for every
// player in a room, rather than re-rolled per session. This is a fictional gang (invented name,
// colours and mark — no real nationality, flag or logo is used or referenced anywhere).
const NOTICE_R = 55, WARN_R = 34, ATTACK_R = 20, DESPAWN_R = 90;
const GANG_NAME = 'Talon Crew';

export class GangEncounter {
  constructor(game) {
    this.game = game;
    // carIds ('p'+index into the shared layout.vehicleSpawns array) and idx (this site's real
    // position in layout.gangSites, matched by the server's gangClear/vehEnter handlers) both
    // come from the layout itself — the server addresses parked cars the same way every other
    // parked car in the city is addressed, so entering one works without any special-casing.
    const sites = (game.layout.gangSites || []).filter((s) => s.active);
    this.sites = sites.map((s) => ({ ...s, npcs: [], state: 'dormant', cleared: false, warnedAt: 0 }));
    game.net.on('gangClear', (m) => this.onRemoteClear(m));
  }

  unlockCars(site) {
    const g = this.game;
    for (const vid of site.carIds) {
      const st = g.vehicles.states.get(vid); if (st) st.locked = false;
      const v = g.vehicles.vehicles.get(vid); if (v) v.locked = false;
    }
  }
  onRemoteClear(m) {
    const site = this.sites.find((s) => s.idx === m.site);
    if (!site || site.cleared) return;
    site.cleared = true;
    this.unlockCars(site);
    this.despawn(site);
  }

  spawn(site) {
    const g = this.game;
    for (const spot of site.npcSpots) {
      const y = g.world.collision.groundAt(spot.x, spot.z);
      const npc = new NPC(g.npcs, { role: 'gang', variant: Math.floor(Math.random() * 4), x: spot.x, y, z: spot.z, yaw: Math.random() * 6.28, identity: `gang${site.idx}-${site.npcs.length}` });
      // buffed: tougher and better armed than a normal street "gang" NPC
      npc.hp = npc.prof.hp = 220;
      npc.armed = true;
      npc.weapon = Math.random() < 0.5 ? 'ak47' : 'glock';
      npc.gangSite = site;
      g.npcs.add(npc);
      (g.npcs.extra ||= []).push(npc);
      site.npcs.push(npc);
    }
  }
  despawn(site) {
    const g = this.game;
    for (const npc of site.npcs) { g.npcs.extra = (g.npcs.extra || []).filter((x) => x !== npc); g.npcs.remove(npc); }
    site.npcs = [];
    site.state = 'dormant';
  }

  update(dt, playing) {
    const g = this.game;
    if (!playing || !g.player || g.player.interior || g.inActivity) return;
    for (const site of this.sites) {
      if (site.cleared) continue;
      const d = Math.hypot(g.player.pos.x - site.x, g.player.pos.z - site.z);
      if (site.state === 'dormant' && d < NOTICE_R) {
        this.spawn(site);
        site.state = 'noticed';
        g.ui.notify(`You've wandered into ${GANG_NAME} territory.`, 'info');
      } else if (site.state === 'noticed' && d < WARN_R) {
        site.state = 'warned';
        for (const npc of site.npcs) if (npc.alive) { npc.avatar.anim.play('taunt'); npc.bark?.('scared'); }
        g.ui.notify(`${GANG_NAME}: "This is our block — turn around!"`, 'bad');
        g.audio.ensureSample('gang', g.assets.url('gang')).then((ok) => {
          if (ok && site.state !== 'cleared' && !site.cleared) site.gangAudio = g.audio.playLoopFrom('gang', { x: site.x, y: 1.5, z: site.z }, { volume: 1.1, ref: 12, max: 60 });
        });
      } else if ((site.state === 'noticed' || site.state === 'warned') && d < ATTACK_R) {
        site.state = 'hostile';
        for (const npc of site.npcs) if (npc.alive) { npc.threat = g.avatar; npc.state = npc.armed ? 'shoot' : 'fight'; npc.timer = 60; }
      } else if (site.state !== 'dormant' && d > DESPAWN_R) {
        site.gangAudio?.stop(0.8); site.gangAudio = null;
        this.despawn(site);
      }
      if (site.state === 'hostile' && site.npcs.length && site.npcs.every((n) => !n.alive)) {
        site.state = 'cleared';
        site.gangAudio?.stop(1.2); site.gangAudio = null;
        this.claim(site);
      }
    }
  }

  async claim(site) {
    const g = this.game;
    const res = await g.net.request('gangClear', { site: site.idx });
    if (res.ok) {
      site.cleared = true;
      this.unlockCars(site);
      if (res.profile) g.setProfile(res.profile);
      g.ui.notify(`${GANG_NAME} crew defeated — their cars are yours. +$6,000`, 'good');
    } else {
      // someone else in the room already claimed it (or we're not connected) — still let the
      // local player take the cars since they clearly fought here, just skip the duplicate payout
      site.cleared = true;
      this.unlockCars(site);
      if (res.error && res.error !== 'Already claimed') g.ui.notify('Gang defeated.', 'good');
    }
  }
}
