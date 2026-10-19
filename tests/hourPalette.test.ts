import { describe, expect, it } from 'vitest'
import { hourPalette } from '../src/shared/hourPalette'

describe('hour picture colours (Adventure UI)', () => {
  it('has the four looks at their times', () => {
    expect(hourPalette(9 * 60).s0).toBe('#3f78b5')
    expect(hourPalette(375).s0).toBe('#2f3f6e')
    expect(hourPalette(1110).s3).toBe('#f7b45c')
    expect(hourPalette(2 * 60).stars).toBe(1)
  })
  it('blends between two looks', () => {
    const half = hourPalette(Math.round((375 + 540) / 2))
    expect(half.s0).not.toBe('#2f3f6e')
    expect(half.s0).not.toBe('#3f78b5')
    expect(half.stars).toBeGreaterThan(0)
    expect(half.stars).toBeLessThan(0.25)
  })
  it('wraps past midnight and before day 0', () => {
    expect(hourPalette(1440 + 540)).toEqual(hourPalette(540))
    expect(hourPalette(-900)).toEqual(hourPalette(540))
  })
})
