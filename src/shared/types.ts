import type { CombatantInfo, CombatState } from './combat'
import type { Units } from './units'
import type { StatBlock } from './statblock'
// Plain data the main process sends to the renderer over IPC.
import type {
  AbilityKind, BoardItemKind, EntityAttributes, EntityStatus, EntityType, KnowledgeField, BoardItemContent, RowStatus,
  EncounterFeedback, LogKind, ReviewDecisionKind, RulesEdition, StorylineStatus, PrepKind, SceneType
} from './schemas'
import type { AiChoice } from './aiProviders'
import type { Adaptation, Difficulty2024 } from './encounter'
import type { Biome, PlaceKind } from './places'

export interface CampaignInfo {
  folder: string
  name: string
  rulesEdition: RulesEdition
  clockMin: number
  globalBoardId: string
  /** What the screens show: metric (default) or imperial. Stored values are metric. */
  units: Units
  /** A new campaign: show the getting started guide until the DM finishes or skips it. */
  gettingStarted: boolean
  /** The art style in words, added to every AI drawing (works with services that cannot see examples). */
  artStyle: string
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
  /** Hidden on every board (shown greyed only with Show hidden). */
  hidden: boolean
  /** Acts the card is marked with: its storyline and the act's number there (I, II …). */
  acts: CardActMark[]
}

export interface CardActMark { actId: string; storylineId: string; number: number; title: string }

/** A kind of string the DM named, with an optional colour. */
export interface StringType { type: string; colour: string | null }

export interface BoardSettings {
  /** Moving or resizing a card moves it on every board. */
  linkPositions: boolean
  /** Strings show on every board (off: each board keeps its own). */
  sharedStrings: boolean
  stringTypes: StringType[]
}

export interface RelationshipView {
  id: string
  sourceId: string
  targetId: string
  type: string
  isSecret: boolean
  status: RowStatus
  hidden: boolean
  /** Null: on every board; else the board that keeps it (strings kept per board). */
  boardId: string | null
}

export interface BoardItemView {
  id: string
  kind: BoardItemKind
  entityId: string | null
  x: number
  y: number
  w: number | null
  h: number | null
  content: BoardItemContent | null
  hidden: boolean
}

export interface StorylineDetail {
  title: string
  status: StorylineStatus
  isMajor: boolean
  /** Desk tarot emblem key; null means one is chosen automatically. */
  emblem: string | null
  /** Tints its cards on the board; null = none. */
  colour: string | null
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
  settings: BoardSettings
  /** Every act of every storyline, numbered like the Timeline (for act marks). */
  acts: Array<{ id: string; storylineId: string; number: number; title: string }>
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
  removedRegions: Array<{ id: string; name: string }>
  removedStyles: Array<{ id: string; name: string }>
  removedPrep: Array<{ id: string; name: string; what: string }>
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

/** One row of the SRD monster browser. */
export interface SrdMonsterRow {
  key: string
  name: string
  size: string
  type: string
  alignment: string
  cr: string
  crNum: number
  ac: number
  hp: number
  /** Ways of moving besides walking. */
  moves: Array<'fly' | 'swim' | 'climb' | 'burrow'>
  legendary: boolean
  speed: string
  senses: string
  actions: string[]
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
  /** How many km the image is across (map scale); stored metric. */
  widthKm: number | null
  travelKmh: number
  /** A world map, or a battle map with a square grid (5 ft squares). */
  kind: 'world' | 'battle'
  gridCols: number | null
  gridRows: number | null
  /** Null for the DM's own image; otherwise which AI drew it (rule 10). */
  source: string | null
  prompt: string | null
}

export interface StyleExampleView {
  id: string
  name: string
  url: string
}

/** What a Library picture is a style example for. */
export const STYLE_USES = ['portraits', 'maps', 'battle'] as const
export type StyleUse = (typeof STYLE_USES)[number]

/** Library › Pictures: one picture. Maps and card pictures show up here too, in their own folders. */
export interface LibraryPictureView {
  /** lib:<id> for a Library picture; map:<id>, card:<entity id> or board:<item id> for one not filed yet. */
  key: string
  name: string
  folder: string
  /** Relative to the campaign's assets folder. */
  path: string
  url: string
  styleFor: StyleUse[]
  /** Where it is used, when it came from a map, a card or a board. */
  from: { kind: 'map' | 'card' | 'board'; id: string; name: string } | null
}
export interface PicturesView { pictures: LibraryPictureView[]; folders: string[] }

/** An image an AI drew, waiting for the DM to keep or discard it. */
export interface PendingImageView {
  pendingId: string
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
  colour: string | null
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
  /** At the table: hit points now (max when never changed), temporary hit points, size, resistances, conditions. */
  currentHp: number | null
  maxHp: number | null
  tempHp: number
  size: string
  resistances: string
  conditions: string
  /** Portrait in the campaign assets (dz-asset path), when the card has one. */
  picture: string | null
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
  /** Cards marked with this act (also shown on the cards). */
  cards: Array<{ id: string; name: string }>
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
  colour: string | null
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

export interface SessionView {
  id: string
  number: number
  startMin: number
  endMin: number | null
  ended: boolean
  /** Real date and time the session started (for pacing at the table). */
  startedAt: string
  sceneText: string
  recap: string
  playerRecap: string
}

export interface LogView {
  id: string
  atMin: number
  kind: LogKind
  text: string
  entityId: string | null
  entityName: string | null
  minutesTaken: number
}

export interface PartyHealth {
  id: string
  name: string
  hp: number
  maxHp: number
  ac: string
  colour: string | null
}

export interface AdvisorNote {
  level: 'warn' | 'info'
  text: string
}

export interface LiveView {
  nowMin: number
  session: SessionView | null
  sessions: SessionView[]
  log: LogView[]
  today: { fights: number; meetings: number; quests: number }
  party: PartyHealth[]
  health: { hp: number; maxHp: number; percent: number | null }
  advisor: AdvisorNote[]
  partyLevel: number
  map: MapView | null
  /** Cards to pick from when logging a meeting. */
  people: EntityBrief[]
  lastLongRestMin: number | null
}

export interface GeneratedView {
  kind: 'character' | 'encounter' | 'tavern'
  title: string
  summary: string
  lines: string[]
  /** Opaque data sent back to keep the result. */
  payload: unknown
}

export interface ReviewDecisionView { decision: ReviewDecisionKind; note: string }

export interface ReviewConflict {
  key: string
  text: string
  /** The DM's own words from the log, if the conflict comes from a log entry. */
  quote: string | null
  /** What the buttons do, in order. */
  options: Array<{ action: 'revive' | 'remove_entry'; label: string }>
  decision: ReviewDecisionView | null
}

export type ReviewProposal =
  | {
    kind: 'act'
    key: string
    actId: string
    what: string
    sub: string
    before: string
    after: string
    /** Outcome the proposal would record; null when the DM must pick one. */
    outcomeId: string | null
    outcomes: Array<{ id: string; label: string }>
    ripples: string[]
    decision: ReviewDecisionView | null
  }
  | {
    kind: 'knowledge'
    key: string
    entityId: string
    what: string
    sub: string
    before: string
    after: string
    fields: KnowledgeField[]
    decision: ReviewDecisionView | null
  }

export interface ReviewFight { logId: string; atMin: number; text: string; feedback: EncounterFeedback | null }

export interface ReviewView {
  session: SessionView
  during: { startMin: number; endMin: number; entries: number; meetings: number }
  conflicts: ReviewConflict[]
  proposals: ReviewProposal[]
  fights: ReviewFight[]
}

export interface RegionView {
  id: string
  locationId: string
  name: string
  polygon: Array<[number, number]>
  parentLocationId: string | null
  colour: string | null
  /** From the Location card: region, city, town… and the land's biome. */
  kind: PlaceKind | null
  biome: Biome | null
}

export interface PartyMarker {
  x: number
  y: number
  locationId: string | null
  locationName: string | null
  atMin: number
}

/** A player character: with the party, or split off with a token of its own. */
export interface PcToken {
  entityId: string
  name: string
  /** Where they are on their own; null while with the party. */
  split: (PartyMarker & { mapId: string }) | null
}

export interface MapScreenView {
  map: MapView
  regions: RegionView[]
  party: PartyMarker | null
  /** Every player character; split ones have their own token (on this or another map). */
  pcs: PcToken[]
  /** Where the party went during the current (or last) session, oldest first. */
  route: Array<[number, number]>
  /** True while a session is running (travel is then logged in it). */
  sessionRunning: boolean
  /** Location cards not yet drawn on this map, to tie a new region to. */
  unplacedLocations: EntityBrief[]
}

export interface RegionDetail {
  region: RegionView
  location: EntityView
  partyHere: boolean
  hereNow: EntityBrief[]
  encounters: EntityBrief[]
  plotPoints: EntityBrief[]
  notes: string
  subRegions: Array<{ locationId: string; name: string }>
}

export interface TravelEstimateView {
  minutes: number | null
  km: number | null
  basis: string
  fromName: string | null
  toName: string | null
  toLocationId: string | null
}

export interface AiProviderSetting {
  id: string
  hasKey: boolean
  /** The model and address the DM last chose for this service. */
  model: string
  baseUrl: string
}

export interface AiSettingsView {
  /** False when the computer cannot encrypt keys; keys then cannot be saved. */
  encryption: boolean
  text: AiChoice
  image: AiChoice
  providers: AiProviderSetting[]
}

/** Text an AI wrote, kept apart from the DM's own until the DM uses it (rules 2 and 10). */
export interface AiSuggestion {
  text: string
  /** "Anthropic Claude · claude-sonnet-5-5" */
  source: string
}

/** What the battle map dialog starts from: the scene, the place and the light now. */
export interface BattleMapContext {
  description: string
  placeName: string | null
  /** From the campaign clock. */
  timeOfDay: 'dawn' | 'day' | 'dusk' | 'night'
}

export interface PrepItemView {
  id: string
  kind: PrepKind
  title: string
  body: string
  sceneType: SceneType | null
  /** Real minutes from the start of the session (pacing). */
  targetStart: number | null
  targetEnd: number | null
  entityId: string | null
  entityName: string | null
  locationId: string | null
  locationName: string | null
  discoveryId: string | null
  role: string
  stats: string
  tactics: string
  done: boolean
  doneAtMin: number | null
}

export interface PrepView {
  id: string
  number: number
  title: string
  premise: string
  pacingMinutes: number
  backupNames: string
  notes: string
  items: PrepItemView[]
}

export interface PrepScreenView {
  /** Every prep sheet, by session number. */
  sheets: Array<{ id: string; number: number; title: string }>
  /** The session that is running, if any, and the next one to be played. */
  openNumber: number | null
  nextNumber: number
  /** Cards to link from the sheet. */
  people: EntityBrief[]
  threats: EntityBrief[]
  locations: EntityBrief[]
}

/** Live desk: everything about where the party is, for the DM at the table. */
export interface WhereView {
  place: { locationId: string; name: string; notes: string; inside: string | null; mapId: string; regionId: string | null } | null
  cameFrom: { name: string; atMin: number } | null
  headingTo: { locationId: string; name: string; travel: string | null } | null
  /** Location cards to choose where they are heading. */
  places: EntityBrief[]
  /** People and creatures the cards put here, and whether the party has met them. */
  people: Array<{ id: string; name: string; type: EntityType; met: boolean; keyNpc: boolean }>
  /** Things the party could find out here (DM eyes only). */
  secrets: Array<{ text: string; source: 'string' | 'card' | 'clue'; id: string; done?: boolean }>
  /** Prep sheet for the running (or next) session. */
  prep: PrepView | null
  /** Planned encounters at this place. */
  encounters: Array<{ id: string; name: string; rating: string; totalXp: number; runs: number }>
  /** Short reminders built from all of the above. */
  tips: string[]
}

/** Player preview: only what the party knows (safe to show the players). */
export interface PlayersView {
  campaignName: string
  when: string
  light: 'night' | 'dawn' | 'daylight' | 'dusk'
  recap: { number: number; text: string } | null
  place: { name: string; inside: string | null; notes: string } | null
  cameFrom: string | null
  headingTo: string | null
  people: Array<{ id: string; name: string; type: EntityType; facts: Array<{ label: string; value: string }> }>
  discoveries: Array<{ id: string; title: string; text: string; session: number }>
  connections: string[]
  /** The map with only the places the party has been, and what the players see there. */
  map: { view: MapScreenView; notes: Record<string, string> } | null
}

export interface EncounterCreatureView {
  /** The row in the encounter (null for an old encounter made before the planner). */
  rowId: string | null
  entityId: string
  name: string
  type: EntityType
  cr: string
  xpEach: number
  count: number
  statLine: string
  notes: string
  /** Not on the board yet (made by AI for this encounter): "Put on board" shows it. */
  stashed: boolean
  /** Its stat block was written by an AI (rule 10). */
  aiMade: boolean
}

/** Run encounter: the fight, and what the hints need to know about each card. */
export interface CombatView {
  id: string
  encounterId: string
  encounterName: string
  status: 'active' | 'ended'
  state: CombatState
  info: Record<string, CombatantInfo>
  sessionRunning: boolean
}

/** One creature an AI proposed for an encounter: an SRD monster, or a new one with its stat block. */
export type BuiltCreature =
  | { kind: 'srd'; key: string; name: string; cr: string; count: number; notes: string }
  | { kind: 'new'; name: string; statblock: StatBlock; actions: Array<{ name: string; kind: AbilityKind; description: string }>; count: number; notes: string }

export interface EncounterView {
  id: string
  name: string
  locationId: string | null
  locationName: string | null
  target: 'low' | 'moderate' | 'high'
  tactics: string
  notes: string
  /** What the place looks like and what is going on; the AI builds from it. */
  scene: string
  battleMapId: string | null
  creatures: EncounterCreatureView[]
  difficulty: Difficulty2024
  /** Times it was run in play, with how the party found it. */
  runs: Array<{ atMin: number; session: number; feedback: string | null }>
}

export interface EncountersView {
  encounters: EncounterView[]
  party: { level: number; size: number }
  /** True while a session is running (an encounter can be run as a fight). */
  sessionRunning: boolean
  adaptation: Adaptation
  houseRules: string
  /** Cards that can fight: monsters and NPCs, with their CR. */
  fighters: Array<EntityBrief & { cr: string }>
  places: EntityBrief[]
  battleMaps: Array<{ id: string; name: string }>
}

export interface Roll20Export {
  characters: Array<{ entityId: string; name: string; abilities: Array<{ name: string; macro: string; tokenAction: boolean }> }>
  /** One line of JSON for the import handout's GM notes. */
  data: string
  /** The Roll20 API (Mod) script. */
  script: string
  handout: string
}
