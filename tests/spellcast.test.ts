import { describe, expect, it } from 'vitest'
import srd from '../resources/srd/srd-2024-attacks.json'
import type { SrdAttacks } from '../src/shared/attacks'
import { newCombatant, type CombatantInfo, type CombatState } from '../src/shared/combat'
import { convertSorcery, slotState, slotsLeft, slotsLine, spendSlot } from '../src/shared/slots'
import {
  applyCast, checkCaster, checkTarget, durationRounds, endConcentration, reactionOptions, reactionTriggers, spellRulesFor, spellsInText,
  srdSpellRules, textSpellRules, type SpellRules, type TargetCheck
} from '../src/shared/spellcast'

const spells = (srd as SrdAttacks).spells
const rules = (name: string) => srdSpellRules(spells.find((s) => s.name === name)!)

describe('spell slots', () => {
  it('keeps the most apart from used, bonus slots on top, Pact Magic', () => {
    const s = slotState({ spell_slots: [4, 3], slots_used: [1, 3], slots_bonus: [1], pact_slots: { count: 2, level: 3 }, pact_used: 1 })
    expect(slotsLeft(s).slice(0, 2)).toEqual([4, 0])
    expect(spendSlot(s, 2)).toBeNull()
    expect(spendSlot(s, 1)).toEqual({ slots_used: [2, 3, 0, 0, 0, 0, 0, 0, 0] })
    expect(spendSlot(s, 3, true)).toEqual({ pact_used: 2 })
    expect(slotsLine(s)).toBe('1: 4/5, 2: 0/3, Pact (level 3): 1/2')
  })
  it('reads slots from a Spellcasting text when the card has none', () => {
    expect(slotState({}, '1st level (4 slots): Shield').max[0]).toBe(4)
  })
  it('converts Sorcery Points both ways (2024 costs)', () => {
    const attrs = { spell_slots: [4, 3, 3], slots_used: [0, 0, 1], uses: [{ name: 'Sorcery Points', max: 6, used: 1, reset: 'long' }] }
    const s = slotState(attrs)
    const make = convertSorcery(attrs, s, 'make', 3)
    expect(make).toEqual({ patch: { uses: [{ name: 'Sorcery Points', max: 6, used: 6, reset: 'long' }], slots_bonus: [0, 0, 1, 0, 0, 0, 0, 0, 0] } })
    expect(convertSorcery(attrs, s, 'make', 4)).toEqual({ error: 'A level 4 slot costs 6 Sorcery Points; 5 left.' })
    const burn = convertSorcery(attrs, s, 'burn', 2)
    expect(burn).toEqual({ patch: { slots_used: [0, 1, 1, 0, 0, 0, 0, 0, 0], uses: [{ name: 'Sorcery Points', max: 6, used: 0, reset: 'long' }] } })
    expect(convertSorcery({}, s, 'make', 1)).toHaveProperty('error')
  })
})

describe('spell rule fields', () => {
  it('reads the SRD', () => {
    expect(rules('Hold Person')).toMatchObject({ level: 2, save: 'WIS', types: ['Humanoid'], conditions: ['Paralyzed'], concentration: true, rounds: 10, verbal: true, material: true })
    expect(rules('Charm Person').types).toEqual(['Humanoid'])
    expect(rules('Animal Friendship').types).toEqual(['Beast'])
    expect(rules('Polymorph').types).toEqual([])
    expect(rules('Hold Monster').types).toEqual([])
    expect(rules('Fire Bolt')).toMatchObject({ attack: 'ranged', damage: ['fire'], save: '' })
    expect(rules('Shocking Grasp').attack).toBe('melee')
    expect(rules('Thunderwave')).toMatchObject({ save: 'CON', halfOnSave: true, damage: ['thunder'] })
    expect(rules('Hideous Laughter').conditions).toEqual(['Prone', 'Incapacitated'])
    expect(rules('Cure Wounds')).toMatchObject({ heal: true, damage: [] })
    expect(rules('Shield')).toMatchObject({ time: 'reaction', level: 1 })
    expect(rules('Grease').conditions).toContain('Prone')
  })
  it('reads a sheet\'s own spell text', () => {
    expect(textSpellRules('Cantrip Evocation, 1 Action, Range 120 ft., Spell Attack +12, 2d10 Fire damage. Hits a target with a beam of fire.'))
      .toMatchObject({ level: 0, time: 'action', attack: 'ranged', damage: ['fire'] })
    expect(textSpellRules('Cantrip Evocation, 1 Action, Touch, Spell Attack +12, 2d8 Lightning damage. Target loses the ability to take reactions until the start of its next turn.'))
      .toMatchObject({ noReactions: true, damage: ['lightning'] })
    expect(textSpellRules('Level 1 Abjuration, 1 Reaction, Self. Grants resistance to incoming elemental damage').time).toBe('reaction')
    expect(textSpellRules('Cantrip Evocation, 1 Action, Range 60 ft., CON Save DC 20, 2d6 Cold damage.').save).toBe('CON')
    expect(textSpellRules('Cantrip Evocation, 1 Action, Self, CON Save DC 20, Prone / Push. Creates a whirling barrier of air around self for 1 round.')).toMatchObject({ conditions: ['Prone'], save: 'CON', rounds: 1 })
    expect(textSpellRules('Level 2 Enchantment · action · 60 feet · V, S, M · Concentration, 1 minute. Wisdom Saving Throw: DC 15')).toMatchObject({ level: 2, verbal: true, somatic: true, material: true, concentration: true, rounds: 10, save: 'WIS' })
  })
  it('uses the DM\'s own fields first, then the SRD, then the text', () => {
    const mine = { ...rules('Fire Bolt'), damage: ['cold'] }
    expect(spellRulesFor('Fire Bolt', '', { 'fire bolt': mine }, spells)).toEqual({ rules: mine, source: 'yours' })
    expect(spellRulesFor('fire bolt', '', {}, spells).source).toBe('srd')
    expect(spellRulesFor('Gust Barrier', 'Cantrip Evocation', {}, spells).source).toBe('text')
  })
  it('durations and Spellcasting lists', () => {
    expect([durationRounds('1 minute'), durationRounds('Concentration, up to 1 hour'), durationRounds('instantaneous')]).toEqual([10, 600, null])
    expect(spellsInText('- **At Will:** Detect Magic, Light\n- **2/Day Each:** Fireball, Invisibility')).toEqual([
      { name: 'Detect Magic', useKey: null }, { name: 'Light', useKey: null }, { name: 'Fireball', useKey: 'day:Fireball' }, { name: 'Invisibility', useKey: 'day:Invisibility' }])
  })
})

const target = (extra: Partial<TargetCheck> = {}): TargetCheck => ({ name: 'Goblin', creatureType: 'Fey (Goblinoid)', size: 'Small', resist: '', immune: '', vuln: '', condImmune: '', conditions: [], magicResist: false, legendaryLeft: 0, ...extra })
const levels = (lines: Array<{ level: string }>) => lines.map((l) => l.level)

describe('checks', () => {
  it('red when it cannot work', () => {
    expect(levels(checkTarget(rules('Hold Person'), target(), 'DC 15'))).toEqual(['red'])
    expect(levels(checkTarget(rules('Hold Person'), target({ creatureType: 'humanoid' }), 'DC 15'))).toEqual(['green'])
    expect(levels(checkTarget(rules('Fire Bolt'), target({ immune: 'fire, poison' }), ''))).toEqual(['red'])
    expect(levels(checkTarget(rules('Hold Monster'), target({ condImmune: 'paralyzed' }), ''))).toEqual(['red'])
    expect(checkTarget(textSpellRules('Level 1 · action. A creature you touch regains 2d8 Hit Points. This spell has no effect on Undead or Constructs.'), target({ creatureType: 'undead' }), '')[0]).toEqual({ level: 'red', text: 'No effect on Undead.' })
  })
  it('yellow catches', () => {
    expect(levels(checkTarget(rules('Fire Bolt'), target({ resist: 'fire' }), '+7'))).toEqual(['green', 'yellow'])
    expect(levels(checkTarget(rules('Hold Monster'), target({ magicResist: true, legendaryLeft: 2 }), ''))).toEqual(['green', 'yellow', 'yellow'])
  })
  it('caster: incapacitated, silenced, no slot, the bonus action spell rule, concentration', () => {
    const base = { name: 'Raph', conditions: [], effects: [], slotOk: true, turn: null, concentrating: null }
    expect(checkCaster(rules('Hold Person'), base, true)).toEqual([])
    expect(levels(checkCaster(rules('Hold Person'), { ...base, conditions: ['Stunned'] }, true))).toEqual(['red'])
    expect(levels(checkCaster(rules('Hold Person'), { ...base, conditions: ['Withdrawn'] }, true))).toEqual(['red'])
    expect(levels(checkCaster(rules('Hold Person'), { ...base, effects: ['Silence'] }, true))).toEqual(['red'])
    expect(levels(checkCaster(rules('Hold Person'), { ...base, slotOk: false }, true))).toEqual(['red'])
    expect(levels(checkCaster(rules('Hold Person'), { ...base, turn: { bonus: true, slot: false } }, true))).toEqual(['red'])
    expect(levels(checkCaster(rules('Hold Person'), { ...base, concentrating: 'Bless' }, true))).toEqual(['yellow'])
  })
})

const info = (actions: CombatantInfo['actions'], extra: Partial<CombatantInfo> = {}) => ({ actions, slots: slotState({ spell_slots: [2] }), resist: '', immune: '', vuln: '', ...extra }) as CombatantInfo
const fight = (): CombatState => ({
  round: 1, turn: 0, log: [], effects: [],
  combatants: [newCombatant({ id: 'r', entityId: 'r', name: 'Raph', side: 'party', hp: 30, maxHp: 30, ac: '17' }), newCombatant({ id: 'g', entityId: 'g', name: 'Goblin', side: 'foe', hp: 10, maxHp: 10, ac: '15' }), newCombatant({ id: 'h', entityId: 'h', name: 'Hobgoblin', side: 'foe', hp: 20, maxHp: 20, ac: '18' })]
})

describe('the cast', () => {
  it('damage on a failed save, half on a success, conditions, concentration, the log', () => {
    const s = applyCast(fight(), {
      casterId: 'r', spell: 'Test', rules: { ...rules('Thunderwave'), concentration: true, conditions: ['Prone'] }, how: 'level 1 slot', usesSlot: true,
      targets: [{ id: 'g', outcome: 'failed', conditions: ['Prone'] }, { id: 'h', outcome: 'saved', conditions: ['Prone'] }], amount: 9, damageType: 'thunder', overrides: ['Goblin: too big']
    }, { h: info([], { resist: 'thunder' }) })
    expect(s.combatants.map((c) => c.hp)).toEqual([30, 1, 18])
    expect(s.combatants[1].conditions).toEqual([{ name: 'Prone', rounds: null, src: 'r:Test' }])
    expect(s.combatants[2].conditions).toEqual([])
    expect(s.combatants[0]).toMatchObject({ conc: 'Test', cast: { round: 1, bonus: false, slot: true } })
    expect(s.log.at(-1)).toBe('Round 1: Raph casts Test (level 1 slot) on Goblin (failed the save, 9 thunder damage, prone), Hobgoblin (saved, 2 thunder damage). Cast despite: Goblin: too big')
    const after = endConcentration(s, 'r')
    expect(after.combatants[1].conditions).toEqual([])
    expect(after.combatants[0].conditions.some((k) => k.name === 'Concentrating')).toBe(false)
  })
  it('a hit that takes reactions away; healing', () => {
    const shock: SpellRules = { ...rules('Shocking Grasp'), noReactions: true }
    const s = applyCast(fight(), { casterId: 'r', spell: 'Shocking Grasp', rules: shock, how: 'cantrip', usesSlot: false, targets: [{ id: 'g', outcome: 'hit', conditions: [] }], amount: 5, damageType: 'lightning', overrides: [] })
    expect(s.combatants[1]).toMatchObject({ hp: 5, conditions: [{ name: 'No reactions', rounds: 1 }] })
    const healed = applyCast(s, { casterId: 'r', spell: 'Cure Wounds', rules: rules('Cure Wounds'), how: 'level 1 slot', usesSlot: true, targets: [{ id: 'g', outcome: 'auto', conditions: [] }], amount: 4, damageType: '', overrides: [] })
    expect(healed.combatants[1].hp).toBe(9)
  })
})

describe('reactions', () => {
  it('knows when common reactions fire', () => {
    expect(reactionTriggers('Parry', 'The captain adds 2 to its AC against one melee attack that would hit it.')?.on).toEqual(['melee'])
    expect(reactionTriggers('Protective Magic', 'The archmage casts Counterspell or Shield in response to the spell\'s trigger')?.on).toEqual(['attack', 'spell'])
    expect(reactionTriggers('Absorb Elements', '')).toEqual({ on: ['damage'], types: ['acid', 'cold', 'fire', 'lightning', 'thunder'] })
    expect(reactionTriggers('Odd Trick', 'It hums.')).toBeNull()
  })
  it('offers those that fit, ready or not', () => {
    const s = fight()
    const parry = { name: 'Parry', kind: 'REACTION', text: 'adds 2 to its AC against one melee attack that would hit it.' }
    const absorb = { name: 'Absorb Elements', kind: 'SPELL', text: 'Level 1 Abjuration, 1 Reaction, Self.' }
    const of = (n: string, t: string) => spellRulesFor(n, t, {}, spells).rules
    expect(reactionOptions(s, s.combatants[1], info([parry]), rules('Shocking Grasp'), of).map((o) => [o.name, o.ready])).toEqual([['Parry', true]])
    expect(reactionOptions(s, s.combatants[1], info([parry]), rules('Fire Bolt'), of)).toEqual([])
    expect(reactionOptions(s, s.combatants[0], info([absorb]), rules('Fire Bolt'), of)).toMatchObject([{ name: 'Absorb Elements', ready: true, level: 1 }])
    const used = { ...s, combatants: s.combatants.map((c) => (c.id === 'g' ? { ...c, rounds: { 1: { dmg: 0, heal: 0, r: true, c: false } } } : c)) }
    expect(reactionOptions(used, used.combatants[1], info([parry]), rules('Shocking Grasp'), of)[0]).toMatchObject({ ready: false, why: 'Reaction already used this round.' })
  })
})
