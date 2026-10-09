# Dungeon Zen (for Claude; owner does not read this file)

Local-first Windows Electron app for D&D 5e DMs: detective board, storylines over time (engine + Timeline), clickable map, live-session desk, AI creation from notes. Old name Chronosboard. Version 1.5.0 (`package.json`).

Docs: `docs/STATE.md` (what is built, per area: read the part you touch, update it after), `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/FEATURES.md`, `docs/UI_SPEC.md`.

## Working with the owner
- Reports: extremely concise; grammar optional. Questions/decisions put to owner: full clear sentences.
- Ambiguous request: ask clarifying questions first, only where the answer changes what gets built; small details: pick a default and say so.
- No apologies: fix it, say what changed.
- Plan tool calls; batch independent ones.
- Owner often sends several requests in a row: collect them, start only on "go".
- Build style: skill `ponytail` at `full` (simplest working code). It governs how, never what: owner sets scope; rule 11 and undo/History always win. Keep the vitest suite.
- Every change shows on every screen it touches (linked: board, Timeline, Map, Live, sheets). Owner, 2026-10-06.
- Screenshots are the owner's main way of reporting; check UI with a screenshot drive (playwright-core `_electron`, Xvfb :99, fake AI server on :11434 as Ollama).

## Non-negotiable rules
1. Local-first; only AI and Open5e calls go online.
2. AI/engine output changes nothing until the DM approves (propose, diff, approve).
3. Nothing hard-deleted: superseded / History, revivable.
4. Undo everywhere: every write through `CommandLog.run`.
5. Time = integer minutes from campaign start.
6. Enums stored as strings, validated with Zod.
7. API keys only via Electron `safeStorage` (`userData/ai-keys.json`), never campaign/DB.
8. Open5e/SRD content copied in, never referenced live.
9. Party knowledge shared across party, per field.
10. AI suggestions visibly distinct (blue dashed "AI suggestion").
11. DM can change everything: all stored/shown data editable, undoable, removable to History. New feature = its edit path too.

## Stack and boundaries
Electron + electron-vite, React 19 + Vite (no Next.js), SQLite better-sqlite3 + Drizzle (one DB per campaign folder), Zustand, React Flow (`@xyflow/react`), Zod 4, vitest. AI: plain HTTPS adapters `src/main/ai/client.ts`, services in `src/shared/aiProviders.ts` (add a row; adapter only for a new protocol).
- Main only: DB, files, AI, Open5e, keys, exports. Renderer: UI only, via typed IPC `src/shared/ipc.ts` (zod inputs + `IpcOutputs`, handlers `src/main/ipcHandlers.ts`).
- Store: `act` (write, refreshes) vs `query`/`call` (read, no refresh).
- Engine `src/main/engine`: pure TS, no UI/DB imports, unit-tested.
- Assets `dz-asset://campaign/<path>`; AI images wait in `assets/pending` (cleared on open) until kept.

## Commands
`npm install` · `npm run dev` · `npm test` · `npm run typecheck` · `npm run build` · `npm run dist:win` (installer; on Linux needs wine64 + wine32:i386).

## Release
Bump `package.json` + `package-lock.json` version. Push branch `claude/friendly-pascal-t9tphb`, fast-forward `main`. Tag push is blocked (proxy 403): run workflow `windows-installer.yml` on `main` via GitHub MCP `actions_run_trigger` with input `release_tag: vX.Y.Z`; check with `get_latest_release`.

## Decided (owner)
- Rules edition default 2024 (SRD 5.2), per campaign.
- Desk style everywhere (painted tabletop: wood, old map, tarot, candles, leather). Art drawn in code in `src/renderer/art/` (replaceable); painted art later from commissions/licensed packs, never generated; never the 1971 U.S. Games Rider-Waite scans.
- Map zooms and pans (`MapView.tsx`).
- Roll20: paste-in macros and API script.
- Battle maps: AI image service + local rules + DM's style examples; many settings, prefilled, all editable.
- Modes: Prep (everything), Live (table, from where the party is), Players (only what players know).
- Session prep follows owner's one-page template (reference, use where it fits).
- AI services: DM picks writing and map service from drop-downs, switch any time.
- Card colours: Item `#9c4f1f`, Handout `#6b5a3a` (`entityStyle.ts`).
- Installer: per-user NSIS, no admin (`electron-builder.yml`, `build/installer.nsh`), `%LOCALAPPDATA%\Programs\DungeonZen`, HKCU. Not code-signed yet.
- New campaign: getting started guide, world map first (1.1.0).
- All files live in the campaign folder (one folder to back up): imports are copied in, saves default to `exports/`, Open folder links wherever pictures, maps, sheets or notes show (2026-10-09). Replaces "or a folder the DM chooses" for encounter pictures.
- Delete campaign = folder to the Recycle Bin after an are-you-sure. Battle grid off by default. Encounters: every PC in by default, tick per PC.

## 1.2.0 (built 2026-10-09)
Owner's 16-item list (board menus/hide, Links and Story panels, linked boards, underlay pictures, resizable panels, metric/imperial, PC tokens, SRD browser, fight summary sheet, encounter scene and AI build, combat tracker, fixes). Details in `docs/STATE.md`.
Owner's decisions: hide applies to every board; measurements stored metric, display metric (default) or imperial, free text keeps its words; split PC travel never moves the clock (clock = party only); AI encounter monsters stay in the encounter until "Put on board"; combat tracker: no dice, no initiative (DM orders the list), PC HP typed by hand, not linked to Live.

## 1.3.0 (built 2026-10-09)
Owner's list: Setup menu (save, copy, about, uninstall), background pictures with a Cards/Background move switch, Ctrl+drag pans, menus close on click, New link from the card menu (types with colours), strings on six card points, sheet tabs (traits/descriptions with AI fill, Secrets, Factions), character-sheet Full sheet, desk party cards, pictures on every card and Library › Pictures with style examples, Draw windows show the prompt, Notes screen. Details in `docs/STATE.md`.
Owner's decisions: link colour belongs to the link type; Setup holds file actions and Uninstall; every card type gets a fill-in tab; NPC, PC and places get a Factions field; art style plan approved (uploads are style examples for everything until unticked; Draw window can untick per drawing); "base character sheets on library art" = choose the AI's style examples (option b); notes are for the DM only.

## 1.4.0 (built 2026-10-09)
Run encounter upgrades: CR/level and balance bar, fight follows the encounter (no "Someone joins"), damage types, Split / Mirror Image / Displacement, death saves, bloodied, selected-row tactics and Ask AI, terrain and spell effects, expandable rows (round track, reactions, concentration, legendary actions and resistances, limited uses with Refresh, spell slots), notes pop-up, group damage with saves, End combat summary, keys. Details in `docs/STATE.md`.
Owner's decisions: creatures join a fight only through the encounter (and new PCs); spell slots live on the card, Long rest refills; suggestion "players' view of the fight on a TV" not taken this build.

## 1.5.0 (built 2026-10-09)
Character sheets and fight planning: Make a character card from notes files (AI, review), full sheet editable and linked (proficiency, saves/skills with expertise), SRD weapons and spells picker and your own attack with Roll20 macros, Spells and Actions tables, D&D Beyond list (classes, Heroic Inspiration, heal/damage, hit dice, death saves, exhaustion, limited uses, companions, description fields), encounter pictures folder, sheet tracking on Run encounter rows, Battle planner, spell links. Details in `docs/STATE.md`.
Owner's decisions: from the D&D Beyond list not taken: rest buttons on the sheet, inventory; sheet keeps the desk style; death saves live on the card (shared by sheet and fight); encounter pictures in `assets/encounters/<name>` or a folder the DM chooses.

## Owner's answers (2026-10-09)
- Dice, music, initiative, battle maps at the table stay in Roll20: do not build them in.
- Not wanted (dropped from the plan): player view on a second window/TV; party loot/treasure list.
- One computer only (no sync work). XP levelling, not milestones.
- Next build (waiting on "go"), owner's answers 2026-10-09:
  - Map: option B, board gets a "map view" switch (same picture) with region tools, AI find regions, party token and travel time. Map screen stays.
  - Library: entries grouped in expandable folders (PCs, NPCs, monsters, places…), not one long list.
  - Generators: own rail item, many tables (names, taverns, shops, NPC quirks/voices, rumours/hooks, loot by CR, trinkets, weather, travel events, encounter and non-encounter random events, dungeon rooms, traps, riddles); results copy or go on the board; own tables typed or pasted.
  - Travel: suggest checks per travel time as a roll table (DM rolls in Roll20), DM confirms; nothing happens on its own.
  - XP: equal share per fight, running total per PC, close-to-level shown.
  - AI session recap (edit before sending).
  - Backups: dated, end of session + once a day, keep 20, in `backups/` in the campaign by default, DM can choose another folder.
  - Re-import everywhere (map picture, character sheet, notes files, encounter pictures) plus "read again with AI".
  - Notes: one master notes document with bookmarks/headings/table of contents, individual notes kept with their original copy; tickbox to sync an edit between master and the note.
  - Foundry VTT and Owlbear Rodeo exports: battle maps with grid, character and monster sheets, handouts.
