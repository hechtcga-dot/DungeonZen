# Features and workflows

## Phases
| Phase | Scope | Mockup status |
|---|---|---|
| 1 | Board, entity sheets, library, search, History, undo | Done |
| 2 | Full map with regions and party token, timeline | Done |
| 3 | Live session desk, session review | Done |
| 4 | Encounter planner, Roll20 and PDF/JPG exports | Not mocked |
| 5 | AI notes and sketch import | Review step mocked |

## Feature list

### Inputs
- Characters, monsters, PC sheets, maps, items, treasure, letters, tavern
  bulletin boards, scene descriptions, biome, weather.
- PC sheets: manual form or PDF import, editable, laid out like Roll20.
- Open5e search and "add copy" for SRD monsters, spells, items.
- New-from-template for every entity type.

### Board
- Cards pinned with strings; solid = known link, dashed = secret.
- Global view (all characters and plot points) plus one view per storyline.
- New NPC, Import NPC, Import map, Import images from the board.
- Resolved cards stay greyed until their storyline ends.
- Deleted or defunct items move to History and can be revived.

### Map
- Getting started (new campaigns, and Desk › Getting started): a world map
  first (import a picture, make one offline with the map maker, or have the
  image AI draw one), then its regions (the map maker outlines seas, lands by
  biome and settlements itself; for other maps a seeing AI proposes outlines
  the DM ticks, or the DM draws them), then notes (Import notes, the board or
  the desk).
- Every region has a kind (region, city, town, village, landmark, dungeon,
  sea) and a land (biome); the map colours and marks it by them.
- Regions and sub-regions drawn on an imported map image.
- Selecting a region shows who is there at the current time, planned
  encounters, plot points, notes, sub-regions.
- Draggable party token; moving to a new region asks to confirm travel.
- The map is a main navigation route alongside the sidebar.

### Time
- Parallel storyline lanes with act blocks; storylines progress on their
  own if ignored.
- Acts have several outcomes plus a default.
- Cross-storyline triggers.
- Clock with sun and moon position and lighting; moon phase tracker.
- Weather generated from biome, plannable and editable by the DM.
- NPC routines (broad: here on day 1, there on day 2).

### Live session
- Quick-log in the DM's own words.
- Engine clarifications: route and travel time.
- Party health overall and per character, edited by the DM.
- Day tally: fights, NPC meetings, quests delivered.
- Advisor: warnings such as night falling soon or too many fights today.
- Draw the party's route on the map; mark who they interacted with.
- Scene description from a short DM prompt, using time, weather, and the
  region's atmosphere.
- On the fly: roll a character, suggest an encounter, fill a tavern with
  patrons, draw a battle map. Results can be saved for later.

### Review
- Conflicts first; resolve, explain, or leave flagged.
- Before and after table of proposed changes with approve, edit, reject.
- Ripple changes shown as following from their cause.
- Encounter feedback feeds adaptive difficulty.
- What-if comparison; session recap with player-safe option.

### Encounter planner (Phase 4)
- Plan encounters per region; no initiative tracker.
- Track monster numbers and stat blocks with a difficulty rating.
- Ratings adapt to how the party found past encounters.
- DM can upload rules for the model to work from.

### Exports
- Roll20: stat blocks plus attack and spell macros and token actions; maps.
- PDF and JPG: character sheets, letters, bulletin boards.

### Search
- By name, tag, association, HP, abilities, CR, location.

## Workflows

### New campaign
1. Create the campaign; the getting started guide opens.
2. World map: import, make (offline, roll until you like it) or draw with AI.
3. Regions: kept with a made map; found by AI (tick which to keep) or drawn.
4. Notes: import them, or start on the board or the desk.

### Notes to campaign
1. DM drops Word, PDF, image, or text files.
2. AI reads them and proposes NPCs, factions, towns, storylines, links.
3. Each proposal shows its source quote; AI guesses are marked.
4. DM answers or defers questions, merges duplicates, edits.
5. "Create selected" commits everything as one undoable step.

### Live travel
1. DM logs "Players travelled to District C to talk to Ciaf Crol".
2. Engine asks the route; DM picks one or draws it.
3. Engine estimates time (4 h); DM confirms or sets another (3 h).
4. Encounters along the route are suggested.
5. Clock, party location, and knowledge changes become proposals.

### Deviation and cascade
1. DM logs something the plan did not expect.
2. Engine proposes an outcome or asks; DM may skip.
3. On approval, triggers fire and ripple deltas are proposed.
4. DM can preview a what-if before approving.
5. Superseded plans remain in history.

### End of session
1. Resolve or flag conflicts.
2. Approve, edit, or reject proposed changes.
3. Rate encounters.
4. Generate, edit, and export the recap.

## Open items
- Roll20: no official stat block import is known. Built (2026-10-06): paste-in
  macro text and a Pro-tier API script reading a handout.
- Battle maps need an image-generating provider, separate from the text AI.
- Rules edition default (2014 or 2024).
- Notes import could move earlier than Phase 5; owner chose to continue
  in the original order for now.
- PDF sheet parsing approach is undecided.
- Custom calendars (for example Harptos) are not specified.
