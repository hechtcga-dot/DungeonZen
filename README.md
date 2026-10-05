# Chronosboard

Local-first Windows desktop app for D&D 5e Dungeon Masters: a detective-board
canvas, storylines over time, a clickable map, a live-session desk, and
AI-assisted creation from notes. Planning documents are in `docs/`; start with
`CLAUDE.md`.

## Run it from source (Windows)
1. Install [Node.js](https://nodejs.org) 22 or newer.
2. In this folder: `npm install`, then `npm run dev`.

`npm test` runs the unit tests. Campaigns are ordinary folders (a
`campaign.db` file plus an `assets` folder) that you choose when creating one.
