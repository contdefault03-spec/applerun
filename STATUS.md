# Alfredo Applerun: upgrade status

Branch: `claude/sleepy-edison-fy6ywm`. The upgrade runs in stages. For each stage:
1. Say the plan in a few lines.
2. Implement it.
3. Run the game and take before/after screenshots (`node tools/views.mjs <dir> [url] [views]`).
4. Fix anything broken, then commit and push.

Never break existing gameplay or multiplayer.

## Rules from the owner (apply to every stage)

**Performance**
- Keep 60 fps on a mid-range gaming laptop.
- Use LOD, instancing, frustum culling, KTX2 textures and Draco/Meshopt models.
- Load interiors only when the player is near or inside a building.

**Assets**
- Use free CC0 / CC-BY assets only (Poly Haven, ambientCG, Quaternius, Kenney, CC0/CC-BY Sketchfab).
- Download them with a script (`tools/fetch-assets.mjs`) into `public/assets/`.
- List every asset, its source and licence in `CREDITS.md`.
- Where nothing can be downloaded, make it yourself, but try ready-made assets first.
- The network in this environment blocks polyhaven.com, ambientcg.com, kenney.nl, quaternius.com and sketchfab. GitHub (raw + git clone) and npm work. The fetch script falls back to GitHub mirrors of the same files. To get the real packs, the owner can add those hosts under Network access in the cloud environment settings.

**Naming and content**
- No real brand names, logos or badges.
- Cars are "inspired by" real supercars and sedans (Porsche, BMW, Lamborghini…) and get invented names.
- The game is called **Alfredo Applerun** (was "Bayview"). Internal localStorage keys `bayview.*` and the Render service name `bayview-server` are kept on purpose so saves and the deployment keep working.

**Owner-supplied files**
- If something needs files the owner must provide (e.g. Mixamo animations behind a login), say exactly what to download and where to put it.
- `fish.mp3` is already in `public/assets/audio/fish.mp3` and in `src/assets/manifest.js` (id `fish`, loaded as audio sample `fish`).

## Done

### Stage 0: bug fixes
- **F key:**
  - Vehicle enter/exit is edge-triggered: `Input.consume()`, a request-in-flight guard, and a 0.5 s wall-clock cooldown (`VehicleManager.beginToggle`).
  - `Interaction` uses a wall-clock debounce.
- **Light pool:** `src/fx/LightPool.js` gives muzzle flashes, explosions, headlights, the police heli spotlight and interior lights a fixed set of lights. The light count never changes, so there are no shader recompiles.
- **Pre-warm:** `src/core/Prewarm.js` compiles and renders all weapons, vehicles, characters, NPC variants, effects and the post chain behind the loading screen.
- **Audio:** audio nodes are warmed up, including HRTF.
- **Stutter probe:** `tools/stutter.mjs` reports 0 new shader programs for first shot, explosion, vehicle entry, NPC spawn and interiors.
- **Rename and fish.mp3:** rename done, `fish.mp3` added.

### Stage 1: island
- Heightfield extends 320 m past every map edge (`shared/map/terrain.js`, `islandHeight`):
  - the land keeps its shape and falls to beaches, or to cliffs where it is high;
  - the north mountain slopes into the sea;
  - the map layout is unchanged.
- Terrain is split into 230 m LOD chunks (3 levels plus skirts) and is frustum culled.
- Endless ocean: a camera-following disc with shallows and surf from a height texture, fading into the horizon haze.
- No invisible walls. Swimmers are pushed back 230 m out. Boats may go further (not built yet).
- `inInteriorSlots()` replaces the old map-bound interior check.

### Stage 2: lighting and atmosphere
- `src/world/SkySystem.js`:
  - blends three Poly Haven HDRIs (day `sky.hdr` from @pmndrs/assets, `kiara_1_dawn`, `dikhololo_night`) by time of day;
  - rotates each so its sun matches the game sun;
  - paints out the photographed horizon at load;
  - draws a sun disc and a haze band;
  - captures a PMREM environment for image-based lighting every few seconds.
- The ocean reflects the actual HDRI sky.
- Cascaded shadow maps (3×2048 on high, 2×1024 on medium) are applied globally via shader chunks (`src/world/GlobalShading.js`).
- Render layers (`src/world/layers.js`) limit small casters to the near cascades.
- Max casts shadows from a meshoptimizer-simplified proxy.
- Height fog with aerial perspective.
- Post chain in `src/core/PostFX.js` (pmndrs postprocessing + N8AO): AO on high, night-tuned bloom, exposure, ACES, split-tone grade, vignette, SMAA. There is a Settings toggle; the chain is off on the low preset.
- `mergeStatic` / `splitByCells` in `src/world/mergeStatic.js` cut draw calls.

### Stage 3: partial (this commit)

**Done:**
- **PBR texture generator**, `tools/gen-textures.mjs` (+ `tools/texgen/`):
  - Procedural, tileable sets for grass, dirt, sand, rock, snow, asphalt, pavement, concrete (kerbs) and bark.
  - A foliage atlas: broadleaf cluster, small-leaf cluster, pine branch, palm frond, grass tuft, flowers (colour + alpha, normal).
  - A street-parts atlas: manhole cover, drain grate.
  - Written as **KTX2** (ETC1S albedo+roughness, UASTC+RDO+zstd normals at 512²) into `public/assets/textures/` (~4.9 MB).
  - Transcoder in `public/basis/`.
  - Regenerate with `node tools/gen-textures.mjs [names] [--preview]`.
- **`src/world/TextureLib.js`:** KTX2Loader wrapper. Packs the six terrain layers into `CompressedArrayTexture`s.
- **Terrain splat material**, `src/world/TerrainMaterial.js`:
  - Six layers: grass, dirt, sand, rock, snow, paving.
  - Per-vertex weights from height, slope and district (`makeSurfaceFn` in `src/world/Terrain.js`), broken up with noise and sharpened.
  - Triplanar rock on cliffs, two-scale anti-tiling, macro variation.
  - Snow only above ~110 m and not on steep slopes. Rock on slopes and above ~80 m.
  - Falls back to the old material if textures fail to load.
- **Road material**, `src/world/RoadMaterial.js`:
  - PBR asphalt with world-space UVs and tyre tracks.
  - Procedural lane markings per road class with wear. Highway: white edges, double yellow, dashed lanes. Main: edges plus double yellow. Street: dashed centre. Mountain: edges plus solid yellow.
  - Markings masked out inside junctions.
- **`createPlanarMaterial`:** a generic PBR material with world-space planar UVs.
- **`src/world/Roads.js` rewrite:**
  - Resampled ribbons (winding fixed, the material is front-sided).
  - Concrete kerbs (top + face) and paved sidewalks.
  - Zebra crossings and stop lines at urban junctions.
  - Manholes and kerbside drains.
  - Kerbed grass medians on urban main roads, broken at junctions, with colliders. Tree positions are returned as `medianTrees` in `World.medianTrees`; they aren't planted yet.
- Tests pass (12/12) and the build succeeds.
- Screenshots in `shots/stage3/` (git-ignored) show textured terrain, the snow cap and roads with markings.

**Done (this commit):**
- Eye-level QA pass (`node tools/views.mjs`, street view): road markings, kerbs and grass read fine at ground level; grass tone/saturation is acceptable as generated, no retune needed. Draw calls/triangles checked with `tools/perf.mjs` (~780 calls, ~1.0M triangles at street level — down from the Stage 2 baseline of ~1.7M, since the new trees are far cheaper than the old blob geometry).
- **Trees:** `src/world/Trees.js` — bark-textured trunks (`createPlanarMaterial` on the generated `bark` KTX2) plus foliage-atlas "cross card" canopies (2–4 alpha-tested quads fanned around the trunk per tree) cut from `foliage_ca.ktx2`'s broadleaf/pine/palm cells, with a per-instance wind sway in the canopy vertex shader (`uTime`, driven from `World.update` like the water shader). Three species (broadleaf, pine, palm), instanced, same layout positions as before (`P.trees`, `P.palms`) plus `World.medianTrees` (boulevard trees on urban medians, previously unused). Replaces the solid-colour icosahedron/box trees that were in `src/world/Props.js`. No separate LOD/impostors yet — cards are cheap enough that it wasn't needed to hit the triangle budget (see perf numbers above); worth revisiting only if a future perf pass shows otherwise.

- **Plants:** `src/world/Plants.js` + shared `src/world/Foliage.js` (card/cluster/material helpers factored out of `Trees.js`). Bushes/hedges scattered around house gardens (`house`/`villa`/`beach_house`/`cabin`/`farmhouse` buildings, `shared/map/layout.js` `plants` array) plus flower and grass-tuft patches in the plaza park, using the small-leaf/flower/grass atlas cells with the same wind-sway shader as the trees, much smaller amplitude. No colliders on flowers/grass (walk-through); bushes get a small walkable-but-blocking collider.

- **Street furniture:** `src/world/Props.js` + new positions in `shared/map/layout.js` (`bollards`, `bikeRacks`, `busStops`, `signs`). Hydrants, benches, bins and street lamps already existed; added bollards along street/main shoulders, bike racks by shops/cafés, bus-stop shelters along main roads, and stop-sign-style corner signs at minor junctions — all instanced with colliders. **Traffic lights now work:** each lit intersection gets 4 signal poles (2 per approach group, matching how `Traffic.js`'s `lightGreen()` groups cars), each with an emissive head whose colour `Traffic.updateLights()` sets every frame from the same 26 s cycle (green → 3 s amber → red), so the poles agree with when AI cars actually stop.
- Add a credits line for the generated textures in `CREDITS.md` (done: see "Generated in code").

## Remaining stages (owner's full requirements)

### Stage 3: realistic terrain, roads and nature (finish)
- PBR textures (albedo + normal + roughness) for grass, dirt, sand, asphalt, pavement, kerbs, rock and snow. **Done.**
- Mountain: grass at the bottom, then rock, then snow only near the top, blended by height and slope. **Done.**
- Real road markings, crossings, kerbs, manholes and drains. **Done, QA'd at eye level.**
- Realistic tree models of several species (leafy trees, pines, palms) with proper leaf textures and wind sway. Bushes, hedges, flower beds and grass patches around houses and parks. **Done** (`src/world/Trees.js`, `Plants.js`, `Foliage.js`).
- Boulevards with tree rows down the middle, and street furniture everywhere: hydrants, benches, bins, bus stops, street lamps, traffic lights, signs, bollards, bike racks. **Done** (median trees now planted; furniture in `Props.js`; working traffic-light heads in `Traffic.js`).

### Stage 4: buildings (mostly done)
- **Houses:** `src/world/Buildings.js` — a pastel paint palette (`HOUSE_PALETTE`) is multiplied over the render/siding facade texture per building (was a near-grayscale tint before, now genuinely colourful), and ~30% of houses use the brick facade instead, so neighbours read as different materials as well as different colours. Roofs: gables (5 tile colours) for most, a flat-roof-with-parapet alternative for the rest (shape variety, `PITCHED` branch). Fences: new `shared/map/layout.js` `props.fences` — a low rail around the garden perimeter with a gap left on the door side, rendered in `src/world/Props.js`. Gardens/driveways: bushes/flowers from Stage 3's `Plants.js` plus the existing parked-car driveway spawns already cover this. **Done.**
- **Apartment blocks / balconies:** `addBalconies()` in `Buildings.js` adds real 3D floor-slab + railing balconies (not just a texture line) on a random subset of bays on every upper floor, for `apartment`-style buildings and for houses/villas tall enough to have a second floor. No plants/chairs/laundry detail on them yet — flagged below.
- **Skyscrapers:** the `glass` facade material now has an interior-mapping fragment shader (`onBeforeCompile` in `Buildings.js`): each window cell (`fract(vMapUv)` = per-bay-per-floor local UV) fakes a little room — floor/ceiling gradient, a desk-height band, a random ceiling light strip, and an occasional person-silhouette blob, all from a per-cell hash, no textures needed. Reads well in daylight (see QA screenshot); at night the existing flat per-building window-glow emissive (`Environment.js`, `0.35 × night`) still washes it out into a uniform glow — that's the pre-existing "solid grid" stopgap, not yet fixed (see note below). Real modelled/walkable lower office floors: **not done** — that's an interior-generation job, deferred to Stage 5's interior kit rather than duplicated here.
- **Night:** neon shop/club/pub signs (`SIGNS` table) now pulse from a dim daytime glow to a bright neon look at night via a new `Environment.neonMaterials` array (`0.15 + 1.1 × night`), instead of a fixed intensity day and night. "Random windows lit" (as opposed to the whole building glowing uniformly) is still the one open item — the facade texture is one repeating tile per style, so every window on a building currently lights the same; doing real per-window randomness needs one quad per bay instead of one per wall face, which is a bigger geometry change than this pass covered.
- Notes:
  - Buildings are in `src/world/Buildings.js`: facades merged per style, then split into 200 m cells in `World.js`.
  - Glass towers still glow as solid grids at night (window emissive at `0.35 × night`, uniform per building) — the interior-mapping shader improves the *daytime* look; true random-lit-windows at night is the remaining piece of this stage.

### Stage 5: interiors everywhere, all different (partly done — was already further along than this file said)
- **Already in place before this pass** (found, not newly built): `src/interiors/InteriorManager.js` generates a distinct, furnished interior for every enterable building — house/safehouse/apartment, shop, restaurant/bar, gunstore, police, hospital, gym, garage, office, warehouse, plus the wrestling dome — each with its own layout, working interactions (buy a snack/drink for health, get treated at the hospital, browse the gun store, repair a car, rob the register/bar, turn yourself in, sign up for police duty, sleep & save at the safehouse) and NPC spots. Interiors live far outside the map (`shared/interiors.js`) and are only built/spawned on demand (`InteriorManager.get`/`.enter`), never simulated while empty.
- **New this commit — nightclub:** a `nightclub` building (assigned near the existing bar, `shared/map/layout.js`, `Buildings.js` sign "NEON CLUB") with its own interior: a DJ booth, a 5×5 colour-cycling disco dance floor (`it.discoTiles`, updated in `InteriorManager.update`), a bar with patrons and a bartender, and a generative positional "club beat" (`AudioManager.clubBeat`) that plays while you're inside, louder near the DJ booth. Patron NPCs stand around the floor rather than actually dancing — no new NPC animation state was added, so this is not full crowd-dancing.
- **Not done:** the other new building types (clinic, dentist, pharmacy, cinema, supermarket, barber, bank, arcade); ATM usable action; ability to watch a film in the cinema; ready-made per-house furniture-layout variety (houses currently vary by wall/sofa/roof colour and facade material, per Stage 4, but the furniture *layout* inside is the same for every house — only the palette differs); pubs/concert hall with animated crowds and lights-synced-to-music beyond the one nightclub; true distance-based audio muffling from outside a venue (the interior is a physically separate slot, so there's no "hear it through the wall while standing outside" effect to muffle).
- Notes:
  - Interiors live in `src/interiors/InteriorManager.js`, placed in far slots (`shared/interiors.js`).
  - Load interiors only when the player is near or inside.
  - Interior lights use `LightPool` (3 pooled lights); the nightclub reuses the same pool for its colour-cycling lights.

### Stage 6: mountain ski resort and hotel — done
- **Ski resort:** a new `resort` landmark footprint (`shared/map/layout.js`) near the peak, with the terrain flattened to a plateau at its natural (non-sea-level) height (`shared/map/terrain.js`) so the lodge doesn't sit on a slope. `src/world/Landmarks.js` builds a wood-and-glass lodge, two lift towers, a cable, and 6 gondola cabins that ping-pong back and forth along it (`World.update`, `this.skilifts`) — visual only, not rideable, as the brief allows. Snowy slopes were already there from Stage 3's height/slope-blended snow.
- **Hotel:** a `hotel` building (assigned near the pier/beachfront, `Buildings.js` sign "SEABREEZE HOTEL") with an interior (`InteriorManager.js`) combining a reception (pay $60 to check in, server-validated in `server/rooms.js` / `shared/economy.js` like the hospital/repair rewards), a small restaurant corner (buy room service for health) and a decorated room. The room's "sleep & save" interaction only works once checked in (`Game.js` `hotelCheckin`/`hotelroom`); the "room key" is a session flag (`game.hotelCheckedIn`), not a persisted item.

### Stage 7: cars (mostly already done — small addition this pass)
- **Already in place before this pass** (found, not newly built): `src/vehicles/VehicleModels.js` procedurally builds a distinct low-poly model per class (sedan, rusty sedan, sports, SUV, taxi, police, ambulance, van, box truck, motorcycle), each with a visible interior (seats, dash, steering wheel), headlights/tail-lights, and police/taxi/ambulance-specific detailing (light bars, checker stripe, red-cross panels). Handling is already tuned per class in `SPECS` (sports car: `accel 12, grip 9.5`; truck: `accel 4.2, grip 6, mass 7000`). `Traffic.js` already spawns a realistic weighted mix (sedans common, sports/police rarer) with multiple paint colours per class. Invented names only (no real logos or brand badges) throughout.
- **New this commit:**
  - A second, distinct supercar class, `hypercar` ("Scorpio GTX" — an invented name): lower (1.05 m), wider-track, sharper "wedge" cabin proportions (`s.wedge` flag reshapes the greenhouse — shorter cabin set further back, lower windscreen) than the existing generic `sports` class, and the fastest/grippiest spec (`maxSpeed 78, accel 14, grip 10.5`). Added to `Traffic.js`'s weighted mix at a low weight (rare, as required).
  - **Two-tone / stripe paint:** `buildVehicle(type, color, accent)` now takes an optional accent colour and adds a centre racing stripe over the hood/roof; `Traffic.js` gives ~30% of sedans/sports/hypercars a contrasting stripe (white/black/gold) picked per spawn.
- **Not done:** turn indicators (headlights/tail-lights exist and already react to night/braking, but no left/right blinker state); more supercar/luxury-sedan body variety beyond the two sports-class shapes; a player-facing car dealer/customisation UI (cars are currently obtained by carjacking, same as before this stage).
- Notes: `src/vehicles/VehicleModels.js` (SPECS, `buildVehicle`), `Vehicle.js`, `VehicleManager.js`, `Traffic.js`.

### Stage 8: the pier and amusement park (amusement park done; pier "destination" feel partial)
- **Amusement park, done this commit** (`src/world/Landmarks.js`, animated in `World.update`):
  - Ferris wheel — already existed.
  - **Carousel:** platform + canopy + 8 horses on poles, spinning as one group (reuses the existing generic `userData.spin` handling).
  - **Roller coaster:** a closed `CatmullRomCurve3` loop around the ferris wheel plaza with support posts, and 3 cars that run around it continuously (`World.coasterCars`, excluded from static merging like the ski lift cabins) — animated, not rideable, as the brief allows.
  - A few food stalls added along the pier deck.
- **Fishing-mission boat:** a moored boat is now placed at the very end of the pier (`shared/map/layout.js` `props.boats`, flagged `fishing: true`) so Stage 9 has something to hook into. Stage 9 itself (the mission) is not started.
- **Not done:** an arcade on the pier; enterable houses/cafés specifically *along the pier* (the general building/interior system from Stages 4–5 covers houses/cafés elsewhere in the city, but none were added to the pier itself); a party at the end (music/dancing NPCs/lights — the nightclub built for Stage 5 covers the "one venue with lights + music + crowd" idea, but not on the pier); confirmation that pedestrian NPCs actually walk the pier (not verified this pass).
- Notes: pier landmarks are `pier` and `pierEnd` in the layout.

### Stage 9: fishing mission (core flow done; presentation is a placeholder)
- **Done:** `src/systems/FishingMission.js` (new system, registered in `Game.js`). Press E at the boat at the end of the pier (a real drivable `boat` vehicle — see Stage 7 vehicle notes — spawned from `shared/map/layout.js`'s `vehicleSpawns`, flagged `fixed: 'fishingBoat'`) to start a 20 s join window; every player within range when it ends joins (`this.participants`), and the boat is driven ~500 m out to sea along the pier's own heading, with a waypoint marker (`Game.setWaypoint`). After ~30 s at the spot, a bite triggers a splash-particle burst (`Effects.spawn`) and a noise-burst sound. Only the player playing **Ajan** (`avatar.key === 'ajan'`, the existing selectable character) sees "Press E to grab the fish"; grabbing plays `fish.mp3` positionally for everyone nearby (broadcast over the existing generic `fx` relay, `server/rooms.js`, so remote players hear it too) and pays out through the server economy — a new `fishing` reward kind (`shared/economy.js`, `server/rooms.js`) rate-limited server-side, same pattern as the existing taxi/paramedic/police "client-simulated job" rewards — $20,000 to participants, $25,000 to Ajan. If no one in the party is Ajan, the trip is refused with a message instead of starting. Verified end-to-end in a scripted single-player run (join → sail → arrive → bite → grab → payout).
- **Not done / simplified:**
  - No modelled fishing rod, line, bobber or casting animation — casting is a notification, not a visible action.
  - No synced cinematic camera cut to Ajan or slow-motion tuna model; the "catch" is a particle splash + sound, not a Khronos `BarramundiFish`-based fish model breaching the water.
  - The 20 s join window is tracked locally by whoever presses E first, not server-authoritative, and there's no "host picks the lucky fisher" fallback — it simply refuses to start without an Ajan.
  - The return trip isn't specially tracked — driving back to the pier just means driving there; there's no explicit "mission ended" state tied to arrival.
- Notes:
  - Server rooms are in `server/rooms.js`; rewards go through `shared/economy.js` `reward` kinds.
  - The Khronos glTF sample `BarramundiFish` (CC0) could still be added as the tuna model for a future pass.

### Stage 10: combat mode upgrade (CS2 style) — rules mostly already done; scoreboard added; arena map still missing
- **Already in place before this pass** (found, not newly built): `server/activities/combat.js` already runs real CS-style rounds — buy phase, live phase, round timer, first-to-5-rounds, per-round match-only money (`START_MONEY`/`WIN_BONUS`/`LOSS_BONUS`/`KILL_BONUS`, capped), a buy menu UI (`ActivityManager.js`'s lobby panel), out-of-bounds damage to keep players inside `venue.combat`, and returning players' real money/weapons untouched after leaving (the activity system swaps loadouts in and back out via `rememberWorld`/`leave`). Recoil, spread, headshot multipliers and armour purchases already exist in `shared/weapons.js` / `src/combat/WeaponManager.js`.
- **New this commit — scoreboard:** holding/toggling Tab (`inventory` binding) during a live combat round now shows a proper scoreboard (`ActivityManager.renderScoreboard`) with kills, deaths and match money per player, both teams — previously Tab only closed the buy/team lobby panel, and that panel is deliberately hidden during live rounds so it doesn't block the view, leaving no scoreboard at all during a fight. Assists aren't tracked anywhere server-side, so that column always reads "–".
- **Not done:**
  - **The arena map itself.** `venue.combat` is only an invisible bounding box at real city coordinates (near the industrial district) — there is no actual desert-town geometry (walls, crates, bomb sites, mid lane, arches). Building one properly needs either new isolated geometry at that spot (risking overlap with whatever the city procedurally placed there already) or relocating the venue to dedicated space outside the normal heightfield (risky to do quickly without checking how `heightAt`/`collision.groundAt` behave out of bounds) — both need more care than this pass had budget for.
  - **Grenades** (HE/flash/smoke) — explicitly "if possible" in the brief; skipped in favour of the scoreboard and other stages, given the size of a new throwable-weapon subsystem.
  - **Halftime side swap** — rounds currently just count up to 5 with no team-swap partway through.
  - An in-world "army barracks" entrance — combat (like the other activities) is currently entered through the Activities menu, not a walk-up building.
- Notes: `server/activities/combat.js`, `src/activities/ActivityManager.js`, `src/combat/WeaponManager.js`, `shared/weapons.js`.

### Stage 11: football upgrade — possession done; AI was already decent
- **Possession, done this commit:** `shared/sports/football.js` now has a real `possessor` field. A loose, slow (< 7 m/s), low ball sticks to the nearest eligible player (`stepBall`) and is carried at their feet each frame instead of being a free physics object; it's released on `kick()` (pass/shoot) and re-picked-up by whoever gets there next. `tackle()` now gives the tackler outright possession ~55% of the time on a successful challenge ("wins it, the ball sticks to them instead"); the rest of the time it squirts loose for anyone to chase. Verified with a scripted step-by-step check (pickup + carry-with-player).
- **Power/loft:** shots already scaled loft with aim (camera pitch) rather than charge; passes only had a binary "lob past 70% charge" — changed to scale continuously with charge (`ActivityManager.js`) so a longer hold gives a proportionally higher chip, not a step function.
- **Smarter AI — already mostly in place before this pass** (found, not newly built): `stepAI` already picks a single chaser per team (not everyone piling on the ball), holds off-ball players in shape shifted toward the ball, pushes forwards up to make runs, has the keeper commit out of the box when the ball is close and deep in their third, and already scores passes by teammate advancement + how open they are before choosing to pass, dribble or shoot. Not changed further this pass.
- Notes: `shared/sports/football.js` (runs on the server for rooms, locally for solo).

### Stage 12: basketball upgrade
- The same smarter AI: off-ball players cut, space the floor and get open for passes.
- Defenders stick to their man; better rebounding and passing decisions.
- Nobody swarms the ball.
- Notes: `shared/sports/basketball.js`.

### Stage 13: maps
- **M = simple map:** the island with only key icons (hospitals, gun stores, police, garages, your safehouse/hotel room, mission start points).
- **K = detailed map:**
  - Zoomable and pannable, showing every place with its name and icon: pubs, clubs, concert halls, restaurants, cafés, cinemas, hospitals, clinics, hotels, shops, apartments, offices, landmarks and the resort.
  - Click a place to set a GPS waypoint shown on the minimap.
- All named places must match real enterable buildings in the world.
- Notes: the current map is in `src/ui/HUD.js` (`#bigmap`).

### Stage 14: admin/debug menu (key 9)
- Pressing 9 opens a menu with:
  - God mode (no damage).
  - Fly mode: double-tap Space to start flying; Shift = up, Ctrl = down, WASD to move; double-tap Space again to stop.
  - Fly speed slider.
  - Give all weapons + max ammo.
  - Heal / refill armour.
  - Teleport to any named place (use the K map list).
  - Clear wanted level.
- In multiplayer only the room host can use it, or add a "cheats allowed" setting when creating a room, so it can't be abused in public rooms. Enforce this on the server.

### Finish
- Update `README.md`, `STATUS.md`, `CLAUDE.md` and `CREDITS.md`.
- Give the owner a list of what's done, what's partial, and any files they need to provide.

## Useful tools
| Command | What it does |
|---|---|
| `npm run dev` + `PORT=8787 node server/index.js` | Dev client (5173) + game server |
| `npm test` | 12 node:test cases (shared logic + live server) |
| `node tools/views.mjs <outDir> [url] [names]` | Comparison screenshots (menu, street, aerial, mountain-edge, north-edge, pier, night, player) |
| `node tools/perf.mjs [url]` | Draw calls / triangles incl. shadow passes |
| `node tools/stutter.mjs` | New shader programs per first-use action (should stay 0) |
| `node tools/mp.mjs` | Two-client multiplayer check |
| `python3 tools/grid.py out.png a.png b.png …` | Side-by-side image grid |
| `node tools/fetch-assets.mjs` | Download third-party assets (original host → GitHub mirror) |
| `node tools/gen-textures.mjs [names] [--preview]` | Regenerate the KTX2 PBR textures |

Baseline screenshots from before the upgrade can be recreated from commit `bd0fc5d` (e.g. in a `git worktree`, served on port 5174).
