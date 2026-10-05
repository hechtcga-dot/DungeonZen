import { describe, expect, it } from 'vitest'
import { formatClock, fromClockParts, toClockParts } from '../src/shared/time'

describe('campaign clock', () => {
  it('formats minutes from campaign start as day and time', () => {
    expect(formatClock(0)).toBe('Day 1 · 00:00')
    expect(formatClock(540)).toBe('Day 1 · 09:00')
    expect(formatClock(24 * 60 + 75)).toBe('Day 2 · 01:15')
  })

  it('round-trips through day, hour and minute', () => {
    for (const m of [0, 59, 60, 1439, 1440, 98765]) expect(fromClockParts(toClockParts(m))).toBe(m)
  })

  it('rejects negative or fractional minutes', () => {
    expect(() => toClockParts(-1)).toThrow(RangeError)
    expect(() => toClockParts(1.5)).toThrow(RangeError)
  })
})
