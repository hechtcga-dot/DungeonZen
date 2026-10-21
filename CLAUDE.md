# Dungeon Zen (for Claude; owner does not read this file)

Local-first Windows Electron app for D&D 5e DMs: detective board, storylines over time (engine + Timeline), clickable map, live-session desk, AI creation from notes. Old name Chronosboard. Version 3.2.1 (`package.json`).

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
`npm install` · `npm run dev` · `npm test` · `npm run typecheck` · `npm run build` · `npm run smoke` (built app, every screen, screenshots; runs in CI, see `docs/STATE.md` M0) · `npm run dist:win` (installer; on Linux needs wine64 + wine32:i386).

## Release
Bump `package.json` + `package-lock.json` version. Push the session branch, fast-forward `main`. New build started on a new branch: first fast-forward `main` with the previous build branch, then delete that branch (owner, 2026-10-12; branch delete is blocked by the proxy and GitHub MCP has no delete tool, so ask the owner to delete it on the GitHub Branches page). Tag push is blocked (proxy 403): run workflow `windows-installer.yml` on `main` via GitHub MCP `actions_run_trigger` with input `release_tag: vX.Y.Z`; check with `get_latest_release`.

## Decided (owner)
- Rules edition default 2024 (SRD 5.2), per campaign.
- Adventure UI skin (owner, 2026-10-19): second skin, adventure look (dark brown rail/top bar/ground, aged parchment panels, Cinzel capital headings, deep red buttons); Notes keeps its clean layout inside that frame (`docs/PLAN-3.1-UI.md` G7). Desk skin stays, DM picks.
- Desk style everywhere (painted tabletop: wood, old map, tarot, candles, leather). Art drawn in code in `src/renderer/art/` (replaceable); painted art later from commissions/licensed packs, never generated; never the 1971 U.S. Games Rider-Waite scans.
- Map zooms and pans (`MapView.tsx`).
- Roll20: paste-in macros and API script.
- Battle maps: AI image service + local rules + DM's style examples; many settings, prefilled, all editable.
- One rail with every screen (owner, 2026-10-19, replaces the Prep / Live / Players switch); What they know stays the safe players' view (locked rail, Esc or Back leaves).
- Session prep follows owner's one-page template (reference, use where it fits).
- AI services: DM picks writing and map service from drop-downs, switch any time.
- Card colours: Item `#9c4f1f`, Handout `#6b5a3a`, Building `#5c6b73` (`entityStyle.ts`).
- Draw windows (card picture, battle map, world map): style examples start unticked (owner, 2026-10-12).
- Style tags on Library pictures (artist, period, medium, palette, light, details, composition): AI reads them only on the DM's click, DM keeps/edits; prompts blend all ticked pictures' tags; card pictures get "Include in the picture" and a composition picker (16 forms with sketches, default by card type, DM picks per drawing; maps keep their own layout) (owner, 2026-10-12).
- Release assets: the .exe (no .zip copy of it) and the latest playtest's campaign `example_<name>.zip` from `examples/` (owner, 2026-10-12, 2026-10-21).
- Battle map Draw window › Follow a picture: boxed part of a map/picture redrawn at 5 ft scale, no text/symbols; saved per encounter; too-big box = warning + button for the largest true-scale map, 300 ft (owner, 2026-10-14). Battle map window has Advanced style and composition (boxes from the ticked examples' style tags, battle map templates of their own) (owner, 2026-10-14).
- Installer: per-user NSIS, no admin (`electron-builder.yml`, `build/installer.nsh`), `%LOCALAPPDATA%\Programs\DungeonZen`, HKCU. Not code-signed yet.
- New campaign: getting started guide, world map first (1.1.0).
- All files live in the campaign folder (one folder to back up): imports are copied in, saves default to `exports/`, Open folder links wherever pictures, maps, sheets or notes show (2026-10-09). Replaces "or a folder the DM chooses" for encounter pictures.
- 3.0 plan `docs/PLAN-3.0.md` (M0–M5). Owner, 2026-10-19: name stays Dungeon Zen; installer stays unsigned; auto-linking filtered (length, common words, capital letter for one-word names) with a per-card "Link this name by itself" tick, on for NPC/PC/Location/Faction, off for others.
- Delete campaign = folder to the Recycle Bin after an are-you-sure. Battle grid off by default. Encounters: every PC in by default, tick per PC.

## Owner's answers (2026-10-09)
- Dice, music, initiative, battle maps at the table stay in Roll20: do not build them in.
- Not wanted (dropped from the plan): player view on a second window/TV; party loot/treasure list.
- One computer only (no sync work). XP levelling, not milestones.

## Release history
Every release's owner decisions and defaults picked (1.2.0 to now): `docs/CHANGELOG.md`. Read the releases for the area you touch; they still bind. Add each new release there, not here.
