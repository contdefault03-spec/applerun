import { WEAPONS, SHOP_ITEMS } from './weapons.js';

// Authoritative economy rules (used by the server, and by the offline backend).
export const START_MONEY = 2500;
export const LIMITS = { taxiMaxPay: 900, wantedFineMax: 5000 };

export function newProfile() {
  return {
    money: START_MONEY,
    weapons: ['fists', 'pistol'],
    ammo: { pistol: 13 + 39 },
    armor: 0,
    medkits: 1,
    ownedVehicles: [],
    property: null,
    stats: { kills: 0, deaths: 0, taxiRides: 0, goals: 0, points: 0, wrestlingWins: 0, arrests: 0 },
    npcMemory: {},
  };
}

export function applyPurchase(p, itemId, qty = 1) {
  const it = SHOP_ITEMS[itemId];
  if (!it) return { ok: false, error: 'Unknown item' };
  qty = Math.max(1, Math.min(10, qty | 0));
  const cost = it.price * qty;
  if (it.kind === 'weapon' && p.weapons.includes(it.id)) return { ok: false, error: 'You already own this weapon' };
  if (p.money < cost) return { ok: false, error: 'Not enough money' };
  if (it.kind === 'armor' && p.armor >= 100) return { ok: false, error: 'Armor already full' };
  p.money -= cost;
  if (it.kind === 'weapon') {
    p.weapons.push(it.id);
    const w = WEAPONS[it.id];
    if (w.mag) p.ammo[it.id] = (p.ammo[it.id] || 0) + w.mag * 2;
  } else if (it.kind === 'ammo') {
    p.ammo[it.weapon] = Math.min(999, (p.ammo[it.weapon] || 0) + it.amount * qty);
  } else if (it.kind === 'armor') p.armor = 100;
  else if (it.kind === 'health') p.medkits = Math.min(5, (p.medkits || 0) + qty);
  return { ok: true, item: it, cost };
}

// Rewards are validated by the caller (server checks job/position data); amounts are clamped here.
export function applyReward(p, kind, data = {}) {
  let amount = 0;
  switch (kind) {
    case 'taxi': amount = Math.max(0, Math.min(LIMITS.taxiMaxPay, Math.round(data.amount || 0))); p.stats.taxiRides++; break;
    case 'kill': amount = 0; p.stats.kills++; break;
    case 'goal': amount = 50; p.stats.goals++; break;
    case 'points': amount = Math.min(30, (data.points | 0) * 10); p.stats.points += data.points | 0; break;
    case 'matchWin': amount = 250; break;
    case 'wrestlingWin': amount = 200; p.stats.wrestlingWins++; break;
    case 'death': amount = 0; p.stats.deaths++; break;
    case 'hospital': amount = -Math.min(p.money, 200); break;
    case 'hotel': amount = -Math.min(p.money, 60); break;
    case 'arrest': amount = -Math.min(p.money, Math.max(0, Math.min(LIMITS.wantedFineMax, data.fine | 0))); p.stats.arrests++; break;
    case 'robbery': amount = Math.max(0, Math.min(600, data.amount | 0)); break;
    case 'police': amount = Math.max(0, Math.min(300, data.amount | 0)); break;
    case 'paramedic': amount = 120; break;
    case 'tip': amount = -Math.min(p.money, 5); break;
    case 'repair': amount = -Math.min(p.money, 150); break;
    case 'event': amount = Math.max(0, Math.min(200, data.amount | 0)); break;
    case 'fishing': amount = data.role === 'ajan' ? 25000 : 20000; break;
    case 'dolma': amount = -Math.min(p.money, 12); break;
    case 'grocery': amount = -Math.min(p.money, 8); break;
    case 'arcade': amount = Math.max(-15, Math.min(15, Math.round(data.amount || 0))); break;
    case 'movieTicket': amount = -Math.min(p.money, 10); break;
    case 'gangClear': amount = 6000; break;
    default: return { ok: false, error: 'bad reward' };
  }
  p.money = Math.max(0, p.money + amount);
  return { ok: true, amount };
}
