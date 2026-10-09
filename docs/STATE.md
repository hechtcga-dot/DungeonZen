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
  Desk, Session prep, Board, Map, Timeline, Library in Prep; Live desk and Map in
  Live; What they know in Players). Going to a screen sets its mode; the Map
  keeps the current one.
- Session prep (Prep › Session prep, `PrepScreen.tsx`): one sheet per session
  number (`session_prep`, `prep_item`); title, premise, pacing target, for
  session; discoveries (Revealed), scenes (type, where, target time, Played,
  Spread times evenly), clues (leads to a discovery, where, Found), key NPCs and
  threats (link a card to fill role/look or the stat line; all editable),
  backup names (Roll 4 names, offline), notes, cheat sheet. Reorder, remove to
  History and restore, undo.
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
    settings › Measurements shows metric (default) or imperial (`src/shared/units.ts`; free text
    keeps its words, feet/miles shown converted by `convertText`).
  - Map tokens: Place party token; PC tokens split from the party (`party_position.entity_id`,
    `joined`); a split PC moves without the clock and counts as here in its region; Merge with party.
  - SRD monster browser (`SrdBrowser.tsx`, `srd:monsters`): filter by type, size, CR, alignment,
    movement, legendary; sort any column; add any number (Encounters, Library).
  - Monster/NPC sheet opens on Fight summary (`FightSummary.tsx`): stat block to run the fight;
    Raise/Lower CR by the DMG table (`src/shared/crscale.ts`, previewed, one undo step); AI stat block
    from a description and options (`src/main/ai/statblock.ts`, proposal); picture upload or AI drawing
    (`attributes.picture` in `assets/pictures/`, `picture_source`).
  - Encounters: Save encounter, Scene box (`attributes.scene`), Build with AI (`BUILD_SYSTEM`; SRD or new
    monsters ticked and added; added cards are stashed, i.e. only in the encounter, until Put on board).
  - Run encounter (`CombatScreen.tsx`, `combat` table with one JSON state, `src/shared/combat.ts`): no
    dice, no initiative, the DM orders the list; rounds and turns (out-of-fight skipped), damage (temp
    first, concentration DC logged), heal, set HP (PC HP typed by hand, not linked to Live), temp HP,
    conditions with rounds (count down at round end), down/fled/surrendered, notes, add or remove
    combatants; morale and tactics hints from local rules (half a group down, guards hold while a
    leader stands, fallen leader, badly hurt, last one standing, allies' boosts from trait text,
    legendary, recharge) plus Ask AI; double-click a name opens its sheet, Back returns.
  - Back to the previous screen on sheets and the review (`BackButton`, Alt+Left). Battle maps: import
    a picture, try again after an error, plain Gemini no-image messages. Timeline lane titles, XP meter
    labels, battle map field, SRD humanoid sizes "Medium or Small", Octopus scores fixed.
- 1.3.0 (owner's list, 2026-10-09):
  - Setup (rail, `SetupMenu.tsx`): New campaign, Open, Save (WAL checkpoint; every change is already saved),
    Save a copy (`Campaign.saveCopy`: whole folder), Print or save cards, AI services, About (version, folders,
    SRD credit), Uninstall (runs `Uninstall Dungeon Zen.exe` next to the exe; campaigns kept).
  - Board: Background pictures (was Pictures under the cards) with a Move: Cards / Background switch
    (`boardPrefs.layer`, not remembered between runs; the other layer is `is-passive`, faded cards); the frame
    is drawn over the board (`.canvas::after`) so pictures never spill over it. Ctrl+drag pans the board, Map and
    Timeline (`useCtrlPan`, capture phase: nothing is selected or moved; Shift-click selects several now).
    Right-click menus close on any click (capture `pointerdown`). Card menu › New link…: a string follows the
    mouse; the next card clicked asks "Link these two?" with the link type, Secret and "+ New link type…" with a
    colour (`LinkTypeFields`, also on the sheet's Connections; `relationship:create` `colour` adds the type in the
    same undo step). Strings attach to the nearest of six card points (`stringEnds` in `src/shared/layout.ts`).
  - Sheets: tabs Fight summary, Full sheet (creatures), "Features, traits, background" (creatures) or
    "Descriptions & history" (others; first tab), Secrets, Notes, Connections. Fields per type in
    `cardFields.ts` (`tabFields`), each tab with Fill blanks with AI (only that tab's empty fields; PCs too).
    Factions field on NPC/PC (MEMBER_OF) and Location (CONTROLLED_BY): strings to faction cards, New faction.
    Full sheet: character-sheet layout (ability boxes, proficiency from CR or PC level, speed, initiative, AC,
    HP now/max/temp, saves, passive senses, skills from `parseBonuses`, defenses and conditions, tabs Actions /
    Features & traits / Defenses / Details).
  - Desk party cards: portrait (card picture), AC, HP now (editable) / max + temp, PP, size, resistances,
    conditions (editable); Live party cards show temp HP and conditions.
  - Pictures: every card has a picture panel (Choose from Library, Upload, Draw with AI, Remove); board cards
    show it. Library › Pictures (`PicturesTab`): folders (Art, Portraits, Places, Items, Maps, Battle maps,
    Background pictures, the DM's own), upload several, rename, drag to a folder, Remove to History, style
    example ticks (portraits, maps, battle maps). Draw windows (card picture, battle map, world map): "Prompt
    being sent" (editable, Reset), art style in words (setting), style example thumbnails ticked for that use
    (untick per drawing); `maxReferences` per service (OpenAI and Gemini 4, Stability 1, others none).
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
- After 1.4.0 (owner, 2026-10-09; not released yet):
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
  - Encounter pictures and maps (`EncounterPictures.tsx`): a folder per encounter, `assets/encounters/<name>` in the
    campaign (made on first use, `attributes.folder`) or one the DM chose (Use another folder…, undoable); files put
    there in Windows show up (refresh on focus); Add pictures… copies in; thumbnails open in Windows; Remove moves to
    the folder's Removed subfolder; Open folder. Run encounter has a Pictures and maps button. Served as
    `dz-asset://encounter/<id>/<file>`.
- Every screen uses the desk style (`DeskFrame`, `theme.css`): wooden bars,
  parchment panels, a cork board in a wooden frame, candles in the top bar
  and board tools, day and night lighting everywhere.

Not yet: the Guard Captain's SRD 2024 stat block has no ally boost (add a Leadership trait and the tracker shows it); rivers and roads on made maps; re-reading a draft with your answers; tokens on battle maps; Player preview in a second window (for a TV); AI help on the prep sheet; drawing a planned route (the route shown is where the party went); weather and NPC routines; outcome effects on cards (deltas from outcomes, e.g. move an NPC; the engine supports them, no editor yet); editing not yet possible: custom entity types, the date a fact became known, reordering abilities; images on the board, PC sheet PDF
import, code signing, auto-update; Phase 4 left: PDF of a whole session prep sheet, Roll20 maps
with tokens. Phases 1 to 5, the Windows installer (1.0.0), the getting started guide (1.1.0) and the 1.2.0 and 1.3.0 lists are built. Notes imported before 1.3.0 were not kept as files.
