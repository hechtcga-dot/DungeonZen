# Data model

SQLite, one database per campaign. All ids are UUID strings. All `*_min`
columns are integer minutes from campaign start. JSON columns are validated
with Zod. Enum-like columns are strings.

This supersedes the original Prisma schema. Changes from it: campaign
settings, factions, canvas persistence, sessions, structured triggers,
multiple outcomes, deltas on relationships, field-level knowledge,
routines, travel links, provenance.

## Core
```
campaign_settings   key, value                       -- name, calendar, rules edition
entity              id, type, name, attributes(json), tags(json),
                    status, parent_id, created_at
relationship        id, source_id, target_id, type, is_secret
```
- `entity.type`: NPC, PC, MONSTER, LOCATION, QUEST, ITEM, SCENE, CLUE,
  FACTION, HANDOUT
- `entity.status`: active, resolved (greyed on board), defunct (History),
  stashed (generated and saved for later)
- `relationship.type` examples: KNOWS, HOSTILE_TO, LOCATED_AT,
  TIED_TO_QUEST, MEMBER_OF
- `parent_id`: sub-regions under a region

## Entity attributes (JSON by type)
- NPC, MONSTER, PC: 5e stat block (type, AC, HP formula, speed, ability
  scores, saves, skills, vulnerabilities, resistances, immunities, senses,
  languages, CR), `current_hp`, bio, image paths, motivation, attitude
- LOCATION: biome, `atmosphere` (how townsfolk behave; feeds scene
  descriptions), notes
- All: template fields default location, motivation, tied quests

```
ability             id, entity_id, name, macro_text,
                    show_token_action, show_macro_bar
```

## Knowledge (party-wide, per field)
```
knowledge           id, entity_id, field, known_from_min
relationship_known  id, relationship_id, known_from_min
```

## Space
```
map                 id, name, image_path, grid_size
region_shape        id, map_id, location_id, polygon(json)
travel_link         id, from_location_id, to_location_id, minutes
routine             id, entity_id, location_id, from_min, to_min, activity
party_position      id, map_id, x, y, location_id, at_min
route               id, session_id, map_id, points(json),
                    estimated_min, confirmed_min
weather             id, day, location_id, kind, source   -- generated | planned
```
Entities without a routine stay at their default location.

## Canvas
```
board               id, name, storyline_id            -- null = global view
board_item          id, board_id, kind, entity_id, x, y, w, h, content(json)
```
- `kind`: card, note, image
- Strings on the board are `relationship` rows; board-only strings use
  `relationship.type = 'BOARD_LINK'`.

## Time and story
```
storyline           id, title, is_major, status, bbeg_entity_id
storyline_entity    storyline_id, entity_id
act                 id, storyline_id, number, title, start_min, end_min,
                    status, chosen_outcome_id
act_outcome         id, act_id, label, is_default, deltas(json)
trigger             id, source_act_id, outcome_id, target_storyline_id,
                    effect_type, payload(json), fired_at_min
delta               id, target_kind, target_id, at_min, seq, ops(json),
                    origin, summary, act_id, outcome_id, trigger_id,
                    session_id, log_entry_id, scenario_id, superseded_by
scenario            id, name, status                   -- draft | promoted | discarded
```
`delta.scenario_id` null means canon.

## Sessions
```
session             id, number, started_at, ended_at, start_min, end_min
log_entry           id, session_id, at_min, text, status
proposal            id, log_entry_id, draft_delta(json), status, caused_by
conflict            id, session_id, description, options(json), status
interaction         id, session_id, entity_id, at_min
encounter           id, location_id, title, kind, participants(json),
                    planned_difficulty, status, session_id, feedback
recap               id, session_id, text, player_safe
```
- `log_entry.status`: matched, skipped, resolved
- `encounter.kind`: combat, social, obstacle, mystery
- `encounter.feedback`: too_easy, about_right, hard, nearly_deadly
- Day tally (fights, NPC meetings, quests delivered) is derived from
  `encounter`, `interaction`, and act outcomes for the current day.

## Import and provenance
```
import_source       id, file_path, kind, status, notes
provenance          id, target_kind, target_id, source_id, locator,
                    quote, basis                       -- stated | inferred
```

## Undo
```
command             id, seq, at, label, group_id, payload(json), state
```
Every write is wrapped in a command. `payload` lists each row the command
touched with its state before and after; undo restores the "before" rows and
redo the "after" rows. `state`: done, undone, or discarded (undone and then
replaced by a newer change, so it can no longer be redone). `seq` orders
commands. `group_id` lets a session or an import undo as one step.

## Implementation notes (Phase 1)
- `relationship.status` and `board_item.status` (active, defunct) were added
  so strings and notes are never hard-deleted.
- `storyline_entity` has a surrogate `id` (plus a `status`) so undo can treat
  every table the same way.
- `ability` also has `kind` (ACTION, BONUS_ACTION, REACTION,
  LEGENDARY_ACTION, SPELL, OTHER), `description`, `sort` and `status`.
- `knowledge` and `relationship_known` have a `status` so the DM can untick
  and re-tick without deleting rows. Knowledge fields: name, location,
  motivation, statblock, bio.
- The 5e stat block lives in `entity.attributes.statblock`, checked by the
  Zod schema in `src/shared/statblock.ts`. Copies from the SRD record
  `attributes.source` (name, key, license).
- `map` has `width`, `height` (read from the image header) and `status`;
  `image_path` is relative to `assets/`. Settings keys in use: name,
  rules_edition, clock_min, dm_notes, moon_offset_days, active_map_id.
- `storyline.emblem` (desk card picture, null = automatic) and
  `storyline.removed` (in History) were added in migration 4.
- `entity.attributes.colour` (card colour override) and
  `entity.attributes.custom` (list of `{label, value}` the DM adds).
- Timeline (migration 5): `act` (title, summary, start_min, end_min,
  chosen_outcome_id, status), `act_outcome` (label, description, is_default,
  sort, status), `story_trigger` (the doc's `trigger`; renamed because TRIGGER
  is an SQL keyword) with effect_type and payload, note, created_at, status.
  `act.number` and `trigger.fired_at_min` are computed by the engine, not
  stored: the engine projects, the DM approves (rule 2). Outcome deltas are
  not stored yet.
- Schema changes are numbered migrations in `src/main/db/open.ts`
  (`PRAGMA user_version`).
