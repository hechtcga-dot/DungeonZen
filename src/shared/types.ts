// Plain data the main process sends to the renderer over IPC.
import type {
  AbilityKind, BoardItemKind, EntityAttributes, EntityStatus, EntityType, KnowledgeField, NoteContent, RowStatus,
  RulesEdition
} from './schemas'

export interface CampaignInfo {
  folder: string
  name: string
  rulesEdition: RulesEdition
  clockMin: number
  globalBoardId: string
}

export interface RecentCampaign {
  folder: string
  name: string
  openedAt: string
}

export interface EntityView {
  id: string
  type: EntityType
  name: string
  attributes: EntityAttributes
  tags: string[]
  status: EntityStatus
  parentId: string | null
  storylineIds: string[]
}

export interface RelationshipView {
  id: string
  sourceId: string
  targetId: string
  type: string
  isSecret: boolean
  status: RowStatus
}

export interface BoardItemView {
  id: string
  kind: BoardItemKind
  entityId: string | null
  x: number
  y: number
  w: number | null
  h: number | null
  content: NoteContent | null
}

export interface BoardSummary {
  id: string
  name: string
  storylineId: string | null
}

export interface UndoState {
  undoLabel: string | null
  redoLabel: string | null
}

export interface BoardView {
  board: BoardSummary
  boards: BoardSummary[]
  items: BoardItemView[]
  entities: Record<string, EntityView>
  relationships: RelationshipView[]
  undo: UndoState
}

export interface LogEntryView {
  id: string
  label: string
  at: string
  undone: boolean
}

export interface HistoryView {
  removedEntities: EntityView[]
  removedStrings: Array<RelationshipView & { sourceName: string; targetName: string }>
  removedNotes: Array<{ itemId: string; boardName: string; text: string }>
  log: LogEntryView[]
}

export interface AbilityView {
  id: string
  name: string
  kind: AbilityKind
  description: string
  macroText: string
  showTokenAction: boolean
  showMacroBar: boolean
}

export interface EntityBrief {
  id: string
  type: EntityType
  name: string
  status: EntityStatus
}

export interface ConnectionView {
  relationship: RelationshipView
  other: EntityBrief
  /** true when this entity is the source of the string */
  outgoing: boolean
  partyKnows: boolean
}

export interface SheetView {
  entity: EntityView
  abilities: AbilityView[]
  connections: ConnectionView[]
  partyKnows: Record<KnowledgeField, boolean>
  /** Other entities that can be linked to, for pickers. */
  others: EntityBrief[]
  undo: UndoState
}

export interface LibraryFilters {
  query: string
  type?: EntityType
  tag?: string
  crMin?: number
  crMax?: number
  hpMin?: number
  hpMax?: number
}

export interface LibraryResult {
  entity: EntityView
  line: string
}

export interface LibrarySearch {
  results: LibraryResult[]
  tags: string[]
}

export interface SrdMonsterSummary {
  key: string
  name: string
  kind: string
  cr: string
  ac: string
  hp: string
}

export interface SrdItemSummary {
  key: string
  name: string
  category: string
  rarity: string
  magic: boolean
}

export interface SrdSearch {
  monsters: SrdMonsterSummary[]
  items: SrdItemSummary[]
  totalMonsters: number
  totalItems: number
  attribution: string
}
