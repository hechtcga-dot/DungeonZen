import { describe, expect, it } from 'vitest'
import { BUILT_IN_TABLES, dieFor, encounterTableFor, findTable, parseEntries, rollOn, travelChecks } from '../src/shared/rolltables'
import { seededRng } from '../src/main/generators'

describe('roll tables', () => {
  it('every {reference} in a built-in table exists', () => {
    for (const t of BUILT_IN_TABLES) for (const e of t.entries) for (const m of e.matchAll(/\{([a-z0-9-]+)\}/g)) expect(findTable(m[1]), `${t.id}: ${m[1]}`).toBeTruthy()
    expect(new Set(BUILT_IN_TABLES.map((t) => t.id)).size).toBe(BUILT_IN_TABLES.length)
  })
  it('rolls nested tables and the DM\'s own', () => {
    const out = rollOn(findTable('npc')!, [], seededRng(3))
    expect(out).not.toMatch(/\{/)
    const own = [{ id: 'mine', name: 'Mine', group: 'Your tables', card: 'SCENE' as const, entries: ['a {weather} day'] }]
    expect(rollOn(own[0], own, seededRng(1))).toMatch(/^a .+ day$/)
  })
  it('pasted lists lose their numbers and bullets; dice fit the size', () => {
    expect(parseEntries('1. one\n2) two\n- three\n\n15-16 four\n• five')).toEqual(['one', 'two', 'three', 'four', 'five'])
    expect(dieFor(6)).toBe('d6'); expect(dieFor(20)).toBe('d20'); expect(dieFor(14)).toBe('d20'); expect(dieFor(37)).toBe('d100')
  })
  it('travel: a check per started 4 hours, the region picks the encounter table', () => {
    expect([travelChecks(30), travelChecks(60), travelChecks(240), travelChecks(241), travelChecks(600)]).toEqual([0, 1, 1, 2, 3])
    expect(encounterTableFor('region', 'forest')).toBe('enc-forest')
    expect(encounterTableFor('city', null)).toBe('enc-city')
    expect(encounterTableFor(null, null)).toBe('enc-road')
    expect(findTable('travel-check')!.entries).toHaveLength(20)
  })
})
