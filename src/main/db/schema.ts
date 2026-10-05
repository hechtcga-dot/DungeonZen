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
  bbegEntityId: text('bbeg_entity_id')
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
  relationship_known: { table: relationshipKnown, pk: relationshipKnown.id }
} as const
export type TableName = keyof typeof tracked

export type EntityRow = typeof entity.$inferSelect
export type RelationshipRow = typeof relationship.$inferSelect
export type StorylineRow = typeof storyline.$inferSelect
export type BoardRow = typeof board.$inferSelect
export type BoardItemRow = typeof boardItem.$inferSelect
export type CommandRow = typeof command.$inferSelect
export type AbilityRow = typeof ability.$inferSelect
