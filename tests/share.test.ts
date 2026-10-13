import { describe, expect, it } from 'vitest'
import { share } from '../src/shared/share'

describe('structural sharing (refresh speed)', () => {
  it('keeps unchanged parts as the old objects, new parts new', () => {
    const prev = { a: { x: 1, list: [1, 2] }, b: { y: 'one' }, c: [{ id: 1 }, { id: 2 }] }
    const next = JSON.parse(JSON.stringify(prev))
    expect(share(prev, next)).toBe(prev)
    next.b.y = 'two'
    const out = share(prev, next)
    expect(out).not.toBe(prev)
    expect(out.a).toBe(prev.a)
    expect(out.c).toBe(prev.c)
    expect(out.b).toEqual({ y: 'two' })
  })
  it('counts added, removed and undefined keys and longer lists as changes', () => {
    expect(share({ a: 1 }, { a: 1, b: undefined })).toEqual({ a: 1, b: undefined })
    expect(share({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 })
    const prev = [{ id: 1 }]
    const out = share(prev, [{ id: 1 }, { id: 2 }])
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(prev[0])
    expect(share(null, { a: 1 })).toEqual({ a: 1 })
  })
})
