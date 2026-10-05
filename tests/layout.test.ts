import { describe, expect, it } from 'vitest'
import { freeSpot } from '../src/shared/layout'

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
