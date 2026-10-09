// Builds resources/srd/srd-2024-attacks.json (SRD 5.2 weapons and spells, CC-BY-4.0) from the
// Open5e project's data, for the sheet's "Add from the SRD" attacks and spells.
// Run with: node scripts/build-srd-attacks.mjs. The app ships the result (rules 1 and 8).
import { writeFileSync } from 'node:fs'

const BASE = 'https://raw.githubusercontent.com/open5e/open5e-api/staging/data/v2/wizards-of-the-coast/srd-2024/'
const get = async (name) => {
  const res = await fetch(BASE + name + '.json')
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return res.json()
}
const [weapons, props, assigns, spells] = await Promise.all(['Weapon', 'WeaponProperty', 'WeaponPropertyAssignment', 'Spell'].map(get))
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const propName = new Map(props.map((p) => [p.pk, p.fields.name]))

const out = {
  attribution: 'This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, licensed under CC-BY-4.0. Data via the Open5e project.',
  weapons: weapons.map(({ pk, fields: f }) => ({
    key: pk, name: f.name, dice: f.damage_dice, type: cap(f.damage_type), simple: f.is_simple,
    range: f.range ? `${f.range}/${f.long_range} ft.` : '',
    properties: assigns.filter((a) => a.fields.weapon === pk)
      .map((a) => `${propName.get(a.fields.property) ?? ''}${a.fields.detail ? ` (${a.fields.detail})` : ''}`).filter(Boolean)
  })).sort((a, b) => a.name.localeCompare(b.name)),
  spells: spells.map(({ pk, fields: f }) => ({
    key: pk, name: f.name, level: f.level, school: cap(f.school), time: f.casting_time.replace(/_/g, ' '), range: f.range_text ?? '',
    attack: !!f.attack_roll, save: cap(f.saving_throw_ability ?? ''), dice: f.damage_roll ?? '', types: (f.damage_types ?? []).map(cap),
    concentration: !!f.concentration, duration: f.duration ?? '', ritual: !!f.ritual,
    classes: (f.classes ?? []).map((c) => cap(c.replace(/^srd-2024_/, ''))), desc: f.desc ?? '', higher: f.higher_level ?? ''
  })).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
}
writeFileSync(new URL('../resources/srd/srd-2024-attacks.json', import.meta.url), JSON.stringify(out))
console.log(`${out.weapons.length} weapons, ${out.spells.length} spells`)
