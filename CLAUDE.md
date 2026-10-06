# Dungeon Zen (for Claude; owner does not read this file)

Local-first Windows Electron app for D&D 5e DMs: detective board, storylines over time (engine + Timeline), clickable map, live-session desk, AI creation from notes. Old name Chronosboard. Version 1.1.0 (`package.json`).

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

## Queued for 1.2.0 (owner's list, 2026-10-06; wait for "go")
1. Board right-click menus on cards, notes, strings (Delete to History, Hide; "Show hidden" toggle shows greyed, right-click Unhide).
2. Board "Connections" button under Note: all strings, custom string types, delete; highlight strings, grey other cards/notes (tick boxes).
3. Storylines button opens a screen with more options: storyline colours tint cards very subtly on global view (beige when none, diagonal split for several); act marks = Timeline acts (linked both ways), roman-numeral circles in storyline colour; toggle; tabs stay.
4. Linked boards: switch "moving a card moves it on all boards"; strings shared by default, advanced: per-board strings; re-enabling asks global or storyline wins (both).
5. Timeline lane titles wrap over "Minor": fix.
6. Board underlay pictures per board (campaign maps first, any picture), move/resize/opacity/lock, toggle; resize cards and notes (smaller shows less, down to name).
7. Resizable side panels on every screen (board, Map, Timeline …), remembered.
8. Advanced setting imperial/metric.
9. Map: Place party token button; PC tokens, Split from party / Merge with party.
10. Encounters: Save encounter button; scene box; AI chooses and creates monsters (proposals).
11. Monster/NPC sheet opens on fight summary; AI stat block from description/options; CR up/down; picture upload or AI-drawn.
12. SRD monster search pop-up: all SRD monsters, filter/sort by type, CR, size etc.
13. Sheets and similar screens: Back to the previous screen.
14. Battle maps: Import a saved map; can draw again after an error; Gemini returns no image (fix, or error says how to fix).
15. Run encounter (combat tracker): initiative, rounds/turns, HP, conditions with durations, everything trackable; morale/tactics messages (flee at half numbers, guards stay while commander present, Guard Captain boosts guards); double-click a combatant opens its stat block.
16. Encounter bugs from screenshot: XP meter labels pile up when XP far above budget; Battle map drop-down squashed; SRD captains show size "Small" (2024: Medium or Small).
Owner's answers: hide applies to every board. Measurements stored metric (km, km/h, m; grid square 1.5 m), display setting metric (default) or imperial converts; free-text stat blocks keep their words, display converts ft/miles patterns. Split PC travel never moves the clock (clock = party only); split PC counts as "here" in its own region (default, not asked). AI encounter monsters stay in the encounter until "Put on board".
Open: publish 1.1.0 now or fold into 1.2.0.

## Remind the owner (until answered)
- Player preview in a second window (TV): put off by owner; ask again later.
