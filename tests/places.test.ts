import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

let dir: string
let c: Campaign
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dungeonzen-')); c = Campaign.create(join(dir, 'P'), 'P') })
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

it('lists Location and Building cards as places, and counts writes for other windows', () => {
  const g = c.info().globalBoardId
  const before = c.log.writes
  c.createEntity({ boardId: g, type: 'LOCATION', name: 'Mill', position: { x: 0, y: 0 } })
  c.createEntity({ boardId: g, type: 'BUILDING', name: 'Anchor Inn', position: { x: 0, y: 0 } })
  c.createEntity({ boardId: g, type: 'NPC', name: 'Bryn', position: { x: 0, y: 0 } })
  expect(c.placeOptions().map((p) => [p.name, p.type, p.fromMap])).toEqual([['Anchor Inn', 'BUILDING', false], ['Mill', 'LOCATION', false]])
  expect(c.log.writes).toBeGreaterThan(before)
  const n = c.log.writes
  c.placeOptions()
  expect(c.log.writes).toBe(n)
})
