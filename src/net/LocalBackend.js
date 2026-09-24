import { WEAPONS, SHOP_ITEMS } from '../../shared/weapons.js';
import { applyPurchase, newProfile, applyReward } from '../../shared/economy.js';

// Offline stand-in for the server's authoritative handlers (solo play only).
// The same shared economy rules are used by the real server.
export class LocalBackend {
  constructor(game) {
    this.game = game;
    try { this.profile = JSON.parse(localStorage.getItem('bayview.localProfile')) || newProfile(); } catch { this.profile = newProfile(); }
  }
  save() { localStorage.setItem('bayview.localProfile', JSON.stringify(this.profile)); }
  async handle(op, data) {
    switch (op) {
      case 'getProfile': return { ok: true, profile: this.profile };
      case 'buy': {
        const r = applyPurchase(this.profile, data.item, data.qty || 1);
        if (r.ok) this.save();
        return { ...r, profile: this.profile };
      }
      case 'reward': {
        const r = applyReward(this.profile, data.kind, data);
        if (r.ok) this.save();
        return { ...r, profile: this.profile };
      }
      case 'fine': {
        this.profile.money = Math.max(0, this.profile.money - (data.amount || 0));
        this.save();
        return { ok: true, profile: this.profile };
      }
      case 'setAmmo': {
        if (data.weapon && this.profile.ammo[data.weapon] !== undefined) this.profile.ammo[data.weapon] = Math.max(0, data.ammo | 0);
        this.save();
        return { ok: true };
      }
      case 'npcMemory': {
        const mem = (this.profile.npcMemory ||= {});
        if (data.set) { mem[data.npc] = data.set; this.save(); }
        return { ok: true, memory: mem[data.npc] || null };
      }
      case 'listRooms': return { ok: true, rooms: [] };
      default: return { ok: false, error: 'offline' };
    }
  }
}
export { WEAPONS, SHOP_ITEMS };
