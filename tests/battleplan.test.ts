import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { battlePlan, spellRoles, type PlanFoe, type PlanPc } from '../src/shared/battleplan'
import { Campaign } from '../src/main/campaign/campaign'
import { srdCopy } from '../src/main/srd'
import { buildAttack, spellSpec, type SrdSpell } from '../src/shared/attacks'
import { emptyStatBlock } from '../src/shared/statblock'
import srd from '../resources/srd/srd-2024-attacks.json'

const pc = (name: string, extra: Partial<PlanPc> = {}): PlanPc => ({ name, ac: 15, hp: 30, maxHp: 30, down: false, concentrating: false, powers: [], slotsLeft: Array(9).fill(0), ...extra })
const foe = (name: string, extra: Partial<PlanFoe> = {}): PlanFoe => ({ name, count: 1, int: 10, cr: '1', ranged: false, flies: false, legendaryResist: false, leader: false, saves: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, ...extra })
const fireball = { name: 'Fireball', level: 3, roles: spellRoles('Fireball', ''), save: 'Dexterity' }

describe('battle planner', () => {
  it('knows what spells do', () => {
    expect(spellRoles('Fireball', '')).toEqual(['area'])
    expect(spellRoles('Banishment', '')).toEqual(['disable'])
    expect(spellRoles('Spike Growth', '')).toEqual(['zone'])
    expect(spellRoles('Healing Word', '')).toEqual(['heal'])
    expect(spellRoles('Tail Sweep', 'Dexterity Saving Throw: DC 15, each creature in a 15-foot Cone. Failure: 10 (3d6) damage.')).toEqual(['area'])
  })

  it('tells foes to spread out while Fireball is ready, and says when it is spent', () => {
    const goblins = foe('Goblin Warrior', { count: 4, int: 10 })
    const ready = battlePlan([pc('Flor', { powers: [fireball], slotsLeft: [4, 3, 3, 0, 0, 0, 0, 0, 0] })], [goblins])
    expect(ready.party).toEqual([{ role: 'area', text: 'Flor (Fireball)' }])
    const two = battlePlan([pc('Flor', { powers: [fireball, { ...fireball, name: 'Hypnotic Pattern' }], slotsLeft: [0, 0, 1, 0, 0, 0, 0, 0, 0] })], [goblins])
    expect(two.party[0].text).toBe('Flor (Fireball, Hypnotic Pattern)')
    expect(ready.tips[0]).toMatchObject({ kind: 'do', text: expect.stringContaining('spread out') })
    const spent = battlePlan([pc('Flor', { powers: [fireball], slotsLeft: [4, 3, 0, 0, 0, 0, 0, 0, 0] })], [goblins])
    expect(spent.party).toEqual([])
    expect(spent.tips[0].text).toMatch(/area spells are spent \(Fireball\)/)
  })

  it('protects the boss from Banishment, avoids choke points, ranks targets, notes downed characters', () => {
    const plan = battlePlan([
      pc('Mirela', { ac: 12, concentrating: true, powers: [{ name: 'Banishment', level: 4, roles: ['disable'], save: 'Charisma' }], slotsLeft: [0, 0, 0, 1, 0, 0, 0, 0, 0] }),
      pc('Kel', { powers: [{ name: 'Spike Growth', level: 2, roles: ['zone'], save: '' }, { name: 'Cure Wounds', level: 1, roles: ['heal'], save: '' }], slotsLeft: [2, 1, 0, 0, 0, 0, 0, 0, 0] }),
      pc('Raph', { down: true, hp: 0 })
    ], [foe('Ogre', { int: 5, cr: '2' }), foe('Hobgoblin Captain', { leader: true, cr: '3', ranged: true, legendaryResist: true, saves: { str: 2, dex: 1, con: 2, int: 0, wis: 1, cha: -1 } })])
    const text = plan.tips.map((t) => `${t.kind}: ${t.text}`).join('\n')
    expect(text).toMatch(/do: Protect Hobgoblin Captain.*Legendary Resistance.*weakest of those saves: Charisma \(-1\)/)
    expect(text).toMatch(/avoid: Choke points.*Spike Growth/)
    expect(text).toMatch(/do: Hobgoblin Captain can shoot from outside/)
    expect(text).toMatch(/watch: Raph is down/)
    expect(text).toMatch(/watch: Ogre: no plan/)
    expect(text).not.toMatch(/bait the counterspell/)
    const vsMage = battlePlan([pc('Mirela', { powers: [{ name: 'Counterspell', level: 3, roles: ['counter'], save: '', text: 'Reaction: stop a spell.' }], slotsLeft: [0, 0, 1, 0, 0, 0, 0, 0, 0] })], [foe('Mage', { caster: true })])
    expect(vsMage.tips.map((t) => t.text).join()).toMatch(/bait the counterspell/)
    expect(vsMage.glossary).toEqual({ Counterspell: 'Reaction: stop a spell.' })
    expect(plan.targets.map((t) => t.name)).toEqual(['Mirela', 'Kel'])
    expect(plan.targets[0].why[0]).toMatch(/concentrating/)
  })

  it('follows the running fight: slots used and characters down', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
    const c = Campaign.create(join(dir, 'Plan'), 'Plan')
    try {
      const g = c.info().globalBoardId
      const fb = buildAttack(spellSpec((srd.spells as SrdSpell[]).find((s) => s.name === 'Fireball')!, 5, 5, 15))
      const flor = c.createEntity({ boardId: g, type: 'PC', name: 'Flor', position: { x: 0, y: 0 }, attributes: { statblock: { ...emptyStatBlock(), hp: '40', ac: '15' }, spell_slots: [4, 3, 1, 0, 0, 0, 0, 0, 0] }, abilities: [fb] })
      const enc = c.createEncounter({ name: 'Mill' })
      c.addSrdToEncounter(enc, [{ key: 'srd-2024_goblin-warrior', count: 4 }], srdCopy)
      expect(c.battlePlan(enc).party.map((p) => p.role)).toEqual(['area'])
      expect(c.battlePlan(enc).tips[0].text).toMatch(/bunch of 4 ends/)
      const id = c.startCombat(enc)
      c.updateEntity(flor.id, { attributes: { slots_used: [0, 0, 1, 0, 0, 0, 0, 0, 0] } })
      expect(c.battlePlan(enc).party).toEqual([])
      expect(c.battlePlan(enc).tips[0].text).toMatch(/spent/)
      const v = c.combatView(id)
      c.updateCombat(id, { ...v.state, combatants: v.state.combatants.map((x) => (x.entityId === flor.id ? { ...x, hp: 0 } : x)) }, 'Flor drops')
      expect(c.battlePlan(enc).tips.some((t) => /Flor is down/.test(t.text))).toBe(true)
    } finally { c.close(); rmSync(dir, { recursive: true, force: true }) }
  })
})
