import { describe, expect, it } from 'vitest'
import { emptyStatBlock, parseBonuses, passiveScore, proficiencyBonus, saveBonus, skillBonus } from '../src/shared/statblock'

const sb = { ...emptyStatBlock(), str: 15, dex: 18, wis: 10, saves: 'Str +7, Con +9', skills: 'Acrobatics +8, Sleight of Hand +6, Insight +4', senses: 'darkvision 60 ft.' }

describe('character sheet numbers', () => {
  it('reads listed bonuses, names of several words included', () => {
    expect(parseBonuses('Sleight of Hand +6, Stealth −1')).toEqual(new Map([['sleight of hand', 6], ['stealth', -1]]))
  })
  it('uses a listed save, else the ability modifier', () => {
    expect(saveBonus(sb, 'str')).toEqual({ bonus: 7, proficient: true })
    expect(saveBonus(sb, 'dex')).toEqual({ bonus: 4, proficient: false })
    expect(saveBonus({ ...sb, saves: 'Dexterity +9' }, 'dex')).toEqual({ bonus: 9, proficient: true })
  })
  it('uses a listed skill, else the ability modifier', () => {
    expect(skillBonus(sb, 'Sleight of Hand', 'dex')).toEqual({ bonus: 6, proficient: true })
    expect(skillBonus(sb, 'Stealth', 'dex')).toEqual({ bonus: 4, proficient: false })
  })
  it('works out passive scores; the senses line wins for Perception', () => {
    expect(passiveScore(sb, 'Insight')).toBe(14)
    expect(passiveScore(sb, 'Perception')).toBe(10)
    expect(passiveScore({ ...sb, senses: 'passive Perception 17' }, 'Perception')).toBe(17)
  })
  it('gives the proficiency bonus by CR or level', () => {
    expect([0.25, 1, 4, 5, 9, 17, 30].map(proficiencyBonus)).toEqual([2, 2, 2, 3, 4, 6, 9])
  })
})
