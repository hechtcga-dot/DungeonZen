import { describe, expect, it } from 'vitest'
import { centroid, estimateTravel, gridDistance, pointInPolygon, polygonArea, regionAt, regionOnBoard, type Point } from '../src/shared/geometry'

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
    expect(estimateTravel({ from: [0, 0], to: [400, 0], imageWidth: 1000, widthKm: 30, kmh: 3, units: 'metric' }))
      .toEqual({ minutes: 240, km: 12, basis: 'about 12 km in a straight line at 3 km/h' })
    expect(estimateTravel({ from: [0, 0], to: [400, 0], imageWidth: 1000, widthKm: 30, kmh: 4.828032, units: 'imperial' }).basis)
      .toBe('about 7.5 miles in a straight line at 3 mph')
    expect(estimateTravel({ from: [0, 0], to: [400, 0], imageWidth: 1000, widthKm: 30, kmh: 3, savedMinutes: 180 })).toMatchObject({ minutes: 180, km: 12, saved: true })
    expect(estimateTravel({ from: [0, 0], to: [1, 0], imageWidth: 1000, widthKm: 1, kmh: 3 }).minutes).toBe(10)
    expect(estimateTravel({ from: [0, 0], to: [400, 0], imageWidth: 1000, widthKm: null, kmh: 3 }).minutes).toBeNull()
  })

  it('measures on a 200-square travel grid', () => {
    expect(gridDistance([1, 1], [4, 4], 1000)).toBe(0) // same 5 px square
    expect(gridDistance([0, 0], [300, 400], 1000)).toBe(500)
  })
})

describe('regionOnBoard', () => {
  const regions = [{ name: 'A', polygon: square(0, 0, 500) }, { name: 'B', polygon: square(500, 0, 500) }]
  // A 1000 x 800 map shown 500 x 400 at (100, 100) on the board.
  const pic = { x: 100, y: 100, w: 500, h: 400, mapW: 1000, mapH: 800, regions }
  it('scales a board point onto the map picture', () => {
    expect(regionOnBoard([150, 150], [pic])?.name).toBe('A')
    expect(regionOnBoard([400, 150], [pic])?.name).toBe('B')
    expect(regionOnBoard([400, 450], [pic])).toBeNull() // on the map, outside every region
    expect(regionOnBoard([50, 50], [pic])).toBeNull() // off the picture
  })
  it('uses the top-most picture under the point', () => {
    const top = { ...pic, regions: [{ name: 'Top', polygon: square(0, 0, 1000) }] }
    expect(regionOnBoard([150, 150], [pic, top])?.name).toBe('Top')
  })
})
