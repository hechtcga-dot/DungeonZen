import { describe, expect, it } from 'vitest'
import { crStep, scaleToCr } from '../src/shared/crscale'
import { StatBlock } from '../src/shared/statblock'

const captain = StatBlock.parse({ size: 'Medium or Small', creatureType: 'humanoid', ac: '15', hp: '52', hitDice: '8d8 + 16', cr: '2', saves: 'Str +4, Dex +5', traits: [] })
const scimitar = { id: 'a1', name: 'Scimitar', description: 'Melee Attack Roll: +5, reach 5 ft. 6 (1d6 + 3) Slashing damage.', macroText: '{{attack=[[1d20+5]]}} {{damage=[[1d6+3]]}}' }

describe('raise or lower CR', () => {
  it('knows the CR steps', () => {
    expect(crStep('1/4')).toBe(2)
    expect(crStep('2')).toBe(5)
    expect(crStep('x')).toBeNull()
  })
  it('raises a bandit captain to CR 5: more HP, AC, attack, proficiency and damage dice', () => {
    const r = scaleToCr(captain, [scimitar], '5')
    expect(r.statblock).toMatchObject({ cr: '5', hp: '78', ac: '17', saves: 'Str +5, Dex +6', hitDice: '12d8 + 24' })
    expect(r.abilities[0].description).toBe('Melee Attack Roll: +8, reach 5 ft. 10 (2d6 + 3) Slashing damage.')
    expect(r.abilities[0].macroText).toBe('{{attack=[[1d20+8]]}} {{damage=[[2d6+3]]}}')
    expect(r.changes[0]).toBe('Challenge rating 2 → 5')
  })
  it('lowers CR without going below one die or AC 5', () => {
    const r = scaleToCr(captain, [scimitar], '1/8')
    expect(Number(r.statblock.hp)).toBeLessThan(52)
    expect(r.abilities[0].description).toContain('(1d6 + 3)')
    expect(() => scaleToCr({ ...captain, cr: '' }, [], '3')).toThrow('Set the challenge rating first')
  })
})
