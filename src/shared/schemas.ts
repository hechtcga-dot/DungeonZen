import { z } from 'zod'

// Enums are stored as strings in SQLite and checked here (CLAUDE.md rule 6).

export const ENTITY_TYPES = [
  'NPC', 'PC', 'MONSTER', 'LOCATION', 'QUEST', 'ITEM', 'SCENE', 'CLUE', 'FACTION', 'HANDOUT'
] as const
export const EntityType = z.enum(ENTITY_TYPES)
export type EntityType = z.infer<typeof EntityType>

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

// Free-form attributes; typed sub-schemas (5e stat block etc.) arrive with the entity sheet.
export const EntityAttributes = z.record(z.string(), z.unknown())
export type EntityAttributes = z.infer<typeof EntityAttributes>

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

export const PrepKind = z.enum(['discovery', 'scene', 'clue', 'npc', 'threat'])
export type PrepKind = z.infer<typeof PrepKind>
export const SceneType = z.enum(['social', 'exploration', 'combat', 'other'])
export type SceneType = z.infer<typeof SceneType>
