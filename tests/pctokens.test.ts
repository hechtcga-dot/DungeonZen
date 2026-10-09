import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { encodePng } from '../src/main/png'

let dir: string
let c: Campaign
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dz-pc-')); c = Campaign.create(join(dir, 'Camp'), 'PCs') })
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

it('splits a player character from the party, moves them without the clock, and merges them back', () => {
  writeFileSync(join(dir, 'm.png'), encodePng(100, 100, new Uint8Array(100 * 100 * 3)))
  const m = c.importMap(join(dir, 'm.png'), 'Town')
  const g = c.info().globalBoardId
  const loc = c.createEntity({ boardId: g, type: 'LOCATION', name: 'Market', position: { x: 0, y: 0 } })
  c.createRegion({ mapId: m.id, locationId: loc.id, polygon: [[600, 600], [900, 600], [900, 900], [600, 900]] })
  const pc = c.createEntity({ boardId: g, type: 'PC', name: 'Mira Vale', position: { x: 0, y: 0 } })
  c.moveParty({ mapId: m.id, x: 100, y: 100, minutes: 0 })
  expect(c.mapScreen(m.id).pcs).toEqual([{ entityId: pc.id, name: 'Mira Vale', split: null }])
  c.movePc({ entityId: pc.id, mapId: m.id })
  expect(c.mapScreen(m.id).pcs[0].split).toMatchObject({ x: 140, y: 140 })
  const clock = c.info().clockMin
  c.movePc({ entityId: pc.id, mapId: m.id, x: 700, y: 700 })
  expect(c.info().clockMin).toBe(clock) // the clock follows the party only
  const region = c.mapScreen(m.id).regions[0]
  expect(c.regionDetail(region.id).hereNow.map((e) => e.name)).toEqual(['Mira Vale'])
  // The party moves on; Mira stays.
  c.moveParty({ mapId: m.id, x: 300, y: 300, minutes: 60 })
  expect(c.mapScreen(m.id).pcs[0].split).toMatchObject({ x: 700, y: 700, locationName: 'Market' })
  c.movePc({ entityId: pc.id, mapId: m.id, joined: true })
  expect(c.mapScreen(m.id).pcs[0].split).toBeNull()
  expect(c.mapScreen(m.id).party).toMatchObject({ x: 300, y: 300 })
  c.undo()
  expect(c.mapScreen(m.id).pcs[0].split).not.toBeNull()
})
