import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import type { Point } from '../src/shared/geometry'

let dir: string
let c: Campaign
let mapId: string
let g: string
const sq = (x: number, y: number, s: number): Point[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Map test'), 'Map test')
  g = c.info().globalBoardId
  const png = Buffer.alloc(24); png.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); png.writeUInt32BE(1000, 16); png.writeUInt32BE(800, 20)
  writeFileSync(join(dir, 'city.png'), png)
  mapId = c.importMap(join(dir, 'city.png')).id
  c.setClock(9 * 60)
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('map regions and the party token', () => {
  it('draws regions with new or existing locations, and sub-regions', () => {
    const a = c.createRegion({ mapId, polygon: sq(0, 0, 400), newName: 'District A' })
    const existing = c.createEntity({ boardId: g, type: 'LOCATION', name: 'District C', position: { x: 0, y: 0 } })
    expect(c.mapScreen(mapId).unplacedLocations.map((l) => l.name)).toEqual(['District C'])
    c.createRegion({ mapId, polygon: sq(600, 0, 400), locationId: existing.id })
    const aLoc = c.mapScreen(mapId).regions.find((r) => r.id === a)!.locationId
    c.createRegion({ mapId, polygon: sq(50, 50, 100), newName: 'Old Market', parentLocationId: aLoc })
    const v = c.mapScreen(mapId)
    expect(v.regions.map((r) => r.name).sort()).toEqual(['District A', 'District C', 'Old Market'])
    expect(v.unplacedLocations).toEqual([])
    expect(c.regionDetail(a).subRegions.map((s) => s.name)).toEqual(['Old Market'])
    c.undo()
    expect(c.mapScreen(mapId).regions).toHaveLength(2)
  })

  it('lists who is here: linked by string or by their location field', () => {
    const r = c.createRegion({ mapId, polygon: sq(600, 0, 400), newName: 'District C' })
    const loc = c.mapScreen(mapId).regions[0].locationId
    const ciaf = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: { x: 0, y: 0 } })
    c.updateEntity(ciaf.id, { attributes: { location: 'district c' } })
    const ghoul = c.createEntity({ boardId: g, type: 'MONSTER', name: 'Ghoul', position: { x: 0, y: 0 } })
    c.createRelationship({ sourceId: ghoul.id, targetId: loc, type: 'LOCATED_AT', isSecret: false })
    const q = c.createEntity({ boardId: g, type: 'QUEST', name: 'Find the bell', position: { x: 0, y: 0 } })
    c.createRelationship({ sourceId: q.id, targetId: loc, type: 'TIED_TO_QUEST', isSecret: false })
    const d = c.regionDetail(r)
    expect(d.hereNow.map((e) => e.name).sort()).toEqual(['Ciaf Crol', 'Ghoul'])
    expect(d.plotPoints.map((e) => e.name)).toEqual(['Find the bell'])
  })

  it('estimates travel from the scale, moves the party with the clock, logs it, and remembers a route time', () => {
    c.createRegion({ mapId, polygon: sq(0, 0, 200), newName: 'District A' })
    c.createRegion({ mapId, polygon: sq(600, 0, 200), newName: 'District C' })
    expect(c.travelEstimate(mapId, [100, 100]).basis).toMatch(/first time/)
    c.moveParty({ mapId, x: 100, y: 100, minutes: 0 })
    expect(c.travelEstimate(mapId, [700, 100]).minutes).toBeNull() // no scale yet
    c.setMapScale(mapId, 10, 3) // 1000 px = 10 km; centres 600 px apart = 6 km = 2 h
    const est = c.travelEstimate(mapId, [650, 150])
    expect(est).toMatchObject({ minutes: 120, km: 6, fromName: 'District A', toName: 'District C' })
    c.startSession()
    c.moveParty({ mapId, x: 650, y: 150, minutes: 180, rememberTime: true })
    const v = c.mapScreen(mapId)
    expect(v.party).toMatchObject({ locationName: 'District C', atMin: 12 * 60 })
    expect(c.info().clockMin).toBe(12 * 60)
    expect(v.route).toEqual([[100, 100], [650, 150]])
    expect(c.live().log[0]).toMatchObject({ kind: 'travel', text: 'Travelled from District A to District C', minutesTaken: 180 })
    expect(c.mapScreen(mapId).sessionRunning).toBe(true)
    // The way back uses the remembered time too, until a time is saved for that direction.
    expect(c.travelEstimate(mapId, [100, 100]).minutes).toBe(180)
    c.moveParty({ mapId, x: 100, y: 100, minutes: 120 })
    expect(c.travelEstimate(mapId, [700, 100]).minutes).toBe(180)
    c.undo(); c.undo()
    expect(c.mapScreen(mapId).party?.locationName).toBe('District A')
    expect(c.info().clockMin).toBe(9 * 60)
  })

  it('puts regions in History and back', () => {
    const r = c.createRegion({ mapId, polygon: sq(0, 0, 200), newName: 'Docks' })
    c.setRegionStatus(r, 'defunct')
    expect(c.mapScreen(mapId).regions).toEqual([])
    expect(c.history().removedRegions).toEqual([{ id: r, name: 'Docks' }])
    c.setRegionStatus(r, 'active')
    expect(c.mapScreen(mapId).regions).toHaveLength(1)
  })
})
