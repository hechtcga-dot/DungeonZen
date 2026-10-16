import type { PromptTemplate, StyleTags, TemplateUse } from '../../shared/styleTags'
import { LENGTH_UNITS, type LengthUnit } from '../../shared/units'
import { randomUUID } from 'node:crypto'
import { cp } from 'node:fs/promises'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { and, asc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm'
import { openDatabase, type OpenedDb } from '../db/open'
import { classesOf, hitDice, usesOf } from '../../shared/charsheet'
import { combat, command, noteDoc, secret, tracked, type RowChange, type TableName,
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
import { readOutline } from '../../shared/outline'
import { ABILITY_KEYS, crToNumber, HAS_STATBLOCK, leadingNumber, passiveScore, readStatBlock, saveBonus, StatBlock, statLine } from '../../shared/statblock'
import { battlePlan, spellRoles, type BattlePlan, type PlanFoe, type PlanPc } from '../../shared/battleplan'
import { spellLevel } from '../../shared/attacks'
import type { CombatView, PcToken, SecretKind, SecretView,
  AbilityView, BoardItemView, BoardSettings, BoardSummary, CardActMark, StringType, BoardView, CampaignInfo, DeskView, EntityBrief, EntityView, HistoryView,
  LibraryFilters, LibrarySearch, LiveView, LogView, MapScreenView, MapView, PartyMarker, PendingImageView, StyleExampleView, PrepScreenView, PrepView, WordLinksView, PrepItemView, WhereView, PlayersView, EncountersView, EncounterView, EncounterCreatureView, RegionDetail, RegionView,
  RelationshipView, ReviewConflict, ReviewProposal, ReviewView, TravelEstimateView,
  SessionView, SheetView, TimelineView, TriggerEffectView, WhatIfView, LibraryPictureView, PicturesView, StyleUse, NoteDocView, NotesScreenView, NoteMeta
} from '../../shared/types'
import { STYLE_USES } from '../../shared/types'
import { advise } from '../advisor'
import type { SceneContext } from '../ai/scene'
import { moonOn, skyAt } from '../../shared/sky'
import { centroid, estimateTravel, regionAt, regionOnBoard, type Point } from '../../shared/geometry'
import { CR_STEPS, crStep, scaleToCr } from '../../shared/crscale'
import { readStory, type EncounterStory } from '../../shared/encounterStory'
import { boostsAllies, CombatState, DAMAGE_TYPES, isLeaderName, legendaryCount, limitedUses, newCombatant, slotsFromText, type Combatant, type CombatantInfo } from '../../shared/combat'
import { readFollow, rowsFor, type FollowSource } from '../../shared/battlemap'
import { isBiome, isPlaceKind, type Biome, type PlaceKind } from '../../shared/places'
import { ImportDraft as ImportDraftSchema, type ImportDraft, type ImportDraftSummary } from '../../shared/notesImport'
import { adaptation, RATING_LABELS, rateEncounter, xpForCr, type FightFeedback } from '../../shared/encounter'
import type { RollTable } from '../../shared/rolltables'
import type { ManyOp } from '../../shared/ipc'
import { readSketch, type Sketch } from '../../shared/sketch'
import { buildingAttrs, newId, occupantsOf, readBuilding, type BSecret } from '../../shared/building'
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
const PREP_LABELS: Record<PrepKind, string> = { discovery: 'secret', scene: 'scene', clue: 'clue', npc: 'NPC', threat: 'threat', thread: 'loose thread', bible: 'world bible line' }
export type PrepItemPatch = Partial<Pick<PrepItemRow,
  'title' | 'body' | 'sceneType' | 'targetStart' | 'targetEnd' | 'entityId' | 'locationId' | 'discoveryId' | 'relationshipId' | 'secretId' | 'description' | 'role' | 'stats' | 'tactics'>>
const STYLE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.jfif', '.webp']
const PENDING_ID = /^[0-9a-f-]{36}\.(png|jpg|webp)$/
function mimeOf(path: string): string {
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
const DEFAULT_PICTURE_FOLDERS = ['Art', 'Portraits', 'Places', 'Items', 'Maps', 'Battle maps', 'Background pictures']
/** The folder a card's picture shows in. */
const PICTURE_FOLDER: Partial<Record<EntityType, string>> = { NPC: 'Portraits', PC: 'Portraits', MONSTER: 'Portraits', LOCATION: 'Places', BUILDING: 'Places', ITEM: 'Items' }

const DEFAULT_RULES_EDITION: RulesEdition = '2024'
const DEFAULT_CLOCK_MIN = 9 * 60 // Day 1, 09:00

export interface Position { x: number; y: number }

export type SettingKey =
  'name' | 'rules_edition' | 'units' | 'clock_min' | 'moon_offset_days' | 'dm_notes' | 'active_map_id' | 'party_level' | 'last_long_rest_min'
  | 'heading_location_id' | 'house_rules' | 'getting_started' | 'link_positions' | 'shared_strings' | 'string_types' | 'picture_folders' | 'art_style' | 'backup_folder' | 'roll_tables' | 'master_notes' | 'type_colours' | 'price_scale' | 'campaign_secrets' | 'world_outline' | 'prompt_templates' | 'word_links' | 'note_meta' | 'notes_starred' | 'notes_folders' | 'note_folder_links'

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

  private backupStem(): string {
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
    return {
      board: boards.find((s) => s.id === boardId) ?? { id: b.id, name: b.name, storylineId: b.storylineId, storyline: null },
      boards,
      items: visibleItems.map(toItemView),
      entities: Object.fromEntries(entities.map((e) => [e.id, e])),
      relationships: relationships.map((r) => toRelationshipView(r, this.secretMap())),
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
      stringTypes: Array.isArray(types) ? (types as StringType[]) : [],
      typeColours: (this.setting('type_colours') ?? {}) as Partial<Record<EntityType, string>>
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

  private fkCache: Array<{ table: TableName; column: string; key: string; parent: string; notNull: boolean }> | null = null
  private fkRefs() {
    return this.fkCache ??= (Object.keys(tracked) as TableName[]).filter((t) => t !== 'campaign_settings').flatMap((t) => {
      const cols = this.db.all<{ name: string; notnull: number }>(sql`PRAGMA table_info(${sql.identifier(t)})`)
      const keys = Object.entries(getTableColumns(tracked[t].table)).map(([k, c]) => [c.name, k] as const)
      return this.db.all<{ table: string; from: string }>(sql`PRAGMA foreign_key_list(${sql.identifier(t)})`).map((f) => ({
        table: t, column: f.from, key: keys.find(([n]) => n === f.from)?.[1] ?? f.from, parent: f.table,
        notNull: cols.find((c) => c.name === f.from)?.notnull === 1
      }))
    })
  }

  private dropRow(w: Writer, table: TableName, id: string): void {
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
  private syncSecretText(w: { update(table: 'prep_item', id: string, patch: { body: string }): void }, by: { secretId: string } | { entityId: string }, text: string): void {
    const tied = this.db.select().from(prepItem).where(and(eq(prepItem.kind, 'discovery'), eq(prepItem.status, 'active'),
      'secretId' in by ? eq(prepItem.secretId, by.secretId) : eq(prepItem.entityId, by.entityId))).all()
    for (const i of tied) if (i.body !== text) w.update('prep_item', i.id, { body: text })
  }

  private secretMap(): Map<string, { kind: string; text: string }> {
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
  saveSecret(input: { id: string | null; kind: SecretKind; text: string; connections: Array<{ id?: string; sourceId: string; targetId: string; type: string }>; prepItemId?: string }): string {
    for (const c of input.connections) {
      if (c.sourceId === c.targetId) throw new Error('A link needs two different cards')
      this.entityRow(c.sourceId); this.entityRow(c.targetId)
    }
    const id = input.id ?? randomUUID()
    const old = input.id ? this.db.select().from(relationship).where(and(eq(relationship.secretId, input.id), eq(relationship.status, 'active'))).all() : []
    const settings = this.boardSettings()
    const owner = settings.sharedStrings ? null : this.globalBoard().id
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
  private placesOnMaps(moves: Array<{ itemId: string } & Position>): Array<{ entity: EntityRow; place: string }> {
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
  private mapPictures(boardId: string) {
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
      return [{ relationship: toRelationshipView(r, this.secretMap()), other, outgoing, partyKnows: knownRels.has(r.id) }]
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

  private setting(key: string): unknown {
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
      today: {
        fights, meetings: count('meeting'), quests: count('quest'),
        last: Object.fromEntries((['fight', 'meeting', 'quest'] as const).flatMap((k) => {
          const row = todayRows.filter((l) => l.kind === k).sort((a, b) => b.atMin - a.atMin || b.createdAt.localeCompare(a.createdAt))[0]
          return row ? [[k, row.id]] : []
        }))
      },
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
          conditions: typeof e.attributes.conditions === 'string' ? e.attributes.conditions : '',
          level: classesOf(e.attributes).reduce((n, c) => n + c.level, 0)
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
      // Limited uses come back (short-rest ones on any rest); a long rest also restores hit points,
      // spell slots and hit dice, clears death saves and takes off one level of exhaustion (2024 rules).
      for (const p of this.partyHealth()) {
        const a = this.entityRow(p.id).attributes
        const uses = usesOf(a).map((u) => (kind === 'long' || u.reset === 'short' ? { ...u, used: 0 } : u))
        const exhaustion = typeof a.exhaustion === 'number' ? a.exhaustion : 0
        w.update('entity', p.id, {
          attributes: kind === 'short' ? { ...a, uses }
            : { ...a, uses, current_hp: p.maxHp, slots_used: null, hit_dice_used: 0, death_saves: null, exhaustion: Math.max(0, exhaustion - 1) }
        })
      }
      if (kind === 'long') {
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

  /** What the AI recap reads: the log (player-safe draft for the players), the session's DM notes, and the recap so far. */
  recapSources(sessionId: string, playerSafe: boolean): { number: number; log: string; notes: string; current: string } {
    const s = this.sessionRow(sessionId)
    const names = new Map(this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name]))
    const log = playerSafe ? this.draftPlayerRecap(sessionId) : this.db.select().from(logEntry)
      .where(and(eq(logEntry.sessionId, sessionId), eq(logEntry.status, 'active'))).all()
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
      .map((l) => `${formatClock(l.atMin)} (${l.kind}): ${[l.entityId ? names.get(l.entityId) : '', l.text].filter(Boolean).join(': ')}`).join('\n')
    return { number: s.number, log, notes: playerSafe ? '' : s.dmNotes, current: playerSafe ? s.playerRecap : s.recap }
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
    const all = this.db.select().from(entity).all()
    const ents = new Map(all.map((e) => [e.id, e]))
    const rels = this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
    return this.regionRows(mapId).flatMap((r) => {
      const loc = ents.get(r.locationId)
      if (!loc || loc.status === 'defunct') return []
      return [{
        id: r.id, locationId: r.locationId, name: loc.name, polygon: r.polygon, parentLocationId: loc.parentId,
        colour: typeof loc.attributes.colour === 'string' ? loc.attributes.colour : null,
        kind: isPlaceKind(loc.attributes.place_kind) ? loc.attributes.place_kind : null,
        biome: isBiome(loc.attributes.biome) ? loc.attributes.biome : null,
        occupants: occupantsOf(loc, all, rels).map((e) => e.name).sort((a, b) => a.localeCompare(b))
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
    const inside = new Set(occupantsOf(loc, all, this.db.select().from(relationship).all()).map((e) => e.id))
    const here = all.filter((e) => e.id !== r.locationId && (linked.has(e.id) || byName(e) || inside.has(e.id)))
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

  /** The map's scale; `bar` = the scale bar it was set with (length and unit, shown again on Change…). */
  setMapScale(mapId: string, widthKm: number | null, travelKmh?: number, bar?: { len: number; unit: LengthUnit }): void {
    const m = this.mapRow(mapId)
    this.log.run(`Set the scale of ${m.name}`, (w) => {
      w.update('map', mapId, { widthKm, ...(travelKmh != null && { travelKmh }), ...(bar && { scaleLen: bar.len, scaleUnit: bar.unit }) })
    })
  }

  /** The scale key on the map: shown or not, and where (image pixels). */
  setMapScaleKey(mapId: string, patch: { shown?: boolean; x?: number; y?: number }): void {
    const m = this.mapRow(mapId)
    const label = patch.shown === undefined ? `Moved the scale key on ${m.name}` : `${patch.shown ? 'Showed' : 'Hid'} the scale key on ${m.name}`
    this.log.run(label, (w) => {
      w.update('map', mapId, { ...(patch.shown !== undefined && { scaleKey: patch.shown }), ...(patch.x !== undefined && { scaleKeyX: patch.x }), ...(patch.y !== undefined && { scaleKeyY: patch.y }) })
    })
  }

  /** Grid lines drawn over the map, or not. */
  setMapGridShown(mapId: string, shown: boolean): void {
    const m = this.mapRow(mapId)
    this.log.run(`${shown ? 'Showed' : 'Hid'} the grid on ${m.name}`, (w) => { w.update('map', mapId, { gridShown: shown }) })
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
      .map((r) => ({ id: r.id, name: r.name, url: ASSET_URL_PREFIX + r.imagePath, tags: r.tags ?? {} }))
  }

  /** Uploads a picture into the Library; new art is a style example for every kind of drawing until the DM unticks it. */
  addStyleExample(sourceFile: string, name?: string, folder = 'Art'): StyleExampleView {
    const ext = extname(sourceFile).toLowerCase()
    if (!STYLE_EXTENSIONS.includes(ext)) throw new Error(`Pictures for the Library must be PNG, JPEG or WebP images (got ${ext || 'no extension'})`)
    const id = randomUUID()
    const rel = `styles/${id}${storedExt(ext)}`
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
      styleFor: r.styleFor.filter((u): u is StyleUse => (STYLE_USES as readonly string[]).includes(u)), tags: r.tags ?? {}, from: null
    }))
    const add = (key: string, name: string, folder: string, path: string, from: LibraryPictureView['from']) => {
      if (filed.has(path)) return
      filed.add(path)
      out.push({ key, name, folder, path, url: ASSET_URL_PREFIX + path, styleFor: [], tags: {}, from })
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
  updatePicture(key: string, patch: { name?: string; folder?: string; styleFor?: StyleUse[]; tags?: StyleTags }): void {
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
        folder: patch.folder ?? p.folder, styleFor: patch.styleFor ?? [], tags: patch.tags ?? {}
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
    return rows.map((r) => ({ bytes: readFileSync(join(this.folder, ASSETS_DIR, r.imagePath)), mime: mimeOf(r.imagePath), key: r.imagePath }))
  }

  /** A picture waiting for the DM, to send back to the AI for Update picture. */
  pendingImage(pendingId: string): { bytes: Buffer; mime: string } {
    return { bytes: readFileSync(this.pendingFile(pendingId)), mime: mimeOf(pendingId) }
  }

  /** A picture the DM chose as a drawing's outline, copied into assets/outlines (the outline itself is saved by the caller, undoable). */
  addOutlinePicture(sourceFile: string): string {
    const ext = extname(sourceFile).toLowerCase()
    if (!STYLE_EXTENSIONS.includes(ext)) throw new Error(`An outline picture must be PNG, JPEG or WebP (got ${ext || 'no extension'})`)
    const rel = `outlines/${randomUUID()}${storedExt(ext)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'outlines'), { recursive: true })
    copyFileSync(sourceFile, join(this.folder, ASSETS_DIR, rel))
    return rel
  }

  /** The outline picture's bytes, or null when the file is gone. */
  outlinePicture(rel: string): { bytes: Buffer; mime: string; key: string } | null {
    const file = this.assetFile(rel)
    return file ? { bytes: readFileSync(file), mime: mimeOf(rel), key: rel } : null
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

  /** A kept picture copied into assets/pending, for Add to picture (the kept file is not touched). */
  pendingCopy(path: string): PendingImageView {
    const file = this.assetFile(path)
    if (!file) throw new Error('That picture is not in this campaign')
    return this.savePendingImage(readFileSync(file), mimeOf(path))
  }

  private pendingFile(pendingId: string): string {
    if (!PENDING_ID.test(pendingId)) throw new Error('Not a waiting image')
    const file = join(this.folder, ASSETS_DIR, 'pending', pendingId)
    if (!existsSync(file)) throw new Error('That image is gone; draw it again')
    return file
  }

  /** Keeps a drawn battle map: it becomes a map with a grid (one undo step). */
  keepBattleMap(input: { pendingId: string; name: string; cols: number; source: string; prompt: string; gridShown?: boolean }): MapView {
    const from = this.pendingFile(input.pendingId)
    const id = randomUUID()
    const rel = `maps/${id}${extname(input.pendingId)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'maps'), { recursive: true })
    renameSync(from, join(this.folder, ASSETS_DIR, rel))
    const size = imageSize(readFileSync(join(this.folder, ASSETS_DIR, rel)))
    this.log.run(`Kept battle map ${input.name}`, (w) => {
      w.insert('map', {
        id, name: input.name, imagePath: rel, width: size?.width ?? null, height: size?.height ?? null, gridSize: null,
        status: 'active', kind: 'battle', gridCols: input.cols, gridShown: !!input.gridShown, source: input.source, prompt: input.prompt
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
    spellAbility?: string | null; prepared?: string[]; classes?: Array<{ name: string; subclass: string; level: number }> | null; saveNotes?: string | null
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
      if (input.classes?.length) attrs.classes = input.classes
      if (input.saveNotes) attrs.save_notes = input.saveNotes
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
    mkdirSync(join(this.folder, ASSETS_DIR, 'pictures'), { recursive: true })
    const rel = this.pictureName(e, storedExt(ext))
    if ('file' in from) copyFileSync(src, join(this.folder, ASSETS_DIR, rel))
    else renameSync(src, join(this.folder, ASSETS_DIR, rel))
    this.log.run(`New picture for ${e.name}`, (w) => {
      w.update('entity', entityId, { attributes: { ...e.attributes, picture: rel, picture_source: 'source' in from ? from.source : null } })
    })
  }

  /** Card picture file name: the card's name and a picture number (Ottoman_1.png, Old_Mill_2.jpg; owner, 2026-10-14). */
  private pictureName(e: { name: string; type: string }, ext: string): string {
    const safe = e.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().replace(/\s+/g, '_').replace(/[.\s]+$/, '').slice(0, 60)
    const stem = `${safe || e.type[0] + e.type.slice(1).toLowerCase()}_`
    const taken = new Set(readdirSync(join(this.folder, ASSETS_DIR, 'pictures')).map((f) => basename(f, extname(f)).toLowerCase()))
    let n = 1
    while (taken.has(`${stem}${n}`.toLowerCase())) n++
    return `pictures/${stem}${n}${ext}`
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
  importTargets(): Array<{ id: string; name: string; type: string; status: string }> {
    return this.db.select().from(entity).all()
      .filter((e) => e.status === 'active' || e.status === 'resolved' || e.status === 'stashed')
      .map((e) => ({ id: e.id, name: e.name, type: e.type, status: e.status }))
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
      battleMaps: this.maps().filter((m) => m.kind === 'battle').map((m) => ({ id: m.id, name: m.name })),
      secrets: this.secretViews().flatMap((s) => (s.kind === 'connection' ? [] : [{ id: s.id, kind: s.kind, label: s.label || s.text }])),
      partyPlace: this.partyPlace()
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
    const out = new Set(Array.isArray(a.pcs_out) ? a.pcs_out as string[] : [])
    const pcs = this.partyHealth().map((x) => ({ id: x.id, name: x.name, level: x.level || p.level, hp: x.hp, maxHp: x.maxHp, in: !out.has(x.id) }))
    const levels = pcs.filter((x) => x.in).map((x) => x.level)
    return {
      id, name: e.name, locationId: at?.targetId ?? null, locationName: at ? byId.get(at.targetId)?.name ?? null : null,
      target, tactics: typeof a.tactics === 'string' ? a.tactics : '', notes: typeof a.summary === 'string' ? a.summary : '',
      scene: typeof a.scene === 'string' ? a.scene : '',
      battleMapId: typeof a.battle_map_id === 'string' ? a.battle_map_id : null,
      sketch: readSketch(a.sketch),
      follow: readFollow(a.follow),
      story: readStory(a.story),
      creatures, pcs, difficulty: rateEncounter(creatures, pcs.length ? (levels.length ? levels : [p.level]) : p.level, p.size, p.factor), runs
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

  updateEncounter(id: string, patch: { name?: string; locationId?: string | null; target?: 'low' | 'moderate' | 'high'; tactics?: string; notes?: string; scene?: string; battleMapId?: string | null; pcsOut?: string[]; sketch?: Sketch | null; follow?: FollowSource | null; story?: EncounterStory }): void {
    const e = this.entityRow(id)
    this.log.run(`Edited encounter ${patch.name ?? e.name}`, (w) => {
      const attrs: Record<string, unknown> = { encounter: true }
      if (patch.target) attrs.target = patch.target
      if (patch.tactics !== undefined) attrs.tactics = patch.tactics
      if (patch.notes !== undefined) attrs.summary = patch.notes
      if (patch.scene !== undefined) attrs.scene = patch.scene
      if (patch.battleMapId !== undefined) attrs.battle_map_id = patch.battleMapId
      if (patch.pcsOut !== undefined) attrs.pcs_out = patch.pcsOut
      if (patch.sketch !== undefined) attrs.sketch = patch.sketch
      if (patch.follow !== undefined) attrs.follow = patch.follow
      if (patch.story !== undefined) attrs.story = patch.story
      w.update('entity', id, { name: patch.name, attributes: { ...e.attributes, ...attrs } })
      if (patch.locationId !== undefined) {
        for (const r of this.db.select().from(relationship).where(and(eq(relationship.sourceId, id), eq(relationship.type, 'LOCATED_AT'), eq(relationship.status, 'active'))).all()) {
          w.update('relationship', r.id, { status: 'defunct' })
        }
        if (patch.locationId) w.insert('relationship', { id: randomUUID(), sourceId: id, targetId: patch.locationId, type: 'LOCATED_AT', isSecret: false, status: 'active' })
      }
    })
  }

  /**
   * An encounter's pictures and maps folder: one the DM chose anywhere on the computer, else
   * assets/encounters/<name> in the campaign (made, and remembered, the first time it is needed).
   */
  encounterFolder(id: string, make = false): string {
    const e = this.entityRow(id)
    const own = typeof e.attributes.folder === 'string' ? e.attributes.folder : ''
    if (own) {
      const abs = /^([a-zA-Z]:)?[\\/]/.test(own) ? own : join(this.folder, ASSETS_DIR, ...own.split('/'))
      if (make) mkdirSync(abs, { recursive: true })
      return abs
    }
    const base = e.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Encounter'
    let rel = `encounters/${base}`
    for (let n = 2; existsSync(join(this.folder, ASSETS_DIR, rel)); n++) rel = `encounters/${base} ${n}`
    if (!make) return join(this.folder, ASSETS_DIR, rel)
    mkdirSync(join(this.folder, ASSETS_DIR, rel), { recursive: true })
    this.log.run(`Made a pictures folder for ${e.name}`, (w) => { w.update('entity', id, { attributes: { ...e.attributes, folder: rel } }) })
    return join(this.folder, ASSETS_DIR, rel)
  }

  /** The DM's own folder for an encounter's pictures (null: back to the campaign's). One undo step. */
  setEncounterFolder(id: string, folder: string | null): void {
    const e = this.entityRow(id)
    this.log.run(folder ? `${e.name} uses the folder ${folder}` : `${e.name} uses a folder in the campaign`, (w) => {
      w.update('entity', id, { attributes: { ...e.attributes, folder } })
    })
  }

  /** Copies the pictures, maps and PDFs in a folder elsewhere into the encounter's folder. */
  copyFolderIntoEncounter(id: string, dir: string): number {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && [...MAP_EXTENSIONS, '.pdf'].includes(extname(f.name).toLowerCase()))
      .map((f) => join(dir, f.name))
    return files.length ? this.addEncounterPictures(id, files) : 0
  }

  /**
   * An encounter that used a folder outside the campaign (before 1.5.x): back to a folder in the
   * campaign, with copies of that folder's files (the originals stay where they are).
   */
  bringEncounterFolderIn(id: string): number {
    const outside = this.encounterPictures(id)
    this.setEncounterFolder(id, null)
    return outside.own && existsSync(outside.folder) ? this.copyFolderIntoEncounter(id, outside.folder) : 0
  }

  /** Pictures, maps and PDFs in an encounter's folder (files the DM put there in Windows count too). */
  encounterPictures(id: string): { folder: string; own: boolean; files: Array<{ name: string; url: string; picture: boolean }>; removed: number } {
    const e = this.entityRow(id)
    const own = typeof e.attributes.folder === 'string' && /^([a-zA-Z]:)?[\\/]/.test(e.attributes.folder)
    const folder = this.encounterFolder(id)
    const list = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile()) : [])
    const files = list(folder)
      .filter((f) => [...MAP_EXTENSIONS, '.pdf'].includes(extname(f.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => ({ name: f.name, url: `dz-asset://encounter/${id}/${encodeURIComponent(f.name)}`, picture: MAP_EXTENSIONS.includes(extname(f.name).toLowerCase()) }))
    return { folder, own, files, removed: list(join(folder, 'Removed')).length }
  }

  /** One file in an encounter's folder, by name; null when there is none. */
  encounterFile(id: string, name: string): string | null {
    if (!name || /[\\/]|^\.\.?$/.test(name) || name.includes(':')) return null
    const file = join(this.encounterFolder(id), name)
    return existsSync(file) ? file : null
  }

  /** Copies the DM's files into the encounter's folder (a name already there gets a number). */
  addEncounterPictures(id: string, paths: string[]): number {
    const folder = this.encounterFolder(id, true)
    for (const src of paths) {
      const stem = basename(src, extname(src))
      const ext = storedExt(extname(src))
      let name = `${stem}${ext}`
      for (let n = 2; existsSync(join(folder, name)); n++) name = `${stem} ${n}${ext}`
      copyFileSync(src, join(folder, name))
    }
    return paths.length
  }

  /** Moves a file into the folder's Removed subfolder (nothing is deleted; move it back in Windows). */
  removeEncounterPicture(id: string, name: string): void {
    const file = this.encounterFile(id, name)
    if (!file) throw new Error('That file is not in the folder any more')
    const bin = join(this.encounterFolder(id), 'Removed')
    mkdirSync(bin, { recursive: true })
    let to = join(bin, name)
    for (let n = 2; existsSync(to); n++) to = join(bin, `${basename(name, extname(name))} ${n}${extname(name)}`)
    renameSync(file, to)
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

  /** Where the party is now, if they are placed on a map. */
  partyPlace(): { id: string; name: string } | null {
    try {
      const p = this.liveWhere().place
      return p ? { id: p.locationId, name: p.name } : null
    } catch { return null }
  }

  /** A Location card's name and its land for themed rolls: its biome, or settlement / dungeon / water by kind. */
  placeLands(locationId: string): { name: string; lands: string[] } {
    const e = this.entityRow(locationId)
    const kind = e.attributes.place_kind
    const lands = [
      ...(isBiome(e.attributes.biome) ? [e.attributes.biome] : []),
      ...(kind === 'village' || kind === 'town' || kind === 'city' ? ['settlement'] : kind === 'dungeon' ? ['dungeon'] : kind === 'sea' ? ['water'] : [])
    ]
    return { name: e.name, lands }
  }

  /**
   * Raise or lower the challenge rating of creatures in an encounter one step (owner, 2026-10-15): each becomes
   * an adjusted copy that lives only in this encounter ("Goblin Boss (CR 2)"); a copy already made for it is
   * changed in place. The original card stays as it is. One undo step.
   */
  adjustEncounterCr(encounterId: string, entityIds: string[], step: 1 | -1): void {
    const e = this.entityRow(encounterId)
    this.log.run(`${step > 0 ? 'Raised' : 'Lowered'} the challenge rating in ${e.name}`, (w) => {
      this.adoptLegacyCreatures(w, encounterId)
      const rows = this.db.select().from(encounterCreature).where(and(eq(encounterCreature.encounterId, encounterId), eq(encounterCreature.status, 'active'))).all()
      for (const id of entityIds) {
        const row = rows.find((r) => r.entityId === id)
        const c = this.entityRow(id)
        const sb = readStatBlock(c.attributes.statblock)
        const i = sb ? crStep(sb.cr) : null
        const to = i == null ? undefined : CR_STEPS[i + step]
        if (!row || !sb || !to) continue
        const abilities = this.db.select().from(ability).where(and(eq(ability.entityId, id), eq(ability.status, 'active'))).all().sort((a, b) => a.sort - b.sort)
        const r = scaleToCr(sb, abilities, to)
        const base = typeof c.attributes.adjusted_from_name === 'string' ? c.attributes.adjusted_from_name : c.name
        const name = `${base} (CR ${to})`
        if (c.attributes.adjusted_for === encounterId) {
          w.update('entity', id, { name, attributes: { ...c.attributes, statblock: r.statblock } })
          for (const a of r.abilities) {
            const old = abilities.find((x) => x.id === a.id)!
            if (old.description !== a.description || old.macroText !== a.macroText) w.update('ability', a.id, { description: a.description, macroText: a.macroText })
          }
        } else {
          const { source: _source, ...rest } = c.attributes as Record<string, unknown>
          const copyId = this.insertEntity(w, {
            boardId: this.globalBoard().id, type: c.type as EntityType, name, position: this.freeGlobalSpot(), status: 'stashed', tags: c.tags,
            attributes: { ...rest, statblock: r.statblock, adjusted_for: encounterId, adjusted_from_name: c.name },
            abilities: abilities.map((a, k) => ({ name: a.name, kind: a.kind as AbilityKind, description: r.abilities[k].description, macroText: r.abilities[k].macroText, showTokenAction: a.showTokenAction, showMacroBar: a.showMacroBar }))
          })
          w.update('encounter_creature', row.id, { entityId: copyId })
        }
      }
      this.syncFight(w, encounterId)
    })
  }

  /** An NPC or item line of an encounter's story made into a card (items go on the board). One undo step; returns the card. */
  encounterStoryCard(encounterId: string, kind: 'npc' | 'item', rowId: string): string {
    const e = this.entityRow(encounterId)
    const story = readStory(e.attributes.story)
    const row = kind === 'npc' ? story.npcs.find((x) => x.id === rowId) : story.items.find((x) => x.id === rowId)
    if (!row) throw new Error('That line is no longer in the encounter')
    if (row.entityId) return row.entityId
    const n = 'count' in row ? Number(row.count) : 1
    const count = n > 1 ? `${n} × ` : ''
    let id = ''
    this.log.run(`Made a card for ${row.name} (${e.name})`, (w) => {
      id = this.insertEntity(w, {
        boardId: this.globalBoard().id, type: kind === 'npc' ? 'NPC' : 'ITEM', name: row.name || (kind === 'npc' ? 'Someone' : 'Something'), position: this.freeGlobalSpot(),
        attributes: { summary: `${count}${row.notes}`.trim() || `From the encounter ${e.name}` }
      })
      const next = kind === 'npc'
        ? { ...story, npcs: story.npcs.map((x) => (x.id === rowId ? { ...x, entityId: id } : x)) }
        : { ...story, items: story.items.map((x) => (x.id === rowId ? { ...x, entityId: id } : x)) }
      w.update('entity', encounterId, { attributes: { ...e.attributes, story: next } })
    })
    return id
  }

  /**
   * Keeps a built encounter (themed roll or AI draft): the encounter card with its place, scene, story and
   * tactics; SRD monsters (the card already copied, or a new copy) and the DM's included cards in it.
   * Put on the board = active cards; Save for later = stashed. One undo step; returns the encounter.
   */
  keepEncounterDraft(d: { name: string; scene: string; difficulty: 'low' | 'moderate' | 'high'; locationId: string | null; groups: Array<{ key: string; count: number; notes: string }>; include: Array<{ entityId: string; count: number }>; story: EncounterStory | null; tactics: string }, stash: boolean, copy: (key: string) => SrdCopy): string {
    const cards = this.db.select().from(entity).all().filter((x) => x.status !== 'defunct')
    const status: EntityStatus = stash ? 'stashed' : 'active'
    let id = ''
    this.log.run(`${stash ? 'Saved for later' : 'Put on the board'}: ${d.name}`, (w) => {
      id = this.insertEntity(w, {
        boardId: this.globalBoard().id, type: 'SCENE', name: d.name, position: this.freeGlobalSpot(), status,
        attributes: { encounter: true, target: d.difficulty, tactics: d.tactics, summary: '', scene: d.scene, ...(d.story ? { story: d.story } : {}), generated: true }
      })
      if (d.locationId && cards.some((x) => x.id === d.locationId)) w.insert('relationship', { id: randomUUID(), sourceId: id, targetId: d.locationId, type: 'LOCATED_AT', isSecret: false, status: 'active' })
      for (const g of d.groups) {
        let cid = cards.find((x) => (x.attributes.source as { key?: string } | undefined)?.key === g.key)?.id
        if (!cid) {
          const c = copy(g.key)
          cid = this.insertEntity(w, { boardId: this.globalBoard().id, type: c.type, name: c.name, position: this.freeGlobalSpot(), status, attributes: c.attributes, abilities: c.abilities })
        }
        this.putCreature(w, id, cid, g.count)
        if (g.notes) {
          const row = this.db.select().from(encounterCreature).where(and(eq(encounterCreature.encounterId, id), eq(encounterCreature.entityId, cid), eq(encounterCreature.status, 'active'))).get()
          if (row) w.update('encounter_creature', row.id, { notes: g.notes })
        }
      }
      for (const inc of d.include) if (cards.some((x) => x.id === inc.entityId)) this.putCreature(w, id, inc.entityId, inc.count)
    })
    return id
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
    const combatants: Combatant[] = enc.pcs.filter((p) => p.in).map((p) => this.fightCombatant(p.id, 'party', p.name))
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
      actions: acts.map((a) => ({ name: a.name, kind: a.kind, text: a.description.length > 300 ? `${a.description.slice(0, 300)}…` : a.description, full: a.description })),
      slots: nums(e.attributes.spell_slots) ?? slotsFromText(all),
      slotsUsed: nums(e.attributes.slots_used) ?? Array<number>(9).fill(0),
      cardType: e.type,
      size: sb?.size ?? '',
      pc: e.type !== 'PC' ? null : (() => {
        const hd = hitDice(sb?.hitDice || sb?.hp || '', classesOf(e.attributes))
        return {
          inspiration: e.attributes.inspiration === true,
          exhaustion: typeof e.attributes.exhaustion === 'number' ? e.attributes.exhaustion : 0,
          uses: usesOf(e.attributes),
          hitDice: { ...hd, used: Math.min(hd.total, typeof e.attributes.hit_dice_used === 'number' ? e.attributes.hit_dice_used : 0) }
        }
      })()
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
    // A character's death saves live on its card (the full sheet shows the same ticks).
    const combatants = state.combatants.map((c) => {
      const saved = c.side === 'party' && c.entityId ? this.deathSavesOf(c.entityId) : null
      return saved ? { ...c, death: saved } : c
    })
    return {
      id, encounterId: row.encounterId, encounterName: this.nameOf(row.encounterId), status: row.status === 'ended' ? 'ended' : 'active',
      state: { ...state, combatants }, info, sessionRunning: !!this.openSession()
    }
  }

  /**
   * Battle planner for an encounter: from the running fight (HP, who is down or concentrating, foes still
   * standing) or, before it, from the party and the encounter's creatures. Spell slots left count.
   */
  battlePlan(encounterId: string): BattlePlan {
    const fight = this.db.select().from(combat).where(and(eq(combat.encounterId, encounterId), eq(combat.status, 'active'))).get()
    const state = fight ? CombatState.parse(fight.state) : null
    const pcs: PlanPc[] = state
      ? state.combatants.filter((c) => c.side === 'party' && c.entityId).map((c) => this.planPc(c.entityId!, c.hp, c.maxHp,
        c.out === 'down' || (c.maxHp > 0 && c.hp === 0), !!(c.rounds[String(state.round)]?.c || c.rounds[String(state.round - 1)]?.c)))
      : this.encounterView(encounterId).pcs.filter((p) => p.in).map((p) => this.planPc(p.id, p.hp, p.maxHp, p.maxHp > 0 && p.hp === 0, false))
    const counts = new Map<string, number>()
    if (state) {
      for (const c of state.combatants) if (c.side === 'foe' && c.entityId && !c.out && !(c.maxHp > 0 && c.hp === 0)) counts.set(c.entityId, (counts.get(c.entityId) ?? 0) + 1)
    } else {
      for (const cr of this.encounterView(encounterId).creatures) counts.set(cr.entityId, (counts.get(cr.entityId) ?? 0) + cr.count)
    }
    const foes = [...counts].map(([id, count]) => this.planFoe(id, count)).filter((f): f is PlanFoe => !!f)
    return battlePlan(pcs, foes)
  }

  private planPc(entityId: string, hp: number, maxHp: number, down: boolean, concentrating: boolean): PlanPc {
    const e = this.entityRow(entityId)
    const sb = readStatBlock(e.attributes.statblock)
    const acts = this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all()
    const nums = (v: unknown) => (Array.isArray(v) ? Array.from({ length: 9 }, (_, i) => Math.max(0, Number(v[i]) || 0)) : null)
    const slots = nums(e.attributes.spell_slots) ?? slotsFromText((sb?.traits ?? []).map((t) => `${t.name} ${t.desc}`).join('\n'))
    const used = nums(e.attributes.slots_used) ?? Array<number>(9).fill(0)
    return {
      name: e.name, ac: sb ? leadingNumber(sb.ac) : null, hp, maxHp, down, concentrating,
      slotsLeft: slots.map((n, i) => Math.max(0, n - used[i])),
      powers: acts.map((a) => ({
        name: a.name, level: a.kind === 'SPELL' ? spellLevel(a.description) : null, roles: spellRoles(a.name, a.description),
        save: /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Saving Throw/i.exec(a.description)?.[1] ?? '',
        text: a.description.slice(0, 3000)
      }))
    }
  }

  private planFoe(entityId: string, count: number): PlanFoe | null {
    const e = this.db.select().from(entity).where(eq(entity.id, entityId)).get()
    if (!e) return null
    const sb = readStatBlock(e.attributes.statblock)
    const acts = this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all()
    const texts = [...(sb?.traits ?? []).map((t) => `${t.name}. ${t.desc}`), ...acts.map((a) => `${a.name}. ${a.description}`)]
    return {
      name: e.name, count, int: sb?.int ?? 10, cr: sb?.cr ?? '',
      ranged: texts.some((t) => /Ranged Attack Roll|ranged weapon attack|\brange \d+/i.test(t)),
      flies: /\bfly \d+/i.test(sb?.speed ?? ''),
      legendaryResist: texts.some((t) => /legendary resistance/i.test(t)),
      leader: isLeaderName(e.name) || texts.some((t) => /^leadership\b/i.test(t)),
      caster: acts.some((a) => a.kind === 'SPELL') || texts.some((t) => /^spellcasting\b|\bcasts? one of the following spells\b/i.test(t)),
      saves: Object.fromEntries(ABILITY_KEYS.map((k) => [k, sb ? saveBonus(sb, k).bonus : 0]))
    }
  }

  private deathSavesOf(entityId: string): { s: number; f: number } | null {
    const e = this.db.select().from(entity).where(eq(entity.id, entityId)).get()
    if (!e || e.type !== 'PC') return null
    const d = (e.attributes.death_saves && typeof e.attributes.death_saves === 'object' ? e.attributes.death_saves : {}) as { s?: unknown; f?: unknown }
    const n = (v: unknown) => Math.max(0, Math.min(3, Math.round(Number(v)) || 0))
    return { s: n(d.s), f: n(d.f) }
  }

  /** The DM's change to the fight (damage, a condition, the next turn…): one undo step each; changed death saves go to the card. */
  updateCombat(id: string, state: CombatState, label: string): void {
    this.log.run(label, (w) => {
      w.update('combat', id, { state })
      for (const c of state.combatants) {
        const saved = c.side === 'party' && c.entityId ? this.deathSavesOf(c.entityId) : null
        if (!saved || (saved.s === c.death.s && saved.f === c.death.f)) continue
        const e = this.entityRow(c.entityId!)
        w.update('entity', e.id, { attributes: { ...e.attributes, death_saves: c.death.s || c.death.f ? c.death : null } })
      }
    })
  }

  /** Ends the fight (one undo step): optionally marks defeated cards resolved and logs a summary in the running session. */
  endCombat(id: string, opts: { resolveIds?: string[]; summary?: string; xp?: { each: number; pcIds: string[] } } = {}): void {
    const row = this.db.select().from(combat).where(eq(combat.id, id)).get()
    if (!row) throw new Error('That fight is no longer here')
    const open = this.openSession()
    this.log.run(`Ended the fight: ${this.nameOf(row.encounterId)}`, (w) => {
      w.update('combat', id, { status: 'ended' })
      // XP shared equally (owner, 1.6.0): added to each character's running total.
      for (const pid of opts.xp && opts.xp.each > 0 ? opts.xp.pcIds : []) {
        const e = this.db.select().from(entity).where(eq(entity.id, pid)).get()
        if (e) w.update('entity', pid, { attributes: { ...e.attributes, xp: (typeof e.attributes.xp === 'number' ? e.attributes.xp : 0) + opts.xp!.each } })
      }
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
      // Prep lines no longer pick a place (owner, 2026-10-14): their links to cards here bring them in as strings above.
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
      // A note whose file is gone (Delete file for good, then an undo past it) is not shown.
      docs: this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all().filter((r) => existsSync(join(this.folder, ASSETS_DIR, r.file)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((r) => ({ id: r.id, title: r.title, kind: r.kind as NoteDocView['kind'], originalName: r.originalName, updatedAt: r.updatedAt, versions: r.versions, folder: r.folder, meta: this.noteMetas()[r.id] ?? {} })),
      sessions: this.db.select().from(session).where(eq(session.status, 'active')).all()
        .sort((a, b) => b.number - a.number)
        .map((r) => ({ id: r.id, number: r.number, startedAt: r.startedAt, running: r.id === open?.id, dmNotes: r.dmNotes, recap: r.recap })),
      dmNotes: String(this.setting('dm_notes') ?? ''),
      starred: this.starredNotes(),
      folders: this.allNoteFolders(),
      folderLinks: this.folderLinks()
    }
  }

  /** Folders the DM made (paths "A/B/C"; 2.8.0), kept even when empty. */
  private madeFolders(): string[] {
    const v = this.setting('notes_folders')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }

  private folderLinks(): Record<string, string> {
    const v = this.setting('note_folder_links')
    return v && typeof v === 'object' ? v as Record<string, string> : {}
  }

  /** Every folder: the ones made, and every folder (and parent) a note sits in. */
  private allNoteFolders(): string[] {
    const out = new Set<string>()
    const add = (p: string) => { const parts = p.split('/'); for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/')) }
    for (const f of this.madeFolders()) if (f) add(f)
    for (const r of this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all()) if (r.folder) add(r.folder)
    return [...out]
  }

  /**
   * Notes folders (2.8.0, owner): make, rename or move (a new path; notes and folders inside go along), delete (its notes
   * go to History), link to a card. One undo step each.
   */
  noteFolder(a: { action: 'create'; path: string } | { action: 'rename'; from: string; to: string } | { action: 'delete'; path: string } | { action: 'link'; path: string; card: string | null }): void {
    const within = (f: string, p: string) => f === p || f.startsWith(`${p}/`)
    const set = (w: Parameters<Parameters<typeof this.log.run>[1]>[0], key: SettingKey, value: unknown) => {
      if (w.get('campaign_settings', key)) w.update('campaign_settings', key, { value }); else w.insert('campaign_settings', { key, value })
    }
    const made = this.madeFolders(), links = this.folderLinks()
    const docs = this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all()
    const name = (p: string) => p.split('/').pop()
    if (a.action === 'create') {
      if (this.allNoteFolders().includes(a.path)) return
      this.log.run(`New notes folder ${name(a.path)}`, (w) => set(w, 'notes_folders', [...made, a.path]))
    } else if (a.action === 'rename') {
      if (a.from === a.to || within(a.to, a.from)) return
      const move = (f: string) => (within(f, a.from) ? a.to + f.slice(a.from.length) : f)
      this.log.run(name(a.from) === name(a.to) ? `Moved the folder ${name(a.from)}` : `Renamed the folder ${name(a.from)} to ${name(a.to)}`, (w) => {
        for (const r of docs) if (r.folder && within(r.folder, a.from)) w.update('note_doc', r.id, { folder: move(r.folder) })
        set(w, 'notes_folders', [...new Set([...made.map(move), a.to])])
        set(w, 'note_folder_links', Object.fromEntries(Object.entries(links).map(([k, v]) => [move(k), v])))
      })
    } else if (a.action === 'delete') {
      const gone = docs.filter((r) => r.folder && within(r.folder, a.path))
      this.log.run(`Deleted the folder ${name(a.path)}${gone.length ? ` (${gone.length} notes to History)` : ''}`, (w) => {
        for (const r of gone) w.update('note_doc', r.id, { status: 'defunct' })
        set(w, 'notes_folders', made.filter((f) => !within(f, a.path)))
        set(w, 'note_folder_links', Object.fromEntries(Object.entries(links).filter(([k]) => !within(k, a.path))))
      })
    } else {
      const next = { ...links }
      if (a.card) next[a.path] = a.card; else delete next[a.path]
      this.log.run(a.card ? `Linked the folder ${name(a.path)} to a card` : `Unlinked the folder ${name(a.path)}`, (w) => set(w, 'note_folder_links', next))
    }
  }

  /** Notes linked to this card: by the note itself, or by a folder it sits in. */
  notesLinkedTo(entityId: string): string[] {
    const folders = Object.entries(this.folderLinks()).filter(([, v]) => v === entityId).map(([k]) => k)
    const metas = this.noteMetas()
    return this.db.select().from(noteDoc).where(eq(noteDoc.status, 'active')).all()
      .filter((r) => metas[r.id]?.card === entityId || folders.some((f) => r.folder === f || r.folder.startsWith(`${f}/`))).map((r) => r.id)
  }

  /** The folder linked to this card ('' = none): where its new notes go. */
  folderOfCard(entityId: string): string {
    return Object.entries(this.folderLinks()).find(([, v]) => v === entityId)?.[0] ?? ''
  }

  private noteMetas(): Record<string, NoteMeta> {
    const v = this.setting('note_meta')
    return v && typeof v === 'object' ? v as Record<string, NoteMeta> : {}
  }

  /** Notes book view (2.8.0): banner, pictures taken out or moved, names not offered as cards; undoable. */
  setNoteMeta(id: string, meta: NoteMeta): void {
    const r = this.noteRow(id)
    this.setSetting('note_meta', { ...this.noteMetas(), [id]: meta }, `Changed the pictures of the note ${r.title}`)
  }

  private starredNotes(): string[] {
    const v = this.setting('notes_starred')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  }

  starNote(id: string, on: boolean): void {
    const r = this.noteRow(id)
    const rest = this.starredNotes().filter((x) => x !== id)
    this.setSetting('notes_starred', on ? [...rest, id] : rest, `${on ? 'Starred' : 'Unstarred'} the note ${r.title}`)
  }

  /** A picture the DM chose for a note (copied into the campaign). */
  addNotePicture(sourceFile: string): string {
    const ext = extname(sourceFile).toLowerCase()
    if (!STYLE_EXTENSIONS.includes(ext)) throw new Error(`A picture must be PNG, JPEG or WebP (got ${ext || 'no extension'})`)
    const rel = `notes/pictures/${randomUUID()}${storedExt(ext)}`
    mkdirSync(join(this.folder, ASSETS_DIR, 'notes', 'pictures'), { recursive: true })
    copyFileSync(sourceFile, join(this.folder, ASSETS_DIR, rel))
    return rel
  }

  /** Session prep sheets saved as this note. */
  prepsOfNote(id: string): Array<{ number: number; title: string }> {
    return this.db.select().from(sessionPrep).where(eq(sessionPrep.status, 'active')).all().filter((p) => p.noteDocId === id)
      .map((p) => ({ number: p.number, title: p.title }))
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
    const rel = `notes/${randomUUID()}${storedExt(ext)}`
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

  createNoteDoc(title: string, bytes: Buffer, folder = '', card?: string): string {
    const rel = this.storeNoteFile({ bytes, ext: '.docx' })
    const id = randomUUID()
    const now = new Date().toISOString()
    this.log.run(`New note ${title}`, (w) => {
      w.insert('note_doc', { id, title, kind: 'word', file: rel, originalName: `${title}.docx`, versions: [], folder, status: 'active', createdAt: now, updatedAt: now })
      if (card) {
        const value = { ...this.noteMetas(), [id]: { card } }
        if (w.get('campaign_settings', 'note_meta')) w.update('campaign_settings', 'note_meta', { value }); else w.insert('campaign_settings', { key: 'note_meta', value })
      }
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

  /** Puts notes files in a folder of the Notes list ('' = no folder). One undo step. */
  setNoteFolder(ids: string[], folder: string): void {
    const rows = ids.map((id) => this.noteRow(id))
    this.log.run(folder ? `Moved ${rows.length === 1 ? rows[0].title : `${rows.length} notes`} to the folder ${folder}` : 'Took notes out of their folder', (w) => {
      for (const r of rows) w.update('note_doc', r.id, { folder })
    })
  }

  /** A copy of a notes file (its current version) as a new note. */
  duplicateNoteDoc(id: string): string {
    const r = this.noteRow(id)
    const rel = this.storeNoteFile({ file: join(this.folder, ASSETS_DIR, r.file) })
    const nid = randomUUID()
    const now = new Date().toISOString()
    this.log.run(`Copied the note ${r.title}`, (w) => {
      w.insert('note_doc', { ...r, id: nid, title: `${r.title} (copy)`, file: rel, versions: [], createdAt: now, updatedAt: now })
    })
    return nid
  }

  /** Combine: a new note (Word) from several; the originals stay or go to History. One undo step. */
  combineNoteDocs(title: string, bytes: Buffer, ids: string[], removeOriginals: boolean): string {
    const rows = ids.map((id) => this.noteRow(id))
    const rel = this.storeNoteFile({ bytes, ext: '.docx' })
    const id = randomUUID()
    const now = new Date().toISOString()
    this.log.run(`Combined ${rows.length} notes into ${title}`, (w) => {
      w.insert('note_doc', { id, title, kind: 'word', file: rel, originalName: `${title}.docx`, versions: [], folder: rows[0]?.folder ?? '', status: 'active', createdAt: now, updatedAt: now })
      if (removeOriginals) for (const r of rows) w.update('note_doc', r.id, { status: 'defunct' })
    })
    return id
  }

  /**
   * History › Delete file for good (owner, 1.7.0): forgets a note that is in History and returns its files
   * (every version) for the Recycle Bin. Not undoable on purpose; the DM confirmed first.
   */
  forgetNoteDoc(id: string): string[] {
    const r = this.noteRow(id)
    if (r.status !== 'defunct') throw new Error('Move the note to History first')
    this.db.delete(noteDoc).where(eq(noteDoc.id, id)).run()
    return [r.file, ...r.versions.map((v) => v.file)].map((f) => join(this.folder, ASSETS_DIR, f))
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

  /** Places a card can be at: Location and Building cards, marked when a map region shows them. */
  placeOptions(): Array<{ id: string; name: string; type: 'LOCATION' | 'BUILDING'; fromMap: boolean }> {
    const onMap = new Set(this.db.select().from(regionShape).where(eq(regionShape.status, 'active')).all().map((r) => r.locationId))
    return this.db.select().from(entity).all()
      .filter((e) => (e.type === 'LOCATION' || e.type === 'BUILDING') && e.status !== 'defunct')
      .map((e) => ({ id: e.id, name: e.name, type: e.type as 'LOCATION' | 'BUILDING', fromMap: onMap.has(e.id) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Every card still in play, with what a linked word shows of it. */
  cardBriefs(): PrepScreenView['cards'] {
    return this.db.select().from(entity).all().filter((e) => e.status === 'active' || e.status === 'resolved' || e.status === 'stashed')
      .sort((a, b) => a.name.localeCompare(b.name)).map((e) => {
        const a = e.attributes as Record<string, unknown>
        const t = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
        return { id: e.id, type: e.type as EntityType, name: e.name, status: e.status as EntityStatus, summary: t('summary'), picture: t('picture'), location: t('location'), notes: t('notes'), flaws: t('flaws'), ...(a.encounter === true ? { encounter: true } : {}), ...(typeof a.colour === 'string' ? { colour: a.colour } : {}) }
      })
  }

  /** Text boxes everywhere: card names link by themselves; the DM's own links and the names switched off (setting word_links). */
  wordLinks(): WordLinksView {
    const v = this.setting('word_links') as { own?: WordLinksView['own']; off?: string[] } | undefined
    return { cards: this.cardBriefs(), own: Array.isArray(v?.own) ? v.own : [], off: Array.isArray(v?.off) ? v.off : [] }
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
      cards: this.cardBriefs(),
      secrets: this.secretViews(),
      strings: this.db.select().from(relationship).where(eq(relationship.status, 'active')).all()
        .map((r) => ({ id: r.id, sourceId: r.sourceId, targetId: r.targetId, type: r.type, isSecret: r.isSecret })),
      boardSecrets: [
        ...this.db.select().from(relationship).where(and(eq(relationship.status, 'active'), eq(relationship.isSecret, true))).all()
          .flatMap((r) => {
            const a = live.find((e) => e.id === r.sourceId), b = live.find((e) => e.id === r.targetId)
            return a && b ? [{ kind: 'string' as const, id: r.id, label: `${a.name} ${r.type.toLowerCase().replace(/_/g, ' ')} ${b.name}` }] : []
          }).sort((x, y) => x.label.localeCompare(y.label)),
        ...live.filter((e) => e.type === 'CLUE').map((e) => ({ kind: 'clue' as const, id: e.id, label: `Clue: ${e.name}` }))
      ],
      locations: live.filter((e) => e.type === 'LOCATION').map(brief),
      encounters: this.encountersView().encounters.map((e) => ({ id: e.id, name: e.name, placeName: e.locationName }))
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
        discoveryId: i.discoveryId, relationshipId: i.relationshipId, secretId: i.secretId, description: i.description, role: i.role, stats: i.stats, tactics: i.tactics, done: i.done, doneAtMin: i.doneAtMin
      }))
    const sess = this.db.select().from(session).where(and(eq(session.number, p.number), eq(session.status, 'active'))).get()
    const doc = p.noteDocId ? this.db.select().from(noteDoc).where(eq(noteDoc.id, p.noteDocId)).get() : undefined
    return {
      id: p.id, number: p.number, title: p.title, premise: p.premise, pacingMinutes: p.pacingMinutes, backupNames: p.backupNames, notes: p.notes,
      wantNext: p.wantNext, session: sess ? { id: sess.id, recap: sess.recap } : null, noteDocId: doc?.status === 'active' ? doc.id : null, items,
      links: p.links
    }
  }

  createPrep(number: number): string {
    const existing = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, number), eq(sessionPrep.status, 'active'))).get()
    if (existing) return existing.id
    const id = randomUUID()
    this.log.run(`Started the prep sheet for session ${number}`, (w) => {
      w.insert('session_prep', { id, number, title: '', premise: '', pacingMinutes: 180, backupNames: '', notes: '', wantNext: '', noteDocId: null, status: 'active' })
    })
    return id
  }

  updatePrep(id: string, patch: Partial<Pick<PrepRow, 'number' | 'title' | 'premise' | 'pacingMinutes' | 'backupNames' | 'notes' | 'wantNext' | 'links'>>): void {
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
    // NPCs: what they want, and one cue for how to play them (the one-page DM tool).
    if (kind === 'npc') return { title: e.name, role: text('motivation') || text('goal'), description: text('summary'), body: text('quirk') || text('mannerism') || text('appearance') }
    if (kind === 'threat') {
      const sb = readStatBlock(a.statblock)
      return { stats: sb ? statLine(sb) : '', tactics: text('tactics') }
    }
    return {}
  }

  updatePrepItem(id: string, patch: PrepItemPatch): void {
    const i = this.prepItemRow(id)
    // A prep NPC tied to a card shares its name, description (one-line summary) and motivation, both ways.
    if (i.kind === 'npc') {
      const tie = 'entityId' in patch ? patch.entityId : i.entityId
      if (tie) {
        const card = this.entityRow(tie)
        const a = card.attributes as Record<string, unknown>
        const t = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
        const tying = tie !== i.entityId
        if (tying) patch = { ...patch, title: card.name, role: t('motivation') || i.role, description: t('summary') || i.description, ...(i.body ? {} : { body: t('quirk') || t('mannerism') || t('appearance') }) }
        const name = tying ? null : patch.title?.trim() || null
        const attrs = {
          ...(patch.role !== undefined && patch.role !== t('motivation') ? { motivation: patch.role } : {}),
          ...(patch.description !== undefined && patch.description !== t('summary') ? { summary: patch.description } : {})
        }
        this.log.run(`Edited NPC ${patch.title ?? i.title}`.trim(), (w) => {
          w.update('prep_item', id, patch)
          if ((name && name !== card.name) || Object.keys(attrs).length) {
            w.update('entity', card.id, { ...(name && name !== card.name ? { name } : {}), attributes: { ...card.attributes, ...attrs } })
            // Other prep sheets tied to the same card follow.
            for (const o of this.db.select().from(prepItem).where(and(eq(prepItem.kind, 'npc'), eq(prepItem.entityId, card.id), eq(prepItem.status, 'active'))).all()) {
              if (o.id !== id) w.update('prep_item', o.id, { ...(name ? { title: name } : {}), ...(attrs.motivation !== undefined ? { role: attrs.motivation } : {}), ...(attrs.summary !== undefined ? { description: attrs.summary } : {}) })
            }
          }
        })
        return
      }
    }
    if (patch.entityId) Object.assign(patch, { ...this.prepFromCard(i.kind as PrepKind, this.entityRow(patch.entityId)), ...patch })
    // A secret tied to a secret string or Clue card shares its text: tying takes the board's text (or gives it this one
    // when the board's is empty); later edits here write it back to the board.
    const group = i.kind === 'discovery' ? ('secretId' in patch ? patch.secretId : i.secretId) : null
    const clue = i.kind === 'discovery' && !group ? ('entityId' in patch ? patch.entityId : i.entityId) : null
    const board = group ? this.db.select().from(secret).where(eq(secret.id, group)).get() ?? null : null
    const card = clue ? this.entityRow(clue) : null
    const boardText = board ? board.text : card ? String((card.attributes as Record<string, unknown>).description ?? '') : null
    const tying = (!!group && group !== i.secretId) || (!!clue && clue !== i.entityId)
    const text = patch.body ?? i.body
    if (tying && boardText) patch = { ...patch, body: boardText }
    this.log.run(`Edited ${PREP_LABELS[i.kind as PrepKind]} ${i.title || ''}`.trim(), (w) => {
      w.update('prep_item', id, patch)
      const write = tying ? !boardText && text : patch.body !== undefined
      if (write && board) { w.update('secret', board.id, { text }); this.syncSecretText(w, { secretId: board.id }, text) }
      if (write && card) { w.update('entity', card.id, { attributes: { ...card.attributes, description: text } }); this.syncSecretText(w, { entityId: card.id }, text) }
    })
  }

  /** Ticks a discovery as revealed, a scene as played or a clue as found, at the campaign time. */
  setPrepDone(id: string, done: boolean): void {
    const i = this.prepItemRow(id)
    const what = i.kind === 'discovery' ? (done ? 'Revealed' : 'Unrevealed') : i.kind === 'scene' ? (done ? 'Played' : 'Unplayed')
      : i.kind === 'thread' ? (done ? 'Followed up' : 'Reopened') : done ? 'Found' : 'Unfound'
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

  /**
   * Loose threads from the last session (one undo step): its "what the players seem to want next"
   * and its threads not ticked off, copied onto this sheet.
   */
  bringThreads(prepId: string): number {
    const p = this.prepRow(prepId)
    const last = this.db.select().from(sessionPrep).where(eq(sessionPrep.status, 'active')).all()
      .filter((x) => x.number < p.number).sort((a, b) => b.number - a.number)[0]
    if (!last) throw new Error('No earlier prep sheet to bring threads from')
    const have = new Set(this.db.select().from(prepItem).where(and(eq(prepItem.prepId, prepId), eq(prepItem.kind, 'thread'), eq(prepItem.status, 'active'))).all()
      .map((i) => i.body.trim().toLowerCase()))
    const texts = [
      ...last.wantNext.split('\n').map((l) => l.trim()),
      ...this.db.select().from(prepItem).where(and(eq(prepItem.prepId, last.id), eq(prepItem.kind, 'thread'), eq(prepItem.status, 'active'), eq(prepItem.done, false))).all()
        .sort((a, b) => a.sort - b.sort).map((i) => i.body.trim())
    ].filter((t) => t && !have.has(t.toLowerCase()))
    if (!texts.length) return 0
    const start = this.db.select().from(prepItem).where(eq(prepItem.prepId, prepId)).all().reduce((n, x) => Math.max(n, x.sort), 0) + 1
    this.log.run(`Brought ${texts.length} loose thread${texts.length === 1 ? '' : 's'} from session ${last.number}`, (w) => {
      texts.forEach((body, k) => w.insert('prep_item', {
        id: randomUUID(), prepId, kind: 'thread', sort: start + k, title: '', body, sceneType: null, targetStart: null, targetEnd: null,
        entityId: null, locationId: null, discoveryId: null, role: '', stats: '', tactics: '', done: false, doneAtMin: null, status: 'active'
      }))
    })
    return texts.length
  }

  /** World bible line › Make a card (owner: right away, no AI): a card named from the line, the line as its bio. One undo step. */
  cardFromPrepLine(itemId: string, type: EntityType): string {
    const i = this.prepItemRow(itemId)
    if (i.kind === 'npc') {
      // A prep NPC's own card: its name, description and motivation, tied from now on.
      const name = i.title.trim()
      if (!name) throw new Error('Give the NPC a name first')
      let id = ''
      this.log.run(`Made an NPC card for ${name}`, (w) => {
        id = this.insertEntity(w, { boardId: this.globalBoard().id, type, name, position: this.freeGlobalSpot(), attributes: { summary: i.description, motivation: i.role, ...(i.body ? { quirk: i.body } : {}) } })
        w.update('prep_item', itemId, { entityId: id })
      })
      return id
    }
    const text = (i.body || i.title).trim()
    if (!text) throw new Error('Write the line first')
    const name = text.split(/ [—–-] |[:.;,(]/)[0].replace(/^(the|a|an) /i, (m) => m).trim().slice(0, 60) || text.slice(0, 60)
    let id = ''
    this.log.run(`Made a card ${name} from the world bible`, (w) => {
      id = this.insertEntity(w, { boardId: this.globalBoard().id, type, name, position: this.freeGlobalSpot(), attributes: { bio: text } })
      w.update('prep_item', itemId, { entityId: id })
    })
    return id
  }

  /** Save as notes file: "Session N - Title" in Notes (a new version of the same file on later saves). */
  savePrepNote(prepId: string, title: string, bytes: Buffer): string {
    const p = this.prepRow(prepId)
    const doc = p.noteDocId ? this.db.select().from(noteDoc).where(eq(noteDoc.id, p.noteDocId)).get() : undefined
    if (doc?.status === 'active') {
      this.saveNoteVersion(doc.id, bytes, 'Saved the prep sheet to')
      if (doc.title !== title) this.renameNoteDoc(doc.id, title)
      return doc.id
    }
    const rel = this.storeNoteFile({ bytes, ext: '.docx' })
    const id = randomUUID()
    const now = new Date().toISOString()
    this.log.run(`Saved the prep sheet as the note ${title}`, (w) => {
      w.insert('note_doc', { id, title, kind: 'word', file: rel, originalName: `${title}.docx`, versions: [], folder: '', status: 'active', createdAt: now, updatedAt: now })
      w.update('session_prep', prepId, { noteDocId: id })
    })
    return id
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

  // ---- buildings ----------------------------------------------------------------

  /** A patron or keeper becomes an NPC or PC card tied to the building with a string; one undo step. */
  buildingPatronCard(buildingId: string, patronId: string, type: 'NPC' | 'PC'): string {
    const b = this.entityRow(buildingId)
    const data = readBuilding(b.attributes)
    const p = data.patrons.find((x) => x.id === patronId)
    if (!p) throw new Error('That patron is no longer in the building')
    if (p.entityId && this.db.select().from(entity).where(eq(entity.id, p.entityId)).get()?.status !== undefined && this.entityRow(p.entityId).status !== 'defunct') throw new Error(`${p.name} already has a card`)
    const secrets = data.secrets.filter((x) => x.patronId === p.id).sort((a, c) => a.score - c.score).map((x) => `${x.score}: ${x.text}`)
    let id = ''
    this.log.run(`Made a card for ${p.name}`, (w) => {
      id = this.insertEntity(w, {
        boardId: this.globalBoard().id, type, name: p.name, position: this.freeGlobalSpot(),
        attributes: {
          summary: p.role, location: b.name, ...(type === 'NPC' ? { occupation: p.role, appearance: p.desc } : { appearance: p.desc }),
          ...(p.knows ? { notes: `Knows: ${p.knows}` } : {}), ...(secrets.length ? { secret: secrets.join('\n') } : {})
        }
      })
      w.insert('relationship', { id: randomUUID(), sourceId: id, targetId: buildingId, type: 'LOCATED_AT', isSecret: false, status: 'active' })
      w.update('entity', buildingId, { attributes: { ...b.attributes, ...buildingAttrs({ patrons: data.patrons.map((x) => (x.id === p.id ? { ...x, entityId: id } : x)) }) } })
    })
    return id
  }

  private campaignSecrets(): BSecret[] {
    const v = this.setting('campaign_secrets')
    return readBuilding({ secrets: v }).secrets
  }

  /** "All campaign secrets": the campaign's own list, Clue cards, and every other building's secrets. */
  secretPool(buildingId: string): { own: BSecret[]; clueCards: Array<{ id: string; name: string; text: string }>; elsewhere: Array<{ buildingId: string; buildingName: string; secret: BSecret }> } {
    const live = this.db.select().from(entity).all().filter((e) => e.status === 'active' || e.status === 'resolved')
    return {
      own: this.campaignSecrets(),
      clueCards: live.filter((e) => e.type === 'CLUE').map((e) => ({
        id: e.id, name: e.name, text: [e.attributes.summary, e.attributes.description].find((x) => typeof x === 'string' && x.trim()) as string ?? ''
      })).sort((a, c) => a.name.localeCompare(c.name)),
      elsewhere: live.filter((e) => e.type === 'BUILDING' && e.id !== buildingId)
        .flatMap((e) => readBuilding(e.attributes).secrets.map((secret) => ({ buildingId: e.id, buildingName: e.name, secret })))
    }
  }

  /**
   * Moves a secret between "In this building" and "All campaign secrets" (the campaign's own
   * list or another building), one undo step. Its patron is dropped when it leaves a building.
   */
  moveSecret(input: { secretId: string; from: string | null; to: string | null }): void {
    if (input.from === input.to) return
    const read = (id: string | null) => (id ? readBuilding(this.entityRow(id).attributes).secrets : this.campaignSecrets())
    const fromList = read(input.from)
    const sec = fromList.find((x) => x.id === input.secretId)
    if (!sec) throw new Error('That secret has moved or is in History')
    const moved: BSecret = { ...sec, patronId: undefined }
    const toName = input.to ? this.entityRow(input.to).name : 'All campaign secrets'
    this.log.run(`Moved a ${sec.kind} to ${toName}`, (w) => {
      const write = (id: string | null, list: BSecret[]) => {
        if (!id) {
          if (w.get('campaign_settings', 'campaign_secrets')) w.update('campaign_settings', 'campaign_secrets', { value: list })
          else w.insert('campaign_settings', { key: 'campaign_secrets', value: list })
        } else {
          const row = this.entityRow(id)
          w.update('entity', id, { attributes: { ...row.attributes, ...buildingAttrs({ secrets: list }) } })
        }
      }
      write(input.from, fromList.filter((x) => x.id !== sec.id))
      write(input.to, [...read(input.to).filter((x) => x.id !== sec.id), moved])
    })
  }

  /** Adds or edits secrets on the campaign's own list (All campaign secrets). */
  setCampaignSecrets(list: BSecret[], label: string): void {
    this.setSetting('campaign_secrets', list.map((x) => ({ ...x, id: x.id || newId() })), label)
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
    if (!row) throw new Error(`No link with id ${id}`)
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

function toRelationshipView(r: RelationshipRow, secrets?: Map<string, { kind: string; text: string }>): RelationshipView {
  const s = r.secretId ? secrets?.get(r.secretId) : undefined
  return {
    secretId: s ? r.secretId : null, secretKind: (s?.kind as SecretKind | undefined) ?? null,
    id: r.id, sourceId: r.sourceId, targetId: r.targetId, type: r.type, isSecret: r.isSecret,
    status: r.status as RowStatus, hidden: r.hidden, boardId: r.boardId, description: s ? s.text : r.description
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
    scaleLen: r.scaleLen, scaleUnit: (LENGTH_UNITS as string[]).includes(r.scaleUnit ?? '') ? r.scaleUnit as LengthUnit : null,
    scaleKey: r.scaleKey, scaleKeyX: r.scaleKeyX, scaleKeyY: r.scaleKeyY,
    kind: r.kind === 'battle' ? 'battle' : 'world',
    gridCols: r.gridCols,
    gridRows: r.gridCols && r.width && r.height ? rowsFor(r.gridCols, r.width, r.height) : null,
    gridShown: !!r.gridShown,
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

export type ForgetKind = keyof typeof FORGET_TABLE
const FORGET_TABLE = {
  entity: 'entity', secret: 'secret', string: 'relationship', note: 'board_item', storyline: 'storyline', act: 'act',
  outcome: 'act_outcome', trigger: 'story_trigger', map: 'map', region: 'region_shape', style: 'style_example',
  prep: 'session_prep', prepItem: 'prep_item'
} as const satisfies Record<string, TableName>
