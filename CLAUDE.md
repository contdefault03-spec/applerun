# Working in this repo

Alfredo Applerun is a multiplayer 3D open-world browser game (Three.js + Vite client, Node/WebSocket
server). Start with **README.md** for setup/architecture and **STATUS.md** for exactly what the
owner's upgrade plan asked for, stage by stage, and what's done/partial/not started in each one.
STATUS.md is the single source of truth for in-progress work — read it before continuing the
upgrade, and keep it updated (mark items done, add what's still open) as you go.

## Rules that apply to every change here (see STATUS.md's "Rules from the owner" for the full list)
- Keep 60 fps on a mid-range laptop: use instancing, LOD, frustum culling, KTX2 textures.
- Never break existing gameplay or multiplayer.
- Only free (CC0/CC-BY) or procedurally-generated assets — no real brand names or logos. New
  third-party assets go through `tools/fetch-assets.mjs`, credited in `CREDITS.md`.
- Cars are "inspired by" real makes with invented names, never real logos.
- Run `npm test` (12 node:test cases) and, for anything touching rendering, take a screenshot with
  `node tools/views.mjs <dir> [url] [view]` before calling a change done — see the "Useful tools"
  table at the bottom of STATUS.md.
