import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { fillTavern, rollCharacter, seededRng, suggestEncounter } from '../src/main/generators'
import { srdCopy, srdMonsterIndex } from '../src/main/srd'
import { emptyStatBlock } from '../src/shared/statblock'

let dir: string
let c: Campaign
let g: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Live test'), 'Live test')
  g = c.info().globalBoardId
  c.setClock(9 * 60)
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

const pc = (name: string, hp: number) => {
  const e = c.createEntity({ boardId: g, type: 'PC', name, position: { x: 0, y: 0 } })
  c.updateEntity(e.id, { attributes: { statblock: { ...emptyStatBlock(), hp: String(hp), ac: '15' } } })
  return e.id
}
const byName = new Map(srdMonsterIndex().map((m) => [m.name, m.key]))
const keyOf = (n: string) => byName.get(n) ?? null

describe('live session', () => {
  it('starts and ends numbered sessions, one at a time', () => {
    const s1 = c.startSession()
    expect(s1.number).toBe(1)
    expect(() => c.startSession()).toThrow(/already running/)
    c.endSession(s1.id)
    expect(c.startSession().number).toBe(2)
    expect(c.live().sessions.map((s) => s.number)).toEqual([1, 2])
  })

  it('logs entries, moves the clock by the time taken, and counts the day', () => {
    expect(() => c.addLog({ kind: 'note', text: 'x' })).toThrow(/Start a session/)
    c.startSession()
    const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: { x: 0, y: 0 } })
    c.addLog({ kind: 'note', text: 'Travelled to District C', minutesTaken: 180 })
    c.addLog({ kind: 'meeting', text: '', entityId: npc.id })
    c.addLog({ kind: 'fight', text: 'Ambush at the bridge', minutesTaken: 10 })
    const v = c.live()
    expect(v.nowMin).toBe(9 * 60 + 190)
    expect(v.today).toEqual({ fights: 1, meetings: 1, quests: 0 })
    expect(v.log.map((l) => l.kind)).toContain('meeting')
    expect(v.log.find((l) => l.kind === 'meeting')?.entityName).toBe('Ciaf Crol')
    c.undo()
    expect(c.live()).toMatchObject({ nowMin: 9 * 60 + 180, today: { fights: 0 } })
  })

  it('edits and removes log entries', () => {
    c.startSession()
    const l = c.addLog({ kind: 'note', text: 'typo' })
    c.updateLog(l.id, { text: 'Fixed', kind: 'quest' })
    expect(c.live().today.quests).toBe(1)
    c.setLogStatus(l.id, 'defunct')
    expect(c.live().log).toEqual([])
  })

  it('tracks party health, rests and advises', () => {
    c.startSession()
    const a = pc('Ilsa', 24)
    pc('Tobin', 16)
    c.setHp(a, 4)
    let v = c.live()
    expect(v.health).toEqual({ hp: 20, maxHp: 40, percent: 50 })
    for (let i = 0; i < 3; i++) c.addLog({ kind: 'fight', text: '' })
    expect(c.live().advisor[0].text).toMatch(/3 fights today and is at 50%/)
    c.rest('long')
    v = c.live()
    expect(v.health.percent).toBe(100)
    expect(v.nowMin).toBe(17 * 60)
    expect(v.lastLongRestMin).toBe(17 * 60)
  })

  it('puts a rolled character on the board as one undo step, with an SRD stat block', () => {
    const ch = rollCharacter(seededRng(4))
    const [id] = c.keepGenerated('character', ch, srdCopy, keyOf, false)
    const e = c.entityView(id)
    expect(e).toMatchObject({ type: 'NPC', name: ch.name, status: 'active', attributes: { summary: ch.summary, generated: true } })
    expect(e.attributes.statblock).toBeTruthy()
    expect(c.history().log[0].label).toBe(`Put on the board: ${ch.name}`)
  })

  it('saves a tavern for later: a location and its people, linked, off the board', () => {
    const t = fillTavern(seededRng(9))
    const ids = c.keepGenerated('tavern', t, srdCopy, keyOf, true)
    expect(ids).toHaveLength(2 + t.patrons.length)
    expect(Object.keys(c.boardView(g).entities)).toEqual([])
    const found = c.search({ query: t.name }).results.map((r) => r.entity.status)
    expect(found).toContain('stashed')
    c.undo()
    expect(c.search({ query: '' }).results).toEqual([])
  })

  it('puts an encounter on the board with its monsters', () => {
    const e = suggestEncounter(seededRng(2), srdMonsterIndex(), 3, 4, 'moderate')!
    const ids = c.keepGenerated('encounter', e, srdCopy, keyOf, false)
    expect(ids).toHaveLength(1 + e.groups.length)
    const v = c.boardView(g)
    expect(Object.values(v.entities).map((x) => x.type).sort()).toEqual(['SCENE', ...e.groups.map(() => 'MONSTER')].sort())
    expect(v.relationships).toHaveLength(e.groups.length)
  })
})
