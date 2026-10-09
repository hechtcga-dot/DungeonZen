// Notes › a character sheet file › Make a character card: the AI copies one or more files
// (the sheet, background, notes) into a PC card's stat block, attacks and spells, and text
// fields. Pure: builds the request and reads the answer. Nothing changes until the DM ticks
// what to keep (rules 2, 10).

import { extractJson } from '../importers/notes'
import { parseStatBlock, type StatBlockAnswer } from './statblock'
import { AbilityKind } from '../../shared/schemas'
import { classesOf, type ClassLevel } from '../../shared/charsheet'

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
  '"saves":"only proficient saving throws with the total bonus, e.g. Wis +5, Cha +11","skills":"only proficient or expert skills with the total bonus, e.g. Deception +11, Perception +9",',
  '"vulnerabilities","resistances","immunities","conditionImmunities","senses":"e.g. darkvision 60 ft., passive Perception 19","languages","cr":"","traits":[{"name","desc"}]},',
  '"classes":[{"name":"Bard","subclass":"College of Lore","level":7}],"save_notes":"e.g. advantage on Constitution saves to keep concentration",',
  '"proficiencies":"armor, weapons and tools, e.g. Light armor; simple weapons, rapiers; lute, thieves\' tools","spell_ability":"str|dex|con|int|wis|cha or empty","prepared":["names of prepared spells"],',
  '"actions":[{"name","kind":"ACTION|BONUS_ACTION|REACTION|SPELL|OTHER","desc"}],',
  '"fields":{"summary":"species, class and level in one line","motivation","gender","age","height","weight","eyes","hair","skin","faith","appearance","personality","ideals","bonds","flaws","background","bio","notes":"equipment, money, allies, anything else worth keeping"}}.',
  'traits: class features, species traits and feats, each with a short description.',
  'actions: every weapon attack with its to-hit and damage (e.g. "Melee Attack Roll: +5, reach 5 ft. 6 (1d6 + 3) Piercing damage."), other actions and bonus actions,',
  'and every spell known or prepared as kind SPELL (desc starts with "Cantrip" or "Level N", then the school, casting time, range, to-hit or save DC and damage, and the effect in one or two sentences).',
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
    spellAbility: ['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(String(raw.spell_ability)) ? String(raw.spell_ability) : null,
    prepared: (Array.isArray(raw.prepared) ? raw.prepared : []).map((n) => String(n).trim().slice(0, 120)).filter(Boolean).slice(0, 80)
  }
}
