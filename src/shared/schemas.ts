import { z } from 'zod'

// Enums are stored as strings in SQLite and checked here (CLAUDE.md rule 6).

export const ENTITY_TYPES = [
  'NPC', 'PC', 'MONSTER', 'LOCATION', 'QUEST', 'ITEM', 'SCENE', 'CLUE', 'FACTION', 'HANDOUT', 'BUILDING', 'ENCOUNTER', 'OTHER'
] as const
export const EntityType = z.enum(ENTITY_TYPES)
export type EntityType = z.infer<typeof EntityType>

/** An encounter card (its own type since 2026-10-21; before, a SCENE with attributes.encounter, still read for undo across the upgrade). */
export function isEncounterCard(e: { type: string; attributes: Record<string, unknown> }): boolean {
  return e.type === 'ENCOUNTER' || (e.type === 'SCENE' && e.attributes.encounter === true)
}

// active: on the board; resolved: greyed on the board; defunct: in History;
// stashed: generated and saved for later.
export const EntityStatus = z.enum(['active', 'resolved', 'defunct', 'stashed'])
export type EntityStatus = z.infer<typeof EntityStatus>

// Suggested relationship types; the DM may type any other label.
export const RELATIONSHIP_TYPES = [
  'KNOWS', 'HOSTILE_TO', 'ALLIED_WITH', 'LOCATED_AT', 'TIED_TO_QUEST', 'MEMBER_OF', 'BOARD_LINK'
] as const
export const RelationshipType = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((s) => s.toUpperCase().replace(/\s+/g, '_'))

// Nothing is hard-deleted: removed rows are marked defunct and can be revived.
export const RowStatus = z.enum(['active', 'defunct'])
export type RowStatus = z.infer<typeof RowStatus>

export const BoardItemKind = z.enum(['card', 'note', 'image'])
export type BoardItemKind = z.infer<typeof BoardItemKind>

export const StorylineStatus = z.enum(['inactive', 'autonomous', 'player_active', 'concluded'])
export type StorylineStatus = z.infer<typeof StorylineStatus>

export const RulesEdition = z.enum(['2014', '2024'])
export type RulesEdition = z.infer<typeof RulesEdition>

// A card's attributes: the known keys are type-checked (null = cleared), any other key is kept as it is.
// Checked where values are written (requests from the window, createEntity/updateEntity: the changed keys only),
// never on read: readers still fall back on a default, so an old value of the wrong type never blocks the DM.
// Bigger values (stat block, building, story, sketch…) have readers of their own (readStatBlock, readBuilding…).
const text = z.string().max(200000).nullable().optional()
const count = z.number().int().min(0).max(10_000_000).nullable().optional()
const flag = z.boolean().nullable().optional()
const TEXT_KEYS = [
  'summary', 'bio', 'motivation', 'location', 'history', 'secret', 'sights', 'sounds', 'smells', 'reward', 'text', 'from', 'notes',
  'description', 'details', 'occupation', 'appearance', 'personality', 'voice', 'ideals', 'bonds', 'flaws', 'tactics', 'background',
  'gender', 'age', 'height', 'weight', 'eyes', 'hair', 'skin', 'faith', 'habitat', 'lore', 'colour', 'picture', 'picture_source',
  'initiative', 'conditions', 'place_kind', 'biome', 'folder', 'battle_map_id', 'adjusted_for', 'adjusted_from_name', 'spell_ability',
  'building_kind', 'shop_type', 'save_notes', 'target'
] as const
const COUNT_KEYS = ['current_hp', 'temp_hp', 'xp', 'exhaustion', 'hit_dice_used', 'count', 'attacks_per_action'] as const
export const EntityAttributes = z.object({
  ...Object.fromEntries(TEXT_KEYS.map((k) => [k, text])) as Record<(typeof TEXT_KEYS)[number], typeof text>,
  ...Object.fromEntries(COUNT_KEYS.map((k) => [k, count])) as Record<(typeof COUNT_KEYS)[number], typeof count>,
  prof_bonus: z.number().int().min(-10).max(30).nullable().optional(),
  spell_bonus: z.number().int().min(-10).max(10).nullable().optional(),
  encounter: flag, inspiration: flag, generated: flag, link_name: flag
}).catchall(z.unknown())
export type EntityAttributes = Record<string, unknown>

export const Tags = z.array(z.string().trim().min(1).max(40)).max(50)

export const NoteContent = z.object({ text: z.string().max(5000) })
export type NoteContent = z.infer<typeof NoteContent>
/** What a board item holds: a note's text, or a picture under the cards (path under assets/). */
export interface BoardItemContent {
  text?: string
  image?: string
  name?: string
  opacity?: number
  locked?: boolean
  /** A campaign map put under the cards (its regions can show on the board). */
  mapId?: string
}

export const Id = z.string().uuid()

export const AbilityKind = z.enum(['ACTION', 'BONUS_ACTION', 'REACTION', 'LEGENDARY_ACTION', 'SPELL', 'OTHER'])
export type AbilityKind = z.infer<typeof AbilityKind>

// Fields the party can know about an entity, shown as tick boxes on the sheet.
export const KNOWLEDGE_FIELDS = ['name', 'location', 'motivation', 'statblock', 'bio'] as const
export const KnowledgeField = z.enum(KNOWLEDGE_FIELDS)
export type KnowledgeField = z.infer<typeof KnowledgeField>

export const LogKind = z.enum(['note', 'fight', 'meeting', 'quest', 'rest', 'travel'])
export type LogKind = z.infer<typeof LogKind>

export const EncounterFeedback = z.enum(['too_easy', 'about_right', 'hard', 'nearly_deadly'])
export type EncounterFeedback = z.infer<typeof EncounterFeedback>

export const ReviewDecisionKind = z.enum(['approved', 'rejected', 'flagged', 'explained', 'resolved'])
export type ReviewDecisionKind = z.infer<typeof ReviewDecisionKind>

export const PrepKind = z.enum(['discovery', 'scene', 'clue', 'npc', 'threat', 'thread', 'bible'])
export type PrepKind = z.infer<typeof PrepKind>
export const SceneType = z.enum(['social', 'exploration', 'combat', 'other'])
export type SceneType = z.infer<typeof SceneType>
