// Interior placement shared by client (building the rooms) and server (validating
// that a player is inside e.g. a gun store). Every enterable building gets its own
// slot far outside the city so interiors never overlap each other or the world.
export const INTERIOR_BASE = { x: 2600, z: 2600, spacing: 90, cols: 24 };

/** True for points in the far-away interior slot area (never part of the island or sea). */
export function inInteriorSlots(x, z) { return x > INTERIOR_BASE.x - 300 && z > INTERIOR_BASE.z - 300; }

export function interiorOrigin(buildingId) {
  const i = buildingId | 0;
  return { x: INTERIOR_BASE.x + (i % INTERIOR_BASE.cols) * INTERIOR_BASE.spacing, y: 0, z: INTERIOR_BASE.z + Math.floor(i / INTERIOR_BASE.cols) * INTERIOR_BASE.spacing };
}

/** Which building interior (if any) contains the point. */
export function interiorAt(x, z) {
  const lx = x - INTERIOR_BASE.x + INTERIOR_BASE.spacing / 2, lz = z - INTERIOR_BASE.z + INTERIOR_BASE.spacing / 2;
  if (lx < 0 || lz < 0) return null;
  const c = Math.floor(lx / INTERIOR_BASE.spacing), r = Math.floor(lz / INTERIOR_BASE.spacing);
  if (c >= INTERIOR_BASE.cols) return null;
  return r * INTERIOR_BASE.cols + c;
}

export const INTERIOR_TYPE = {
  house: 'house', villa: 'house', farmhouse: 'house', cabin: 'house', beach_house: 'house', safehouse: 'safehouse', rough_house: 'house',
  apartment: 'apartment', rough_apartment: 'apartment', brick_apartment: 'apartment', tower: 'office', office: 'office',
  shop: 'shop', clothing: 'shop', cafe: 'restaurant', restaurant: 'restaurant', bar: 'bar', nightclub: 'nightclub',
  gunstore: 'gunstore', police: 'police', hospital: 'hospital', gym: 'gym', garage: 'garage', taxi_depot: 'garage', warehouse: 'warehouse', factory: 'warehouse',
};
export const RESIDENTIAL = new Set(['house', 'apartment', 'safehouse']);
