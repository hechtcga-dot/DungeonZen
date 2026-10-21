// Spell rule fields from the writing AI (owner, 3.5.0): for spells the SRD does not have, e.g. from
// another book. Pure: builds the request and reads the answer. Shown as an AI suggestion; nothing is
// kept until the DM presses Keep (rules 2, 10).

import { CONDITIONS, DAMAGE_TYPES } from '../../shared/combat'
import { CREATURE_TYPES, SIZES, SpellRules, textSpellRules } from '../../shared/spellcast'
import { extractJson } from '../importers/notes'

export const SPELL_RULES_SYSTEM = [
  'You read a Dungeons & Dragons 5e spell (2024 rules where they differ) and fill the fields a combat tracker checks.',
  'Reply with ONE JSON object and nothing else, with these keys:',
  '"level" (0 for a cantrip), "time" ("action", "bonus", "reaction" or "other"), "attack" ("", "melee" or "ranged": a spell attack roll),',
  '"save" ("" or STR, DEX, CON, INT, WIS, CHA), "halfOnSave" (true when a success still takes half damage),',
  `"damage" (damage types, lower case, from: ${DAMAGE_TYPES.join(', ')}), "heal" (true when it restores hit points),`,
  `"conditions" (conditions it gives on a hit or failed save, from: ${CONDITIONS.filter((c) => !['Concentrating', 'Bloodied'].includes(c)).join(', ')}),`,
  `"types" (creature types it only works on, empty when any, from: ${CREATURE_TYPES.join(', ')}), "notTypes" (types it has no effect on),`,
  `"maxSize" ("" or the largest size it works on: ${SIZES.join(', ')}), "sizeAll" (true when a bigger creature is not affected at all, false when only part of it fails, such as a push),`,
  '"verbal", "somatic", "material" (components), "concentration", "rounds" (how long its conditions last in rounds: 1 minute = 10, null when instantaneous or until removed),',
  '"noReactions" (true when a hit stops the target taking reactions), "trigger" (reaction spells: when it is cast, else "").',
  'Use only what the spell says or what the published spell of that name does.'
].join(' ')

export function spellRulesPrompt(name: string, description: string): string {
  return `Spell: ${name}\nAs written on the character sheet: ${description.slice(0, 4000) || '(nothing written)'}`
}

/** Reads the reply field by field: a field that does not fit keeps what the spell text gives. */
export function parseSpellRules(reply: string, description: string): SpellRules {
  const raw = extractJson(reply) as Record<string, unknown>
  const base = textSpellRules(description)
  const out: Record<string, unknown> = { ...base }
  const shape = SpellRules.shape as Record<string, { safeParse(v: unknown): { success: boolean; data?: unknown } }>
  for (const k of Object.keys(shape)) {
    let v = raw?.[k]
    if (k === 'save' && typeof v === 'string') v = v.slice(0, 3).toUpperCase()
    if ((k === 'damage') && Array.isArray(v)) v = v.map((x) => String(x).toLowerCase())
    if ((k === 'conditions' || k === 'types' || k === 'notTypes') && Array.isArray(v)) v = v.map((x) => String(x).charAt(0).toUpperCase() + String(x).slice(1).toLowerCase())
    if (k === 'maxSize' && typeof v === 'string' && v) v = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase()
    const r = shape[k].safeParse(v)
    if (r.success) out[k] = r.data
  }
  return SpellRules.parse(out)
}
