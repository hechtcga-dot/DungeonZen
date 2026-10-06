import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

const DAY = 1440
let dir: string
let c: Campaign
let g: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Review test'), 'Review test')
  g = c.info().globalBoardId
  c.setClock(9 * 60)
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const main = c.createStoryline('Main quest').storylineId!
  const side = c.createStoryline('Side storyline').storylineId!
  c.updateStoryline(main, { status: 'player_active' })
  c.updateStoryline(side, { status: 'autonomous' })
  const m1 = c.createAct({ storylineId: main, title: 'The bell', startMin: 0, endMin: 12 * 60 })
  const win = c.addOutcome(m1, 'Silenced')
  const s1 = c.createAct({ storylineId: side, title: 'The fire', startMin: 0, endMin: 11 * 60 })
  const s2 = c.createAct({ storylineId: side, title: 'The flight', startMin: DAY, endMin: 2 * DAY })
  const sDefault = c.timeline().acts.find((a) => a.id === s1)!.outcomes[0].id
  c.addTrigger({ sourceActId: s1, outcomeId: sDefault, targetStorylineId: side, effect: { type: 'shift_act', actId: s2, minutes: 120 } })
  const ciaf = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: { x: 0, y: 0 } }).id
  const gone = c.createEntity({ boardId: g, type: 'NPC', name: 'Old Tom', position: { x: 0, y: 0 } }).id
  const s = c.startSession()
  c.addLog({ kind: 'meeting', text: '', entityId: ciaf })
  c.addLog({ kind: 'meeting', text: 'Asked about the bell', entityId: gone })
  c.addLog({ kind: 'fight', text: 'Ambush', minutesTaken: 4 * 60 })
  c.setEntityStatus(gone, 'defunct')
  return { s, main, m1, win, s1, sDefault, ciaf, gone }
}

describe('session review', () => {
  it('lists conflicts, act outcomes with ripples, knowledge and fights', () => {
    const { s, m1, s1, sDefault } = setup()
    const r = c.review(s.id)
    expect(r.conflicts).toMatchObject([{ text: expect.stringContaining('Old Tom is in History'), quote: 'Asked about the bell' }])
    const acts = r.proposals.filter((p) => p.kind === 'act')
    expect(acts).toEqual(expect.arrayContaining([
      expect.objectContaining({ actId: s1, outcomeId: sDefault, before: 'In progress', ripples: [expect.stringMatching(/^T1: moves .*later by 2 h$/)] }),
      expect.objectContaining({ actId: m1, outcomeId: null, before: 'Waiting', after: 'Choose an outcome' })
    ]))
    expect(r.proposals.filter((p) => p.kind === 'knowledge').map((p) => p.what)).toEqual(['Ciaf Crol · what the party knows'])
    expect(r.fights).toMatchObject([{ text: 'Ambush', feedback: null }])
  })

  it('approves an act outcome and remembers the decision; undo takes both back', () => {
    const { s, m1, win } = setup()
    expect(() => c.decide(s.id, { key: `act:${m1}`, action: 'approve' })).toThrow(/Choose an outcome/)
    c.decide(s.id, { key: `act:${m1}`, action: 'approve', outcomeId: win })
    expect(c.timeline().acts.find((a) => a.id === m1)?.chosenOutcomeId).toBe(win)
    expect(c.review(s.id).proposals.find((p) => p.key === `act:${m1}`)?.decision?.decision).toBe('approved')
    c.undo()
    expect(c.timeline().acts.find((a) => a.id === m1)?.chosenOutcomeId).toBeNull()
    expect(c.review(s.id).proposals.find((p) => p.key === `act:${m1}`)?.decision).toBeNull()
  })

  it('approves knowledge, resolves a conflict, flags and reopens', () => {
    const { s, ciaf, gone } = setup()
    c.decide(s.id, { key: `know:${ciaf}`, action: 'approve', fields: ['name'] })
    expect(c.sheet(ciaf).partyKnows).toMatchObject({ name: true, location: false })
    const key = c.review(s.id).conflicts[0].key
    c.decide(s.id, { key, action: 'flag' })
    expect(c.review(s.id).conflicts[0].decision?.decision).toBe('flagged')
    c.decide(s.id, { key, action: 'reopen' })
    expect(c.review(s.id).conflicts[0].decision).toBeNull()
    c.decide(s.id, { key, action: 'revive' })
    expect(c.entityView(gone).status).toBe('active')
    expect(c.review(s.id).conflicts).toEqual([])
  })

  it('approves everything unflagged in one step, skipping acts that need a choice', () => {
    const { s, s1, m1 } = setup()
    const n = c.approveAllUnflagged(s.id)
    expect(n).toBe(2) // the side act and Ciaf's knowledge
    const r = c.review(s.id)
    expect(r.proposals.find((p) => p.key === `act:${s1}`)?.decision?.decision).toBe('approved')
    expect(r.proposals.find((p) => p.key === `act:${m1}`)?.decision).toBeNull()
    c.undo()
    expect(c.review(s.id).proposals.every((p) => p.decision === null)).toBe(true)
  })

  it('rates fights and drafts a player-safe recap', () => {
    const { s, ciaf } = setup()
    c.setFeedback(c.review(s.id).fights[0].logId, 'hard')
    expect(c.review(s.id).fights[0].feedback).toBe('hard')
    expect(c.draftPlayerRecap(s.id)).toContain('The party met a stranger.')
    c.decide(s.id, { key: `know:${ciaf}`, action: 'approve' })
    expect(c.draftPlayerRecap(s.id)).toContain('The party met Ciaf Crol.')
  })

  it('undoes the whole session and can redo it', () => {
    const { s } = setup()
    const before = c.info().clockMin
    const n = c.undoSession(s.id)
    expect(n).toBeGreaterThanOrEqual(5)
    expect(c.live().sessions).toEqual([])
    expect(c.info().clockMin).toBe(before - 4 * 60)
    c.redo()
    expect(c.live().sessions.map((x) => x.number)).toEqual([1])
  })
})
