// Plain data the main process sends to the renderer over IPC.
import type {
  AbilityKind, BoardItemKind, EntityAttributes, EntityStatus, EntityType, KnowledgeField, NoteContent, RowStatus,
  RulesEdition, StorylineStatus
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

export interface StorylineDetail {
  title: string
  status: StorylineStatus
  isMajor: boolean
  /** Desk tarot emblem key; null means one is chosen automatically. */
  emblem: string | null
}

export interface BoardSummary {
  id: string
  name: string
  storylineId: string | null
  storyline: StorylineDetail | null
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
  removedStorylines: Array<{ storylineId: string; title: string }>
  removedMaps: Array<{ id: string; name: string }>
  removedActs: Array<{ id: string; title: string; storylineTitle: string }>
  removedOutcomes: Array<{ id: string; label: string; actTitle: string }>
  removedTriggers: Array<{ id: string; label: string; actTitle: string }>
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

export interface MapView {
  id: string
  name: string
  /** dz-asset:// address the renderer can show. */
  url: string
  width: number | null
  height: number | null
}

export interface DeskStoryline {
  boardId: string
  storylineId: string
  title: string
  status: StorylineStatus
  isMajor: boolean
  emblem: string | null
  cardCount: number
}

export interface DeskPartyMember {
  id: string
  name: string
  summary: string
  ac: string
  hp: string
  passivePerception: number | null
  /** The DM's card colour, if set. */
  colour: string | null
}

export interface DeskView {
  storylines: DeskStoryline[]
  party: DeskPartyMember[]
  map: MapView | null
  maps: MapView[]
  dmNotes: string
  moonOffsetDays: number
  counts: { cards: number; strings: number; removed: number }
}

export type TriggerEffectView =
  | { type: 'shift_act'; actId: string; minutes: number }
  | { type: 'force_outcome'; actId: string; outcomeId: string }
  | { type: 'set_status'; status: StorylineStatus }

export interface OutcomeView {
  id: string
  actId: string
  label: string
  description: string
  isDefault: boolean
}

export interface ActView {
  id: string
  storylineId: string
  number: number
  title: string
  summary: string
  /** The DM's planned times. */
  plannedStartMin: number
  plannedEndMin: number
  /** Where the engine puts it after triggers (equal to planned if nothing moved it). */
  startMin: number
  endMin: number
  shiftedBy: number
  chosenOutcomeId: string | null
  state: 'upcoming' | 'running' | 'resolved' | 'awaiting'
  outcomeId: string | null
  resolvedBy: 'dm' | 'default' | 'trigger' | null
  forcedOutcomeId: string | null
  defaultOutcomeId: string | null
  outcomes: OutcomeView[]
}

export interface TriggerView {
  id: string
  /** T1, T2… in the order they were made. */
  label: string
  sourceActId: string
  outcomeId: string
  targetStorylineId: string
  effect: TriggerEffectView
  note: string
  firedAtMin: number | null
}

export interface TimelineStoryline {
  storylineId: string
  boardId: string
  title: string
  status: StorylineStatus
  /** Status after triggers (equal to status if nothing changed it). */
  projectedStatus: StorylineStatus
  isMajor: boolean
  emblem: string | null
}

export interface TimelineView {
  nowMin: number
  moonOffsetDays: number
  storylines: TimelineStoryline[]
  acts: ActView[]
  triggers: TriggerView[]
}

export interface WhatIfView {
  actId: string
  outcomeId: string
  lines: string[]
}
