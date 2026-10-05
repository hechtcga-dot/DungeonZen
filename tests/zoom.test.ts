import { describe, expect, it } from 'vitest'
import { fitTransform, zoomAt } from '../src/shared/zoom'

describe('map zoom', () => {
  it('fits and centres a wide image', () => {
    expect(fitTransform(2000, 1000, 1000, 1000)).toEqual({ scale: 0.5, x: 0, y: 250 })
  })

  it('keeps the point under the pointer still while zooming', () => {
    const t = { scale: 1, x: 10, y: 20 }
    const z = zoomAt(t, 2, 110, 120, 0.1, 10)
    // Image point under (110,120) before: ((110-10)/1, (120-20)/1) = (100,100); after it must map back to (110,120).
    expect(z.scale).toBe(2)
    expect(z.x + 100 * z.scale).toBe(110)
    expect(z.y + 100 * z.scale).toBe(120)
  })

  it('stops at the limits', () => {
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 100, 0, 0, 0.5, 4).scale).toBe(4)
    expect(zoomAt({ scale: 1, x: 0, y: 0 }, 0.01, 0, 0, 0.5, 4).scale).toBe(0.5)
  })
})
