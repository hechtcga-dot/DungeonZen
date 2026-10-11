import { describe, expect, it } from 'vitest'
import { guessHeadings, headingLevel, headingsOf } from '../src/shared/noteDoc'

describe('find headings', () => {
  it('spots lines typed as headings, not sentences', () => {
    expect(headingLevel('Chapter 3: The Haunter of the Pits')).toBe('h1')
    expect(headingLevel('1. Session Opening')).toBe('h2')
    expect(headingLevel('2.1 The Docks')).toBe('h3')
    expect(headingLevel('SECRETS & CLUES')).toBe('h2')
    expect(headingLevel('Session 4 recap')).toBe('h2')
    expect(headingLevel('From What Hell Have You Crawled?', true)).toBe('h2')
    expect(headingLevel('The harbormaster was paid to keep quiet.')).toBeNull()
    expect(headingLevel('a quiet street')).toBeNull()
    expect(headingLevel('')).toBeNull()
  })

  it('looks at paragraphs and bold numbered lines, and lists existing headings', () => {
    const blocks = [
      { kind: 'h1' as const, runs: [{ text: 'Hour of the Dragon' }] },
      { kind: 'p' as const, runs: [{ text: 'O Sleeper, Awake!', b: true }] },
      { kind: 'p' as const, runs: [{ text: 'Conan rides north. ' }, { text: 'Fast', b: true }] },
      { kind: 'number' as const, runs: [{ text: 'Buy rope' }] },
      { kind: 'number' as const, runs: [{ text: 'Likely Scenes', b: true }] }
    ]
    expect(guessHeadings(blocks)).toEqual([{ index: 1, level: 'h2', text: 'O Sleeper, Awake!' }, { index: 4, level: 'h2', text: 'Likely Scenes' }])
    expect(headingsOf(blocks)).toEqual([{ level: 'h1', text: 'Hour of the Dragon' }])
  })
})
