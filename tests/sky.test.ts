import { describe, expect, it } from 'vitest'
import { moonOn, skyAt } from '../src/shared/sky'
import { imageSize } from '../src/main/imageSize'

describe('sky and moon', () => {
  it('puts the sun up by day and the moon up by night', () => {
    expect(skyAt(12 * 60)).toMatchObject({ body: 'sun', progress: 0.5, light: 'daylight' })
    expect(skyAt(0)).toMatchObject({ body: 'moon', progress: 0.5, light: 'night' })
    expect(skyAt(6 * 60).light).toBe('dawn')
    expect(skyAt(18 * 60 + 10)).toMatchObject({ body: 'moon', light: 'dusk' })
    expect(skyAt(36 * 60).progress).toBe(0.5) // Day 2 noon
  })

  it('runs a 29.5-day lunar cycle, full on Day 1 by default', () => {
    expect(moonOn(0)).toMatchObject({ name: 'Full moon', nightsUntilFull: 0 })
    expect(moonOn(0).illumination).toBeCloseTo(1)
    const later = moonOn(Math.round(14.75 * 24 * 60))
    expect(later.name).toBe('New moon')
    expect(later.nightsUntilFull).toBe(15)
    expect(moonOn(0, 3).nightsUntilFull).toBe(27)
    expect(moonOn(9 * 60).nightsUntilFull).toBe(0) // Day 1 morning, just past full
    expect(moonOn(0, -1).nightsUntilFull).toBe(1)
  })
})

describe('image size', () => {
  it('reads a PNG header', () => {
    const png = Buffer.alloc(24)
    png.write('\x89PNG\r\n\x1a\n', 0, 'latin1')
    png.writeUInt32BE(1600, 16)
    png.writeUInt32BE(900, 20)
    expect(imageSize(png)).toEqual({ width: 1600, height: 900 })
  })

  it('reads a JPEG start-of-frame', () => {
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20, 0x03])
    expect(imageSize(jpg)).toEqual({ width: 800, height: 600 })
  })

  it('returns null for something else', () => {
    expect(imageSize(Buffer.from('hello world, not an image at all'))).toBeNull()
  })
})
