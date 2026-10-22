import { LENGTH_UNITS, type LengthUnit } from '../../shared/units'
import { extname } from 'node:path'
import { type TableName,
  type PrepItemRow, type AbilityRow, type LogRow, type MapRow, type OutcomeRow,
  type SessionRow, type TriggerRow, type BoardItemRow, type EntityRow, type RelationshipRow
} from '../db/schema'
import type { AbilityKind, EntityAttributes, EntityStatus, EntityType, LogKind,   RowStatus, RulesEdition, StorylineStatus } from '../../shared/schemas'
import { type PrepKind } from '../../shared/schemas'
import type { SecretKind,   AbilityView, BoardItemView, CardActMark, EntityView,   LogView, MapView, RelationshipView,   SessionView } from '../../shared/types'
import { type Point } from '../../shared/geometry'
import { rowsFor } from '../../shared/battlemap'
import { type Biome, type PlaceKind } from '../../shared/places'
import { type TriggerEffect } from '../engine/timeline'


export const DB_FILE = 'campaign.db'
export const ASSETS_DIR = 'assets'
export interface NewRegion {
  name: string
  kind: PlaceKind
  biome: Biome | null
  polygon: Point[]
  /** Index of an earlier region in the same list that this one lies inside. */
  parent?: number | null
  summary?: string
  description?: string
  /** Set when an AI proposed it (shown as such on the card). */
  source?: string
}
export type SrdCopy = { type: 'MONSTER' | 'ITEM'; name: string; attributes: EntityAttributes; abilities: NewAbility[] }
export const PREP_LABELS: Record<PrepKind, string> = { discovery: 'secret', scene: 'scene', clue: 'clue', npc: 'NPC', threat: 'threat', thread: 'loose thread', bible: 'world bible line' }
export type PrepItemPatch = Partial<Pick<PrepItemRow,
  'title' | 'body' | 'sceneType' | 'targetStart' | 'targetEnd' | 'entityId' | 'locationId' | 'discoveryId' | 'relationshipId' | 'secretId' | 'description' | 'role' | 'stats' | 'tactics'>>
export const STYLE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.jfif', '.webp']
export const PENDING_ID = /^[0-9a-f-]{36}\.(png|jpg|webp)$/
export function mimeOf(path: string): string {
  const e = extname(path).toLowerCase()
  return e === '.jpg' || e === '.jpeg' || e === '.jfif' ? 'image/jpeg' : e === '.webp' ? 'image/webp' : 'image/png'
}
export const MAP_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.jfif', '.webp', '.gif']
/** The extension a copy is saved under: JFIF is JPEG, so its copies are plain .jpg files. */
export const storedExt = (ext: string) => (ext.toLowerCase() === '.jfif' ? '.jpg' : ext.toLowerCase())
/** Address the app's asset protocol serves files from the open campaign's assets folder under. */
export const ASSET_URL_PREFIX = 'dz-asset://campaign/'
/** What kind of note a file is, by its extension. */
export function noteKind(ext: string): 'word' | 'pdf' | 'text' | 'picture' {
  const e = ext.toLowerCase()
  return e === '.docx' ? 'word' : e === '.pdf' ? 'pdf' : MAP_EXTENSIONS.includes(e) ? 'picture' : 'text'
}
/** Library › Pictures folders that always exist. */
export const DEFAULT_PICTURE_FOLDERS = ['Art', 'Portraits', 'Places', 'Items', 'Maps', 'Battle maps', 'Background pictures']
/** The folder a card's picture shows in. */
export const PICTURE_FOLDER: Partial<Record<EntityType, string>> = { NPC: 'Portraits', PC: 'Portraits', MONSTER: 'Portraits', LOCATION: 'Places', BUILDING: 'Places', ITEM: 'Items' }

export const DEFAULT_RULES_EDITION: RulesEdition = '2024'
export const DEFAULT_CLOCK_MIN = 9 * 60 // Day 1, 09:00

export interface Position { x: number; y: number }

export type SettingKey =
  'name' | 'rules_edition' | 'units' | 'clock_min' | 'moon_offset_days' | 'dm_notes' | 'active_map_id' | 'party_level' | 'last_long_rest_min'
  | 'heading_location_id' | 'house_rules' | 'getting_started' | 'link_positions' | 'shared_strings' | 'string_types' | 'picture_folders' | 'art_style' | 'backup_folder' | 'roll_tables' | 'master_notes' | 'type_colours' | 'price_scale' | 'campaign_secrets' | 'world_outline' | 'prompt_templates' | 'word_links' | 'note_meta' | 'notes_starred' | 'notes_folders' | 'note_folder_links' | 'link_rules' | 'spell_rules'
  | 'calendar' | 'calendar_events' | 'weather_days' | 'date_words_off'

export interface GeneratedPerson {
  name: string; species: string; occupation: string; attitude: string; quirk: string; wants: string; statblockName: string; summary: string
}

export interface NewAbility {
  name: string
  kind?: AbilityKind
  description?: string
  macroText?: string
  showTokenAction?: boolean
  showMacroBar?: boolean
}

export function toEntityView(r: EntityRow, storylineIds: string[], acts: CardActMark[]): EntityView {
  return {
    id: r.id, type: r.type as EntityType, name: r.name, attributes: r.attributes, tags: r.tags,
    status: r.status as EntityStatus, parentId: r.parentId, storylineIds, hidden: r.hidden, acts
  }
}

export function toRelationshipView(r: RelationshipRow, secrets?: Map<string, { kind: string; text: string }>): RelationshipView {
  const s = r.secretId ? secrets?.get(r.secretId) : undefined
  return {
    secretId: s ? r.secretId : null, secretKind: (s?.kind as SecretKind | undefined) ?? null,
    id: r.id, sourceId: r.sourceId, targetId: r.targetId, type: r.type, isSecret: r.isSecret,
    status: r.status as RowStatus, hidden: r.hidden, boardId: r.boardId, description: s ? s.text : r.description
  }
}

export function toItemView(r: BoardItemRow): BoardItemView {
  return {
    id: r.id, kind: r.kind as BoardItemView['kind'], entityId: r.entityId, x: r.x, y: r.y, w: r.w, h: r.h,
    content: r.content ?? null, hidden: r.hidden
  }
}

export function toAbilityView(r: AbilityRow): AbilityView {
  return {
    id: r.id, name: r.name, kind: r.kind as AbilityKind, description: r.description, macroText: r.macroText,
    showTokenAction: r.showTokenAction, showMacroBar: r.showMacroBar
  }
}

/** Everything searchable about an entity, lower-cased: name, type, tags and text fields (stat block included). */
export function searchText(v: EntityView): string {
  const parts: string[] = [v.name, v.type, ...v.tags]
  const walk = (x: unknown): void => {
    if (typeof x === 'string') parts.push(x)
    else if (typeof x === 'number') parts.push(String(x))
    else if (Array.isArray(x)) x.forEach(walk)
    else if (x && typeof x === 'object') Object.values(x).forEach(walk)
  }
  walk(v.attributes)
  return parts.join(' \n ').toLowerCase()
}

export { isEncounterCard as isEncounter } from '../../shared/schemas'

export function toMapView(r: MapRow): MapView {
  return {
    id: r.id, name: r.name, url: ASSET_URL_PREFIX + r.imagePath, width: r.width, height: r.height,
    widthKm: r.widthKm, travelKmh: r.travelKmh,
    scaleLen: r.scaleLen, scaleUnit: (LENGTH_UNITS as string[]).includes(r.scaleUnit ?? '') ? r.scaleUnit as LengthUnit : null,
    scaleKey: r.scaleKey, scaleKeyX: r.scaleKeyX, scaleKeyY: r.scaleKeyY,
    kind: r.kind === 'battle' ? 'battle' : 'world',
    gridCols: r.gridCols,
    gridRows: r.gridCols && r.width && r.height ? rowsFor(r.gridCols, r.width, r.height) : null,
    gridShown: !!r.gridShown,
    source: r.source, prompt: r.prompt
  }
}

export function toOutcomeView(o: OutcomeRow) {
  return { id: o.id, actId: o.actId, label: o.label, description: o.description, isDefault: o.isDefault }
}

export function toEffect(t: TriggerRow): TriggerEffect {
  const p = t.payload
  if (t.effectType === 'shift_act') return { type: 'shift_act', actId: String(p.actId), minutes: Number(p.minutes) }
  if (t.effectType === 'force_outcome') return { type: 'force_outcome', actId: String(p.actId), outcomeId: String(p.outcomeId) }
  return { type: 'set_status', status: p.status as StorylineStatus }
}

export function checkSpan(startMin: number, endMin: number): void {
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0) throw new Error('Act times must be whole minutes from the campaign start')
  if (endMin <= startMin) throw new Error('An act must end after it starts')
}

export function toSessionView(r: SessionRow): SessionView {
  return {
    id: r.id, number: r.number, startMin: r.startMin, endMin: r.endMin, ended: r.endedAt !== null, startedAt: r.startedAt,
    sceneText: r.sceneText, recap: r.recap, playerRecap: r.playerRecap
  }
}

export function toLogView(l: LogRow, names: Map<string, string>): LogView {
  return {
    id: l.id, atMin: l.atMin, kind: l.kind as LogKind, text: l.text, entityId: l.entityId,
    entityName: l.entityId ? names.get(l.entityId) ?? null : null, minutesTaken: l.minutesTaken
  }
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export type ForgetKind = keyof typeof FORGET_TABLE
export const FORGET_TABLE = {
  entity: 'entity', secret: 'secret', string: 'relationship', note: 'board_item', storyline: 'storyline', act: 'act',
  outcome: 'act_outcome', trigger: 'story_trigger', map: 'map', region: 'region_shape', style: 'style_example',
  prep: 'session_prep', prepItem: 'prep_item'
} as const satisfies Record<string, TableName>
