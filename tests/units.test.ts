import { describe, expect, it } from 'vitest'
import { convertText, DEFAULT_UNITS, fmtDistance, fmtSpeed, fmtSquares, fmtTrip, kmToShown, niceStep, PACES, paceKmh, roundDown, shownToKm } from '../src/shared/units'

describe('units', () => {
  it('shows stored metric values either way', () => {
    expect(fmtDistance(16.09344, 'imperial')).toBe('10 miles')
    expect(fmtDistance(16.09344, 'metric')).toBe('16.1 km')
    expect(fmtSpeed(4.828032, 'imperial')).toBe('3 mph')
    expect(fmtSquares(10, 'metric')).toBe('15 m')
    expect(fmtSquares(10, 'imperial')).toBe('50 ft')
    expect(shownToKm(kmToShown(100, 'imperial'), 'imperial')).toBeCloseTo(100, 0)
  })
  it('converts feet and miles in free text for metric, leaves other words alone', () => {
    expect(convertText('30 ft., fly 60 ft. (hover)', 'metric')).toBe('9 m, fly 18 m (hover)')
    expect(convertText('Darkvision 120 ft.; Passive Perception 12', 'metric')).toBe('Darkvision 36 m; Passive Perception 12')
    expect(convertText('a 15-foot cone, 2 miles away', 'metric')).toBe('a 4.5 m cone, 3.2 km away')
    expect(convertText('range 30/90 ft. 8 (1d10 + 3)', 'metric')).toBe('range 9/27 m 8 (1d10 + 3)')
    expect(convertText('30 ft.', 'imperial')).toBe('30 ft.')
    expect(convertText('fifty feet', 'metric')).toBe('fifty feet')
  })

  it('map scale and travel: trip lengths in one system, tidy bar steps, paces', () => {
    expect(DEFAULT_UNITS).toBe('imperial')
    expect(fmtTrip(1.609344 * 1.34, 'imperial')).toBe('1.3 mi')
    expect(fmtTrip(0.1, 'imperial')).toBe('330 ft')
    expect(fmtTrip(0.8, 'metric')).toBe('800 m')
    expect(fmtTrip(25, 'metric')).toBe('25 km')
    expect([1, 3, 999, 0.6].map(niceStep)).toEqual([0.1, 0.5, 100, 0.1])
    expect([0.62, 3, 999, 7].map(roundDown)).toEqual([0.5, 2.5, 500, 5])
    const walk = PACES.find((p) => p.name === 'Normal walk')!
    expect(paceKmh(walk, 'imperial')).toBeCloseTo(4.828, 3)
    expect(paceKmh(walk, 'metric')).toBe(5)
  })
})
