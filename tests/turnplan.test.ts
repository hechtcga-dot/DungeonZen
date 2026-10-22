import { describe, expect, it } from 'vitest'
import srd from '../resources/srd/srd-2024-attacks.json'
import type { SrdAttacks } from '../src/shared/attacks'
import { newCombatant, type CombatantInfo, type CombatState } from '../src/shared/combat'
import { slotState } from '../src/shared/slots'
import { spellRulesFor } from '../src/shared/spellcast'
import { groupActions, likelyThisTurn } from '../src/shared/turnplan'

const rulesOf = (n: string, t: string) => spellRulesFor(n, t, {}, (srd as SrdAttacks).spells).rules
const a = (name: string, kind: string, text: string) => ({ name, kind, text })
// Raph's options (owner's screenshot, 2026-10-21).
const raph = {
  creatureType: 'Tortle', size: 'Medium', resist: '', immune: '', vuln: '', condImmune: '', magicResist: false, limited: [], actionGroups: {},
  slots: slotState({ spell_slots: [4, 3, 3, 3, 1], slots_used: [0, 3] }),
  actions: [
    a('Dagger', 'ACTION', 'Ranged or Melee Attack Roll: +5, range 20/60 ft., reach 5 ft. 1d4 + 1 Piercing damage.'),
    a('Shell Defense: Withdraw', 'ACTION', 'Withdraw into your shell. Gain +4 AC and Advantage on STR and CON saving throws. You are Prone, speed becomes 0.'),
    a('Convert Sorcery Points', 'BONUS_ACTION', 'Gain additional spell slots by spending sorcery points, or sacrifice spell slots to regain sorcery points.'),
    a('Fire Bolt', 'SPELL', 'Cantrip Evocation, 1 Action, Range 120 ft., Spell Attack +12, 2d10 Fire damage.'),
    a('Hold Person', 'SPELL', 'Level 2 Enchantment · action · 60 feet · V, S, M · Concentration, 1 minute. Wisdom Saving Throw: DC 20'),
    a('Fireball', 'SPELL', 'Level 3 Evocation · action · 150 feet. Dexterity Saving Throw: DC 20. 8d6 Fire damage. A bright streak flashes to a point and explodes in a 20 ft radius sphere.'),
    a('Absorb Elements', 'SPELL', 'Level 1 Abjuration, 1 Reaction, Self. Grants resistance to incoming elemental damage.'),
    a('Detect Magic', 'SPELL', 'Level 1 Divination, 1 Action, Self, Concentration 10 min. Senses the presence of magic within 30 ft.'),
    a('Shape Water', 'SPELL', 'Cantrip Transmutation, 1 Action, Range 30 ft., Utility / Control. Manipulates an area of water.')
  ]
} as unknown as CombatantInfo

describe('turn panel groups', () => {
  it('puts combat first (spells with a slot, then cantrips and attacks), situational and out of combat apart', () => {
    const g = groupActions(raph, rulesOf, {})
    // Level 2 slots are used up, but Hold Person can go in a higher slot.
    expect(g.combat.map((x) => x.name)).toEqual(['Fireball', 'Hold Person', 'Fire Bolt', 'Dagger'])
    const spent = groupActions({ ...raph, slots: slotState({ spell_slots: [4, 3, 3, 3, 1], slots_used: [0, 3, 3, 3, 1] }) }, rulesOf, {})
    expect(spent.combat.map((x) => `${x.name}${x.noSlot ? ' (no slot)' : ''}`)).toEqual(['Fire Bolt', 'Dagger', 'Fireball (no slot)', 'Hold Person (no slot)'])
    expect(g.situational.map((x) => x.name).sort()).toEqual(['Absorb Elements', 'Convert Sorcery Points', 'Shell Defense: Withdraw'])
    expect(g.other.map((x) => x.name).sort()).toEqual(['Detect Magic', 'Shape Water'])
  })
  it('keeps the DM\'s own group', () => {
    expect(groupActions(raph, rulesOf, { 'Shape Water': 'combat' }).combat.map((x) => x.name)).toContain('Shape Water')
  })
})

describe('likely this turn', () => {
  it('the best option at a legal target, Bloodied first; a concentration spell when not concentrating', () => {
    const s: CombatState = {
      round: 1, turn: 0, log: [], effects: [], combatants: [
        newCombatant({ id: 'r', entityId: 'r', name: 'Raph', side: 'party', hp: 65, maxHp: 65, ac: '18' }),
        newCombatant({ id: 'g', entityId: 'g', name: 'Goblin', side: 'foe', hp: 4, maxHp: 10, ac: '15' }),
        newCombatant({ id: 'k', entityId: 'k', name: 'Knight', side: 'foe', hp: 52, maxHp: 52, ac: '18' })
      ]
    }
    const info = { r: raph, g: { creatureType: 'fey', size: 'Small' }, k: { creatureType: 'humanoid', size: 'Medium' } } as unknown as Record<string, CombatantInfo>
    const lines = likelyThisTurn(s, s.combatants[0], raph, info, rulesOf, {})
    // The goblin is Fey: Hold Person goes to the Knight (Humanoid).
    expect(lines).toEqual(['Fireball → Goblin (AC 15, Bloodied, 4/10 HP): level 3 slot.', 'Hold Person → Knight (AC 18, 52/52 HP): level 2 slot, not concentrating now.'])
    const busy = { ...s.combatants[0], conc: 'Bless' }
    expect(likelyThisTurn(s, busy, raph, info, rulesOf, {})[1]).toBe('Fire Bolt → Goblin (AC 15, Bloodied, 4/10 HP).')
    const hurt = { ...s.combatants[0], hp: 20 }
    expect(likelyThisTurn(s, hurt, raph, info, rulesOf, {}).at(-1)).toBe('Bloodied (20/65 HP): Shell Defense: Withdraw?')
  })
})

describe('most damage or disruption first (owner, 2026-10-22)', () => {
  it('a self buff is no attack; three darts count three times; Fire Bolt beats a slot spell that only helps', () => {
    const r2 = {
      ...raph, slots: slotState({ spell_slots: [4, 3, 3, 3, 1], slots_used: [0, 0, 3, 3, 1] }),
      actions: [
        a('See Invisibility', 'SPELL', 'Level 2 Divination, 1 Action, Self, Duration 1 hr. See invisible creatures and objects as if they were visible.'),
        a('Magic Missile', 'SPELL', 'Level 1 Evocation, 1 Action, Range 120 ft., 1d4+1 Force damage x 3. Creates three magical darts that automatically hit targets.'),
        a('Gust Barrier', 'SPELL', 'Cantrip Evocation, 1 Action, Self, CON Save DC 20, Prone / Push. Creates a whirling barrier of air around self for 1 round.'),
        a('Fire Bolt', 'SPELL', 'Cantrip Evocation, 1 Action, Range 120 ft., Spell Attack +12, 2d10 Fire damage. Hits a target with a beam of fire.'),
        a('Dagger', 'ACTION', 'Ranged or Melee Attack Roll: +5, range 20/60 ft., reach 5 ft. 1d4 + 1 Piercing damage.')
      ]
    } as unknown as CombatantInfo
    const g = groupActions(r2, rulesOf, {})
    expect(g.combat.map((x) => x.name)).toEqual(['Magic Missile', 'Fire Bolt', 'Gust Barrier', 'Dagger'])
    expect(g.combat.map((x) => x.name)).not.toContain('See Invisibility')
  })
})
