import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { ability, boardItem, entity, logEntry, relationship, session, prepItem, encounterCreature, type EntityRow } from '../db/schema'
import { type Writer } from './commandLog'
import type { AbilityKind, EntityStatus, EntityType } from '../../shared/schemas'
import { readStatBlock, StatBlock, statLine } from '../../shared/statblock'
import type { EntityBrief, EncountersView, EncounterView, EncounterCreatureView } from '../../shared/types'
import { CR_STEPS, crStep, scaleToCr } from '../../shared/crscale'
import { readStory, type EncounterStory } from '../../shared/encounterStory'
import { readFollow, type FollowSource } from '../../shared/battlemap'
import { isBiome } from '../../shared/places'
import { adaptation, rateEncounter, xpForCr, type FightFeedback } from '../../shared/encounter'
import { readSketch, type Sketch } from '../../shared/sketch'
import { part } from './part'
import { ASSETS_DIR, SrdCopy, MAP_EXTENSIONS, storedExt, NewAbility, isEncounter } from './common'

export const encountersPart = part({
  // ---- encounter planner (an encounter is a SCENE card with attributes.encounter = true)

  /** Encounter cards, including ones made by "Suggest an encounter" before the planner. */
  encounterCards(): EntityRow[] {
    return this.db.select().from(entity).where(eq(entity.type, 'SCENE')).all()
      .filter((e) => e.status === 'active' || e.status === 'resolved' || e.status === 'stashed')
      .filter(isEncounter)
  },

  /** Fight feedback from play, oldest first, for the adaptive budgets. */
  fightFeedback(): FightFeedback[] {
    return this.db.select().from(logEntry).where(and(eq(logEntry.status, 'active'), eq(logEntry.kind, 'fight'))).all()
      .filter((l) => l.feedback)
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
      .map((l) => l.feedback as FightFeedback)
  },

  partySize(): number {
    return Math.max(1, this.partyHealth().length || 4)
  },

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
  },

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
    const onBoard = this.db.select().from(boardItem).where(and(eq(boardItem.entityId, id), eq(boardItem.kind, 'card'), eq(boardItem.status, 'active'))).all().length > 0
    return {
      id, name: e.name, onBoard, locationId: at?.targetId ?? null, locationName: at ? byId.get(at.targetId)?.name ?? null : null,
      target, tactics: typeof a.tactics === 'string' ? a.tactics : '', notes: typeof a.summary === 'string' ? a.summary : '',
      scene: typeof a.scene === 'string' ? a.scene : '',
      battleMapId: typeof a.battle_map_id === 'string' ? a.battle_map_id : null,
      sketch: readSketch(a.sketch),
      follow: readFollow(a.follow),
      story: readStory(a.story),
      creatures, pcs, difficulty: rateEncounter(creatures, pcs.length ? (levels.length ? levels : [p.level]) : p.level, p.size, p.factor), runs
    }
  },

  createEncounter(input: { name: string; locationId?: string | null }): string {
    let id = ''
    this.log.run(`Planned encounter ${input.name}`, (w) => {
      id = this.insertEntity(w, {
        boardId: this.globalBoard().id, type: 'SCENE', name: input.name, position: this.freeGlobalSpot(), place: false,
        attributes: { encounter: true, target: 'moderate', tactics: '', summary: '' }
      })
      if (input.locationId) w.insert('relationship', { id: randomUUID(), sourceId: id, targetId: input.locationId, type: 'LOCATED_AT', isSecret: false, status: 'active' })
    })
    return id
  },

  /** Encounters stay off the board until the DM puts one there (owner, 2026-10-18): its card, for links. */
  encounterToBoard(id: string): void {
    const e = this.entityRow(id)
    const global = this.globalBoard().id
    this.log.run(`Put ${e.name} on the board`, (w) => {
      const old = this.cardItems(global, id, true)[0]
      if (old) w.update('board_item', old.id, { status: 'active' })
      else this.placeCard(w, global, id, this.freeGlobalSpot())
    })
  },

  /** Prep › Likely scenes › Add an encounter: a new encounter (off the board) and its scene line, one undo step. */
  /** A likely scene that is an encounter: a new one, or one that already exists (`encounterId`). */
  addPrepEncounter(prepId: string, encounterId?: string): string {
    const p = this.prepRow(prepId)
    const siblings = this.db.select().from(prepItem).where(and(eq(prepItem.prepId, prepId), eq(prepItem.kind, 'scene'))).all()
    const id = randomUUID()
    const existing = encounterId ? this.entityRow(encounterId) : null
    this.log.run(`Added ${existing ? existing.name : 'an encounter'} to the prep for session ${p.number}`, (w) => {
      const enc = existing ? existing.id : this.insertEntity(w, {
        boardId: this.globalBoard().id, type: 'SCENE', name: 'New encounter', position: this.freeGlobalSpot(), place: false,
        attributes: { encounter: true, target: 'moderate', tactics: '', summary: '' }
      })
      w.insert('prep_item', {
        id, prepId, kind: 'scene', sort: siblings.reduce((n, x) => Math.max(n, x.sort), 0) + 1, title: '', body: '',
        sceneType: 'combat', targetStart: null, targetEnd: null, entityId: enc, locationId: null,
        discoveryId: null, role: '', stats: '', tactics: '', done: false, doneAtMin: null, status: 'active'
      })
    })
    return id
  },

  /** An encounter row on the prep picks another encounter. The one it leaves goes to History if it was never filled in
   *  (the blank "New encounter" from Add a scene) and nothing else uses it. One undo step. */
  setPrepEncounter(itemId: string, encounterId: string): void {
    const item = this.db.select().from(prepItem).where(eq(prepItem.id, itemId)).get()
    if (!item) throw new Error('That prep line is gone.')
    const next = this.entityRow(encounterId)
    const old = item.entityId ? this.db.select().from(entity).where(eq(entity.id, item.entityId)).get() : undefined
    const blank = old && old.id !== next.id && old.name === 'New encounter' && !old.attributes.scene && !old.attributes.summary
      && this.encounterView(old.id).creatures.length === 0
      && this.db.select().from(prepItem).where(and(eq(prepItem.entityId, old.id), eq(prepItem.status, 'active'))).all().length === 1
    this.log.run(`Picked ${next.name} for a likely scene`, (w) => {
      w.update('prep_item', itemId, { entityId: next.id })
      if (blank) w.update('entity', old.id, { status: 'defunct' })
    })
  },

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
  },

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
  },

  /** The DM's own folder for an encounter's pictures (null: back to the campaign's). One undo step. */
  setEncounterFolder(id: string, folder: string | null): void {
    const e = this.entityRow(id)
    this.log.run(folder ? `${e.name} uses the folder ${folder}` : `${e.name} uses a folder in the campaign`, (w) => {
      w.update('entity', id, { attributes: { ...e.attributes, folder } })
    })
  },

  /** Copies the pictures, maps and PDFs in a folder elsewhere into the encounter's folder. */
  copyFolderIntoEncounter(id: string, dir: string): number {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && [...MAP_EXTENSIONS, '.pdf'].includes(extname(f.name).toLowerCase()))
      .map((f) => join(dir, f.name))
    return files.length ? this.addEncounterPictures(id, files) : 0
  },

  /**
   * An encounter that used a folder outside the campaign (before 1.5.x): back to a folder in the
   * campaign, with copies of that folder's files (the originals stay where they are).
   */
  bringEncounterFolderIn(id: string): number {
    const outside = this.encounterPictures(id)
    this.setEncounterFolder(id, null)
    return outside.own && existsSync(outside.folder) ? this.copyFolderIntoEncounter(id, outside.folder) : 0
  },

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
  },

  /** One file in an encounter's folder, by name; null when there is none. */
  encounterFile(id: string, name: string): string | null {
    if (!name || /[\\/]|^\.\.?$/.test(name) || name.includes(':')) return null
    const file = join(this.encounterFolder(id), name)
    return existsSync(file) ? file : null
  },

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
  },

  /** Moves a file into the folder's Removed subfolder (nothing is deleted; move it back in Windows). */
  removeEncounterPicture(id: string, name: string): void {
    const file = this.encounterFile(id, name)
    if (!file) throw new Error('That file is not in the folder any more')
    const bin = join(this.encounterFolder(id), 'Removed')
    mkdirSync(bin, { recursive: true })
    let to = join(bin, name)
    for (let n = 2; existsSync(to); n++) to = join(bin, `${basename(name, extname(name))} ${n}${extname(name)}`)
    renameSync(file, to)
  },

  /** An old encounter (counts on the cards) gets its own rows the first time it is edited. */
  adoptLegacyCreatures(w: Writer, encounterId: string): void {
    const rows = this.db.select().from(encounterCreature).where(eq(encounterCreature.encounterId, encounterId)).all()
    if (rows.length) return
    this.encounterView(encounterId).creatures.forEach((c, i) => {
      w.insert('encounter_creature', { id: randomUUID(), encounterId, entityId: c.entityId, count: c.count, notes: '', sort: i + 1, status: 'active' })
    })
  },

  addEncounterCreature(encounterId: string, entityId: string, count = 1): void {
    const e = this.entityRow(encounterId)
    const c = this.entityRow(entityId)
    this.log.run(`Added ${count} × ${c.name} to ${e.name}`, (w) => { this.putCreature(w, encounterId, entityId, count); this.syncFight(w, encounterId) })
  },

  putCreature(w: Writer, encounterId: string, entityId: string, count: number): void {
    this.adoptLegacyCreatures(w, encounterId)
    const rows = this.db.select().from(encounterCreature).where(and(eq(encounterCreature.encounterId, encounterId), eq(encounterCreature.status, 'active'))).all()
    const same = rows.find((r) => r.entityId === entityId)
    if (same) w.update('encounter_creature', same.id, { count: same.count + count })
    else w.insert('encounter_creature', {
      id: randomUUID(), encounterId, entityId, count, notes: '', sort: rows.reduce((n, r) => Math.max(n, r.sort), 0) + 1, status: 'active'
    })
  },

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
  },

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
  },

  /** Where the party is now, if they are placed on a map. */
  partyPlace(): { id: string; name: string } | null {
    try {
      const p = this.liveWhere().place
      return p ? { id: p.locationId, name: p.name } : null
    } catch { return null }
  },

  /** A Location card's name and its land for themed rolls: its biome, or settlement / dungeon / water by kind. */
  placeLands(locationId: string): { name: string; lands: string[] } {
    const e = this.entityRow(locationId)
    const kind = e.attributes.place_kind
    const lands = [
      ...(isBiome(e.attributes.biome) ? [e.attributes.biome] : []),
      ...(kind === 'village' || kind === 'town' || kind === 'city' ? ['settlement'] : kind === 'dungeon' ? ['dungeon'] : kind === 'sea' ? ['water'] : [])
    ]
    return { name: e.name, lands }
  },

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
  },

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
  },

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
        boardId: this.globalBoard().id, type: 'SCENE', name: d.name, position: this.freeGlobalSpot(), status, place: false,
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
  },

})
