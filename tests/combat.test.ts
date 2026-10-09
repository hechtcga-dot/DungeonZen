import { describe, expect, it } from 'vitest'
import { boostsAllies, changeHp, combatHints, nextTurn, previousTurn, type CombatState, type Combatant } from '../src/shared/combat'

const c = (id: string, name: string, side: Combatant['side'], hp = 10, extra: Partial<Combatant> = {}): Combatant =>
  ({ id, entityId: id, name, side, hp, maxHp: hp, tempHp: 0, ac: '12', conditions: [], notes: '', out: null, ...extra })
const state = (list: Combatant[]): CombatState => ({ round: 1, turn: 0, combatants: list, log: [] })
const plain = { creatureType: 'humanoid', leader: false, boosts: [], legendary: false, recharge: [] }

describe('turns', () => {
  it('skips creatures out of the fight and counts conditions down each round', () => {
    let s = state([c('a', 'Mira', 'party', 20, { conditions: [{ name: 'Poisoned', rounds: 1 }, { name: 'Prone', rounds: null }] }), c('b', 'Bandit 1', 'foe', 11, { out: 'fled' }), c('d', 'Bandit 2', 'foe')])
    s = nextTurn(s)
    expect(s.turn).toBe(2)
    s = nextTurn(s)
    expect([s.round, s.turn]).toEqual([2, 0])
    expect(s.combatants[0].conditions).toEqual([{ name: 'Prone', rounds: null }])
    expect(s.log).toEqual(['Round 2: Mira is no longer poisoned.', 'Round 2 begins.'])
    expect(previousTurn(s)).toMatchObject({ round: 1, turn: 2 })
  })
  it('takes damage from temporary hit points first, asks for concentration saves, and drops foes at 0', () => {
    let s = state([c('w', 'Witch', 'foe', 30, { tempHp: 5, conditions: [{ name: 'Concentrating', rounds: null }] })])
    s = changeHp(s, 'w', -12)
    expect(s.combatants[0]).toMatchObject({ hp: 23, tempHp: 0 })
    expect(s.log[1]).toContain('DC 10')
    s = changeHp(s, 'w', -40)
    expect(s.combatants[0]).toMatchObject({ hp: 0, out: 'down' })
    s = changeHp(s, 'w', 4)
    expect(s.combatants[0]).toMatchObject({ hp: 4, out: null })
  })
})

describe('morale and tactics', () => {
  it('half the bandits down: the rest may flee', () => {
    const s = state([c('1', 'Bandit 1', 'foe', 11, { out: 'down' }), c('2', 'Bandit 2', 'foe', 11, { out: 'down' }), c('3', 'Bandit 3', 'foe'), c('4', 'Bandit 4', 'foe')])
    expect(combatHints(s, {})[0]).toMatchObject({ level: 'warn', text: 'Bandit: half are down (2 of 4). The other 2 may flee or surrender.' })
  })
  it('guards stay while their captain stands; when the captain falls they may break', () => {
    const guards = [c('1', 'Guard 1', 'foe', 11, { out: 'down' }), c('2', 'Guard 2', 'foe'), c('cap', 'Guard Captain', 'foe', 75)]
    const info = { cap: { ...plain, leader: true, boosts: [{ name: 'Leadership', text: 'Allies within 30 feet add 1d4 to attack rolls.' }] } }
    const hints = combatHints(state(guards), info).map((h) => h.text)
    expect(hints).toContain('Guard: half are down, but guards hold their ground while Guard Captain still stands.')
    expect(hints).toContain('Guard Captain: Leadership. Allies within 30 feet add 1d4 to attack rolls.')
    const fallen = combatHints(state([...guards.slice(0, 2), { ...guards[2], out: 'down' as const }]), info).map((h) => h.text)
    expect(fallen).toContain('Guard Captain is down: 1 follower may lose heart and flee or surrender.')
  })
  it('the undead never flee; a lone hurt survivor may', () => {
    const zombies = [c('1', 'Zombie 1', 'foe', 22, { out: 'down' }), c('2', 'Zombie 2', 'foe', 22, { hp: 3 })]
    const info = { 1: { ...plain, creatureType: 'undead' }, 2: { ...plain, creatureType: 'undead' } }
    expect(combatHints(state(zombies), info).map((h) => h.text)).toEqual(['Zombie: half are down, but they know no fear and fight on.'])
    expect(combatHints(state([c('1', 'Thug 1', 'foe', 30, { out: 'down' }), c('2', 'Thug 2', 'foe', 32, { hp: 5 })]), {}).map((h) => h.level)).toEqual(['warn', 'info', 'warn'])
  })
  it('does not call the party down when their hit points are not tracked here', () => {
    expect(combatHints(state([c('p', 'Mira', 'party', 0), c('f', 'Ogre', 'foe', 59)]), {})).toEqual([])
  })
  it('spots traits that help allies', () => {
    expect(boostsAllies('Each ally within 10 feet of the captain has Advantage on attack rolls.')).toBe(true)
    expect(boostsAllies('The bandit makes two attacks.')).toBe(false)
  })
})
