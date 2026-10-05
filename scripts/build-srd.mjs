// Builds resources/srd/srd-2024.json from the Open5e project's copy of the
// System Reference Document 5.2 (CC-BY-4.0). Run with: node scripts/build-srd.mjs
// The app ships the result, so the Library works offline (CLAUDE.md rules 1 and 8).
import { writeFileSync } from 'node:fs'

const BASE = 'https://raw.githubusercontent.com/open5e/open5e-api/staging/data/v2/wizards-of-the-coast/srd-2024/'
const get = async (name) => {
  const res = await fetch(BASE + name + '.json')
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return res.json()
}

const [creatures, actions, attacks, traits, items, magicItems] = await Promise.all(
  ['Creature', 'CreatureAction', 'CreatureActionAttack', 'CreatureTrait', 'Item', 'MagicItem'].map(get)
)

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
const SHORT = { strength: 'Str', dexterity: 'Dex', constitution: 'Con', intelligence: 'Int', wisdom: 'Wis', charisma: 'Cha' }
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`)
const words = (s) => s.split(/[-_]/).map(cap).join(' ')

function crText(raw) {
  const n = Number(raw)
  return { 0.125: '1/8', 0.25: '1/4', 0.5: '1/2' }[n] ?? String(n)
}

function speedText(f) {
  const parts = [`${f.walk ?? 0} ft.`]
  for (const k of ['burrow', 'climb', 'fly', 'swim']) if (f[k]) parts.push(`${k} ${f[k]} ft.${k === 'fly' && f.hover ? ' (hover)' : ''}`)
  return parts.join(', ')
}

function sensesText(f) {
  const parts = []
  for (const k of ['blindsight', 'darkvision', 'tremorsense', 'truesight']) if (f[`${k}_range`]) parts.push(`${k} ${f[`${k}_range`]} ft.`)
  if (f.passive_perception != null) parts.push(`Passive Perception ${f.passive_perception}`)
  return parts.join(', ')
}

const attacksByAction = new Map()
for (const a of attacks) {
  const list = attacksByAction.get(a.fields.parent) ?? []
  list.push(a.fields)
  attacksByAction.set(a.fields.parent, list)
}

function roll20Macro(name, desc, attack) {
  const parts = [`&{template:default} {{name=${name}}}`]
  if (attack) {
    parts.push(`{{attack=[[1d20${signed(attack.to_hit_mod ?? 0)}]]}}`)
    if (attack.damage_die_count) {
      const bonus = attack.damage_bonus ? signed(attack.damage_bonus) : ''
      parts.push(`{{damage=[[${attack.damage_die_count}${attack.damage_die_type.toLowerCase()}${bonus}]] ${attack.damage_type ?? ''}}}`.replace(' }}', '}}'))
    }
  }
  parts.push(`{{description=${desc.replace(/[{}]/g, '')}}}`)
  return parts.join(' ')
}

const actionsByCreature = new Map()
for (const a of actions) {
  const f = a.fields
  const list = actionsByCreature.get(f.parent) ?? []
  const attack = (attacksByAction.get(a.pk) ?? [])[0]
  list.push({
    order: f.order_in_statblock ?? 99,
    name: f.name,
    kind: f.action_type,
    desc: f.desc,
    macro: roll20Macro(f.name, f.desc, attack)
  })
  actionsByCreature.set(f.parent, list)
}

const traitsByCreature = new Map()
for (const t of traits) {
  const list = traitsByCreature.get(t.fields.parent) ?? []
  list.push({ name: t.fields.name, desc: t.fields.desc })
  traitsByCreature.set(t.fields.parent, list)
}

const monsters = creatures.map(({ pk, fields: f }) => ({
  key: pk,
  name: f.name,
  statblock: {
    size: cap(f.size ?? ''),
    creatureType: f.type ?? '',
    alignment: f.alignment ?? '',
    ac: String(f.armor_class ?? ''),
    acDetail: f.armor_detail ?? '',
    hp: String(f.hit_points ?? ''),
    hitDice: f.hit_dice ?? '',
    speed: speedText(f),
    str: f.ability_score_strength, dex: f.ability_score_dexterity, con: f.ability_score_constitution,
    int: f.ability_score_intelligence, wis: f.ability_score_wisdom, cha: f.ability_score_charisma,
    saves: ABILITIES.filter((a) => f[`saving_throw_${a}`] != null)
      .map((a) => `${SHORT[a]} ${signed(f[`saving_throw_${a}`])}`).join(', '),
    skills: Object.keys(f).filter((k) => k.startsWith('skill_bonus_') && f[k] != null)
      .map((k) => `${words(k.slice('skill_bonus_'.length))} ${signed(f[k])}`).join(', '),
    vulnerabilities: f.damage_vulnerabilities_display ?? '',
    resistances: f.damage_resistances_display ?? '',
    immunities: f.damage_immunities_display ?? '',
    conditionImmunities: f.condition_immunities_display ?? '',
    senses: sensesText(f),
    languages: f.languages_desc ?? '',
    cr: crText(f.challenge_rating),
    traits: traitsByCreature.get(pk) ?? []
  },
  actions: (actionsByCreature.get(pk) ?? []).sort((a, b) => a.order - b.order).map(({ order, ...rest }) => rest)
})).sort((a, b) => a.name.localeCompare(b.name))

const itemList = [
  ...items.map(({ pk, fields: f }) => ({ key: pk, name: f.name, category: words(f.category ?? ''), rarity: '', magic: false, attunement: false, desc: f.desc ?? '' })),
  ...magicItems.map(({ pk, fields: f }) => ({ key: pk, name: f.name, category: words(f.category ?? ''), rarity: words(f.rarity ?? ''), magic: true, attunement: !!f.requires_attunement, desc: f.desc ?? '' }))
].sort((a, b) => a.name.localeCompare(b.name))

const out = {
  source: 'System Reference Document 5.2 (via the Open5e project)',
  license: 'CC-BY-4.0',
  attribution:
    'This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, ' +
    'available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 ' +
    'International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.',
  monsters,
  items: itemList
}
writeFileSync(new URL('../resources/srd/srd-2024.json', import.meta.url), JSON.stringify(out))
console.log(`Wrote ${monsters.length} monsters and ${itemList.length} items`)
