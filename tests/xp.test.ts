import { describe, expect, it } from 'vitest'
import { xpProgress } from '../src/shared/charsheet'

describe('XP progress', () => {
  it('counts XP to the next level and flags close and level up', () => {
    expect(xpProgress(0, 1)).toMatchObject({ toNext: 300, close: false, levelUp: false })
    expect(xpProgress(280, 1)).toMatchObject({ toNext: 20, close: true })
    expect(xpProgress(950, 2)).toMatchObject({ xpLevel: 3, levelUp: true })
    expect(xpProgress(400000, 20)).toMatchObject({ toNext: null, levelUp: false })
  })
})
