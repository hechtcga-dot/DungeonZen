# UI specification

Mockup canvas (reference, not source of truth for code):
https://claude.ai/artifact/7vcZAYLDygJNex6Qopq5EP

## Visual direction
Two styles exist in the mockups. Which one the working screens use is an
open decision.

### Desk style (landing, map, live session)
A fantasy desk: stitched leather mat, parchment, a wooden DM screen bar,
tarot-style cards, small illustrated props (candle, d20, quill, potion).
Mockup art is flat drawings; painted art would need commissioned or
licensed assets.

| Token | Value |
|---|---|
| Desk | `#24160c` |
| Leather mat | `#1f3a36`, stitch `#a8884f` |
| Wood frame | `#6a4526`, edge `#150c06` |
| Parchment | `#e8d9b0`, light `#f1e6c6`, canvas `#d9c69a` |
| Ink | `#2a1f12`, muted `#5a4a32` |
| Wax red | `#8f2a21` |
| Gold | `#f6c945` |
| Display font | IM Fell English |
| UI font | IBM Plex Sans |
| Numeric font | IBM Plex Mono |

### Working style (board, sheet, library, timeline, import, review)
| Token | Value |
|---|---|
| Ground | `#171a1f`, panel `#1e2228`, border `#2d333c` |
| Text | `#e9e7e2`, muted `#a3abb5` |
| Selection | `#6cb6d9` |
| String red | `#d2453a` |
| Autonomous amber | `#c79a2e` |
| Card paper | `#efe9da` |

Entity colours: NPC `#2f5d8a`, Monster `#8a2f2f`, Location `#2f6b4f`,
Quest `#7a5a12`, Clue and Faction `#5a3f8a`, Scene `#4a4f57`, Item `#9c4f1f`
(copper), Handout `#6b5a3a` (sepia).
PC card colours: `#23395b`, `#7a2230`, `#24553a`, `#4b2d6b`.

### Rules
- Controls at least 44 px tall; real buttons, links, and labelled inputs.
- AI suggestions: dashed blue outline. Secret links: dashed. Conflicts
  and skipped items: amber.
- Do not rely on colour alone; pair with labels or line style.

## Screens

### 0. DM desk (landing)
```
+------+--------------------------------------------------------+
| nav  | [Campaign name]                 [search]  [undo]       |
| Desk | +-- DM screen ---------------------------------------+ |
| Map  | | Clock sky | Moon | Weather scene | Party loc | Live | |
| Board| +----------------------------------------------------+ |
| Time | +-- leather mat -------------------------------------+ |
| Lib  | | Storyline |      Canvas map       | DM notes       | |
| Enc  | | cards     |   regions + party     | Chest:         | |
| Log  | | + New     |   marker              |  New NPC       | |
| View | |           |                       |  Import...     | |
|      | | The party: tarot cards (portrait, AC, HP, P.Perc)  | |
|      | +----------------------------------------------------+ |
+------+--------------------------------------------------------+
```
- Clock: sun or moon arcs over a skyline; sky colour shows lighting.
- Moon: phase image plus nights until full.
- Weather: illustrated scene per type (clear, rain, storm, snow so far).
- Everything opens a screen; PC cards open the full sheet.

### 1. Board
```
+---------------------------------------------------------------+
| Dungeon Zen [Campaign] [DM Prep|Live|Player] [search] [undo] |
| Back to desk  VIEW: [Global] [Storyline A] [Storyline B]      |
|                     [New NPC] [Import NPC] [Map] [Images]     |
+------+------------------------------------------+-------------+
| tools|  cards, pins, red strings, notes         | Inspector / |
| Card |  greyed = resolved                       | History     |
| Str. |                                          |  Revive     |
| Note |  legend: known / secret / resolved       |  Change log |
+------+------------------------------------------+-------------+
```

### 2. Entity sheet
Tabs: Sheet, Bio and notes, Connections, Handouts. Left: editable 5e stat
block modelled on Roll20, plus attacks and spells as macros with "token
action" and "macro bar" options. Right: campaign template (location,
motivation, quests, tags, "Ask AI to fill blanks") and "What the party
knows" per field. Actions: Duplicate, Export PDF or JPG, Export to Roll20.

### 3. Library
Search with filters (type, tag, HP range, CR, ability, location, linked
to). New-from-template list. Results split into "In this campaign" and
"Open5e (SRD)" with "Add copy". Buttons: Import notes with AI, Import PC
sheet (PDF), Upload map or handout.

### 4. Full map
Large canvas map with region and sub-region outlines, entity pins, and a
draggable party token. Right panel: region name, Here now, Planned
encounters, Plot points and scenes, Notes, Sub-regions, "Move party
here". Moving between regions raises a "Confirm travel" card with the
engine estimate, Change time, and Undo move.

### 5. Timeline
```
           Day 1    Day 2    Day 3    Day 4(full moon)  Day 5  Day 6
Storyline A [ Act 1 ====][ Act 2 ==========][ Act 3 ===]
                        : T1
Storyline B [Act 1]     [ Act 2 =====][ Act 3 ========]
                 : T2
Storyline C      [ Act 1 =========][ Act 2 ==========]
        | NOW
```
- Solid blue: in progress with players. Dashed amber: resolves by default.
- Triggers: dotted vertical connector with a numbered badge repeated on
  both acts and in the side panel. This is a proposal, not confirmed.
- Side panel: outcomes, default, triggers, what-if preview.
- Header: Rewind to a session, Preview a what-if, Undo.

### 6. Import notes (AI)
Three columns: Sources (drop zone, per-file read status), Proposals
(cards with tick box, Edit, source quote, Merge for duplicates, Questions
at top), Summary (counts of what will be created, Create selected, Save
review for later).

### 7. Live session desk
```
+---------------------------------------------------------------+
| Back  (Live)  Session [n]            [Undo] [End and review]  |
| +-- DM screen ----------------------------------------------+ |
| | Clock +-1h | Party health % | Today: fights/meets/quests  | |
| |            |                | Advisor warnings            | |
| +-----------------------------------------------------------+ |
| +-- leather mat --------------------------------------------+ |
| | Quick-log    |  Map: draw route,      | Party cards       | |
| | Engine asks  |  click who they met    | HP bar -5 -1 +1 +5| |
| | Session log  |  [They met someone new]|                   | |
| | Set the scene: DM prompt -> read-aloud text               | |
| | On the fly: Character | Encounter | Tavern | Battle map   | |
| +-----------------------------------------------------------+ |
+---------------------------------------------------------------+
```

### 8. Session review
Conflict card at top; proposed changes table (What, Before, After,
Decision); encounter feedback; what-if comparison; editable recap with
player-safe toggle. Header: Undo whole session, Approve all unflagged.

## Mockup stand-ins to replace in the build
- Hit points on the live desk are sample numbers.
- Generators use small built-in lists, not AI.
- Scene description is pre-written text; typed input is not read.
- Travel estimate is a rough distance sum, not travel links.
- Battle map is a placeholder frame.
- PC portraits are a generic silhouette.
- Timeline and review screens are static.

## Not yet designed
- Encounter planner and export screens (Phase 4)
- Player Preview mode
- Region drawing tool
- Calendar and weather planning screen
- DM notes journal
- Settings and DM profile (API key)
