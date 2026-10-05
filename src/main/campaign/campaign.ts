import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { openDatabase, type OpenedDb } from '../db/open'
import {
  board, boardItem, campaignSetting, entity, relationship, storyline, storylineEntity,
  type BoardItemRow, type BoardRow, type EntityRow, type RelationshipRow
} from '../db/schema'
import { CommandLog, type Writer } from './commandLog'
import type {
  EntityAttributes, EntityStatus, EntityType, RowStatus, RulesEdition
} from '../../shared/schemas'
import type {
  BoardItemView, BoardSummary, BoardView, CampaignInfo, EntityView, HistoryView, RelationshipView
} from '../../shared/types'

export const DB_FILE = 'campaign.db'
export const ASSETS_DIR = 'assets'

const DEFAULT_RULES_EDITION: RulesEdition = '2024'
const DEFAULT_CLOCK_MIN = 9 * 60 // Day 1, 09:00

export interface Position { x: number; y: number }

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
      .select({ id: board.id, name: board.name, storylineId: board.storylineId, title: storyline.title })
      .from(board)
      .leftJoin(storyline, eq(board.storylineId, storyline.id))
      .all()
    const summaries = rows.map((r) => ({ id: r.id, name: r.title ?? r.name, storylineId: r.storylineId }))
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
      board: boards.find((s) => s.id === boardId) ?? { id: b.id, name: b.name, storylineId: b.storylineId },
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
      log: this.log.recent().map((c) => ({ id: c.id, label: c.label, at: c.at, undone: c.state === 'undone' }))
    }
  }

  // ---- writes (each one is a single undoable command) ----------------------

  createEntity(input: { boardId: string; type: EntityType; name: string; position: Position }): EntityView {
    const id = randomUUID()
    this.log.run(`Added ${input.type.toLowerCase()} ${input.name}`, (w) => {
      w.insert('entity', {
        id, type: input.type, name: input.name, attributes: {}, tags: [], status: 'active',
        parentId: null, createdAt: new Date().toISOString()
      })
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
      w.insert('storyline', { id: storylineId, title, isMajor: false, status: 'inactive', bbegEntityId: null })
      w.insert('board', { id: boardId, name: title, storylineId })
    })
    return { id: boardId, name: title, storylineId }
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
