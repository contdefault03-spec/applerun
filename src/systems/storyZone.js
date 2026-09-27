import * as THREE from 'three';

// The story intro's forest/chase sequence happens in an isolated pocket, far outside the real
// city's heightfield bounds. Shared between StoryIntro (which builds the pocket) and Collision
// (which must not let anything standing in it — the player, NPCs, vehicles — fall through to the
// real terrain's height at these far-off coordinates, which resolves to open-ocean sea floor).
export const STORY_ORIGIN = new THREE.Vector3(3200, 0, 3200);
export const STORY_RADIUS = 130;

export function inStoryZone(x, z) {
  return Math.hypot(x - STORY_ORIGIN.x, z - STORY_ORIGIN.z) < STORY_RADIUS;
}
