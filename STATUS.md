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

**Not done yet in Stage 3:**
- **Street furniture everywhere:**
  - hydrants, benches, bins, bus stops, street lamps, traffic lights (with working red/amber/green heads that follow the timing in `src/vehicles/Traffic.js`), signs, bollards, bike racks;
  - instanced, with colliders;
  - replaces the box props in `Props.js`.
- Add a credits line for the generated textures in `CREDITS.md` (done: see "Generated in code").

## Remaining stages (owner's full requirements)

### Stage 3: realistic terrain, roads and nature (finish)
- PBR textures (albedo + normal + roughness) for grass, dirt, sand, asphalt, pavement, kerbs, rock and snow. **Done.**
- Mountain: grass at the bottom, then rock, then snow only near the top, blended by height and slope. **Done.**
- Real road markings, crossings, kerbs, manholes and drains. **Done, needs QA.**
- Realistic tree models of several species (leafy trees, pines, palms) with proper leaf textures and wind sway. Bushes, hedges, flower beds and grass patches around houses and parks.
- Boulevards with tree rows down the middle, and street furniture everywhere: hydrants, benches, bins, bus stops, street lamps, traffic lights, signs, bollards, bike racks.

### Stage 4: buildings
- **Houses:** varied, colourful facades (different paint colours, brick, render), coloured balconies with railings and plants, different roof shapes, fences, gardens and driveways. No two neighbouring houses should look the same.
- **Apartment blocks:** balconies with details (plants, chairs, laundry) and varied colours.
- **Skyscrapers:**
  - Office towers with glass facades where you can see inside.
  - Use an interior-mapping shader for distant windows (fake rooms with desks, lights and people silhouettes).
  - Use real modelled office floors for the lower floors you can walk into.
- **Night:** random windows lit, neon signs on shops, clubs and pubs.
- Notes:
  - Buildings are in `src/world/Buildings.js`: facades merged per style, then split into 200 m cells in `World.js`.
  - Glass towers currently glow as solid grids at night (window emissive is turned down to 0.35 × night as a stopgap).

### Stage 5: interiors everywhere, all different
- Every enterable building must be decorated and look different. Build a large interior kit (many furniture sets, wall colours, floors, decorations) and generate varied rooms from it.
- Add building types beyond what exists: pubs, bars, nightclubs, restaurants, cafés, medical offices and clinics, dentist, pharmacy, cinema, supermarket, clothing stores, barber, bank, gym, arcade, office floors, apartments and houses. Come up with more ideas too.
- Make them work like real life where practical:
  - buy food and drinks;
  - heal at clinics and pharmacies;
  - watch a film in the cinema (a screen with a looping clip);
  - use the ATM;
  - dance in clubs.
- Nightclubs, pubs and a concert hall:
  - animated crowds (dancing, standing, drinking);
  - a DJ or band on stage;
  - lights synced to the music;
  - royalty-free music playing inside: spatial, louder the closer you are, muffled from outside.
- Notes:
  - Interiors live in `src/interiors/InteriorManager.js`, placed in far slots (`shared/interiors.js`).
  - Load interiors only when the player is near or inside.
  - Interior lights use `LightPool` (3 pooled lights).

### Stage 6: mountain ski resort and hotel
- Near the top of the mountain, in the snowy area: a ski resort with a lodge, animated ski lifts (not necessarily rideable) and snowy slopes.
- A hotel:
  - a reception where you can check in (pay, get a room key), a lobby, a restaurant and decorated rooms;
  - your checked-in room works as a safehouse (sleep, save).

### Stage 7: cars
- Replace the box cars with realistic models:
  - supercars inspired by famous Italian, German and French hypercars and sports cars;
  - luxury sedans, SUVs, hatchbacks, taxis, police, ambulance, vans, trucks and motorcycles;
  - invented names only, no logos.
- Many paint colours, some two-tone or with stripes.
- Keep the existing driving physics, but tune handling per car class: supercars fast and grippy, trucks slow and heavy.
- Working headlights, brake lights and indicators, and a visible interior.
- Traffic uses the new models with a realistic mix: mostly normal cars, rare supercars.
- Notes: `src/vehicles/VehicleModels.js` (SPECS, `buildVehicle`), `Vehicle.js`, `VehicleManager.js`, `Traffic.js`.

### Stage 8: the pier and amusement park
- Make the pier a busy destination: food stalls, shops, an arcade, people walking, benches and lamps.
- Amusement park on the pier:
  - a ferris wheel that spins;
  - a roller coaster with cars running around the track (animated; rideable not required);
  - a carousel.
- Houses and cafés you can enter along the pier, and a party at the end (music, dancing NPCs, lights).
- At the very end of the pier, a moored boat where the fishing mission starts (Stage 9).
- Notes: pier landmarks are `pier` and `pierEnd` in the layout. There is already a ferris wheel in `src/world/Landmarks.js`.

### Stage 9: fishing mission (multiplayer)
- **Start:** standing at the boat, press E. A 20-second countdown starts, and every player near the boat during that time joins the mission.
- **Trip out:** the boat is drivable. Players ride it about 500 m out to sea, with a marker showing where to go.
- **Fishing:** at the spot, everyone gets a fishing rod (a real model with a line and bobber) and casts. Show fishing animations.
- **The catch:**
  - The player playing **Ajan** always gets the catch, never the others.
  - After about 30 seconds of fishing, Ajan's bait bites: the bobber dips and the water ripples and splashes.
- **Cutscene, synced for all players:** the camera cuts to Ajan, and a big tuna bursts out of the water in slow motion with splash particles and cinematic camera angles.
- **Grab:** only Ajan's screen shows "Press E to grab the fish". When he presses E, Ajan pulls the tuna up, holds it and looks at it. At exactly that moment `fish.mp3` plays, spatial and audible to everyone nearby.
- **Reward:** every participant gets $20,000 and Ajan gets $25,000, paid through the server economy so it can't be faked.
- **Return:** everyone drives the boat back to the pier and the mission ends.
- If no one is playing Ajan, show a message that the mission needs an Ajan player, or let the host pick the "lucky fisher".
- Notes:
  - Server rooms are in `server/rooms.js`; rewards go through `shared/economy.js` `reward` kinds.
  - The Khronos glTF sample `BarramundiFish` (CC0) could be the tuna base: scale it and retint it.

### Stage 10: combat mode upgrade (CS2 style)
- **Entrance:** army barracks somewhere on the map (or at the Industrial Yard).
- **Arena map:**
  - Starting a combat match temporarily teleports all participants to a separate small arena.
  - A desert-town map inspired by classic Counter-Strike maps: sandy streets, tan walls, arches, crates, a mid lane, two bomb sites, long sightlines.
  - It must be an original layout, not a copy of any real map.
- **Buy menu and money:** a proper buy menu at round start, with temporary match-only money (starting cash, kill rewards, round win/loss bonuses).
- **CS-style rules:** rounds, buy phase, freeze time, round timer, halftime side swap, first to N wins.
- **Weapon feel:** recoil patterns, spread, headshots, armour and helmet purchases, and grenades if possible (HE, flash, smoke).
- **Scoreboard:** on Tab, with kills, deaths, assists and money.
- **After the match:** everyone returns to where they were in the open world, and their normal money and weapons are restored untouched.
- Notes: `server/activities/combat.js`, `src/activities/ActivityManager.js`, `src/combat/WeaponManager.js`, `shared/weapons.js`.

### Stage 11: football upgrade
- **Possession:** when a pass reaches you, the ball sticks to your feet (close dribble control) until you pass, shoot or get tackled. When someone tackles you and wins it, the ball sticks to them instead.
- **Power matters:** charging a shot or pass longer makes the ball rise off the ground (chips, lobs, high shots); short taps stay low.
- **Smarter AI:**
  - Players who aren't near the ball move into open space, make runs, spread wide and call for passes, instead of everyone chasing the ball.
  - Defenders mark and hold shape; the keeper positions and dives.
  - AI passes to open teammates and shoots when it makes sense.
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
