import { randomUUID } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { openDatabase, type OpenedDb } from '../db/open'
import { combat, noteDoc,
  ability, act, actOutcome, board, boardItem, campaignSetting, entity, knowledge, logEntry, map, partyPosition, regionShape,
  actEntity, relationship, relationshipKnown, reviewDecision, session, styleExample, travelLink, sessionPrep, prepItem, type PrepRow, type PrepItemRow, encounterCreature, type RegionRow, storyline, storylineEntity, storyTrigger, type AbilityRow, type ActRow, type LogRow, type MapRow, type OutcomeRow,
  type SessionRow, type TriggerRow, type BoardItemRow, type BoardRow, type EntityRow, type RelationshipRow
} from '../db/schema'
import { CommandLog, type Writer } from './commandLog'
import type {
  AbilityKind, EncounterFeedback, EntityAttributes, EntityStatus, EntityType, KnowledgeField, LogKind, ReviewDecisionKind,
  RowStatus, RulesEdition, StorylineStatus
} from '../../shared/schemas'
import { MINUTES_PER_DAY } from '../../shared/time'
import { formatClock } from '../../shared/time'
import { KNOWLEDGE_FIELDS, type PrepKind, type SceneType } from '../../shared/schemas'
import { freeSpot } from '../../shared/layout'
import { imageSize } from '../imageSize'
import { crToNumber, HAS_STATBLOCK, leadingNumber, passiveScore, readStatBlock, StatBlock, statLine } from '../../shared/statblock'
import type { CombatView, PcToken,
  AbilityView, BoardItemView, BoardSettings, BoardSummary, CardActMark, StringType, BoardView, CampaignInfo, DeskView, EntityBrief, EntityView, HistoryView,
  LibraryFilters, LibrarySearch, LiveView, LogView, MapScreenView, MapView, PartyMarker, PendingImageView, StyleExampleView, PrepScreenView, PrepView, PrepItemView, WhereView, PlayersView, EncountersView, EncounterView, EncounterCreatureView, RegionDetail, RegionView,
  RelationshipView, ReviewConflict, ReviewProposal, ReviewView, TravelEstimateView,
  SessionView, SheetView, TimelineView, TriggerEffectView, WhatIfView, LibraryPictureView, PicturesView, StyleUse, NoteDocView, NotesScreenView
} from '../../shared/types'
import { STYLE_USES } from '../../shared/types'
import { advise } from '../advisor'
import type { SceneContext } from '../ai/scene'
import { moonOn, skyAt } from '../../shared/sky'
import { centroid, estimateTravel, regionAt, type Point } from '../../shared/geometry'
import { scaleToCr } from '../../shared/crscale'
import { boostsAllies, CombatState, DAMAGE_TYPES, isLeaderName, legendaryCount, limitedUses, newCombatant, slotsFromText, type Combatant, type CombatantInfo } from '../../shared/combat'
import { rowsFor } from '../../shared/battlemap'
import { isBiome, isPlaceKind, type Biome, type PlaceKind } from '../../shared/places'
import { ImportDraft as ImportDraftSchema, type ImportDraft, type ImportDraftSummary } from '../../shared/notesImport'
import { adaptation, RATING_LABELS, rateEncounter, xpForCr, type FightFeedback } from '../../shared/encounter'
import { projectTimeline, whatIf, type TimelineInput, type TriggerEffect } from '../engine/timeline'

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
const PREP_LABELS: Record<PrepKind, string> = { discovery: 'discovery', scene: 'scene', clue: 'clue', npc: 'key NPC', threat: 'threat' }
export type PrepItemPatch = Partial<Pick<PrepItemRow,
  'title' | 'body' | 'sceneType' | 'targetStart' | 'targetEnd' | 'entityId' | 'locationId' | 'discoveryId' | 'role' | 'stats' | 'tactics'>>
const STYLE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']
const PENDING_ID = /^[0-9a-f-]{36}\.(png|jpg|webp)$/
function mimeOf(path: string): string {
  const e = extname(path).toLowerCase()
  return e === '.jpg' || e === '.jpeg' ? 'image/jpeg' : e === '.webp' ? 'image/webp' : 'image/png'
}
export const MAP_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
/** Address the app's asset protocol serves files from the open campaign's assets folder under. */
export const ASSET_URL_PREFIX = 'dz-asset://campaign/'
/** What kind of note a file is, by its extension. */
export function noteKind(ext: string): 'word' | 'pdf' | 'text' | 'picture' {
  const e = ext.toLowerCase()
  return e === '.docx' ? 'word' : e === '.pdf' ? 'pdf' : ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(e) ? 'picture' : 'text'
}
/** Library › Pictures folders that always exist. */
const DEFAULT_PICTURE_FOLDERS = ['Art', 'Portraits', 'Places', 'Items', 'Maps', 'Battle maps', 'Background pictures']
/** The folder a card's picture shows in. */
const PICTURE_FOLDER: Partial<Record<EntityType, string>> = { NPC: 'Portraits', PC: 'Portraits', MONSTER: 'Portraits', LOCATION: 'Places', ITEM: 'Items' }

const DEFAULT_RULES_EDITION: RulesEdition = '2024'
const DEFAULT_CLOCK_MIN = 9 * 60 // Day 1, 09:00

export interface Position { x: number; y: number }

export type SettingKey =
  'name' | 'rules_edition' | 'units' | 'clock_min' | 'moon_offset_days' | 'dm_notes' | 'active_map_id' | 'party_level' | 'last_long_rest_min'
  | 'heading_location_id' | 'house_rules' | 'getting_started' | 'link_positions' | 'shared_strings' | 'string_types' | 'picture_folders' | 'art_style'

interface GeneratedPerson {
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

/**
 * One open campaign folder: `campaign.db` plus `assets/`.
 * Pure Node (no Electron imports) so it can be unit tested.
 */
export class Campaign {
  readonly log: CommandLog

  private constructor(readonly folder: string, private readonly opened: OpenedDb) {
    this.log = new CommandLog(opened.db)
  }

  private get db() { return this.opened.db }

  static create(folder: string, name: string): Campaign {
    if (existsSync(join(folder, DB_FILE))) throw new Error(`A campaign already exists in ${folder}`)
    mkdirSync(join(folder, ASSETS_DIR), { recursive: true })
    const campaign = new Campaign(folder, openDatabase(join(folder, DB_FILE)))
    // Setting up a new campaign is not an undoable change.
    campaign.db.transaction((tx) => {
      tx.insert(campaignSetting).values([
        { key: 'name', value: name },
        { key: 'rules_edition', value: DEFAULT_RULES_EDITION },
        { key: 'clock_min', value: DEFAULT_CLOCK_MIN },
        // A new campaign opens on the getting started guide (world map, regions, notes).
        { key: 'getting_started', value: 'pending' }
      ]).run()
      tx.insert(board).values({ id: randomUUID(), name: 'Global', storylineId: null }).run()
    })
    return campaign
  }

  static open(folder: string): Campaign {
    const file = join(folder, DB_FILE)
    if (!existsSync(file)) throw new Error(`No campaign found in ${folder} (missing ${DB_FILE})`)
    // Images an AI drew that the DM never kept or discarded (the app closed) are not campaign data.
    rmSync(join(folder, ASSETS_DIR, 'pending'), { recursive: true, force: true })
    return new Campaign(folder, openDatabase(file))
  }

  close(): void {
    this.opened.sqlite.close()
  }

  /** Every change is already written; this folds the write-ahead log into campaign.db. */
  save(): void {
    this.opened.sqlite.pragma('wal_checkpoint(TRUNCATE)')
  }

  /** Copies the whole campaign folder (database, maps, pictures, notes) to a new folder. */
  saveCopy(dest: string): void {
    if (existsSync(dest)) throw new Error(`${dest} already exists`)
    this.save()
    cpSync(this.folder, dest, {
      recursive: true,
      filter: (src) => !/campaign\.db-(wal|shm)$/.test(src) && !src.startsWith(join(this.folder, ASSETS_DIR, 'pending'))
    })
  }

  // ---- reads ---------------------------------------------------------------

  info(): CampaignInfo {
    const settings = new Map(this.db.select().from(campaignSetting).all().map((s) => [s.key, s.value]))
    return {
      folder: this.folder,
      name: String(settings.get('name') ?? 'Untitled campaign'),
      rulesEdition: (settings.get('rules_edition') as RulesEdition) ?? DEFAULT_RULES_EDITION,
      clockMin: Number(settings.get('clock_min') ?? 0),
      globalBoardId: this.globalBoard().id,
      units: settings.get('units') === 'imperial' ? 'imperial' : 'metric',
      gettingStarted: settings.get('getting_started') === 'pending',
      artStyle: String(settings.get('art_style') ?? '')
    }
  }

  private globalBoard(): BoardRow {
    const row = this.db.select().from(board).where(isNull(board.storylineId)).get()
    if (!row) throw new Error('Campaign has no global board')
    return row
  }

  boards(): BoardSummary[] {
    const rows = this.db
      .select({ board, story: storyline })
      .from(board)
      .leftJoin(storyline, eq(board.storylineId, storyline.id))
      .all()
      .filter((r) => !r.story?.removed)
    const summaries = rows.map(({ board: b, story }) => ({
      id: b.id,
      name: story?.title ?? b.name,
      storylineId: b.storylineId,
      storyline: story
        ? { title: story.title, status: story.status as StorylineStatus, isMajor: story.isMajor, emblem: story.emblem, colour: story.colour }
        : null
    }))
    // Global first, then storylines in creation order (rowid order).
    // Concluded storylines stay listed for now; the timeline phase decides otherwise.
    return summaries.sort((a, b) => Number(a.storylineId !== null) - Number(b.storylineId !== null))
  }

  boardView(boardId: string): BoardView {
    const b = this.db.select().from(board).where(eq(board.id, boardId)).get()
    if (!b) throw new Error(`No board with id ${boardId}`)
    const items = this.db
      .select()
      .from(boardItem)
      .where(and(eq(boardItem.boardId, boardId), eq(boardItem.status, 'active')))
      .all()
    const entityIds = items.flatMap((i) => (i.entityId ? [i.entityId] : []))
    const entities = this.entityViews(entityIds).filter((e) => e.status === 'active' || e.status === 'resolved')
    const visible = new Set(entities.map((e) => e.id))
    const visibleItems = items.filter((i) => i.kind !== 'card' || (i.entityId !== null && visible.has(i.entityId)))
    const settings = this.boardSettings()
    // Shared strings show on every board; strings kept per board show only on theirs.
    const relationships = visible.size === 0 ? [] : this.db
      .select()
      .from(relationship)
      .where(and(eq(relationship.status, 'active'), inArray(relationship.sourceId, [...visible])))
      .all()
      .filter((r) => visible.has(r.targetId) && (settings.sharedStrings ? r.boardId === null : r.boardId === boardId))
    const boards = this.boards()
    return {
      board: boards.find((s) => s.id === boardId) ?? { id: b.id, name: b.name, storylineId: b.storylineId, storyline: null },
      boards,
      items: visibleItems.map(toItemView),
      entities: Object.fromEntries(entities.map((e) => [e.id, e])),
      relationships: relationships.map(toRelationshipView),
      undo: this.log.state(),
      settings,
      acts: this.numberedActs()
    }
  }

  private numberedActs(): Array<{ id: string; storylineId: string; number: number; title: string }> {
    const removed = new Set(this.db.select().from(storyline).where(eq(storyline.removed, true)).all().map((x) => x.id))
    const acts = this.db.select().from(act).where(eq(act.status, 'active')).all().filter((a) => !removed.has(a.storylineId))
      .sort((a, b) => a.startMin - b.startMin)
    const count = new Map<string, number>()
    return acts.map((a) => {
      const n = (count.get(a.storylineId) ?? 0) + 1
      count.set(a.storylineId, n)
      return { id: a.id, storylineId: a.storylineId, number: n, title: a.title }
    })
  }

  boardSettings(): BoardSettings {
    const types = this.setting('string_types')
    return {
      linkPositions: this.setting('link_positions') === true,
      sharedStrings: this.setting('shared_strings') !== false,
      stringTypes: Array.isArray(types) ? (types as StringType[]) : []
    }
  }

  private entityViews(ids: string[]): EntityView[] {
    if (ids.length === 0) return []
    const rows = this.db.select().from(entity).where(inArray(entity.id, ids)).all()
    const links = this.db
      .select()
      .from(storylineEntity)
      .where(and(inArray(storylineEntity.entityId, ids), eq(storylineEntity.status, 'active')))
      .all()
    const marks = this.actMarks(ids)
    return rows.map((r) => toEntityView(r, links.filter((l) => l.entityId === r.id).map((l) => l.storylineId), marks.get(r.id) ?? []))
  }

  entityView(id: string): EntityView {
    const [view] = this.entityViews([id])
    if (!view) throw new Error(`No entity with id ${id}`)
    return view
  }

  history(): HistoryView {
    const removed = this.db.select().from(entity).where(eq(entity.status, 'defunct')).orderBy(asc(entity.name)).all()
    const strings = this.db.select().from(relationship).where(eq(relationship.status, 'defunct')).all()
    const names = new Map(
      this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name])
    )
    const notes = this.db
      .select({ item: boardItem, boardName: board.name, title: storyline.title })
      .from(boardItem)
      .innerJoin(board, eq(boardItem.boardId, board.id))
      .leftJoin(storyline, eq(board.storylineId, storyline.id))
      .where(and(inArray(boardItem.kind, ['note', 'image']), eq(boardItem.status, 'defunct')))
      .all()
    return {
      removedEntities: removed.map((r) => toEntityView(r, [], [])),
      removedStrings: strings.map((r) => ({
        ...toRelationshipView(r),
        sourceName: names.get(r.sourceId) ?? '?',
        targetName: names.get(r.targetId) ?? '?'
      })),
      removedNotes: notes.map((n) => ({
        itemId: n.item.id,
        boardName: n.title ?? n.boardName,
        text: n.item.kind === 'image' ? `Picture: ${n.item.content?.name ?? ''}` : n.item.content?.text ?? ''
      })),
      removedStorylines: this.db.select().from(storyline).where(eq(storyline.removed, true)).all()
        .map((r) => ({ storylineId: r.id, title: r.title })),
      removedMaps: this.db.select().from(map).where(eq(map.status, 'defunct')).all().map((m) => ({ id: m.id, name: m.name })),
      ...this.removedTimeline(),
      removedRegions: this.db.select().from(regionShape).where(eq(regionShape.status, 'defunct')).all()
        .map((r) => ({ id: r.id, name: this.nameOf(r.locationId) })),
      removedPrep: [
        ...this.db.select().from(sessionPrep).where(eq(sessionPrep.status, 'defunct')).all()
          .map((p) => ({ id: p.id, name: p.title || `Session ${p.number}`, what: 'prep sheet' })),
        ...this.db.select().from(prepItem).where(eq(prepItem.status, 'defunct')).all()
          .map((i) => ({ id: i.id, name: i.title || '(untitled)', what: PREP_LABELS[i.kind as PrepKind] }))
      ],
      removedStyles: this.db.select().from(styleExample).where(eq(styleExample.status, 'defunct')).all()
        .map((r) => ({ id: r.id, name: r.name })),
      log: this.log.recent().map((c) => ({ id: c.id, label: c.label, at: c.at, undone: c.state === 'undone' }))
    }
  }

  // ---- writes (each one is a single undoable command) ----------------------

  createEntity(input: {
    boardId: string
    type: EntityType
    name: string
    position: Position
    attributes?: EntityAttributes
    tags?: string[]
    abilities?: NewAbility[]
    label?: string
  }): EntityView {
    let id = ''
    this.log.run(input.label ?? `Added ${input.type.toLowerCase()} ${input.name}`, (w) => {
      id = this.insertEntity(w, input)
      if (input.type === 'PC') this.joinFights(w, id)
    })
    return this.entityView(id)
  }

  /** Creates an entity and its card(s) inside an open command, so several can be one undo step. */
  private insertEntity(w: Writer, input: {
    boardId: string; type: EntityType; name: string; position: Position; attributes?: EntityAttributes
    tags?: string[]; abilities?: NewAbility[]; status?: EntityStatus
  }): string {
    const id = randomUUID()
    w.insert('entity', {
      id, type: input.type, name: input.name, attributes: input.attributes ?? {}, tags: input.tags ?? [],
      status: input.status ?? 'active', parentId: null, createdAt: new Date().toISOString()
    })
    ;(input.abilities ?? []).forEach((a, i) => this.insertAbility(w, id, a, i))
    const global = this.globalBoard()
    this.placeCard(w, global.id, id, input.position)
    const target = this.boardRow(input.boardId)
    if (target.storylineId) this.linkToStoryline(w, id, target.storylineId, target.id, input.position)
    return id
  }

  updateEntity(
    id: string,
    patch: { name?: string; type?: EntityType; tags?: string[]; attributes?: EntityAttributes }
  ): void {
    const current = this.entityRow(id)
    if (patch.attributes && 'statblock' in patch.attributes) {
      patch = { ...patch, attributes: { ...patch.attributes, statblock: StatBlock.parse(patch.attributes.statblock) } }
    }
    this.log.run(`Edited ${patch.name ?? current.name}`, (w) => {
      w.update('entity', id, {
        name: patch.name, type: patch.type, tags: patch.tags,
        attributes: patch.attributes ? { ...current.attributes, ...patch.attributes } : undefined
      })
    })
  }

  setEntityStatus(id: string, status: EntityStatus): void {
    const current = this.entityRow(id)
    const label = {
      active: current.status === 'defunct' ? `Revived ${current.name}` : `Marked ${current.name} active`,
      resolved: `Marked ${current.name} resolved`,
      defunct: `Moved ${current.name} to History`,
      stashed: `Stashed ${current.name}`
    }[status]
    this.log.run(label, (w) => { w.update('entity', id, { status }) })
  }

  addToStoryline(entityId: string, storylineId: string, position: Position): void {
    const e = this.entityRow(entityId)
    const s = this.db.select().from(storyline).where(eq(storyline.id, storylineId)).get()
    if (!s) throw new Error(`No storyline with id ${storylineId}`)
    const b = this.db.select().from(board).where(eq(board.storylineId, storylineId)).get()!
    this.log.run(`Added ${e.name} to ${s.title}`, (w) => this.linkToStoryline(w, entityId, storylineId, b.id, position))
  }

  removeFromStoryline(entityId: string, storylineId: string): void {
    const e = this.entityRow(entityId)
    const s = this.db.select().from(storyline).where(eq(storyline.id, storylineId)).get()
    if (!s) throw new Error(`No storyline with id ${storylineId}`)
    this.log.run(`Took ${e.name} off ${s.title}`, (w) => {
      for (const link of this.db.select().from(storylineEntity).where(and(
        eq(storylineEntity.entityId, entityId), eq(storylineEntity.storylineId, storylineId)
      )).all()) w.update('storyline_entity', link.id, { status: 'defunct' })
      const b = this.db.select().from(board).where(eq(board.storylineId, storylineId)).get()!
      for (const item of this.cardItems(b.id, entityId)) w.update('board_item', item.id, { status: 'defunct' })
    })
  }

  /** Ties a string. While strings are kept per board, it belongs to `boardId` (the board it was tied on). */
  createRelationship(input: { sourceId: string; targetId: string; type: string; isSecret: boolean; boardId?: string; colour?: string }): RelationshipView {
    if (input.sourceId === input.targetId) throw new Error('A string needs two different cards')
    const a = this.entityRow(input.sourceId)
    const b = this.entityRow(input.targetId)
    const id = randomUUID()
    const { boardId, colour, ...rest } = input
    const settings = this.boardSettings()
    const owner = settings.sharedStrings ? null : boardId ?? this.globalBoard().id
    this.log.run(`Linked ${a.name} to ${b.name}`, (w) => {
      w.insert('relationship', { id, ...rest, boardId: owner, status: 'active' })
      // A new kind of link (with its colour) joins the list in the same undo step.
      if (colour !== undefined) {
        const types = [...settings.stringTypes.filter((t) => t.type !== input.type), { type: input.type, colour }]
        if (w.get('campaign_settings', 'string_types')) w.update('campaign_settings', 'string_types', { value: types })
        else w.insert('campaign_settings', { key: 'string_types', value: types })
      }
    })
    return toRelationshipView(this.db.select().from(relationship).where(eq(relationship.id, id)).get()!)
  }

  updateRelationship(id: string, patch: { type?: string; isSecret?: boolean }): void {
    const r = this.relationshipRow(id)
    this.log.run(`Edited string ${this.nameOf(r.sourceId)} – ${this.nameOf(r.targetId)}`, (w) => {
      w.update('relationship', id, patch)
    })
  }

  setRelationshipStatus(id: string, status: RowStatus): void {
    const r = this.relationshipRow(id)
    const verb = status === 'defunct' ? 'Removed string' : 'Restored string'
    this.log.run(`${verb} ${this.nameOf(r.sourceId)} – ${this.nameOf(r.targetId)}`, (w) => {
      w.update('relationship', id, { status })
    })
  }

  addNote(input: { boardId: string; position: Position; text: string }): BoardItemView {
    this.boardRow(input.boardId)
    const id = randomUUID()
    this.log.run('Added a note', (w) => {
      w.insert('board_item', {
        id, boardId: input.boardId, kind: 'note', entityId: null, x: input.position.x, y: input.position.y,
        w: null, h: null, content: { text: input.text }, status: 'active'
      })
    })
    return toItemView(this.itemRow(id))
  }

  updateNote(itemId: string, text: string): void {
    const item = this.itemRow(itemId)
    if (item.kind !== 'note') throw new Error('Only notes have editable text')
    this.log.run('Edited a note', (w) => { w.update('board_item', itemId, { content: { text } }) })
  }

  setNoteStatus(itemId: string, status: RowStatus): void {
    const item = this.itemRow(itemId)
    if (item.kind === 'card') throw new Error('Not a note or picture')
    const what = item.kind === 'image' ? 'picture' : 'note'
    this.log.run(status === 'defunct' ? `Removed a ${what}` : `Restored a ${what}`, (w) => {
      w.update('board_item', itemId, { status })
    })
  }

  moveItems(moves: Array<{ itemId: string } & Position>): void {
    if (moves.length === 0) return
    const label = moves.length === 1 ? this.moveLabel(moves[0].itemId) : `Moved ${moves.length} items`
    const linked = this.boardSettings().linkPositions
    this.log.run(label, (w) => {
      for (const m of moves) {
        w.update('board_item', m.itemId, { x: m.x, y: m.y })
        if (linked) for (const twin of this.twins(m.itemId)) w.update('board_item', twin.id, { x: m.x, y: m.y })
      }
    })
  }

  /** Resizes a card, note or picture (null: back to the normal size). Linked boards resize the card everywhere. */
  resizeItem(itemId: string, size: { w: number; h: number } | null): void {
    const item = this.itemRow(itemId)
    const patch = size ? { w: Math.round(size.w), h: Math.round(size.h) } : { w: null, h: null }
    const label = size ? `Resized ${item.entityId ? this.nameOf(item.entityId) : `a ${item.kind === 'image' ? 'picture' : 'note'}`}` : 'Reset the size'
    this.log.run(label, (w) => {
      w.update('board_item', itemId, patch)
      if (this.boardSettings().linkPositions) for (const twin of this.twins(itemId)) w.update('board_item', twin.id, patch)
    })
  }

  /** The same card on the other boards. */
  private twins(itemId: string): BoardItemRow[] {
    const item = this.itemRow(itemId)
    if (item.kind !== 'card' || !item.entityId) return []
    return this.db.select().from(boardItem).where(and(eq(boardItem.entityId, item.entityId), eq(boardItem.kind, 'card'), eq(boardItem.status, 'active'))).all()
      .filter((i) => i.id !== itemId)
  }

  // ---- hiding, colours, act marks, string types, linked boards, pictures

  /** Hides (or shows again) a card on every board, a string, or a note or picture on its board. */
  setHidden(kind: 'entity' | 'string' | 'item', id: string, hidden: boolean): void {
    const verb = hidden ? 'Hid' : 'Unhid'
    if (kind === 'entity') {
      const e = this.entityRow(id)
      this.log.run(`${verb} ${e.name}`, (w) => { w.update('entity', id, { hidden }) })
    } else if (kind === 'string') {
      const r = this.relationshipRow(id)
      this.log.run(`${verb} string ${this.nameOf(r.sourceId)} – ${this.nameOf(r.targetId)}`, (w) => { w.update('relationship', id, { hidden }) })
    } else {
      const item = this.itemRow(id)
      if (item.kind === 'card' && item.entityId) return this.setHidden('entity', item.entityId, hidden)
      this.log.run(`${verb} a ${item.kind === 'image' ? 'picture' : 'note'}`, (w) => { w.update('board_item', id, { hidden }) })
    }
  }

  /** Marks a card as part of an act, or takes the mark off. The card joins the act's storyline if needed. */
  setActMark(entityId: string, actId: string, on: boolean): void {
    const e = this.entityRow(entityId)
    const a = this.actRow(actId)
    const existing = this.db.select().from(actEntity).where(and(eq(actEntity.entityId, entityId), eq(actEntity.actId, actId))).get()
    this.log.run(on ? `Put ${e.name} in act ${a.title}` : `Took ${e.name} out of act ${a.title}`, (w) => {
      if (existing) w.update('act_entity', existing.id, { status: on ? 'active' : 'defunct' })
      else if (on) w.insert('act_entity', { id: randomUUID(), actId, entityId, status: 'active' })
      if (on) {
        const b = this.db.select().from(board).where(eq(board.storylineId, a.storylineId)).get()
        const global = this.cardItems(this.globalBoard().id, entityId)[0]
        if (b) this.linkToStoryline(w, entityId, a.storylineId, b.id, global ? { x: global.x, y: global.y } : this.freeGlobalSpot())
      }
    })
  }

  /** Act marks per card: the act's number in its storyline (by planned start), like the Timeline. */
  private actMarks(entityIds: string[]): Map<string, CardActMark[]> {
    const out = new Map<string, CardActMark[]>()
    if (entityIds.length === 0) return out
    const links = this.db.select().from(actEntity).where(and(inArray(actEntity.entityId, entityIds), eq(actEntity.status, 'active'))).all()
    if (links.length === 0) return out
    const removed = new Set(this.db.select().from(storyline).where(eq(storyline.removed, true)).all().map((x) => x.id))
    const acts = this.db.select().from(act).where(eq(act.status, 'active')).all().filter((a) => !removed.has(a.storylineId))
    const number = new Map<string, number>()
    const byStory = new Map<string, ActRow[]>()
    for (const a of acts) byStory.set(a.storylineId, [...(byStory.get(a.storylineId) ?? []), a])
    for (const list of byStory.values()) list.sort((x, y) => x.startMin - y.startMin).forEach((a, i) => number.set(a.id, i + 1))
    const actById = new Map(acts.map((a) => [a.id, a]))
    for (const l of links) {
      const a = actById.get(l.actId)
      if (!a) continue
      out.set(l.entityId, [...(out.get(l.entityId) ?? []), { actId: a.id, storylineId: a.storylineId, number: number.get(a.id)!, title: a.title }])
    }
    for (const list of out.values()) list.sort((x, y) => x.storylineId.localeCompare(y.storylineId) || x.number - y.number)
    return out
  }

  /** The DM's own kinds of string (with an optional colour). */
  setStringTypes(types: StringType[]): void {
    this.setSetting('string_types', types, 'Changed the kinds of string')
  }

  /** Renames a kind of string everywhere: every string of that kind and the list (one undo step). */
  renameStringType(from: string, to: string): number {
    const rows = this.db.select().from(relationship).where(eq(relationship.type, from)).all()
    const types = this.boardSettings().stringTypes.map((t) => (t.type === from ? { ...t, type: to } : t))
    this.log.run(`Renamed string kind ${from} to ${to}`, (w) => {
      for (const r of rows) w.update('relationship', r.id, { type: to })
      if (w.get('campaign_settings', 'string_types')) w.update('campaign_settings', 'string_types', { value: types })
      else w.insert('campaign_settings', { key: 'string_types', value: types })
    })
    return rows.length
  }

  /**
   * Turns "moving a card moves it on every board" on or off. Turning it on lines the boards up:
   * `winner` global puts every card where the global board has it; storyline puts the global
   * card (and other storyline copies) where its storyline board has it.
   */
  setLinkPositions(on: boolean, winner: 'global' | 'storyline' = 'global'): void {
    this.log.run(on ? `Linked card positions across boards (${winner} layout kept)` : 'Unlinked card positions', (w) => {
      if (w.get('campaign_settings', 'link_positions')) w.update('campaign_settings', 'link_positions', { value: on })
      else w.insert('campaign_settings', { key: 'link_positions', value: on })
      if (!on) return
      const globalId = this.globalBoard().id
      const cards = this.db.select().from(boardItem).where(and(eq(boardItem.kind, 'card'), eq(boardItem.status, 'active'))).all()
      const byEntity = new Map<string, BoardItemRow[]>()
      for (const c of cards) if (c.entityId) byEntity.set(c.entityId, [...(byEntity.get(c.entityId) ?? []), c])
      for (const list of byEntity.values()) {
        if (list.length < 2) continue
        const source = winner === 'global'
          ? list.find((i) => i.boardId === globalId)
          : list.find((i) => i.boardId !== globalId)
        if (!source) continue
        for (const i of list) if (i.id !== source.id) w.update('board_item', i.id, { x: source.x, y: source.y, w: source.w, h: source.h })
      }
    })
  }

  /**
   * Strings on every board (on) or kept per board (off). Turning it off gives each board its own
   * copy of every string it shows. Turning it on keeps one set: `winner` global keeps the global
   * board's strings; storyline keeps the storyline boards' strings (and global ones between cards
   * on no storyline board together). One undo step.
   */
  setSharedStrings(on: boolean, winner: 'global' | 'storyline' = 'global'): void {
    const globalId = this.globalBoard().id
    const active = this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
    const items = this.db.select().from(boardItem).where(and(eq(boardItem.kind, 'card'), eq(boardItem.status, 'active'))).all()
    const onBoard = new Map<string, Set<string>>()
    for (const i of items) if (i.entityId) onBoard.set(i.boardId, (onBoard.get(i.boardId) ?? new Set()).add(i.entityId))
    const boardsWith = (a: string, b: string) => [...onBoard.entries()].filter(([, set]) => set.has(a) && set.has(b)).map(([id]) => id)
    this.log.run(on ? `Strings shared by every board again (${winner} strings kept)` : 'Strings kept per board', (w) => {
      if (w.get('campaign_settings', 'shared_strings')) w.update('campaign_settings', 'shared_strings', { value: on })
      else w.insert('campaign_settings', { key: 'shared_strings', value: on })
      if (!on) {
        for (const r of active.filter((x) => x.boardId === null)) {
          for (const boardId of boardsWith(r.sourceId, r.targetId)) {
            w.insert('relationship', { ...r, id: randomUUID(), boardId })
          }
          w.update('relationship', r.id, { status: 'defunct' })
        }
        return
      }
      const local = active.filter((x) => x.boardId !== null)
      const keep = (r: RelationshipRow) => winner === 'global'
        ? r.boardId === globalId
        : r.boardId !== globalId || boardsWith(r.sourceId, r.targetId).every((b) => b === globalId)
      const seen = new Set<string>()
      for (const r of local) {
        const key = `${r.sourceId}|${r.targetId}|${r.type}|${r.isSecret}`
        if (keep(r) && !seen.has(key)) { seen.add(key); w.update('relationship', r.id, { boardId: null }) }
        else w.update('relationship', r.id, { status: 'defunct' })
      }
    })
  }

  /** Puts a picture under the cards: a campaign map, or a picture file copied into the campaign. */
  addBoardImage(boardId: string, from: { mapId: string } | { file: string }, position: Position): BoardItemView {
    this.boardRow(boardId)
    let rel: string, name: string, size: { width: number; height: number } | null
    if ('mapId' in from) {
      const m = this.mapRow(from.mapId)
      rel = m.imagePath; name = m.name
      size = m.width && m.height ? { width: m.width, height: m.height } : null
    } else {
      const ext = extname(from.file).toLowerCase()
      if (!MAP_EXTENSIONS.includes(ext)) throw new Error(`Pictures must be PNG, JPEG, WebP or GIF images (got ${ext || 'no extension'})`)
      rel = `board/${randomUUID()}${ext}`
      mkdirSync(join(this.folder, ASSETS_DIR, 'board'), { recursive: true })
      copyFileSync(from.file, join(this.folder, ASSETS_DIR, rel))
      name = basename(from.file, ext)
      size = imageSize(readFileSync(join(this.folder, ASSETS_DIR, rel)))
    }
    // Starts 1200 px wide (keeping its shape); resize it on the board.
    const wPx = 1200
    const hPx = size ? Math.round((wPx * size.height) / size.width) : 800
    const id = randomUUID()
    this.log.run(`Put the picture ${name} on the board`, (w) => {
      w.insert('board_item', {
        id, boardId, kind: 'image', entityId: null, x: position.x, y: position.y, w: wPx, h: hPx,
        content: { image: rel, name, opacity: 0.6, locked: false }, status: 'active'
      })
    })
    return toItemView(this.itemRow(id))
  }

  updateBoardImage(itemId: string, patch: { opacity?: number; locked?: boolean; name?: string }): void {
    const item = this.itemRow(itemId)
    if (item.kind !== 'image') throw new Error('Not a picture')
    const content = { ...(item.content ?? {}), ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) }
    const label = patch.locked !== undefined ? (patch.locked ? 'Locked a picture' : 'Unlocked a picture') : patch.opacity !== undefined ? 'Changed a picture\'s opacity' : 'Renamed a picture'
    this.log.run(label, (w) => { w.update('board_item', itemId, { content }) })
  }

  createStoryline(title: string): BoardSummary {
    const storylineId = randomUUID()
    const boardId = randomUUID()
    this.log.run(`Added storyline ${title}`, (w) => {
      w.insert('storyline', {
        id: storylineId, title, isMajor: false, status: 'inactive', bbegEntityId: null, emblem: null, removed: false
      })
      w.insert('board', { id: boardId, name: title, storylineId })
    })
    return {
      id: boardId, name: title, storylineId,
      storyline: { title, status: 'inactive', isMajor: false, emblem: null, colour: null }
    }
  }

  updateStoryline(
    storylineId: string,
    patch: { title?: string; status?: StorylineStatus; isMajor?: boolean; emblem?: string | null; colour?: string | null }
  ): void {
    const s = this.storylineRow(storylineId)
    this.log.run(`Edited storyline ${patch.title ?? s.title}`, (w) => {
      w.update('storyline', storylineId, patch)
      if (patch.title !== undefined) {
        const b = this.db.select().from(board).where(eq(board.storylineId, storylineId)).get()
        if (b) w.update('board', b.id, { name: patch.title })
      }
    })
  }

  /** Moves a storyline (and its board view) to History, or brings it back. Its cards stay on the global board. */
  setStorylineRemoved(storylineId: string, removed: boolean): void {
    const s = this.storylineRow(storylineId)
    this.log.run(removed ? `Moved storyline ${s.title} to History` : `Restored storyline ${s.title}`, (w) => {
      w.update('storyline', storylineId, { removed })
    })
  }

  private storylineRow(id: string) {
    const row = this.db.select().from(storyline).where(eq(storyline.id, id)).get()
    if (!row) throw new Error(`No storyline with id ${id}`)
    return row
  }

  /** A free spot on the global board near its top-left area, for cards added from outside the board. */
  freeGlobalSpot(): Position {
    const items = this.db.select().from(boardItem)
      .where(and(eq(boardItem.boardId, this.globalBoard().id), eq(boardItem.status, 'active'))).all()
    return freeSpot({ x: 0, y: 0 }, items)
  }

  // ---- entity sheet ------------------------------------------------------------

  sheet(entityId: string): SheetView {
    const view = this.entityView(entityId)
    const abilities = this.db.select().from(ability)
      .where(and(eq(ability.entityId, entityId), eq(ability.status, 'active')))
      .orderBy(asc(ability.sort)).all().map(toAbilityView)
    const rels = this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
      .filter((r) => r.sourceId === entityId || r.targetId === entityId)
    const briefs = new Map(this.db.select({ id: entity.id, type: entity.type, name: entity.name, status: entity.status })
      .from(entity).all().map((e) => [e.id, e as EntityBrief]))
    const knownRels = new Set(this.db.select().from(relationshipKnown)
      .where(eq(relationshipKnown.status, 'active')).all().map((k) => k.relationshipId))
    const connections = rels.flatMap((r) => {
      const outgoing = r.sourceId === entityId
      const other = briefs.get(outgoing ? r.targetId : r.sourceId)
      if (!other || other.status === 'defunct') return []
      return [{ relationship: toRelationshipView(r), other, outgoing, partyKnows: knownRels.has(r.id) }]
    }).sort((a, b) => a.other.name.localeCompare(b.other.name))
    const known = new Set(this.db.select().from(knowledge)
      .where(and(eq(knowledge.entityId, entityId), eq(knowledge.status, 'active'))).all().map((k) => k.field))
    const partyKnows = Object.fromEntries(KNOWLEDGE_FIELDS.map((f) => [f, known.has(f)])) as Record<KnowledgeField, boolean>
    const others = [...briefs.values()]
      .filter((e) => e.id !== entityId && e.status !== 'defunct')
      .sort((a, b) => a.name.localeCompare(b.name))
    return { entity: view, abilities, connections, partyKnows, others, undo: this.log.state() }
  }

  addAbility(entityId: string, a: NewAbility): AbilityView {
    const e = this.entityRow(entityId)
    const next = this.db.select().from(ability).where(eq(ability.entityId, entityId)).all()
      .reduce((m, r) => Math.max(m, r.sort + 1), 0)
    let id = ''
    this.log.run(`Added ${a.name} to ${e.name}`, (w) => { id = this.insertAbility(w, entityId, a, next) })
    return toAbilityView(this.abilityRow(id))
  }

  /** Several attacks or spells at once (from the SRD picker): one undo step. */
  addAbilities(entityId: string, list: NewAbility[]): number {
    const e = this.entityRow(entityId)
    const next = this.db.select().from(ability).where(eq(ability.entityId, entityId)).all()
      .reduce((m, r) => Math.max(m, r.sort + 1), 0)
    this.log.run(list.length === 1 ? `Added ${list[0].name} to ${e.name}` : `Added ${list.length} attacks and spells to ${e.name}`, (w) => {
      list.forEach((a, i) => this.insertAbility(w, entityId, a, next + i))
    })
    return list.length
  }

  updateAbility(id: string, patch: Partial<Omit<AbilityView, 'id'>>): void {
    const a = this.abilityRow(id)
    this.log.run(`Edited ${patch.name ?? a.name} on ${this.nameOf(a.entityId)}`, (w) => {
      w.update('ability', id, patch)
    })
  }

  setAbilityStatus(id: string, status: RowStatus): void {
    const a = this.abilityRow(id)
    const verb = status === 'defunct' ? 'Removed' : 'Restored'
    this.log.run(`${verb} ${a.name} on ${this.nameOf(a.entityId)}`, (w) => { w.update('ability', id, { status }) })
  }

  setPartyKnows(entityId: string, field: KnowledgeField, known: boolean): void {
    const e = this.entityRow(entityId)
    const existing = this.db.select().from(knowledge)
      .where(and(eq(knowledge.entityId, entityId), eq(knowledge.field, field))).get()
    const label = known ? `Party learns ${e.name}: ${field}` : `Party no longer knows ${e.name}: ${field}`
    this.log.run(label, (w) => {
      const status = known ? 'active' : 'defunct'
      if (existing) w.update('knowledge', existing.id, { status, ...(known ? { knownFromMin: this.info().clockMin } : {}) })
      else if (known) {
        w.insert('knowledge', { id: randomUUID(), entityId, field, knownFromMin: this.info().clockMin, status })
      }
    })
  }

  setStringKnown(relationshipId: string, known: boolean): void {
    const r = this.relationshipRow(relationshipId)
    const existing = this.db.select().from(relationshipKnown)
      .where(eq(relationshipKnown.relationshipId, relationshipId)).get()
    const names = `${this.nameOf(r.sourceId)} – ${this.nameOf(r.targetId)}`
    this.log.run(known ? `Party learns of the link ${names}` : `Party no longer knows the link ${names}`, (w) => {
      const status = known ? 'active' : 'defunct'
      if (existing) w.update('relationship_known', existing.id, { status, ...(known ? { knownFromMin: this.info().clockMin } : {}) })
      else if (known) {
        w.insert('relationship_known', { id: randomUUID(), relationshipId, knownFromMin: this.info().clockMin, status })
      }
    })
  }

  /** Copies an entity (fields, tags and abilities, not strings) and puts the copy beside it on the global board. */
  duplicateEntity(id: string): EntityView {
    const e = this.entityRow(id)
    const g = this.globalBoard()
    const card = this.cardItems(g.id, id)[0]
    const abilities = this.db.select().from(ability)
      .where(and(eq(ability.entityId, id), eq(ability.status, 'active'))).orderBy(asc(ability.sort)).all()
    return this.createEntity({
      boardId: g.id,
      type: e.type as EntityType,
      name: `${e.name} (copy)`,
      position: card ? { x: card.x + 40, y: card.y + 40 } : { x: 0, y: 0 },
      attributes: structuredClone(e.attributes),
      tags: [...e.tags],
      abilities: abilities.map((a) => ({
        name: a.name, kind: a.kind as AbilityKind, description: a.description, macroText: a.macroText,
        showTokenAction: a.showTokenAction, showMacroBar: a.showMacroBar
      })),
      label: `Duplicated ${e.name}`
    })
  }

  // ---- library search -----------------------------------------------------------

  search(filters: LibraryFilters): LibrarySearch {
    const rows = this.db.select().from(entity).all().filter((r) => r.status === 'active' || r.status === 'resolved' || r.status === 'stashed')
    const views = this.entityViews(rows.map((r) => r.id))
    const q = filters.query.trim().toLowerCase()
    const tags = [...new Set(views.flatMap((v) => v.tags))].sort((a, b) => a.localeCompare(b))
    const abilityNames = new Map<string, string[]>()
    for (const a of this.db.select().from(ability).where(eq(ability.status, 'active')).all()) {
      abilityNames.set(a.entityId, [...(abilityNames.get(a.entityId) ?? []), a.name])
    }
    const results = views.flatMap((v) => {
      const sb = HAS_STATBLOCK.has(v.type) ? readStatBlock(v.attributes.statblock) : null
      if (filters.type && v.type !== filters.type) return []
      if (filters.tag && !v.tags.includes(filters.tag)) return []
      const cr = sb ? crToNumber(sb.cr) : null
      const hp = sb ? leadingNumber(sb.hp) : null
      if (filters.crMin != null && (cr == null || cr < filters.crMin)) return []
      if (filters.crMax != null && (cr == null || cr > filters.crMax)) return []
      if (filters.hpMin != null && (hp == null || hp < filters.hpMin)) return []
      if (filters.hpMax != null && (hp == null || hp > filters.hpMax)) return []
      if (q && !`${searchText(v)} ${(abilityNames.get(v.id) ?? []).join(' ').toLowerCase()}`.includes(q)) return []
      const summary = typeof v.attributes.summary === 'string' ? v.attributes.summary : ''
      const location = typeof v.attributes.location === 'string' ? v.attributes.location : ''
      const line = [summary || (sb ? statLine(sb) : ''), location].filter(Boolean).join(' · ')
      return [{ entity: v, line }]
    }).sort((a, b) => a.entity.name.localeCompare(b.entity.name))
    return { results, tags }
  }

  // ---- desk, maps and settings ----------------------------------------------

  private setting(key: string): unknown {
    return this.db.select().from(campaignSetting).where(eq(campaignSetting.key, key)).get()?.value
  }

  /** Changes one campaign setting as an undoable step. */
  setSetting(key: SettingKey, value: unknown, label: string): void {
    this.setSettings({ [key]: value }, label)
  }

  /** Changes several campaign settings as one undoable step. */
  setSettings(values: Partial<Record<SettingKey, unknown>>, label: string): void {
    this.log.run(label, (w) => {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue
        if (w.get('campaign_settings', key)) w.update('campaign_settings', key, { value })
        else w.insert('campaign_settings', { key, value })
      }
    })
  }

  /** Sets the campaign clock to an exact minute (never before minute 0). */
  setClock(minutes: number): void {
    const next = Math.max(0, Math.round(minutes))
    this.setSetting('clock_min', next, `Set the clock to ${formatClock(next)}`)
  }

  renameMap(mapId: string, name: string): void {
    const m = this.mapRow(mapId)
    this.log.run(`Renamed map ${m.name} to ${name}`, (w) => { w.update('map', mapId, { name }) })
  }

  setMapStatus(mapId: string, status: RowStatus): void {
    const m = this.mapRow(mapId)
    this.log.run(status === 'defunct' ? `Moved map ${m.name} to History` : `Restored map ${m.name}`, (w) => {
      w.update('map', mapId, { status })
    })
  }

  private mapRow(id: string): MapRow {
    const row = this.db.select().from(map).where(eq(map.id, id)).get()
    if (!row) throw new Error(`No map with id ${id}`)
    return row
  }

  /** Moves the campaign clock by a number of minutes (never before minute 0). */
  shiftClock(minutes: number): number {
    const now = this.info().clockMin
    const next = Math.max(0, now + Math.round(minutes))
    if (next !== now) {
      const h = Math.abs(next - now) / 60
      this.setSetting('clock_min', next, `${next > now ? 'Moved the clock forward' : 'Moved the clock back'} ${h} h`)
    }
    return next
  }

  /**
   * Copies an image into assets/maps. A world map becomes the desk map; a battle map
   * gets a square grid (`gridCols` squares across). One undo step.
   */
  importMap(sourceFile: string, name?: string, battle?: { gridCols: number }): MapView {
    const ext = extname(sourceFile).toLowerCase()
    if (!MAP_EXTENSIONS.includes(ext)) throw new Error(`Maps must be PNG, JPEG, WebP or GIF images (got ${ext || 'no extension'})`)
    const id = randomUUID()
    const rel = `maps/${id}${ext}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'maps'), { recursive: true })
    copyFileSync(sourceFile, join(this.folder, ASSETS_DIR, rel))
    const size = imageSize(readFileSync(join(this.folder, ASSETS_DIR, rel)))
    const mapName = name?.trim() || basename(sourceFile, extname(sourceFile))
    this.log.run(`Imported ${battle ? 'battle ' : ''}map ${mapName}`, (w) => {
      w.insert('map', {
        id, name: mapName, imagePath: rel, width: size?.width ?? null, height: size?.height ?? null,
        gridSize: null, status: 'active', ...(battle ? { kind: 'battle', gridCols: battle.gridCols } : {})
      })
      if (battle) return
      if (w.get('campaign_settings', 'active_map_id')) w.update('campaign_settings', 'active_map_id', { value: id })
      else w.insert('campaign_settings', { key: 'active_map_id', value: id })
    })
    return toMapView(this.db.select().from(map).where(eq(map.id, id)).get()!)
  }

  maps(): MapView[] {
    return this.db.select().from(map).where(eq(map.status, 'active')).all().map(toMapView)
  }

  /** Resolves an asset address path (for example "maps/x.png") to a file inside this campaign's assets folder. */
  assetFile(relPath: string): string | null {
    const clean = relPath.replace(/\\/g, '/')
    if (clean.split('/').some((part) => part === '..' || part === '') || clean.includes(':')) return null
    const file = join(this.folder, ASSETS_DIR, ...clean.split('/'))
    return existsSync(file) ? file : null
  }

  desk(): DeskView {
    const storylines = this.db
      .select({
        boardId: board.id, storylineId: storyline.id, title: storyline.title, status: storyline.status,
        isMajor: storyline.isMajor, emblem: storyline.emblem, colour: storyline.colour, removed: storyline.removed
      })
      .from(board).innerJoin(storyline, eq(board.storylineId, storyline.id)).all()
      .filter((s) => !s.removed)
    const cardCounts = new Map<string, number>()
    for (const item of this.db.select().from(boardItem).where(and(eq(boardItem.kind, 'card'), eq(boardItem.status, 'active'))).all()) {
      cardCounts.set(item.boardId, (cardCounts.get(item.boardId) ?? 0) + 1)
    }
    const entities = this.db.select().from(entity).all()
    const party = entities.filter((e) => e.type === 'PC' && (e.status === 'active' || e.status === 'resolved'))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((e) => {
        const sb = readStatBlock(e.attributes.statblock)
        const a = e.attributes
        const maxHp = sb ? leadingNumber(sb.hp) : null
        return {
          id: e.id, name: e.name,
          summary: typeof a.summary === 'string' ? a.summary : '',
          ac: sb?.ac ? String(leadingNumber(sb.ac) ?? sb.ac) : '',
          hp: sb?.hp ? String(leadingNumber(sb.hp) ?? sb.hp) : '',
          passivePerception: sb ? passiveScore(sb, 'Perception') : null,
          colour: typeof a.colour === 'string' ? a.colour : null,
          currentHp: typeof a.current_hp === 'number' ? a.current_hp : maxHp,
          maxHp,
          tempHp: typeof a.temp_hp === 'number' ? a.temp_hp : 0,
          size: sb?.size ?? '',
          resistances: [sb?.resistances && `resists ${sb.resistances}`, sb?.immunities && `immune ${sb.immunities}`].filter(Boolean).join('; '),
          conditions: typeof a.conditions === 'string' ? a.conditions : '',
          picture: typeof a.picture === 'string' ? a.picture : null
        }
      })
    const maps = this.maps()
    const activeId = this.setting('active_map_id')
    const visible = new Set(entities.filter((e) => e.status === 'active' || e.status === 'resolved').map((e) => e.id))
    const strings = this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
      .filter((r) => visible.has(r.sourceId) && visible.has(r.targetId)).length
    return {
      storylines: storylines.map(({ removed: _removed, ...s }) => ({
        ...s, status: s.status as StorylineStatus, cardCount: cardCounts.get(s.boardId) ?? 0
      })),
      party,
      map: maps.find((m) => m.id === activeId) ?? maps[0] ?? null,
      maps,
      dmNotes: this.openSession()?.dmNotes ?? String(this.setting('dm_notes') ?? ''),
      dmNotesSession: this.openSession()?.number ?? null,
      moonOffsetDays: Number(this.setting('moon_offset_days') ?? 0),
      counts: { cards: visible.size, strings, removed: entities.filter((e) => e.status === 'defunct').length }
    }
  }

  // ---- timeline: acts, outcomes, triggers ------------------------------------

  private timelineRows() {
    const stories = this.db.select().from(storyline).where(eq(storyline.removed, false)).all()
    const storyIds = new Set(stories.map((s) => s.id))
    const acts = this.db.select().from(act).where(eq(act.status, 'active')).all().filter((a) => storyIds.has(a.storylineId))
    const actIds = new Set(acts.map((a) => a.id))
    const outcomes = this.db.select().from(actOutcome).where(eq(actOutcome.status, 'active')).orderBy(asc(actOutcome.sort)).all()
      .filter((o) => actIds.has(o.actId))
    const outcomeIds = new Set(outcomes.map((o) => o.id))
    const triggers = this.db.select().from(storyTrigger).orderBy(asc(storyTrigger.createdAt)).all()
    return { stories, acts, outcomes, outcomeIds, actIds, storyIds, triggers }
  }

  private engineInput(rows: ReturnType<Campaign['timelineRows']>, nowMin: number): TimelineInput {
    return {
      nowMin,
      storylines: rows.stories.map((s) => ({ id: s.id, status: s.status as StorylineStatus })),
      acts: rows.acts.map((a, i) => ({
        id: a.id, storylineId: a.storylineId, number: i, startMin: a.startMin, endMin: a.endMin,
        chosenOutcomeId: a.chosenOutcomeId && rows.outcomeIds.has(a.chosenOutcomeId) ? a.chosenOutcomeId : null
      })),
      outcomes: rows.outcomes.map((o) => ({ id: o.id, actId: o.actId, isDefault: o.isDefault })),
      triggers: rows.triggers
        .filter((t) => t.status === 'active' && rows.actIds.has(t.sourceActId) && rows.storyIds.has(t.targetStorylineId))
        .map((t) => ({
          id: t.id, sourceActId: t.sourceActId, outcomeId: t.outcomeId, targetStorylineId: t.targetStorylineId,
          effect: toEffect(t)
        }))
    }
  }

  timeline(): TimelineView {
    const nowMin = this.info().clockMin
    const rows = this.timelineRows()
    const projection = projectTimeline(this.engineInput(rows, nowMin))
    const boardOf = new Map(this.db.select().from(board).all().map((b) => [b.storylineId, b.id]))
    const actNumber = new Map<string, number>()
    for (const s of rows.stories) {
      rows.acts.filter((a) => a.storylineId === s.id).sort((a, b) => a.startMin - b.startMin)
        .forEach((a, i) => actNumber.set(a.id, i + 1))
    }
    const fired = new Map(projection.fired.map((f) => [f.triggerId, f.atMin]))
    const names = new Map(this.db.select({ id: entity.id, name: entity.name, status: entity.status }).from(entity).all()
      .filter((e) => e.status !== 'defunct').map((e) => [e.id, e.name]))
    const actCards = new Map<string, Array<{ id: string; name: string }>>()
    for (const l of this.db.select().from(actEntity).where(eq(actEntity.status, 'active')).all()) {
      const name = names.get(l.entityId)
      if (name) actCards.set(l.actId, [...(actCards.get(l.actId) ?? []), { id: l.entityId, name }])
    }
    // Labels follow creation order over every trigger ever made, so they never renumber.
    const labels = new Map(rows.triggers.map((t, i) => [t.id, `T${i + 1}`]))
    return {
      nowMin,
      moonOffsetDays: Number(this.setting('moon_offset_days') ?? 0),
      storylines: rows.stories.map((s) => ({
        storylineId: s.id, boardId: boardOf.get(s.id) ?? '', title: s.title, status: s.status as StorylineStatus,
        projectedStatus: projection.storylineStatus.get(s.id) ?? (s.status as StorylineStatus),
        isMajor: s.isMajor, emblem: s.emblem, colour: s.colour
      })),
      acts: rows.acts.map((a) => {
        const p = projection.acts.get(a.id)!
        return {
          id: a.id, storylineId: a.storylineId, number: actNumber.get(a.id) ?? 0, title: a.title, summary: a.summary,
          plannedStartMin: a.startMin, plannedEndMin: a.endMin, startMin: p.startMin, endMin: p.endMin,
          shiftedBy: p.shiftedBy, chosenOutcomeId: a.chosenOutcomeId, state: p.state, outcomeId: p.outcomeId,
          resolvedBy: p.resolvedBy, forcedOutcomeId: p.forcedOutcomeId, defaultOutcomeId: p.defaultOutcomeId,
          outcomes: rows.outcomes.filter((o) => o.actId === a.id).map(toOutcomeView),
          cards: actCards.get(a.id) ?? []
        }
      }).sort((a, b) => a.startMin - b.startMin),
      triggers: rows.triggers
        .filter((t) => t.status === 'active' && rows.actIds.has(t.sourceActId))
        .map((t) => ({
          id: t.id, label: labels.get(t.id)!, sourceActId: t.sourceActId, outcomeId: t.outcomeId,
          targetStorylineId: t.targetStorylineId, effect: toEffect(t) as TriggerEffectView, note: t.note,
          firedAtMin: fired.get(t.id) ?? null
        }))
    }
  }

  createAct(input: { storylineId: string; title: string; startMin: number; endMin: number }): string {
    const s = this.storylineRow(input.storylineId)
    checkSpan(input.startMin, input.endMin)
    const id = randomUUID()
    this.log.run(`Added act ${input.title} to ${s.title}`, (w) => {
      w.insert('act', {
        id, storylineId: s.id, title: input.title, summary: '', startMin: input.startMin, endMin: input.endMin,
        chosenOutcomeId: null, status: 'active'
      })
      // Every act starts with the outcome that happens if nobody intervenes.
      w.insert('act_outcome', {
        id: randomUUID(), actId: id, label: 'If nobody intervenes', description: '', isDefault: true, sort: 0, status: 'active'
      })
    })
    return id
  }

  updateAct(id: string, patch: { title?: string; summary?: string; startMin?: number; endMin?: number }): void {
    const a = this.actRow(id)
    checkSpan(patch.startMin ?? a.startMin, patch.endMin ?? a.endMin)
    this.log.run(`Edited act ${patch.title ?? a.title}`, (w) => { w.update('act', id, patch) })
  }

  setActStatus(id: string, status: RowStatus): void {
    const a = this.actRow(id)
    this.log.run(status === 'defunct' ? `Moved act ${a.title} to History` : `Restored act ${a.title}`, (w) => {
      w.update('act', id, { status })
    })
  }

  /** The DM records what happened in an act (null clears it). This is the approval step for outcomes. */
  chooseOutcome(actId: string, outcomeId: string | null): void {
    const a = this.actRow(actId)
    const o = outcomeId ? this.outcomeRow(outcomeId) : null
    if (o && o.actId !== actId) throw new Error('That outcome belongs to another act')
    this.log.run(o ? `${a.title} ended: ${o.label}` : `Cleared the outcome of ${a.title}`, (w) => {
      w.update('act', actId, { chosenOutcomeId: outcomeId })
    })
  }

  addOutcome(actId: string, label: string): string {
    const a = this.actRow(actId)
    const sort = this.db.select().from(actOutcome).where(eq(actOutcome.actId, actId)).all().reduce((m, o) => Math.max(m, o.sort + 1), 0)
    const id = randomUUID()
    this.log.run(`Added outcome ${label} to ${a.title}`, (w) => {
      w.insert('act_outcome', { id, actId, label, description: '', isDefault: false, sort, status: 'active' })
    })
    return id
  }

  /** Edits an outcome. Making it the default takes the default away from the act's other outcomes. */
  updateOutcome(id: string, patch: { label?: string; description?: string; isDefault?: boolean }): void {
    const o = this.outcomeRow(id)
    this.log.run(`Edited outcome ${patch.label ?? o.label}`, (w) => {
      if (patch.isDefault) {
        for (const other of this.db.select().from(actOutcome).where(eq(actOutcome.actId, o.actId)).all()) {
          if (other.id !== id && other.isDefault) w.update('act_outcome', other.id, { isDefault: false })
        }
      }
      w.update('act_outcome', id, patch)
    })
  }

  setOutcomeStatus(id: string, status: RowStatus): void {
    const o = this.outcomeRow(id)
    this.log.run(status === 'defunct' ? `Removed outcome ${o.label}` : `Restored outcome ${o.label}`, (w) => {
      w.update('act_outcome', id, { status })
      const a = this.actRow(o.actId)
      if (status === 'defunct' && a.chosenOutcomeId === id) w.update('act', a.id, { chosenOutcomeId: null })
    })
  }

  addTrigger(input: { sourceActId: string; outcomeId: string; targetStorylineId: string; effect: TriggerEffectView; note?: string }): string {
    const a = this.actRow(input.sourceActId)
    const o = this.outcomeRow(input.outcomeId)
    if (o.actId !== a.id) throw new Error('That outcome belongs to another act')
    this.storylineRow(input.targetStorylineId)
    const id = randomUUID()
    const { type, ...payload } = input.effect
    this.log.run(`Added a trigger from ${a.title}`, (w) => {
      w.insert('story_trigger', {
        id, sourceActId: a.id, outcomeId: o.id, targetStorylineId: input.targetStorylineId, effectType: type,
        payload, note: input.note ?? '', createdAt: new Date().toISOString(), status: 'active'
      })
    })
    return id
  }

  updateTrigger(id: string, patch: { outcomeId?: string; targetStorylineId?: string; effect?: TriggerEffectView; note?: string }): void {
    const t = this.triggerRow(id)
    if (patch.outcomeId && this.outcomeRow(patch.outcomeId).actId !== t.sourceActId) throw new Error('That outcome belongs to another act')
    if (patch.targetStorylineId) this.storylineRow(patch.targetStorylineId)
    this.log.run('Edited a trigger', (w) => {
      const { effect, ...rest } = patch
      w.update('story_trigger', id, {
        ...rest,
        ...(effect ? { effectType: effect.type, payload: (({ type: _t, ...p }) => p)(effect) } : {})
      })
    })
  }

  setTriggerStatus(id: string, status: RowStatus): void {
    this.triggerRow(id)
    this.log.run(status === 'defunct' ? 'Removed a trigger' : 'Restored a trigger', (w) => { w.update('story_trigger', id, { status }) })
  }

  /** What would change if this act ended with that outcome. Nothing is saved. */
  whatIf(actId: string, outcomeId: string): WhatIfView {
    const view = this.timeline()
    const rows = this.timelineRows()
    const diff = whatIf(this.engineInput(rows, view.nowMin), actId, outcomeId)
    const acts = new Map(view.acts.map((a) => [a.id, a]))
    const titles = new Map(view.storylines.map((s) => [s.storylineId, s.title]))
    const outcomeLabel = new Map(view.acts.flatMap((a) => a.outcomes.map((o) => [o.id, o.label] as const)))
    const name = (id: string) => { const a = acts.get(id)!; return `${titles.get(a.storylineId)} · Act ${a.number} (${a.title})` }
    const lines = diff.acts.map((c) => {
      if (c.field === 'outcomeId') {
        return `${name(c.actId)}: ends "${c.after ? outcomeLabel.get(c.after as string) : 'with no outcome yet'}" instead of "${c.before ? outcomeLabel.get(c.before as string) : 'no outcome yet'}"`
      }
      if (c.field === 'startMin') return `${name(c.actId)}: starts ${formatClock(c.after as number)} instead of ${formatClock(c.before as number)}`
      if (c.field === 'endMin') return `${name(c.actId)}: ends ${formatClock(c.after as number)} instead of ${formatClock(c.before as number)}`
      const word = (st: unknown) => ({ upcoming: 'not started', running: 'in progress', resolved: 'over', awaiting: 'waiting for your outcome' } as Record<string, string>)[String(st)] ?? String(st)
      return `${name(c.actId)}: ${word(c.after)} instead of ${word(c.before)}`
    })
    const status = (st: string) => ({ inactive: 'not started', autonomous: 'running on its own', player_active: 'players active', concluded: 'concluded' } as Record<string, string>)[st] ?? st
    for (const s of diff.storylines) lines.push(`${titles.get(s.storylineId)}: ${status(s.after)} instead of ${status(s.before)}`)
    return { actId, outcomeId, lines }
  }

  private removedTimeline(): Pick<HistoryView, 'removedActs' | 'removedOutcomes' | 'removedTriggers'> {
    const acts = this.db.select().from(act).all()
    const actTitle = new Map(acts.map((a) => [a.id, a.title]))
    const storyTitle = new Map(this.db.select().from(storyline).all().map((s) => [s.id, s.title]))
    const triggers = this.db.select().from(storyTrigger).orderBy(asc(storyTrigger.createdAt)).all()
    return {
      removedActs: acts.filter((a) => a.status === 'defunct')
        .map((a) => ({ id: a.id, title: a.title, storylineTitle: storyTitle.get(a.storylineId) ?? '?' })),
      removedOutcomes: this.db.select().from(actOutcome).where(eq(actOutcome.status, 'defunct')).all()
        .map((o) => ({ id: o.id, label: o.label, actTitle: actTitle.get(o.actId) ?? '?' })),
      removedTriggers: triggers.flatMap((t, i) => t.status === 'defunct'
        ? [{ id: t.id, label: `T${i + 1}`, actTitle: actTitle.get(t.sourceActId) ?? '?' }] : [])
    }
  }

  private actRow(id: string): ActRow {
    const row = this.db.select().from(act).where(eq(act.id, id)).get()
    if (!row) throw new Error(`No act with id ${id}`)
    return row
  }

  private outcomeRow(id: string): OutcomeRow {
    const row = this.db.select().from(actOutcome).where(eq(actOutcome.id, id)).get()
    if (!row) throw new Error(`No outcome with id ${id}`)
    return row
  }

  private triggerRow(id: string): TriggerRow {
    const row = this.db.select().from(storyTrigger).where(eq(storyTrigger.id, id)).get()
    if (!row) throw new Error(`No trigger with id ${id}`)
    return row
  }

  // ---- live session ----------------------------------------------------------

  private openSession(): SessionRow | null {
    return this.db.select().from(session).where(eq(session.status, 'active')).all().find((x) => x.endedAt === null) ?? null
  }

  live(): LiveView {
    const nowMin = this.info().clockMin
    const sessions = this.db.select().from(session).where(eq(session.status, 'active')).orderBy(asc(session.number)).all()
    const open = sessions.find((x) => x.endedAt === null) ?? null
    const names = new Map(this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name]))
    const log = open
      ? this.db.select().from(logEntry).where(and(eq(logEntry.sessionId, open.id), eq(logEntry.status, 'active'))).all()
        .sort((a, b) => b.atMin - a.atMin || b.createdAt.localeCompare(a.createdAt))
        .map((l) => toLogView(l, names))
      : []
    // The day tally counts the whole campaign day, whichever session it was logged in.
    const dayStart = Math.floor(nowMin / MINUTES_PER_DAY) * MINUTES_PER_DAY
    const todayRows = this.db.select().from(logEntry).where(eq(logEntry.status, 'active')).all()
      .filter((l) => l.atMin >= dayStart && l.atMin < dayStart + MINUTES_PER_DAY)
    const count = (k: LogKind) => todayRows.filter((l) => l.kind === k).length
    const party = this.partyHealth()
    const hp = party.reduce((n, p) => n + p.hp, 0)
    const maxHp = party.reduce((n, p) => n + p.maxHp, 0)
    const percent = maxHp > 0 ? Math.round((hp / maxHp) * 100) : null
    const lastLongRest = this.setting('last_long_rest_min')
    const tl = this.timeline()
    const playerStories = new Set(tl.storylines.filter((x) => x.projectedStatus === 'player_active').map((x) => x.storylineId))
    const storyTitle = new Map(tl.storylines.map((x) => [x.storylineId, x.title]))
    const fights = count('fight')
    return {
      nowMin,
      session: open ? toSessionView(open) : null,
      sessions: sessions.map(toSessionView),
      log,
      today: { fights, meetings: count('meeting'), quests: count('quest') },
      party,
      health: { hp, maxHp, percent },
      advisor: advise({
        nowMin, fightsToday: fights, healthPercent: percent,
        lastLongRestMin: typeof lastLongRest === 'number' ? lastLongRest : null,
        sessionStartMin: open?.startMin ?? null,
        acts: tl.acts.filter((a) => playerStories.has(a.storylineId) && a.state !== 'resolved')
          .map((a) => ({ title: `${storyTitle.get(a.storylineId)} · Act ${a.number} (${a.title})`, endMin: a.endMin, awaiting: a.state === 'awaiting' }))
      }),
      partyLevel: Number(this.setting('party_level') ?? 1),
      map: this.desk().map,
      people: this.db.select({ id: entity.id, type: entity.type, name: entity.name, status: entity.status }).from(entity).all()
        .filter((e) => e.status === 'active' && ['NPC', 'MONSTER', 'FACTION'].includes(e.type))
        .map((e) => ({ ...e, type: e.type as EntityType, status: e.status as EntityStatus }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      lastLongRestMin: typeof lastLongRest === 'number' ? lastLongRest : null
    }
  }

  private partyHealth() {
    return this.db.select().from(entity).all()
      .filter((e) => e.type === 'PC' && e.status === 'active')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((e) => {
        const sb = readStatBlock(e.attributes.statblock)
        const maxHp = sb ? leadingNumber(sb.hp) ?? 0 : 0
        const cur = typeof e.attributes.current_hp === 'number' ? e.attributes.current_hp : maxHp
        return {
          id: e.id, name: e.name, hp: cur, maxHp, ac: sb?.ac ? String(leadingNumber(sb.ac) ?? sb.ac) : '',
          colour: typeof e.attributes.colour === 'string' ? e.attributes.colour : null,
          tempHp: typeof e.attributes.temp_hp === 'number' ? e.attributes.temp_hp : 0,
          conditions: typeof e.attributes.conditions === 'string' ? e.attributes.conditions : ''
        }
      })
  }

  startSession(): SessionView {
    if (this.openSession()) throw new Error('A session is already running. End it first.')
    const number = this.db.select().from(session).all().reduce((n, x) => Math.max(n, x.number), 0) + 1
    const id = randomUUID()
    const startMin = this.info().clockMin
    this.log.run(`Started session ${number}`, (w) => {
      w.insert('session', {
        id, number, startedAt: new Date().toISOString(), endedAt: null, startMin, endMin: null, sceneText: '', recap: '', status: 'active'
      })
    })
    return toSessionView(this.sessionRow(id))
  }

  endSession(id: string): void {
    const sRow = this.sessionRow(id)
    this.log.run(`Ended session ${sRow.number}`, (w) => {
      w.update('session', id, { endedAt: new Date().toISOString(), endMin: this.info().clockMin })
    })
  }

  updateSession(id: string, patch: { number?: number; sceneText?: string; recap?: string; playerRecap?: string }): void {
    const sRow = this.sessionRow(id)
    this.log.run(`Edited session ${patch.number ?? sRow.number}`, (w) => { w.update('session', id, patch) })
  }

  setSessionStatus(id: string, status: RowStatus): void {
    const sRow = this.sessionRow(id)
    this.log.run(status === 'defunct' ? `Moved session ${sRow.number} to History` : `Restored session ${sRow.number}`, (w) => {
      w.update('session', id, { status })
    })
  }

  /** Logs something that happened now; time taken moves the clock on, all as one step. */
  addLog(input: { kind: LogKind; text: string; entityId?: string | null; minutesTaken?: number; encounterId?: string | null }): LogView {
    const open = this.openSession()
    if (!open) throw new Error('Start a session first')
    const minutes = Math.max(0, Math.round(input.minutesTaken ?? 0))
    const now = this.info().clockMin
    const id = randomUUID()
    const label = input.kind === 'note' ? 'Logged a note' : `Logged ${input.kind === 'meeting' ? 'a meeting' : input.kind === 'fight' ? 'a fight' : input.kind === 'quest' ? 'a delivered quest' : input.kind}`
    this.log.run(label, (w) => {
      w.insert('log_entry', {
        id, sessionId: open.id, atMin: now, kind: input.kind, text: input.text, entityId: input.entityId ?? null,
        minutesTaken: minutes, createdAt: new Date().toISOString(), status: 'active', encounterId: input.encounterId ?? null
      })
      if (minutes > 0) w.update('campaign_settings', 'clock_min', { value: now + minutes })
    })
    const names = new Map(this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name]))
    return toLogView(this.logRow(id), names)
  }

  updateLog(id: string, patch: { text?: string; kind?: LogKind; atMin?: number; entityId?: string | null }): void {
    this.logRow(id)
    this.log.run('Edited a log entry', (w) => { w.update('log_entry', id, patch) })
  }

  setLogStatus(id: string, status: RowStatus): void {
    this.logRow(id)
    this.log.run(status === 'defunct' ? 'Removed a log entry' : 'Restored a log entry', (w) => { w.update('log_entry', id, { status }) })
  }

  /** Sets a player character's current hit points (never below 0). */
  setHp(entityId: string, hp: number): void {
    const e = this.entityRow(entityId)
    const value = Math.max(0, Math.round(hp))
    this.log.run(`${e.name}: ${value} HP`, (w) => {
      w.update('entity', entityId, { attributes: { ...e.attributes, current_hp: value } })
    })
  }

  /** Short rest: one hour passes. Long rest: eight hours pass and the party is back to full hit points. */
  rest(kind: 'short' | 'long'): void {
    const open = this.openSession()
    const now = this.info().clockMin
    const minutes = kind === 'short' ? 60 : 8 * 60
    this.log.run(kind === 'short' ? 'Short rest' : 'Long rest', (w) => {
      if (open) {
        w.insert('log_entry', {
          id: randomUUID(), sessionId: open.id, atMin: now, kind: 'rest', text: kind === 'short' ? 'Short rest' : 'Long rest',
          entityId: null, minutesTaken: minutes, createdAt: new Date().toISOString(), status: 'active'
        })
      }
      w.update('campaign_settings', 'clock_min', { value: now + minutes })
      if (kind === 'long') {
        for (const p of this.partyHealth()) {
          const e = this.entityRow(p.id)
          w.update('entity', p.id, { attributes: { ...e.attributes, current_hp: p.maxHp, slots_used: null } })
        }
        if (w.get('campaign_settings', 'last_long_rest_min')) w.update('campaign_settings', 'last_long_rest_min', { value: now + minutes })
        else w.insert('campaign_settings', { key: 'last_long_rest_min', value: now + minutes })
      }
    })
  }

  /**
   * Keeps something an on-the-fly generator proposed: puts the cards on the global
   * board, or saves them for later ("stashed": in the Library, not on the board).
   * One undo step for the whole thing.
   */
  keepGenerated(
    kind: 'character' | 'tavern' | 'encounter',
    payload: unknown,
    copy: (key: string) => { type: 'MONSTER' | 'ITEM'; name: string; attributes: EntityAttributes; abilities: NewAbility[] },
    keyByName: (name: string) => string | null,
    stash: boolean
  ): string[] {
    const g = this.globalBoard().id
    const status: EntityStatus = stash ? 'stashed' : 'active'
    const ids: string[] = []
    const person = (w: Writer, c: GeneratedPerson, extra: EntityAttributes = {}) => {
      const key = keyByName(c.statblockName)
      const base = key ? copy(key) : null
      const id = this.insertEntity(w, {
        boardId: g, type: 'NPC', name: c.name, position: this.freeGlobalSpot(), status,
        attributes: {
          ...(base?.attributes ?? {}), summary: c.summary, motivation: c.wants,
          bio: `${c.species} ${c.occupation}. ${c.attitude[0].toUpperCase()}${c.attitude.slice(1)}; ${c.quirk}.`, generated: true, ...extra
        },
        abilities: base?.abilities ?? []
      })
      ids.push(id)
      return id
    }
    const p = payload as Record<string, unknown>
    const title = String(p.name ?? p.summary ?? 'generated content')
    this.log.run(`${stash ? 'Saved for later' : 'Put on the board'}: ${title}`, (w) => {
      if (kind === 'character') person(w, payload as GeneratedPerson)
      else if (kind === 'tavern') {
        const t = payload as { name: string; keeper: GeneratedPerson; patrons: GeneratedPerson[]; rumour: string; dish: string; summary: string }
        const place = this.insertEntity(w, {
          boardId: g, type: 'LOCATION', name: t.name, position: this.freeGlobalSpot(), status,
          attributes: { summary: t.summary, description: `Tonight: ${t.dish}. Rumour: ${t.rumour}`, generated: true }
        })
        ids.push(place)
        for (const c of [t.keeper, ...t.patrons]) {
          const id = person(w, c, { location: t.name })
          w.insert('relationship', { id: randomUUID(), sourceId: id, targetId: place, type: 'LOCATED_AT', isSecret: false, status: 'active' })
        }
      } else {
        const e = payload as { summary: string; groups: Array<{ key: string; name: string; count: number }> }
        const scene = this.insertEntity(w, {
          boardId: g, type: 'SCENE', name: `Encounter: ${e.groups.map((x) => x.name).join(' and ')}`, position: this.freeGlobalSpot(),
          status, attributes: { summary: e.summary, generated: true }
        })
        ids.push(scene)
        for (const grp of e.groups) {
          const c = copy(grp.key)
          const id = this.insertEntity(w, {
            boardId: g, type: c.type, name: c.name, position: this.freeGlobalSpot(), status,
            attributes: { ...c.attributes, summary: `${grp.count} in this encounter`, count: grp.count }, abilities: c.abilities
          })
          ids.push(id)
          w.insert('relationship', { id: randomUUID(), sourceId: id, targetId: scene, type: 'IN_ENCOUNTER', isSecret: false, status: 'active' })
        }
      }
    })
    return ids
  }

  private sessionRow(id: string): SessionRow {
    const row = this.db.select().from(session).where(eq(session.id, id)).get()
    if (!row) throw new Error(`No session with id ${id}`)
    return row
  }

  private logRow(id: string): LogRow {
    const row = this.db.select().from(logEntry).where(eq(logEntry.id, id)).get()
    if (!row) throw new Error(`No log entry with id ${id}`)
    return row
  }

  // ---- session review ---------------------------------------------------------

  /**
   * Everything a session changed or left open, for the DM to approve. Proposals
   * come from the engine (acts resolved by default, acts waiting for an outcome,
   * with the triggers they set off) and from the log (people the party met).
   * Nothing here writes; decide() does, one undo step per decision.
   */
  review(sessionId: string): ReviewView {
    const sRow = this.sessionRow(sessionId)
    const nowMin = this.info().clockMin
    const endMin = sRow.endMin ?? nowMin
    const decisions = this.decisions(sessionId)
    const logs = this.db.select().from(logEntry).where(and(eq(logEntry.sessionId, sessionId), eq(logEntry.status, 'active'))).all()
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
    const entities = new Map(this.db.select().from(entity).all().map((e) => [e.id, e]))

    // Conflicts: the log says they met someone who is in History.
    const conflicts: ReviewConflict[] = logs
      .filter((l) => l.kind === 'meeting' && l.entityId && entities.get(l.entityId)?.status === 'defunct')
      .map((l) => {
        const name = entities.get(l.entityId!)!.name
        return {
          key: `history-meet:${l.id}`,
          text: `Your log says the party met ${name} at ${formatClock(l.atMin)}, but ${name} is in History.`,
          quote: l.text || null,
          options: [
            { action: 'revive' as const, label: `The log is right: bring ${name} back` },
            { action: 'remove_entry' as const, label: 'The log is wrong: remove the entry' }
          ],
          decision: decisions.get(`history-meet:${l.id}`) ?? null
        }
      })

    // Acts: ended by this session's end without an outcome the DM approved.
    const tl = this.timeline()
    const storyTitle = new Map(tl.storylines.map((x) => [x.storylineId, x.title]))
    const actName = (id: string) => {
      const a = tl.acts.find((x) => x.id === id)
      return a ? `${storyTitle.get(a.storylineId)} · Act ${a.number} (${a.title})` : 'an act'
    }
    const proposals: ReviewProposal[] = []
    for (const a of tl.acts) {
      const decided = decisions.get(`act:${a.id}`)
      // Open items: ended by the session's end with no outcome the DM approved.
      // Items decided in this review stay listed with their decision.
      if (!decided) {
        if (a.chosenOutcomeId || a.endMin > endMin) continue
        if (!(a.state === 'awaiting' || (a.state === 'resolved' && a.resolvedBy !== 'dm'))) continue
      }
      const outcome = a.outcomes.find((o) => o.id === (a.chosenOutcomeId ?? a.outcomeId))
      const ripples = tl.triggers.filter((t) => t.sourceActId === a.id && t.firedAtMin !== null).map((t) => {
        const target = storyTitle.get(t.targetStorylineId) ?? '?'
        const e = t.effect
        const what = e.type === 'shift_act' ? `moves ${actName(e.actId)} ${e.minutes >= 0 ? 'later' : 'earlier'} by ${Math.abs(e.minutes) / 60} h`
          : e.type === 'force_outcome' ? `decides how ${actName(e.actId)} ends`
            : `sets ${target} to ${e.status.replace('_', ' ')}`
        return `${t.label}: ${what}`
      })
      proposals.push({
        kind: 'act',
        key: `act:${a.id}`,
        actId: a.id,
        what: `${storyTitle.get(a.storylineId)} · Act ${a.number} outcome`,
        sub: decided?.decision === 'approved' ? 'You decided this in the review.'
          : a.state === 'awaiting' ? 'The act has ended. The players were in it, so you decide.'
            : a.resolvedBy === 'trigger' ? 'A trigger decided this.' : 'Ignored by the players: ran on its own.',
        before: decided?.decision === 'approved' ? 'Open' : a.state === 'awaiting' ? 'Waiting' : 'In progress',
        after: outcome?.label ?? 'Choose an outcome',
        outcomeId: outcome?.id ?? null,
        outcomes: a.outcomes.map((o) => ({ id: o.id, label: o.label })),
        ripples,
        decision: decisions.get(`act:${a.id}`) ?? null
      })
    }

    // What the party knows: everyone met this session whose name is not yet known.
    const known = new Set(this.db.select().from(knowledge).where(eq(knowledge.status, 'active')).all()
      .map((k) => `${k.entityId}:${k.field}`))
    const met = [...new Set(logs.filter((l) => l.kind === 'meeting' && l.entityId).map((l) => l.entityId!))]
    for (const id of met) {
      const e = entities.get(id)
      if (!e || e.status === 'defunct') continue
      const decided = decisions.get(`know:${id}`)
      const unknown: KnowledgeField[] = (['name', 'location'] as const).filter((f) => !known.has(`${id}:${f}`))
      if (unknown.length === 0 && !decided) continue
      const fields: KnowledgeField[] = unknown.length ? unknown : ['name', 'location']
      const already = (['name', 'location'] as const).filter((f) => known.has(`${id}:${f}`))
      proposals.push({
        kind: 'knowledge', key: `know:${id}`, entityId: id,
        what: `${e.name} · what the party knows`, sub: 'They met this session.',
        before: decided?.decision === 'approved' ? 'DM only' : already.length ? already.map(cap).join(', ') : 'DM only',
        after: `Known to party: ${fields.map(cap).join(', ')}`,
        fields, decision: decided ?? null
      })
    }

    const fights = logs.filter((l) => l.kind === 'fight')
      .map((l) => ({ logId: l.id, atMin: l.atMin, text: l.text, feedback: (l.feedback as EncounterFeedback | null) ?? null }))
    return {
      session: toSessionView(sRow),
      during: { startMin: sRow.startMin, endMin, entries: logs.length, meetings: met.length },
      conflicts, proposals, fights
    }
  }

  private decisions(sessionId: string): Map<string, { decision: ReviewDecisionKind; note: string }> {
    return new Map(this.db.select().from(reviewDecision)
      .where(and(eq(reviewDecision.sessionId, sessionId), eq(reviewDecision.status, 'active'))).all()
      .map((d) => [d.itemKey, { decision: d.decision as ReviewDecisionKind, note: d.note }]))
  }

  private recordDecision(w: Writer, sessionId: string, itemKey: string, decision: ReviewDecisionKind, note = ''): void {
    const existing = this.db.select().from(reviewDecision)
      .where(and(eq(reviewDecision.sessionId, sessionId), eq(reviewDecision.itemKey, itemKey))).get()
    if (existing) w.update('review_decision', existing.id, { decision, note, status: 'active' })
    else w.insert('review_decision', { id: randomUUID(), sessionId, itemKey, decision, note, createdAt: new Date().toISOString(), status: 'active' })
  }

  /** One review decision, applied together with what it means, as one undo step. */
  decide(sessionId: string, input: {
    key: string
    action: 'approve' | 'reject' | 'flag' | 'explain' | 'revive' | 'remove_entry' | 'reopen'
    outcomeId?: string
    fields?: KnowledgeField[]
    note?: string
  }): void {
    const view = this.review(sessionId)
    const proposal = view.proposals.find((p) => p.key === input.key)
    const conflict = view.conflicts.find((c) => c.key === input.key)
    if (!proposal && !conflict) throw new Error('That review item is no longer open')
    const label = {
      approve: 'Approved', reject: 'Rejected', flag: 'Flagged', explain: 'Explained', revive: 'Resolved', remove_entry: 'Resolved', reopen: 'Reopened'
    }[input.action]
    const title = proposal?.what ?? conflict?.text ?? input.key
    this.log.run(`${label}: ${title}`, (w) => this.applyDecision(w, sessionId, input, proposal, conflict))
  }

  /** Approves every open proposal that is not flagged or rejected and has a clear outcome, as one undo step. */
  approveAllUnflagged(sessionId: string): number {
    const view = this.review(sessionId)
    const open = view.proposals.filter((p) => !p.decision && (p.kind !== 'act' || p.outcomeId))
    if (open.length === 0) return 0
    this.log.run(`Approved ${open.length} change${open.length === 1 ? '' : 's'} from session ${view.session.number}`, (w) => {
      for (const p of open) this.applyDecision(w, sessionId, { key: p.key, action: 'approve' }, p, undefined)
    })
    return open.length
  }

  private applyDecision(
    w: Writer, sessionId: string,
    input: { key: string; action: string; outcomeId?: string; fields?: KnowledgeField[]; note?: string },
    proposal: ReviewProposal | undefined, conflict: ReviewConflict | undefined
  ): void {
    if (input.action === 'reopen') {
      const existing = this.db.select().from(reviewDecision)
        .where(and(eq(reviewDecision.sessionId, sessionId), eq(reviewDecision.itemKey, input.key))).get()
      if (existing) w.update('review_decision', existing.id, { status: 'defunct' })
      return
    }
    if (input.action === 'reject') return this.recordDecision(w, sessionId, input.key, 'rejected', input.note ?? '')
    if (input.action === 'flag') return this.recordDecision(w, sessionId, input.key, 'flagged', input.note ?? '')
    if (input.action === 'explain') return this.recordDecision(w, sessionId, input.key, 'explained', input.note ?? '')
    if (conflict) {
      const logId = input.key.slice('history-meet:'.length)
      const l = this.logRow(logId)
      if (input.action === 'revive' && l.entityId) w.update('entity', l.entityId, { status: 'active' })
      if (input.action === 'remove_entry') w.update('log_entry', logId, { status: 'defunct' })
      return this.recordDecision(w, sessionId, input.key, 'resolved', input.note ?? '')
    }
    if (!proposal || input.action !== 'approve') throw new Error('Nothing to approve')
    if (proposal.kind === 'act') {
      const outcomeId = input.outcomeId ?? proposal.outcomeId
      if (!outcomeId || !proposal.outcomes.some((o) => o.id === outcomeId)) throw new Error('Choose an outcome first')
      w.update('act', proposal.actId, { chosenOutcomeId: outcomeId })
    } else {
      const fields = input.fields ?? proposal.fields
      const now = this.info().clockMin
      for (const field of fields) {
        const existing = this.db.select().from(knowledge)
          .where(and(eq(knowledge.entityId, proposal.entityId), eq(knowledge.field, field))).get()
        if (existing) w.update('knowledge', existing.id, { status: 'active', knownFromMin: now })
        else w.insert('knowledge', { id: randomUUID(), entityId: proposal.entityId, field, knownFromMin: now, status: 'active' })
      }
    }
    this.recordDecision(w, sessionId, input.key, 'approved', input.note ?? '')
  }

  setFeedback(logId: string, feedback: EncounterFeedback | null): void {
    const l = this.logRow(logId)
    this.log.run(`Rated a fight${l.text ? `: ${l.text}` : ''}`, (w) => { w.update('log_entry', logId, { feedback }) })
  }

  /**
   * A recap for the players, drafted from the log: meetings name only people
   * whose name the party knows, everyone else is "a stranger". Not saved.
   */
  draftPlayerRecap(sessionId: string): string {
    this.sessionRow(sessionId)
    const known = new Set(this.db.select().from(knowledge).where(and(eq(knowledge.status, 'active'), eq(knowledge.field, 'name'))).all()
      .map((k) => k.entityId))
    const names = new Map(this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name]))
    return this.db.select().from(logEntry).where(and(eq(logEntry.sessionId, sessionId), eq(logEntry.status, 'active'))).all()
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
      .map((l) => {
        const when = formatClock(l.atMin)
        if (l.kind === 'meeting') {
          const who = l.entityId && known.has(l.entityId) ? names.get(l.entityId) : 'a stranger'
          return `${when}: The party met ${who}.`
        }
        if (l.kind === 'fight') return `${when}: A fight${l.text ? `: ${l.text}` : '.'}`
        if (l.kind === 'quest') return `${when}: A quest was delivered${l.text ? `: ${l.text}` : '.'}`
        if (l.kind === 'rest') return `${when}: ${l.text || 'The party rested.'}`
        return `${when}: ${l.text}`
      }).join('\n')
  }

  /** Undoes everything since the session started (the session itself included). Redo brings it back. */
  undoSession(sessionId: string): number {
    const started = this.log.recent(5000).find((c) => c.state === 'done' &&
      c.payload.some((ch) => ch.table === 'session' && ch.id === sessionId && ch.before === null))
    if (!started) throw new Error('The start of this session is no longer in the change log')
    return this.undoTo(started.id)
  }

  // ---- map regions, party token and travel ------------------------------------

  private regionRows(mapId: string): RegionRow[] {
    return this.db.select().from(regionShape).where(and(eq(regionShape.mapId, mapId), eq(regionShape.status, 'active'))).all()
  }

  private regionViews(mapId: string): RegionView[] {
    const ents = new Map(this.db.select().from(entity).all().map((e) => [e.id, e]))
    return this.regionRows(mapId).flatMap((r) => {
      const loc = ents.get(r.locationId)
      if (!loc || loc.status === 'defunct') return []
      return [{
        id: r.id, locationId: r.locationId, name: loc.name, polygon: r.polygon, parentLocationId: loc.parentId,
        colour: typeof loc.attributes.colour === 'string' ? loc.attributes.colour : null,
        kind: isPlaceKind(loc.attributes.place_kind) ? loc.attributes.place_kind : null,
        biome: isBiome(loc.attributes.biome) ? loc.attributes.biome : null
      }]
    })
  }

  /** The party's position on a map at minute `atMin` (the latest move at or before it). */
  partyAt(mapId: string, atMin: number): PartyMarker | null {
    const row = this.db.select().from(partyPosition).where(and(eq(partyPosition.mapId, mapId), eq(partyPosition.status, 'active'))).all()
      .filter((p) => p.atMin <= atMin && !p.entityId)
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt)).at(-1)
    if (!row) return null
    const name = row.locationId ? this.db.select({ name: entity.name }).from(entity).where(eq(entity.id, row.locationId)).get()?.name ?? null : null
    return { x: row.x, y: row.y, locationId: row.locationId, locationName: name, atMin: row.atMin }
  }

  mapScreen(mapId: string): MapScreenView {
    const m = this.mapRow(mapId)
    const nowMin = this.info().clockMin
    const regions = this.regionViews(mapId)
    const placed = new Set(regions.map((r) => r.locationId))
    // Route: the party's moves during the running session, or the last one.
    const sessions = this.db.select().from(session).where(eq(session.status, 'active')).orderBy(asc(session.number)).all()
    const current = sessions.find((x) => x.endedAt === null) ?? sessions.at(-1) ?? null
    const moves = this.db.select().from(partyPosition).where(and(eq(partyPosition.mapId, mapId), eq(partyPosition.status, 'active'))).all()
      .filter((p) => p.atMin <= nowMin && !p.entityId).sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
    let route: Array<[number, number]> = []
    if (current) {
      const inSession = moves.filter((p) => p.sessionId === current.id)
      if (inSession.length) {
        const before = moves.filter((p) => p.atMin <= inSession[0].atMin && p.sessionId !== current.id).at(-1)
        route = [...(before ? [before] : []), ...inSession].map((p) => [p.x, p.y])
      }
    }
    return {
      map: toMapView(m),
      regions,
      party: this.partyAt(mapId, nowMin),
      pcs: this.pcTokens(nowMin),
      route,
      sessionRunning: current !== null && current.endedAt === null,
      unplacedLocations: this.db.select().from(entity).all()
        .filter((e) => e.type === 'LOCATION' && e.status !== 'defunct' && !placed.has(e.id))
        .map((e) => ({ id: e.id, type: e.type as EntityType, name: e.name, status: e.status as EntityStatus }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
  }

  regionDetail(regionId: string): RegionDetail {
    const r = this.db.select().from(regionShape).where(eq(regionShape.id, regionId)).get()
    if (!r) throw new Error(`No region with id ${regionId}`)
    const region = this.regionViews(r.mapId).find((x) => x.id === regionId)
    if (!region) throw new Error('That region is in History')
    const loc = this.entityView(r.locationId)
    const all = this.db.select().from(entity).all().filter((e) => e.status === 'active' || e.status === 'resolved')
    const linked = new Set(this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
      .filter((x) => x.targetId === r.locationId && ['LOCATED_AT', 'TIED_TO_QUEST', 'IN_ENCOUNTER'].includes(x.type))
      .map((x) => x.sourceId))
    const byName = (e: typeof all[number]) => typeof e.attributes.location === 'string' && e.attributes.location.trim().toLowerCase() === loc.name.trim().toLowerCase()
    const here = all.filter((e) => e.id !== r.locationId && (linked.has(e.id) || byName(e)))
    const brief = (e: typeof all[number]) => ({ id: e.id, type: e.type as EntityType, name: e.name, status: e.status as EntityStatus })
    const party = this.partyAt(r.mapId, this.info().clockMin)
    // A player character split from the party counts as here in its own region.
    const splitHere = this.pcTokens(this.info().clockMin).filter((p) => p.split?.locationId === r.locationId)
      .map((p) => ({ id: p.entityId, type: 'PC' as EntityType, name: p.name, status: 'active' as EntityStatus }))
    return {
      region, location: loc,
      partyHere: !!party && party.locationId === r.locationId,
      hereNow: [...here.filter((e) => ['NPC', 'MONSTER', 'PC', 'FACTION'].includes(e.type) && !splitHere.some((p) => p.id === e.id)).map(brief), ...splitHere],
      encounters: here.filter((e) => e.type === 'SCENE' && isEncounter(e)).map(brief),
      plotPoints: here.filter((e) => ['QUEST', 'CLUE', 'ITEM', 'HANDOUT'].includes(e.type) || (e.type === 'SCENE' && !isEncounter(e))).map(brief),
      notes: [loc.attributes.description, loc.attributes.notes].filter((x) => typeof x === 'string' && x.trim()).join('\n\n'),
      subRegions: all.filter((e) => e.parentId === r.locationId && e.type === 'LOCATION').map((e) => ({ locationId: e.id, name: e.name }))
    }
  }

  /** What the AI scene writer is told: time, light, moon, where the party is and who is there. */
  sceneContext(): SceneContext {
    const nowMin = this.info().clockMin
    const moon = moonOn(nowMin, Number(this.setting('moon_offset_days') ?? 0))
    const party = this.partyNow()
    let place: SceneContext['place'] = null
    let present: SceneContext['present'] = []
    if (party?.locationId) {
      const loc = this.db.select().from(entity).where(eq(entity.id, party.locationId)).get()
      const region = this.db.select().from(regionShape).where(and(eq(regionShape.locationId, party.locationId), eq(regionShape.status, 'active'))).get()
      const detail = region ? this.regionDetail(region.id) : null
      const parent = loc?.parentId ? this.db.select({ name: entity.name }).from(entity).where(eq(entity.id, loc.parentId)).get()?.name ?? null : null
      if (loc) {
        const notes = [loc.attributes.description, loc.attributes.notes].filter((x): x is string => typeof x === 'string' && !!x.trim()).join('\n')
        const looks = typeof loc.attributes.player_notes === 'string' ? loc.attributes.player_notes.trim() : ''
        place = { name: loc.name, notes, inside: parent, looks }
      }
      if (detail) present = [...detail.hereNow, ...detail.plotPoints].filter((e) => e.type !== 'PC').map((e) => ({ name: e.name, type: e.type }))
    }
    const live = this.live()
    return {
      campaignName: this.info().name,
      when: formatClock(nowMin),
      light: skyAt(nowMin).light,
      moon: moon.name,
      place,
      present,
      recent: [...live.log].reverse().map((l) => [l.kind, l.entityName, l.text].filter(Boolean).join(': ')),
      current: live.session?.sceneText ?? ''
    }
  }

  /** Draws a region tied to an existing Location card, or to a new one made with it (one undo step). */
  createRegion(input: { mapId: string; polygon: Point[]; locationId?: string; newName?: string; parentLocationId?: string | null }): string {
    this.mapRow(input.mapId)
    if (input.polygon.length < 3) throw new Error('A region needs at least three points')
    if (!input.locationId && !input.newName?.trim()) throw new Error('Choose a location or give the new one a name')
    const id = randomUUID()
    const label = `Drew region ${input.newName?.trim() ?? this.nameOf(input.locationId!)}`
    this.log.run(label, (w) => {
      let locationId = input.locationId
      if (!locationId) {
        locationId = this.insertEntity(w, {
          boardId: this.globalBoard().id, type: 'LOCATION', name: input.newName!.trim(), position: this.freeGlobalSpot()
        })
      } else this.entityRow(locationId)
      if (input.parentLocationId !== undefined) w.update('entity', locationId, { parentId: input.parentLocationId })
      w.insert('region_shape', { id, mapId: input.mapId, locationId, polygon: input.polygon, status: 'active' })
    })
    return id
  }

  /**
   * Adds many regions at once (a generated world, or regions an AI found), each with a new
   * Location card; `parent` is the index of an earlier region it lies inside. One undo step.
   */
  addRegions(mapId: string, regions: NewRegion[], label: string): string[] {
    this.mapRow(mapId)
    const ids: string[] = []
    this.log.run(label, (w) => { ids.push(...this.insertRegions(w, mapId, regions)) })
    return ids
  }

  private insertRegions(w: Writer, mapId: string, regions: NewRegion[]): string[] {
    const locs: string[] = []
    const ids: string[] = []
    regions.forEach((r, i) => {
      if (r.polygon.length < 3) throw new Error(`Region ${r.name} needs at least three points`)
      const parentId = r.parent != null && r.parent < i ? locs[r.parent] : null
      const loc = this.insertEntity(w, {
        boardId: this.globalBoard().id, type: 'LOCATION', name: r.name.trim() || 'Unnamed place', position: this.freeGlobalSpot(),
        attributes: {
          place_kind: r.kind, ...(r.biome ? { biome: r.biome } : {}),
          ...(r.summary ? { summary: r.summary } : {}), ...(r.description ? { description: r.description } : {}),
          ...(r.source ? { imported: { ai: r.source, basis: 'inferred' } } : {})
        }
      })
      if (parentId) w.update('entity', loc, { parentId })
      const id = randomUUID()
      w.insert('region_shape', { id, mapId, locationId: loc, polygon: r.polygon, status: 'active' })
      locs.push(loc)
      ids.push(id)
    })
    return ids
  }

  updateRegion(id: string, patch: { polygon?: Point[]; locationId?: string; parentLocationId?: string | null }): void {
    const r = this.db.select().from(regionShape).where(eq(regionShape.id, id)).get()
    if (!r) throw new Error(`No region with id ${id}`)
    if (patch.polygon && patch.polygon.length < 3) throw new Error('A region needs at least three points')
    if (patch.parentLocationId && patch.parentLocationId === (patch.locationId ?? r.locationId)) throw new Error('A region cannot be inside itself')
    this.log.run(`Edited region ${this.nameOf(patch.locationId ?? r.locationId)}`, (w) => {
      const { parentLocationId, ...rest } = patch
      if (Object.keys(rest).length) w.update('region_shape', id, rest)
      if (parentLocationId !== undefined) w.update('entity', patch.locationId ?? r.locationId, { parentId: parentLocationId })
    })
  }

  setRegionStatus(id: string, status: RowStatus): void {
    const r = this.db.select().from(regionShape).where(eq(regionShape.id, id)).get()
    if (!r) throw new Error(`No region with id ${id}`)
    this.log.run(status === 'defunct' ? `Moved region ${this.nameOf(r.locationId)} to History` : `Restored region ${this.nameOf(r.locationId)}`,
      (w) => { w.update('region_shape', id, { status }) })
  }

  setMapScale(mapId: string, widthKm: number | null, travelKmh: number): void {
    const m = this.mapRow(mapId)
    this.log.run(`Set the scale of ${m.name}`, (w) => { w.update('map', mapId, { widthKm, travelKmh }) })
  }

  /** A square grid over the map (squares across), or none. */
  setMapGrid(mapId: string, cols: number | null): void {
    const m = this.mapRow(mapId)
    this.log.run(cols ? `Set a ${cols}-square grid on ${m.name}` : `Removed the grid from ${m.name}`, (w) => { w.update('map', mapId, { gridCols: cols }) })
  }

  // ---- battle maps and the DM's style examples

  /** Library pictures ticked as style examples for this kind of drawing (all of them without a kind). */
  styleExamples(use?: StyleUse): StyleExampleView[] {
    return this.db.select().from(styleExample).where(eq(styleExample.status, 'active')).all()
      .filter((r) => !use || r.styleFor.includes(use))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r) => ({ id: r.id, name: r.name, url: ASSET_URL_PREFIX + r.imagePath }))
  }

  /** Uploads a picture into the Library; new art is a style example for every kind of drawing until the DM unticks it. */
  addStyleExample(sourceFile: string, name?: string, folder = 'Art'): StyleExampleView {
    const ext = extname(sourceFile).toLowerCase()
    if (!STYLE_EXTENSIONS.includes(ext)) throw new Error(`Pictures for the Library must be PNG, JPEG or WebP images (got ${ext || 'no extension'})`)
    const id = randomUUID()
    const rel = `styles/${id}${ext}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'styles'), { recursive: true })
    copyFileSync(sourceFile, join(this.folder, ASSETS_DIR, rel))
    const label = name?.trim() || basename(sourceFile, extname(sourceFile))
    this.log.run(`Added picture ${label} to the Library`, (w) => {
      w.insert('style_example', { id, name: label, imagePath: rel, createdAt: new Date().toISOString(), status: 'active', folder, styleFor: [...STYLE_USES] })
    })
    return this.styleExamples().find((x) => x.id === id)!
  }

  /**
   * Library › Pictures: the Library's own pictures plus every map, card picture and board picture not
   * filed yet (filing or ticking one makes it a Library picture that points at the same file).
   */
  pictures(): PicturesView {
    const own = this.db.select().from(styleExample).where(eq(styleExample.status, 'active')).all()
    const filed = new Set(own.map((r) => r.imagePath))
    const out: LibraryPictureView[] = own.map((r) => ({
      key: `lib:${r.id}`, name: r.name, folder: r.folder, path: r.imagePath, url: ASSET_URL_PREFIX + r.imagePath,
      styleFor: r.styleFor.filter((u): u is StyleUse => (STYLE_USES as readonly string[]).includes(u)), from: null
    }))
    const add = (key: string, name: string, folder: string, path: string, from: LibraryPictureView['from']) => {
      if (filed.has(path)) return
      filed.add(path)
      out.push({ key, name, folder, path, url: ASSET_URL_PREFIX + path, styleFor: [], from })
    }
    for (const m of this.maps()) {
      const row = this.mapRow(m.id)
      add(`map:${m.id}`, m.name, m.kind === 'battle' ? 'Battle maps' : 'Maps', row.imagePath, { kind: 'map', id: m.id, name: m.name })
    }
    for (const e of this.db.select().from(entity).all()) {
      if (e.status === 'defunct' || typeof e.attributes.picture !== 'string') continue
      add(`card:${e.id}`, e.name, PICTURE_FOLDER[e.type as EntityType] ?? 'Card pictures', e.attributes.picture, { kind: 'card', id: e.id, name: e.name })
    }
    for (const item of this.db.select().from(boardItem).where(and(eq(boardItem.kind, 'image'), eq(boardItem.status, 'active'))).all()) {
      const c = item.content as { image?: string; name?: string } | null
      if (c?.image) add(`board:${item.id}`, c.name ?? 'Picture', 'Background pictures', c.image, { kind: 'board', id: item.id, name: c.name ?? 'Picture' })
    }
    const extra = this.setting('picture_folders')
    const folders = [...new Set([...DEFAULT_PICTURE_FOLDERS, ...(Array.isArray(extra) ? extra.map(String) : []), ...out.map((p) => p.folder)])]
    return { pictures: out, folders }
  }

  /** Renames, files or ticks a picture (one undo step). A map or card picture becomes a Library picture first. */
  updatePicture(key: string, patch: { name?: string; folder?: string; styleFor?: StyleUse[] }): void {
    const [kind, id] = key.split(':') as [string, string]
    if (kind === 'lib') {
      const r = this.styleRow(id)
      this.log.run(`Changed picture ${r.name}`, (w) => { w.update('style_example', id, patch) })
      return
    }
    const p = this.pictures().pictures.find((x) => x.key === key)
    if (!p) throw new Error('That picture is gone')
    this.log.run(`Filed picture ${p.name} in the Library`, (w) => {
      w.insert('style_example', {
        id: randomUUID(), name: patch.name ?? p.name, imagePath: p.path, createdAt: new Date().toISOString(), status: 'active',
        folder: patch.folder ?? p.folder, styleFor: patch.styleFor ?? []
      })
    })
  }

  addPictureFolder(name: string): void {
    const extra = this.setting('picture_folders')
    const list = Array.isArray(extra) ? extra.map(String) : []
    if (list.includes(name) || DEFAULT_PICTURE_FOLDERS.includes(name)) return
    this.setSetting('picture_folders', [...list, name], `Added picture folder ${name}`)
  }

  renameStyleExample(id: string, name: string): void {
    const r = this.styleRow(id)
    this.log.run(`Renamed example map ${r.name} to ${name}`, (w) => { w.update('style_example', id, { name }) })
  }

  setStyleExampleStatus(id: string, status: RowStatus): void {
    const r = this.styleRow(id)
    this.log.run(status === 'defunct' ? `Moved example map ${r.name} to History` : `Restored example map ${r.name}`, (w) => {
      w.update('style_example', id, { status })
    })
  }

  /** The example images to send with a drawing (active ones only, at most `max`). */
  styleImages(ids: string[], max = 4): Array<{ bytes: Buffer; mime: string }> {
    const rows = this.db.select().from(styleExample).where(eq(styleExample.status, 'active')).all().filter((r) => ids.includes(r.id)).slice(0, max)
    return rows.map((r) => ({ bytes: readFileSync(join(this.folder, ASSETS_DIR, r.imagePath)), mime: mimeOf(r.imagePath) }))
  }

  private styleRow(id: string) {
    const r = this.db.select().from(styleExample).where(eq(styleExample.id, id)).get()
    if (!r) throw new Error(`No example map with id ${id}`)
    return r
  }

  /**
   * An image an AI just drew, waiting for the DM. It sits in assets/pending and is not
   * campaign data until the DM keeps it (rule 2).
   */
  savePendingImage(bytes: Buffer, mime: string): PendingImageView {
    const ext = mime.includes('jpeg') ? '.jpg' : mime.includes('webp') ? '.webp' : '.png'
    const pendingId = `${randomUUID()}${ext}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'pending'), { recursive: true })
    writeFileSync(join(this.folder, ASSETS_DIR, 'pending', pendingId), bytes)
    const size = imageSize(bytes)
    return { pendingId, url: `${ASSET_URL_PREFIX}pending/${pendingId}`, width: size?.width ?? null, height: size?.height ?? null }
  }

  private pendingFile(pendingId: string): string {
    if (!PENDING_ID.test(pendingId)) throw new Error('Not a waiting image')
    const file = join(this.folder, ASSETS_DIR, 'pending', pendingId)
    if (!existsSync(file)) throw new Error('That image is gone; draw it again')
    return file
  }

  /** Keeps a drawn battle map: it becomes a map with a grid (one undo step). */
  keepBattleMap(input: { pendingId: string; name: string; cols: number; source: string; prompt: string }): MapView {
    const from = this.pendingFile(input.pendingId)
    const id = randomUUID()
    const rel = `maps/${id}${extname(input.pendingId)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'maps'), { recursive: true })
    renameSync(from, join(this.folder, ASSETS_DIR, rel))
    const size = imageSize(readFileSync(join(this.folder, ASSETS_DIR, rel)))
    this.log.run(`Kept battle map ${input.name}`, (w) => {
      w.insert('map', {
        id, name: input.name, imagePath: rel, width: size?.width ?? null, height: size?.height ?? null, gridSize: null,
        status: 'active', kind: 'battle', gridCols: input.cols, source: input.source, prompt: input.prompt
      })
    })
    return toMapView(this.mapRow(id))
  }

  /**
   * Keeps a world map that was made for the getting started guide (the map maker, or an AI
   * drawing): it becomes the desk map, with its regions and their Location cards. One undo step.
   */
  keepWorldMap(input: { pendingId: string; name: string; widthKm: number | null; source: string; prompt: string | null; regions: NewRegion[] }): MapView {
    const from = this.pendingFile(input.pendingId)
    const id = randomUUID()
    const rel = `maps/${id}${extname(input.pendingId)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'maps'), { recursive: true })
    renameSync(from, join(this.folder, ASSETS_DIR, rel))
    const size = imageSize(readFileSync(join(this.folder, ASSETS_DIR, rel)))
    this.log.run(`Kept world map ${input.name}`, (w) => {
      w.insert('map', {
        id, name: input.name, imagePath: rel, width: size?.width ?? null, height: size?.height ?? null, gridSize: null,
        status: 'active', kind: 'world', widthKm: input.widthKm, source: input.source, prompt: input.prompt
      })
      if (w.get('campaign_settings', 'active_map_id')) w.update('campaign_settings', 'active_map_id', { value: id })
      else w.insert('campaign_settings', { key: 'active_map_id', value: id })
      this.insertRegions(w, id, input.regions)
    })
    return toMapView(this.mapRow(id))
  }

  /** The map's picture file and size (for an AI to look at). */
  mapImage(mapId: string): { file: string; width: number; height: number } {
    const m = this.mapRow(mapId)
    const file = join(this.folder, ASSETS_DIR, m.imagePath)
    const size = m.width && m.height ? { width: m.width, height: m.height } : imageSize(readFileSync(file))
    if (!size) throw new Error('Could not read the size of this map picture')
    return { file, width: size.width, height: size.height }
  }

  /** Throws away a drawn image the DM did not keep (it was never campaign data). */
  discardPending(pendingId: string): void {
    try { unlinkSync(this.pendingFile(pendingId)) } catch { /* already gone */ }
  }

  // ---- fill blanks with AI

  /** Titles of the storylines a card is in (context for the AI). */
  storylinesOf(entityId: string): string[] {
    const links = this.db.select().from(storylineEntity).where(and(eq(storylineEntity.entityId, entityId), eq(storylineEntity.status, 'active'))).all()
    const titles = new Map(this.db.select().from(storyline).all().filter((x) => !x.removed).map((x) => [x.id, x.title]))
    return links.map((l) => titles.get(l.storylineId)).filter((x): x is string => !!x)
  }

  /**
   * Uses the AI suggestions the DM kept, as one undo step. Only fields that are still
   * empty are written (the DM may have typed one meanwhile); each is marked in
   * attributes.ai_filled. An SRD base gives a creature without one a stat block and abilities.
   */
  /** Raise or lower the challenge rating by the local rules (shared/crscale.ts). One undo step. */
  scaleCr(entityId: string, cr: string): void {
    const e = this.entityRow(entityId)
    const sb = readStatBlock(e.attributes.statblock)
    if (!sb) throw new Error(`${e.name} has no stat block yet`)
    const abilities = this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all()
    const r = scaleToCr(sb, abilities, cr)
    this.log.run(`${e.name}: challenge rating ${sb.cr} → ${cr}`, (w) => {
      w.update('entity', entityId, { attributes: { ...e.attributes, statblock: r.statblock } })
      for (const a of r.abilities) {
        const old = abilities.find((x) => x.id === a.id)!
        if (old.description !== a.description || old.macroText !== a.macroText) w.update('ability', a.id, { description: a.description, macroText: a.macroText })
      }
    })
  }

  /**
   * Puts a whole stat block on a card (an approved AI proposal): the old actions go to History,
   * the new ones are added; the stat block is marked as written by AI (rule 10). One undo step.
   */
  applyStatBlock(entityId: string, statblock: StatBlock, actions: NewAbility[], source: string): void {
    const e = this.entityRow(entityId)
    const old = this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all()
    this.log.run(`New stat block for ${e.name} (AI)`, (w) => {
      const filled = { ...(e.attributes.ai_filled && typeof e.attributes.ai_filled === 'object' ? e.attributes.ai_filled as Record<string, string> : {}), statblock: source }
      w.update('entity', entityId, { attributes: { ...e.attributes, statblock, ai_filled: filled } })
      for (const a of old) w.update('ability', a.id, { status: 'defunct' })
      actions.forEach((a, i) => this.insertAbility(w, entityId, a, i))
    })
  }

  /**
   * A character sheet read from the DM's notes files (an approved AI proposal): onto a card, or a new
   * PC card when `entityId` is null. Only the parts the DM kept are given (null = leave as is); new
   * attacks and spells send the card's old ones to History. One undo step; returns the card's id.
   */
  applyCharSheet(input: {
    entityId: string | null; name: string; source: string; statblock: StatBlock | null; actions: NewAbility[] | null
    level: string | null; currentHp: number | null; spellSlots: number[] | null; fields: Record<string, string>
    spellAbility?: string | null; prepared?: string[]
  }): string {
    const e = input.entityId ? this.entityRow(input.entityId) : null
    let id = input.entityId ?? ''
    this.log.run(`${e ? 'Filled' : 'Made'} ${e?.name ?? input.name} from a character sheet (AI)`, (w) => {
      const attrs: Record<string, unknown> = { ...(e?.attributes ?? {}) }
      const filled = { ...(attrs.ai_filled && typeof attrs.ai_filled === 'object' ? attrs.ai_filled as Record<string, string> : {}) }
      for (const [k, v] of Object.entries(input.fields)) {
        if (['statblock', 'custom', 'provenance', 'imported', 'ai_filled', 'source'].includes(k)) continue
        attrs[k] = v.trim()
        filled[k] = input.source
      }
      if (input.statblock) { attrs.statblock = input.statblock; filled.statblock = input.source }
      if (input.level !== null) attrs.level = input.level
      if (input.currentHp !== null) attrs.current_hp = input.currentHp
      if (input.spellSlots) attrs.spell_slots = input.spellSlots
      if (input.spellAbility) attrs.spell_ability = input.spellAbility
      attrs.ai_filled = filled
      if (!e) {
        id = this.insertEntity(w, { boardId: this.globalBoard().id, type: 'PC', name: input.name, position: this.freeGlobalSpot(), attributes: attrs })
        this.joinFights(w, id)
      } else {
        w.update('entity', id, { attributes: attrs })
        if (input.actions) {
          const old = this.db.select().from(ability).where(and(eq(ability.entityId, id), eq(ability.status, 'active'))).all()
          for (const a of old) w.update('ability', a.id, { status: 'defunct' })
        }
      }
      if (!input.actions) return
      // Prepared spells (by name) become ticks on the new spell rows.
      const want = new Set((input.prepared ?? []).map((n) => n.toLowerCase()))
      const ids = input.actions.map((a, i) => ({ id: this.insertAbility(w, id, a, i), a }))
      const prepared = ids.filter(({ a }) => a.kind === 'SPELL' && want.has(a.name.toLowerCase())).map((x) => x.id)
      if (prepared.length) w.update('entity', id, { attributes: { ...attrs, prepared } })
    })
    return id
  }

  /** A picture for a card's sheet: a file the DM chose, or a kept AI drawing (pending). One undo step. */
  setPicture(entityId: string, from: { file: string } | { pendingId: string; source: string } | { path: string } | null): void {
    const e = this.entityRow(entityId)
    if (!from) {
      this.log.run(`Removed the picture of ${e.name}`, (w) => { w.update('entity', entityId, { attributes: { ...e.attributes, picture: null, picture_source: null } }) })
      return
    }
    if ('path' in from) {
      // Chosen from the Library: the card shows the same file.
      if (!this.assetFile(from.path) || !MAP_EXTENSIONS.includes(extname(from.path).toLowerCase())) throw new Error('That picture is not in this campaign')
      this.log.run(`New picture for ${e.name}`, (w) => { w.update('entity', entityId, { attributes: { ...e.attributes, picture: from.path, picture_source: null } }) })
      return
    }
    const src = 'file' in from ? from.file : this.pendingFile(from.pendingId)
    const ext = extname(src).toLowerCase()
    if (!MAP_EXTENSIONS.includes(ext)) throw new Error(`Pictures must be PNG, JPEG, WebP or GIF images (got ${ext || 'no extension'})`)
    const rel = `pictures/${randomUUID()}${ext}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'pictures'), { recursive: true })
    if ('file' in from) copyFileSync(src, join(this.folder, ASSETS_DIR, rel))
    else renameSync(src, join(this.folder, ASSETS_DIR, rel))
    this.log.run(`New picture for ${e.name}`, (w) => {
      w.update('entity', entityId, { attributes: { ...e.attributes, picture: rel, picture_source: 'source' in from ? from.source : null } })
    })
  }

  applyFill(entityId: string, fields: Record<string, string>, source: string, srd?: SrdCopy | null): string[] {
    const e = this.entityRow(entityId)
    const used: string[] = []
    this.log.run(`Filled blanks on ${e.name} with AI`, (w) => {
      const attrs: Record<string, unknown> = { ...e.attributes }
      const filled = { ...(attrs.ai_filled && typeof attrs.ai_filled === 'object' ? attrs.ai_filled as Record<string, string> : {}) }
      for (const [k, v] of Object.entries(fields)) {
        if (!v.trim() || ['statblock', 'custom', 'provenance', 'imported', 'ai_filled', 'source'].includes(k)) continue
        if (typeof attrs[k] === 'string' && (attrs[k] as string).trim()) continue
        attrs[k] = v.trim()
        filled[k] = source
        used.push(k)
      }
      if (srd && !readStatBlock(attrs.statblock)) {
        attrs.statblock = srd.attributes.statblock
        filled.statblock = `${source}, based on the SRD ${srd.name}`
        used.push('statblock')
        const has = this.db.select().from(ability).where(eq(ability.entityId, entityId)).all().some((a) => a.status === 'active')
        if (!has) srd.abilities.forEach((a, i) => this.insertAbility(w, entityId, a, i))
      }
      attrs.ai_filled = filled
      w.update('entity', entityId, { attributes: attrs })
    })
    return used
  }

  // ---- notes import (Phase 5): drafts live in imports/ and are not campaign data until committed

  private importsDir(): string {
    const dir = join(this.folder, 'imports')
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /** Cards an import can match or link to. */
  importTargets(): Array<{ id: string; name: string; type: string }> {
    return this.db.select().from(entity).all()
      .filter((e) => e.status === 'active' || e.status === 'resolved' || e.status === 'stashed')
      .map((e) => ({ id: e.id, name: e.name, type: e.type }))
  }

  importDrafts(): ImportDraftSummary[] {
    return readdirSync(this.importsDir()).filter((f) => f.endsWith('.json'))
      .flatMap((f) => { try { return [this.importDraft(f.slice(0, -5))] } catch { return [] } })
      .filter((d) => d.status !== 'discarded')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((d) => ({
        id: d.id, title: d.title, createdAt: d.createdAt, status: d.status,
        cards: d.cards.length, openQuestions: d.questions.filter((q) => q.status === 'open').length
      }))
  }

  importDraft(id: string): ImportDraft {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Not an import draft')
    const file = join(this.importsDir(), `${id}.json`)
    if (!existsSync(file)) throw new Error('That import is gone')
    return ImportDraftSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
  }

  saveImportDraft(d: ImportDraft): void {
    const draft = ImportDraftSchema.parse(d)
    if (!/^[0-9a-f-]{36}$/.test(draft.id)) throw new Error('Not an import draft')
    writeFileSync(join(this.importsDir(), `${draft.id}.json`), JSON.stringify(draft, null, 1))
  }

  /**
   * Creates everything the DM kept from an import as ONE undo step: new cards, merges into
   * existing cards (only empty fields are filled), storylines with acts, strings, and
   * answered questions as DM notes. Every card records where it came from.
   */
  commitImport(id: string): { created: number; merged: number; storylines: number; links: number } {
    const d = this.importDraft(id)
    if (d.status !== 'open') throw new Error('This import was already used')
    const g = this.globalBoard().id
    const ids = new Map<string, string>()
    const counts = { created: 0, merged: 0, storylines: 0, links: 0 }
    const nowMin = this.info().clockMin
    const provenanceOf = (sources: ImportDraft['cards'][number]['sources']) => sources.map((x) => ({ ...x, import: d.title, ai: d.source }))
    const target = (pid: string): string | null => (pid.startsWith('entity:') ? pid.slice(7) : ids.get(pid) ?? null)
    this.log.run(`Imported notes: ${d.title}`, (w) => {
      for (const c of d.cards) {
        if (c.decision === 'skip') continue
        if (c.decision === 'merge' && c.duplicateOf) {
          const e = this.db.select().from(entity).where(eq(entity.id, c.duplicateOf.id)).get()
          if (e && e.status !== 'defunct') {
            const attrs: Record<string, unknown> = { ...e.attributes }
            const fill = (k: string, v: string) => { if (v && (c.overwrite?.includes(k) || !(typeof attrs[k] === 'string' && (attrs[k] as string).trim()))) attrs[k] = v }
            fill('summary', c.summary)
            for (const [k, v] of Object.entries(c.details)) fill(k, v)
            attrs.provenance = [...(Array.isArray(attrs.provenance) ? attrs.provenance : []), ...provenanceOf(c.sources)]
            w.update('entity', e.id, { attributes: attrs, tags: [...new Set([...e.tags, ...c.tags])] })
            ids.set(c.id, e.id)
            counts.merged++
            continue
          }
        }
        const eid = this.insertEntity(w, {
          boardId: g, type: c.type, name: c.name.trim() || 'Unnamed', position: this.freeGlobalSpot(), tags: c.tags,
          attributes: { summary: c.summary, ...c.details, provenance: provenanceOf(c.sources), imported: { ai: d.source, basis: c.basis, import: d.title } }
        })
        ids.set(c.id, eid)
        counts.created++
      }
      d.storylines.filter((x) => x.decision === 'create').forEach((sl, k) => {
        const storylineId = randomUUID()
        const boardId = randomUUID()
        w.insert('storyline', { id: storylineId, title: sl.title || 'Imported storyline', isMajor: false, status: 'inactive', bbegEntityId: null, emblem: null, removed: false })
        w.insert('board', { id: boardId, name: sl.title || 'Imported storyline', storylineId })
        if (sl.summary.trim()) {
          w.insert('board_item', {
            id: randomUUID(), boardId, kind: 'note', entityId: null, x: 40, y: 40, w: 260, h: 140,
            content: { text: `${sl.summary.trim()}\n\n(From notes: ${sl.sources.map((x) => `${x.file}, ${x.locator}`).join('; ')}; read by ${d.source})` }, status: 'active'
          })
        }
        sl.cardIds.map(target).filter((x): x is string => !!x).forEach((eid, n) => {
          this.linkToStoryline(w, eid, storylineId, boardId, { x: 340 + (n % 4) * 260, y: 40 + Math.floor(n / 4) * 200 })
        })
        sl.acts.forEach((a, n) => {
          const actId = randomUUID()
          const start = nowMin + (k + n) * MINUTES_PER_DAY
          w.insert('act', { id: actId, storylineId, title: a.title, summary: a.summary, startMin: start, endMin: start + 12 * 60, chosenOutcomeId: null, status: 'active' })
          w.insert('act_outcome', { id: randomUUID(), actId, label: 'If nobody intervenes', description: '', isDefault: true, sort: 0, status: 'active' })
        })
        counts.storylines++
      })
      const existingLinks = this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
      for (const l of d.links) {
        if (l.decision === 'skip') continue
        const a = target(l.fromId)
        const b = target(l.toId)
        if (!a || !b || a === b) continue
        if (existingLinks.some((r) => r.sourceId === a && r.targetId === b && r.type === l.type)) continue
        w.insert('relationship', { id: randomUUID(), sourceId: a, targetId: b, type: l.type, isSecret: l.secret, status: 'active' })
        counts.links++
      }
      // Answered questions go into the DM notes of the card they are about, or the campaign journal.
      for (const q of d.questions.filter((x) => x.status === 'answered' && x.answer.trim())) {
        const line = `Q (notes import): ${q.text}\nA: ${q.answer.trim()}`
        const about = q.aboutId ? target(q.aboutId) : null
        const e = about ? this.db.select().from(entity).where(eq(entity.id, about)).get() : undefined
        if (e) {
          const cur = typeof e.attributes.notes === 'string' ? e.attributes.notes.trim() : ''
          w.update('entity', e.id, { attributes: { ...e.attributes, notes: cur ? `${cur}\n\n${line}` : line } })
        } else {
          const cur = String(this.setting('dm_notes') ?? '').trim()
          const value = cur ? `${cur}\n\n${line}` : line
          if (w.get('campaign_settings', 'dm_notes')) w.update('campaign_settings', 'dm_notes', { value })
          else w.insert('campaign_settings', { key: 'dm_notes', value })
        }
      }
    })
    this.saveImportDraft({ ...d, status: 'committed' })
    return counts
  }

  /** Puts a draft aside (kept on disk, out of the list) or back to open after an undo. */
  setImportStatus(id: string, status: 'open' | 'discarded'): void {
    this.saveImportDraft({ ...this.importDraft(id), status })
  }

  // ---- encounter planner (an encounter is a SCENE card with attributes.encounter = true)

  /** Encounter cards, including ones made by "Suggest an encounter" before the planner. */
  private encounterCards(): EntityRow[] {
    return this.db.select().from(entity).where(eq(entity.type, 'SCENE')).all()
      .filter((e) => e.status === 'active' || e.status === 'resolved' || e.status === 'stashed')
      .filter(isEncounter)
  }

  /** Fight feedback from play, oldest first, for the adaptive budgets. */
  private fightFeedback(): FightFeedback[] {
    return this.db.select().from(logEntry).where(and(eq(logEntry.status, 'active'), eq(logEntry.kind, 'fight'))).all()
      .filter((l) => l.feedback)
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
      .map((l) => l.feedback as FightFeedback)
  }

  private partySize(): number {
    return Math.max(1, this.partyHealth().length || 4)
  }

  encountersView(): EncountersView {
    const level = Number(this.setting('party_level') ?? 1)
    const size = this.partySize()
    const adapt = adaptation(this.fightFeedback())
    const all = this.db.select().from(entity).all()
    const live = all.filter((e) => e.status === 'active' || e.status === 'resolved' || e.status === 'stashed')
    const brief = (e: EntityRow): EntityBrief => ({ id: e.id, type: e.type as EntityType, name: e.name, status: e.status as EntityStatus })
    const cr = (e: EntityRow) => readStatBlock(e.attributes.statblock)?.cr ?? ''
    return {
      encounters: this.encounterCards().sort((a, b) => a.name.localeCompare(b.name)).map((e) => this.encounterView(e.id, { level, size, factor: adapt.factor })),
      party: { level, size },
      sessionRunning: !!this.openSession(),
      adaptation: adapt,
      houseRules: String(this.setting('house_rules') ?? ''),
      fighters: live.filter((e) => e.type === 'MONSTER' || e.type === 'NPC').sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ ...brief(e), cr: cr(e) })),
      places: live.filter((e) => e.type === 'LOCATION').sort((a, b) => a.name.localeCompare(b.name)).map(brief),
      battleMaps: this.maps().filter((m) => m.kind === 'battle').map((m) => ({ id: m.id, name: m.name }))
    }
  }

  encounterView(id: string, party?: { level: number; size: number; factor: number }): EncounterView {
    const e = this.entityRow(id)
    const p = party ?? { level: Number(this.setting('party_level') ?? 1), size: this.partySize(), factor: adaptation(this.fightFeedback()).factor }
    const byId = new Map(this.db.select().from(entity).all().map((x) => [x.id, x]))
    const allRows = this.db.select().from(encounterCreature).where(eq(encounterCreature.encounterId, id)).all()
    const rows = allRows.filter((r) => r.status === 'active').sort((a, b) => a.sort - b.sort)
    const view = (entityId: string, count: number, rowId: string | null, notes: string): EncounterCreatureView | null => {
      const c = byId.get(entityId)
      if (!c || c.status === 'defunct') return null
      const sb = readStatBlock(c.attributes.statblock)
      return {
        rowId, entityId, name: c.name, type: c.type as EntityType, cr: sb?.cr ?? '', xpEach: xpForCr(sb?.cr ?? ''), count, notes,
        statLine: sb ? statLine(sb) : '', stashed: c.status === 'stashed',
        aiMade: !!(c.attributes.ai_filled as Record<string, string> | undefined)?.statblock
      }
    }
    let creatures = rows.map((r) => view(r.entityId, r.count, r.id, r.notes)).filter((x): x is EncounterCreatureView => !!x)
    if (!allRows.length) {
      // Made before the planner: monsters linked by IN_ENCOUNTER strings, count on the card.
      creatures = this.db.select().from(relationship).where(and(eq(relationship.targetId, id), eq(relationship.type, 'IN_ENCOUNTER'), eq(relationship.status, 'active'))).all()
        .map((r) => view(r.sourceId, Number(byId.get(r.sourceId)?.attributes.count ?? 1) || 1, null, ''))
        .filter((x): x is EncounterCreatureView => !!x)
    }
    const at = this.db.select().from(relationship).where(and(eq(relationship.sourceId, id), eq(relationship.type, 'LOCATED_AT'), eq(relationship.status, 'active'))).get()
    const sessions = new Map(this.db.select().from(session).all().map((x) => [x.id, x.number]))
    const runs = this.db.select().from(logEntry).where(and(eq(logEntry.encounterId, id), eq(logEntry.status, 'active'))).all()
      .sort((a, b) => a.atMin - b.atMin).map((l) => ({ atMin: l.atMin, session: sessions.get(l.sessionId) ?? 0, feedback: l.feedback }))
    const a = e.attributes as Record<string, unknown>
    const target = a.target === 'low' || a.target === 'high' ? a.target : 'moderate'
    return {
      id, name: e.name, locationId: at?.targetId ?? null, locationName: at ? byId.get(at.targetId)?.name ?? null : null,
      target, tactics: typeof a.tactics === 'string' ? a.tactics : '', notes: typeof a.summary === 'string' ? a.summary : '',
      scene: typeof a.scene === 'string' ? a.scene : '',
      battleMapId: typeof a.battle_map_id === 'string' ? a.battle_map_id : null,
      creatures, difficulty: rateEncounter(creatures, p.level, p.size, p.factor), runs
    }
  }

  createEncounter(input: { name: string; locationId?: string | null }): string {
    let id = ''
    this.log.run(`Planned encounter ${input.name}`, (w) => {
      id = this.insertEntity(w, {
        boardId: this.globalBoard().id, type: 'SCENE', name: input.name, position: this.freeGlobalSpot(),
        attributes: { encounter: true, target: 'moderate', tactics: '', summary: '' }
      })
      if (input.locationId) w.insert('relationship', { id: randomUUID(), sourceId: id, targetId: input.locationId, type: 'LOCATED_AT', isSecret: false, status: 'active' })
    })
    return id
  }

  updateEncounter(id: string, patch: { name?: string; locationId?: string | null; target?: 'low' | 'moderate' | 'high'; tactics?: string; notes?: string; scene?: string; battleMapId?: string | null }): void {
    const e = this.entityRow(id)
    this.log.run(`Edited encounter ${patch.name ?? e.name}`, (w) => {
      const attrs: Record<string, unknown> = { encounter: true }
      if (patch.target) attrs.target = patch.target
      if (patch.tactics !== undefined) attrs.tactics = patch.tactics
      if (patch.notes !== undefined) attrs.summary = patch.notes
      if (patch.scene !== undefined) attrs.scene = patch.scene
      if (patch.battleMapId !== undefined) attrs.battle_map_id = patch.battleMapId
      w.update('entity', id, { name: patch.name, attributes: { ...e.attributes, ...attrs } })
      if (patch.locationId !== undefined) {
        for (const r of this.db.select().from(relationship).where(and(eq(relationship.sourceId, id), eq(relationship.type, 'LOCATED_AT'), eq(relationship.status, 'active'))).all()) {
          w.update('relationship', r.id, { status: 'defunct' })
        }
        if (patch.locationId) w.insert('relationship', { id: randomUUID(), sourceId: id, targetId: patch.locationId, type: 'LOCATED_AT', isSecret: false, status: 'active' })
      }
    })
  }

  /** An old encounter (counts on the cards) gets its own rows the first time it is edited. */
  private adoptLegacyCreatures(w: Writer, encounterId: string): void {
    const rows = this.db.select().from(encounterCreature).where(eq(encounterCreature.encounterId, encounterId)).all()
    if (rows.length) return
    this.encounterView(encounterId).creatures.forEach((c, i) => {
      w.insert('encounter_creature', { id: randomUUID(), encounterId, entityId: c.entityId, count: c.count, notes: '', sort: i + 1, status: 'active' })
    })
  }

  addEncounterCreature(encounterId: string, entityId: string, count = 1): void {
    const e = this.entityRow(encounterId)
    const c = this.entityRow(entityId)
    this.log.run(`Added ${count} × ${c.name} to ${e.name}`, (w) => { this.putCreature(w, encounterId, entityId, count); this.syncFight(w, encounterId) })
  }

  private putCreature(w: Writer, encounterId: string, entityId: string, count: number): void {
    this.adoptLegacyCreatures(w, encounterId)
    const rows = this.db.select().from(encounterCreature).where(and(eq(encounterCreature.encounterId, encounterId), eq(encounterCreature.status, 'active'))).all()
    const same = rows.find((r) => r.entityId === entityId)
    if (same) w.update('encounter_creature', same.id, { count: same.count + count })
    else w.insert('encounter_creature', {
      id: randomUUID(), encounterId, entityId, count, notes: '', sort: rows.reduce((n, r) => Math.max(n, r.sort), 0) + 1, status: 'active'
    })
  }

  /**
   * Copies an SRD monster into the campaign (or reuses the card already copied from it)
   * and puts it in the encounter, as one undo step.
   */
  addSrdToEncounter(encounterId: string, groups: Array<{ key: string; count: number }>, copy: (key: string) => SrdCopy): void {
    const e = this.entityRow(encounterId)
    const cards = this.db.select().from(entity).all().filter((x) => x.status !== 'defunct')
    this.log.run(`Added ${groups.map((g) => `${g.count} × ${copy(g.key).name}`).join(', ')} to ${e.name}`, (w) => {
      for (const g of groups) {
        const existing = cards.find((x) => (x.attributes.source as { key?: string } | undefined)?.key === g.key)
        let id = existing?.id
        if (!id) {
          const c = copy(g.key)
          id = this.insertEntity(w, { boardId: this.globalBoard().id, type: c.type, name: c.name, position: this.freeGlobalSpot(), attributes: c.attributes, abilities: c.abilities })
        }
        this.putCreature(w, encounterId, id, g.count)
      }
      this.syncFight(w, encounterId)
    })
  }

  /**
   * Adds what the DM ticked from an AI-built encounter: SRD monsters (the card already copied,
   * or a new copy) and new monsters, both kept off the board until "Put on board"; empty
   * tactics get the AI's. One undo step.
   */
  addEncounterProposals(encounterId: string, items: Array<{ srdKey?: string; name: string; statblock?: StatBlock; actions?: NewAbility[]; count: number; notes: string }>, tactics: string, source: string, copy: (key: string) => SrdCopy): void {
    const e = this.entityRow(encounterId)
    const cards = this.db.select().from(entity).all().filter((x) => x.status !== 'defunct')
    this.log.run(`AI built ${e.name}: ${items.map((i) => `${i.count} × ${i.name}`).join(', ')}`, (w) => {
      for (const it of items) {
        let id = it.srdKey ? cards.find((x) => (x.attributes.source as { key?: string } | undefined)?.key === it.srdKey)?.id : undefined
        if (!id && it.srdKey) {
          const c = copy(it.srdKey)
          id = this.insertEntity(w, { boardId: this.globalBoard().id, type: c.type, name: c.name, position: this.freeGlobalSpot(), status: 'stashed', attributes: c.attributes, abilities: c.abilities })
        }
        if (!id) {
          id = this.insertEntity(w, {
            boardId: this.globalBoard().id, type: 'MONSTER', name: it.name, position: this.freeGlobalSpot(), status: 'stashed',
            attributes: { statblock: it.statblock, summary: it.notes, ai_filled: { statblock: source } }, abilities: it.actions ?? []
          })
        }
        this.putCreature(w, encounterId, id, it.count)
        if (it.notes) {
          const row = this.db.select().from(encounterCreature).where(and(eq(encounterCreature.encounterId, encounterId), eq(encounterCreature.entityId, id), eq(encounterCreature.status, 'active'))).get()
          if (row && !row.notes) w.update('encounter_creature', row.id, { notes: it.notes })
        }
      }
      if (tactics && !String(e.attributes.tactics ?? '').trim()) w.update('entity', encounterId, { attributes: { ...e.attributes, tactics } })
      this.syncFight(w, encounterId)
    })
  }

  // ---- run encounter (combat tracker)

  /** A creature or player character as it enters a fight: hit points and AC from its card. */
  private fightCombatant(entityId: string, side: Combatant['side'], name: string): Combatant {
    const e = this.entityRow(entityId)
    const sb = readStatBlock(e.attributes.statblock)
    const max = leadingNumber(sb?.hp ?? '') ?? 0
    const hp = side === 'party' && typeof e.attributes.current_hp === 'number' ? e.attributes.current_hp : max
    const texts = [...(sb?.traits ?? []).map((t) => `${t.name} ${t.desc}`), ...this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all().map((a) => a.name)]
    return newCombatant({
      id: randomUUID(), entityId, name, side, hp, maxHp: max, ac: String(leadingNumber(sb?.ac ?? '') ?? ''),
      tempHp: side === 'party' && typeof e.attributes.temp_hp === 'number' ? e.attributes.temp_hp : 0,
      displacement: texts.some((t) => /^displacement\b/i.test(t)) ? 'on' : null
    })
  }

  /** Starts a fight from an encounter (or returns the one still running): the party, then the foes in the encounter's order. */
  startCombat(encounterId: string): string {
    const running = this.db.select().from(combat).where(and(eq(combat.encounterId, encounterId), eq(combat.status, 'active'))).get()
    if (running) return running.id
    const enc = this.encounterView(encounterId)
    const combatants: Combatant[] = this.partyHealth().map((p) => this.fightCombatant(p.id, 'party', p.name))
    for (const cr of enc.creatures) {
      for (let i = 1; i <= cr.count; i++) combatants.push({ ...this.fightCombatant(cr.entityId, 'foe', cr.count > 1 ? `${cr.name} ${i}` : cr.name), notes: cr.notes })
    }
    const id = randomUUID()
    this.log.run(`Started the fight: ${enc.name}`, (w) => {
      w.insert('combat', { id, encounterId, status: 'active', createdAt: new Date().toISOString(), state: { round: 1, turn: 0, combatants, log: [`Round 1: ${enc.name} begins.`], effects: [] } })
    })
    return id
  }

  /**
   * The running fight follows its encounter (owner, 1.4.0): more creatures join at the end of the order
   * with full hit points; fewer take unhurt copies out first. Runs inside the change to the encounter.
   */
  private syncFight(w: Writer, encounterId: string): void {
    const row = this.db.select().from(combat).where(and(eq(combat.encounterId, encounterId), eq(combat.status, 'active'))).get()
    if (!row) return
    const st = CombatState.parse(row.state)
    const want = new Map<string, number>()
    for (const r of this.db.select().from(encounterCreature).where(and(eq(encounterCreature.encounterId, encounterId), eq(encounterCreature.status, 'active'))).all()) {
      want.set(r.entityId, (want.get(r.entityId) ?? 0) + r.count)
    }
    let list = [...st.combatants]
    const log = [...st.log]
    const ids = new Set([...want.keys(), ...list.filter((c) => c.side === 'foe' && c.entityId).map((c) => c.entityId!)])
    for (const eid of ids) {
      const mine = list.filter((c) => c.side === 'foe' && c.entityId === eid)
      const need = want.get(eid) ?? 0
      if (need > mine.length) {
        const name = this.entityRow(eid).name
        // "Bandit" becomes "Bandit 1" once a second one joins.
        if (mine.length === 1 && mine[0].name === name) list = list.map((c) => (c.id === mine[0].id ? { ...c, name: `${name} 1` } : c))
        const used = new Set(list.map((c) => c.name))
        let k = 1
        for (let n = mine.length; n < need; n++) {
          while (used.has(`${name} ${k}`)) k++
          const label = need > 1 ? `${name} ${k}` : name
          used.add(label)
          list.push(this.fightCombatant(eid, 'foe', label))
          log.push(`Round ${st.round}: ${label} joins the fight.`)
        }
      } else if (need < mine.length) {
        const unhurt = (c: Combatant) => c.hp >= c.maxHp && !c.conditions.length && !c.out
        const leave = [...mine].sort((a, b) => Number(unhurt(b)) - Number(unhurt(a)) || list.indexOf(b) - list.indexOf(a)).slice(0, mine.length - need)
        for (const c of leave) log.push(`Round ${st.round}: ${c.name} leaves the fight (taken out of the encounter).`)
        const current = list[st.turn]?.id
        list = list.filter((c) => !leave.includes(c))
        st.turn = Math.max(0, list.findIndex((c) => c.id === current))
      }
    }
    w.update('combat', row.id, { state: { ...st, combatants: list, log, turn: Math.min(st.turn, Math.max(0, list.length - 1)) } })
  }

  /** A new player character joins every running fight on the party side. */
  private joinFights(w: Writer, entityId: string): void {
    for (const row of this.db.select().from(combat).where(eq(combat.status, 'active')).all()) {
      const st = CombatState.parse(row.state)
      const c = this.fightCombatant(entityId, 'party', this.entityRow(entityId).name)
      w.update('combat', row.id, { state: { ...st, combatants: [...st.combatants, c], log: [...st.log, `Round ${st.round}: ${c.name} joins the fight.`] } })
    }
  }

  /** What the tracker knows about a card: hints, CR or level, limited abilities, defences, spell slots. */
  private combatantInfo(entityId: string, partyLevel: number): CombatantInfo | null {
    const e = this.db.select().from(entity).where(eq(entity.id, entityId)).get()
    if (!e) return null
    const sb = readStatBlock(e.attributes.statblock)
    const acts = this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all()
    const texts = [...(sb?.traits ?? []).map((t) => ({ name: t.name, text: t.desc })), ...acts.map((a) => ({ name: a.name, text: a.description }))]
    const all = texts.map((t) => `${t.name}. ${t.text}`).join('\n')
    const split = texts.find((t) => /^split\b/i.test(t.name) || /\bsplits? into two\b/i.test(t.text))
    const lvl = Number.parseInt(String(e.attributes.level ?? ''), 10)
    const level = e.type === 'PC' ? (Number.isFinite(lvl) && lvl > 0 ? lvl : null) : null
    const nums = (v: unknown) => (Array.isArray(v) ? Array.from({ length: 9 }, (_, i) => Math.max(0, Number(v[i]) || 0)) : null)
    const dc = /spell save DC\s*(\d+)/i.exec(all) ?? /\bDC\s*(\d+)/.exec(all)
    return {
      creatureType: sb?.creatureType ?? '',
      leader: isLeaderName(e.name) || texts.some((t) => /\bleadership\b/i.test(t.name)),
      boosts: texts.filter((t) => boostsAllies(t.text)).map((t) => ({ name: t.name, text: t.text.length > 220 ? `${t.text.slice(0, 220)}…` : t.text })),
      legendary: acts.some((a) => a.kind === 'LEGENDARY_ACTION'),
      recharge: limitedUses(texts).filter((l) => l.kind === 'recharge').map((l) => `${l.name} (Recharge ${l.recharge})`),
      cr: e.type === 'PC' ? '' : sb?.cr ?? '',
      level: e.type === 'PC' ? level ?? partyLevel : null,
      xp: e.type === 'PC' ? 0 : xpForCr(sb?.cr ?? ''),
      pp: sb ? passiveScore(sb, 'Perception') : null,
      saveDc: dc ? Number(dc[1]) : null,
      dexMod: sb ? Math.floor((sb.dex - 10) / 2) : 0,
      resist: sb?.resistances ?? '', immune: sb?.immunities ?? '', vuln: sb?.vulnerabilities ?? '',
      limited: limitedUses(texts),
      legendaryActions: legendaryCount(texts.map((t) => t.text), acts.some((a) => a.kind === 'LEGENDARY_ACTION')),
      lair: /lair action/i.test(all),
      split: split ? DAMAGE_TYPES.filter((d) => new RegExp(`\\b${d}\\b`, 'i').test(split.text)) : null,
      splitOnBloodied: !!split && /becomes bloodied/i.test(split.text),
      mirrorImage: /mirror image/i.test(all),
      displacement: texts.some((t) => /^displacement\b/i.test(t.name)),
      actions: acts.map((a) => ({ name: a.name, kind: a.kind, text: a.description.length > 300 ? `${a.description.slice(0, 300)}…` : a.description })),
      slots: nums(e.attributes.spell_slots) ?? slotsFromText(all),
      slotsUsed: nums(e.attributes.slots_used) ?? Array<number>(9).fill(0),
      cardType: e.type,
      size: sb?.size ?? ''
    }
  }

  combatView(id: string): CombatView {
    const row = this.db.select().from(combat).where(eq(combat.id, id)).get()
    if (!row || row.status === 'defunct') throw new Error('That fight is no longer here')
    const state = CombatState.parse(row.state)
    const partyLevel = Number(this.setting('party_level') ?? 1)
    const info: Record<string, CombatantInfo> = {}
    for (const entityId of new Set(state.combatants.map((c) => c.entityId).filter((x): x is string => !!x))) {
      const i = this.combatantInfo(entityId, partyLevel)
      if (i) info[entityId] = i
    }
    return {
      id, encounterId: row.encounterId, encounterName: this.nameOf(row.encounterId), status: row.status === 'ended' ? 'ended' : 'active',
      state, info, sessionRunning: !!this.openSession()
    }
  }

  /** The DM's change to the fight (damage, a condition, the next turn…): one undo step each. */
  updateCombat(id: string, state: CombatState, label: string): void {
    this.log.run(label, (w) => { w.update('combat', id, { state }) })
  }

  /** Ends the fight (one undo step): optionally marks defeated cards resolved and logs a summary in the running session. */
  endCombat(id: string, opts: { resolveIds?: string[]; summary?: string } = {}): void {
    const row = this.db.select().from(combat).where(eq(combat.id, id)).get()
    if (!row) throw new Error('That fight is no longer here')
    const open = this.openSession()
    this.log.run(`Ended the fight: ${this.nameOf(row.encounterId)}`, (w) => {
      w.update('combat', id, { status: 'ended' })
      for (const eid of opts.resolveIds ?? []) {
        const e = this.db.select().from(entity).where(eq(entity.id, eid)).get()
        if (e && e.status === 'active') w.update('entity', eid, { status: 'resolved' })
      }
      if (open && opts.summary?.trim()) {
        w.insert('log_entry', {
          id: randomUUID(), sessionId: open.id, atMin: this.info().clockMin, kind: 'fight', text: opts.summary.trim().slice(0, 5000),
          entityId: null, minutesTaken: 0, createdAt: new Date().toISOString(), status: 'active', encounterId: row.encounterId
        })
      }
    })
  }

  updateEncounterCreature(rowId: string, patch: { count?: number; notes?: string }): void {
    const r = this.creatureRow(rowId)
    this.log.run(`Changed ${this.nameOf(r.entityId)} in ${this.nameOf(r.encounterId)}`, (w) => {
      w.update('encounter_creature', rowId, patch.count === 0 ? { status: 'defunct' } : patch)
      this.syncFight(w, r.encounterId)
    })
  }

  setEncounterCreatureStatus(rowId: string, status: RowStatus): void {
    const r = this.creatureRow(rowId)
    this.log.run(`${status === 'defunct' ? 'Took' : 'Put'} ${this.nameOf(r.entityId)} ${status === 'defunct' ? 'out of' : 'back in'} ${this.nameOf(r.encounterId)}`, (w) => {
      w.update('encounter_creature', rowId, { status })
      this.syncFight(w, r.encounterId)
    })
  }

  /** Legacy encounters have no rows yet: turn them into rows, then act on the one for this card. */
  removeEncounterCreature(encounterId: string, entityId: string): void {
    this.log.run(`Took ${this.nameOf(entityId)} out of ${this.nameOf(encounterId)}`, (w) => {
      this.adoptLegacyCreatures(w, encounterId)
      const row = this.db.select().from(encounterCreature).where(and(eq(encounterCreature.encounterId, encounterId), eq(encounterCreature.entityId, entityId), eq(encounterCreature.status, 'active'))).get()
      if (row) w.update('encounter_creature', row.id, { status: 'defunct' })
      this.syncFight(w, encounterId)
    })
  }

  /** Logs the encounter as a fight in the running session, linked to the plan. */
  runEncounter(encounterId: string): LogView {
    const e = this.entityRow(encounterId)
    return this.addLog({ kind: 'fight', text: e.name, encounterId })
  }

  private creatureRow(id: string) {
    const r = this.db.select().from(encounterCreature).where(eq(encounterCreature.id, id)).get()
    if (!r) throw new Error(`No encounter line with id ${id}`)
    return r
  }

  // ---- live: where the party is

  /** The party's latest position on any map, with the map it is on. */
  private partyNow(): (PartyMarker & { mapId: string }) | null {
    const nowMin = this.info().clockMin
    return this.maps().map((m) => { const p = this.partyAt(m.id, nowMin); return p ? { ...p, mapId: m.id } : null })
      .filter((p): p is PartyMarker & { mapId: string } => !!p)
      .sort((a, b) => a.atMin - b.atMin).at(-1) ?? null
  }

  /** People the party has met: a logged meeting, or their name is known. */
  private metIds(): Set<string> {
    const met = new Set(this.db.select().from(logEntry).where(and(eq(logEntry.status, 'active'), eq(logEntry.kind, 'meeting'))).all()
      .map((l) => l.entityId).filter((x): x is string => !!x))
    for (const k of this.db.select().from(knowledge).where(eq(knowledge.status, 'active')).all()) if (k.field === 'name') met.add(k.entityId)
    return met
  }

  liveWhere(): WhereView {
    const nowMin = this.info().clockMin
    const party = this.partyNow()
    const names = new Map(this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name]))
    const prep = this.prepFor()
    const met = this.metIds()
    const places = this.db.select().from(entity).all().filter((e) => e.type === 'LOCATION' && (e.status === 'active' || e.status === 'resolved'))
      .sort((a, b) => a.name.localeCompare(b.name)).map((e) => ({ id: e.id, type: e.type as EntityType, name: e.name, status: e.status as EntityStatus }))

    let place: WhereView['place'] = null
    let people: WhereView['people'] = []
    const secrets: WhereView['secrets'] = []
    if (party?.locationId) {
      const loc = this.entityRow(party.locationId)
      const region = this.db.select().from(regionShape).where(and(eq(regionShape.locationId, loc.id), eq(regionShape.status, 'active'))).get()
      const notes = [loc.attributes.description, loc.attributes.notes].filter((x): x is string => typeof x === 'string' && !!x.trim()).join('\n\n')
      place = { locationId: loc.id, name: loc.name, notes, inside: loc.parentId ? names.get(loc.parentId) ?? null : null, mapId: party.mapId, regionId: region?.id ?? null }
      const detail = region ? this.regionDetail(region.id) : null
      const keyNpcs = new Set((prep?.items ?? []).filter((i) => i.kind === 'npc' && i.entityId).map((i) => i.entityId!))
      people = (detail?.hereNow ?? []).filter((e) => e.type !== 'PC')
        .map((e) => ({ id: e.id, name: e.name, type: e.type, met: met.has(e.id), keyNpc: keyNpcs.has(e.id) }))
        .sort((a, b) => Number(b.keyNpc) - Number(a.keyNpc) || Number(b.met) - Number(a.met) || a.name.localeCompare(b.name))
      // Secrets: secret strings the party does not know yet that touch this place or someone here.
      const here = new Set([loc.id, ...people.map((p) => p.id)])
      const known = new Set(this.db.select().from(relationshipKnown).where(eq(relationshipKnown.status, 'active')).all().map((k) => k.relationshipId))
      for (const r of this.db.select().from(relationship).where(and(eq(relationship.status, 'active'), eq(relationship.isSecret, true))).all()) {
        if (known.has(r.id) || !(here.has(r.sourceId) || here.has(r.targetId))) continue
        secrets.push({ id: r.id, source: 'string', text: `${names.get(r.sourceId) ?? '?'} ${r.type.toLowerCase().replace(/_/g, ' ')} ${names.get(r.targetId) ?? '?'}` })
      }
      for (const c of detail?.plotPoints ?? []) if (c.type === 'CLUE') secrets.push({ id: c.id, source: 'card', text: c.name })
      for (const c of (prep?.items ?? []).filter((i) => i.kind === 'clue' && i.locationId === loc.id)) {
        const d = prep!.items.find((x) => x.id === c.discoveryId)
        secrets.push({ id: c.id, source: 'clue', done: c.done, text: `${c.body || c.title}${d ? ` (leads to: ${d.title || 'a discovery'})` : ''}` })
      }
    }

    // Where they came from: the last position somewhere else.
    let cameFrom: WhereView['cameFrom'] = null
    if (party) {
      const before = this.db.select().from(partyPosition).where(and(eq(partyPosition.mapId, party.mapId), eq(partyPosition.status, 'active'))).all()
        .filter((p) => p.atMin <= nowMin && !p.entityId && p.locationId !== party.locationId)
        .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt)).at(-1)
      if (before) cameFrom = { name: before.locationId ? names.get(before.locationId) ?? 'somewhere' : 'between places', atMin: before.atMin }
    }

    const headingId = this.setting('heading_location_id')
    let headingTo: WhereView['headingTo'] = null
    if (typeof headingId === 'string' && names.has(headingId) && headingId !== party?.locationId) {
      let travel: string | null = null
      const region = this.db.select().from(regionShape).where(and(eq(regionShape.locationId, headingId), eq(regionShape.status, 'active'))).get()
      if (party && region && region.mapId === party.mapId) {
        const est = this.travelEstimate(party.mapId, centroid(region.polygon))
        if (est.minutes != null) travel = `about ${Math.floor(est.minutes / 60)} h ${est.minutes % 60} min`
      }
      headingTo = { locationId: headingId, name: names.get(headingId)!, travel }
    }

    const encounters: WhereView['encounters'] = []
    if (place) {
      const atPlace = new Set(this.db.select().from(relationship).where(and(eq(relationship.targetId, place.locationId), eq(relationship.type, 'LOCATED_AT'), eq(relationship.status, 'active'))).all().map((r) => r.sourceId))
      for (const e of this.encounterCards().filter((x) => atPlace.has(x.id))) {
        const v = this.encounterView(e.id)
        encounters.push({ id: e.id, name: e.name, rating: RATING_LABELS[v.difficulty.rating], totalXp: v.difficulty.totalXp, runs: v.runs.length })
      }
    }
    const tips: string[] = []
    if (!party) tips.push('Place the party on the map to see who and what is around them.')
    for (const e of encounters.filter((x) => x.runs === 0)) tips.push(`Encounter planned here: ${e.name} (${e.rating}).`)
    if (cameFrom) tips.push(`They came from ${cameFrom.name} (${formatClock(cameFrom.atMin)}).`)
    if (headingTo) tips.push(`They are heading to ${headingTo.name}${headingTo.travel ? `, ${headingTo.travel} away` : ''}.`)
    const metHere = people.filter((p) => p.met)
    if (metHere.length) tips.push(`They have met ${metHere.map((p) => p.name).join(', ')} here before.`)
    const newHere = people.filter((p) => !p.met && (p.type === 'NPC' || p.keyNpc))
    if (newHere.length) tips.push(`Not met yet: ${newHere.map((p) => p.name).join(', ')}.`)
    const open = secrets.filter((x) => !x.done)
    if (open.length) tips.push(`${open.length} secret${open.length === 1 ? '' : 's'} could come out here.`)
    const scenesHere = (prep?.items ?? []).filter((i) => i.kind === 'scene' && !i.done && place && i.locationId === place.locationId)
    for (const sc of scenesHere) tips.push(`Planned here: ${sc.title || 'a scene'}${sc.sceneType ? ` (${sc.sceneType})` : ''}.`)
    const next = (prep?.items ?? []).find((i) => i.kind === 'scene' && !i.done)
    if (next && !scenesHere.includes(next)) tips.push(`Next planned scene: ${next.title || 'untitled'}${next.locationName ? ` at ${next.locationName}` : ''}.`)
    return { place, cameFrom, headingTo, places, people, secrets, prep, encounters, tips }
  }

  /** Adds a paragraph to the DM notes journal (one undo step). */
  appendDmNotes(text: string): void {
    const open = this.openSession()
    const cur = open ? open.dmNotes : this.setting('dm_notes')
    const before = typeof cur === 'string' ? cur.trimEnd() : ''
    this.setDmNotes(before ? `${before}\n\n${text.trim()}` : text.trim(), 'Added to the DM notes')
  }

  /** The desk journal: the running session's notes, else the notes between sessions. */
  setDmNotes(text: string, label = 'Edited DM notes'): void {
    const open = this.openSession()
    if (open) this.log.run(`${label} (session ${open.number})`, (w) => { w.update('session', open.id, { dmNotes: text }) })
    else this.setSetting('dm_notes', text, label)
  }

  // ---- Notes screen: notes files (imported or written here) and session notes

  notesScreen(): NotesScreenView {
    const open = this.openSession()
    return {
      docs: this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((r) => ({ id: r.id, title: r.title, kind: r.kind as NoteDocView['kind'], originalName: r.originalName, updatedAt: r.updatedAt, versions: r.versions })),
      sessions: this.db.select().from(session).where(eq(session.status, 'active')).all()
        .sort((a, b) => b.number - a.number)
        .map((r) => ({ id: r.id, number: r.number, startedAt: r.startedAt, running: r.id === open?.id, dmNotes: r.dmNotes, recap: r.recap })),
      dmNotes: String(this.setting('dm_notes') ?? '')
    }
  }

  setSessionNotes(id: string, text: string): void {
    const r = this.sessionRow(id)
    this.log.run(`Edited the notes of session ${r.number}`, (w) => { w.update('session', id, { dmNotes: text }) })
  }

  private noteRow(id: string) {
    const r = this.db.select().from(noteDoc).where(eq(noteDoc.id, id)).get()
    if (!r) throw new Error('That note is gone')
    return r
  }

  /** The note's current file on disk. */
  noteFile(id: string): string {
    return join(this.folder, ASSETS_DIR, this.noteRow(id).file)
  }

  /** Copies a file into the notes folder (never changed after; a save writes a new one). */
  private storeNoteFile(from: { file: string } | { bytes: Buffer; ext: string }): string {
    const ext = 'file' in from ? extname(from.file).toLowerCase() : from.ext
    const rel = `notes/${randomUUID()}${ext}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'notes'), { recursive: true })
    if ('file' in from) copyFileSync(from.file, join(this.folder, ASSETS_DIR, rel))
    else writeFileSync(join(this.folder, ASSETS_DIR, rel), from.bytes)
    return rel
  }

  /** Keeps a notes file (from an import or Word). With `replaceId`, it becomes that note's new version. */
  addNoteDoc(sourceFile: string, replaceId?: string): string {
    const ext = extname(sourceFile).toLowerCase()
    const kind = noteKind(ext)
    const rel = this.storeNoteFile({ file: sourceFile })
    const now = new Date().toISOString()
    if (replaceId) {
      const r = this.noteRow(replaceId)
      this.log.run(`Replaced the note ${r.title}`, (w) => {
        w.update('note_doc', r.id, { file: rel, kind, updatedAt: now, versions: [{ file: r.file, at: r.updatedAt }, ...r.versions].slice(0, 50) })
      })
      return r.id
    }
    const id = randomUUID()
    const title = basename(sourceFile, extname(sourceFile))
    this.log.run(`Kept the notes file ${basename(sourceFile)}`, (w) => {
      w.insert('note_doc', { id, title, kind, file: rel, originalName: basename(sourceFile), versions: [], status: 'active', createdAt: now, updatedAt: now })
    })
    return id
  }

  createNoteDoc(title: string, bytes: Buffer): string {
    const rel = this.storeNoteFile({ bytes, ext: '.docx' })
    const id = randomUUID()
    const now = new Date().toISOString()
    this.log.run(`New note ${title}`, (w) => {
      w.insert('note_doc', { id, title, kind: 'word', file: rel, originalName: `${title}.docx`, versions: [], status: 'active', createdAt: now, updatedAt: now })
    })
    return id
  }

  /** Saves a new version of a note as a Word file (one undo step; the old version stays listed). */
  saveNoteVersion(id: string, bytes: Buffer, label = 'Saved the note'): void {
    const r = this.noteRow(id)
    const rel = this.storeNoteFile({ bytes, ext: '.docx' })
    this.log.run(`${label} ${r.title}`, (w) => {
      w.update('note_doc', id, { file: rel, kind: 'word', updatedAt: new Date().toISOString(), versions: [{ file: r.file, at: r.updatedAt }, ...r.versions].slice(0, 50) })
    })
  }

  /** Brings an earlier version back (the current one joins the earlier versions). */
  restoreNoteVersion(id: string, file: string): void {
    const r = this.noteRow(id)
    const v = r.versions.find((x) => x.file === file)
    if (!v) throw new Error('That version is gone')
    this.log.run(`Brought back an earlier version of ${r.title}`, (w) => {
      w.update('note_doc', id, {
        file: v.file, kind: noteKind(extname(v.file)), updatedAt: new Date().toISOString(),
        versions: [{ file: r.file, at: r.updatedAt }, ...r.versions.filter((x) => x.file !== file)]
      })
    })
  }

  renameNoteDoc(id: string, title: string): void {
    const r = this.noteRow(id)
    this.log.run(`Renamed note ${r.title} to ${title}`, (w) => { w.update('note_doc', id, { title }) })
  }

  setNoteDocStatus(id: string, status: RowStatus): void {
    const r = this.noteRow(id)
    this.log.run(status === 'defunct' ? `Moved note ${r.title} to History` : `Restored note ${r.title}`, (w) => { w.update('note_doc', id, { status }) })
  }

  /** Notes whose original file has the same name (asked before an import: replace or keep both). */
  noteDocsNamed(names: string[]): Array<{ id: string; title: string; originalName: string }> {
    const want = new Set(names.map((n) => n.toLowerCase()))
    return this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all()
      .filter((r) => want.has(r.originalName.toLowerCase())).map((r) => ({ id: r.id, title: r.title, originalName: r.originalName }))
  }

  // Open in Word: a copy with the note's name in notes-edit/ (Word changes it there, not the kept versions).
  private editState(): Record<string, { path: string; mtime: number }> {
    try { return JSON.parse(readFileSync(join(this.folder, 'notes-edit', 'state.json'), 'utf8')) } catch { return {} }
  }
  private saveEditState(st: Record<string, { path: string; mtime: number }>): void {
    mkdirSync(join(this.folder, 'notes-edit'), { recursive: true })
    writeFileSync(join(this.folder, 'notes-edit', 'state.json'), JSON.stringify(st))
  }

  /** The Word copy to open (made fresh from the current version unless Word has unsaved-here changes). */
  editCopy(id: string): string {
    const r = this.noteRow(id)
    const st = this.editState()
    const known = st[id]
    if (known && existsSync(known.path) && statSync(known.path).mtimeMs > known.mtime) return known.path
    const safe = r.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().slice(0, 80) || 'Note'
    const path = join(this.folder, 'notes-edit', `${safe}${extname(r.file)}`)
    mkdirSync(join(this.folder, 'notes-edit'), { recursive: true })
    copyFileSync(join(this.folder, ASSETS_DIR, r.file), path)
    st[id] = { path, mtime: statSync(path).mtimeMs }
    this.saveEditState(st)
    return path
  }

  /** Notes changed in Word since they were opened from here. */
  editedInWord(): Array<{ id: string; title: string }> {
    const st = this.editState()
    return Object.entries(st).flatMap(([id, e]) => {
      if (!existsSync(e.path) || statSync(e.path).mtimeMs <= e.mtime) return []
      const r = this.db.select().from(noteDoc).where(eq(noteDoc.id, id)).get()
      return r && r.status === 'active' ? [{ id, title: r.title }] : []
    })
  }

  /** Brings Word's changes in as a new version. */
  takeWordEdit(id: string): void {
    const st = this.editState()
    const e = st[id]
    if (!e || !existsSync(e.path)) throw new Error('The Word copy is gone')
    this.saveNoteVersion(id, readFileSync(e.path), 'Brought in Word changes to')
    st[id] = { ...e, mtime: statSync(e.path).mtimeMs }
    this.saveEditState(st)
  }

  /** Player preview: what the party has seen and learned, nothing else. */
  playersView(): PlayersView {
    const nowMin = this.info().clockMin
    const all = this.db.select().from(entity).all()
    const byId = new Map(all.map((e) => [e.id, e]))
    const text = (e: EntityRow | undefined, k: string) => (e && typeof e.attributes[k] === 'string' ? (e.attributes[k] as string).trim() : '')
    const where = this.liveWhere()
    const placeRow = where.place ? byId.get(where.place.locationId) : undefined

    // Recap: the latest player-safe recap written for a session.
    const recapRow = this.db.select().from(session).where(eq(session.status, 'active')).all()
      .filter((x) => x.playerRecap.trim()).sort((a, b) => b.number - a.number)[0]

    // People: met in play, or with a known field; only the known fields are shown.
    const known = new Map<string, Set<string>>()
    for (const k of this.db.select().from(knowledge).where(eq(knowledge.status, 'active')).all()) {
      if (k.knownFromMin > nowMin) continue
      if (!known.has(k.entityId)) known.set(k.entityId, new Set())
      known.get(k.entityId)!.add(k.field)
    }
    const met = this.metIds()
    const people = [...new Set([...met, ...known.keys()])]
      .map((id) => byId.get(id)).filter((e): e is EntityRow => !!e && e.status !== 'defunct' && ['NPC', 'FACTION', 'MONSTER'].includes(e.type))
      .map((e) => {
        const f = known.get(e.id) ?? new Set<string>()
        const facts: Array<{ label: string; value: string }> = []
        if (f.has('location') && text(e, 'location')) facts.push({ label: 'Where', value: text(e, 'location') })
        if (f.has('motivation') && text(e, 'motivation')) facts.push({ label: 'Wants', value: text(e, 'motivation') })
        if (f.has('statblock')) { const sb = readStatBlock(e.attributes.statblock); if (sb) facts.push({ label: 'Seen in a fight', value: statLine(sb) }) }
        if (f.has('bio') && text(e, 'bio')) facts.push({ label: 'About', value: text(e, 'bio') })
        if (text(e, 'player_notes')) facts.push({ label: 'Note', value: text(e, 'player_notes') })
        // Met but the name was never learned: they are "a stranger" (same rule as the player recap).
        const name = f.has('name') ? e.name : 'A stranger'
        return { id: e.id, name, type: e.type as EntityType, facts }
      })
      .sort((a, b) => a.name.localeCompare(b.name))

    const preps = new Map(this.db.select().from(sessionPrep).where(eq(sessionPrep.status, 'active')).all().map((p) => [p.id, p.number]))
    const discoveries = this.db.select().from(prepItem).where(and(eq(prepItem.kind, 'discovery'), eq(prepItem.status, 'active'), eq(prepItem.done, true))).all()
      .filter((i) => preps.has(i.prepId) && (i.doneAtMin ?? 0) <= nowMin)
      .sort((a, b) => (a.doneAtMin ?? 0) - (b.doneAtMin ?? 0))
      .map((i) => ({ id: i.id, title: i.title, text: i.body, session: preps.get(i.prepId)! }))

    const knownStrings = new Set(this.db.select().from(relationshipKnown).where(eq(relationshipKnown.status, 'active')).all()
      .filter((k) => k.knownFromMin <= nowMin).map((k) => k.relationshipId))
    const connections = this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
      .filter((r) => knownStrings.has(r.id))
      .map((r) => `${byId.get(r.sourceId)?.name ?? '?'} ${r.type.toLowerCase().replace(/_/g, ' ')} ${byId.get(r.targetId)?.name ?? '?'}`)

    // The map: only regions of places they have been.
    let map: PlayersView['map'] = null
    if (where.place) {
      const full = this.mapScreen(where.place.mapId)
      const visited = new Set(this.db.select().from(partyPosition).where(and(eq(partyPosition.status, 'active'), eq(partyPosition.mapId, where.place.mapId))).all()
        .filter((p) => p.atMin <= nowMin).map((p) => p.locationId).filter((x): x is string => !!x))
      const regions = full.regions.filter((r) => visited.has(r.locationId))
      const notes: Record<string, string> = {}
      for (const r of regions) notes[r.id] = text(byId.get(r.locationId), 'player_notes')
      map = { view: { ...full, regions, unplacedLocations: [] }, notes }
    }
    return {
      campaignName: this.info().name,
      when: formatClock(nowMin),
      light: skyAt(nowMin).light,
      recap: recapRow ? { number: recapRow.number, text: recapRow.playerRecap } : null,
      place: placeRow ? { name: placeRow.name, inside: where.place!.inside, notes: text(placeRow, 'player_notes') } : null,
      cameFrom: where.cameFrom?.name ?? null,
      headingTo: where.headingTo?.name ?? null,
      people, discoveries, connections, map
    }
  }

  setHeading(locationId: string | null): void {
    this.setSetting('heading_location_id', locationId, locationId ? `Party heading to ${this.nameOf(locationId)}` : 'Cleared where the party is heading')
  }

  // ---- session prep (the DM's one-page prep sheet per session)

  /** The session that is running, if any, and the number the next session will get. */
  private sessionNumbers(): { openNumber: number | null; nextNumber: number } {
    const all = this.db.select().from(session).all()
    const open = all.find((x) => x.status === 'active' && x.endedAt === null)
    return { openNumber: open?.number ?? null, nextNumber: all.reduce((n, x) => Math.max(n, x.number), 0) + 1 }
  }

  prepScreen(): PrepScreenView {
    const brief = (e: EntityRow): EntityBrief => ({ id: e.id, type: e.type as EntityType, name: e.name, status: e.status as EntityStatus })
    const live = this.db.select().from(entity).all().filter((e) => e.status === 'active' || e.status === 'resolved' || e.status === 'stashed')
      .sort((a, b) => a.name.localeCompare(b.name))
    return {
      sheets: this.db.select().from(sessionPrep).where(eq(sessionPrep.status, 'active')).all()
        .sort((a, b) => a.number - b.number).map((p) => ({ id: p.id, number: p.number, title: p.title })),
      ...this.sessionNumbers(),
      people: live.filter((e) => e.type === 'NPC' || e.type === 'FACTION').map(brief),
      threats: live.filter((e) => e.type === 'MONSTER' || e.type === 'NPC').map(brief),
      locations: live.filter((e) => e.type === 'LOCATION').map(brief)
    }
  }

  /** The prep sheet for a session number (by default the running session, else the next one). */
  prepFor(number?: number): PrepView | null {
    const n = number ?? (() => { const s = this.sessionNumbers(); return s.openNumber ?? s.nextNumber })()
    const row = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, n), eq(sessionPrep.status, 'active'))).get()
    return row ? this.prepView(row.id) : null
  }

  prepView(id: string): PrepView {
    const p = this.prepRow(id)
    const names = new Map(this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name]))
    const items = this.db.select().from(prepItem).where(and(eq(prepItem.prepId, id), eq(prepItem.status, 'active'))).all()
      .sort((a, b) => a.sort - b.sort)
      .map((i): PrepItemView => ({
        id: i.id, kind: i.kind as PrepKind, title: i.title, body: i.body, sceneType: (i.sceneType as SceneType | null) ?? null,
        targetStart: i.targetStart, targetEnd: i.targetEnd,
        entityId: i.entityId, entityName: i.entityId ? names.get(i.entityId) ?? null : null,
        locationId: i.locationId, locationName: i.locationId ? names.get(i.locationId) ?? null : null,
        discoveryId: i.discoveryId, role: i.role, stats: i.stats, tactics: i.tactics, done: i.done, doneAtMin: i.doneAtMin
      }))
    return { id: p.id, number: p.number, title: p.title, premise: p.premise, pacingMinutes: p.pacingMinutes, backupNames: p.backupNames, notes: p.notes, items }
  }

  createPrep(number: number): string {
    const existing = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, number), eq(sessionPrep.status, 'active'))).get()
    if (existing) return existing.id
    const id = randomUUID()
    this.log.run(`Started the prep sheet for session ${number}`, (w) => {
      w.insert('session_prep', { id, number, title: '', premise: '', pacingMinutes: 180, backupNames: '', notes: '', status: 'active' })
    })
    return id
  }

  updatePrep(id: string, patch: Partial<Pick<PrepRow, 'number' | 'title' | 'premise' | 'pacingMinutes' | 'backupNames' | 'notes'>>): void {
    const p = this.prepRow(id)
    if (patch.number !== undefined && patch.number !== p.number) {
      const taken = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, patch.number), eq(sessionPrep.status, 'active'))).get()
      if (taken) throw new Error(`Session ${patch.number} already has a prep sheet`)
    }
    this.log.run(`Edited the prep sheet for session ${p.number}`, (w) => { w.update('session_prep', id, patch) })
  }

  setPrepStatus(id: string, status: RowStatus): void {
    const p = this.prepRow(id)
    if (status === 'active') {
      const taken = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, p.number), eq(sessionPrep.status, 'active'))).get()
      if (taken && taken.id !== id) throw new Error(`Session ${p.number} already has a prep sheet; change its number first`)
    }
    this.log.run(status === 'defunct' ? `Moved the prep sheet for session ${p.number} to History` : `Restored the prep sheet for session ${p.number}`, (w) => {
      w.update('session_prep', id, { status })
    })
  }

  addPrepItem(prepId: string, kind: PrepKind, fields: PrepItemPatch = {}): string {
    const p = this.prepRow(prepId)
    const siblings = this.db.select().from(prepItem).where(and(eq(prepItem.prepId, prepId), eq(prepItem.kind, kind))).all()
    const id = randomUUID()
    const fromCard = fields.entityId ? this.db.select().from(entity).where(eq(entity.id, fields.entityId)).get() : undefined
    const title = fields.title ?? fromCard?.name ?? ''
    const card = fromCard ? this.prepFromCard(kind, fromCard) : {}
    this.log.run(`Added a ${PREP_LABELS[kind]} to the prep for session ${p.number}`, (w) => {
      w.insert('prep_item', {
        id, prepId, kind, sort: siblings.reduce((n, x) => Math.max(n, x.sort), 0) + 1, title, body: '',
        sceneType: kind === 'scene' ? 'exploration' : null, targetStart: null, targetEnd: null, entityId: null, locationId: null,
        discoveryId: null, role: '', stats: '', tactics: '', done: false, doneAtMin: null, status: 'active', ...card, ...fields, ...(title ? { title } : {})
      })
    })
    return id
  }

  /** What a linked card fills in: an NPC's role and look, a monster's stat line. The DM can change it all. */
  private prepFromCard(kind: PrepKind, e: EntityRow): PrepItemPatch {
    const a = e.attributes as Record<string, unknown>
    const text = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '')
    if (kind === 'npc') return { role: [text('occupation') || text('role'), text('faction')].filter(Boolean).join(', '), body: text('appearance') || text('quirk') || text('motivation') }
    if (kind === 'threat') {
      const sb = readStatBlock(a.statblock)
      return { stats: sb ? statLine(sb) : '', tactics: text('tactics') }
    }
    return {}
  }

  updatePrepItem(id: string, patch: PrepItemPatch): void {
    const i = this.prepItemRow(id)
    if (patch.entityId) Object.assign(patch, { ...this.prepFromCard(i.kind as PrepKind, this.entityRow(patch.entityId)), ...patch })
    this.log.run(`Edited ${PREP_LABELS[i.kind as PrepKind]} ${i.title || ''}`.trim(), (w) => { w.update('prep_item', id, patch) })
  }

  /** Ticks a discovery as revealed, a scene as played or a clue as found, at the campaign time. */
  setPrepDone(id: string, done: boolean): void {
    const i = this.prepItemRow(id)
    const what = i.kind === 'discovery' ? (done ? 'Revealed' : 'Unrevealed') : i.kind === 'scene' ? (done ? 'Played' : 'Unplayed') : done ? 'Found' : 'Unfound'
    this.log.run(`${what} ${i.title || PREP_LABELS[i.kind as PrepKind]}`, (w) => {
      w.update('prep_item', id, { done, doneAtMin: done ? this.info().clockMin : null })
    })
  }

  setPrepItemStatus(id: string, status: RowStatus): void {
    const i = this.prepItemRow(id)
    this.log.run(`${status === 'defunct' ? 'Removed' : 'Restored'} ${PREP_LABELS[i.kind as PrepKind]} ${i.title}`.trim(), (w) => {
      w.update('prep_item', id, { status })
    })
  }

  movePrepItem(id: string, direction: -1 | 1): void {
    const i = this.prepItemRow(id)
    const list = this.db.select().from(prepItem).where(and(eq(prepItem.prepId, i.prepId), eq(prepItem.kind, i.kind), eq(prepItem.status, 'active'))).all()
      .sort((a, b) => a.sort - b.sort)
    const at = list.findIndex((x) => x.id === id)
    const other = list[at + direction]
    if (!other) return
    this.log.run(`Moved ${PREP_LABELS[i.kind as PrepKind]} ${i.title}`.trim(), (w) => {
      w.update('prep_item', id, { sort: other.sort })
      w.update('prep_item', other.id, { sort: i.sort })
    })
  }

  /** Spreads the scenes evenly over the pacing target (one undo step). */
  spreadSceneTimes(prepId: string): void {
    const p = this.prepRow(prepId)
    const scenes = this.db.select().from(prepItem).where(and(eq(prepItem.prepId, prepId), eq(prepItem.kind, 'scene'), eq(prepItem.status, 'active'))).all()
      .sort((a, b) => a.sort - b.sort)
    if (!scenes.length) return
    const each = p.pacingMinutes / scenes.length
    this.log.run(`Spread the scene times for session ${p.number}`, (w) => {
      scenes.forEach((x, k) => w.update('prep_item', x.id, { targetStart: Math.round((k * each) / 5) * 5, targetEnd: Math.round(((k + 1) * each) / 5) * 5 }))
    })
  }

  private prepRow(id: string): PrepRow {
    const r = this.db.select().from(sessionPrep).where(eq(sessionPrep.id, id)).get()
    if (!r) throw new Error(`No prep sheet with id ${id}`)
    return r
  }

  private prepItemRow(id: string): PrepItemRow {
    const r = this.db.select().from(prepItem).where(eq(prepItem.id, id)).get()
    if (!r) throw new Error(`No prep line with id ${id}`)
    return r
  }

  /** How long the party would take to get to (x, y), and which region that is. Nothing is saved. */
  travelEstimate(mapId: string, to: Point): TravelEstimateView {
    const m = this.mapRow(mapId)
    const regions = this.regionViews(mapId)
    const dest = regionAt(to, regions)
    const party = this.partyAt(mapId, this.info().clockMin)
    const from: Point | null = party ? [party.x, party.y] : null
    if (!from) {
      return { minutes: 0, km: null, basis: 'the party is placed here for the first time', fromName: null, toName: dest?.name ?? null, toLocationId: dest?.locationId ?? null }
    }
    // A remembered time for this trip, or else for the way back (the same road both ways unless the DM says otherwise).
    const link = (fromId: string, toId: string) =>
      this.db.select().from(travelLink).where(and(eq(travelLink.status, 'active'), eq(travelLink.fromLocationId, fromId), eq(travelLink.toLocationId, toId))).get()
    const saved = party?.locationId && dest ? link(party.locationId, dest.locationId) ?? link(dest.locationId, party.locationId) : undefined
    // Measure between region centres when both ends are regions, so dropping anywhere inside gives the same answer.
    const fromRegion = party?.locationId ? regions.find((r) => r.locationId === party.locationId) : undefined
    const a = fromRegion ? centroid(fromRegion.polygon) : from
    const b = dest ? centroid(dest.polygon) : to
    const est = estimateTravel({ from: a, to: b, imageWidth: m.width, widthKm: m.widthKm, kmh: m.travelKmh, savedMinutes: saved?.minutes ?? null, units: this.info().units })
    return { ...est, fromName: party?.locationName ?? null, toName: dest?.name ?? null, toLocationId: dest?.locationId ?? null }
  }

  /**
   * Moves the party token: the clock moves on by the travel time, the party
   * arrives at the new place at the new time, and the trip is logged in the
   * running session. Optionally remembers the time for this route. One undo step.
   */
  moveParty(input: { mapId: string; x: number; y: number; minutes: number; rememberTime?: boolean }): void {
    this.mapRow(input.mapId)
    const now = this.info().clockMin
    const minutes = Math.max(0, Math.round(input.minutes))
    const dest = regionAt([input.x, input.y], this.regionViews(input.mapId))
    const from = this.partyAt(input.mapId, now)
    const open = this.openSession()
    const where = dest?.name ?? 'a new spot'
    this.log.run(`Party travelled to ${where}${minutes ? ` (${minutes >= 60 ? `${Math.round(minutes / 6) / 10} h` : `${minutes} min`})` : ''}`, (w) => {
      w.insert('party_position', {
        id: randomUUID(), mapId: input.mapId, x: input.x, y: input.y, locationId: dest?.locationId ?? null, atMin: now + minutes,
        sessionId: open?.id ?? null, createdAt: new Date().toISOString(), status: 'active'
      })
      if (minutes > 0) w.update('campaign_settings', 'clock_min', { value: now + minutes })
      if (open && from) {
        w.insert('log_entry', {
          id: randomUUID(), sessionId: open.id, atMin: now, kind: 'travel',
          text: `Travelled from ${from.locationName ?? 'the road'} to ${where}`, entityId: dest?.locationId ?? null,
          minutesTaken: minutes, createdAt: new Date().toISOString(), status: 'active'
        })
      }
      if (input.rememberTime && from?.locationId && dest) {
        const existing = this.db.select().from(travelLink).where(and(eq(travelLink.fromLocationId, from.locationId), eq(travelLink.toLocationId, dest.locationId))).get()
        if (existing) w.update('travel_link', existing.id, { minutes, status: 'active' })
        else w.insert('travel_link', { id: randomUUID(), fromLocationId: from.locationId, toLocationId: dest.locationId, minutes, status: 'active' })
      }
    })
  }

  /** Player characters at `atMin`: with the party, or split off (their latest own position, unless they joined back). */
  pcTokens(atMin: number): PcToken[] {
    const rows = this.db.select().from(partyPosition).where(eq(partyPosition.status, 'active')).all()
      .filter((p) => p.entityId && p.atMin <= atMin)
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
    const names = new Map(this.db.select().from(entity).all().filter((e) => e.type === 'LOCATION').map((e) => [e.id, e.name]))
    return this.db.select().from(entity).where(and(eq(entity.type, 'PC'), eq(entity.status, 'active'))).all()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => {
        const last = rows.filter((p) => p.entityId === e.id).at(-1)
        const split = last && !last.joined
          ? { mapId: last.mapId, x: last.x, y: last.y, locationId: last.locationId, locationName: last.locationId ? names.get(last.locationId) ?? null : null, atMin: last.atMin }
          : null
        return { entityId: e.id, name: e.name, split }
      })
  }

  /**
   * A player character's own token: split from the party, moved on its own (the clock stays:
   * it follows the party only), or merged back. One undo step each.
   */
  movePc(input: { entityId: string; mapId: string; x?: number; y?: number; joined?: boolean }): void {
    const m = this.mapRow(input.mapId)
    const pc = this.entityView(input.entityId)
    const now = this.info().clockMin
    const party = this.partyAt(input.mapId, now)
    const was = this.pcTokens(now).find((p) => p.entityId === pc.id)?.split
    // Split without a spot: next to the party (or the middle of the map).
    const x = input.x ?? (party ? party.x + 40 : (m.width ?? 1000) / 2)
    const y = input.y ?? (party ? party.y + 40 : (m.height ?? 1000) / 2)
    const at: Point = input.joined && party ? [party.x, party.y] : [x, y]
    const dest = regionAt(at, this.regionViews(input.mapId))
    const label = input.joined ? `${pc.name} rejoined the party` : was ? `${pc.name} went to ${dest?.name ?? 'a new spot'}` : `${pc.name} split from the party`
    const open = this.openSession()
    this.log.run(label, (w) => {
      w.insert('party_position', {
        id: randomUUID(), mapId: input.mapId, x: at[0], y: at[1], locationId: dest?.locationId ?? null, atMin: now,
        sessionId: open?.id ?? null, createdAt: new Date().toISOString(), status: 'active', entityId: pc.id, joined: !!input.joined
      })
      if (open) {
        w.insert('log_entry', {
          id: randomUUID(), sessionId: open.id, atMin: now, kind: 'travel', text: label, entityId: pc.id,
          minutesTaken: 0, createdAt: new Date().toISOString(), status: 'active'
        })
      }
    })
  }

  undo(): string | null { return this.log.undo() }
  redo(): string | null { return this.log.redo() }

  /** Undoes changes until the given log entry (inclusive) is undone. */
  undoTo(commandId: string): number {
    const entries = this.log.recent(1000)
    const index = entries.findIndex((c) => c.id === commandId)
    if (index < 0) throw new Error('That change is no longer in the log')
    let count = 0
    for (const c of entries.slice(0, index + 1)) {
      if (c.state === 'done') { this.log.undo(); count++ }
    }
    return count
  }

  // ---- helpers ---------------------------------------------------------------

  private placeCard(w: Writer, boardId: string, entityId: string, p: Position): void {
    if (this.cardItems(boardId, entityId).length > 0) return
    w.insert('board_item', {
      id: randomUUID(), boardId, kind: 'card', entityId, x: p.x, y: p.y, w: null, h: null, content: null, status: 'active'
    })
  }

  private linkToStoryline(w: Writer, entityId: string, storylineId: string, boardId: string, p: Position): void {
    const existing = this.db.select().from(storylineEntity).where(and(
      eq(storylineEntity.entityId, entityId), eq(storylineEntity.storylineId, storylineId)
    )).get()
    if (existing) w.update('storyline_entity', existing.id, { status: 'active' })
    else w.insert('storyline_entity', { id: randomUUID(), storylineId, entityId, status: 'active' })
    const items = this.cardItems(boardId, entityId, true)
    if (items.length > 0) for (const item of items) w.update('board_item', item.id, { status: 'active' })
    else {
      const global = this.boardSettings().linkPositions ? this.cardItems(this.globalBoard().id, entityId)[0] : undefined
      this.placeCard(w, boardId, entityId, global ? { x: global.x, y: global.y } : p)
    }
  }

  /** Card items for an entity on a board (one SQLite connection, so this sees the open transaction). */
  private cardItems(boardId: string, entityId: string, includeRemoved = false): BoardItemRow[] {
    return this.db.select().from(boardItem).where(and(
      eq(boardItem.boardId, boardId), eq(boardItem.entityId, entityId), eq(boardItem.kind, 'card')
    )).all().filter((i) => includeRemoved || i.status === 'active')
  }

  private insertAbility(w: Writer, entityId: string, a: NewAbility, sort: number): string {
    const id = randomUUID()
    w.insert('ability', {
      id, entityId, name: a.name, kind: a.kind ?? 'ACTION', description: a.description ?? '',
      macroText: a.macroText ?? '', showTokenAction: a.showTokenAction ?? true, showMacroBar: a.showMacroBar ?? false,
      sort, status: 'active'
    })
    return id
  }

  private abilityRow(id: string): AbilityRow {
    const row = this.db.select().from(ability).where(eq(ability.id, id)).get()
    if (!row) throw new Error(`No ability with id ${id}`)
    return row
  }

  private moveLabel(itemId: string): string {
    const item = this.itemRow(itemId)
    return item.entityId ? `Moved ${this.nameOf(item.entityId)}` : item.kind === 'image' ? 'Moved a picture' : 'Moved a note'
  }

  private nameOf(entityId: string): string {
    return this.db.select({ name: entity.name }).from(entity).where(eq(entity.id, entityId)).get()?.name ?? '?'
  }

  private entityRow(id: string): EntityRow {
    const row = this.db.select().from(entity).where(eq(entity.id, id)).get()
    if (!row) throw new Error(`No entity with id ${id}`)
    return row
  }

  private relationshipRow(id: string): RelationshipRow {
    const row = this.db.select().from(relationship).where(eq(relationship.id, id)).get()
    if (!row) throw new Error(`No string with id ${id}`)
    return row
  }

  private itemRow(id: string): BoardItemRow {
    const row = this.db.select().from(boardItem).where(eq(boardItem.id, id)).get()
    if (!row) throw new Error(`No board item with id ${id}`)
    return row
  }

  private boardRow(id: string): BoardRow {
    const row = this.db.select().from(board).where(eq(board.id, id)).get()
    if (!row) throw new Error(`No board with id ${id}`)
    return row
  }
}

function toEntityView(r: EntityRow, storylineIds: string[], acts: CardActMark[]): EntityView {
  return {
    id: r.id, type: r.type as EntityType, name: r.name, attributes: r.attributes, tags: r.tags,
    status: r.status as EntityStatus, parentId: r.parentId, storylineIds, hidden: r.hidden, acts
  }
}

function toRelationshipView(r: RelationshipRow): RelationshipView {
  return {
    id: r.id, sourceId: r.sourceId, targetId: r.targetId, type: r.type, isSecret: r.isSecret,
    status: r.status as RowStatus, hidden: r.hidden, boardId: r.boardId
  }
}

function toItemView(r: BoardItemRow): BoardItemView {
  return {
    id: r.id, kind: r.kind as BoardItemView['kind'], entityId: r.entityId, x: r.x, y: r.y, w: r.w, h: r.h,
    content: r.content ?? null, hidden: r.hidden
  }
}

function toAbilityView(r: AbilityRow): AbilityView {
  return {
    id: r.id, name: r.name, kind: r.kind as AbilityKind, description: r.description, macroText: r.macroText,
    showTokenAction: r.showTokenAction, showMacroBar: r.showMacroBar
  }
}

/** Everything searchable about an entity, lower-cased: name, type, tags and text fields (stat block included). */
function searchText(v: EntityView): string {
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

/** A SCENE card that is a planned encounter (planner) or was made by "Suggest an encounter". */
function isEncounter(e: EntityRow): boolean {
  return e.attributes.encounter === true || /^encounter\b/i.test(e.name)
}

function toMapView(r: MapRow): MapView {
  return {
    id: r.id, name: r.name, url: ASSET_URL_PREFIX + r.imagePath, width: r.width, height: r.height,
    widthKm: r.widthKm, travelKmh: r.travelKmh,
    kind: r.kind === 'battle' ? 'battle' : 'world',
    gridCols: r.gridCols,
    gridRows: r.gridCols && r.width && r.height ? rowsFor(r.gridCols, r.width, r.height) : null,
    source: r.source, prompt: r.prompt
  }
}

function toOutcomeView(o: OutcomeRow) {
  return { id: o.id, actId: o.actId, label: o.label, description: o.description, isDefault: o.isDefault }
}

function toEffect(t: TriggerRow): TriggerEffect {
  const p = t.payload
  if (t.effectType === 'shift_act') return { type: 'shift_act', actId: String(p.actId), minutes: Number(p.minutes) }
  if (t.effectType === 'force_outcome') return { type: 'force_outcome', actId: String(p.actId), outcomeId: String(p.outcomeId) }
  return { type: 'set_status', status: p.status as StorylineStatus }
}

function checkSpan(startMin: number, endMin: number): void {
  if (!Number.isInteger(startMin) || !Number.isInteger(endMin) || startMin < 0) throw new Error('Act times must be whole minutes from the campaign start')
  if (endMin <= startMin) throw new Error('An act must end after it starts')
}

function toSessionView(r: SessionRow): SessionView {
  return {
    id: r.id, number: r.number, startMin: r.startMin, endMin: r.endMin, ended: r.endedAt !== null, startedAt: r.startedAt,
    sceneText: r.sceneText, recap: r.recap, playerRecap: r.playerRecap
  }
}

function toLogView(l: LogRow, names: Map<string, string>): LogView {
  return {
    id: l.id, atMin: l.atMin, kind: l.kind as LogKind, text: l.text, entityId: l.entityId,
    entityName: l.entityId ? names.get(l.entityId) ?? null : null, minutesTaken: l.minutesTaken
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
