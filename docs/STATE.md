# Dungeon Zen: what is built (detail)

Moved from CLAUDE.md (2026-10-06). Read the section for the area you touch; update it when a feature changes.

Phase 1 so far:
- Board: start screen (new/open/recent campaigns), campaign folder with
  `campaign.db`, global and storyline views, cards for every entity type,
  strings (known/secret, typed), notes, resolved cards, search highlighting,
  double-click a card to open its sheet.
- Entity sheet: editable 5e stat block (size, type, AC, HP, speed, scores with
  modifiers, saves, skills, damage and condition lines, senses, languages, CR,
  traits), attacks/spells/actions with Roll20 macro text and token action /
  macro bar options, campaign template, "What the party knows" (per field and
  per string, dated from campaign time), Bio and notes, Connections, Duplicate.
- Library: new from template, campaign search (text incl. abilities, type,
  tag, CR and HP ranges), SRD 5.2 monsters and items with "Add copy".
- History with Revive/Restore, change log with "Undo to here", Ctrl+Z/Ctrl+Y.
- DM desk (landing screen, desk style): clock dial with sun/moon and sky,
  moon phase, party ledger, board counts, storyline tarot cards, the map on
  parchment (zoomable), DM notes journal, party tarot cards, decorative props.
- Map screen: imported map, zoom and pan (wheel, drag, keys, buttons), map
  picker, rename or remove. Maps are copied into `assets/maps` and served via `dz-asset://`.
  Regions: draw (click corners, Enter), edit corners, tie to a new or existing
  Location card, sub-regions ("Inside"), remove to History. Click a region:
  Here now (cards located or tied there), planned encounters, plot points,
  notes, sub-regions. Party banner: Move party here or drag it, Confirm travel
  (estimate from the map scale or a remembered trip time) moves the clock and
  logs the trip in a running session, one undo step. Route of the session's
  moves. Desk and live maps show the regions and party (read only).
  Geometry in `src/shared/geometry.ts`. Renderer reads that change nothing use
  `useBoard().query` (no refresh); `act` refreshes the store after each call.
- Day and night lighting on desk-style screens (darkens 17:00 to 20:00,
  brightens 05:00 to 07:00, candles lit only at night; on/off switch).
- Editing: campaign settings (name, rules edition, exact time, full-moon day),
  storylines (title, status, major, card picture, move to History), maps
  (rename, remove), entities (card colour, your own fields, move to
  History), History restores storylines and maps too.

SRD content is bundled (`resources/srd/srd-2024.json`, built by
`node scripts/build-srd.mjs` from the Open5e project's data, CC-BY-4.0, the
attribution is shown in the Library). The live Open5e API was not reachable
from the build environment; online search of other Open5e documents is not
built.

- Time engine (`src/main/engine`, pure, 14 unit tests): world state from
  deltas (later wins, DM beats autonomous in the same minute, superseded and
  what-if drafts excluded), timeline projection (acts resolve in end order:
  DM choice, then a trigger's forced outcome, then the default if the storyline
  runs on its own; player-active storylines wait), triggers fire once and only
  reach forward, what-if diff. The engine only projects; nothing it decides is
  saved until the DM chooses an outcome ("Approve: this happened").
- Timeline screen: storyline lanes by day (full and new moons marked), act
  blocks by state, ghost of the planned position when a trigger moved an act,
  dotted trigger connectors with T1/T2 badges, NOW line, zoom, add acts
  (button or double-click), act panel (title, summary, times, outcomes with
  default, This happened, Preview what-if, triggers add/edit/remove).
- Live session desk (rail: Live): start/end numbered sessions; clock
  (+10 m, ±1 h, Set); party health (sum of PC hit points, rests: short = 1 h,
  long = 8 h and full HP); today's tally (fights, meetings, quests, counted for
  the campaign day); advisor (local rules: fights vs health, nightfall, no long
  rest, player acts ending or waiting for an outcome); quick-log with time
  taken (moves the clock in the same undo step), "They met…", "They met someone
  new"; session log (edit, remove); party cards with HP −5/−1/+1/+5 or exact;
  read-aloud scene text per session; On the fly (offline): roll a character
  (made-up name and details plus an SRD stat block), suggest an encounter (2024
  XP budgets from the SRD), fill a tavern; put on the board or save for later
  (stashed; Library shows "Put on board"); Draw a battle map. End session saves a recap started from the log.
- Session review (End session and review, or Review on any past session):
  conflicts first (a logged meeting with a card in History: bring back, remove
  the entry, explain, leave flagged, reopen); proposed changes table (act
  outcomes the engine resolved by default or that wait for the DM, with
  trigger ripples; what the party knows about people met) with Approve, Edit
  or Choose (with what-if), Reject, Flag; Approve all unflagged (one undo
  step); encounter feedback per fight; recap and a player-safe recap drafted
  from the log (unknown people become "a stranger"), Copy, Save to DM notes;
  Undo whole session (redo brings it back). Decisions are remembered per
  session.
- AI services (rail: AI, or the start screen): service drop-downs for writing
  and battle maps, API key per service (encrypted with safeStorage in
  `userData/ai-keys.json`; refused if the computer cannot encrypt), model with
  the service's own list (Fetch list), address for local services, Test
  (writing: one short answer; maps: account or model list, no paid image).
  Choices live in `userData/profile.json`, app-wide, not in campaigns.
- AI scene text (Live › Set the scene): Draft with AI / Rework with AI, sent the
  time, light, moon, the party's place and its notes, who the cards put there
  and the last log lines (`src/main/ai/scene.ts`); the answer is a blue dashed
  "AI suggestion" box until the DM uses it (Use this, Add below mine, Try
  again, Discard); using it is an undoable change.
- Battle maps (Live › On the fly, or Map › Draw a battle map): name, what is
  there (started from the scene text or the place's notes), setting, size in
  squares, light from the clock; the DM's example maps (style examples, kept in
  `assets/styles`, rename, remove to History; up to 4 sent to services that take
  them); "What the AI is told" is shown and editable (`src/shared/battlemap.ts`
  builds it: top-down, square grid, no grid lines/text/tokens). The picture
  waits in `assets/pending` (cleared on open) until Keep, which makes it a map
  of kind `battle` with a grid, its source and prompt (one undo step). The app
  draws the grid lines (`GridLines`); any map can get a grid in Scale and grid.
- Modes: the rail's Prep / Live / Players switch (`store.mode`; the rail shows
  Desk, Session prep, Encounters, Board, Library, Notes in Prep; Live desk in
  Live; What they know in Players). Going to a screen sets its mode; the Map
  keeps the current one. Since 1.6.x no rail buttons for Map, Timeline,
  Generators: Map from the board top bar, Session prep and Live desk headers;
  Timeline from the board top bar; Generators from Library (Roll tables) and the
  Live desk header. The rail scrolls on its own in short windows (the page never
  scrolls past the desk: `.desk-screen` overflow hidden).
- Session prep (Prep › Session prep, `PrepScreen.tsx`; 1.7.0 follows the owner's One-Page DM Session Prep):
  one sheet per session number (`session_prep`, `prep_item`); title, for session, pacing target; 1 Session
  opening (`premise`), 2 Likely scenes (location, location card, type, target time, tension; Played; Spread
  times evenly), 3 Secrets & clues (kind discovery: text, short name, where; Revealed), 4 NPCs (card, name,
  wants = `role`, how to play them = `body`; a card fills motivation and quirk), 5 Loose threads (kind thread,
  Followed up; Bring in from last session copies the previous sheet's want-next lines and unticked threads,
  one undo step), 6 Session recap (What happened = that session's `recap`, shown once it has started; What the
  players seem to want next = `want_next`), 7 World bible updates (kind bible; Make a card as the type picked:
  name from the line, line as bio, one undo step, then Open card). Side: the one-page test, Encounters (links
  to each encounter and the Encounters screen), backup names (Roll 4 names), notes. Save as notes file writes
  "Session N - Title" to Notes (Word; again = new version of the same file, renamed if the title changed; Open
  it in Notes). Reorder, remove to History and restore, undo. Old clues joined the secrets; the threats section
  is gone (their text went into the sheet's notes).
- Live › Where they are (`WhereTheyAre.tsx`, `Campaign.liveWhere`): place,
  came from (last other position), heading to (setting `heading_location_id`,
  with travel time), tips, notes, who is here (Met / Not met / KEY, They meet),
  secrets here (unknown secret strings touching the place or people there,
  CLUE cards, prep clues with Found), tonight's prep (premise, pacing against
  real time since the session started, tick discoveries and scenes). Ask AI
  (`src/main/ai/ask.ts`): An NPC here, A scene here, Complications, Rumours,
  Something to find, Names, or free text; answer is an AI suggestion: Add to
  session log, Save to DM notes, Copy, Discard.
- Player preview (`PlayersScreen.tsx`, `Campaign.playersView`): only known
  things: last player recap, place and its "What the players see"
  (`attributes.player_notes`, edited in the Map region panel), came from,
  heading to, people met (name only if known, else "A stranger"; only known
  fields), revealed discoveries, known strings, the map with only visited
  regions and their player notes on hover. Tested to leak no DM notes.
- Encounter planner (Phase 4; Prep › Encounters, `EncountersScreen.tsx`): an
  encounter is a SCENE card with `attributes.encounter = true` (old "Suggest an
  encounter" scenes are taken over), placed with a LOCATED_AT string; who fights
  is `encounter_creature` (card, count, notes). Add cards, SRD monsters (copied
  once, then reused) or an SRD suggestion for the target; aiming for Low /
  Moderate / High, tactics, notes, battle map. 2024 XP meter
  (`src/shared/encounter.ts`) with budgets adapted to the last 10 fight ratings
  from the session review (too easy +20% … nearly deadly −25%, 0.7 to 1.4).
  House rules (setting `house_rules`) and Ask AI to rate (`src/main/ai/encounter.ts`).
  Run it now logs a fight linked by `log_entry.encounter_id`; past runs and their
  ratings are listed. Region panel: Plan an encounter here. Live: Encounters here
  with Start fight.
- Roll20 export (`src/main/exporters/roll20.ts`, `Roll20Dialog.tsx`; from a card
  sheet or an encounter): paste-in macros (the card's own macro, else built from
  the description: attack, damage, save) with token action marks, Copy all / Save;
  or the API script (Roll20 Pro): install `DUNGEON_ZEN_SCRIPT` once, paste the
  data into the GM notes of a handout "Dungeon Zen import", type `!dz-import`
  (`--replace` refreshes). Creates characters with 5E-by-Roll20 NPC attributes
  and token-action abilities; tested against a stand-in Roll20. Battle maps: Save
  image for Roll20 with the page size in units.
- PDF and JPG (`src/main/exporters/pages.ts`, `render.ts`, `ExportDialog.tsx`;
  Library › Print or save, card sheet › Print or save / Print letter, encounter ›
  Stat sheets): character sheets (DM copy with notes, or player copy with only
  known fields), letters (HANDOUT `text`, `from`, handwritten or printed, wax
  seal), bulletin board (QUEST/HANDOUT/CLUE notes with `reward`), A4 or Letter.
  Rendered in a hidden window (printToPDF, capturePage); several JPGs go into a
  chosen folder. Handout text, Signed by and Reward are on the card's second tab.
- AI notes import (Phase 5; Prep › Import notes, `ImportScreen.tsx`): drop files
  or Choose files; read locally (`src/main/importers/read.ts`: .txt/.md, .docx via
  a small zip reader `zip.ts`, PDF via pdfjs-dist text, pictures sent to the AI as
  images) into parts with locators (¶n, pages); preview shows parts = AI requests.
  Each part goes to the writing AI with `NOTES_SYSTEM` (`importers/notes.ts`): cards,
  storylines with acts, strings, questions, each with quote, where and stated or
  inferred; replies parsed leniently (bad items counted as dropped), parts merged,
  duplicates matched to existing cards (`findDuplicate`; exact match defaults to
  merge). Progress events (`import-progress`), Stop after this part. The draft is
  saved in the campaign folder `imports/<id>.json` (not campaign data, rule 2;
  status open / committed / discarded). Review: per card Create new / Merge into /
  Skip, type, name, summary, details, Stated or AI guess badge, source quotes;
  storylines, strings (secret), questions (answer, options, Later). Create
  selected = one undo step (`Campaign.commitImport`): merges fill only empty
  fields; cards keep `attributes.provenance` (shown on the sheet as "Where this
  came from") and `attributes.imported`; acts one day apart from now; answers go
  to the card's DM notes or the journal. Images in all three text adapters.
- Fill blanks with AI (card sheet › Fill blanks with AI…; `src/main/ai/fill.ts`,
  fields per type in `src/shared/cardFields.ts`): tick the empty fields (and, for
  an NPC or monster without one, a stat block from an SRD base), optional hint;
  the AI sees the card, its strings, storylines, notes and own fields. Suggestions
  are editable, tick which to keep; Use selected = one undo step
  (`Campaign.applyFill`), writes only still-empty fields, records
  `attributes.ai_filled` (labels show "(AI)"). The sheet's Details panel shows and
  edits every per-type field and any other text a card carries (e.g. from imports).
- Packaging: `npm run dist:win` (electron-builder, `electron-builder.yml`) makes
  `dist/Dungeon-Zen-Setup-<version>.exe`: per-user NSIS, no elevation, choose folder,
  Start menu and desktop shortcuts, data kept on uninstall. Only runtime modules ship
  (better-sqlite3 with just `win32-x64.node`, drizzle-orm, zod, pdfjs-dist without its
  native canvas: `read.ts` supplies a small DOMMatrix). Icon from `build/icon.svg`
  (`npm run icon`). Single-instance lock and app id `com.dungeonzen.app`.
  `.github/workflows/windows-installer.yml` builds on Windows and attaches the
  installer to a Release for `v*` tags. Built and test-installed under Wine here
  (per-user folder, shortcuts, HKCU only); Wine needs a build with
  `customCheckAppRunning` emptied because it has no PowerShell (test only).
  Not code-signed yet: SmartScreen warns.
- Backups (1.6.0): `Campaign.backup` copies the folder (not `backups/`, pending, WAL) to `<backup folder>/<name> YYYY-MM-DD HH-MM`, keeps the newest 20; made on session end and on open when none today (`backupIfDue`); folder = setting `backup_folder` or `<campaign>/backups`; Setup › Backups… (list, Back up now, open, choose folder).
- Desk easter eggs (1.6.0, `src/renderer/art/DeskEggs.tsx`): click the header candle to light or put it out; put out on a full-moon night (moon "Full moon", darkness > 0.5) a hobbit walks in and relights it. Click the mat's d20 to roll it: it lands somewhere in the lower mat and stays (browser storage `dz-d20`); a natural 20 brings a dancing dwarf with a lute and a short Web Audio tune. Looks only; nothing saved in the campaign.
- Foundry VTT / Owlbear Rodeo (1.6.0; Setup › Export to Foundry VTT or Owlbear Rodeo…, `export:vtt`, `src/main/exporters/vtt.ts`): a dated folder in `exports/`, opened when done, README inside. Foundry: scenes (map background, grid size from squares across, 5 ft), dnd5e actors (scores, AC, HP, speed, CR, size, traits as feats, abilities as weapons/spells/feats, token picture), journal entries for handouts, pictures under `dungeonzen/pictures/`. Owlbear: maps named with their grid, token pictures, all sheets in one PDF, handouts as JPG.
- Master notes (1.6.0; Notes › Master notes): every note in one document (DM notes, sessions, notes files), contents down the side (each note and its headings, click to jump), search, Edit a section in place, "Linked to the note" tick box: linked = the note itself (edits save to it), unticked = the master's own copy (setting `master_notes`, `notes:masterLink`/`masterSave`). Save as Word… (note titles as Heading 1, their headings one level down).
- Board map view (1.6.0, owner's option B): board tool "Map view" swaps the canvas for `MapViewPanel` (MapScreen.tsx: the Map screen's workspace for one map: regions, Draw region, Find regions with AI, Scale and grid, party token, travel with checks); picks the board's background map (matched by image path), else a menu of maps. "Back to the cards". Map screen stays.
- Map dragging (fix 2026-10-16): `MapView` pointerdown prevents default, clears any selection, focuses the frame; frame `user-select: none`; picture drag-out (`main.tsx`) skips `.mapview-frame`. Before, a double-click zoom selected the map/labels and the next press started a native drag (pointercancel), so panning stopped after a few pixels.
- Other card type (2.7.0, owner): `OTHER` (stone grey #7a7464, star emblem, Description / Details / History fields, Library template Other, notes import "anything else").
- Board side panel › Find a card (2.7.0, owner): under the Inspector/Links/Story/History tabs, a name box and a type drop-down list this board's cards; a pick (or Enter) selects it, centres the board on it and makes it glow twice (`is-found`). A new board card's placeholder name is selected, so typing replaces it.
- Empty things dropped (2.7.0, owner): a card from a New… button (board Card menu, Desk, Library), a board note, a prep row (Add…, Add new link/secret/clue) left untouched is removed for good when the DM clicks away (`fresh.ts`: card = sheet closed or deselected, note = deselected, prep row = click outside its `data-row` or screen change; 0.5 s later `blank:discard`). Main `discardIfBlank`: the creating step must be all inserts and the only step touching its rows apart from board moves; deletes the rows and those steps (no History, no change log, no undo). Board pane click now clears the selection.
- About Dungeon Zen (2.7.0, owner): name and version, welcome line, campaign and settings folders, folds Terms of use / Licensing (SRD 5.2 CC-BY-4.0 attribution, not affiliated with WotC, open-source parts) / Privacy (no tracking; only chosen AI services and Open5e go online). Texts are the owner's standard-format placeholders, not legal advice.
- Button hover (2.7.0, owner): in the desk theme a hovered button keeps its own face, slightly darker with an inset shadow (`theme.css`); the old base rule (dark #20252c, which the theme had covered with a see-through fill showing the wood) no longer applies inside `.desk-theme` (`styles.css`).
- Desk DM screen (2.7.0, owner): −1 h / +1 h / Set… on one row, smaller; clock picture 136 px; moon picture 84 px, centred with its words; the DM screen's − ↑ ↓ (on The hour's title) sit at the screen's top right, over the Session box.
- Map side panel (2.7.0, owner): no "Locations not drawn yet" list (New region still offers them).
- Map screen header (2.7.0, owner): Draw a battle map and Import map gone; New map opens the guide's world map step (I have a map / Make one here / Have an AI draw one); the empty Map screen has New map too. Battle maps stay in Encounters and Live › On the fly.
- New campaign folder window (2.7.0): `campaign:create` sends a mouse move where the pointer is before the folder window opens (`showCursor`, ipcHandlers.ts): owner's pointer stayed hidden over it on Windows after typing the name. Not verifiable on Linux.
- Map scale and travel (2.7.0, owner's mockup v4): Confirm travel reads "<distance> from <place> to <place>" (Start / Destination outside regions; `fmtTrip`, chosen system only), Pace drop-down (Slow walk, Normal walk (default every time), Fast walk, Jog, Run, Mounted, Cart; `PACES` with round mph and km/h; Own speed… box) fills Hours/Minutes from distance ÷ pace (a remembered route time still fills first, `estimate.saved`), dashed line from the party to the drop. Window drags by its title, place in localStorage `dz-confirm-travel-pos`. Footer: Set map scale… / "Map scale: the map is X across · Change…" and Show the scale key on the map. Set map scale (MapWorkspace mode `scale`): a two-row bar (`ScaleBar`, image pixels, DM's system on top) laid in the middle of the visible map (`MapLayerContext.visible`) at the saved length; drag middle to move, yellow ends to stretch; "The bar is [1–999] [ft mi m km] long", Save scale sets `width_km` and `scale_len`/`scale_unit` (`map:setScale` bar). Scale key (`scaleKeyLayout`, about 200 screen px, round length): on by default, drag to move (`map:setScaleKey`, image pixels, undoable), also shown read-only on desk, Live and Players maps (not on the board). Scale and grid lost its Travel pace box (pace is per trip; `travel_kmh` kept).
  - 2.8.0 follow-up (owner, 2026-10-17): distance measured from the party token to the drop point (no longer region centres) on an invisible travel grid (`gridDistance`, 200 squares across the map, ends snap to square centres, straight line; remembered route times still win). Map side panel › Scale (always shown on world maps, under the region panel): map width · Change…, Show the scale key tick, "drag to move, right-click to hide", known-lengths hint (`SCALE_HINT`: town house, city block, walled City of London, a day on foot; also in the Set map scale bar). Right-click on the key hides it.
- Travel checks (1.6.0): Confirm travel (1 h or more) shows one d20 check per started 4 hours (`travelChecks`) on "Every 4 hours of travel"; an encounter result rolls on the destination region's table (`encounterTableFor` by kind and land). Roll here or in Roll20; Log it (session running) adds a log note; nothing happens on its own.
- Generators (1.6.0; Library › Roll tables or Live desk header, screen 'generators', `GeneratorsScreen.tsx`): On the fly builders (character, SRD encounter, tavern, battle map; shared with Live) and roll tables (`src/shared/rolltables.ts`: ~70 built-in tables in 8 groups, {table-id} nesting, die shown for rolling in Roll20). Result: Copy, or Put on the board as a card type you pick (`generator:toBoard`, summary = text). Own tables (setting `roll_tables`, typed or pasted, `parseEntries` drops numbers/bullets), Edit, Copy a built-in to my tables, Move to History / Bring back.
- Library folders (1.6.0): In this campaign is grouped by card type in closed folders (open while searching or filtering); the SRD list sits in a closed folder too.
- AI recap (1.6.0): Review › Session recap › Write with AI (`ai:recap`, `src/main/ai/recap.ts`): reads the log with names, the session's DM notes and the current recap; the player-safe version only sees the player-safe draft. AI suggestion box: Use this recap / Add below mine / Discard.
- XP (1.6.0): PC `attributes.xp`; End combat ticks "Add N XP to each character" (equal share, `combat:end` xp, same undo step); sheet class strip XP field with XP to next level (`xpProgress`, PHB thresholds), close/level-up in red; Desk party cards and ledger show XP.
- Re-import (1.6.0): Map › Re-import picture… (`replaceMapImage`: new file, regions and party positions stretched to the new size, one undo step); Notes › Re-import file… (new version, then propose card changes for what changed) and Read again with AI… (all lines to the update-cards proposal); encounter picture Replace (old file to Removed); PC/NPC sheet › Character sheet file ▾ (re-import onto this card, or read notes files again; `CharSheetDialog` targetId).
- Notes list and contents (1.7.0, owner, Campfire-style; `NotesLibrary.tsx`): the list is a tree: DM notes,
  sessions and notes files each open out (▸) to their headings (`notes:outline`), click one to open the note at
  it; « hides the list (browser storage). Notes files sit in the DM's folders (`note_doc.folder`; Move to folder ▸
  existing, New folder…, No folder; drag files onto a folder; right-click a folder: Rename folder…, Take the
  notes out). Ctrl+click / Shift+click selects several. Right-click a file: Open, Open file location (Explorer,
  `notedoc:showInFolder`), Rename (in place), Duplicate, Save a copy as Word…, Move to folder, Delete (to
  History); several: Combine… (dialog: order, title, keep the originals or move them to History; one undo step;
  pictures left out), Move to folder, Delete. Delete key deletes the selection. Every open note has a Contents
  panel (its headings, click to jump; text notes use # lines) and Find headings… (`guessHeadings`/`headingLevel`
  in `noteDoc.ts`: Chapter/Part/Act lines, numbered, ALL CAPS, Session/Scene and bold short lines; the DM ticks
  them and picks the level; Make headings saves one undoable version). History lists notes files: Restore, or
  Delete file for good (are-you-sure; every version to the Recycle Bin; not undoable).
- Campaign folder holds everything (1.5.x): `campaign:openFolder` (sub: '', assets, maps, styles, pictures, notes, board, encounters, exports) behind `OpenFolder` links on Map, Library › Pictures, card pictures, Notes, board Background menu, Print or save, and Setup › Open campaign folder. Save dialogs (PDF/JPG, text, Word, map image) start in `<campaign>/exports`. Encounter pictures: "Copy from a folder…" copies a folder's pictures in; an encounter still on an outside folder shows "Copy into the campaign" (copies, then back to `assets/encounters/<name>`).
- Import a character sheet (1.5.x; Desk › The party, Notes): PDF (fillable forms read: `pdfPages` appends form field values), pictures (sent to the AI as images), Word or text; files go into the notes (`charsheet:importDialog`), then the Make a character card review (`CharSheetDialog`, pictures allowed now).
- Encounter party (1.5.x): each encounter lists every active PC (name, level from the sheet's classes else the party level, HP), ticked by default; unticked ids in `attributes.pcs_out` (`encounter:update` pcsOut, undoable). Budgets sum per ticked character's level (`rateEncounter` takes a level list); Run encounter starts with the ticked PCs only, the Battle planner (before the fight) plans for them. Ticks apply when the fight starts.
- Battle grid (1.5.x): `map.grid_shown` (off by default, also for maps from before): Draw a battle map has "Show the battle grid on the map" (preview, keep and import follow it); Map › Scale and grid ticks it on or off later (`map:setGridShown`, undoable). The size in squares counts either way.
- AI regions (1.5.x): before adding, click a proposed region (map or row) to fix its border: drag corners, click a mid dot to add one, right-click to remove, Reset border. The same finder (`FindRegions`) opens on Map › Find regions with AI and right after Map › Import map.
- Getting started guide (1.1.0; `GuideScreen.tsx`, screen 'guide'): a new campaign
  (setting `getting_started` = pending, `CampaignInfo.gettingStarted`) opens on it;
  Desk › Getting started opens it again. Step 1 world map: Import a map picture,
  Make one here (`src/main/worldgen.ts`: offline, seeded; Voronoi cells, noise
  elevation, biomes by height/moisture/temperature and climate, smoothed; regions
  are merged cells per biome, open sea split N/E/S/W, settlements as small hexagons
  inside their land; painted to PNG by `src/main/png.ts`), or Have an AI draw one
  (`worldMapPrompt`, image service). The picture waits in `assets/pending`; Keep
  (`Campaign.keepWorldMap`) makes it the desk map with all its regions and Location
  cards (one undo step). Step 2 regions: Find regions with AI (`src/main/ai/regions.ts`:
  the map, made smaller, goes to the writing AI; outlines on a 0–1000 grid, parsed,
  towns put inside their land) as ticked proposals, Add selected = `addRegions`, one
  undo step; or Draw them myself (Map). Step 3: Import notes, the board or the desk.
  Place kinds and biomes (`src/shared/places.ts`) are on Location cards
  (`place_kind`, `biome`), editable in the Map region panel; the map colours regions
  by them and marks settlements; names are placed off each other (`src/shared/labels.ts`).
- 1.2.0 (owner's list, 2026-10-06):
  - Board: right-click menus on cards, notes, pictures, strings and the board (`ContextMenu.tsx`;
    submenus flip to stay on screen); Hide/Unhide (`hidden` columns; a card hides on every board),
    Display › Show hidden things (greyed). Links panel (`ConnectionsPanel.tsx`): every string, kind
    filter, grey out cards/notes while open, the DM's own string kinds with colours (setting
    `string_types`), rename (one undo step), delete. Story panel (`StorylinesPanel.tsx`): storyline
    colours tint cards (`tintBackground`, diagonal split for several), act marks = Timeline acts
    (`act_entity`; numbered by start time; roman circles in the storyline colour), new storylines and
    acts. Linked boards: setting `link_positions` (moving or resizing a card moves its twins),
    `shared_strings` (off: per-board copies with `relationship.board_id`); turning either on asks which
    boards win (`WinnerDialog`). Pictures under the cards (board_item kind image; campaign maps first or
    any file into `assets/board/`; move, resize, opacity, lock, hide). Cards and notes resize
    (`NodeResizer`; small cards show less, down to the name). Prefs per computer in `boardPrefs.ts`.
  - Side panels resize by dragging the grip and are remembered (`Splitter.tsx`: `useSidePanel`,
    localStorage), on Board, Map, Timeline, Encounters, Prep, Players, Import, Review, Live, Library,
    sheets. The desk mat keeps its fixed layout.
  - Measurements: stored metric (`map.width_km`, `travel_kmh`; battle squares 1.5 m); Campaign
    settings › Measurements shows imperial (default since 2026-10-16; no setting = imperial) or metric (`src/shared/units.ts`; free text
    keeps its words, feet/miles shown converted by `convertText`).
  - Map tokens: Place party token; PC tokens split from the party (`party_position.entity_id`,
    `joined`); a split PC moves without the clock and counts as here in its region; Merge with party.
  - SRD monster browser (`SrdBrowser.tsx`, `srd:monsters`): filter by type, size, CR, alignment,
    movement, legendary; sort any column; add any number (Encounters, Library).
  - Monster sheet opens on Stat block (was Fight summary, `FightSummary.tsx`); NPC/PC open on Features, traits, background
    (picture beside it, creatures; 2.2.0): stat block to run the fight;
    Raise/Lower CR by the DMG table (`src/shared/crscale.ts`, previewed, one undo step); AI stat block
    from a description and options (`src/main/ai/statblock.ts`, proposal); picture upload or AI drawing
    (`attributes.picture` in `assets/pictures/` named `<card name>_<picture number>` (spaces to _, characters Windows forbids dropped), e.g. `Ottoman_1.png`, `Old_Mill_2.jpg`; existing files keep their names; `picture_source`).
  - Encounters: Save encounter, Scene box (`attributes.scene`), Build with AI (`BUILD_SYSTEM`; SRD or new
    monsters ticked and added; added cards are stashed, i.e. only in the encounter, until Put on board).
  - Run encounter (`CombatScreen.tsx`, `combat` table with one JSON state, `src/shared/combat.ts`): no
    dice, no initiative, the DM orders the list; rounds and turns (out-of-fight skipped), damage (temp
    first, concentration DC logged), heal, set HP (PC HP typed by hand, not linked to Live), temp HP,
    conditions with rounds (count down at round end), down/fled/surrendered, notes, add or remove
    combatants; morale and tactics hints from local rules (half a group down, guards hold while a
    leader stands, fallen leader, badly hurt, last one standing, allies' boosts from trait text,
    legendary, recharge) plus Ask AI; double-click a name opens its sheet, Back returns.
  - Back to the previous screen on sheets and the review (`BackButton`, Alt+Left); since 1.5.x every screen change is on the back stack (`pushed` in `store.ts`), rail Back button, Backspace (not while typing, a pop-up open, or a board selection to remove) and Alt+Left go back (`DeskRail.tsx`); the guide keeps its step (`guideStep`). Battle maps: import
    a picture, try again after an error, plain Gemini no-image messages. Timeline lane titles, XP meter
    labels, battle map field, SRD humanoid sizes "Medium or Small", Octopus scores fixed.
- 1.3.0 (owner's list, 2026-10-09):
  - Setup (rail, `SetupMenu.tsx`): New campaign, Open, Save (WAL checkpoint; every change is already saved),
    Save a copy (`Campaign.saveCopy`: whole folder), Print or save cards, AI services, About (version, folders,
    SRD credit), Uninstall (runs `Uninstall Dungeon Zen.exe` next to the exe; campaigns kept).
    Delete this campaign (1.5.x): are-you-sure dialog, closes it and moves the folder to the Recycle Bin (`shell.trashItem`; restorable there, not by Undo).
  - Board: Background pictures (was Pictures under the cards) with a Move: Cards / Background switch
    (`boardPrefs.layer`, not remembered between runs; the other layer is `is-passive`, faded cards); the frame
    is drawn over the board (`.canvas::after`) so pictures never spill over it. Ctrl+drag pans the board, Map and
    Timeline (`useCtrlPan`, capture phase: nothing is selected or moved; Shift-click selects several now).
    Right-click menus close on any click (capture `pointerdown`). Card menu › New link…: a string follows the
    mouse; the next card clicked asks "Link these two?" with the link type, Secret and "+ New link type…" with a
    colour (`LinkTypeFields`, also on the sheet's Connections; `relationship:create` `colour` adds the type in the
    same undo step). Strings attach to the nearest of six card points (`stringEnds` in `src/shared/layout.ts`).
  - Sheets: tabs Stat block, Character sheet (creatures; were Fight summary, Full sheet), "Features, traits, background" (creatures) or
    "Descriptions & history" (others; first tab), Secrets, Notes, Connections. Fields per type in
    `cardFields.ts` (`tabFields`), each tab with Fill blanks with AI (only that tab's empty fields; PCs too).
    Factions field on NPC/PC (MEMBER_OF) and Location (CONTROLLED_BY): strings to faction cards, New faction.
    Full sheet: character-sheet layout (ability boxes, proficiency from CR or PC level, speed, initiative, AC,
    HP now/max/temp, saves, passive senses, skills from `parseBonuses`, defenses and conditions, tabs Actions /
    Features & traits / Defenses / Details).
  - Desk party cards: portrait (card picture), AC, HP now (editable) / max + temp, PP, size, resistances,
    conditions (editable); Live party cards show temp HP and conditions.
  - Pictures: every card has a picture panel (Draw with AI… button, then icons: ✚ Add to picture, 🖼 Library, ⬆ Upload, 📁 folder, 🗑 Remove; no "Drawn by AI" badge, owner 2026-10-14); board cards
    show it. Library › Pictures (`PicturesTab`): folders (Art, Portraits, Places, Items, Maps, Battle maps,
    Background pictures, the DM's own), upload several, rename, drag to a folder, Remove to History, style
    example ticks (portraits, maps, battle maps). Draw windows (card picture, battle map, world map): "Prompt
    being sent" (editable, Reset), art style in words (setting), style example thumbnails for that use,
    none ticked at first (tick per drawing; owner, 2026-10-12);
    style tags per Library picture (owner, 2026-10-12; `style_example.tags`, `src/shared/styleTags.ts`): artist or
    school, period, medium, palette, light, textures and details, composition; typed in Library › Pictures › Style
    tags or Read style with AI (`pictures:readStyle`, writing service with the picture, suggestion to Keep/Discard).
    Draw windows blend the ticked pictures' tags (per field, no repeats) into Style/Medium/Palette/Light/Textures
    lines; card pictures also get Composition (tags, else the default asymmetric rule-of-thirds line), the field
    "Include in the picture" (was Anything to add), and "No text, no frame."; maps get style lines only.
    Composition picker (card pictures, owner 2026-10-12): 16 forms (`src/shared/compositions.ts`: rule of thirds,
    pyramid, steelyard, balanced scales, S-curve, diagonal, tunnel, radiating, circular, L, cross, three spots, group
    mass, silhouette, centred, pattern) with sketches drawn in code (`art/compositions.tsx`); default by card type
    (`DEFAULT_COMPOSITION_FOR`: people pyramid, monsters/scenes diagonal, places thirds, quests S-curve, items/clues/
    handouts centred, factions group mass); "As in the style examples" when ticked pictures have a composition tag. `maxReferences` per service (OpenAI and Gemini 4, Stability 1, others none).
    Card picture Draw window (2.2.1, owner 2026-10-14): prompt starts "An illustration of a <kind> named <name>." (no
    role-playing-game line; maps keep it) (kind: character for NPC/PC, else the card type in lower case; `entity:picturePrompt`
    returns subject/description/figure). Advanced composition fold (`AdvancedComposition`, `ADVANCED_FIELDS` in
    styleTags.ts): Description, Style, Medium, Palette, Light, Textures and details, Composition, Other details, each a
    box prefilled from the card, ticked examples' tags and the composition picker; changed boxes stay changed (back to
    the default per box, Reset clears all), this drawing only; prompt built from them (`advancedLines`; other details
    follow the composition line). Templates: Save style as a template (Style … Other details, named; same name
    replaces), Template drop-down, Remove template (campaign setting `prompt_templates`, status defunct, Ctrl+Z).
    Every Draw window: "Send the ticked pictures for reference" tick right under the style example pictures (small, muted), off by default; ticking
    examples changes the wording only, the pictures go only with this tick (battle map's "match the example maps"
    line too); smaller copies option shows only when sending. Style examples end with a + tile: Library upload
    (Art folder), ticked for this drawing, then uses ticks and style tags with Read style with AI (on click).
    Dialogs: scrollbar thin and inside the frame; a form's last button row is pinned at the bottom while scrolling.
    Card picture Draw window layout (owner's option A, next build after 2.2.1): two columns (`.draw-two`, one column under
    1000 px). Left: Description (box under its title; was "What it is like", owner 2026-10-14; above Include, owner), Include, style examples (+), Style box (Template drop-down, Save as template…, Rename or remove… list (rename any template, Remove any, Ctrl+Z),
    Remove; Style/Medium/Palette/Light/Textures rows, label left, ↺ per changed box), Composition box (picker, Composition
    and Other details rows), Outline. Right (sticky): the drawing or a placeholder, Change this picture, errors, Prompt
    being sent. `DrawExtras only="prompt" | "styles"` splits the shared part; the world map window keeps both together.
  - Notes (rail, was Import notes): Your notes (`NotesLibrary.tsx`) and Import notes. Imported files are kept
    (`note_doc`); Word/text/PDF open with formatting in `NoteEditor` (bold, italic, underline, headings,
    lists, tables; `src/main/importers/docx.ts` reads and writes .docx); Save writes a Word version (earlier
    versions listed, Bring back); Open in Word (copy in `notes-edit/`, changes brought in on return); Save a
    copy as Word; New note. Changed lines (`changedLines`) → "Notes changed: update cards?" → the AI reads only
    those → the import review, where merges show the card now beside the notes with Replace per field.
    Re-importing a file of the same name asks Replace / Keep both. DM notes: between sessions (setting) and per
    session (`session.dm_notes`, the desk journal while it runs); Pop out opens them in their own window
    (`#journal`, `JournalWindow.tsx`; windows refresh each other via the `changed` event).
- 1.4.0 (owner's list, 2026-10-09), Run encounter (`CombatScreen.tsx`, `src/shared/combat.ts`):
  - CR on every row (creatures) or level (PCs: `attributes.level`, else the party level); balance bar: foes ≈ CR of
    their total XP (`crForXp`) against the party ≈ CR of one creature worth their 2024 High budget, with the rating;
    only those still fighting count.
  - The fight follows its encounter (`Campaign.syncFight` inside every encounter-creature change): new creatures
    join at full HP; fewer take unhurt copies out first; new PCs join (`joinFights`). "Someone joins" is gone.
  - Damage types: resistance halves, immunity zeroes, vulnerability doubles (stat block text). Split (trait named
    Split, or text "splits into two" as on the 2024 Black Pudding reaction): on its damage types or on becoming
    Bloodied, 10+ HP, Medium or larger (`shrink` per split), two with half each. Mirror Image (3 duplicates, AC
    10 + Dex), Displacement (off when damaged, on at the start of its turn). Death saves at 0 HP (damage adds a
    failure). Bloodied rows in red.
  - Selected row (click; the current turn by default; Shift-click several for group damage with half on a save):
    `turnTips` (effects, recharge, legendary actions, slots left, targets) and its actions; Ask AI focused on it.
  - Terrain and spell effects (`state.effects`, presets `EFFECT_PRESETS`): everyone or chosen creatures, save and
    DC, damage, trigger, rounds (count down at round end); reminders on the row at its turn.
  - Expanded rows: HP/AC/DC/PP circle, last 5 rounds (damage, healing, reaction, concentration), legendary actions
    (back at its turn), legendary resistance, lair, limited uses (`limitedUses`: Recharge, n/Day, n/Day each
    spells; breath weapons with a save default to Recharge 5–6), Refresh and Refresh all; spell slots
    (`attributes.spell_slots` from the Full sheet or `slotsFromText`, used in `slots_used`, Long rest refills).
  - Notes pop-up (⤢). End combat dialog: XP total and per PC, defeated cards to resolve (NPCs ticked), summary
    to the session log; one undo step. Keys: N, P, digits type damage for the selected row (Enter damage,
    Shift+Enter heal).
- 1.5.0 (owner, 2026-10-09):
  - Notes › a notes file › Make a character card… (`CharSheetDialog.tsx`, `src/main/ai/charsheet.ts`): tick the
    files with the character (sheet, background, notes; ones starting with the same word pre-ticked); the writing AI
    copies them (`ai:charsheet`): stat block, attacks and spells, level, HP now, spell slots, casting ability,
    prepared spells, traits-tab fields, armor/weapons/tools, DM notes (added below). Review: new PC card or a PC/NPC
    whose name fits, "Now:" beside each, tick what to keep; one undo step (`Campaign.applyCharSheet`; old actions to
    History), then the card opens.
  - Full sheet editable and linked: proficiency bonus (own number `attributes.prof_bonus`, empty = level/CR;
    `profFor`), initiative (`attributes.initiative`, empty = Dex), walking speed, senses, languages, armor/weapons/
    tools (`attributes.proficiencies`), size, species/type, alignment, challenge inline. Save and skill dots click
    none → proficient → expertise (skills); bonuses typed over (`setListed`); scores and the proficiency bonus move
    listed saves and skills (`rebase`: plain proficiency and expertise follow, other bonuses move with the score).
  - Attacks: Actions tab lists non-spells; Add from the SRD… / Your own attack… (`AttackPicker.tsx`,
    `src/shared/attacks.ts`): SRD 5.2 weapons (proficient, magic +1–3; Finesse best of Str/Dex, Ammunition Dex) and
    spells (search, level, class, casting ability; cantrips scale with level) from `resources/srd/srd-2024-attacks.json`
    (`scripts/build-srd-attacks.mjs`); your own: roll (attack/save/none), ability, proficiency, extra bonus, reach,
    two damage lines, effects, live preview. Each gets a 2024-style description and a Roll20 macro; several are one
    undo step (`ability:addMany`). Make macro on every ability (`macroFor`, now in `src/shared/attacks.ts`).
  - Spells tab: spellcasting ability (`attributes.spell_ability`, default best of Int/Wis/Cha), save DC and spell
    attack, spells (kind SPELL) by level (`spellLevel`: description starts "Cantrip"/"Level N"), prepared ticks
    (`attributes.prepared`, ability ids), click to edit, add from the SRD or your own.
  - D&D Beyond list (owner picked 1–4, 6–8, 10–12; `SheetExtras.tsx`, `src/shared/charsheet.ts`), on the full sheet:
    classes strip for PCs (species = stat block type; class, subclass, level rows, multiclass; the total sets the
    level; `attributes.classes`); Heroic Inspiration box (`attributes.inspiration`, shown on desk party cards); Heal
    / Damage by an amount (temp HP first, `applyHp`); hit dice spent (−/+; dice from the stat block, else from the
    classes), death saves (3 + 3 ticks), exhaustion 0–6 (`hit_dice_used`, `death_saves`, `exhaustion`; desk card
    shows exhaustion); save notes (`save_notes`) and an A/D mark per skill (`skill_adv`). Actions tab: table (range,
    hit/DC, damage, notes; read by `abilityRow` from the description) with filters (Attack, Action, Bonus action,
    Reaction, Other, Limited use), attack cantrips too, attacks per Attack action, "Actions in combat"; click a name
    to edit. Spells tab: modifier / spell attack / save DC, search, level filter, a table per level with slot ticks
    (`slots_used`, same as Run encounter), Cast spends a slot, prepared ticks. Features & traits: Limited uses
    (`attributes.uses`: name, ticks, uses, back on short or long rest, Refill). Extras tab: companions, familiars,
    mounts = creature cards tied by a COMPANION string (pick a card or make a new one). Traits tab: gender, age,
    height, weight, eyes, hair, skin, faith (PC; the notes import and Fill blanks fill them too).
    Rests (Live): a short rest refills short-rest uses; a long rest refills all uses, hit dice, clears death saves,
    one exhaustion level off. Not taken: rest buttons on the sheet (5), inventory (9). Sheet keeps the desk style.
  - Run encounter PC rows show the sheet's Heroic Inspiration (toggle), exhaustion (with its −d20 / −speed),
    hit dice left (− spends one) and limited uses (ticks), written to the card (`CombatantInfo.pc`). Death saves
    live on the card (`attributes.death_saves`): the fight reads them (`combatView`) and writes changes back in the
    same undo step (`updateCombat`); the full sheet shows the same ticks.
  - Battle planner (`BattlePlanner.tsx`, `src/shared/battleplan.ts`, `Campaign.battlePlan`, `encounter:plan`) on the encounter
    (before the fight: the party and the encounter's creatures) and on Run encounter (the fight: HP, down, concentrating
    this or last round, foes still standing). Party spells by role (`spellRoles`: name lists, else the text): hits
    groups, takes one foe out, controls the ground, heals, stops spells; only those with a slot left (`canCast`).
    Who smart foes go for first (concentrating, healer, area spells, save-or-lose, low AC, hurt). Do / Avoid / Watch
    tips: spread out vs area spells (smart foes by Int ≥ 8; simple ones charge), protect the boss from save-or-lose
    spells (its weakest of those saves, Legendary Resistance), avoid choke points vs zones (ranged/flying foes shoot
    from outside), go for the healer, bait counterspells (caster foes only), downed characters, last foe standing.
  - Spell links (`SpellLink.tsx`): spell names in the planner, turn tips, morale hints and the effects line, and every
    attack/spell name in the turn panel, open the description: the character's version (with its numbers) and the
    SRD 5.2 entry. Everyday-word spell names (Light, Shield, Web…) link only when a character has them.
  - Encounter pictures and maps (`EncounterPictures.tsx`): a folder per encounter, `assets/encounters/<name>` in the
    campaign (made on first use, `attributes.folder`) or one the DM chose (Use another folder…, undoable); files put
    there in Windows show up (refresh on focus); Add pictures… copies in; thumbnails open in Windows; Remove moves to
    the folder's Removed subfolder; Open folder. Run encounter has a Pictures and maps button. Served as
    `dz-asset://encounter/<id>/<file>`.
- Card colours and map backgrounds (1.8.0, owner):
  - Board cards are coloured by type (tinted paper and a band on the left, `CardNode`, `.card` in `styles.css`);
    standard colours in `entityStyle.ts` (NPC and PC blues, Location green, Monster red, Faction plum since 1.8.0).
  - Board › Card: right-click a type to set the colour of every card of that type (campaign setting `type_colours`,
    `entityType:setColour`, optionally also clears colours given to single cards; one undo step; Standard colour
    resets). Card right-click › Card colour… and sheet › Card colour set one card (`attributes.colour`). Type colours
    show wherever a type swatch or badge does (`useTypeColour`: board, Library, Map, sheet, Import, Export).
  - Sheet › Card colour saves when the picker closes (`ColourInput` in `fields.tsx`; before 1.8.0 the controlled
    input snapped back and the colour often never saved, and only the small badge used it).
  - Board › Background: Use a map (a campaign map as a background picture, `content.mapId`), Add a picture…, Show
    map regions (board pref `regions`; regions drawn with `MapOverlay` over the picture, `ImageNode`), Show background
    pictures, Open folder. A card dropped on a region of a map picture takes the region's name as its location in the
    same undo step (`moveItems` › `placesOnMaps`, `regionOnBoard` in `geometry.ts`); a toast says where. Dropping
    outside every region keeps the old location.
  - Board rebuilds keep React Flow's `measured` size per node (`BoardScreen`): without it sized nodes lost their
    size and pins, so resizing a keep-aspect picture sent NaN to `items:move`, cards/strings could stay unshown after
    adding a map, and a click on a card sometimes did not select it. `onResized` ignores non-finite values.
  - Regions act as Location cards (owner, 2026-10-12): each region name on a board map
    picture is a `region` node (`RegionNode`, placed like `MapOverlay`'s labels via `placeLabels`): pin for strings,
    click selects (Inspector), double-click opens the sheet, right-click the card menu; not draggable (moves with
    the map), hidden while the background moves. `boardView` brings in the places of map pictures' regions and their
    strings. While a place's region shows on a board, its card there steps aside (not drawn) and its strings end on
    the region name; the card comes back when the map picture is hidden or removed
    (render only, nothing stored, 1.9.0). Show on board goes to the region first. Region names always show;
    Display › Region boundaries on maps (board pref `regionLines`, off by default since 2026-10-14) turns only the outlines on/off (`MapOverlay outlines`).
    Region names (owner, 2026-10-14): every region name, area or settlement, is cream writing on a dark brown tag
    (`MapOverlay` `NameTag`) on every map. On a board the tag is the region node itself, drawn like a card (19 px
    display font, 7 px Location-colour band, shadow; who is there under it); the picture draws only markers (`names={false}`).
- Board side panel for a card (owner, 2026-10-14, `Inspector.tsx`): name (editable) and Open full sheet; picture square
  (the card's picture, else its type emblem; click opens the sheet); one-line summary; Direct ties: every string as
  "Type → name" (from this card) or "Type ← name" (to it), Secret marked, click selects and centres the other card
  (not on this board: opens its sheet), plus Encounter → each encounter the card is in (creature, place or PC taking
  part; click opens it); DM notes; Status. Type, Location, Motivation, Tags, Storylines, Hide and Move to History are
  in the folded More section.
- Board view kept (2026-10-14): each board's zoom and position is remembered for the app run (`lastViewport` in
  BoardScreen); back from a sheet or another screen shows the same view; first visit fits all.
- JFIF pictures (2026-10-14): .jfif is taken wherever pictures are (maps, board pictures, card pictures, Library,
  outlines, notes files, encounter pictures); the copy is saved as .jpg (`storedExt`).
- Prep sheet word links (owner, 2026-10-14): every prep text box is a `LinkField` (textarea with marks drawn behind it):
  select words, right-click › Link to a card… (`CardPicker`: every card by type, search). Links are per sheet
  (`session_prep.links`: phrase + card, every place the phrase appears, any case). Cursor in linked words shows the card
  (name, type, place, picture, summary, DM notes, Open full sheet) in the side panel; a click elsewhere on the sheet
  brings the usual panel back. Right-click linked words: Show, Remove the link.
- Secrets, clues and connections (owner, 2026-10-14; replaces "Secret on the board"): table `secret` (kind secret | clue |
  connection, one text); each connection is a string with `relationship.secret_id` (dashed for secret/clue, clue strings
  blue with "CLUE ·", connection solid). The text is shared everywhere: prep line, card sheets, Links/string panel
  (a grouped string's description is the secret's text). A secret string tied on the board becomes a one-connection
  secret; unticking Secret on a one-string secret makes it a connection. `SecretEditor`: Card – kind – Card chips (card
  picker with search and Make a new card), Add connection, kind; saved once every connection is whole (and, on a card
  sheet, one is that card); until then a red line says what is missing and clicking elsewhere asks Update now / Do not
  save changes. Prep section 3 "Links, secrets, clues" (2.2.0): one Add new drop-down (Link, Secret, Clue, Select existing…
  = searchable pop-up grouped by kind, `AddSecretMenu`); rows have text, Short name, the editor (kind drop-down has
  "+ New link type…", `stringTypes:set`); no Where box (Live no longer lists prep lines by place) and no Use an existing one.
  Removing a secret's last link (board or anywhere, `setRelationshipStatus`) takes the secret and its prep lines to
  History; restoring the link brings them back.
  Card sheet › Secrets: Add secret / clue / connection, Use an existing one (the same secret, shared; must get a
  connection with this card), Remove (History, undo). Migration 2.1 turns every secret string and every string a prep
  secret was tied to into a secret. Old prep ties to Clue cards still share text but are no longer offered.
- String descriptions (2026-10-14): `relationship.description`, editable in the string panel and in Links.
- Links panel (2026-10-14): rows spelled out (both cards clickable, kind, Known/Secret, description, Hide, Remove),
  grouped Known then Secret, by kind. The left Links tool shows every link; the Links tab with a card selected shows
  that card's links, the rest under Show all links.
- Fold and move any box (owner, 2026-10-14, `fold.ts`): every titled box on every screen (`.panel-title`, `.panel-heading`,
  `.mat-heading` inside a section/parchment/panel) gets − / + (fold to the title; clicking the title also folds) and ↑ / ↓
  (move among the boxes beside it, by CSS `order`; a block parent becomes a column once reordered). Folds and orders are
  remembered per screen on this computer (localStorage `dz-folded`, `dz-box-order`).
  On card sheets an order is this card's own or every card of its type (`dz-order-scope`: a pop-up asks on the first
  move, with Don't ask me again; Setup › Box order on card sheets: Ask each time / This card only / Every card of its type).
- History (2026-10-14): removed secrets, clues and connections listed with Revive (their strings come back with them,
  where both cards still exist); their strings are not listed one by one. Prep lines tied to a Clue card (before 2.1)
  show "Shares its text with the Clue card X · Untie".
- Prep NPCs (owner, 2026-10-14): Card (pick or Make a card: an NPC card from the row), Name, Description, Motivation.
  Tied, these are the card's name, one-line summary and motivation both ways (one undo step; tying takes the card's text
  where it has some). Links and other info folds out: the card's strings (names open sheets), How to play them, the
  card's location and DM notes. `prep_item.description` (migration 2.1).
  Next build (2.2.2, owner, 2026-10-14, mockup option 2): `NpcRow` header with the name and icon tools (↑ ↓ ↗ Open, ⧉ Window,
  🗑 Remove); Name drop-down (NPC cards, + Create new NPC… makes the card right away, One-time NPC (does not create
  card) with its own name box: the line's title); Flaws (the card's `flaws`; a one-time NPC keeps them in `body`, the old
  How to play text) and Motivation on top. Fold (beige box): 2×2 Location (`LocationPick`) / Description, Links (beige
  list + "+ New link": this card – LinkTypeFields – CardPicker, a board string; red × per link sends the string to
  History, `relationship:setStatus` defunct, Ctrl+Z undoes) / DM notes (starts as tall as the links,
  up to 200 px, while empty). Show from the sheet: ticks (stat block summary, personality, ideals, bonds, voice,
  tactics, actions, spells) kept in `prep_item.stats` (comma list), read-only from `sheet:view`. No items list exists.
- Prep section numbers (owner, 2026-10-14): the round number is `.prep-n[data-n]` (CSS `::before`, so titles and kept
  folds/orders hold no digits; old "2 Likely scenes" keys are stripped on load); `fold.ts` `renumber` sets 1…n in the
  shown order after ↑ / ↓. A pop-out window keeps the section's own number.
- Location drop-down (owner, 2026-10-14, `LocationPick`): label "Location"; Location and Building cards (`places:list`,
  "(from map)" when a map region shows the place), + New location… (makes a Location card); a typed place that is not a
  card stays. Card sheet (Character sheet side / template), board side panel, building "Inside", prep NPCs.
- Pop-out prep windows (owner, 2026-10-14): "⧉ Window" on sections 1–7 and ⧉ per NPC open `#prep/<n>/<part>` in a
  BrowserWindow of its own (`openPrepWindow` in main/index.ts; one per part; size/place per kind in
  userData/prep-windows.json; closed with the main window). `PrepWindow` loads the store itself; card sheets open in the
  main window (`main:openSheet`). Every undoable write (`CommandLog.writes` moved) tells the other windows to refresh.
- Text keys in every text box (owner, 2026-10-14, `textKeys.ts`, any <textarea>): Enter = new line everywhere (one-line
  CommitField/LinkField boxes too; Ctrl+Enter saves and leaves, Esc puts back); Tab / Shift+Tab indent / un-indent
  (tab character, tab-size 4; Tab no longer moves to the next box); lists carry on ("- ", "• ", "*", "1." / "1)",
  numbers count up; Enter on an empty item ends the list); Ctrl+D duplicates the line(s); Alt+↑ / ↓ moves lines.
  Edits via insertText, so Ctrl+Z inside the box works. Spell check: main `context-menu` shows suggestions, Add to
  dictionary, Cut/Copy/Paste/Select all (boxes with linked-word menus keep theirs). Plain <input>s (names, search,
  numbers, Include in the picture) stay one line.
- Growing text boxes (owner, 2026-10-14): `textarea.grow` (field-sizing: content) up to about ten lines, then scrolls;
  the corner handle still pulls it bigger. LinkField one-line boxes wrap and grow (Enter still finishes); CommitField
  one-line boxes are growing one-line textareas (not ones with a datalist); multi-line ones start at their rows.
- Linked words: the marks' copy gets the box's scrollbar width (no more drift in long boxes); right-click on linked
  words (no selection needed) offers Show the card and Remove the link (the words stay).
- Draw windows: style examples show + then the 8 most recently ticked or added (localStorage `dz-recent-styles`), the
  rest and any ticked behind All examples… (battle map window keeps its full list).
- Link picker: Or make a new card (type + name from the words): makes the card, links the words, opens its sheet.
- Names typed in place (owner, 2026-10-14, `TitleField` in fields.tsx): a card sheet's title, a building's backdrop
  title, the Map screen's map name, the desk's campaign name and a fight's encounter name are edited where they show
  (Enter or click away saves, Escape puts it back, undoable); shown as plain title text, no box even while typing.
- Building sheet side panel (2026-10-14): same order as other cards: picture and Campaign template (name, type, one-line
  summary, tags, colour) first, then Details (kind, inside, factions), description and history, Secrets & clues folders,
  the other details, price settings. Main column: layout sketch always last.
    Outlines (board and Map screen) are drawn smoothed (`smooth` in `MapOverlay`, 2 rounds of corner cutting, shared
    borders stay one line), thin solid ink at 55%, lighter fill; clicks and drops still use the stored polygon.
    Card menu › Take off this board (`note:setStatus` on the card item; History lists it as
    "Card: name", Restore puts it back; cards that left with a storyline are not listed).
- Buildings (1.10.0, owner's list 2026-10-13): new card type BUILDING (slate `#5c6b73`), kind Tavern / Shop /
  Building (Details › Kind; tab named after the kind). Sheet (`BuildingSheet.tsx`): backdrop drawn in code per kind
  (`art/buildings.tsx`), floor tabs (main floor only at first; + Floor ▾ names or your own; right-click Rename, Move
  left/right, Move to History; Bring back from the same menu), floor bar with Show layout and ✦ Draw floor map.
  Taverns: Barkeeper & patrons, Layout, Rooms (one row each: number, name, base price, price here, Free / Taken /
  Not for rent, who), Menu & stock. Shops: Inventory first, then Shopkeeper & customers, Layout. People: keeper first,
  role/look/knows, secrets labelled Rumour / Secret / Clue with a score 1-20 sorted low to high; Players rolled (typed
  in) opens every secret at or below it. Right-click a person: Make NPC card / Make PC card (`buildingPatronCard`:
  card with location = the building, a LOCATED_AT string, patron keeps the card id; one undo step) or Open card,
  Edit, Add secret, Make keeper, Move to floor, Move to History; drag onto a floor tab moves them. Stock: + Add item ▾
  (SRD 5e prices bundled in `shared/prices.ts`, grouped) or + Own item; − / + quantity, ∞ = always, 0 = sold out;
  base price typed ("15 gp"); Here = base × campaign scale (Setup › Campaign settings, `price_scale`) × building
  scale (Price settings, folded at the bottom of the side column). Side: Secrets & clues with two folders, In this
  building and All campaign secrets (campaign's own list, Clue cards, other buildings' secrets; `secretPool`);
  right-click moves between them (`moveSecret`, one undo step; a Clue card is added with its card id); + Add ▾ new
  secret / clue / rumour or from a Clue card; purple = has its own card. Description, History (says how it got its
  name), Details (Kind, floors, Inside = location, Factions), template side. No sights/dangers/bio/what the players
  see on buildings. Removing anything inside a building marks it removed (History inside the card, Bring back ▾).
  Fill with AI (`ai:building`, `src/main/ai/building.ts`): one proposal for everything (description, history with
  the name's story, floors, keeper, patrons, scored secrets tied to existing cards by name, rooms, stock, rough
  layout per floor as rooms with doors); sections ticked; Keep selected adds them in one undo step; text marked (AI).
- Layout sketch (`SketchPad.tsx`, `shared/sketch.ts`): pencil-look grid of 5 ft squares stored as one character
  per square plus labels (tiny). Building tools: Room (walled rectangle), Wall, Door, Window, Stairs, Bed, Table,
  Bar, Hearth, Pillar, Label, Eraser; battle tools: Wall, Door, Room, Water, Trees, Rock, Pillar, Stairs, Difficult,
  Start: party, Start: foes, Label, Eraser. Each stroke one undo step; Undo button = app undo; size boxes resize.
  Encounters › Battle map sketch (a − / + fold at the bottom of the encounter since 2.2.4; the old Show sketch tick is gone) and Draw… / ✦ Draw battle map from
  sketch open the battle map window with the sketch. Draw window: Use sketch as blueprint (on), Show labels on the
  finished map, Keep start markers (off); Blueprint sent shows the plan and text. Sent as a flat-colour plan PNG
  (`sketchPng`) first, before style examples (OpenAI edits, Gemini parts; Stability uses control/sketch) plus
  `blueprintText` (follow exactly, size, colours, labels, square-by-square rows up to 1600 squares). Kept maps are
  tied to the encounter or the floor (Open the floor map).
- Who is in a region (1.10.0): every map region shows a blue chip with the NPCs and monsters there (location names
  the place or a building inside it, a LOCATED_AT string to it, or any string to a building inside it;
  `occupantsOf`), on the board's map pictures, Map screen, desk and Live maps; region panel Here now includes them.
- 1.10.1 (owner, 2026-10-13): AI error messages say what happened, the service's own words, and What to do
  (`statusMessage` in `ai/client.ts`; 5xx says it is the service's side and the key is fine); no automatic retry
  (owner). Draw windows (card picture, battle map, world map): "Send smaller copies of the examples" tick, off by
  default (`shrink` in `ipcHandlers.ts`: over 1024 px sent as 1024 px JPEG, files untouched). AI services › Model:
  a drop-down next to the box lists every fetched model (the old datalist hid names not matching the box). Every
  dialog keeps its title bar at the top while the body scrolls; AI dialogs (Draw picture, Draw battle map, Fill
  with AI, Fill blanks) get Minimize while waiting: a chip in the corner, the window pops back when the answer or
  an error arrives (`Dialog busy`).
- 1.11.0 (owner, 2026-10-13): Change this picture under every AI picture (card picture, battle map, world map;
  `ChangePicture` in `OutlinePad.tsx`, `image:update`): What to change box (empty after each update; the original
  prompt stays), optional marks drawn on the picture in six colours each with its own meaning; the picture (and a
  marked copy, `markedCopy` blends the marks in main) go back with `changePrompt` and no style examples; the answer
  replaces the suggestion (still only a suggestion until Keep). OpenAI images edits and Gemini take both pictures,
  Stability image-to-image takes the picture only (marks greyed out, say where in words); Replicate, fal.ai and
  local SD cannot (box explains). Outline in the card picture and world map Draw windows (`OutlinePanel`,
  `shared/outline.ts`): freehand pen in six colours, Label, Eraser, Last line, Clear, or one uploaded outline
  picture (`outline:upload`, copied to `assets/outlines`) with labels on top; saved on the card
  (`attributes.outline`) or the campaign (`world_outline`), each change one undo step; Use the outline tick per
  drawing; Write the labels on the picture (off). Sent as the first image (strokes on white, labels never drawn in)
  with "layout and shapes only, not colours, art style or details"; labels go in the prompt with where they are
  (`outlineText`); Stability uses control/sketch at 0.6.
- 1.12.0 (owner, 2026-10-13): Add to picture: card sheet picture panel, next to Draw with AI, when the card has a picture
  (any picture, not only AI). `AddToPictureDialog` in `Pictures.tsx`: `image:pendingCopy` copies the kept picture to
  `assets/pending`, then `ChangePicture add` (What to add box, sketch on the picture always open, one meaning per
  colour); `image:update add` sends `changePrompt(..., add=true)` (add only, change nothing already there). Result is
  an AI suggestion (add more on it, or Keep this picture: `entity:keepPicture`, Ctrl+Z puts the old one back).
  Board › Display › Card types (owner, 2026-10-13): a tick per card type; a type switched off leaves the board
  with its strings (view only, this computer: `hiddenTypes` in `boardPrefs.ts`, not campaign data, no undo needed);
  "Card types (n off)" and Show all types; making a new card of a type that is off switches that type back on.
  Region names on maps still show (they belong to the map picture).
  Speed: refresh results are structurally shared (`shared/share.ts`) and board nodes/strings reuse unchanged
  objects, so only changed cards redraw (500 cards, 1000 strings: an edit 344 → about 60-100 ms of screen work, a
  no-change refresh 300 → 0 ms); board draws only what is on screen; screens load the first time they open (start
  bundle 2.4 → 1.0 MB); pictures shown small use `?w=` small copies cached in userData/thumbs (originals untouched);
  pictures sent to image services are at most 1536 px (1024 with Send smaller copies) and prepared once per file
  (four big examples: 77.7 MB → 5.6 MB per drawing); Gemini asks for picture-only replies (falls back if a model
  refuses that mode); daily/session backups copy the pictures in the background and the app waits for them before
  quitting; storyline colour saves once when the picker closes; long lists skip off-screen rows
  (`content-visibility`); torn parchment edge filter on its own layer; Model drop-down marks faster image models.
  Not done: `synchronous = NORMAL` (faster writes, but a power cut could lose recent edits), no index was missing.
- Every screen uses the desk style (`DeskFrame`, `theme.css`): wooden bars,
  parchment panels, a cork board in a wooden frame, candles in the top bar
  and board tools, day and night lighting everywhere.

Not yet: the Guard Captain's SRD 2024 stat block has no ally boost (add a Leadership trait and the tracker shows it); rivers and roads on made maps; re-reading a draft with your answers; tokens on battle maps; Player preview in a second window (for a TV); AI help on the prep sheet; drawing a planned route (the route shown is where the party went); weather and NPC routines; outcome effects on cards (deltas from outcomes, e.g. move an NPC; the engine supports them, no editor yet); editing not yet possible: custom entity types, the date a fact became known, reordering abilities; images on the board, PC sheet PDF
import, code signing, auto-update; Phase 4 left: PDF of a whole session prep sheet, Roll20 maps
with tokens. Phases 1 to 5, the Windows installer (1.0.0), the getting started guide (1.1.0) and the 1.2.0 to 1.8.0 lists are built. Notes imported before 1.3.0 were not kept as files.

2.2.0 (2026-10-14, owner's list): every one-line text box scrolls back to its start on click-out (`main.tsx` focusout);
on-screen "string" and "connection" read "link" everywhere (data, code names and AI prompts unchanged; card sheet tab
Connections → Links); card sheet tab names Stat block / Character sheet.
- 2.2.4 (owner, 2026-10-14): battle map Draw window › Follow a picture (`FollowPicture.tsx`): pick a campaign map or
  Upload a picture… (copied to `assets/outlines`, `outline:upload` 'follow'), drag a box round the part to use (Whole
  picture link). Rows follow the box's shape; a map with a scale shows the part's real size and Use the map's scale
  (when 5–60 squares). Buildings show: Inside (default) / Roofs. Main crops with nativeImage and enlarges to 1536 px
  (`cropSource`), sent first as `follow` (Gemini/OpenAI: "the source picture to redraw"; Stability control/structure
  0.8); the sketch blueprint is not sent while following. Prompt `followPrompt` (shared/battlemap.ts): keep every road,
  river, building footprint, tree line in place, read blurry shapes by colour, 5 ft scale sizes (person 1 square,
  cottage 4×6, road 2–3), fine detail, no text/symbols/compass/grid/watermark/logo. Saved on the encounter
  (`attributes.follow`: map or path, box, buildings, size drawn at; `encounter:update` follow, undoable); opened from
  elsewhere it is kept while the app runs. A box bigger than 60 squares at the map's scale shows a warning with
  "Make the largest map" (`fitToMax`: box shrunk round its middle to 300 ft on its longer side, size set to match).
  Encounters: Battle map sketch moved to the bottom, foldable.
- 2.2.4 (owner, 2026-10-14): Encounters › Suggest from the SRD is a random roll (`suggestEncounter`): each pick is any
  SRD monster that still fits the XP budget, all equally likely, until nothing fits or 30 creatures (`MAX_ROLLED`).
  The box takes any words (`matchMonsters`: every word starts a word on the stat block: name, size, type, speed,
  senses, languages, traits, actions; "hills" finds Hill Giant; a creature type word means that type). No match, or
  only matches over the budget, says so (names, CR, XP). Live › On the fly keeps its exact creature type drop-down.
- 2.2.4 (owner, 2026-10-14): battle map Draw window › Advanced style and composition fold (left, under Anything else):
  Style, Medium, Palette, Light, Textures and details, Composition, Other details (`AdvancedRows`), filled from the
  ticked examples' style tags (`blendTags`, no book-illustration fallback), ↺ per box; `advancedLines` replace
  `withArtStyle` in the prompt. Templates (`TemplateBar use="battle"`) kept apart from card picture templates
  (`PromptTemplate.use`, old ones = portraits; same name allowed in each). Each ticked example's Style tags editor
  (Read style with AI, Keep/Discard) is in the fold too; tags save to the Library picture (`pictures:update`).
- 2.4.0 (owner, 2026-10-15): screens in windows of their own. Right-click Board, Encounters, Session prep, Library or
  Notes on the rail › Open in a new window (`window:popScreen`, `popScreen` in `src/main/index.ts`, one window per
  screen, `#screen/<id>`, `ScreenWindow` in `App.tsx`). The pop-out has its own rail: Close window (screen goes back)
  and Back; card sheets it opens show in the main window. The main window shows that screen as a faint picture
  "… is open in another window" (`PoppedOut`; click brings the window forward, `window:focusScreen`) and a ⧉ mark on
  the rail button; the list comes from main (`popped` event, `window:popped`). Writes in any window refresh the others
  (existing `changed` broadcast). Closing the campaign or the main window closes them. Positions not remembered.
- 2.4.0: board side panel folds with › on its left edge, back with ‹ (kept while the app is open).
- 2.4.0: desk DM screen compact: clock dial and moon beside their text, smaller titles; "On the board" panel gone
  (counts still on the board itself); Session box (`SessionPanel` in `DeskScreen.tsx`): the running or next session's
  prep sheet, one section at a time with ‹ ›, in the DM's section order, one line per item (hover for the rest),
  Played / Followed up / Revealed ticks, section name opens Session prep, ⧉ opens the section in a prep pop-out.
  DM notes title stays on one line beside Pop out.
- 2.4.0: prep section numbers come from the saved ↑ / ↓ order (`src/renderer/prepParts.ts`, `boxOrder` in
  `fold.ts`), so pop-out section windows and the desk Session box show the same numbers as Session prep.
- 2.5.0 (owner, 2026-10-15): Encounters › Battle map sketch starts as a small square at the bottom of the left
  Planned panel (example map drawn in code, `art/battlemap.tsx`, and ✦ Draw battle map); either opens the sketch in
  the middle where it was (scrolls to it), with ⇲ Minimize to the side back to the square; the − / + fold still
  folds it in the middle. Big/small kept while the app runs (all encounters). While open in the middle,
  Pictures and maps sits under the sketch inside it (owner, 2026-10-15); minimized, it stays after Scene.
- 2.5.0 (owner, 2026-10-15): one pop-out button everywhere, ⧉ (`components/PopOut.tsx`): desk Session box (left of
  its title), desk DM notes, Notes, prep sections and prep NPC rows; titles leave ⧉ out (saved folds kept), a button in a
  title no longer folds the box. Desk: The hour buttons wrap inside the panel; The party panel lost its Add/Import
  buttons; The chest › Add a player character opens Create from scratch / Import a character sheet….
- 2.5.0 (owner, 2026-10-15): board top bar New NPC button removed (Card tool / right-click › New card instead).
- 2.5.0 (owner, 2026-10-15): board Card tool type column closes on any click outside it.
- 2.5.0 (owner, 2026-10-15): History › Removed from board sorts: Recently removed (default; order from the undo log), A–Z, Type (then A–Z); kept while the app runs.
- 2.5.0 (owner, 2026-10-15): History › Delete for good: tick boxes, click / Ctrl+click / Shift+click to select, Select all,
  right-click › Delete for good…, Clear all history… (Removed list only; Change log stays). One are-you-sure, then the rows
  leave the database in one undo step (`Campaign.forgetRemoved`, `Writer.delete`): rows that need them (cards, links,
  abilities, a storyline's board…) go too, rows that only point at them lose the pointer (foreign keys read from SQLite).
  Ctrl+Z / Change log bring them back (owner chose undoable). Notes files go to the Recycle Bin as before.
- 2.5.0 (owner, 2026-10-15): board view bar on one row: View all cards (was "Global: all characters and plot points"),
  storylines, ‹ › when there are more off either side, + Storyline, Display ▾, Edit storyline.
- 2.5.0 (owner, 2026-10-15): board multi-select: Ctrl+click or Shift+click adds/removes a card (Shift+drag still
  boxes). Right-click one of several selected cards: "N cards selected" menu (Acts, Storylines, Mark active/resolved,
  Card colour…, Hide/Unhide, Take off this board, Delete to History); each choice is one undo step (`board:many`,
  `CommandLog.many`: nested commands join one step). Acts/Storylines tick when every selected card has it.
- Next build (owner, 2026-10-15): right-click a storyline button on the board view bar: Edit storyline…, Delete
  storyline (to History; undoable, History › Restore; the board goes back to View all cards if it was showing).
  Board › Story panel: Timeline link under each storyline's Edit, opens the Timeline.
- Next build (owner, 2026-10-15): Timeline: drag a day's right edge to resize every day column, drag the title column's
  edge (sizes kept while the app runs); − / + still zoom; ⊞ Show all, ⊟ Collapse all (storyline tick bar removed, owner 2026-10-15); drag a lane's bottom edge to set its height (90-600 px, per storyline, kept while the app runs);
  ▾ / ▸ per lane folds it to a thin title row (trigger lines and NOW follow); Board › Story › Timeline opens
  with only that storyline open (store `timelineFocus`). Act panel: Planned start/end on one row; Encounters line
  (chips open Encounters, × unties, + menu: New encounter… or tick existing; ties are act marks, `act:mark`).
- Auto card links (owner, 2026-10-15): every multi-line `CommitField` is a `LinkField`, plus prep and act texts; card
  names link by themselves (whole words, any case; `withAutoLinks`); the DM's own links win; right-click: Write it as
  "<card name>", Stop linking "<name>" by itself (setting `word_links` {own, off}, undoable). Marks take the card's
  colour (own, else type). Outside prep/Timeline the card shows in a corner note (`LinkedCardNote`, store `linkCard`).
  Store `wordLinks` (`links:view`) refreshes with every change. Spelling: card name words never flagged
  (`src/main/cardWords.ts` adds them to the dictionary); a near miss lists the card spelling first.
- Secret/clue/link editor: Add link › New link or Existing link… (board links tied to no secret yet; picking one ties
  that link to this secret, `secret:freeLinks`). Pop-out ⧉ button same size as the − ↑ ↓ box tools.
- Next build (owner, 2026-10-15): every campaign picture (`dz-asset://`) drags out of the app as its full-size file
  (Roll20, Explorer): `main.tsx` dragstart → `dragOut` (preload) → main `drag-out` → `webContents.startDrag`, small copy
  under the mouse. Not on board card pictures, board background pictures, the zoom map or Follow a picture (those drag
  for moving/panning). Library folder moves still work (drag a picture onto a folder). Picture files dropped on the
  board (Explorer or a picture from the app) become background pictures at the drop spot (`boardImage:add` `file`,
  copied into `assets/board`, undoable). Files dropped where nothing takes them no longer open in the window.
- Next build (owner, 2026-10-15): Desk › Session box ⧉ opens the whole Session prep screen in its own window
  (`window:popScreen` prep, same as the rail's Open in a new window; shows the running or next session), not one section.
- Next build (owner, 2026-10-15): Live › Where they are: every text (tips, place notes, secrets, Opening, pacing, prep
  scenes/secrets/threads, AI answers) links card names by themselves (`LinkedText` in `LinkField.tsx`, same auto links
  and own links as text boxes); click a name = card in the corner note (Open full sheet).
- Next build (owner, 2026-10-15): Live › Today so far: smaller buttons, − / count / + per row; − takes today's newest
  log row of that kind to History (`log:setStatus` defunct, undoable; `today.last`), works without a session.
- Fix (2026-10-15): Generators › Suggest an encounter with more than 10 kinds of creature failed on Put on the board /
  Save for later (`generate:keep` and `encounter:addSrd` groups now up to 50).
- Fix (owner, 2026-10-15): Live generator cards (Roll a character, Fill a tavern, Draw a battle map) on hover keep their
  solid parchment and get a deeper shadow (the general desk button hover made them see-through).
- Next build (owner, 2026-10-15): encounter builder.
  - Suggest an encounter (Encounters left column under Planned; Live › On the fly has a same-size card that opens Encounters, owner; `EncounterBuilder.tsx`): Where
    (party location first, "(party location)"; every place; Custom location… typed), difficulty, creature type, Include
    these cards (NPC/monster cards with counts), What happens here (for the AI). Suggest = offline themed roll
    (`encounter:roll`, `suggestThemed` in generators.ts, themes in `src/main/encounterThemes.ts`: one family, a leader
    ≤60 % of what is left, troops; land from the place's biome/kind or typed words, included cards pick the theme).
    ✦ Build with AI (`ai:draftEncounter`): SRD creatures + scene + story, AI suggestion. Put on the board / Save for later
    = `encounter:keepDraft` (encounter card with place, scene, story, tactics; creatures as rows; one undo step).
  - Encounter story (`attributes.story`, `src/shared/encounterStory.ts`): NPCs (card or one-time, Make a card), Items on
    the ground (things inside things, + inside, right-click Put on the board = Item card, the line stays), Checks (skill
    drop-down, Perception default, DC rows), Rewards (gold, items, secrets/clues from the campaign). ✦ Write it up with AI
    (`ai:writeEncounter`): Keep fills empty parts / Keep and replace everything.
  - Who fights: ticks + All, ▼/▲ CR per row and for the selected (`encounter:adjustCr`): an adjusted copy only in this
    encounter ("Goblin Boss (CR 2)", stashed, `adjusted_for`), later steps change that copy; original card unchanged.
    Add monsters heading under the list; Suggest with empty words = themed group for the encounter's place.
  - Encounters left: Battle map box (drop-down of battle maps / No battle map yet, Import battle map, Sketch a map here = sketch in the middle with ⇲ back, ✦ Generate
    a map); the Battle map row in the editor is gone (owner); XP bar and Battle planner moved to the bottom, above the buttons (owner). Scene keeps its title (owner). Save / Run encounter buttons unchanged.
  - Defaults picked: the builder also sits on Encounters (left); AI picks SRD monsters only; story removals are undoable
    (Change log), not History rows.
- Next build (owner chose mockup v5, 2026-10-15): Encounters in a compact look (scoped `.encounters-screen` in desk.css):
  two columns (The party panel gone; its budget line under the builder's level; House rules on the left under Battle
  map; left = Planned, Suggest an encounter, Battle map, House rules as separate boxes), one-line boxes 30 px and not
  growing here, small uppercase labels, small buttons and icon tools, bordered boxes (CR bar, Add monsters, checks,
  Battle planner), stat line on the creature's row, NPC and item rows on one grid (name / count / notes / button / ×,
  things inside indent only in the name column), NPC "Make a card" reads "Card".
- 2.8.0 (owner, mockup v2 with the original colours, 2026-10-16): Notes screen in a book look (`NotesLibrary.tsx`,
  `NoteReader.tsx`, `notes.css`, no desk header or candle; Import notes keeps the desk). Three columns:
  - Left: ▤ Notes / ★ Starred (right-click › Star, setting `notes_starred`) / ◷ Recent (this computer); Search all notes
    (`notes:search`, each matching paragraph under its heading, click jumps there); the tree has notes files first
    (folders, A–Z with numbers in order), then DM notes (Master notes, Between sessions, sessions); right-click as before
    plus Open in a new tab / Open in its own window / Star. « hides the list. New note, Import a character sheet, Open notes folder.
  - Top: « ← → (back/forward), tabs (× closes, middle-click closes, ⧉ opens the note in its own window `#note/<id>`,
    `NoteWindow.tsx`, `notes:popNote`; + new tab), Import notes…, Page Light / Dark (this computer).
  - Middle (notes files): folder path, ✎ Edit, File ▾ (Open in Word, Open file location, Save a copy as Word, Re-import,
    Read again with AI, Make a character card, Find headings, Earlier versions, Delete), ⧉, ‹ previous / next › in the
    folder. Banner = the first Location/Building mentioned with a picture (hover shows where from; right-click: a place's
    picture, another card's, your own picture, back to automatic, remove). Book styles: small-capital red headings, read-aloud
    box, sidebar, striped tables. DM notes, session notes and Master notes keep their own views inside the paper.
  - Links (`src/shared/noteLinks.ts`, tested): card names (an NPC/PC's first name too when unique and capitalised), spells
    (SRD list minus everyday words) and conditions/senses (`rulesTerms.ts`, short own summaries) link at their first mention in
    each paragraph; headings are not linked. Card links in the card's colour (encounters amber), conditions green, spells
    purple italic, senses dotted. Hover = note (picture, type, place, summary / rule / spell); click = Peek; Ctrl+click = sheet.
    Right-click a link: Open the sheet, Show in the side panel, Show its picture here, Insert your own picture here, Stop
    linking here (`Run.link = ''`), Stop linking everywhere (setting `word_links` off), Link to another card or note.
  - Pictures: each card's picture (NPC, PC, monster, place, building, item, faction, handout, other) at its first mention in
    the note, one per paragraph, a heading's under it; the banner's card skipped. Hover ⇄ other side / × take out
    (`note_meta`); right-click a paragraph: Insert a card's picture / your own picture here, Make this a read-aloud box /
    sidebar / plain text. Placed pictures are `pic` blocks in the file.
  - Stat blocks in the text (owner, after mockup; starts full width): right-click a paragraph › Insert a stat block here…
    (or ✎ Edit › Stat block) → a Monster, NPC or PC card; `stat` block {card, layout full | beside | fold, side} placed after
    the paragraph, always the card's current stat block with its picture (`InlineStat`). Hover: ⇄ other side (beside), ▭ full
    width / beside the text, − fold to one line (name, AC, HP, CR; click opens it) / + open, × take out (Ctrl+Z). The name opens
    the sheet. A card with a stat block gets no automatic picture too. In ✎ Edit it shows as a "⚔ Stat block: name" line.
  - ✎ Edit types into the same book page: B I U, Title, Heading, Subheading, Text, lists, Read-aloud, Sidebar, Table, Card
    picture, Own picture, [[ Link (or type [[: card or note picker, makes a new NPC card); ✓ Done (or Ctrl+Enter) saves a
    Word version (Ctrl+Z undoes); Cancel drops the changes; leaving the note while editing keeps the words.
  - Right: Contents; Peek (picture, Open sheet, Show on board, Show on map for places (`mapFocusId` selects the region),
    Open / Run encounter, Add to an encounter for monsters and NPCs; stat block in book colours; summary, motivation, flaws,
    who is here, description, secrets, DM notes; spells and rules in full); Links (by type, counts; notes; rules);
    Mentions (names not cards yet: Make a card ▾ type / Ignore; other notes named: Link to the note / Ignore);
    Linked from (Session prep sheets saved as this note, other notes linking here).
  - Folders (owner, mockup 3, 2026-10-16): nested to any depth (`note_doc.folder` = path "A/B/C"; empty folders kept in
    setting `notes_folders`); ＋ Folder / ＋ Note by the Notes files heading; right-click a folder: New note in this folder,
    New folder inside, Link to a card / Open the sheet / Unlink, Rename, Move to folder (top level or another), Take the notes
    out (into the parent), Delete folder (its notes to History; one undo step; `notes:folder`). Drag notes or folders onto a
    folder (or the Notes files heading = top level). One card per note (File ▾ › Link to a card, right-click a note; `note_meta.card`)
    and per folder (setting `note_folder_links`); the list shows the card's icon in its colour (person, crowned PC, pin, house,
    diamond), others a page / folder; the page shows a "Linked to the card …" chip. Card sheets list linked notes first
    ("Linked to this card"), and "＋ New note" there makes a note linked to the card, in the folder linked to it.
  - Headings (owner chose B): Cinzel titles, Alegreya Sans SC headings, bars that fade out to the right, a diamond before
    main headings; panel and stat block names in the heading face.
  - Elsewhere: "In your notes" (`InYourNotes.tsx`, `notes:mentions`: note › heading and a bit of text, click opens the note
    there) on the card sheet's Notes tab, the board side panel (Inspector) and the open encounter.
  - Defaults picked: first mention per paragraph (owner's example); page Light by default; the note window has Open sheet
    (in the main window) and Add to an encounter, not Show on board/map or Run; Make a card from [[ makes an NPC (type
    changeable on the sheet); a stat block goes after the paragraph right-clicked.
