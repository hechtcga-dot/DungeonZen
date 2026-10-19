import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'

// Large-campaign timings (1,000 cards, 1,500 links): `npm run speed`. Skipped in `npm test` (seeding takes seconds).
// 2026-10-19: board 1,534 ms -> 53 ms after hoisting the secret lookup and grouping storylines per card.
import { Campaign } from '../src/main/campaign/campaign'

it.skipIf(!process.env.DZ_SPEED)('times the main views of a large campaign', () => {
  const c = Campaign.create(join(mkdtempSync(join(tmpdir(), 'dzb-')), 'B'), 'B')
  const boardId = c.info().globalBoardId
  const types = ['NPC', 'LOCATION', 'ITEM', 'FACTION', 'MONSTER'] as const
  const ids: string[] = []
  let t = Date.now()
  c.log.many('seed', () => {
    for (let i = 0; i < 1000; i++) ids.push(c.createEntity({ boardId, type: types[i % 5], name: `Card number ${i}`, position: { x: (i % 40) * 300, y: Math.floor(i / 40) * 200 }, attributes: { summary: 'x'.repeat(200) } }).id)
    for (let i = 0; i < 1500; i++) c.createRelationship({ sourceId: ids[i % 1000], targetId: ids[(i * 7 + 3) % 1000], type: 'knows', isSecret: i % 3 === 0 })
  })
  console.log('seed ms', Date.now() - t)
  const time = (name: string, fn: () => unknown) => { const t0 = performance.now(); for (let k = 0; k < 5; k++) fn(); console.log(name, ((performance.now() - t0) / 5).toFixed(1), 'ms') }
  time('board:view', () => c.boardView(boardId))
  time('campaign:info', () => c.info())
  time('links:view', () => c.wordLinks())
  time('desk', () => c.desk())
  time('prep:screen', () => c.prepScreen())
  time('encounters', () => c.encountersView())
  time('timeline', () => c.timeline())
  time('history', () => c.history())
  time('sheet', () => c.sheet(ids[5]))
  time('live', () => c.live())
  time('notes', () => c.notesScreen())
  time('updateEntity', () => c.updateEntity(ids[1], { name: 'X' + Math.random() }))
}, 120000)
