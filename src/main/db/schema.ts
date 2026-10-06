import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'
import type { EntityAttributes, NoteContent } from '../../shared/schemas'

// Phase 1 tables from docs/DATA_MODEL.md. Column names match the doc (snake_case);
// enum-like columns are plain strings checked with Zod (src/shared/schemas.ts).
// Additions to the doc: `status` on relationship and board_item (nothing is
// hard-deleted), `seq` and `state` on command (ordered undo/redo).

export const campaignSetting = sqliteTable('campaign_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull()
})

export const entity = sqliteTable('entity', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  attributes: text('attributes', { mode: 'json' }).$type<EntityAttributes>().notNull(),
  tags: text('tags', { mode: 'json' }).$type<string[]>().notNull(),
  status: text('status').notNull(),
  parentId: text('parent_id'),
  createdAt: text('created_at').notNull()
})

export const relationship = sqliteTable('relationship', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  type: text('type').notNull(),
  isSecret: integer('is_secret', { mode: 'boolean' }).notNull(),
  status: text('status').notNull()
})

export const storyline = sqliteTable('storyline', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  isMajor: integer('is_major', { mode: 'boolean' }).notNull(),
  status: text('status').notNull(),
  bbegEntityId: text('bbeg_entity_id'),
  emblem: text('emblem'), // tarot emblem on the desk; null = chosen from the id
  removed: integer('removed', { mode: 'boolean' }).notNull().default(false) // in History
})

// Composite key in the doc; a surrogate id keeps undo generic.
export const storylineEntity = sqliteTable('storyline_entity', {
  id: text('id').primaryKey(),
  storylineId: text('storyline_id').notNull(),
  entityId: text('entity_id').notNull(),
  status: text('status').notNull()
})

export const board = sqliteTable('board', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  storylineId: text('storyline_id') // null = global view
})

export const boardItem = sqliteTable('board_item', {
  id: text('id').primaryKey(),
  boardId: text('board_id').notNull(),
  kind: text('kind').notNull(),
  entityId: text('entity_id'),
  x: real('x').notNull(),
  y: real('y').notNull(),
  w: real('w'),
  h: real('h'),
  content: text('content', { mode: 'json' }).$type<NoteContent | null>(),
  status: text('status').notNull()
})

// Attacks, spells and other actions on a stat block, exportable as Roll20 macros.
export const ability = sqliteTable('ability', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind').notNull(), // ACTION, BONUS_ACTION, REACTION, LEGENDARY_ACTION, SPELL, OTHER
  description: text('description').notNull(),
  macroText: text('macro_text').notNull(),
  showTokenAction: integer('show_token_action', { mode: 'boolean' }).notNull(),
  showMacroBar: integer('show_macro_bar', { mode: 'boolean' }).notNull(),
  sort: integer('sort').notNull(),
  status: text('status').notNull()
})

// What the party knows (shared by the whole party), per field and per string.
export const knowledge = sqliteTable('knowledge', {
  id: text('id').primaryKey(),
  entityId: text('entity_id').notNull(),
  field: text('field').notNull(),
  knownFromMin: integer('known_from_min').notNull(),
  status: text('status').notNull()
})

export const relationshipKnown = sqliteTable('relationship_known', {
  id: text('id').primaryKey(),
  relationshipId: text('relationship_id').notNull(),
  knownFromMin: integer('known_from_min').notNull(),
  status: text('status').notNull()
})

// Imported map images. The file lives in the campaign's assets/maps folder.
export const map = sqliteTable('map', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  imagePath: text('image_path').notNull(), // relative to assets/, forward slashes
  width: integer('width'),
  height: integer('height'),
  gridSize: integer('grid_size'),
  status: text('status').notNull(),
  widthMiles: real('width_miles'), // how many miles the image is across (map scale)
  travelMph: real('travel_mph').notNull().default(3),
  kind: text('kind').notNull().default('world'), // world | battle
  gridCols: integer('grid_cols'), // squares across, when the map has a grid (5 ft each)
  source: text('source'), // null = the DM's own image; otherwise which AI drew it
  prompt: text('prompt') // what the AI was asked, for battle maps it drew
})

// The DM's own example maps: the style an AI copies when it draws battle maps.
export const styleExample = sqliteTable('style_example', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  imagePath: text('image_path').notNull(), // relative to assets/
  createdAt: text('created_at').notNull(),
  status: text('status').notNull()
})

// A region drawn on a map, tied to a Location card (sub-regions: the card's parent_id).
export const regionShape = sqliteTable('region_shape', {
  id: text('id').primaryKey(),
  mapId: text('map_id').notNull(),
  locationId: text('location_id').notNull(),
  polygon: text('polygon', { mode: 'json' }).$type<Array<[number, number]>>().notNull(),
  status: text('status').notNull()
})

// Where the party is on a map from a given minute on. The latest at or before now counts.
export const partyPosition = sqliteTable('party_position', {
  id: text('id').primaryKey(),
  mapId: text('map_id').notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
  locationId: text('location_id'),
  atMin: integer('at_min').notNull(),
  sessionId: text('session_id'),
  createdAt: text('created_at').notNull(),
  status: text('status').notNull()
})

// A travel time the DM set between two locations; it beats the distance estimate.
export const travelLink = sqliteTable('travel_link', {
  id: text('id').primaryKey(),
  fromLocationId: text('from_location_id').notNull(),
  toLocationId: text('to_location_id').notNull(),
  minutes: integer('minutes').notNull(),
  status: text('status').notNull()
})

// Time and story (docs/DATA_MODEL.md). The DM's plan only: what the engine
// projects from it (default outcomes, fired triggers) is computed, never stored.
export const act = sqliteTable('act', {
  id: text('id').primaryKey(),
  storylineId: text('storyline_id').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull(),
  startMin: integer('start_min').notNull(),
  endMin: integer('end_min').notNull(),
  chosenOutcomeId: text('chosen_outcome_id'),
  status: text('status').notNull()
})

export const actOutcome = sqliteTable('act_outcome', {
  id: text('id').primaryKey(),
  actId: text('act_id').notNull(),
  label: text('label').notNull(),
  description: text('description').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull(),
  sort: integer('sort').notNull(),
  status: text('status').notNull()
})

// "trigger" is an SQL keyword, so the table is story_trigger.
export const storyTrigger = sqliteTable('story_trigger', {
  id: text('id').primaryKey(),
  sourceActId: text('source_act_id').notNull(),
  outcomeId: text('outcome_id').notNull(),
  targetStorylineId: text('target_storyline_id').notNull(),
  effectType: text('effect_type').notNull(), // shift_act | force_outcome | set_status
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  note: text('note').notNull(),
  createdAt: text('created_at').notNull(),
  status: text('status').notNull()
})

// Live play (docs/DATA_MODEL.md "Sessions"). Interactions and the day tally are
// log entries with a kind (meeting, fight, quest), so every one can be edited
// or removed like any other entry.
export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  number: integer('number').notNull(),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  startMin: integer('start_min').notNull(),
  endMin: integer('end_min'),
  sceneText: text('scene_text').notNull(),
  recap: text('recap').notNull(),
  playerRecap: text('player_recap').notNull().default(''),
  status: text('status').notNull()
})

export const logEntry = sqliteTable('log_entry', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  atMin: integer('at_min').notNull(),
  kind: text('kind').notNull(), // note | fight | meeting | quest | rest | travel
  text: text('text').notNull(),
  entityId: text('entity_id'),
  minutesTaken: integer('minutes_taken').notNull(),
  createdAt: text('created_at').notNull(),
  status: text('status').notNull(),
  feedback: text('feedback') // fights: too_easy | about_right | hard | nearly_deadly
})

// What the DM decided about each review item, so a rejected proposal or a
// flagged conflict is remembered (the doc's conflict.status, generalised).
export const reviewDecision = sqliteTable('review_decision', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  itemKey: text('item_key').notNull(),
  decision: text('decision').notNull(), // approved | rejected | flagged | explained | resolved
  note: text('note').notNull(),
  createdAt: text('created_at').notNull(),
  status: text('status').notNull()
})

export interface RowChange {
  table: TableName
  id: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

export const command = sqliteTable('command', {
  id: text('id').primaryKey(),
  seq: integer('seq').notNull().unique(),
  at: text('at').notNull(),
  label: text('label').notNull(),
  groupId: text('group_id'),
  payload: text('payload', { mode: 'json' }).$type<RowChange[]>().notNull(),
  // done | undone | discarded (undone, then replaced by a newer change)
  state: text('state').notNull()
})

// Tables whose rows go through the command log, keyed for undo/redo.
export const tracked = {
  campaign_settings: { table: campaignSetting, pk: campaignSetting.key },
  entity: { table: entity, pk: entity.id },
  relationship: { table: relationship, pk: relationship.id },
  storyline: { table: storyline, pk: storyline.id },
  storyline_entity: { table: storylineEntity, pk: storylineEntity.id },
  board: { table: board, pk: board.id },
  board_item: { table: boardItem, pk: boardItem.id },
  ability: { table: ability, pk: ability.id },
  knowledge: { table: knowledge, pk: knowledge.id },
  relationship_known: { table: relationshipKnown, pk: relationshipKnown.id },
  map: { table: map, pk: map.id },
  act: { table: act, pk: act.id },
  act_outcome: { table: actOutcome, pk: actOutcome.id },
  story_trigger: { table: storyTrigger, pk: storyTrigger.id },
  session: { table: session, pk: session.id },
  log_entry: { table: logEntry, pk: logEntry.id },
  review_decision: { table: reviewDecision, pk: reviewDecision.id },
  region_shape: { table: regionShape, pk: regionShape.id },
  party_position: { table: partyPosition, pk: partyPosition.id },
  travel_link: { table: travelLink, pk: travelLink.id },
  style_example: { table: styleExample, pk: styleExample.id }
} as const
export type TableName = keyof typeof tracked

export type EntityRow = typeof entity.$inferSelect
export type RelationshipRow = typeof relationship.$inferSelect
export type StorylineRow = typeof storyline.$inferSelect
export type BoardRow = typeof board.$inferSelect
export type BoardItemRow = typeof boardItem.$inferSelect
export type CommandRow = typeof command.$inferSelect
export type AbilityRow = typeof ability.$inferSelect
export type MapRow = typeof map.$inferSelect
export type ActRow = typeof act.$inferSelect
export type OutcomeRow = typeof actOutcome.$inferSelect
export type TriggerRow = typeof storyTrigger.$inferSelect
export type SessionRow = typeof session.$inferSelect
export type LogRow = typeof logEntry.$inferSelect
export type RegionRow = typeof regionShape.$inferSelect
