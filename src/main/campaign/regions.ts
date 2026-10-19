import { type LengthUnit } from '../../shared/units'
import { randomUUID } from 'node:crypto'
import { and, asc, eq } from 'drizzle-orm'
import { entity, partyPosition, regionShape, relationship, session, type RegionRow } from '../db/schema'
import { type Writer } from './commandLog'
import type { EntityStatus, EntityType,   RowStatus } from '../../shared/schemas'
import { formatClock } from '../../shared/time'
import type { MapScreenView, PartyMarker, RegionDetail, RegionView } from '../../shared/types'
import type { SceneContext } from '../ai/scene'
import { moonOn, skyAt } from '../../shared/sky'
import { type Point } from '../../shared/geometry'
import { isBiome, isPlaceKind } from '../../shared/places'
import { occupantsOf } from '../../shared/building'
import { part } from './part'
import { NewRegion, isEncounter, toMapView } from './common'

export const regionsPart = part({
  // ---- map regions, party token and travel ------------------------------------

  regionRows(mapId: string): RegionRow[] {
    return this.db.select().from(regionShape).where(and(eq(regionShape.mapId, mapId), eq(regionShape.status, 'active'))).all()
  },

  regionViews(mapId: string): RegionView[] {
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
  },

  /** The party's position on a map at minute `atMin` (the latest move at or before it). */
  partyAt(mapId: string, atMin: number): PartyMarker | null {
    const row = this.db.select().from(partyPosition).where(and(eq(partyPosition.mapId, mapId), eq(partyPosition.status, 'active'))).all()
      .filter((p) => p.atMin <= atMin && !p.entityId)
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt)).at(-1)
    if (!row) return null
    const name = row.locationId ? this.db.select({ name: entity.name }).from(entity).where(eq(entity.id, row.locationId)).get()?.name ?? null : null
    return { x: row.x, y: row.y, locationId: row.locationId, locationName: name, atMin: row.atMin }
  },

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
  },

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
  },

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
  },

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
  },

  /**
   * Adds many regions at once (a generated world, or regions an AI found), each with a new
   * Location card; `parent` is the index of an earlier region it lies inside. One undo step.
   */
  addRegions(mapId: string, regions: NewRegion[], label: string): string[] {
    this.mapRow(mapId)
    const ids: string[] = []
    this.log.run(label, (w) => { ids.push(...this.insertRegions(w, mapId, regions)) })
    return ids
  },

  insertRegions(w: Writer, mapId: string, regions: NewRegion[]): string[] {
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
  },

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
  },

  setRegionStatus(id: string, status: RowStatus): void {
    const r = this.db.select().from(regionShape).where(eq(regionShape.id, id)).get()
    if (!r) throw new Error(`No region with id ${id}`)
    this.log.run(status === 'defunct' ? `Moved region ${this.nameOf(r.locationId)} to History` : `Restored region ${this.nameOf(r.locationId)}`,
      (w) => { w.update('region_shape', id, { status }) })
  },

  /** The map's scale; `bar` = the scale bar it was set with (length and unit, shown again on Change…). */
  setMapScale(mapId: string, widthKm: number | null, travelKmh?: number, bar?: { len: number; unit: LengthUnit }): void {
    const m = this.mapRow(mapId)
    this.log.run(`Set the scale of ${m.name}`, (w) => {
      w.update('map', mapId, { widthKm, ...(travelKmh != null && { travelKmh }), ...(bar && { scaleLen: bar.len, scaleUnit: bar.unit }) })
    })
  },

  /** The scale key on the map: shown or not, and where (image pixels). */
  setMapScaleKey(mapId: string, patch: { shown?: boolean; x?: number; y?: number }): void {
    const m = this.mapRow(mapId)
    const label = patch.shown === undefined ? `Moved the scale key on ${m.name}` : `${patch.shown ? 'Showed' : 'Hid'} the scale key on ${m.name}`
    this.log.run(label, (w) => {
      w.update('map', mapId, { ...(patch.shown !== undefined && { scaleKey: patch.shown }), ...(patch.x !== undefined && { scaleKeyX: patch.x }), ...(patch.y !== undefined && { scaleKeyY: patch.y }) })
    })
  },

  /** Grid lines drawn over the map, or not. */
  setMapGridShown(mapId: string, shown: boolean): void {
    const m = this.mapRow(mapId)
    this.log.run(`${shown ? 'Showed' : 'Hid'} the grid on ${m.name}`, (w) => { w.update('map', mapId, { gridShown: shown }) })
  },

  /** A square grid over the map (squares across), or none. */
  setMapGrid(mapId: string, cols: number | null): void {
    const m = this.mapRow(mapId)
    this.log.run(cols ? `Set a ${cols}-square grid on ${m.name}` : `Removed the grid from ${m.name}`, (w) => { w.update('map', mapId, { gridCols: cols }) })
  },

})
