# Plan for 3.1: UI clean-up (draft, 2026-10-19)

From the 3.0.0 screenshot review (smoke run, 20 screens, 1440×900). Goal: easier for a new DM, same desk look.
Two skins: Desk (today's look) and Adventure UI (G7, like the Notes screen); G1–G6 apply to both.
Built in groups; each group with UI changes gets owner approval of its mockup first (as in `PLAN-3.0.md`).
Mockups: https://claude.ai/artifact/188ioHGX4U4us7zQSe37TC

## G1 Shell: one header, one rail (visible)
- One `ScreenHeader` on every screen (replaces the big candle title on Desk/Prep/Map/Encounters/Live and `TopBar`
  on Board/Sheet/Timeline/Library): candle + screen title (campaign name small above), Find box (Ctrl+K),
  the screen's own actions (slot), undo/redo icons, day/time chip with the lighting toggle. Same height everywhere.
- Undo/redo shown on every screen (today missing on Prep, Map, Encounters, Live).
- Rail: Map and Timeline added. Groups: Prepare (Desk, Session prep, Encounters, Board, Timeline, Map, Library,
  Notes), At the table (Live desk), For the players (What they know). Setup, AI, Close become one row of three icons
  with tooltips at the foot. Fits 900 px without scrolling.
- What they know keeps its locked rail (unchanged rule).

## G2 Ctrl+K: find and do (visible; see section below)
- Grows the Ctrl+F Find window into one box for screens, cards, encounters, notes and actions. Ctrl+F still opens it.

## G3 Declutter (visible)
- Box controls (− ↑ ↓, `fold.ts`): shown only on hover or keyboard focus of the box title; always shown in Setup ›
  "Arrange boxes" mode. One change in `fold.ts`, every screen gets it.
- Card sheet header: three buttons (Show on board, Fill blanks with AI, Export ▾ = Character sheet file, Print or
  save, Roll20) and a ⋯ menu (Duplicate, Move to History). Second "Fill blanks with AI" in the tab body stays
  (it fills that tab only); header one renamed "Fill all blanks with AI".
- Board tools: icon + label, two groups: Add (Card, Note), Show (Links, Story, Background, Map view); Move
  (Cards / Background / Hidden) becomes one segmented control; Fit all moves to the zoom buttons.

## G4 Consistency and fit (visible)
- Notes screen keeps its own look (owner, 2026-10-19: the most appealing screen; it is the model for the Adventure UI
  skin's frame, G7; it keeps its clean layout in both skins). Only its controls grow to 44 px.
- Timeline act blocks: name on one line, ellipsis only past the block width; full name in tooltip; minimum block
  width shows at least the first word.
- Live desk: The advisor on parchment (not the dark panel); one row of four boxes kept.
- Empty space used: Session prep shows the session list and last session's recap beside the sheet; Encounters
  shows the selected encounter or, with none, the planned list large with "New encounter"; Map keeps the parchment
  centred with the map list on the right.

## G5 Renderer service layer (no visible change)
- `src/renderer/services/<area>.ts` (campaign, cards, links, encounters, notes, prep, live, maps, pictures, ai):
  named functions over `call`/`act`/`query`. Components import services, never channel names.
- Moved screen by screen; a vitest check fails if a component file calls `call(`/`act(`/`query(` with a channel
  string. IPC (`shared/ipc.ts`) unchanged.
- Ctrl+K actions (G2) are built on these services.

## G6 First run (visible, later)
- Getting started guide walks one loop after the world map: add a PC, make an NPC, link it, start a prep sheet,
  start the session on the Live desk. Each step skippable; reopen from Desk › Getting started.

## G7 Adventure UI skin (visible; owner, 2026-10-19)
A second skin. The Desk skin stays; the DM picks. Owner chose the adventure direction (mockup row "Adventure",
from the owner's reference picture): Notes keeps its clean layout; every other screen gets the adventure look.
- Frame on every screen (Notes too): dark brown rail (#1a100a, current screen dark red-brown with a red edge),
  dark brown top bar (#1f130b, screen name in cream Cinzel capitals, outlined dark buttons), dark brown ground
  (#24160d, darker at the edges) between panels.
- Panels: aged parchment (#e2cda0 mottled, edges darkened as if burnt), each a separate sheet with a shadow, 14 px
  apart. Headings in dark brown Cinzel capitals with a thin rule under them. Text Alegreya Sans, dark brown ink.
- Buttons: main and "do it" buttons deep red with cream text (The chest's buttons all red); others paper with a
  tan border. Selected rows darker parchment with a red left edge. Tabs: parchment tab on the dark bar.
- Drawn art kept and coloured to match, larger and more illustrated (owner, 2026-10-19): The hour = sky through an
  arched bronze window (sun or moon, clouds, hills, town skyline). It follows the campaign clock (owner,
  2026-10-19): dawn (low sun, rose sky), day, dusk (setting sun, orange sky, lit windows), night (crescent moon,
  stars, lit windows); one drawing with four colour sets, also used by the Live desk clock. The moon = moon with glow in a
  round bronze night-sky window with stars; party = faint adventurer silhouettes (wizard, fighter, rogue, cleric,
  ranger), fully visible; bronze compass.
- Top-row boxes trimmed and centred: content centred in each box, equal box heights; time shown large (09:30) with
  −1 h / +1 h / Set… as small chips. Each chip keeps a 44 px tall click area (UI_SPEC rule) but draws only ~24 px.
- Notes: its own clean book page (`notes.css`, Light/Dark) inside the adventure frame; unchanged otherwise.
- Kept in both skins: card type colours, AI suggestions blue dashed (rule 10), secret links dashed, the drawn art
  that carries meaning (clock sky, moon, compass, weather), 44 px controls.
- Built as tokens: `theme.css` gets one token set per skin under `[data-skin='desk']` / `[data-skin='adventure']`
  (parchment, ink, red, frame browns); Notes keeps its `.nb` tokens. Screens use tokens only; desk-only art (wood,
  leather, candles, props) is drawn only when the skin is Desk; the parchment texture is CSS gradients (no images).
- Switch: Setup › Look (Desk / Adventure UI), also on the Start screen. Stored per computer in `userData/profile.json`
  (a UI preference, not campaign data). Notes keeps its own Light/Dark page switch.
- Fonts already bundled (`@fontsource`), so it stays offline (rule 1).
- Smoke test takes every screen's screenshot in both skins.

## Order
G5 first (no visible change, makes G2 simple) → G1 (header and rail built on skin tokens) → G7 → G3 → G2 → G4 → G6. Each group: mockup approved, built,
vitest + typecheck + smoke screenshots, `STATE.md` updated, `CHANGELOG.md` at release.

## Ctrl+K in detail
One window, opened by Ctrl+K (Ctrl+F too) on every screen but What they know.
- Empty box: Recent (last 5 cards/notes/encounters opened) and Suggested for this screen (Board: New card, Fit all;
  card sheet: Fill all blanks with AI, Show on board; Live: Start session, +10 min, Short rest).
- Typing: results in groups, best match first: Go to (screens), Cards, Encounters, Notes, Actions.
  `>` searches actions only, `@` cards only, `#` tags.
- Keys: ↑ ↓ choose, Enter opens or runs, Tab on a card result shows its second choices (Open sheet, Show on board,
  Show on map), Esc closes. Every row shows its shortcut where one exists.
- Actions are one list (`src/renderer/actions.ts`): id, label, words it answers to, where it applies, run.
  The same list feeds the rail, menus and Ctrl+K so labels never differ.
- Writes go through the services → `CommandLog.run`, so every action is undoable (rule 4). AI actions open
  their usual propose/approve window, never write directly (rule 2). Removing goes to History (rule 3).
- Time actions take a number: "+2h", "advance 30 min", "day 5" (parsed locally; asks to confirm before moving
  the clock more than a day).
- Nothing online; search uses the existing local find.
