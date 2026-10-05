import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

const DAY = 1440
let dir: string
let c: Campaign

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Timeline test'), 'Timeline test')
  c.setClock(0)
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

function twoStorylines() {
  const a = c.createStoryline('Main quest').storylineId!
  const b = c.createStoryline('Side storyline').storylineId!
  c.updateStoryline(a, { status: 'player_active' })
  c.updateStoryline(b, { status: 'autonomous' })
  const a1 = c.createAct({ storylineId: a, title: 'The bell', startMin: 0, endMin: DAY })
  const b1 = c.createAct({ storylineId: b, title: 'The heist', startMin: 0, endMin: 2 * DAY })
  const b2 = c.createAct({ storylineId: b, title: 'The escape', startMin: 2 * DAY, endMin: 3 * DAY })
  return { a, b, a1, b1, b2 }
}

describe('timeline', () => {
  it('creates acts with a default outcome, numbered within their storyline', () => {
    const { a1, b2 } = twoStorylines()
    const t = c.timeline()
    expect(t.acts.find((x) => x.id === a1)).toMatchObject({ number: 1, state: 'running' })
    expect(t.acts.find((x) => x.id === b2)).toMatchObject({ number: 2, state: 'upcoming' })
    expect(t.acts.find((x) => x.id === a1)?.outcomes).toMatchObject([{ label: 'If nobody intervenes', isDefault: true }])
  })

  it('lets an autonomous storyline resolve by default but waits on the players’ storyline', () => {
    const { a1, b1 } = twoStorylines()
    c.setClock(2 * DAY)
    const t = c.timeline()
    expect(t.acts.find((x) => x.id === b1)).toMatchObject({ state: 'resolved', resolvedBy: 'default' })
    expect(t.acts.find((x) => x.id === a1)).toMatchObject({ state: 'awaiting', outcomeId: null })
  })

  it('records the DM’s outcome and fires a trigger that moves another storyline', () => {
    const { b, a1, b2 } = twoStorylines()
    const win = c.addOutcome(a1, 'Players ring the bell')
    c.addTrigger({ sourceActId: a1, outcomeId: win, targetStorylineId: b, effect: { type: 'shift_act', actId: b2, minutes: DAY } })
    c.chooseOutcome(a1, win)
    c.setClock(DAY)
    const t = c.timeline()
    expect(t.acts.find((x) => x.id === a1)).toMatchObject({ outcomeId: win, resolvedBy: 'dm' })
    expect(t.acts.find((x) => x.id === b2)).toMatchObject({ startMin: 3 * DAY, plannedStartMin: 2 * DAY, shiftedBy: DAY })
    expect(t.triggers).toMatchObject([{ label: 'T1', firedAtMin: DAY }])
  })

  it('previews a what-if in plain words without saving anything', () => {
    const { b, a1, b2 } = twoStorylines()
    const win = c.addOutcome(a1, 'Players ring the bell')
    c.addTrigger({ sourceActId: a1, outcomeId: win, targetStorylineId: b, effect: { type: 'shift_act', actId: b2, minutes: DAY } })
    const before = c.history().log.length
    const w = c.whatIf(a1, win)
    expect(w.lines).toEqual(expect.arrayContaining([
      expect.stringContaining('Main quest · Act 1 (The bell): ends "Players ring the bell"'),
      'Side storyline · Act 2 (The escape): starts Day 4 · 00:00 instead of Day 3 · 00:00'
    ]))
    expect(c.history().log.length).toBe(before)
  })

  it('keeps one default outcome per act', () => {
    const { a1 } = twoStorylines()
    const o = c.addOutcome(a1, 'Bell cracks')
    c.updateOutcome(o, { isDefault: true })
    const outs = c.timeline().acts.find((x) => x.id === a1)!.outcomes
    expect(outs.filter((x) => x.isDefault).map((x) => x.label)).toEqual(['Bell cracks'])
  })

  it('edits, removes and restores acts, outcomes and triggers through History with undo', () => {
    const { b, a1, b2 } = twoStorylines()
    c.updateAct(a1, { title: 'The drowned bell', summary: 'Someone rings it at midnight', endMin: 2 * DAY })
    expect(c.timeline().acts.find((x) => x.id === a1)).toMatchObject({ title: 'The drowned bell', plannedEndMin: 2 * DAY })
    const o = c.addOutcome(a1, 'Bell cracks')
    const t = c.addTrigger({ sourceActId: a1, outcomeId: o, targetStorylineId: b, effect: { type: 'set_status', status: 'concluded' } })
    c.chooseOutcome(a1, o)
    c.setOutcomeStatus(o, 'defunct') // also clears the chosen outcome
    c.setTriggerStatus(t, 'defunct')
    c.setActStatus(b2, 'defunct')
    const h = c.history()
    expect(h.removedOutcomes).toMatchObject([{ label: 'Bell cracks', actTitle: 'The drowned bell' }])
    expect(h.removedTriggers).toMatchObject([{ label: 'T1' }])
    expect(h.removedActs).toMatchObject([{ title: 'The escape', storylineTitle: 'Side storyline' }])
    expect(c.timeline().acts.find((x) => x.id === a1)?.chosenOutcomeId).toBeNull()
    c.setActStatus(b2, 'active')
    expect(c.timeline().acts.some((x) => x.id === b2)).toBe(true)
    c.undo(); c.undo(); c.undo(); c.undo()
    expect(c.timeline().acts.find((x) => x.id === a1)?.chosenOutcomeId).toBe(o)
  })

  it('refuses acts that end before they start', () => {
    const { a } = twoStorylines()
    expect(() => c.createAct({ storylineId: a, title: 'Bad', startMin: 100, endMin: 100 })).toThrow(/end after/)
  })

  it('leaves out storylines in History', () => {
    const { b } = twoStorylines()
    c.setStorylineRemoved(b, true)
    const t = c.timeline()
    expect(t.storylines.map((s) => s.title)).toEqual(['Main quest'])
    expect(t.acts.every((x) => x.storylineId !== b)).toBe(true)
  })
})
