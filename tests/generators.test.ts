import { describe, expect, it } from 'vitest'
import { encounterBudget, fillTavern, rollCharacter, seededRng, suggestEncounter, xpForCr } from '../src/main/generators'
import { srdMonsterIndex } from '../src/main/srd'

describe('on-the-fly generators', () => {
  it('rolls a repeatable character with an SRD stat block that exists', () => {
    const a = rollCharacter(seededRng(7))
    const b = rollCharacter(seededRng(7))
    expect(a).toEqual(b)
    expect(a.name).toMatch(/^\w+ \w+$/)
    const names = new Set(srdMonsterIndex().map((m) => m.name))
    for (let s = 0; s < 50; s++) expect(names.has(rollCharacter(seededRng(s)).statblockName)).toBe(true)
  })

  it('fills a tavern with a keeper and three to five patrons', () => {
    const t = fillTavern(seededRng(3))
    expect(t.name).toMatch(/^The \w+ \w+$/)
    expect(t.patrons.length).toBeGreaterThanOrEqual(3)
    expect(t.patrons.length).toBeLessThanOrEqual(5)
    expect(t.keeper.occupation).toBe('innkeeper')
  })

  it('uses the 2024 XP budgets and CR values', () => {
    expect(encounterBudget(1, 4, 'low')).toBe(200)
    expect(encounterBudget(5, 4, 'high')).toBe(4400)
    expect(encounterBudget(25, 1, 'moderate')).toBe(13200) // capped at level 20
    expect(xpForCr('1/4')).toBe(50)
    expect(xpForCr('5')).toBe(1800)
  })

  it('never goes over the budget and keeps to one creature type', () => {
    const monsters = srdMonsterIndex()
    for (let s = 0; s < 40; s++) {
      const e = suggestEncounter(seededRng(s), monsters, 1 + (s % 10), 4, (['low', 'moderate', 'high'] as const)[s % 3])!
      expect(e).not.toBeNull()
      expect(e.totalXp).toBeLessThanOrEqual(e.budget)
      expect(e.groups.reduce((n, g) => n + g.xp, 0)).toBe(e.totalXp)
      const types = new Set(e.groups.map((g) => monsters.find((m) => m.key === g.key)!.creatureType))
      expect(types.size).toBe(1)
    }
  })

  it('honours a chosen creature type', () => {
    const e = suggestEncounter(seededRng(1), srdMonsterIndex(), 3, 4, 'moderate', 'undead')!
    expect(e.creatureType).toBe('undead')
  })
})
