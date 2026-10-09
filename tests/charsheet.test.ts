import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { charSheetPrompt, parseCharSheet } from '../src/main/ai/charsheet'
import { emptyStatBlock, profFor, rebase, setListed, skillBonus } from '../src/shared/statblock'
import { buildAttack, cantripDice, macroFor, spellLevel, spellSpec, weaponSpec, type SrdSpell } from '../src/shared/attacks'
import srd from '../resources/srd/srd-2024-attacks.json'

let dir: string
let c: Campaign
let g: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Sheet test'), 'Sheet test')
  g = c.info().globalBoardId
})
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

const REPLY = JSON.stringify({
  name: 'Flor "The Songbird" Nightingale', level: '15', current_hp: 77, spell_slots: [4, 3, 3, 3, 2, 1, 1, 1, 0],
  statblock: { size: 'Medium', creatureType: 'humanoid (half-elf)', ac: '15', hp: '78', speed: '30 ft.', str: 8, dex: 14, con: 10, int: 10, wis: 18, cha: 20, saves: 'Wis +5, Cha +11', skills: 'Deception +11', senses: 'darkvision 120 ft.', languages: 'Common, Elvish', traits: [{ name: 'Fey Ancestry', desc: 'Advantage vs charmed.' }] },
  actions: [{ name: 'Rapier', kind: 'ACTION', desc: 'Melee Attack Roll: +7, reach 5 ft. 6 (1d8 + 2) Piercing damage.' }, { name: 'Eldritch Blast', kind: 'SPELL', desc: 'Cantrip Evocation' }, { name: 'Healing Word', kind: 'SPELL', desc: 'Level 1 Evocation' }],
  fields: { summary: 'Half-elf bard 7 / warlock 8', personality: 'Sings at every chance', bogus: 'x' },
  proficiencies: 'Light armor; rapiers; lute', spell_ability: 'cha', prepared: ['Healing Word']
})

describe('character sheet from notes', () => {
  it('reads the AI answer', () => {
    const a = parseCharSheet(REPLY)
    expect(a.level).toBe('15')
    expect(a.currentHp).toBe(77)
    expect(a.statblock.cha).toBe(20)
    expect(a.actions.map((x) => x.kind)).toEqual(['ACTION', 'SPELL', 'SPELL'])
    expect(a.fields).toEqual({ summary: 'Half-elf bard 7 / warlock 8', personality: 'Sings at every chance', proficiencies: 'Light armor; rapiers; lute' })
    expect(a.spellAbility).toBe('cha')
    expect(charSheetPrompt([{ title: 'Sheet', lines: ['AC 15'] }, { title: 'Background', lines: ['Born in a tavern'] }])).toMatch(/File: Sheet[\s\S]*File: Background/)
  })

  it('makes a new PC card in one undo step, prepared spells ticked', () => {
    const a = parseCharSheet(REPLY)
    const id = c.applyCharSheet({ entityId: null, ...a, source: 'Test AI', fields: a.fields })
    const s = c.sheet(id)
    expect(s.entity.type).toBe('PC')
    expect(s.entity.attributes.level).toBe('15')
    expect(s.entity.attributes.current_hp).toBe(77)
    expect(s.entity.attributes.spell_ability).toBe('cha')
    expect(s.abilities).toHaveLength(3)
    expect(s.entity.attributes.prepared).toEqual([s.abilities.find((x) => x.name === 'Healing Word')!.id])
    c.undo()
    expect(c.importTargets().some((t) => t.id === id)).toBe(false)
  })

  it('fills an existing card; old actions go to History', () => {
    const pc = c.createEntity({ boardId: g, type: 'PC', name: 'Flor', position: { x: 0, y: 0 }, abilities: [{ name: 'Old punch' }] })
    const a = parseCharSheet(REPLY)
    c.applyCharSheet({ entityId: pc.id, ...a, source: 'Test AI', level: null, currentHp: null, fields: { appearance: 'Tall' } })
    const s = c.sheet(pc.id)
    expect(s.abilities.map((x) => x.name)).not.toContain('Old punch')
    expect(s.entity.attributes.appearance).toBe('Tall')
    expect(s.entity.attributes.level).toBeUndefined()
    expect(s.entity.name).toBe('Flor')
  })
})

describe('linked sheet numbers', () => {
  it('sets and removes listed saves and skills', () => {
    expect(setListed('Str +7, Con +9', 'Dex', 4)).toBe('Str +7, Con +9, Dex +4')
    expect(setListed('Strength +7, Con +9', 'Str', null)).toBe('Con +9')
    expect(setListed('Stealth +6', 'Stealth', 8)).toBe('Stealth +8')
  })

  it('moves proficient and expert bonuses with scores and the proficiency bonus', () => {
    const before = { ...emptyStatBlock(), dex: 14, saves: 'Dex +4', skills: 'Stealth +6, Acrobatics +4, Sleight of Hand +3' }
    const after = { ...before, dex: 16 }
    expect(rebase(before, 2, after, 2)).toEqual({ saves: 'Dex +5', skills: 'Stealth +7, Acrobatics +5, Sleight of Hand +4' })
    expect(rebase(before, 2, before, 3).skills).toBe('Stealth +8, Acrobatics +5, Sleight of Hand +3')
    expect(skillBonus(after, 'Stealth', 'dex').proficient).toBe(true)
  })

  it('uses the DM\'s own proficiency bonus over the level', () => {
    expect(profFor('PC', { level: '9' }, emptyStatBlock()).prof).toBe(4)
    expect(profFor('PC', { level: '9', prof_bonus: 6 }, emptyStatBlock())).toEqual({ prof: 6, auto: 4, own: 6 })
  })
})

describe('attacks and spells', () => {
  const sb = { ...emptyStatBlock(), str: 8, dex: 16, cha: 18 }
  it('makes an SRD weapon attack with a macro', () => {
    const rapier = srd.weapons.find((w) => w.name === 'Rapier')!
    const a = buildAttack(weaponSpec(rapier, sb, 3, { proficient: true, magic: 1 }))
    expect(a.name).toBe('Rapier +1')
    expect(a.description).toMatch(/^Melee Attack Roll: \+7, reach 5 ft\. Hit: 8 \(1d8 \+ 4\) Piercing damage\./)
    expect(a.macroText).toContain('{{attack=[[1d20+7]]}} {{damage=[[1d8+4]] piercing}}')
    expect(macroFor({ ...a, macroText: '' })).toContain('{{attack=[[1d20+7]]}} {{damage=[[1d8+4]] piercing}}')
  })

  it('makes SRD spells with the caster\'s numbers', () => {
    const spells = srd.spells as SrdSpell[]
    const fireball = buildAttack(spellSpec(spells.find((s) => s.name === 'Fireball')!, 4, 3, 9))
    expect(fireball.kind).toBe('SPELL')
    expect(spellLevel(fireball.description)).toBe(3)
    expect(fireball.macroText).toContain('{{save=DC 15 Dex}}')
    const bolt = spells.find((s) => s.name === 'Fire Bolt')!
    expect(cantripDice(bolt, 11)).toBe('3d10')
    const b = buildAttack(spellSpec(bolt, 4, 3, 11))
    expect(spellLevel(b.description)).toBe(0)
    expect(b.macroText).toContain('{{attack=[[1d20+7]]}} {{damage=[[3d10]] fire}}')
  })

  it('makes the DM\'s own attack and adds several in one undo step', () => {
    const a = buildAttack({ name: 'Tail', kind: 'ACTION', toHit: 5, reach: 'reach 10 ft.', save: null, damage: [{ dice: '2d6', bonus: 3, type: 'Bludgeoning' }], note: '' })
    expect(a.description).toBe('Melee Attack Roll: +5, reach 10 ft. Hit: 10 (2d6 + 3) Bludgeoning damage.')
    const pc = c.createEntity({ boardId: g, type: 'PC', name: 'Raph', position: { x: 0, y: 0 } })
    expect(c.addAbilities(pc.id, [a, { ...a, name: 'Bite' }])).toBe(2)
    expect(c.sheet(pc.id).abilities).toHaveLength(2)
    c.undo()
    expect(c.sheet(pc.id).abilities).toHaveLength(0)
  })
})
