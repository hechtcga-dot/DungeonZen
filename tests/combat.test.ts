import { describe, expect, it } from 'vitest'
import { boostsAllies, changeHp, combatHints, crForXp, deathSave, effectLine, legendaryCount, limitedUses, newCombatant, nextTurn, previousTurn, slotsFromText, splitCombatant, type CombatantInfo, type CombatState, type Combatant } from '../src/shared/combat'

const c = (id: string, name: string, side: Combatant['side'], hp = 10, extra: Partial<Combatant> = {}): Combatant =>
  newCombatant({ id, entityId: id, name, side, hp, maxHp: hp, ac: '12', ...extra })
const state = (list: Combatant[]): CombatState => ({ round: 1, turn: 0, combatants: list, log: [], effects: [] })
const plain: CombatantInfo = {
  creatureType: 'humanoid', leader: false, boosts: [], legendary: false, recharge: [], cr: '1', level: null, xp: 200, pp: 10, saveDc: null, dexMod: 0,
  resist: '', immune: '', vuln: '', limited: [], legendaryActions: 0, lair: false, split: null, mirrorImage: false, displacement: false, actions: [], slots: [], slotsUsed: [], cardType: 'MONSTER', size: 'Large', splitOnBloodied: false, pc: null
}

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

describe('1.4.0 fight rules', () => {
  const info = (extra: Partial<CombatantInfo>): CombatantInfo => ({ ...plain, ...extra })
  it('halves resisted damage, ignores immune, doubles vulnerable', () => {
    const s = state([c('p', 'Black Pudding', 'foe', 85), c('g', 'Ghost', 'foe', 45)])
    const i = { p: info({ immune: 'acid, cold, lightning, slashing', split: ['lightning', 'slashing'] }), g: info({ resist: 'acid, fire', vuln: 'radiant' }) }
    expect(changeHp(s, 'g', -11, 'fire', i).combatants[1].hp).toBe(40)
    expect(changeHp(s, 'g', -10, 'radiant', i).combatants[1].hp).toBe(25)
    expect(changeHp(s, 'g', -10, '', i).combatants[1].hp).toBe(35)
  })
  it('splits on its damage types with at least 10 HP, into two with half each', () => {
    const s = state([c('p', 'Black Pudding', 'foe', 85)])
    const i = { p: info({ split: ['lightning', 'slashing'] }) }
    const after = changeHp(s, 'p', -10, 'slashing', i)
    expect(after.combatants.map((x) => [x.name, x.hp, x.maxHp])).toEqual([['Black Pudding A', 37, 37], ['Black Pudding B', 37, 37]])
    expect(splitCombatant(state([c('p', 'Black Pudding', 'foe', 9)]), 'p').combatants).toHaveLength(1)
    // Large → Medium → Small: a Small pudding no longer splits.
    const twice = splitCombatant(after, after.combatants[0].id, 'Large')
    expect(twice.combatants).toHaveLength(3)
    expect(splitCombatant(twice, twice.combatants[0].id, 'Large').combatants).toHaveLength(3)
    // 2024 Black Pudding: also when it becomes bloodied.
    const bl = changeHp(state([c('p', 'Black Pudding', 'foe', 85)]), 'p', -45, '', { p: info({ split: ['lightning', 'slashing'], splitOnBloodied: true }) })
    expect(bl.combatants).toHaveLength(2)
  })
  it('turns Displacement off when hit and back on at the start of its turn; refreshes legendary actions', () => {
    let s = state([c('a', 'Mira', 'party', 20), c('d', 'Displacer Beast', 'foe', 85, { displacement: 'on', legendaryUsed: 2 })])
    s = changeHp(s, 'd', -5)
    expect(s.combatants[1].displacement).toBe('off')
    s = nextTurn(s)
    expect(s.combatants[1]).toMatchObject({ displacement: 'on', legendaryUsed: 0 })
  })
  it('counts death saves for the party at 0 HP and records each round', () => {
    let s = state([c('a', 'Mira', 'party', 5)])
    s = changeHp(s, 'a', -5)
    s = changeHp(s, 'a', -3)
    expect(s.combatants[0].death).toEqual({ s: 0, f: 1 })
    s = deathSave(deathSave(deathSave(s, 'a', 's', true), 'a', 's', true), 'a', 's', true)
    expect(s.combatants[0].stable).toBe(true)
    expect(s.combatants[0].rounds['1']).toMatchObject({ dmg: 8 })
    s = changeHp(s, 'a', 4)
    expect(s.combatants[0]).toMatchObject({ hp: 4, stable: false, death: { s: 0, f: 0 } })
  })
  it('counts effects down with the rounds', () => {
    const fx = { id: 'w', name: 'Web', scope: 'some' as const, ids: ['a'], save: 'DEX' as const, dc: 14, damage: '', onSave: '', trigger: 'enter' as const, rounds: 1, source: 'Mira', note: 'Restrained on a failure.' }
    const s = nextTurn({ ...state([c('a', 'Bandit', 'foe')]), effects: [fx] })
    expect(s.effects).toEqual([])
    expect(effectLine(fx)).toBe('Web: DEX save DC 14, when it enters or starts its turn there. Restrained on a failure.')
  })
  it('reads limited uses, legendary actions and spell slots from the stat block', () => {
    expect(limitedUses([{ name: 'Fire Breath (Recharge 5–6)', text: '' }, { name: 'Legendary Resistance (4/Day, or 5/Day in Lair)', text: '' }, { name: 'Spellcasting', text: '- **2/Day Each:** Fireball, Fly' }, { name: 'Cold Breath', text: 'Constitution Saving Throw: DC 15' }]).map((l) => [l.kind, l.name, l.max]))
      .toEqual([['recharge', 'Fire Breath', 1], ['legendaryResist', 'Legendary Resistance', 4], ['perDay', 'Fireball', 2], ['perDay', 'Fly', 2], ['recharge', 'Cold Breath', 1]])
    expect(legendaryCount(['Legendary Action Uses: 2.'], true)).toBe(2)
    expect(slotsFromText('1st level (4 slots): x\n3rd level (2 slots): y').slice(0, 3)).toEqual([4, 0, 2])
    expect(crForXp(5000)).toBe('9')
  })
})
