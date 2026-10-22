import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { classesOf, usesOf } from '../../shared/charsheet'
import { entity, knowledge, logEntry, partyPosition, regionShape, relationship, relationshipKnown, session, type LogRow,   type SessionRow } from '../db/schema'
import { type Writer } from './commandLog'
import type { EntityAttributes, EntityStatus, EntityType, LogKind,   RowStatus } from '../../shared/schemas'
import { MINUTES_PER_DAY } from '../../shared/time'
import { formatClock } from '../../shared/time'
import { ABILITY_KEYS, leadingNumber, passiveScore, readStatBlock, saveBonus, skillBonus, SKILLS, statLine } from '../../shared/statblock'
import type { LiveView, LogView, PartyMarker, WhereView,   SessionView } from '../../shared/types'
import { advise } from '../advisor'
import { centroid } from '../../shared/geometry'
import { RATING_LABELS } from '../../shared/encounter'
import { part } from './part'
import { GeneratedPerson, NewAbility, toSessionView, toLogView } from './common'

export const livePart = part({
  // ---- live session ----------------------------------------------------------

  openSession(): SessionRow | null {
    return this.db.select().from(session).where(eq(session.status, 'active')).all().find((x) => x.endedAt === null) ?? null
  },

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
  },

  partyHealth() {
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
          level: classesOf(e.attributes).reduce((n, c) => n + c.level, 0),
          pp: sb ? passiveScore(sb, 'Perception') : null,
          saves: sb ? ABILITY_KEYS.map((k) => { const b = saveBonus(sb, k); return { name: k.toUpperCase(), bonus: b.bonus, prof: b.proficient } }) : [],
          skills: sb ? SKILLS.map(([name, k]) => { const b = skillBonus(sb, name, k); return { name, bonus: b.bonus, prof: b.proficient } }) : []
        }
      })
  },

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
  },

  endSession(id: string): void {
    const sRow = this.sessionRow(id)
    this.log.run(`Ended session ${sRow.number}`, (w) => {
      w.update('session', id, { endedAt: new Date().toISOString(), endMin: this.info().clockMin })
    })
  },

  updateSession(id: string, patch: { number?: number; sceneText?: string; recap?: string; playerRecap?: string }): void {
    const sRow = this.sessionRow(id)
    this.log.run(`Edited session ${patch.number ?? sRow.number}`, (w) => { w.update('session', id, patch) })
  },

  setSessionStatus(id: string, status: RowStatus): void {
    const sRow = this.sessionRow(id)
    this.log.run(status === 'defunct' ? `Moved session ${sRow.number} to History` : `Restored session ${sRow.number}`, (w) => {
      w.update('session', id, { status })
    })
  },

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
  },

  updateLog(id: string, patch: { text?: string; kind?: LogKind; atMin?: number; entityId?: string | null }): void {
    this.logRow(id)
    this.log.run('Edited a log entry', (w) => { w.update('log_entry', id, patch) })
  },

  setLogStatus(id: string, status: RowStatus): void {
    this.logRow(id)
    this.log.run(status === 'defunct' ? 'Removed a log entry' : 'Restored a log entry', (w) => { w.update('log_entry', id, { status }) })
  },

  /** Sets a player character's current hit points (0 up to the maximum; temporary hit points are their own box). */
  setHp(entityId: string, hp: number): void {
    const e = this.entityRow(entityId)
    const max = leadingNumber(readStatBlock(e.attributes.statblock)?.hp ?? '')
    const value = Math.max(0, Math.min(max || Infinity, Math.round(hp)))
    this.log.run(`${e.name}: ${value} HP`, (w) => {
      w.update('entity', entityId, { attributes: { ...e.attributes, current_hp: value } })
    })
  },

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
      // Limited uses and Pact Magic slots come back (short-rest ones on any rest); a long rest also restores
      // hit points, spell slots (slots made from Sorcery Points vanish) and hit dice, clears death saves and
      // takes off one level of exhaustion (2024 rules).
      for (const p of this.partyHealth()) {
        const a = this.entityRow(p.id).attributes
        const uses = usesOf(a).map((u) => (kind === 'long' || u.reset === 'short' ? { ...u, used: 0 } : u))
        const exhaustion = typeof a.exhaustion === 'number' ? a.exhaustion : 0
        w.update('entity', p.id, {
          attributes: kind === 'short' ? { ...a, uses, pact_used: null }
            : { ...a, uses, pact_used: null, current_hp: p.maxHp, slots_used: null, slots_bonus: null, hit_dice_used: 0, death_saves: null, exhaustion: Math.max(0, exhaustion - 1) }
        })
      }
      if (kind === 'long') {
        if (w.get('campaign_settings', 'last_long_rest_min')) w.update('campaign_settings', 'last_long_rest_min', { value: now + minutes })
        else w.insert('campaign_settings', { key: 'last_long_rest_min', value: now + minutes })
      }
    })
  },

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
        // A tavern building where the party is, so it and its people show under Who is here (long playtest, 2026-10-22).
        const at = stash ? null : this.partyPlace()
        const place = this.insertEntity(w, {
          boardId: g, type: 'BUILDING', name: t.name, position: this.freeGlobalSpot(), status,
          attributes: { summary: t.summary, description: `Tonight: ${t.dish}. Rumour: ${t.rumour}`, building_kind: 'tavern', generated: true, ...(at ? { location: at.name } : {}) }
        })
        if (at) w.insert('relationship', { id: randomUUID(), sourceId: place, targetId: at.id, type: 'LOCATED_AT', isSecret: false, status: 'active' })
        ids.push(place)
        for (const c of [t.keeper, ...t.patrons]) {
          const id = person(w, c, { location: t.name })
          w.insert('relationship', { id: randomUUID(), sourceId: id, targetId: place, type: 'LOCATED_AT', isSecret: false, status: 'active' })
        }
      } else {
        const e = payload as { summary: string; groups: Array<{ key: string; name: string; count: number }> }
        const scene = this.insertEntity(w, {
          boardId: g, type: 'ENCOUNTER', name: `Encounter: ${e.groups.map((x) => x.name).join(' and ')}`, position: this.freeGlobalSpot(),
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
  },

  sessionRow(id: string): SessionRow {
    const row = this.db.select().from(session).where(eq(session.id, id)).get()
    if (!row) throw new Error(`No session with id ${id}`)
    return row
  },

  logRow(id: string): LogRow {
    const row = this.db.select().from(logEntry).where(eq(logEntry.id, id)).get()
    if (!row) throw new Error(`No log entry with id ${id}`)
    return row
  },

  // ---- live: where the party is

  /** The party's latest position on any map, with the map it is on. */
  partyNow(): (PartyMarker & { mapId: string }) | null {
    const nowMin = this.info().clockMin
    return this.maps().map((m) => { const p = this.partyAt(m.id, nowMin); return p ? { ...p, mapId: m.id } : null })
      .filter((p): p is PartyMarker & { mapId: string } => !!p)
      .sort((a, b) => a.atMin - b.atMin).at(-1) ?? null
  },

  /** People the party has met: a logged meeting, or their name is known. */
  metIds(): Set<string> {
    const met = new Set(this.db.select().from(logEntry).where(and(eq(logEntry.status, 'active'), eq(logEntry.kind, 'meeting'))).all()
      .map((l) => l.entityId).filter((x): x is string => !!x))
    for (const k of this.db.select().from(knowledge).where(eq(knowledge.status, 'active')).all()) if (k.field === 'name') met.add(k.entityId)
    return met
  },

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
        .map((e) => {
          const a = this.entityRow(e.id).attributes
          const sb = readStatBlock(a.statblock)
          const stat = sb && (sb.hp || sb.ac || sb.cr) ? statLine(sb) : ''
          return { id: e.id, name: e.name, type: e.type, met: met.has(e.id), keyNpc: keyNpcs.has(e.id), notes: typeof a.notes === 'string' ? a.notes.trim() : '', stat }
        })
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
  },

  /** Adds a paragraph to the DM notes journal (one undo step). */
  appendDmNotes(text: string): void {
    const open = this.openSession()
    const cur = open ? open.dmNotes : this.setting('dm_notes')
    const before = typeof cur === 'string' ? cur.trimEnd() : ''
    this.setDmNotes(before ? `${before}\n\n${text.trim()}` : text.trim(), 'Added to the DM notes')
  },

  /** The desk journal: the running session's notes, else the notes between sessions. */
  setDmNotes(text: string, label = 'Edited DM notes'): void {
    const open = this.openSession()
    if (open) this.log.run(`${label} (session ${open.number})`, (w) => { w.update('session', open.id, { dmNotes: text }) })
    else this.setSetting('dm_notes', text, label)
  },

})
