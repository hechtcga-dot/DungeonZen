import { describe, expect, it } from 'vitest'
import { encounterBudget, fillTavern, matchMonsters, MAX_ROLLED, maxCreatures, rollCharacter, seededRng, suggestEncounter, suggestThemed, xpForCr } from '../src/main/generators'
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

  it('rolls at random from the whole SRD within the budget', () => {
    const monsters = srdMonsterIndex()
    const seen = new Set<string>()
    for (let s = 0; s < 40; s++) {
      const e = suggestEncounter(seededRng(s), monsters, 1 + (s % 10), 4, (['low', 'moderate', 'high'] as const)[s % 3])!
      expect(e.totalXp).toBeLessThanOrEqual(e.budget)
      expect(e.groups.reduce((n, g) => n + g.xp, 0)).toBe(e.totalXp)
      expect(e.groups.reduce((n, g) => n + g.count, 0)).toBeLessThanOrEqual(MAX_ROLLED)
      e.groups.forEach((g) => seen.add(g.key))
    }
    expect(seen.size).toBeGreaterThan(60) // many different monsters, not the same few
    // A small budget still varies between rolls.
    const small = new Set(Array.from({ length: 30 }, (_, s) => suggestEncounter(seededRng(s), monsters, 1, 1, 'moderate')!.groups.map((g) => g.name).join()))
    expect(small.size).toBeGreaterThan(10)
  })

  it('words pick monsters whose stat block mentions them', () => {
    const monsters = srdMonsterIndex()
    const e = suggestEncounter(seededRng(1), monsters, 3, 4, 'moderate', 'undead')!
    expect(e.creatureType).toBe('undead')
    expect(matchMonsters(monsters, 'hills').map((m) => m.name)).toContain('Hill Giant')
    expect(matchMonsters(monsters, 'swim').length).toBeGreaterThan(10)
    expect(matchMonsters(monsters, 'sphinx').every((m) => /sphinx/i.test(m.name))).toBe(true)
    const tooDear = suggestEncounter(seededRng(1), monsters, 1, 1, 'moderate', 'sphinx')!
    expect(tooDear.groups).toEqual([])
    expect(tooDear.note).toMatch(/Sphinx.*more than the 75 XP budget/)
    expect(suggestEncounter(seededRng(1), monsters, 1, 1, 'moderate', 'zzqx')!.note).toBe('No SRD monster mentions “zzqx”.')
  })

  it('keeps a small party\'s fight small: at most twice the characters (at least 4), stronger monsters first', () => {
    const monsters = srdMonsterIndex()
    expect(maxCreatures(2)).toBe(4)
    expect(maxCreatures(5)).toBe(10)
    for (let s = 0; s < 40; s++) {
      const e = suggestEncounter(seededRng(s), monsters, 1, 2, 'moderate')!
      expect(e.groups.reduce((n, g) => n + g.count, 0)).toBeLessThanOrEqual(4)
      const t = suggestThemed(seededRng(s), monsters, 1, 2, 'moderate', { lands: ['grassland'] })
      if (t) expect(t.groups.reduce((n, g) => n + g.count, 0)).toBeLessThanOrEqual(4)
    }
    // Jackals (10 XP) and wolves (50 XP) for 150 XP: wolves, not a pack of 15 jackals.
    const pool = monsters.filter((m) => m.name === 'Jackal' || m.name === 'Wolf')
    const e = suggestEncounter(seededRng(2), pool, 1, 2, 'moderate')!
    expect(e.groups.find((g) => g.name === 'Wolf')?.count).toBeGreaterThan(0)
    expect(e.totalXp).toBeGreaterThanOrEqual(100)
  })
})
