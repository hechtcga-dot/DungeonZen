import { describe, expect, it } from 'vitest'
import { centroid, estimateTravel, pointInPolygon, polygonArea, regionAt, type Point } from '../src/shared/geometry'

const square = (x: number, y: number, s: number): Point[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]

describe('map geometry', () => {
  it('finds points inside polygons', () => {
    expect(pointInPolygon([5, 5], square(0, 0, 10))).toBe(true)
    expect(pointInPolygon([15, 5], square(0, 0, 10))).toBe(false)
    const ell: Point[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]
    expect(pointInPolygon([7, 7], ell)).toBe(false)
    expect(pointInPolygon([2, 7], ell)).toBe(true)
  })

  it('measures area and centre', () => {
    expect(polygonArea(square(0, 0, 10))).toBe(100)
    expect(centroid(square(0, 0, 10))).toEqual([5, 5])
  })

  it('prefers the smallest region, so sub-regions win', () => {
    const regions = [{ id: 'city', polygon: square(0, 0, 100) }, { id: 'market', polygon: square(10, 10, 20) }]
    expect(regionAt([15, 15], regions)?.id).toBe('market')
    expect(regionAt([80, 80], regions)?.id).toBe('city')
    expect(regionAt([500, 500], regions)).toBeNull()
  })

  it('estimates travel from the map scale, or uses a saved time', () => {
    // 1000 px wide map is 30 km across; 400 px = 12 km; at 3 km/h = 4 h.
    expect(estimateTravel({ from: [0, 0], to: [400, 0], imageWidth: 1000, widthKm: 30, kmh: 3 }))
      .toEqual({ minutes: 240, km: 12, basis: 'about 12 km in a straight line at 3 km/h' })
    expect(estimateTravel({ from: [0, 0], to: [400, 0], imageWidth: 1000, widthKm: 30, kmh: 4.828032, units: 'imperial' }).basis)
      .toBe('about 7.5 miles in a straight line at 3 mph')
    expect(estimateTravel({ from: [0, 0], to: [400, 0], imageWidth: 1000, widthKm: 30, kmh: 3, savedMinutes: 180 }).minutes).toBe(180)
    expect(estimateTravel({ from: [0, 0], to: [1, 0], imageWidth: 1000, widthKm: 1, kmh: 3 }).minutes).toBe(10)
    expect(estimateTravel({ from: [0, 0], to: [400, 0], imageWidth: 1000, widthKm: null, kmh: 3 }).minutes).toBeNull()
  })
})
