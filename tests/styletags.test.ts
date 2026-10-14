import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPOSITION, advancedFromTags, advancedLines, blendTags, parseStyleTags, styleLines } from '../src/shared/styleTags'

describe('style tags', () => {
  it('blends the ticked pictures per field, without repeats', () => {
    expect(blendTags([
      { artist: 'Arthur Rackham', medium: 'pen and ink; watercolour wash' },
      { artist: 'John Bauer', medium: 'Watercolour wash', palette: 'olive green' },
      {}
    ])).toEqual({ artist: 'Arthur Rackham; John Bauer', medium: 'pen and ink; watercolour wash', palette: 'olive green' })
  })

  it('writes style, medium and composition lines, with a fallback when nothing describes the style', () => {
    expect(styleLines({ artist: 'Arthur Rackham', period: '1900s', medium: 'pen and ink' }, 'muted', { composition: DEFAULT_COMPOSITION })).toEqual([
      'Style: in the manner of Arthur Rackham, 1900s.', 'Medium: pen and ink.', 'Art style: muted', `Composition: ${DEFAULT_COMPOSITION}.`
    ])
    expect(styleLines({ composition: 'low horizon' }, '', { composition: DEFAULT_COMPOSITION, fallback: 'Style: classic.' }))
      .toEqual(['Style: classic.', 'Composition: low horizon.'])
    expect(styleLines({ composition: 'low horizon' }, '', { composition: null })).toEqual([])
  })

  it('reads the AI reply, keeping only known fields', () => {
    expect(parseStyleTags('Sure: {"artist": "Arthur Rackham", "palette": ["sepia", "olive"], "junk": "x", "light": ""}'))
      .toEqual({ artist: 'Arthur Rackham', palette: 'sepia, olive' })
    expect(() => parseStyleTags('no json')).toThrow()
  })
})

describe('Advanced composition', () => {
  it('fills the boxes from the tags and writes the lines, other details after the composition', () => {
    const a = advancedFromTags({ artist: 'Alan Lee', period: '1930s', medium: 'watercolour' }, 'pyramid', '')
    expect(a).toMatchObject({ style: 'in the manner of Alan Lee, 1930s', medium: 'watercolour', composition: 'pyramid', other: '' })
    expect(advancedLines({ ...a, other: 'a tower in the centre.' }, '')).toEqual([
      'Style: in the manner of Alan Lee, 1930s.', 'Medium: watercolour.', 'Composition: pyramid. a tower in the centre.'
    ])
    expect(advancedFromTags({}, 'centre', '').style).toBe('classic fantasy book illustration')
  })
})
