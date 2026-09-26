# Alfredo Applerun — v1.2

A multiplayer 3D open-world browser game built with Three.js and Vite. It runs on a Node.js WebSocket game server, with WebRTC proximity voice and Gemini-powered NPC conversations. Firestore persistence is optional.

v1.2 adds: a full set of new interiors (clinic, dentist, pharmacy, supermarket, barber, bank,
arcade, ATMs) plus dolma sold at every diner/restaurant counter; a real cinema (playable video
screen) and a populated concert hall; a fishing mission with a rod/bobber rig, a jumping tuna and
a cinematic camera moment; a real Counter-Strike arena (desert-town/industrial geometry, not a
bounding box) with grenades and halftime team swaps; smarter basketball off-ball AI (cuts,
screens, defensive switching, fast breaks); denser, more sidewalk-aware pedestrians and traffic;
park life (dog walkers, joggers); and random neighbourhood gang encounters with claimable cars.
See `STATUS.md` for the full stage-by-stage breakdown of what changed and what's still open.

The city layout is generated from the supplied map image (`public/assets/maps/reference.jpg`). Every building can be entered.

## Quick start (local)

```bash
npm install
cp .env.example .env          # then put your GEMINI_API_KEY in .env (optional)
npm run dev:server            # game server on http://localhost:8787 (WebSocket at /ws)
npm run dev                   # Vite dev client on http://localhost:5173 (connects to the game server on :8787 automatically)
```

To run the production build on a single port:

```bash
npm run build && npm start    # server serves dist/ + /ws + /api on $PORT (default 8787)
```

If the server can't be reached, the client falls back to an **offline single-player mode** (`LocalBackend`). Everything except multiplayer, voice and Gemini still works in that mode. NPCs use their scripted fallback dialogue.

Useful URL parameters:
- `?quality=low|medium|high` overrides the graphics preset.
- `?room=CODE` opens an invite prompt for that room. The pause menu has a **Copy invite link** button that builds this link for you.

## Controls (all rebindable in Settings → Controls)

| Action | Default |
|---|---|
| Move | W A S D |
| Sprint / crouch / jump (handbrake in cars) | Shift / Ctrl / Space |
| Interact / talk to NPC / use doors, shops, seats | E |
| Enter / exit vehicle | F |
| Push-to-talk (proximity voice) | V (hold) |
| Weapon slots / reload / drop | 1–5 / R / G |
| Fire / aim | Left mouse / right mouse |
| Toggle first / third person | C |
| Chat | T |
| Simple map / detailed zoomable map / phone / inventory & player list | M / K / P / Tab |
| Emote / horn | B / H |
| Admin / debug menu (host-only or "cheats allowed" rooms) | 9 |
| Pause | Esc |

Pressing **E while looking at another player playing Ajan** plays `ajan.mp3` for everyone nearby. It never triggers on yourself.

Press **E at the boat moored at the end of the pier** to start the fishing mission: a 20 s join window, a ~500 m trip out to sea, and after a wait only the player playing **Ajan** can grab the catch — see "Fishing mission" under Feature status.

## Characters

There are 7 playable characters. They are defined in `src/characters/defs.js` and built by `src/characters/CharacterFactory.js`.

- **Max** uses the supplied `max_3d_model.glb`. The game auto-rigs it at load (`AutoRig.js`) so it can animate.
- **Ajan, Rize, Masked, Lucky** are built from the rigged male model in `HumanModels.glb`. Each one gets:
  - body deformation
  - painted outfits
  - accessories: fluffy hair, ski mask, umbrella hat
  - a planar-printed JackedXhan shirt graphic (Masked)
- **Dex** and **Nova** are extra characters made from the supplied male and female rigs.
- **NPC pedestrians** are generated from the same rigs. Roles include civilians, police, medics, shopkeepers, workers, gang members, athletes and wrestlers, and each gets a deterministic variation.

## Architecture

```
shared/     deterministic code used by both client and server
  map/        layout generated from the reference map (roads, buildings, colliders, spawns), terrain
  weapons.js, economy.js, interiors.js, sports/ (football, basketball, wrestling sims)
server/     Node game server (authoritative)
  index.js    HTTP (/api/health, /api/rooms, static dist) + WebSocket /ws, .env loader
  rooms.js    rooms, snapshots (15 Hz), validation: movement speed, lag-compensated hits with
              line-of-sight, ammo/fire-rate/ownership, purchases (only inside gun stores), rewards
  activities/ CS-style combat matches + server-run sports matches
  gemini.js   Gemini proxy (rate-limited; key never leaves the server)
  store.js    FileStore (data/store.json) or FirestoreStore when FIREBASE_SERVICE_ACCOUNT is set
src/        client
  core/ (engine, input, settings, audio, assets)   world/ (terrain, roads, buildings, landmarks, props)
  characters/ (rigging, animator, avatars)         player/ (controller, cameras)
  net/ (network, offline backend, multiplayer sync, WebRTC voice)
  interiors/ (modular interiors + furniture)       vehicles/ (driving, AI traffic)
  npc/ (NPCs, dialogue, Gemini client)             combat/ (weapons)
  systems/ (police/wanted, jobs, emergency/hospital, random events, interaction)
  activities/ (sports and combat UI/flow)          ui/ (menus, HUD, phone, inventory)
tests/      node:test suites for shared logic + server (npm test)
tools/      headless Playwright scripts: screenshots, play-throughs, 2-client MP and voice tests
```

## Gemini (AI NPCs)

- The API key lives **only on the server**, in `.env` locally or in the hosting dashboard's environment variables. It is never bundled into the client or sent to players.
- The browser calls the game server. The server calls Gemini with the NPC persona, recent context and stored memory of the player.
- If no key is set, or Gemini fails or hits a rate limit, NPCs use scripted fallback lines. The Settings → Gemini AI tab reports honestly whether the server has a key configured.

## Firebase

This is optional. Set `FIREBASE_SERVICE_ACCOUNT` (a JSON string or a path to the JSON file) on the server and `npm install` pulls in `firebase-admin`. Profiles, money, inventory, housing and NPC memory are then stored in Firestore.

Without it, the server persists everything to `data/store.json`. The client never talks to Firebase directly, so no Firebase config ships to browsers.

## Deployment

WebSockets need a long-running server, so the deployment has two parts.

1. **Game server** (Render, Fly.io, Railway, a VPS or Docker).
   - Render: `render.yaml` is a one-click blueprint. Set `GEMINI_API_KEY` in the dashboard.
   - Docker: `docker build -t bayview . && docker run -p 8787:8787 --env-file .env bayview`
   - The server also serves the built client. You can stop here and play from the server URL.
2. **Netlify client** (optional, for the static frontend).
   - Connect the repo; `netlify.toml` builds `dist/`.
   - Set `VITE_SERVER_URL=wss://your-server.example.com` in Netlify's environment variables.
   - Set `ALLOWED_ORIGINS=https://your-site.netlify.app` on the game server.

**Voice chat** uses public STUN. Players behind strict NATs or corporate firewalls need a TURN server, configured with `VITE_TURN_URL`, `VITE_TURN_USER` and `VITE_TURN_PASS`. Browsers only grant microphone access on HTTPS or localhost.

## Testing

```bash
npm test                      # 12 node:test cases: layout/terrain/economy/weapons/sports + live server
                              # (join, sync, chat, validated buying, lag-compensated shooting, rooms)
node tools/mp.mjs             # headless 2-client multiplayer check (needs server + build running)
node tools/voice.mjs          # headless 2-client WebRTC voice check (fake mic)
node tools/play.mjs           # headless play-through with screenshots
```

## Feature status

What was verified during development (headless Chromium and the automated tests):
- 2-client sync and chat
- server-validated purchases and hits
- Gemini replies through the proxy
- WebRTC audio flowing between two clients
- driving
- interiors
- all three sports in solo play

### Implemented
- **Map and buildings:** the whole island is generated from the reference map — districts, roads with real PBR markings/kerbs/manholes, terrain textured and blended by height/slope, and an endless ocean past the coastline. Trees (broadleaf/pine/palm, bark trunks, wind-swayed foliage cards), bushes/hedges/flower beds, and street furniture (lamps, benches, hydrants, bins, bollards, bike racks, bus stops, working red/amber/green traffic lights) fill it in. Houses/villas have a real paint palette, 3D balconies, garden fences; skyscraper glass fakes room interiors per window. Every building has an enterable modular interior — house, apartment, shop, restaurant/bar, **nightclub** (disco floor, DJ booth, positional club beat), gun store, police, hospital, gym, garage, office, warehouse, **hotel** (check in, room service, sleep & save), and the Dome arena.
- **Characters and cameras:** 7 playable characters plus varied NPC pedestrians, procedural animation, first- and third-person cameras, full control rebinding.
- **Multiplayer and social:** WebSocket multiplayer with interpolation, name tags, chat, room codes and invite links. Proximity WebRTC voice on V uses HRTF spatialisation and distance falloff.
- **Combat:** CS-style rooms from 1v1 to 5v5 with teams, ready-up, buy phase, per-round match money, kill/win/loss bonuses, out-of-bounds enforcement, and a Tab scoreboard (kills/deaths/money). The weapon set (fists, knife, three pistols, AK-47, M4A1, two snipers, plus armor and medkits) uses server-side hit validation.
- **Sports:** football (real ball possession — it sticks to your feet until you pass/shoot/get tackled), basketball (man-to-man marking, spacing, no ball-swarming) and wrestling, all with AI opponents and teammates.
- **Vehicles and jobs:**
  - drivable cars, a second "wedge" supercar class, two-tone/stripe paint, and a drivable **boat** (simplified floating physics)
  - AI traffic including police cruisers, headlights at night, car damage and garage repairs
  - taxi job, the fishing mission (boat trip, catch, Ajan-only grab, server-paid reward)
  - police with wanted levels and arrests; ambulances, the hospital and a paramedic job
- **The mountain and pier:** a ski resort (lodge, two lift towers, animated gondola cabins) near the snow line; a pier amusement park (ferris wheel, spinning carousel, animated roller-coaster loop, food stalls) with a moored boat at the end for the fishing mission.
- **Maps:** M (simple survival icons) and K (detailed, zoomable/pannable, every named shop/restaurant/office/landmark), both click-to-set-waypoint.
- **Admin/debug menu (key 9):** god mode, fly mode, give weapons, heal, teleport-to-place, clear wanted — server-gated to the room host or "cheats allowed" rooms.
- **World life:**
  - NPCs wander, sit on benches, go into buildings, react and flee
  - random events
  - Gemini NPC conversations with memory and a fallback
- **Economy and persistence:** money rewards, inventory, gun stores validated on the server, buying a house and placing furniture. Everything saves to the server store, which is file-based or Firestore.
- **Presentation:** day/night cycle with cascaded shadows and height fog, sound system with volume buses, menus, HUD, phone, map and settings.

### Partial
- Ambient NPCs and AI traffic are simulated separately on each client, so different players see different pedestrians. Players, player-driven vehicles, matches and economy are synced.
- Combat bots exist only in solo practice; the physical arena map is still just an invisible bounding box (see `STATUS.md` Stage 10); no grenades.
- Football/basketball off-ball movement uses fixed spacing spots, not dynamic cuts.
- The fishing mission has no modelled rod/bobber, no synced cinematic camera cutscene, and no fish model (a particle splash + sound stand in).
- Football has no "switch controlled player" button. You control your own avatar and AI plays the rest.
- Characters wear painted and deformed outfits on the supplied rigs rather than separately modelled clothing meshes.
- Animations are procedural. The supplied models have no animation clips.
- The Firestore backend is implemented but was only tested against the file store here, since no service account was available.
- Stage 5's extra building types (cinema, clinic/pharmacy, bank, arcade, dentist, barber) and per-house furniture-layout variety aren't built — see `STATUS.md` for the full stage-by-stage breakdown of what's done vs. open.

### Remaining / ideas
- Server-synced pedestrians and traffic.
- A real modelled combat arena map (currently an empty bounding box) and grenades.
- Draw-call reduction through more instancing and merged buildings.
- Mobile touch controls.
- Anti-cheat beyond the current speed, hit, ammo and economy checks.
- See `STATUS.md` for the complete, stage-by-stage list of what's done, partial, or not started — it's kept up to date as the single source of truth for in-progress work.

## Assets

Everything in `public/assets/` is user-supplied:
- `max.glb`
- `humans.glb`
- `ajan.mp3`
- `rize_did_it.mp4`
- the reference map

All other visuals are generated procedurally in code: textures, vehicles, weapons, furniture and props.
