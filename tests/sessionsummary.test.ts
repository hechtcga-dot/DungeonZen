import { describe, expect, it } from 'vitest'
import { summaryText, type SessionFacts } from '../src/shared/sessionSummary'

const none: SessionFacts = { number: 1, start: null, places: [], npcs: [], clues: [], scenes: [], fights: [], events: [], notes: '' }

describe('session summary, plain', () => {
  it('reads like the owner\'s example from the facts', () => {
    const text = summaryText({
      ...none,
      start: { name: 'Frostholm', about: 'A cold and unforgiving snowy climate.' },
      npcs: [{ name: 'Brannoc', about: 'A hard and lonely dwarf' }],
      clues: ['The iron key opens the mill'],
      fights: [{ name: 'Pixie swarm', place: 'the Old Mill' }],
      notes: 'Mira died to the pixies and was revived by the priest.'
    })
    expect(text).toBe('The party continues their adventures in Frostholm, a cold and unforgiving snowy climate. They met Brannoc, a hard and lonely dwarf. '
      + 'They learned the iron key opens the mill. They fought Pixie swarm at the Old Mill.\n\nMira died to the pixies and was revived by the priest.')
  })
  it('is empty when nothing happened, and joins lists', () => {
    expect(summaryText(none)).toBe('')
    expect(summaryText({ ...none, places: [{ name: 'A', about: '' }, { name: 'B', about: '' }, { name: 'C', about: '' }] })).toBe('They travelled to A, B and C.')
  })
})
