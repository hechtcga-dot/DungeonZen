import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { openDatabase, type OpenedDb } from '../db/open'
import {
  ability, act, actOutcome, board, boardItem, campaignSetting, entity, knowledge, logEntry, map, relationship, relationshipKnown,
  session, storyline, storylineEntity, storyTrigger, type AbilityRow, type ActRow, type LogRow, type MapRow, type OutcomeRow,
  type SessionRow, type TriggerRow, type BoardItemRow, type BoardRow, type EntityRow, type RelationshipRow
} from '../db/schema'
import { CommandLog, type Writer } from './commandLog'
import type {
  AbilityKind, EntityAttributes, EntityStatus, EntityType, KnowledgeField, LogKind, RowStatus, RulesEdition, StorylineStatus
} from '../../shared/schemas'
import { MINUTES_PER_DAY } from '../../shared/time'
import { formatClock } from '../../shared/time'
import { KNOWLEDGE_FIELDS } from '../../shared/schemas'
import { freeSpot } from '../../shared/layout'
import { imageSize } from '../imageSize'
import { crToNumber, HAS_STATBLOCK, leadingNumber, readStatBlock, StatBlock, statLine } from '../../shared/statblock'
import type {
  AbilityView, BoardItemView, BoardSummary, BoardView, CampaignInfo, DeskView, EntityBrief, EntityView, HistoryView,
  LibraryFilters, LibrarySearch, LiveView, LogView, MapView, RelationshipView, SessionView, SheetView, TimelineView,
  TriggerEffectView, WhatIfView
} from '../../shared/types'
import { advise } from '../advisor'
import { projectTimeline, whatIf, type TimelineInput, type TriggerEffect } from '../engine/timeline'

export const DB_FILE = 'campaign.db'
export const ASSETS_DIR = 'assets'
export const MAP_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
/** Address the app's asset protocol serves files from the open campaign's assets folder under. */
export const ASSET_URL_PREFIX = 'dz-asset://campaign/'

const DEFAULT_RULES_EDITION: RulesEdition = '2024'
const DEFAULT_CLOCK_MIN = 9 * 60 // Day 1, 09:00

export interface Position { x: number; y: number }

export type SettingKey =
  'name' | 'rules_edition' | 'clock_min' | 'moon_offset_days' | 'dm_notes' | 'active_map_id' | 'party_level' | 'last_long_rest_min'

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
        { key: 'clock_min', value: DEFAULT_CLOCK_MIN }
      ]).run()
      tx.insert(board).values({ id: randomUUID(), name: 'Global', storylineId: null }).run()
    })
    return campaign
  }

  static open(folder: string): Campaign {
    const file = join(folder, DB_FILE)
    if (!existsSync(file)) throw new Error(`No campaign found in ${folder} (missing ${DB_FILE})`)
    return new Campaign(folder, openDatabase(file))
  }

  close(): void {
    this.opened.sqlite.close()
  }

  // ---- reads ---------------------------------------------------------------

  info(): CampaignInfo {
    const settings = new Map(this.db.select().from(campaignSetting).all().map((s) => [s.key, s.value]))
    return {
      folder: this.folder,
      name: String(settings.get('name') ?? 'Untitled campaign'),
      rulesEdition: (settings.get('rules_edition') as RulesEdition) ?? DEFAULT_RULES_EDITION,
      clockMin: Number(settings.get('clock_min') ?? 0),
      globalBoardId: this.globalBoard().id
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
        ? { title: story.title, status: story.status as StorylineStatus, isMajor: story.isMajor, emblem: story.emblem }
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
    const relationships = visible.size === 0 ? [] : this.db
      .select()
      .from(relationship)
      .where(and(eq(relationship.status, 'active'), inArray(relationship.sourceId, [...visible])))
      .all()
      .filter((r) => visible.has(r.targetId))
    const boards = this.boards()
    return {
      board: boards.find((s) => s.id === boardId) ?? { id: b.id, name: b.name, storylineId: b.storylineId, storyline: null },
      boards,
      items: visibleItems.map(toItemView),
      entities: Object.fromEntries(entities.map((e) => [e.id, e])),
      relationships: relationships.map(toRelationshipView),
      undo: this.log.state()
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
    return rows.map((r) => toEntityView(r, links.filter((l) => l.entityId === r.id).map((l) => l.storylineId)))
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
      .where(and(eq(boardItem.kind, 'note'), eq(boardItem.status, 'defunct')))
      .all()
    return {
      removedEntities: removed.map((r) => toEntityView(r, [])),
      removedStrings: strings.map((r) => ({
        ...toRelationshipView(r),
        sourceName: names.get(r.sourceId) ?? '?',
        targetName: names.get(r.targetId) ?? '?'
      })),
      removedNotes: notes.map((n) => ({
        itemId: n.item.id,
        boardName: n.title ?? n.boardName,
        text: n.item.content?.text ?? ''
      })),
      removedStorylines: this.db.select().from(storyline).where(eq(storyline.removed, true)).all()
        .map((r) => ({ storylineId: r.id, title: r.title })),
      removedMaps: this.db.select().from(map).where(eq(map.status, 'defunct')).all().map((m) => ({ id: m.id, name: m.name })),
      ...this.removedTimeline(),
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
    this.log.run(input.label ?? `Added ${input.type.toLowerCase()} ${input.name}`, (w) => { id = this.insertEntity(w, input) })
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

  createRelationship(input: { sourceId: string; targetId: string; type: string; isSecret: boolean }): RelationshipView {
    if (input.sourceId === input.targetId) throw new Error('A string needs two different cards')
    const a = this.entityRow(input.sourceId)
    const b = this.entityRow(input.targetId)
    const id = randomUUID()
    this.log.run(`Linked ${a.name} to ${b.name}`, (w) => {
      w.insert('relationship', { id, ...input, status: 'active' })
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
    if (item.kind !== 'note') throw new Error('Not a note')
    this.log.run(status === 'defunct' ? 'Removed a note' : 'Restored a note', (w) => {
      w.update('board_item', itemId, { status })
    })
  }

  moveItems(moves: Array<{ itemId: string } & Position>): void {
    if (moves.length === 0) return
    const label = moves.length === 1 ? this.moveLabel(moves[0].itemId) : `Moved ${moves.length} items`
    this.log.run(label, (w) => {
      for (const m of moves) w.update('board_item', m.itemId, { x: m.x, y: m.y })
    })
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
      storyline: { title, status: 'inactive', isMajor: false, emblem: null }
    }
  }

  updateStoryline(
    storylineId: string,
    patch: { title?: string; status?: StorylineStatus; isMajor?: boolean; emblem?: string | null }
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

  /** Copies an image into assets/maps and makes it the desk map. */
  importMap(sourceFile: string, name?: string): MapView {
    const ext = extname(sourceFile).toLowerCase()
    if (!MAP_EXTENSIONS.includes(ext)) throw new Error(`Maps must be PNG, JPEG, WebP or GIF images (got ${ext || 'no extension'})`)
    const id = randomUUID()
    const rel = `maps/${id}${ext}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'maps'), { recursive: true })
    copyFileSync(sourceFile, join(this.folder, ASSETS_DIR, rel))
    const size = imageSize(readFileSync(join(this.folder, ASSETS_DIR, rel)))
    const mapName = name?.trim() || basename(sourceFile, extname(sourceFile))
    this.log.run(`Imported map ${mapName}`, (w) => {
      w.insert('map', {
        id, name: mapName, imagePath: rel, width: size?.width ?? null, height: size?.height ?? null,
        gridSize: null, status: 'active'
      })
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
        isMajor: storyline.isMajor, emblem: storyline.emblem, removed: storyline.removed
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
        const pp = sb ? /passive perception\s+(\d+)/i.exec(sb.senses) : null
        return {
          id: e.id, name: e.name,
          summary: typeof e.attributes.summary === 'string' ? e.attributes.summary : '',
          ac: sb?.ac ? String(leadingNumber(sb.ac) ?? sb.ac) : '',
          hp: sb?.hp ? String(leadingNumber(sb.hp) ?? sb.hp) : '',
          passivePerception: pp ? Number(pp[1]) : sb ? 10 + Math.floor((sb.wis - 10) / 2) : null,
          colour: typeof e.attributes.colour === 'string' ? e.attributes.colour : null
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
      dmNotes: String(this.setting('dm_notes') ?? ''),
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
    // Labels follow creation order over every trigger ever made, so they never renumber.
    const labels = new Map(rows.triggers.map((t, i) => [t.id, `T${i + 1}`]))
    return {
      nowMin,
      moonOffsetDays: Number(this.setting('moon_offset_days') ?? 0),
      storylines: rows.stories.map((s) => ({
        storylineId: s.id, boardId: boardOf.get(s.id) ?? '', title: s.title, status: s.status as StorylineStatus,
        projectedStatus: projection.storylineStatus.get(s.id) ?? (s.status as StorylineStatus),
        isMajor: s.isMajor, emblem: s.emblem
      })),
      acts: rows.acts.map((a) => {
        const p = projection.acts.get(a.id)!
        return {
          id: a.id, storylineId: a.storylineId, number: actNumber.get(a.id) ?? 0, title: a.title, summary: a.summary,
          plannedStartMin: a.startMin, plannedEndMin: a.endMin, startMin: p.startMin, endMin: p.endMin,
          shiftedBy: p.shiftedBy, chosenOutcomeId: a.chosenOutcomeId, state: p.state, outcomeId: p.outcomeId,
          resolvedBy: p.resolvedBy, forcedOutcomeId: p.forcedOutcomeId, defaultOutcomeId: p.defaultOutcomeId,
          outcomes: rows.outcomes.filter((o) => o.actId === a.id).map(toOutcomeView)
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
      return `${name(c.actId)}: ${c.before} becomes ${c.after}`
    })
    for (const s of diff.storylines) lines.push(`${titles.get(s.storylineId)}: ${s.before} becomes ${s.after}`)
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
          colour: typeof e.attributes.colour === 'string' ? e.attributes.colour : null
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

  updateSession(id: string, patch: { number?: number; sceneText?: string; recap?: string }): void {
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
  addLog(input: { kind: LogKind; text: string; entityId?: string | null; minutesTaken?: number }): LogView {
    const open = this.openSession()
    if (!open) throw new Error('Start a session first')
    const minutes = Math.max(0, Math.round(input.minutesTaken ?? 0))
    const now = this.info().clockMin
    const id = randomUUID()
    const label = input.kind === 'note' ? 'Logged a note' : `Logged ${input.kind === 'meeting' ? 'a meeting' : input.kind === 'fight' ? 'a fight' : input.kind === 'quest' ? 'a delivered quest' : input.kind}`
    this.log.run(label, (w) => {
      w.insert('log_entry', {
        id, sessionId: open.id, atMin: now, kind: input.kind, text: input.text, entityId: input.entityId ?? null,
        minutesTaken: minutes, createdAt: new Date().toISOString(), status: 'active'
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
          w.update('entity', p.id, { attributes: { ...e.attributes, current_hp: p.maxHp } })
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
    else this.placeCard(w, boardId, entityId, p)
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
    return item.entityId ? `Moved ${this.nameOf(item.entityId)}` : 'Moved a note'
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

function toEntityView(r: EntityRow, storylineIds: string[]): EntityView {
  return {
    id: r.id, type: r.type as EntityType, name: r.name, attributes: r.attributes, tags: r.tags,
    status: r.status as EntityStatus, parentId: r.parentId, storylineIds
  }
}

function toRelationshipView(r: RelationshipRow): RelationshipView {
  return {
    id: r.id, sourceId: r.sourceId, targetId: r.targetId, type: r.type, isSecret: r.isSecret,
    status: r.status as RowStatus
  }
}

function toItemView(r: BoardItemRow): BoardItemView {
  return {
    id: r.id, kind: r.kind as BoardItemView['kind'], entityId: r.entityId, x: r.x, y: r.y, w: r.w, h: r.h,
    content: r.content ?? null
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

function toMapView(r: MapRow): MapView {
  return { id: r.id, name: r.name, url: ASSET_URL_PREFIX + r.imagePath, width: r.width, height: r.height }
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
    id: r.id, number: r.number, startMin: r.startMin, endMin: r.endMin, ended: r.endedAt !== null,
    sceneText: r.sceneText, recap: r.recap
  }
}

function toLogView(l: LogRow, names: Map<string, string>): LogView {
  return {
    id: l.id, atMin: l.atMin, kind: l.kind as LogKind, text: l.text, entityId: l.entityId,
    entityName: l.entityId ? names.get(l.entityId) ?? null : null, minutesTaken: l.minutesTaken
  }
}
