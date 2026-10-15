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

it('deletes removed things for good with their parts, and undo brings them back', () => {
  dir = mkdtempSync(join(tmpdir(), 'dz-hist-'))
  const c = Campaign.create(join(dir, 'Hist'), 'Hist')
  const g = c.info().globalBoardId
  const a = c.createEntity({ boardId: g, type: 'NPC', name: 'Ada', position: { x: 0, y: 0 } })
  const b = c.createEntity({ boardId: g, type: 'NPC', name: 'Bob', position: { x: 0, y: 0 } })
  c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'ally', isSecret: false })
  c.setEntityStatus(a.id, 'defunct')
  c.forgetRemoved([{ kind: 'entity', id: a.id }])
  expect(c.history().removedEntities).toHaveLength(0)
  expect(() => c.entityView(a.id)).toThrow()
  c.undo()
  expect(c.history().removedEntities.map((e) => e.name)).toEqual(['Ada'])
  c.close()
})
