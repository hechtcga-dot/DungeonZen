import { describe, expect, it } from 'vitest'
import { advise } from '../src/main/advisor'

const base = { nowMin: 10 * 60, fightsToday: 0, healthPercent: 100, lastLongRestMin: null, sessionStartMin: 0, acts: [] }

describe('advisor', () => {
  it('stays quiet when nothing needs saying', () => {
    expect(advise(base)).toEqual([])
  })
  it('warns after many fights at low health', () => {
    expect(advise({ ...base, fightsToday: 3, healthPercent: 66 })[0]).toEqual({
      level: 'warn', text: 'The party has had 3 fights today and is at 66% health. They may not survive another without a rest.'
    })
  })
  it('warns when night is coming', () => {
    expect(advise({ ...base, nowMin: 14 * 60 }).map((n) => n.text)).toContain('Night falls in about 4 h.')
  })
  it('notices long days without a long rest and acts that need the DM', () => {
    const notes = advise({ ...base, nowMin: 30 * 60, acts: [{ title: 'Act 1 · The bell', endMin: 0, awaiting: true }, { title: 'Act 2', endMin: 33 * 60, awaiting: false }] })
    expect(notes.map((n) => n.text)).toEqual(expect.arrayContaining([
      'No long rest for 30 hours.', 'Act 1 · The bell has ended and needs your outcome.', 'Act 2 ends in about 3 h.'
    ]))
  })
})
