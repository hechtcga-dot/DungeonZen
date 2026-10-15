# Dungeon Zen (for Claude; owner does not read this file)

Local-first Windows Electron app for D&D 5e DMs: detective board, storylines over time (engine + Timeline), clickable map, live-session desk, AI creation from notes. Old name Chronosboard. Version 2.5.0 (`package.json`).

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
Bump `package.json` + `package-lock.json` version. Push the session branch, fast-forward `main`. New build started on a new branch: first fast-forward `main` with the previous build branch, then delete that branch (owner, 2026-10-12; branch delete is blocked by the proxy and GitHub MCP has no delete tool, so ask the owner to delete it on the GitHub Branches page). Tag push is blocked (proxy 403): run workflow `windows-installer.yml` on `main` via GitHub MCP `actions_run_trigger` with input `release_tag: vX.Y.Z`; check with `get_latest_release`.

## Decided (owner)
- Rules edition default 2024 (SRD 5.2), per campaign.
- Desk style everywhere (painted tabletop: wood, old map, tarot, candles, leather). Art drawn in code in `src/renderer/art/` (replaceable); painted art later from commissions/licensed packs, never generated; never the 1971 U.S. Games Rider-Waite scans.
- Map zooms and pans (`MapView.tsx`).
- Roll20: paste-in macros and API script.
- Battle maps: AI image service + local rules + DM's style examples; many settings, prefilled, all editable.
- Modes: Prep (everything), Live (table, from where the party is), Players (only what players know).
- Session prep follows owner's one-page template (reference, use where it fits).
- AI services: DM picks writing and map service from drop-downs, switch any time.
- Card colours: Item `#9c4f1f`, Handout `#6b5a3a`, Building `#5c6b73` (`entityStyle.ts`).
- Draw windows (card picture, battle map, world map): style examples start unticked (owner, 2026-10-12).
- Style tags on Library pictures (artist, period, medium, palette, light, details, composition): AI reads them only on the DM's click, DM keeps/edits; prompts blend all ticked pictures' tags; card pictures get "Include in the picture" and a composition picker (16 forms with sketches, default by card type, DM picks per drawing; maps keep their own layout) (owner, 2026-10-12).
- Release assets: only the .exe, no .zip copy (owner, 2026-10-12).
- Battle map Draw window › Follow a picture: boxed part of a map/picture redrawn at 5 ft scale, no text/symbols; saved per encounter; too-big box = warning + button for the largest true-scale map, 300 ft (owner, 2026-10-14). Battle map window has Advanced style and composition (boxes from the ticked examples' style tags, battle map templates of their own) (owner, 2026-10-14).
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
- 1.6.0 built (2026-10-09) from these answers: backups, re-import everywhere, XP per PC, AI recap, Library folders, Generators, travel checks, board Map view (option B), Master notes (linked tick box both ways), Foundry/Owlbear exports. Details in `docs/STATE.md`.
- Owner's decisions for 1.6.0: Map view on the board (Map screen stays); generator results copy or go on the board; own tables typed or pasted; travel checks are a roll table the DM confirms (dice in Roll20); XP equal share; backups in the campaign by default, folder choosable; master notes keep each note's original copy.

## 1.7.0 (built 2026-10-11)
Notes like Campfire: tree list with headings per note, folders, Contents panel and Find headings per note, right-click (Open file location, Rename, Duplicate, Combine, Delete), multi-select. Session prep remodelled on the owner's One-Page DM Session Prep, Save as notes file. Details in `docs/STATE.md`.
Owner's decisions: Combine asks keep originals or move to History; delete = Move to History, and History › Delete file for good sends the file to the Recycle Bin (not undoable); contents is a side panel only (nothing inserted in the document); tree, contents and Find headings cover DM notes, session notes and notes files; clues merged into Secrets & clues; Enemies and threats section removed, Encounters box links to Encounters instead; world bible Make a card makes the card right away (no AI).
1.7.1 (2026-10-11): 1.7.0 plus the rail change from another session (no Map, Timeline, Generators on the rail; Map/Timeline on the board top bar, Map on prep and Live, Generators in Library and Live).

## 1.8.0 (built 2026-10-12)
Card colours by type (Card menu right-click recolours every card of a type; card right-click and sheet colour per card, now on the whole board card), Background › Use a map with regions (toggle) and a card dropped on a region takes it as its location, Actions artifact holds only the .exe (no zip in a zip). Details in `docs/STATE.md`.
Defaults picked (owner may change): a type colour change also clears single-card colours (tick box, on by default); dropping a card outside every region keeps its location; Faction got its own plum (was the same purple as Clue).

## 1.9.0 (built 2026-10-12)
Map regions on a board act as Location cards (pin, strings, select, double-click sheet, card menu); while a region shows, the place's card on that board steps aside and its strings reroute to the region, back when regions/map go. Card menu › Take off this board (History restores). Fixes: picture resize NaN, cards/strings vanishing after adding a map or a refresh, clicks not selecting (React Flow `measured` kept on rebuild). Details in `docs/STATE.md`.
Owner's decisions: regions replace their cards automatically (render only, no data change). Defaults picked: Delete key ignores region names. Region names always show; Display › Region boundaries toggles outlines only (owner, 2026-10-12).
1.9.1 (2026-10-12): region names always shown, Display › Region boundaries toggles smoothed outlines; Draw windows start with no style examples ticked; style tags on Library pictures (AI read on click) blended into prompts; card pictures: Include in the picture, composition picker. Release has only the .exe.

## 1.10.0 (built 2026-10-13)
Building card type (tavern, shop, other): floors as tabs, keeper and patrons with scored rumours/secrets/clues and the players' roll, Make NPC/PC card from a person, rooms per floor, stock with SRD prices and campaign/building price scales, Secrets & clues folders (In this building / All campaign secrets), backdrops per kind, Fill with AI in one go, layout sketch per floor and on encounters sent to the image AI as a blueprint, region chips showing who is there. Details in `docs/STATE.md`.
Owner's decisions: taverns and shops are kinds of Building; region chips show NPCs and monsters only; Fill with AI fills everything at once, all editable after; no sights/dangers/bio/what the players see on taverns and shops; history always says how the name came about; inventory/patrons first; keeper with the patrons; prices folded at the bottom; secrets with their own card purple, none marked "DM made"; every line labelled Rumour/Secret/Clue; layout has a Show layout tick; blueprint option in the Draw window.
Defaults picked: "end layout" read as "send layout" (Use sketch as blueprint, on); All campaign secrets = the campaign's own list + Clue cards + other buildings' secrets; labels and start markers off on finished maps; Building colour slate; new buildings start as kind Building (change under Details › Kind).
1.10.1 (2026-10-13): AI error messages with explanation and What to do (owner: no automatic retry); Draw windows: Send smaller copies of the examples (option, off by default); Model drop-down lists every fetched model; dialog title bars stay at the top; AI dialogs minimize to a corner chip while waiting and pop back when the answer arrives.

## 1.11.0 (built 2026-10-13)
Change this picture (words, coloured marks with meanings) under every AI picture; outline sketch or uploaded outline picture with labels in the card picture and world map Draw windows; speed pass (shared refresh objects, visible-only board, lazy screens, small picture copies, 1536 px uploads prepared once, Gemini picture-only, background backup copy). Details in `docs/STATE.md`.
Owner's decisions: change box starts empty each time, the original prompt stays; sketch saved with the card / campaign; marks on the picture for Update in several colours; an uploaded outline is layout only, never style; labels never written on the picture unless ticked; speed plan items 1-8 approved, image generation first.
Defaults picked: Stability updates with the picture only (no marks); Replicate, fal.ai, local SD cannot update; battle map keeps its grid blueprint (no outline panel); `synchronous = NORMAL` not used (data safety).

## 1.12.0 (built 2026-10-13)
Add to picture (card sheet, next to Draw with AI: What to add box and sketch on the picture, add-only prompt, AI suggestion until kept); board Display › Card types (tick per type, view only, this computer). Details in `docs/STATE.md`.
Defaults picked: Add to picture works on any card picture (uploaded too); a new card of a switched-off type switches that type back on; region names on maps still show when Location is off.

## 2.0.0 (built 2026-10-14)
Region names as brown tags everywhere, card-sized on the board; region outlines off by default; board side panel (name, picture, summary, direct ties with encounters, DM notes, status, More fold); board view kept after a sheet; JFIF pictures saved as .jpg; prep sheet: link words to cards (card summary beside the sheet), secrets tied to secret strings / Clue cards (one shared text); string descriptions; Links per card with Show all links, Known/Secret groups; − / + fold on every titled panel; names edited in place (plain text look); building sheet starts with picture and name, layout last. Details in `docs/STATE.md`.
Owner's decisions: panel fields stay editable; Type/Location/Motivation/Tags/Storylines/Hide/History in a folded More; Encounter ties = every encounter the card is in; word links in every prep text box; board secrets list = secret strings + Clue cards; tied secret and string description are one text both ways.
Defaults picked: links per prep sheet by phrase (every place it appears, any case); Clue card shared text = its Description; board view remembered while the app runs; fold state per screen and title on this computer; picture square at most 240 px.

## 2.1.0 (built 2026-10-14)
Prep NPCs tied to cards (Make a card; Name/Description/Motivation = card name/summary/motivation both ways; Links and other info fold); link picker makes new cards; ↑ ↓ on every titled box; secrets, clues and connections (one text + Card–kind–Card connections, each a string; prep section "Connections, secrets, clues" with three Add buttons; card sheet Secrets tab with Add and Use an existing one; red check, Update now / Do not save changes); removed secrets in History with Revive; Untie for old Clue-card ties. Details in `docs/STATE.md`.
Owner's decisions: one secret = one text + connections; clue = same, labelled Clue; an existing secret on another card is the same secret (shared); box order on card sheets: pop-up asks this card only / every card of its type, Don't ask me again, changeable in Setup › Box order on card sheets; board view remembered only while the app is open (resets on restart).

## 2.2.0 (built 2026-10-14)
One-line text boxes scroll back to the start on click-out (all screens); NPC/PC sheets open on Features, traits, background with the picture there (Monsters too); Fight summary → Stat block, Full sheet → Character sheet; "string" and "connection" read "link" on screen everywhere (data unchanged); prep "Links, secrets, clues": one Add new drop-down (Link, Secret, Clue, Select existing… with search, grouped by kind), "+ New link type…" in the link kind drop-down, no Where box, no Use an existing one, no "Shared with the board" hint; a link's last string removed on the board takes its prep line to History (restore brings it back). Details in `docs/STATE.md`.
Owner's decisions: "links" is the word (not strings, not connections); deleted on the board = prep row gone (History).
Defaults picked: Monsters keep opening on Stat block; card sheet Secrets tab keeps Use an existing one; old Where values stay stored but no longer show on Live.
2.2.1 (2026-10-14): card picture files named `<Type><n>_<k>` (next build: `<card name>_<k>`, e.g. Ottoman_1, owner); card picture Draw window: "An illustration of a <kind> named <name>", Advanced composition fold (each prompt line a box) with named templates, + tile uploads to Library with uses ticks and Read style with AI; every Draw window: "Send the ticked pictures for reference" by Draw (off; ticks change wording only); dialog scrollbar inside the frame, buttons pinned at the bottom.
Owner's decisions: [kind] from the card type (character, monster, location…); AI reads style only on click; send tick in every Draw window. Defaults picked: templates per campaign; templates hold Style…Other details, not the description; "for a tabletop role-playing game" only on map prompts (battle, world), not card pictures (owner, 2026-10-14).
2.2.2 (2026-10-14): card picture Draw window in two columns (owner chose mockup option A, 2026-10-14): settings left, picture + prompt right; send-pictures tick moved under the example pictures in every Draw window, small and muted; What it is like above Include; templates renamed/removed from a Rename or remove… list (owner).; growing text boxes (two paragraphs then scroll); style examples: 8 most recent + All examples; prep pop-out windows (sections 1-7, NPC); prep NPC row option 2 (icon tools, Name drop-down with Create new NPC / One-time NPC, Flaws, fold 2×2 Location/Description/Links+New link/DM notes, Show from the sheet ticks); Location drop-down everywhere with (from map); card picture files `<card name>_<k>`; linked-words drift fixed, right-click Remove the link.
Defaults picked: recent examples kept on this computer; Show from the sheet has no Items (none stored on cards); one-time NPC flaws use the old How to play text; pop-outs close with the main window.
2.2.3 (2026-10-14): prep section numbers follow ↑ / ↓ order; × removes a link on prep NPC rows (History); Draw window "Description" box under its title; card picture panel: Draw with AI… + icons (✚ 🖼 ⬆ 📁 🗑), no "Drawn by AI" badge; text boxes: Enter new line everywhere (Ctrl+Enter saves), Tab/Shift+Tab indent, lists carry on, Ctrl+D, Alt+↑/↓, spelling right-click menu (owner chose).

## 2.3.0 (built 2026-10-14)
Battle map Draw window › Follow a picture (pick a map or upload, drag a box, AI redraws that part at 5 ft scale with no text/symbols/watermarks; Buildings show Inside/Roofs; saved per encounter; box over 300 ft = warning + Make the largest map); Advanced style and composition fold (boxes from the ticked examples' style tags, battle map templates); Encounters › Battle map sketch at the bottom, foldable; Suggest from the SRD is a random roll over every monster that fits the budget, words match the whole stat block. Details in `docs/STATE.md`.
Owner's decisions: followed picture saved with the encounter; too-big box offers the largest 300 ft map. Defaults picked: Make the largest map shrinks the box (true scale); Buildings start Inside; style edits reset per opening (templates keep them); fold, not a tab.

## 2.4.0 (built 2026-10-15)
Right-click Board / Encounters / Session prep / Library / Notes on the rail › Open in a new window (main window shows a faint "open in another window" picture, Close window returns it, several at once); board side panel folds with › / ‹; desk DM screen compact, "On the board" replaced by a Session box (one prep section at a time, ‹ ›, hover for detail, ⧉ pops the section out); DM notes title on one line; prep section numbers follow the ↑ / ↓ order everywhere. Details in `docs/STATE.md`.
Owner's decisions: Session box shows one section at a time with left/right arrows. Defaults picked: clicking the faint picture brings the window forward; pop-out positions not remembered; Session box shows the running or next session's sheet, read-only text (ticks for Played / Followed up / Revealed); side panel fold kept while the app is open; card sheets from a pop-out open in the main window.

## 2.5.0 (built 2026-10-15)
Encounters battle map sketch as a small square on the left (example map, ✦ Draw battle map), opens in the middle, ⇲ Minimize to the side; one ⧉ pop-out button everywhere (Session box left of its title, DM notes, Notes, prep); desk clock buttons wrap; Add a player character moved to the chest (Create from scratch / Import a character sheet…), party panel buttons gone; board Ctrl/Shift+click multi-select with a right-click menu changing all selected cards in one undo step. Details in `docs/STATE.md`.
Defaults picked: sketch square shows the example map (not the encounter's sketch); big/small kept while the app runs; party-row + card on the mat kept.
