// Activity simulations (combat, football, basketball, wrestling) run server-side per room.
const registry = {};
export function registerActivity(mode, factory) { registry[mode] = factory; }
export function createActivity(room, mode, size) {
  const f = registry[mode];
  return f ? f(room, size) : null;
}
