import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { noteDoc, secret, entity, partyPosition, regionShape,
  relationship, session, travelLink, sessionPrep, prepItem, type PrepRow, type PrepItemRow, type EntityRow } from '../db/schema'
import type { EntityStatus, EntityType,   RowStatus } from '../../shared/schemas'
import { type PrepKind, type SceneType } from '../../shared/schemas'
import { readStatBlock, statLine } from '../../shared/statblock'
import type { PcToken,   EntityBrief, PrepScreenView, PrepView, WordLinksView, PrepItemView, TravelEstimateView } from '../../shared/types'
import { estimateTravel, regionAt, type Point } from '../../shared/geometry'
import { part } from './part'
import { DEFAULT_LINK_RULES, type LinkRules } from '../../shared/noteLinks'
import { PREP_LABELS, PrepItemPatch } from './common'

export const prepPart = part({
  // ---- session prep (the DM's one-page prep sheet per session)

  /** The session that is running, if any, and the number the next session will get. */
  sessionNumbers(): { openNumber: number | null; nextNumber: number } {
    const all = this.db.select().from(session).all()
    const open = all.find((x) => x.status === 'active' && x.endedAt === null)
    return { openNumber: open?.number ?? null, nextNumber: all.reduce((n, x) => Math.max(n, x.number), 0) + 1 }
  },

  /** Places a card can be at: Location and Building cards, marked when a map region shows them. */
  placeOptions(): Array<{ id: string; name: string; type: 'LOCATION' | 'BUILDING'; fromMap: boolean }> {
    const onMap = new Set(this.db.select().from(regionShape).where(eq(regionShape.status, 'active')).all().map((r) => r.locationId))
    return this.db.select().from(entity).all()
      .filter((e) => (e.type === 'LOCATION' || e.type === 'BUILDING') && e.status !== 'defunct')
      .map((e) => ({ id: e.id, name: e.name, type: e.type as 'LOCATION' | 'BUILDING', fromMap: onMap.has(e.id) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  /** Every card still in play, with what a linked word shows of it. */
  cardBriefs(): PrepScreenView['cards'] {
    return this.db.select().from(entity).all().filter((e) => e.status === 'active' || e.status === 'resolved' || e.status === 'stashed')
      .sort((a, b) => a.name.localeCompare(b.name)).map((e) => {
        const a = e.attributes as Record<string, unknown>
        const t = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
        return { id: e.id, type: e.type as EntityType, name: e.name, status: e.status as EntityStatus, summary: t('summary'), picture: t('picture'), location: t('location'), notes: t('notes'), flaws: t('flaws'), ...(a.encounter === true ? { encounter: true } : {}), ...(typeof a.colour === 'string' ? { colour: a.colour } : {}), ...(typeof a.link_name === 'boolean' ? { linkName: a.link_name } : {}) }
      })
  },

  /** Text boxes everywhere: card names link by themselves; the DM's own links and the names switched off (setting word_links). */
  wordLinks(): WordLinksView {
    const v = this.setting('word_links') as { own?: WordLinksView['own']; off?: string[] } | undefined
    const r = this.setting('link_rules') as Partial<LinkRules> | undefined
    const rules: LinkRules = {
      never: Array.isArray(r?.never) ? r.never.map(String) : DEFAULT_LINK_RULES.never,
      minLength: typeof r?.minLength === 'number' ? r.minLength : DEFAULT_LINK_RULES.minLength,
      capitalOnly: typeof r?.capitalOnly === 'boolean' ? r.capitalOnly : DEFAULT_LINK_RULES.capitalOnly
    }
    return { cards: this.cardBriefs(), own: Array.isArray(v?.own) ? v.own : [], off: Array.isArray(v?.off) ? v.off : [], rules }
  },

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
  },

  /** The prep sheet for a session number (by default the running session, else the next one). */
  prepFor(number?: number): PrepView | null {
    const n = number ?? (() => { const s = this.sessionNumbers(); return s.openNumber ?? s.nextNumber })()
    const row = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, n), eq(sessionPrep.status, 'active'))).get()
    return row ? this.prepView(row.id) : null
  },

  prepView(id: string): PrepView {
    const p = this.prepRow(id)
    const names = new Map(this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name]))
    const encounters = new Set(this.encounterCards().map((e) => e.id))
    const encounterOf = (i: PrepItemRow): PrepItemView['encounter'] => {
      if (i.kind !== 'scene' || !i.entityId || !encounters.has(i.entityId)) return undefined
      const v = this.encounterView(i.entityId)
      return { name: v.name, locationId: v.locationId, target: v.target, scene: v.scene, creatures: v.creatures.reduce((n, c) => n + c.count, 0) }
    }
    const items = this.db.select().from(prepItem).where(and(eq(prepItem.prepId, id), eq(prepItem.status, 'active'))).all()
      .sort((a, b) => a.sort - b.sort)
      .map((i) => ({ i, enc: encounterOf(i) })).map(({ i, enc }): PrepItemView => ({
        // A scene that is an encounter shows the encounter's name and notes everywhere the scene shows.
        id: i.id, kind: i.kind as PrepKind, title: enc?.name ?? i.title, body: enc?.scene ?? i.body, sceneType: (i.sceneType as SceneType | null) ?? null,
        targetStart: i.targetStart, targetEnd: i.targetEnd,
        entityId: i.entityId, entityName: i.entityId ? names.get(i.entityId) ?? null : null,
        locationId: i.locationId, locationName: i.locationId ? names.get(i.locationId) ?? null : null,
        discoveryId: i.discoveryId, relationshipId: i.relationshipId, secretId: i.secretId, description: i.description, role: i.role, stats: i.stats, tactics: i.tactics, done: i.done, doneAtMin: i.doneAtMin,
        encounter: enc
      }))
    const sess = this.db.select().from(session).where(and(eq(session.number, p.number), eq(session.status, 'active'))).get()
    const doc = p.noteDocId ? this.db.select().from(noteDoc).where(eq(noteDoc.id, p.noteDocId)).get() : undefined
    return {
      id: p.id, number: p.number, title: p.title, premise: p.premise, pacingMinutes: p.pacingMinutes, backupNames: p.backupNames, notes: p.notes,
      wantNext: p.wantNext, session: sess ? { id: sess.id, recap: sess.recap } : null, noteDocId: doc?.status === 'active' ? doc.id : null, items,
      links: p.links, playDate: p.playDate ?? null
    }
  },

  createPrep(number: number): string {
    const existing = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, number), eq(sessionPrep.status, 'active'))).get()
    if (existing) return existing.id
    const id = randomUUID()
    this.log.run(`Started the prep sheet for session ${number}`, (w) => {
      w.insert('session_prep', { id, number, title: '', premise: '', pacingMinutes: 180, backupNames: '', notes: '', wantNext: '', noteDocId: null, status: 'active' })
    })
    return id
  },

  /** A session's real-life date (Notes › session notes): on its prep sheet, which is started if it has none. One undo step. */
  setSessionDate(number: number, date: string | null): void {
    const p = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, number), eq(sessionPrep.status, 'active'))).get()
    this.log.run(`Set the date of session ${number}`, (w) => {
      if (p) w.update('session_prep', p.id, { playDate: date })
      else w.insert('session_prep', { id: randomUUID(), number, title: '', premise: '', pacingMinutes: 180, backupNames: '', notes: '', wantNext: '', noteDocId: null, playDate: date, status: 'active' })
    })
  },

  updatePrep(id: string, patch: Partial<Pick<PrepRow, 'number' | 'title' | 'premise' | 'pacingMinutes' | 'backupNames' | 'notes' | 'wantNext' | 'links' | 'playDate'>>): void {
    const p = this.prepRow(id)
    if (patch.number !== undefined && patch.number !== p.number) {
      const taken = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, patch.number), eq(sessionPrep.status, 'active'))).get()
      if (taken) throw new Error(`Session ${patch.number} already has a prep sheet`)
    }
    this.log.run(`Edited the prep sheet for session ${p.number}`, (w) => { w.update('session_prep', id, patch) })
  },

  setPrepStatus(id: string, status: RowStatus): void {
    const p = this.prepRow(id)
    if (status === 'active') {
      const taken = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, p.number), eq(sessionPrep.status, 'active'))).get()
      if (taken && taken.id !== id) throw new Error(`Session ${p.number} already has a prep sheet; change its number first`)
    }
    this.log.run(status === 'defunct' ? `Moved the prep sheet for session ${p.number} to History` : `Restored the prep sheet for session ${p.number}`, (w) => {
      w.update('session_prep', id, { status })
    })
  },

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
  },

  /** What a linked card fills in: an NPC's role and look, a monster's stat line. The DM can change it all. */
  prepFromCard(kind: PrepKind, e: EntityRow): PrepItemPatch {
    const a = e.attributes as Record<string, unknown>
    const text = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '')
    // NPCs: what they want, and one cue for how to play them (the one-page DM tool).
    if (kind === 'npc') return { title: e.name, role: text('motivation') || text('goal'), description: text('summary'), body: text('quirk') || text('mannerism') || text('appearance') }
    if (kind === 'threat') {
      const sb = readStatBlock(a.statblock)
      return { stats: sb ? statLine(sb) : '', tactics: text('tactics') }
    }
    return {}
  },

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
  },

  /** Ticks a discovery as revealed, a scene as played or a clue as found, at the campaign time. */
  setPrepDone(id: string, done: boolean): void {
    const i = this.prepItemRow(id)
    const what = i.kind === 'discovery' ? (done ? 'Revealed' : 'Unrevealed') : i.kind === 'scene' ? (done ? 'Played' : 'Unplayed')
      : i.kind === 'thread' ? (done ? 'Followed up' : 'Reopened') : done ? 'Found' : 'Unfound'
    this.log.run(`${what} ${i.title || PREP_LABELS[i.kind as PrepKind]}`, (w) => {
      w.update('prep_item', id, { done, doneAtMin: done ? this.info().clockMin : null })
    })
  },

  setPrepItemStatus(id: string, status: RowStatus): void {
    const i = this.prepItemRow(id)
    this.log.run(`${status === 'defunct' ? 'Removed' : 'Restored'} ${PREP_LABELS[i.kind as PrepKind]} ${i.title}`.trim(), (w) => {
      w.update('prep_item', id, { status })
    })
  },

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
  },

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
  },

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
  },

  /** Save as notes file: "Session N · Title · date" in Notes › Sessions (a new version of the same file on later saves). */
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
      w.insert('note_doc', { id, title, kind: 'word', file: rel, originalName: `${title}.docx`, versions: [], folder: 'Sessions', status: 'active', createdAt: now, updatedAt: now })
      w.update('session_prep', prepId, { noteDocId: id })
    })
    return id
  },

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
  },

  prepRow(id: string): PrepRow {
    const r = this.db.select().from(sessionPrep).where(eq(sessionPrep.id, id)).get()
    if (!r) throw new Error(`No prep sheet with id ${id}`)
    return r
  },

  prepItemRow(id: string): PrepItemRow {
    const r = this.db.select().from(prepItem).where(eq(prepItem.id, id)).get()
    if (!r) throw new Error(`No prep line with id ${id}`)
    return r
  },

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
    // Measured from where the party token stands to where it was dropped (on the travel grid).
    const est = estimateTravel({ from, to, imageWidth: m.width, widthKm: m.widthKm, kmh: m.travelKmh, savedMinutes: saved?.minutes ?? null, units: this.info().units })
    return { ...est, fromName: party?.locationName ?? null, toName: dest?.name ?? null, toLocationId: dest?.locationId ?? null }
  },

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
  },

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
  },

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
  },

  undo(): string | null { return this.log.undo() },
  redo(): string | null { return this.log.redo() },

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
  },

})
