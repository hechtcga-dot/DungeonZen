import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { openDatabase, type OpenedDb } from '../db/open'
import {
  ability, board, boardItem, campaignSetting, entity, knowledge, map, relationship, relationshipKnown, storyline,
  storylineEntity, type AbilityRow, type MapRow, type BoardItemRow, type BoardRow, type EntityRow, type RelationshipRow
} from '../db/schema'
import { CommandLog, type Writer } from './commandLog'
import type {
  AbilityKind, EntityAttributes, EntityStatus, EntityType, KnowledgeField, RowStatus, RulesEdition, StorylineStatus
} from '../../shared/schemas'
import { formatClock } from '../../shared/time'
import { KNOWLEDGE_FIELDS } from '../../shared/schemas'
import { freeSpot } from '../../shared/layout'
import { imageSize } from '../imageSize'
import { crToNumber, HAS_STATBLOCK, leadingNumber, readStatBlock, StatBlock, statLine } from '../../shared/statblock'
import type {
  AbilityView, BoardItemView, BoardSummary, BoardView, CampaignInfo, DeskView, EntityBrief, EntityView, HistoryView,
  LibraryFilters, LibrarySearch, MapView, RelationshipView, SheetView
} from '../../shared/types'

export const DB_FILE = 'campaign.db'
export const ASSETS_DIR = 'assets'
export const MAP_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
/** Address the app's asset protocol serves files from the open campaign's assets folder under. */
export const ASSET_URL_PREFIX = 'dz-asset://campaign/'

const DEFAULT_RULES_EDITION: RulesEdition = '2024'
const DEFAULT_CLOCK_MIN = 9 * 60 // Day 1, 09:00

export interface Position { x: number; y: number }

export type SettingKey = 'name' | 'rules_edition' | 'clock_min' | 'moon_offset_days' | 'dm_notes' | 'active_map_id'

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
    const id = randomUUID()
    this.log.run(input.label ?? `Added ${input.type.toLowerCase()} ${input.name}`, (w) => {
      w.insert('entity', {
        id, type: input.type, name: input.name, attributes: input.attributes ?? {}, tags: input.tags ?? [],
        status: 'active', parentId: null, createdAt: new Date().toISOString()
      })
      ;(input.abilities ?? []).forEach((a, i) => this.insertAbility(w, id, a, i))
      const global = this.globalBoard()
      this.placeCard(w, global.id, id, input.position)
      const target = this.boardRow(input.boardId)
      if (target.storylineId) this.linkToStoryline(w, id, target.storylineId, target.id, input.position)
    })
    return this.entityView(id)
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
    const rows = this.db.select().from(entity).all().filter((r) => r.status === 'active' || r.status === 'resolved')
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
