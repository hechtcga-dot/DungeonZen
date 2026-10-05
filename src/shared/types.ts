// Plain data the main process sends to the renderer over IPC.
import type {
  BoardItemKind, EntityAttributes, EntityStatus, EntityType, NoteContent, RowStatus, RulesEdition
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
