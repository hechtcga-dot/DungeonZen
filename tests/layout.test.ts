import { describe, expect, it } from 'vitest'
import { freeSpot, stringEnds } from '../src/shared/layout'

describe('free spot for a new card', () => {
  it('uses the starting point on an empty board', () => {
    expect(freeSpot({ x: 100, y: 100 }, [])).toEqual({ x: 100, y: 100 })
  })

  it('moves to a neighbouring slot when the start is taken', () => {
    const p = freeSpot({ x: 0, y: 0 }, [{ x: 10, y: 10 }])
    expect(Math.abs(p.x) >= 250 || Math.abs(p.y) >= 170).toBe(true)
  })

  it('never returns a spot that overlaps any item while space remains', () => {
    const items: Array<{ x: number; y: number }> = []
    for (let i = 0; i < 30; i++) items.push(freeSpot({ x: 0, y: 0 }, items))
    for (const a of items) for (const b of items) {
      if (a !== b) expect(Math.abs(a.x - b.x) >= 250 || Math.abs(a.y - b.y) >= 170).toBe(true)
    }
  })
})

describe('string points', () => {
  const card = (x: number, y: number) => ({ x, y, w: 200, h: 100 })
  it('ties a card above to one below: bottom middle to top middle', () => {
    expect(stringEnds(card(0, 0), card(0, 300))).toEqual({ sx: 100, sy: 100, tx: 100, ty: 300 })
  })
  it('ties cards side by side at the nearest corners', () => {
    expect(stringEnds(card(0, 0), card(400, 0))).toEqual({ sx: 200, sy: 0, tx: 400, ty: 0 })
  })
  it('follows a card that moves', () => {
    expect(stringEnds(card(0, 300), card(0, 0))).toEqual({ sx: 100, sy: 300, tx: 100, ty: 100 })
  })
})
