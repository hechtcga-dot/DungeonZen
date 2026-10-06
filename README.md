# Dungeon Zen

Local-first Windows desktop app for D&D 5e Dungeon Masters: a detective-board
canvas, storylines over time, a clickable map, a live-session desk, and
AI-assisted creation from notes. Planning documents are in `docs/`; start with
`CLAUDE.md`.

## Run it from source (Windows)
1. Install [Node.js](https://nodejs.org) 22 or newer.
2. In this folder: `npm install`, then `npm run dev`.

A new campaign opens on a short getting started guide: a world map first (import
your own, make one in the app, or have an AI draw it), its regions, then your notes.

`npm test` runs the unit tests. Campaigns are ordinary folders (a
`campaign.db` file plus an `assets` folder) that you choose when creating one.

## Credits
This work includes material from the System Reference Document 5.2 ("SRD 5.2")
by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The
SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International
License, available at https://creativecommons.org/licenses/by/4.0/legalcode.
The data was prepared by the Open5e project (https://open5e.com).

## Installing on Windows

Download `Dungeon-Zen-Setup-<version>.exe` from the repository's Releases page and run it.

- It installs for your Windows account only: **no administrator rights are needed**. The default
  folder is `%LOCALAPPDATA%\Programs\DungeonZen` (you can choose another folder you can write to);
  it adds Start menu and desktop shortcuts.
- The installer is not code-signed yet, so Windows SmartScreen may say the publisher is unknown:
  choose **More info**, then **Run anyway**.
- Uninstall from **Settings › Apps**. Your campaign folders, AI settings and keys are kept.
- Settings and AI keys live in `%APPDATA%\Dungeon Zen`; each campaign is the folder you chose.

### Building the installer

- On GitHub: push a tag such as `v1.0.0` (or run the "Windows installer" workflow by hand). It
  tests, builds on Windows and attaches the installer to a Release.
- Locally on Windows: `npm ci` then `npm run dist:win` (output in `dist/`).
- On Linux: the same command needs Wine with 32-bit support (`wine64` and `wine32:i386`).
- `npm run icon` redraws `build/icon.png` and `build/icon.ico` from `build/icon.svg`.
