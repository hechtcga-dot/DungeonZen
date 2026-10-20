// Notes › a character sheet file › Make a character card: the AI copies one or more files
// (the sheet, background, notes) into a PC card's stat block, attacks and spells, and text
// fields. Pure: builds the request and reads the answer. Nothing changes until the DM ticks
// what to keep (rules 2, 10).

import { extractJson } from '../importers/notes'
import { parseStatBlock, type StatBlockAnswer } from './statblock'
import { AbilityKind } from '../../shared/schemas'
import { classesOf, usesOf, type ClassLevel } from '../../shared/charsheet'
import { abilityModifier, castingAbility, formatModifier, proficiencyBonus, SKILLS } from '../../shared/statblock'

/** Text fields the AI copies, in sheet order ("notes" are the DM notes). */
export const CHAR_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'summary', label: 'One-line summary' }, { key: 'motivation', label: 'Motivation' },
  { key: 'gender', label: 'Gender' }, { key: 'age', label: 'Age' }, { key: 'height', label: 'Height' }, { key: 'weight', label: 'Weight' },
  { key: 'eyes', label: 'Eyes' }, { key: 'hair', label: 'Hair' }, { key: 'skin', label: 'Skin' }, { key: 'faith', label: 'Faith' },
  { key: 'appearance', label: 'Appearance' }, { key: 'personality', label: 'Personality' }, { key: 'ideals', label: 'Ideals' },
  { key: 'bonds', label: 'Bonds' }, { key: 'flaws', label: 'Flaws' }, { key: 'background', label: 'Background' },
  { key: 'bio', label: 'Bio' }, { key: 'proficiencies', label: 'Armor, weapons, tools' }, { key: 'notes', label: 'DM notes' }
]

export const CHARSHEET_SYSTEM = [
  'You copy a Dungeons & Dragons 5e player character sheet into a campaign card for a Dungeon Master.',
  'The sheet may come as several files (the main sheet, a background, notes). Copy, never invent: leave a field empty ("" or null) when the files do not say it.',
  'Reply with ONE JSON object and nothing else:',
  '{"name":"","level":"total character level, e.g. 15","current_hp":number or null,"spell_slots":[9 whole numbers: most slots for spell levels 1 to 9, 0 when none; Pact Magic slots count at their level],',
  '"statblock":{"size","creatureType":"e.g. humanoid (half-elf)","alignment","ac","acDetail":"armor worn","hp":"maximum hit points","hitDice","speed","str","dex","con","int","wis","cha",',
  '"saves":"every saving throw whose total is not just the ability modifier, with the total exactly as the sheet gives it, e.g. Str +1, Wis +5, Cha +11",',
  '"skills":"every skill whose total is not just the ability modifier (proficient, expertise or other bonuses), total exactly as on the sheet, e.g. Deception +11, Perception +9",',
  '"vulnerabilities","resistances","immunities","conditionImmunities","senses":"e.g. darkvision 60 ft., passive Perception 19","languages","cr":"","traits":[{"name","desc"}]},',
  '"classes":[{"name":"Bard","subclass":"College of Lore","level":7}],"save_notes":"e.g. advantage on Constitution saves to keep concentration",',
  '"proficiencies":"armor, weapons and tools, e.g. Light armor; simple weapons, rapiers; lute, thieves\' tools","spell_ability":"str|dex|con|int|wis|cha or empty","prepared":["names of prepared spells"],',
  '"actions":[{"name","kind":"ACTION|BONUS_ACTION|REACTION|SPELL|OTHER","desc"}],',
  '"inspiration":true when Heroic Inspiration is available, else false,"uses":[{"name":"e.g. Sorcery Points","max":9,"used":1,"reset":"short|long"}],',
  '"skill_adv":{"Stealth":"A"} (A = advantage, D = disadvantage on that skill always),"initiative":"+1","prof_bonus":number or null,',
  '"spell_save_dc":number or null,"spell_attack":number or null,"temp_hp":number or null,"xp":number or null,"exhaustion":number or null,',
  '"fields":{"summary":"species, class and level in one line","motivation","gender","age","height","weight","eyes","hair","skin","faith","appearance","personality","ideals","bonds","flaws","background","bio","notes":"equipment, money, allies, anything else worth keeping"}}.',
  'Copy the sheet one to one: every number as the sheet gives it (do not recompute it), every attack, spell, feature, trait and feat.',
  'traits: class features, species traits and feats that are not used as an action, bonus action or reaction, each with its full description.',
  'actions: every weapon and natural attack with its to-hit, range and damage, properties after (e.g. "Melee Attack Roll: +5, reach 5 ft. 6 (1d6 + 3) Piercing damage. Finesse, Light."),',
  'every feature used as an action, bonus action or reaction (kind ACTION, BONUS_ACTION or REACTION, full description),',
  'and every spell known or prepared as kind SPELL, once each even when the sheet also lists it as an attack. A spell desc reads',
  '"Level 3 Evocation · 1 action · 150 feet · V, S, M · Concentration, up to 1 minute. Dexterity Saving Throw: DC 20. 8d6 Fire damage. Effect in one or two sentences."',
  '(a cantrip starts "Cantrip"; a spell attack writes "Spell Attack Roll: +12."; copy the sheet\'s notes and where the spell comes from, e.g. a feat).',
  'uses: every resource with a number of uses between rests (Sorcery Points, Bardic Inspiration, once per long rest features and feat spells), used = max minus what the sheet says is left.',
  'spell_slots: from the sheet; when it gives none, the 2024 class table for the caster levels.',
  'save_notes: advantage, disadvantage and other notes on saving throws. senses: with every passive score the sheet gives.',
  'Ability scores are whole numbers 1 to 30.'
].join(' ')

/** Each file's text under its title, cut to fit one request. */
export function charSheetPrompt(files: Array<{ title: string; lines: string[] }>): string {
  const each = Math.floor(60000 / Math.max(1, files.length))
  return files.map((f) => `--- File: ${f.title} ---\n${f.lines.join('\n').slice(0, each)}`).join('\n\n')
}

export interface CharSheetAnswer extends StatBlockAnswer {
  name: string
  level: string
  currentHp: number | null
  spellSlots: number[] | null
  fields: Record<string, string>
  spellAbility: string | null
  classes: ClassLevel[]
  saveNotes: string
  /** Names of prepared spells. */
  prepared: string[]
  /** More of the sheet, as card attributes (only what differs from what the card works out itself). */
  attrs: Record<string, unknown>
}


const KINDS = new Set<string>(AbilityKind.options)

/** Reads the reply; a near miss still works (scores clamped, text cut, unknown kinds become actions). */
export function parseCharSheet(reply: string): CharSheetAnswer {
  const raw = extractJson(reply) as Record<string, unknown>
  const { statblock } = parseStatBlock(reply)
  const actions = (Array.isArray(raw.actions) ? raw.actions : []).slice(0, 80)
    .map((a: { name?: unknown; kind?: unknown; desc?: unknown }) => ({
      name: String(a?.name ?? '').trim().slice(0, 120),
      kind: (KINDS.has(String(a?.kind)) ? String(a?.kind) : 'ACTION') as AbilityKind,
      description: String(a?.desc ?? '').slice(0, 5000)
    }))
    .filter((a) => a.name)
  const inFields = (raw.fields && typeof raw.fields === 'object' ? raw.fields : {}) as Record<string, unknown>
  const fields: Record<string, string> = {}
  for (const { key } of CHAR_FIELDS) {
    const v = key === 'proficiencies' ? raw.proficiencies : inFields[key]
    if (typeof v === 'string' && v.trim()) fields[key] = v.trim().slice(0, 20000)
  }
  const hp = Math.round(Number(raw.current_hp))
  const num = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(String(v).replace('−', '-'))) ? Math.round(Number(String(v).replace('−', '-'))) : null)
  // Only what the card would not work out itself: a proficiency bonus off the level, an initiative off Dexterity, a spell DC off the casting ability.
  const level = Number.parseInt(String(raw.level ?? ''), 10)
  const autoProf = level > 0 ? proficiencyBonus(level) : null
  const ownProf = num(raw.prof_bonus)
  const prof = ownProf ?? autoProf
  const attrs: Record<string, unknown> = {}
  if (typeof raw.inspiration === 'boolean') attrs.inspiration = raw.inspiration
  const uses = usesOf({ uses: raw.uses }).filter((u) => u.name.trim() && u.max > 0).slice(0, 20)
  if (uses.length) attrs.uses = uses
  const adv = Object.fromEntries(Object.entries(raw.skill_adv && typeof raw.skill_adv === 'object' ? raw.skill_adv as Record<string, unknown> : {})
    .flatMap(([k, v]) => { const s = SKILLS.find(([n]) => n.toLowerCase() === k.trim().toLowerCase()); return s && (v === 'A' || v === 'D') ? [[s[0], v]] : [] }))
  if (Object.keys(adv).length) attrs.skill_adv = adv
  const init = num(raw.initiative)
  if (init !== null && init !== abilityModifier(statblock.dex)) attrs.initiative = formatModifier(init)
  if (ownProf !== null && ownProf !== autoProf) attrs.prof_bonus = Math.max(0, Math.min(20, ownProf))
  const spellAbility = ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(String(raw.spell_ability)) ? String(raw.spell_ability) : null
  const cast = abilityModifier(statblock[castingAbility({ spell_ability: spellAbility }, statblock)])
  const dc = num(raw.spell_save_dc)
  const attack = num(raw.spell_attack)
  const bonus = prof === null ? null : dc !== null ? dc - 8 - cast - prof : attack !== null ? attack - cast - prof : null
  if (bonus) attrs.spell_bonus = Math.max(-10, Math.min(10, bonus))
  for (const k of ['temp_hp', 'xp', 'exhaustion'] as const) {
    const n = num(raw[k])
    if (n !== null && n > 0) attrs[k] = Math.min(k === 'exhaustion' ? 6 : 10_000_000, n)
  }
  const slots = Array.isArray(raw.spell_slots)
    ? Array.from({ length: 9 }, (_, k) => Math.max(0, Math.min(9, Math.round(Number((raw.spell_slots as unknown[])[k])) || 0)))
    : null
  return {
    name: String(raw.name ?? '').trim().slice(0, 200),
    level: String(raw.level ?? '').trim().slice(0, 10),
    currentHp: raw.current_hp != null && Number.isFinite(hp) && hp >= 0 ? hp : null,
    spellSlots: slots && slots.some(Boolean) ? slots : null,
    statblock, actions, fields,
    classes: classesOf({ classes: raw.classes }).filter((c) => c.name.trim()).slice(0, 6),
    saveNotes: typeof raw.save_notes === 'string' ? raw.save_notes.trim().slice(0, 500) : '',
    spellAbility, attrs,
    prepared: (Array.isArray(raw.prepared) ? raw.prepared : []).map((n) => String(n).trim().slice(0, 120)).filter(Boolean).slice(0, 80)
  }
}
