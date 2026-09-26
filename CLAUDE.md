# Working in this repo

Alfredo Applerun is a multiplayer 3D open-world browser game (Three.js + Vite client, Node/WebSocket
server). Start with **README.md** for setup/architecture and **STATUS.md** for exactly what the
owner's upgrade plan asked for, stage by stage, and what's done/partial/not started in each one.
STATUS.md is the single source of truth for in-progress work — read it before continuing the
upgrade, and keep it updated (mark items done, add what's still open) as you go.

## Rules that apply to every change here (see STATUS.md's "Rules from the owner" for the full list)
- Keep 60 fps on a mid-range laptop: use instancing, LOD, frustum culling, KTX2 textures.
- Never break existing gameplay or multiplayer.
- Only free (CC0/CC-BY), procedurally-generated, or owner-supplied assets. New third-party assets
  go through `tools/fetch-assets.mjs`, credited in `CREDITS.md`.
- As of v1.3, the owner has lifted the earlier "no real brand names/logos" restriction: a real
  brand/name can be used where it fits the game, at the owner's direction. This doesn't relax
  anything else — no real people's identities, no real-world violent content, and no encoding a
  real ethnic/national group as a criminal faction (see the note on the gang below).
- The fictional "Talon Crew" gang (added in v1.2) has no connection to any real nationality,
  ethnicity or flag — that was true before v1.3 and remains true now. Any real-world flag that
  appears near the gang's territory is purely incidental environmental set-dressing (like any other
  flag/decal placed in the world) and must never be presented as the gang's own symbol, identity,
  or nationality.
- Run `npm test` (12 node:test cases) and, for anything touching rendering, take a screenshot with
  `node tools/views.mjs <dir> [url] [view]` before calling a change done — see the "Useful tools"
  table at the bottom of STATUS.md.
