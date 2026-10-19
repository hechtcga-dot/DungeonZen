import { describe, expect, it } from 'vitest'
import { formatClock, fromClockParts, toClockParts, parseTimeStep, timeStepLabel } from '../src/shared/time'

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

describe('Ctrl+K time steps (3.1)', () => {
  it('reads +2h, +30 min, -1 h, advance 45m, +3 days', () => {
    expect(parseTimeStep('+2h')).toBe(120)
    expect(parseTimeStep('+30 min')).toBe(30)
    expect(parseTimeStep('-1 h')).toBe(-60)
    expect(parseTimeStep('advance 45m')).toBe(45)
    expect(parseTimeStep('+3 days')).toBe(4320)
  })
  it('ignores plain words and numbers', () => {
    expect(parseTimeStep('2h')).toBeNull()
    expect(parseTimeStep('hobbit')).toBeNull()
    expect(parseTimeStep('+')).toBeNull()
  })
  it('names the step', () => {
    expect(timeStepLabel(120)).toBe('Advance time 2 h')
    expect(timeStepLabel(-30)).toBe('Move the clock back 30 min')
    expect(timeStepLabel(2880)).toBe('Advance time 2 days')
  })
})
