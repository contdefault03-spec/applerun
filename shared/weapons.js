// Weapon definitions shared by client (feel, visuals) and server (validation, damage).
// damage: per bullet; rpm: rounds per minute; spread: radians (hip), aimSpread: when aiming;
// recoil: camera kick per shot; range: max effective distance (m); falloff: damage at max range fraction.
export const WEAPONS = {
  fists: { id: 'fists', name: 'Fists', short: 'FIST', slot: 1, type: 'melee', damage: 12, rpm: 150, range: 1.8, anim: 'fists', price: 0 },
  knife: { id: 'knife', name: 'Combat Knife', short: 'KNIFE', slot: 1, type: 'melee', damage: 34, rpm: 110, range: 2.0, anim: 'knife', price: 150 },
  pistol: { id: 'pistol', name: 'P250 Pistol', short: 'P250', slot: 2, type: 'pistol', damage: 26, rpm: 380, mag: 13, reserve: 52, reload: 1.4, spread: 0.02, aimSpread: 0.006, recoil: 0.018, range: 60, falloff: 0.6, auto: false, anim: 'pistol', sound: 'pistol', price: 300, ammoPrice: 20 },
  glock: { id: 'glock', name: 'G-18 Pistol', short: 'G18', slot: 2, type: 'pistol', damage: 22, rpm: 480, mag: 20, reserve: 100, reload: 1.3, spread: 0.022, aimSpread: 0.008, recoil: 0.014, range: 55, falloff: 0.55, auto: false, anim: 'pistol', sound: 'glock', price: 200, ammoPrice: 20 },
  deagle: { id: 'deagle', name: 'Desert Hawk .50', short: 'D.HAWK', slot: 2, type: 'pistol', damage: 58, rpm: 220, mag: 7, reserve: 35, reload: 1.9, spread: 0.03, aimSpread: 0.004, recoil: 0.06, range: 80, falloff: 0.7, auto: false, anim: 'pistol', sound: 'deagle', price: 700, ammoPrice: 35 },
  ak47: { id: 'ak47', name: 'AK-47', short: 'AK-47', slot: 3, type: 'rifle', damage: 34, rpm: 600, mag: 30, reserve: 90, reload: 2.4, spread: 0.035, aimSpread: 0.012, recoil: 0.028, range: 120, falloff: 0.75, auto: true, anim: 'rifle', sound: 'ak47', price: 2700, ammoPrice: 60 },
  m4a1: { id: 'm4a1', name: 'M4A1', short: 'M4A1', slot: 3, type: 'rifle', damage: 29, rpm: 680, mag: 30, reserve: 90, reload: 2.1, spread: 0.028, aimSpread: 0.008, recoil: 0.02, range: 120, falloff: 0.8, auto: true, anim: 'rifle', sound: 'm4a1', price: 3100, ammoPrice: 60 },
  bolt: { id: 'bolt', name: 'AWP-style Bolt Sniper', short: 'BOLT', slot: 4, type: 'sniper', damage: 115, rpm: 42, mag: 5, reserve: 20, reload: 3.4, spread: 0.12, aimSpread: 0.0005, recoil: 0.1, range: 400, falloff: 0.95, auto: false, scope: 18, anim: 'sniper', sound: 'bolt', price: 4750, ammoPrice: 100 },
  semisniper: { id: 'semisniper', name: 'Marksman Semi-Auto', short: 'DMR', slot: 4, type: 'sniper', damage: 70, rpm: 180, mag: 10, reserve: 40, reload: 2.8, spread: 0.08, aimSpread: 0.0015, recoil: 0.05, range: 300, falloff: 0.9, auto: false, scope: 28, anim: 'sniper', sound: 'semisniper', price: 3800, ammoPrice: 80 },
  grenade: { id: 'grenade', name: 'Frag Grenade', short: 'FRAG', slot: 5, type: 'grenade', damage: 115, radius: 7, mag: 1, reserve: 0, throwSpeed: 15, fuse: 1.5, anim: 'throw', price: 400, ammoPrice: 400 },
};
export const HEADSHOT_MULT = { pistol: 2.5, rifle: 3, sniper: 2.2, melee: 1.3 };

export const SHOP_ITEMS = {
  ...Object.fromEntries(Object.values(WEAPONS).filter((w) => w.price > 0).map((w) => [w.id, { id: w.id, kind: 'weapon', name: w.name, price: w.price }])),
  ...Object.fromEntries(Object.values(WEAPONS).filter((w) => w.ammoPrice).map((w) => [`ammo_${w.id}`, { id: `ammo_${w.id}`, kind: 'ammo', weapon: w.id, name: `${w.name} ammo (${w.mag})`, price: w.ammoPrice, amount: w.mag }])),
  armor: { id: 'armor', kind: 'armor', name: 'Body Armor', price: 650 },
  medkit: { id: 'medkit', kind: 'health', name: 'Medkit', price: 120 },
};
