import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

let dir = ''
afterEach(() => rmSync(dir, { recursive: true, force: true }))

it('orders History by the most recent removal', () => {
  dir = mkdtempSync(join(tmpdir(), 'dz-hist-'))
  const c = Campaign.create(join(dir, 'Hist'), 'Hist')
  const g = c.info().globalBoardId
  const a = c.createEntity({ boardId: g, type: 'NPC', name: 'Ada', position: { x: 0, y: 0 } })
  const b = c.createEntity({ boardId: g, type: 'NPC', name: 'Bob', position: { x: 0, y: 0 } })
  c.setEntityStatus(b.id, 'defunct')
  c.setEntityStatus(a.id, 'defunct')
  const { removedOrder } = c.history()
  expect(removedOrder[a.id]).toBeGreaterThan(removedOrder[b.id])
  c.close()
})
