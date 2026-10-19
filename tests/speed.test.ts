import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'

// Large-campaign timings (1,000 cards, 1,500 links, 200 notes): `npm run speed`. Skipped in `npm test` (seeding takes seconds).
// 2026-10-19: board 1,534 -> 53 ms (secret lookup once, storylines grouped); a card's mentions in 200 notes 2.6 s -> 0.4 s
// (plain text search instead of a pattern per name; notes that never name the card are skipped).
import { Campaign } from '../src/main/campaign/campaign'
import { noteBlocks } from '../src/main/importers/read'
import { writeDocx } from '../src/main/importers/docx'
import { cardMentions, makeMatcher } from '../src/shared/noteLinks'

it.skipIf(!process.env.DZ_SPEED)('times the main views of a large campaign', async () => {
  const c = Campaign.create(join(mkdtempSync(join(tmpdir(), 'dzb-')), 'B'), 'B')
  const boardId = c.info().globalBoardId
  const types = ['NPC', 'LOCATION', 'ITEM', 'FACTION', 'MONSTER'] as const
  const ids: string[] = []
  let t = Date.now()
  c.log.many('seed', () => {
    for (let i = 0; i < 1000; i++) ids.push(c.createEntity({ boardId, type: types[i % 5], name: `Card number ${i}`, position: { x: (i % 40) * 300, y: Math.floor(i / 40) * 200 }, attributes: { summary: 'x'.repeat(200) } }).id)
    for (let i = 0; i < 1500; i++) c.createRelationship({ sourceId: ids[i % 1000], targetId: ids[(i * 7 + 3) % 1000], type: 'knows', isSecret: i % 3 === 0 })
  })
  // 200 notes of about 2,000 words that name cards (Notes screen and the mentions on a card).
  const words = Array.from({ length: 2000 }, (_, i) => (i % 40 === 0 ? `Card number ${i % 1000}` : 'word')).join(' ')
  const doc = writeDocx(Array.from({ length: 20 }, (_, k) => ({ kind: 'p' as const, runs: [{ text: words.slice(k * 600, k * 600 + 600) }] })))
  for (let i = 0; i < 200; i++) c.createNoteDoc(`Note ${i}`, doc, i % 10 ? '' : 'Folder')
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
  // What notes:mentions does: read every note and find the card (the slowest notes read, on every card sheet).
  const w = c.wordLinks()
  const m = makeMatcher(w.cards, w.own, w.off, [], w.rules)
  const docs = c.notesScreen().docs
  // A card named in every note (worst case) and one named in none (the usual case).
  for (const id of [ids[40], ids[41]]) {
    const t1 = performance.now()
    let found = 0
    const names = m.phrases.filter((p) => p.target === id).map((p) => p.text.toLowerCase())
    for (const d of docs) {
      const blocks = await noteBlocks(c.noteFile(d.id), d.kind)
      if (names.some((n) => JSON.stringify(blocks).toLowerCase().includes(n))) found += cardMentions(blocks, m).filter((x) => x.target === id).length
    }
    console.log('mentions of a card in 200 notes', (performance.now() - t1).toFixed(1), 'ms', found, 'found')
  }
  const t2 = performance.now()
  const all = []
  for (const d of docs) all.push(await noteBlocks(c.noteFile(d.id), d.kind))
  const t3 = performance.now()
  for (const b of all) cardMentions(b, m)
  console.log('  reading 200 notes', (t3 - t2).toFixed(1), 'ms; matching', (performance.now() - t3).toFixed(1), 'ms')
  time('updateEntity', () => c.updateEntity(ids[1], { name: 'X' + Math.random() }))
}, 120000)
