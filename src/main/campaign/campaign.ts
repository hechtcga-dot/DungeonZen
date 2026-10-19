import type { PromptTemplate, TemplateUse } from '../../shared/styleTags'
import { randomUUID } from 'node:crypto'
import { cp } from 'node:fs/promises'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { and, asc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm'
import { openDatabase, type OpenedDb } from '../db/open'
import { classesOf } from '../../shared/charsheet'
import { command, noteDoc, secret, tracked, type RowChange, type TableName,
  ability, act, board, boardItem, campaignSetting, entity, knowledge, map, partyPosition, regionShape,
  actEntity, relationship, relationshipKnown, styleExample, sessionPrep, prepItem, storyline, storylineEntity, type AbilityRow, type ActRow, type MapRow,   type BoardItemRow, type BoardRow, type EntityRow, type RelationshipRow
} from '../db/schema'
import { CommandLog, type Writer } from './commandLog'
import type { AbilityKind, EntityAttributes, EntityStatus, EntityType, KnowledgeField,   RowStatus, RulesEdition, StorylineStatus } from '../../shared/schemas'
import { formatClock } from '../../shared/time'
import { KNOWLEDGE_FIELDS, type PrepKind } from '../../shared/schemas'
import { freeSpot } from '../../shared/layout'
import { imageSize } from '../imageSize'
import { readOutline } from '../../shared/outline'
import { crToNumber, HAS_STATBLOCK, leadingNumber, passiveScore, readStatBlock, StatBlock, statLine } from '../../shared/statblock'
import type { SecretKind, SecretView,
  AbilityView, BoardItemView, BoardSettings, BoardSummary, CardActMark, StringType, BoardView, CampaignInfo, DeskView, EntityBrief, EntityView, HistoryView,
  LibraryFilters, LibrarySearch, MapView, RelationshipView,   SheetView } from '../../shared/types'
import { regionOnBoard } from '../../shared/geometry'
import type { RollTable } from '../../shared/rolltables'
import type { ManyOp } from '../../shared/ipc'


import { timelinePart } from './timeline'
import { livePart } from './live'
import { reviewPart } from './review'
import { regionsPart } from './regions'
import { picturesPart } from './pictures'
import { fillPart } from './fill'
import { notesImportPart } from './notesImport'
import { encountersPart } from './encounters'
import { combatPart } from './combat'
import { notesPart } from './notes'
import { prepPart } from './prep'
import { buildingsPart } from './buildings'
import { DB_FILE, ASSETS_DIR, PREP_LABELS, MAP_EXTENSIONS, storedExt, DEFAULT_RULES_EDITION, DEFAULT_CLOCK_MIN, Position, SettingKey, NewAbility, toEntityView, toRelationshipView, toItemView, toAbilityView, searchText, toMapView, ForgetKind, FORGET_TABLE } from './common'
export * from './common'

/**
 * One open campaign folder: `campaign.db` plus `assets/`.
 * Pure Node (no Electron imports) so it can be unit tested.
 */
export class Campaign {
  readonly log: CommandLog

  private constructor(readonly folder: string, readonly opened: OpenedDb) {
    this.log = new CommandLog(opened.db)
  }

  get db() { return this.opened.db }

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

  // ---- master notes: sections unticked from their note keep their own copy here ----

  masterCopies(): Record<string, unknown[]> {
    const raw = this.setting('master_notes')
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown[]> : {}
  }

  /** blocks = the master's own copy of a section (not linked to its note); null = linked again. One undo step. */
  setMasterCopy(section: string, blocks: unknown[] | null, label: string): void {
    const next = { ...this.masterCopies() }
    if (blocks) next[section] = blocks
    else delete next[section]
    this.setSetting('master_notes', next, label)
  }

  // ---- generators: the DM's own roll tables (setting roll_tables; History = status defunct) ----

  ownTables(): Array<RollTable & { status: 'active' | 'defunct' }> {
    const raw = this.setting('roll_tables')
    return Array.isArray(raw) ? raw as Array<RollTable & { status: 'active' | 'defunct' }> : []
  }

  saveOwnTable(table: RollTable): void {
    const list = this.ownTables()
    const had = list.some((x) => x.id === table.id)
    const next = had ? list.map((x) => (x.id === table.id ? { ...table, status: x.status } : x)) : [...list, { ...table, status: 'active' as const }]
    this.setSetting('roll_tables', next, `${had ? 'Changed' : 'Added'} the roll table ${table.name}`)
  }

  setOwnTableStatus(id: string, status: 'active' | 'defunct'): void {
    const list = this.ownTables()
    const t = list.find((x) => x.id === id)
    if (!t) throw new Error('That table is gone')
    this.setSetting('roll_tables', list.map((x) => (x.id === id ? { ...x, status } : x)), `${status === 'defunct' ? 'Moved' : 'Brought back'} the roll table ${t.name}${status === 'defunct' ? ' to History' : ''}`)
  }

  // ---- backups: dated copies of the whole folder (owner, 1.6.0) ----------------

  /** Where backups go: `backups` in the campaign, or a folder the DM chose. */
  backupFolder(): { folder: string; own: boolean } {
    const own = this.setting('backup_folder')
    return typeof own === 'string' && own ? { folder: own, own: true } : { folder: join(this.folder, 'backups'), own: false }
  }

  /** Backups of this campaign, newest first. */
  backups(): Array<{ name: string; at: string }> {
    const { folder } = this.backupFolder()
    const mine = `${this.backupStem()} `
    if (!existsSync(folder)) return []
    return readdirSync(folder, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith(mine))
      .map((d) => ({ name: d.name, at: statSync(join(folder, d.name)).mtime.toISOString() }))
      .sort((a, b) => b.at.localeCompare(a.at))
  }

  backupStem(): string {
    return this.info().name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Campaign'
  }

  /**
   * Copies the campaign folder (not its backups) to `<stem> YYYY-MM-DD HH-MM`, then keeps the
   * newest `keep` backups. Returns the new folder.
   */
  backup(keep = 20): string {
    const { folder } = this.backupFolder()
    mkdirSync(folder, { recursive: true })
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}`
    let dest = join(folder, `${this.backupStem()} ${stamp}`)
    for (let n = 2; existsSync(dest); n++) dest = join(folder, `${this.backupStem()} ${stamp} (${n})`)
    this.save()
    const skip = (src: string) => /campaign\.db-(wal|shm)$/.test(src) || src.startsWith(join(this.folder, ASSETS_DIR, 'pending')) || src.startsWith(folder)
    // Entry by entry: a backups folder inside the campaign cannot be copied into itself. The campaign
    // file is copied now; the pictures (often most of the folder) in the background, so opening a
    // campaign or ending a session never waits for them (speed). `backupDone` settles when finished.
    let pictures: string | null = null
    for (const entry of readdirSync(this.folder)) {
      const src = join(this.folder, entry)
      if (entry === 'backups' || skip(src)) continue
      if (entry === ASSETS_DIR) { pictures = src; continue }
      cpSync(src, join(dest, entry), { recursive: true, filter: (x) => !skip(x) })
    }
    // Old backups beyond `keep` are removed (copies, not campaign data), once this one is whole.
    const prune = () => { for (const old of this.backups().slice(keep)) rmSync(join(folder, old.name), { recursive: true, force: true }) }
    const done = (pictures ? cp(pictures, join(dest, ASSETS_DIR), { recursive: true, filter: (x) => !skip(x) }) : Promise.resolve()).then(prune)
    this.backupDone = done
    Campaign.copying.add(done)
    void done.catch(() => undefined).finally(() => Campaign.copying.delete(done))
    return dest
  }

  /** The last backup's background copy of the pictures. */
  backupDone: Promise<void> = Promise.resolve()
  /** Every backup still copying (the app waits for them before it quits, so no backup is left half made). */
  static copying = new Set<Promise<void>>()

  /** The daily backup: made when there is none from today yet. */
  backupIfDue(): string | null {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const today = `${this.backupStem()} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    return this.backups().some((b) => b.name.startsWith(today)) ? null : this.backup()
  }

  // ---- tidy campaign folder: files in assets/ nothing uses ----------------------

  /**
   * Files in assets/ whose name appears nowhere in the campaign: not on a card, map, picture, note, setting,
   * nor in History or any undo step. Pending AI pictures, notes files and encounter picture folders are left out
   * (their folders are listed as they are). Setup › Tidy campaign folder; the DM ticks what goes to the Recycle Bin.
   */
  unusedAssets(): Array<{ path: string; size: number }> {
    const root = join(this.folder, ASSETS_DIR)
    const skip = new Set(['pending', 'notes', 'encounters'])
    const files: string[] = []
    const walk = (dir: string, rel: string) => {
      for (const f of readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory()) { if (!(rel === '' && skip.has(f.name))) walk(join(dir, f.name), rel + f.name + '/') }
        else files.push(rel + f.name)
      }
    }
    if (existsSync(root)) walk(root, '')
    // Every table's text, one row at a time (the change log holds the undo steps): a file named anywhere is in use.
    const tables = this.opened.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>
    const used = (name: string) => tables.some((t) =>
      this.opened.sqlite.prepare(`SELECT 1 FROM "${t.name}" WHERE instr(${this.columnsOf(t.name)}, ?) > 0 LIMIT 1`).get(name))
    return files.filter((f) => !used(basename(f))).map((f) => ({ path: f, size: statSync(join(root, f)).size }))
  }

  /** A table's columns as one text (SQL), for searching every value at once. */
  columnsOf(table: string): string {
    return (this.opened.sqlite.pragma(`table_info("${table}")`) as Array<{ name: string }>)
      .map((c) => `COALESCE(CAST("${c.name}" AS TEXT), '')`).join(` || char(31) || `)
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
      units: settings.get('units') === 'metric' ? 'metric' : 'imperial',
      gettingStarted: settings.get('getting_started') === 'pending',
      artStyle: String(settings.get('art_style') ?? ''),
      priceScale: typeof settings.get('price_scale') === 'number' ? settings.get('price_scale') as number : 100,
      worldOutline: readOutline(settings.get('world_outline'))
    }
  }

  globalBoard(): BoardRow {
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
    // Regions of map pictures act as their Location cards (strings, sheet), so their places come along.
    const entityIds = [...new Set([...items.flatMap((i) => (i.entityId ? [i.entityId] : [])), ...this.mapPictures(boardId).flatMap((p) => p.regions.map((r) => r.locationId))])]
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
    const secrets = this.secretMap()
    return {
      board: boards.find((s) => s.id === boardId) ?? { id: b.id, name: b.name, storylineId: b.storylineId, storyline: null },
      boards,
      items: visibleItems.map(toItemView),
      entities: Object.fromEntries(entities.map((e) => [e.id, e])),
      relationships: relationships.map((r) => toRelationshipView(r, secrets)),
      undo: this.log.state(),
      settings,
      acts: this.numberedActs()
    }
  }

  numberedActs(): Array<{ id: string; storylineId: string; number: number; title: string }> {
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
      stringTypes: Array.isArray(types) ? (types as StringType[]) : [],
      typeColours: (this.setting('type_colours') ?? {}) as Partial<Record<EntityType, string>>
    }
  }

  entityViews(ids: string[]): EntityView[] {
    if (ids.length === 0) return []
    const rows = this.db.select().from(entity).where(inArray(entity.id, ids)).all()
    const links = this.db
      .select()
      .from(storylineEntity)
      .where(and(inArray(storylineEntity.entityId, ids), eq(storylineEntity.status, 'active')))
      .all()
    const marks = this.actMarks(ids)
    const storylines = Map.groupBy(links, (l) => l.entityId)
    return rows.map((r) => toEntityView(r, (storylines.get(r.id) ?? []).map((l) => l.storylineId), marks.get(r.id) ?? []))
  }

  entityView(id: string): EntityView {
    const [view] = this.entityViews([id])
    if (!view) throw new Error(`No entity with id ${id}`)
    return view
  }

  /**
   * History › Delete for good (owner, 2026-10-15): the rows leave the database in one undoable step.
   * Rows that need them (cards, links, abilities…) go too; rows that only point at them lose the pointer.
   * Notes files are not here: their files go to the Recycle Bin (forgetNoteDoc).
   */
  forgetRemoved(items: Array<{ kind: ForgetKind; id: string }>): void {
    if (items.length === 0) return
    this.log.run(items.length === 1 ? 'Deleted 1 thing from History for good' : `Deleted ${items.length} things from History for good`, (w) => {
      for (const it of items) this.dropRow(w, FORGET_TABLE[it.kind], it.id)
    })
  }

  fkCache: Array<{ table: TableName; column: string; key: string; parent: string; notNull: boolean }> | null = null
  fkRefs() {
    return this.fkCache ??= (Object.keys(tracked) as TableName[]).filter((t) => t !== 'campaign_settings').flatMap((t) => {
      const cols = this.db.all<{ name: string; notnull: number }>(sql`PRAGMA table_info(${sql.identifier(t)})`)
      const keys = Object.entries(getTableColumns(tracked[t].table)).map(([k, c]) => [c.name, k] as const)
      return this.db.all<{ table: string; from: string }>(sql`PRAGMA foreign_key_list(${sql.identifier(t)})`).map((f) => ({
        table: t, column: f.from, key: keys.find(([n]) => n === f.from)?.[1] ?? f.from, parent: f.table,
        notNull: cols.find((c) => c.name === f.from)?.notnull === 1
      }))
    })
  }

  dropRow(w: Writer, table: TableName, id: string): void {
    if (!w.get(table, id)) return
    for (const r of this.fkRefs().filter((r) => r.parent === table)) {
      for (const child of w.idsWhere(r.table, r.column, id)) {
        // A storyline's own board goes with it.
        if (r.notNull || (r.table === 'board' && r.column === 'storyline_id')) this.dropRow(w, r.table, child)
        else w.update(r.table, child, { [r.key]: null } as never)
      }
    }
    if (table === 'secret') { // a secret's links have no foreign key to it
      for (const rid of w.idsWhere('relationship', 'secret_id', id)) this.dropRow(w, 'relationship', rid)
      for (const pid of w.idsWhere('prep_item', 'secret_id', id)) w.update('prep_item', pid, { secretId: null })
    }
    w.delete(table, id)
  }

  history(): HistoryView {
    const removed = this.db.select().from(entity).where(eq(entity.status, 'defunct')).orderBy(asc(entity.name)).all()
    // A removed secret's strings come back with it, so they are listed under the secret, not one by one.
    const goneSecrets = this.db.select().from(secret).where(eq(secret.status, 'defunct')).all()
    const goneIds = new Set(goneSecrets.map((s) => s.id))
    const strings = this.db.select().from(relationship).where(eq(relationship.status, 'defunct')).all().filter((r) => !r.secretId || !goneIds.has(r.secretId))
    const names = new Map(
      this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name])
    )
    const notes = this.db
      .select({ item: boardItem, boardName: board.name, title: storyline.title })
      .from(boardItem)
      .innerJoin(board, eq(boardItem.boardId, board.id))
      .leftJoin(storyline, eq(board.storylineId, storyline.id))
      .where(and(inArray(boardItem.kind, ['note', 'image', 'card']), eq(boardItem.status, 'defunct')))
      .all()
      // Cards leave storyline boards with their storyline; only cards taken off by hand are listed.
      .filter((n) => n.item.kind !== 'card' || (!n.title && n.item.entityId && this.entityRow(n.item.entityId).status !== 'defunct'))
    return {
      removedEntities: removed.map((r) => toEntityView(r, [], [])),
      removedSecrets: goneSecrets.map((s) => ({ id: s.id, kind: s.kind as SecretKind, text: s.text })),
      removedStrings: strings.map((r) => ({
        ...toRelationshipView(r),
        sourceName: names.get(r.sourceId) ?? '?',
        targetName: names.get(r.targetId) ?? '?'
      })),
      removedNotes: notes.map((n) => ({
        itemId: n.item.id,
        boardName: n.title ?? n.boardName,
        text: n.item.kind === 'image' ? `Picture: ${n.item.content?.name ?? ''}` : n.item.kind === 'card' ? `Card: ${this.nameOf(n.item.entityId!)}` : n.item.content?.text ?? ''
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
        // Threats left the sheet in 1.7.0 (their text went into the sheet's notes).
        ...this.db.select().from(prepItem).where(eq(prepItem.status, 'defunct')).all().filter((i) => i.kind !== 'threat')
          .map((i) => ({ id: i.id, name: i.title || '(untitled)', what: PREP_LABELS[i.kind as PrepKind] }))
      ],
      removedNoteDocs: this.db.select().from(noteDoc).where(eq(noteDoc.status, 'defunct')).all()
        .filter((r) => existsSync(join(this.folder, ASSETS_DIR, r.file))).map((r) => ({ id: r.id, title: r.title })),
      removedStyles: this.db.select().from(styleExample).where(eq(styleExample.status, 'defunct')).all()
        .map((r) => ({ id: r.id, name: r.name })),
      removedOrder: this.log.lastTouched(),
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

  /**
   * Something made empty by a New… / Add button (a card, a board note, a prep row) and left untouched goes
   * away for good: no History, no change log, no undo step (owner, 2026-10-16). Untouched = the step that
   * made it is the only one that touched any row it made, apart from moving a board card or note.
   * The renderer asks only for things it made empty. Returns whether it went.
   */
  discardIfBlank(id: string): boolean {
    const touching = (rowId: string) => this.db.select().from(command)
      .where(sql`${command.state} != 'discarded' AND ${command.payload} LIKE ${`%${rowId}%`}`).all()
    const made = touching(id).find((c) => c.payload.some((x) => x.id === id && x.before === null))
    if (!made || made.payload.some((x) => x.before !== null)) return false
    const moveOnly = (x: RowChange) => x.table === 'board_item' && x.before !== null && x.after !== null &&
      Object.keys(x.after).every((k) => ['x', 'y', 'w', 'h'].includes(k) || JSON.stringify(x.before![k]) === JSON.stringify(x.after![k]))
    const steps = new Map<string, typeof made>()
    for (const x of made.payload) for (const c of touching(x.id)) steps.set(c.id, c)
    if ([...steps.values()].some((c) => c.id !== made.id && !c.payload.every(moveOnly))) return false
    this.db.transaction((tx) => {
      for (const x of [...made.payload].reverse()) tx.delete(tracked[x.table].table).where(eq(tracked[x.table].pk, x.id)).run()
      for (const c of steps.values()) tx.delete(command).where(eq(command.id, c.id)).run()
    })
    this.log.writes++
    return true
  }

  /** Creates an entity and its card(s) inside an open command, so several can be one undo step. */
  insertEntity(w: Writer, input: {
    boardId: string; type: EntityType; name: string; position: Position; attributes?: EntityAttributes
    tags?: string[]; abilities?: NewAbility[]; status?: EntityStatus
    /** false: no card on any board (encounters: the DM puts them on the board by choice). */
    place?: boolean
  }): string {
    const id = randomUUID()
    w.insert('entity', {
      id, type: input.type, name: input.name, attributes: input.attributes ?? {}, tags: input.tags ?? [],
      status: input.status ?? 'active', parentId: null, createdAt: new Date().toISOString()
    })
    ;(input.abilities ?? []).forEach((a, i) => this.insertAbility(w, id, a, i))
    if (input.place === false) return id
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
      // A Clue card's description is the text of every prep secret tied to it.
      const d = patch.attributes?.description
      if (current.type === 'CLUE' && typeof d === 'string') this.syncSecretText(w, { entityId: id }, d)
      // Prep NPCs tied to this card share its name, one-line summary and motivation.
      const s = patch.attributes?.summary, m = patch.attributes?.motivation
      const npc = { ...(patch.name ? { title: patch.name } : {}), ...(typeof s === 'string' ? { description: s } : {}), ...(typeof m === 'string' ? { role: m } : {}) }
      if (Object.keys(npc).length) {
        for (const i of this.db.select().from(prepItem).where(and(eq(prepItem.kind, 'npc'), eq(prepItem.entityId, id), eq(prepItem.status, 'active'))).all()) w.update('prep_item', i.id, npc)
      }
    })
  }

  /** Board: one change to many cards, one undo step. */
  many(label: string, ops: ManyOp[]): void {
    this.log.many(label, () => {
      for (const o of ops) {
        if (o.op === 'status') this.setEntityStatus(o.id, o.status)
        else if (o.op === 'colour') this.updateEntity(o.id, { attributes: { colour: o.colour } })
        else if (o.op === 'hidden') this.setHidden('entity', o.id, o.hidden)
        else if (o.op === 'storyline') { if (o.on) this.addToStoryline(o.entityId, o.storylineId, o.position); else this.removeFromStoryline(o.entityId, o.storylineId) }
        else if (o.op === 'act') this.setActMark(o.entityId, o.actId, o.on)
        else this.setNoteStatus(o.itemId, 'defunct')
      }
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
    if (input.sourceId === input.targetId) throw new Error('A link needs two different cards')
    const a = this.entityRow(input.sourceId)
    const b = this.entityRow(input.targetId)
    const id = randomUUID()
    const { boardId, colour, ...rest } = input
    const settings = this.boardSettings()
    const owner = settings.sharedStrings ? null : boardId ?? this.globalBoard().id
    this.log.run(`Linked ${a.name} to ${b.name}`, (w) => {
      // A secret string is a secret (one text, its connections), like those made on the prep sheet and card sheets.
      const sid = rest.isSecret ? randomUUID() : null
      if (sid) w.insert('secret', { id: sid, kind: 'secret', text: '', status: 'active' })
      w.insert('relationship', { id, ...rest, boardId: owner, status: 'active', secretId: sid })
      // A new kind of link (with its colour) joins the list in the same undo step.
      if (colour !== undefined) {
        const types = [...settings.stringTypes.filter((t) => t.type !== input.type), { type: input.type, colour }]
        if (w.get('campaign_settings', 'string_types')) w.update('campaign_settings', 'string_types', { value: types })
        else w.insert('campaign_settings', { key: 'string_types', value: types })
      }
    })
    return toRelationshipView(this.db.select().from(relationship).where(eq(relationship.id, id)).get()!)
  }

  updateRelationship(id: string, patch: { type?: string; isSecret?: boolean; description?: string }): void {
    const r = this.relationshipRow(id)
    const group = r.secretId ? this.db.select().from(secret).where(eq(secret.id, r.secretId)).get() : undefined
    const { description, ...rest } = patch
    this.log.run(`Edited link ${this.nameOf(r.sourceId)} – ${this.nameOf(r.targetId)}`, (w) => {
      if (Object.keys(rest).length) w.update('relationship', id, rest)
      // A string that is one of a secret's connections shows (and edits) the secret's text.
      if (description !== undefined) {
        if (group) { w.update('secret', group.id, { text: description }); this.syncSecretText(w, { secretId: group.id }, description) }
        else w.update('relationship', id, { description })
      }
      // Ticking Secret makes a lone string a secret; unticking makes a one-string secret a plain connection.
      if (patch.isSecret !== undefined && patch.isSecret !== r.isSecret) {
        if (!group && patch.isSecret) {
          const sid = randomUUID()
          w.insert('secret', { id: sid, kind: 'secret', text: r.description, status: 'active' })
          w.update('relationship', id, { secretId: sid })
        } else if (group && this.db.select().from(relationship).where(and(eq(relationship.secretId, group.id), eq(relationship.status, 'active'))).all().length === 1) {
          w.update('secret', group.id, { kind: patch.isSecret ? (group.kind === 'connection' ? 'secret' : group.kind) : 'connection' })
        }
      }
    })
  }

  /** Prep secrets tied to a string or Clue card share its text: write it into each of them (same undo step). */
  syncSecretText(w: { update(table: 'prep_item', id: string, patch: { body: string }): void }, by: { secretId: string } | { entityId: string }, text: string): void {
    const tied = this.db.select().from(prepItem).where(and(eq(prepItem.kind, 'discovery'), eq(prepItem.status, 'active'),
      'secretId' in by ? eq(prepItem.secretId, by.secretId) : eq(prepItem.entityId, by.entityId))).all()
    for (const i of tied) if (i.body !== text) w.update('prep_item', i.id, { body: text })
  }

  secretMap(): Map<string, { kind: string; text: string }> {
    return new Map(this.db.select().from(secret).where(eq(secret.status, 'active')).all().map((s) => [s.id, s]))
  }

  /** Every secret, clue and connection with its live connections. */
  secretViews(): SecretView[] {
    const names = new Map(this.db.select({ id: entity.id, name: entity.name, status: entity.status }).from(entity).all()
      .filter((e) => e.status !== 'defunct').map((e) => [e.id, e.name]))
    const rels = this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
    return this.db.select().from(secret).where(eq(secret.status, 'active')).all().map((s) => {
      const connections = rels.filter((r) => r.secretId === s.id && names.has(r.sourceId) && names.has(r.targetId))
        .map((r) => ({ id: r.id, sourceId: r.sourceId, targetId: r.targetId, type: r.type }))
      const label = connections.map((c) => `${names.get(c.sourceId)} ${c.type.toLowerCase().replace(/_/g, ' ')} ${names.get(c.targetId)}`).join('; ')
      return { id: s.id, kind: s.kind as SecretKind, text: s.text, connections, label: label || s.text.slice(0, 60) || `New ${s.kind}` }
    }).sort((a, b) => a.label.localeCompare(b.label))
  }

  /**
   * Saves a secret, clue or connection: its text and its connections (each a string on the board; known for a
   * connection, dashed for a secret or clue). Removed connections go to History. One undo step.
   */
  saveSecret(input: { id: string | null; kind: SecretKind; text: string; connections: Array<{ id?: string; sourceId: string; targetId: string; type: string }>; prepItemId?: string; boardId?: string }): string {
    for (const c of input.connections) {
      if (c.sourceId === c.targetId) throw new Error('A link needs two different cards')
      this.entityRow(c.sourceId); this.entityRow(c.targetId)
    }
    const id = input.id ?? randomUUID()
    const old = input.id ? this.db.select().from(relationship).where(and(eq(relationship.secretId, input.id), eq(relationship.status, 'active'))).all() : []
    const settings = this.boardSettings()
    const owner = settings.sharedStrings ? null : input.boardId ?? this.globalBoard().id
    const isSecret = input.kind !== 'connection'
    this.log.run(`Saved the ${input.kind === 'connection' ? 'link' : input.kind}${input.text ? ` ${input.text.slice(0, 40)}` : ''}`, (w) => {
      if (input.id) w.update('secret', id, { kind: input.kind, text: input.text })
      else w.insert('secret', { id, kind: input.kind, text: input.text, status: 'active' })
      for (const c of input.connections) {
        // An existing board link not yet tied to a secret joins this one (Add link › Existing link).
        const was = c.id ? old.find((r) => r.id === c.id) ?? this.freeLinks().find((r) => r.id === c.id) : undefined
        if (was) {
          if (was.sourceId !== c.sourceId || was.targetId !== c.targetId || was.type !== c.type || was.isSecret !== isSecret || was.secretId !== id)
            w.update('relationship', was.id, { sourceId: c.sourceId, targetId: c.targetId, type: c.type, isSecret, secretId: id })
        } else {
          w.insert('relationship', { id: randomUUID(), sourceId: c.sourceId, targetId: c.targetId, type: c.type, isSecret, boardId: owner, status: 'active', secretId: id })
        }
      }
      for (const r of old) if (!input.connections.some((c) => c.id === r.id)) w.update('relationship', r.id, { status: 'defunct' })
      this.syncSecretText(w, { secretId: id }, input.text)
      if (input.prepItemId) w.update('prep_item', input.prepItemId, { secretId: id, entityId: null, body: input.text })
    })
    return id
  }

  /**
   * The Link window (3.0): what a line on the board, a secret or a clue holds. A board line not yet in a record
   * comes as one without an id (kind from its dashes, text = its description); saving it makes the record.
   * Known = the party knows every one of its links.
   */
  linkRecord(q: { relationshipId?: string; secretId?: string }): { record: (Omit<SecretView, 'id'> & { id: string | null }) | null; known: boolean; cards: EntityBrief[] } {
    const cards = this.cardBriefs().map((c) => ({ id: c.id, type: c.type, name: c.name, status: c.status }))
    const rel = q.relationshipId ? this.relationshipRow(q.relationshipId) : undefined
    const secretId = q.secretId ?? rel?.secretId ?? null
    const record = secretId ? this.secretViews().find((x) => x.id === secretId) ?? null
      : rel ? { id: null, kind: (rel.isSecret ? 'secret' : 'connection') as SecretKind, text: rel.description, label: '',
        connections: [{ id: rel.id, sourceId: rel.sourceId, targetId: rel.targetId, type: rel.type }] } : null
    const knownIds = new Set(this.db.select().from(relationshipKnown).where(eq(relationshipKnown.status, 'active')).all().map((k) => k.relationshipId))
    return { record, known: !!record && record.connections.length > 0 && record.connections.every((c) => knownIds.has(c.id)), cards }
  }

  /** Saves the Link window: the record (saveSecret) and whether the party knows its links, as one undo step. */
  saveLink(input: Parameters<Campaign['saveSecret']>[0] & { known: boolean }): string {
    return this.log.many(`Saved the ${input.kind === 'connection' ? 'link' : input.kind}`, () => {
      const id = this.saveSecret(input)
      const knownIds = new Set(this.db.select().from(relationshipKnown).where(eq(relationshipKnown.status, 'active')).all().map((k) => k.relationshipId))
      for (const r of this.db.select().from(relationship).where(and(eq(relationship.secretId, id), eq(relationship.status, 'active'))).all())
        if (knownIds.has(r.id) !== input.known) this.setStringKnown(r.id, input.known)
      return id
    })
  }

  /** Board links between two cards that belong to no secret, clue or link text yet. */
  freeLinks() {
    return this.db.select().from(relationship).where(eq(relationship.status, 'active')).all().filter((r) => !r.secretId && r.type !== 'BOARD_LINK')
  }

  /** A secret's text, everywhere it shows (prep sheets, card sheets, Links). */
  setSecretText(id: string, text: string): void {
    this.log.run('Edited a secret', (w) => { w.update('secret', id, { text }); this.syncSecretText(w, { secretId: id }, text) })
  }

  /** Moves a secret and its strings to History (undo brings them back). */
  removeSecret(id: string): void {
    this.log.run('Moved a secret to History', (w) => {
      w.update('secret', id, { status: 'defunct' })
      for (const r of this.db.select().from(relationship).where(and(eq(relationship.secretId, id), eq(relationship.status, 'active'))).all()) w.update('relationship', r.id, { status: 'defunct' })
    })
  }

  /** Brings a secret back from History with the strings that went with it (those whose cards are still there). */
  reviveSecret(id: string): void {
    const live = new Set(this.db.select({ id: entity.id, status: entity.status }).from(entity).all().filter((e) => e.status !== 'defunct').map((e) => e.id))
    this.log.run('Brought a secret back from History', (w) => {
      w.update('secret', id, { status: 'active' })
      for (const i of this.db.select().from(prepItem).where(and(eq(prepItem.secretId, id), eq(prepItem.status, 'defunct'))).all()) w.update('prep_item', i.id, { status: 'active' })
      for (const r of this.db.select().from(relationship).where(and(eq(relationship.secretId, id), eq(relationship.status, 'defunct'))).all())
        if (live.has(r.sourceId) && live.has(r.targetId)) w.update('relationship', r.id, { status: 'active' })
    })
  }

  /** Prep sheet › Add connection / secret / clue: a new line tied to a new (empty) secret. */
  addPrepSecret(prepId: string, kind: SecretKind): string {
    const p = this.prepRow(prepId)
    const siblings = this.db.select().from(prepItem).where(and(eq(prepItem.prepId, prepId), eq(prepItem.kind, 'discovery'))).all()
    const id = randomUUID(), sid = randomUUID()
    this.log.run(`Added a ${kind === 'connection' ? 'link' : kind} to the prep for session ${p.number}`, (w) => {
      w.insert('secret', { id: sid, kind, text: '', status: 'active' })
      w.insert('prep_item', {
        id, prepId, kind: 'discovery', sort: siblings.reduce((n, x) => Math.max(n, x.sort), 0) + 1, title: '', body: '', sceneType: null,
        targetStart: null, targetEnd: null, entityId: null, locationId: null, discoveryId: null, role: '', stats: '', tactics: '',
        done: false, doneAtMin: null, status: 'active', secretId: sid
      })
    })
    return id
  }

  setRelationshipStatus(id: string, status: RowStatus): void {
    const r = this.relationshipRow(id)
    const verb = status === 'defunct' ? 'Removed link' : 'Restored link'
    // The last link of a secret, clue or link line takes it (and its prep lines) to History; restoring brings them back.
    const others = r.secretId ? this.db.select().from(relationship).where(and(eq(relationship.secretId, r.secretId), eq(relationship.status, 'active'))).all().filter((x) => x.id !== id) : []
    const sec = r.secretId && others.length === 0 ? this.db.select().from(secret).where(eq(secret.id, r.secretId)).get() : undefined
    this.log.run(`${verb} ${this.nameOf(r.sourceId)} – ${this.nameOf(r.targetId)}`, (w) => {
      w.update('relationship', id, { status })
      if (sec && sec.status !== status) {
        w.update('secret', sec.id, { status })
        for (const i of this.db.select().from(prepItem).where(eq(prepItem.secretId, sec.id)).all()) if (i.status !== status) w.update('prep_item', i.id, { status })
      }
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
    // A card taken off a board keeps its entity (on other boards, Library, Map); History puts it back.
    if (item.kind === 'card') {
      const name = this.nameOf(item.entityId!)
      this.log.run(status === 'defunct' ? `Took ${name} off the board` : `Put ${name} back on the board`, (w) => { w.update('board_item', itemId, { status }) })
      return
    }
    const what = item.kind === 'image' ? 'picture' : 'note'
    this.log.run(status === 'defunct' ? `Removed a ${what}` : `Restored a ${what}`, (w) => {
      w.update('board_item', itemId, { status })
    })
  }

  /** Moves board items. A card dropped on a region of a map picture takes that place as its location (same undo step); returns what moved where. */
  moveItems(moves: Array<{ itemId: string } & Position>): string[] {
    if (moves.length === 0) return []
    const placed = this.placesOnMaps(moves)
    const label = moves.length === 1 ? this.moveLabel(moves[0].itemId) + (placed[0] ? ` to ${placed[0].place}` : '') : `Moved ${moves.length} items`
    const linked = this.boardSettings().linkPositions
    this.log.run(label, (w) => {
      for (const m of moves) {
        w.update('board_item', m.itemId, { x: m.x, y: m.y })
        if (linked) for (const twin of this.twins(m.itemId)) w.update('board_item', twin.id, { x: m.x, y: m.y })
      }
      for (const p of placed) w.update('entity', p.entity.id, { attributes: { ...p.entity.attributes, location: p.place } })
    })
    return placed.map((p) => `${p.entity.name} is now at ${p.place}.`)
  }

  /** Cards among the moves that land on a region of a map picture on their board, with a new location. */
  placesOnMaps(moves: Array<{ itemId: string } & Position>): Array<{ entity: EntityRow; place: string }> {
    const items = moves.map((m) => ({ m, item: this.itemRow(m.itemId) })).filter(({ item }) => item.kind === 'card' && item.entityId)
    if (items.length === 0) return []
    return items.flatMap(({ m, item }) => {
      const r = regionOnBoard([m.x + (item.w ?? 220) / 2, m.y + (item.h ?? 120) / 2], this.mapPictures(item.boardId))
      const e = this.entityRow(item.entityId!)
      if (!r || r.locationId === e.id || e.attributes.location === r.name) return []
      return [{ entity: e, place: r.name }]
    })
  }

  /** The campaign maps shown as pictures on a board, with their regions. */
  mapPictures(boardId: string) {
    const maps = this.db.select().from(map).where(eq(map.status, 'active')).all()
    return this.db.select().from(boardItem)
      .where(and(eq(boardItem.boardId, boardId), eq(boardItem.kind, 'image'), eq(boardItem.status, 'active'))).all()
      .flatMap((i) => {
        const m = maps.find((x) => x.id === i.content?.mapId || x.imagePath === i.content?.image)
        if (i.hidden || !m?.width || !m.height || !i.w || !i.h) return []
        return [{ x: i.x, y: i.y, w: i.w, h: i.h, mapW: m.width, mapH: m.height, regions: this.regionViews(m.id) }]
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
  twins(itemId: string): BoardItemRow[] {
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
      this.log.run(`${verb} link ${this.nameOf(r.sourceId)} – ${this.nameOf(r.targetId)}`, (w) => { w.update('relationship', id, { hidden }) })
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
  actMarks(entityIds: string[]): Map<string, CardActMark[]> {
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

  /** The colour of every card of a type (null: the standard colour); `clearOwn` also drops colours given to single cards of that type. One undo step. */
  setTypeColour(type: EntityType, colour: string | null, clearOwn: boolean): void {
    const colours = { ...this.boardSettings().typeColours }
    if (colour) colours[type] = colour
    else delete colours[type]
    const own = clearOwn ? this.db.select().from(entity).where(eq(entity.type, type)).all().filter((e) => typeof e.attributes.colour === 'string') : []
    this.log.run(`Changed the colour of ${type.toLowerCase()} cards`, (w) => {
      if (w.get('campaign_settings', 'type_colours')) w.update('campaign_settings', 'type_colours', { value: colours })
      else w.insert('campaign_settings', { key: 'type_colours', value: colours })
      for (const e of own) {
        const { colour: _c, ...rest } = e.attributes
        w.update('entity', e.id, { attributes: rest })
      }
    })
  }

  /** The DM's own kinds of string (with an optional colour). */
  setStringTypes(types: StringType[]): void {
    this.setSetting('string_types', types, 'Changed the kinds of link')
  }

  /** Renames a kind of string everywhere: every string of that kind and the list (one undo step). */
  renameStringType(from: string, to: string): number {
    const rows = this.db.select().from(relationship).where(eq(relationship.type, from)).all()
    const types = this.boardSettings().stringTypes.map((t) => (t.type === from ? { ...t, type: to } : t))
    this.log.run(`Renamed link kind ${from} to ${to}`, (w) => {
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
    this.log.run(on ? `Links shared by every board again (${winner} links kept)` : 'Links kept per board', (w) => {
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
      rel = `board/${randomUUID()}${storedExt(ext)}`
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
        content: { image: rel, name, opacity: 0.6, locked: false, ...('mapId' in from ? { mapId: from.mapId } : {}) }, status: 'active'
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

  storylineRow(id: string) {
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
    const secrets = this.secretMap()
    const connections = rels.flatMap((r) => {
      const outgoing = r.sourceId === entityId
      const other = briefs.get(outgoing ? r.targetId : r.sourceId)
      if (!other || other.status === 'defunct') return []
      return [{ relationship: toRelationshipView(r, secrets), other, outgoing, partyKnows: knownRels.has(r.id) }]
    }).sort((a, b) => a.other.name.localeCompare(b.other.name))
    const known = new Set(this.db.select().from(knowledge)
      .where(and(eq(knowledge.entityId, entityId), eq(knowledge.status, 'active'))).all().map((k) => k.field))
    const partyKnows = Object.fromEntries(KNOWLEDGE_FIELDS.map((f) => [f, known.has(f)])) as Record<KnowledgeField, boolean>
    const others = [...briefs.values()]
      .filter((e) => e.id !== entityId && e.status !== 'defunct')
      .sort((a, b) => a.name.localeCompare(b.name))
    return { entity: view, abilities, connections, partyKnows, others, secrets: this.secretViews(), undo: this.log.state() }
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

  setting(key: string): unknown {
    return this.db.select().from(campaignSetting).where(eq(campaignSetting.key, key)).get()?.value
  }

  /** Changes one campaign setting as an undoable step. */
  setSetting(key: SettingKey, value: unknown, label: string): void {
    this.setSettings({ [key]: value }, label)
  }

  /** Draw window prompt templates (style lines saved under a name); removed ones stay stored, Ctrl+Z brings them back. */
  promptTemplates(use: TemplateUse = 'portraits'): PromptTemplate[] {
    const v = this.setting('prompt_templates')
    return (Array.isArray(v) ? v as PromptTemplate[] : []).filter((t) => t.status !== 'defunct' && (t.use ?? 'portraits') === use)
  }

  /** Saves a template; the same name (in the same Draw window) replaces the old one (one undo step). */
  savePromptTemplate(t: PromptTemplate): void {
    const v = this.setting('prompt_templates')
    const use = t.use ?? 'portraits'
    const all = (Array.isArray(v) ? v as PromptTemplate[] : []).filter((x) => (x.use ?? 'portraits') !== use || x.name.toLowerCase() !== t.name.toLowerCase())
    this.setSetting('prompt_templates', [...all, { name: t.name, fields: t.fields, ...(use === 'portraits' ? {} : { use }) }], `Saved the prompt template ${t.name}`)
  }

  renamePromptTemplate(name: string, next: string, use: TemplateUse = 'portraits'): void {
    const v = this.setting('prompt_templates')
    const all = Array.isArray(v) ? v as PromptTemplate[] : []
    const mine = (x: PromptTemplate) => x.status !== 'defunct' && (x.use ?? 'portraits') === use
    if (all.some((x) => mine(x) && x.name !== name && x.name.toLowerCase() === next.toLowerCase())) throw new Error(`There is already a template called ${next}`)
    this.setSetting('prompt_templates', all.map((x) => (x.name === name && mine(x) ? { ...x, name: next } : x)), `Renamed the prompt template ${name} to ${next}`)
  }

  removePromptTemplate(name: string, use: TemplateUse = 'portraits'): void {
    const v = this.setting('prompt_templates')
    const all = Array.isArray(v) ? v as PromptTemplate[] : []
    this.setSetting('prompt_templates', all.map((x) => (x.name === name && (x.use ?? 'portraits') === use ? { ...x, status: 'defunct' } : x)), `Removed the prompt template ${name}`)
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

  mapRow(id: string): MapRow {
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
  importMap(sourceFile: string, name?: string, battle?: { gridCols: number; gridShown?: boolean }): MapView {
    const ext = extname(sourceFile).toLowerCase()
    if (!MAP_EXTENSIONS.includes(ext)) throw new Error(`Maps must be PNG, JPEG, WebP or GIF images (got ${ext || 'no extension'})`)
    const id = randomUUID()
    const rel = `maps/${id}${storedExt(ext)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'maps'), { recursive: true })
    copyFileSync(sourceFile, join(this.folder, ASSETS_DIR, rel))
    const size = imageSize(readFileSync(join(this.folder, ASSETS_DIR, rel)))
    const mapName = name?.trim() || basename(sourceFile, extname(sourceFile))
    this.log.run(`Imported ${battle ? 'battle ' : ''}map ${mapName}`, (w) => {
      w.insert('map', {
        id, name: mapName, imagePath: rel, width: size?.width ?? null, height: size?.height ?? null,
        gridSize: null, status: 'active', ...(battle ? { kind: 'battle', gridCols: battle.gridCols, gridShown: !!battle.gridShown } : {})
      })
      if (battle) return
      if (w.get('campaign_settings', 'active_map_id')) w.update('campaign_settings', 'active_map_id', { value: id })
      else w.insert('campaign_settings', { key: 'active_map_id', value: id })
    })
    return toMapView(this.db.select().from(map).where(eq(map.id, id)).get()!)
  }

  /**
   * Re-import: a new picture for a map (the old file stays in the folder). Regions and party
   * positions are stretched to the new size so they stay on the same places. One undo step.
   */
  replaceMapImage(mapId: string, sourceFile: string): MapView {
    const m = this.mapRow(mapId)
    const ext = extname(sourceFile).toLowerCase()
    if (!MAP_EXTENSIONS.includes(ext)) throw new Error(`Maps must be PNG, JPEG, WebP or GIF images (got ${ext || 'no extension'})`)
    const rel = `maps/${randomUUID()}${storedExt(ext)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'maps'), { recursive: true })
    copyFileSync(sourceFile, join(this.folder, ASSETS_DIR, rel))
    const size = imageSize(readFileSync(join(this.folder, ASSETS_DIR, rel)))
    const sx = m.width && size?.width ? size.width / m.width : 1
    const sy = m.height && size?.height ? size.height / m.height : 1
    this.log.run(`New picture for the map ${m.name}`, (w) => {
      w.update('map', mapId, { imagePath: rel, width: size?.width ?? m.width, height: size?.height ?? m.height })
      if (sx === 1 && sy === 1) return
      for (const r of this.db.select().from(regionShape).where(eq(regionShape.mapId, mapId)).all()) {
        w.update('region_shape', r.id, { polygon: r.polygon.map(([x, y]) => [Math.round(x * sx * 10) / 10, Math.round(y * sy * 10) / 10] as [number, number]) })
      }
      for (const p of this.db.select().from(partyPosition).where(eq(partyPosition.mapId, mapId)).all()) {
        w.update('party_position', p.id, { x: p.x * sx, y: p.y * sy })
      }
    })
    return toMapView(this.mapRow(mapId))
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
          xp: typeof a.xp === 'number' ? a.xp : 0,
          level: classesOf(a).reduce((n, c) => n + c.level, 0) || Number.parseInt(String(a.level ?? ''), 10) || 0,
          currentHp: typeof a.current_hp === 'number' ? a.current_hp : maxHp,
          maxHp,
          tempHp: typeof a.temp_hp === 'number' ? a.temp_hp : 0,
          size: sb?.size ?? '',
          resistances: [sb?.resistances && `resists ${sb.resistances}`, sb?.immunities && `immune ${sb.immunities}`].filter(Boolean).join('; '),
          conditions: typeof a.conditions === 'string' ? a.conditions : '',
          inspiration: a.inspiration === true,
          exhaustion: typeof a.exhaustion === 'number' ? a.exhaustion : 0,
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

  // ---- helpers ---------------------------------------------------------------

  placeCard(w: Writer, boardId: string, entityId: string, p: Position): void {
    if (this.cardItems(boardId, entityId).length > 0) return
    w.insert('board_item', {
      id: randomUUID(), boardId, kind: 'card', entityId, x: p.x, y: p.y, w: null, h: null, content: null, status: 'active'
    })
  }

  linkToStoryline(w: Writer, entityId: string, storylineId: string, boardId: string, p: Position): void {
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
  cardItems(boardId: string, entityId: string, includeRemoved = false): BoardItemRow[] {
    return this.db.select().from(boardItem).where(and(
      eq(boardItem.boardId, boardId), eq(boardItem.entityId, entityId), eq(boardItem.kind, 'card')
    )).all().filter((i) => includeRemoved || i.status === 'active')
  }

  insertAbility(w: Writer, entityId: string, a: NewAbility, sort: number): string {
    const id = randomUUID()
    w.insert('ability', {
      id, entityId, name: a.name, kind: a.kind ?? 'ACTION', description: a.description ?? '',
      macroText: a.macroText ?? '', showTokenAction: a.showTokenAction ?? true, showMacroBar: a.showMacroBar ?? false,
      sort, status: 'active'
    })
    return id
  }

  abilityRow(id: string): AbilityRow {
    const row = this.db.select().from(ability).where(eq(ability.id, id)).get()
    if (!row) throw new Error(`No ability with id ${id}`)
    return row
  }

  moveLabel(itemId: string): string {
    const item = this.itemRow(itemId)
    return item.entityId ? `Moved ${this.nameOf(item.entityId)}` : item.kind === 'image' ? 'Moved a picture' : 'Moved a note'
  }

}

// The areas in their own files (timeline.ts, live.ts…) are methods of Campaign too.
const PARTS = [timelinePart, livePart, reviewPart, regionsPart, picturesPart, fillPart, notesImportPart, encountersPart, combatPart, notesPart, prepPart, buildingsPart]
type Parts = typeof timelinePart & typeof livePart & typeof reviewPart & typeof regionsPart & typeof picturesPart & typeof fillPart & typeof notesImportPart & typeof encountersPart & typeof combatPart & typeof notesPart & typeof prepPart & typeof buildingsPart
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Campaign extends Parts {}
for (const p of PARTS) Object.assign(Campaign.prototype, p)
