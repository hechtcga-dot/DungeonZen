import { describe, expect, it } from 'vitest'
import { blendMarks, changePrompt, outlineBlank, outlineText, readOutline, whereOnFrame } from '../src/shared/outline'

describe('drawing outlines', () => {
  it('reads stored outlines; broken ones count as none', () => {
    expect(readOutline(undefined)).toEqual({ strokes: [], labels: [], picture: null, use: 'sketch', writeLabels: false })
    expect(readOutline({ strokes: 'nope' }).strokes).toEqual([])
    const o = readOutline({ strokes: [{ c: '#111111', p: [0, 0, 500, 500] }], labels: [{ x: 100, y: 500, t: 'river' }] })
    expect(outlineBlank(o)).toBe(false)
    expect(outlineBlank({ ...o, use: 'picture' })).toBe(true) // picture chosen but none uploaded
  })

  it('labels go as words with where they are, not written on the picture unless ticked', () => {
    expect(whereOnFrame(100, 500)).toBe('middle left, 10% across and 50% down')
    expect(whereOnFrame(500, 500)).toMatch(/^centre,/)
    const o = readOutline({ labels: [{ x: 100, y: 500, t: 'river' }, { x: 800, y: 100, t: 'hills' }] })
    const text = outlineText(o)
    expect(text).toMatch(/do not copy its lines, colours or style/)
    expect(text).toMatch(/"river" \(middle left.*"hills" \(top right/)
    expect(text).toMatch(/do not write them or any other words/)
    expect(outlineText({ ...o, writeLabels: true })).toMatch(/Write these labels on the picture/)
  })

  it('change words: the change, what each mark colour means, keep the rest', () => {
    const plain = changePrompt('remove the mountains, replace them with a forest.', null)
    expect(plain).toMatch(/^Change the first attached picture: remove the mountains, replace them with a forest\.\n/)
    expect(plain).not.toMatch(/marks/)
    const marked = changePrompt('more trees', [{ colour: '#d62828', label: 'remove these' }, { colour: '#15803d', label: '' }])
    expect(marked).toMatch(/second attached picture/)
    expect(marked).toMatch(/The red marks: remove these\./)
    expect(marked).not.toMatch(/green/)
    expect(marked).toMatch(/Do not draw the marks/)
  })

  it('lays marks over the picture (premultiplied alpha)', () => {
    const base = new Uint8Array([10, 20, 30, 255, 10, 20, 30, 255])
    const marks = new Uint8Array([0, 0, 0, 0, 200, 0, 0, 255])
    expect([...blendMarks(base, marks)]).toEqual([10, 20, 30, 255, 200, 0, 0, 255])
    const half = new Uint8Array([100, 0, 0, 128, 0, 0, 0, 0]) // red at half strength, premultiplied
    expect(blendMarks(base, half)[0]).toBe(105)
  })
})
