import { abilityModifier, formatModifier, type AbilityKey, type StatBlock } from './statblock'
import type { AbilityKind } from './schemas'

// Attacks and spells for a sheet's Actions and Spells tabs: SRD weapons and spells (shipped
// in resources/srd/srd-2024-attacks.json) or the DM's own attack, made into the 2024-style
// description and a Roll20 macro with the card's numbers. Pure.

export interface SrdWeapon { key: string; name: string; dice: string; type: string; simple: boolean; range: string; properties: string[] }
export interface SrdSpell {
  key: string; name: string; level: number; school: string; time: string; range: string; attack: boolean; save: string
  dice: string; types: string[]; concentration: boolean; duration: string; ritual: boolean; classes: string[]; desc: string; higher: string
}
export interface SrdAttacks { attribution: string; weapons: SrdWeapon[]; spells: SrdSpell[] }

export interface AttackSpec {
  name: string
  kind: AbilityKind
  /** First words of the description, e.g. "Level 3 Evocation · action · 150 feet". */
  header?: string
  toHit: number | null
  /** "Melee", "Ranged", "Melee or Ranged" or "Ranged spell"; with toHit. */
  attackType?: string
  reach: string
  save: { dc: number; ability: string } | null
  damage: Array<{ dice: string; bonus: number; type: string }>
  note: string
}

const clean = (s: string) => s.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim()
const stop = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`)
const dicePart = (dice: string, bonus: number) => `${dice}${bonus ? ` ${bonus > 0 ? '+' : '−'} ${Math.abs(bonus)}` : ''}`
/** Average of "8d6" plus a bonus, rounded down; null when the dice are not NdM. */
export function average(dice: string, bonus = 0): number | null {
  const m = /^(\d+)d(\d+)$/i.exec(dice.trim())
  return m ? Math.max(0, Math.floor((Number(m[1]) * (Number(m[2]) + 1)) / 2) + bonus) : null
}

/** The 2024-style description and a Roll20 macro (template default) for an attack or spell. */
export function buildAttack(s: AttackSpec): { name: string; kind: AbilityKind; description: string; macroText: string } {
  const dmg = s.damage.filter((d) => d.dice.trim())
  const hitText = dmg.map((d) => `${average(d.dice, d.bonus) ?? '?'} (${dicePart(d.dice, d.bonus)})${d.type ? ` ${d.type}` : ''} damage`).join(' plus ')
  const parts: string[] = []
  if (s.header) parts.push(`${s.header}.`)
  if (s.toHit !== null) parts.push(`${stop(`${s.attackType ?? 'Melee'} Attack Roll: ${formatModifier(s.toHit)}${s.reach ? `, ${s.reach}` : ''}`)}${hitText ? ` Hit: ${hitText}.` : ''}`)
  else if (s.save) parts.push(`${stop(`${s.save.ability} Saving Throw: DC ${s.save.dc}${s.reach ? `, ${s.reach}` : ''}`)}${hitText ? ` Failure: ${hitText}.` : ''}`)
  else if (hitText) parts.push(`${s.reach ? `${stop(s.reach)} ` : ''}${hitText}.`)
  if (s.toHit !== null && s.save) parts.push(`${s.save.ability} Saving Throw: DC ${s.save.dc}.`)
  if (s.note.trim()) parts.push(s.note.trim())
  const macro = [`&{template:default} {{name=${clean(s.name)}}}`]
  if (s.toHit !== null) macro.push(`{{attack=[[1d20${formatModifier(s.toHit)}]]}}`)
  dmg.forEach((d, i) => macro.push(`{{${i === 0 ? 'damage' : `damage ${i + 1}`}=[[${d.dice.toLowerCase()}${d.bonus ? formatModifier(d.bonus) : ''}]]${d.type ? ` ${d.type.toLowerCase()}` : ''}}}`))
  if (s.save) macro.push(`{{save=DC ${s.save.dc} ${s.save.ability.slice(0, 3)}}}`)
  const words = clean([s.header, s.note].filter(Boolean).join('. '))
  if (words) macro.push(`{{description=${words.slice(0, 900)}}}`)
  return { name: s.name, kind: s.kind, description: parts.join(' ').slice(0, 10000), macroText: macro.join(' ') }
}

/** A weapon attack with the card's scores: Finesse uses the better of Str and Dex, Ammunition uses Dex. */
export function weaponSpec(w: SrdWeapon, sb: StatBlock, prof: number, opts: { proficient: boolean; magic: number }): AttackSpec {
  const has = (p: string) => w.properties.some((x) => x.toLowerCase().startsWith(p))
  const ranged = has('ammunition')
  const ab: AbilityKey = ranged ? 'dex' : has('finesse') && sb.dex > sb.str ? 'dex' : 'str'
  const mod = abilityModifier(sb[ab])
  const reach = ranged ? `range ${w.range}` : `reach ${has('reach') ? 10 : 5} ft.${has('thrown') && w.range ? ` or range ${w.range}` : ''}`
  return {
    name: opts.magic ? `${w.name} +${opts.magic}` : w.name, kind: 'ACTION', toHit: mod + (opts.proficient ? prof : 0) + opts.magic,
    attackType: ranged ? 'Ranged' : has('thrown') ? 'Melee or Ranged' : 'Melee', reach, save: null,
    damage: [{ dice: w.dice, bonus: mod + opts.magic, type: w.type }], note: w.properties.join(', ')
  }
}

/** Cantrip damage dice at a character level: 1d10 → 2d10 at 5, 3d10 at 11, 4d10 at 17 (when the spell says so). */
export function cantripDice(s: SrdSpell, level: number): string {
  const m = /^(\d+)d(\d+)$/.exec(s.dice)
  if (s.level !== 0 || !m || !/\b5\b.*\b11\b.*\b17\b/.test(s.higher) || /beam/i.test(s.higher)) return s.dice
  const tier = 1 + [5, 11, 17].filter((l) => level >= l).length
  return `${Number(m[1]) * tier}d${m[2]}`
}

/** A spell with the caster's numbers: attack +mod+prof, save DC 8+mod+prof. */
export function spellSpec(s: SrdSpell, castMod: number, prof: number, charLevel: number): AttackSpec {
  const header = [s.level === 0 ? `Cantrip ${s.school}` : `Level ${s.level} ${s.school}`, s.time, s.range,
    s.concentration ? `Concentration, ${s.duration}` : s.duration, s.ritual ? 'Ritual' : ''].filter(Boolean).join(' · ')
  return {
    name: s.name, kind: 'SPELL', header, toHit: s.attack ? castMod + prof : null, attackType: 'Ranged spell', reach: '',
    save: s.save ? { dc: 8 + castMod + prof, ability: s.save } : null,
    damage: s.dice ? [{ dice: cantripDice(s, charLevel), bonus: 0, type: s.types[0] ?? '' }] : [],
    note: `${s.desc}${s.higher ? ` ${s.level === 0 ? 'Cantrip upgrade' : 'Using a higher-level spell slot'}: ${s.higher}` : ''}`
  }
}

/** A spell's level from its description ("Cantrip …", "Level 3 …"); null when it does not say. */
export function spellLevel(description: string): number | null {
  const m = /^\s*(?:(cantrip)|level\s*(\d))/i.exec(description)
  return m ? (m[1] ? 0 : Number(m[2])) : null
}

/**
 * Macro text for an ability: the DM's own macro if written, otherwise one built from
 * the description ("Attack Roll: +5", "+5 to hit", "6 (1d6 + 3) Slashing damage",
 * "DC 13 Dexterity saving throw").
 */
export function macroFor(a: { name: string; description: string; macroText: string }): string {
  if (a.macroText.trim()) return a.macroText.trim()
  const d = a.description
  const parts = [`&{template:default} {{name=${clean(a.name)}}}`]
  const hit = /Attack Roll:\s*([+-]\d+)/i.exec(d) ?? /([+-]\d+)\s+to hit/i.exec(d)
  if (hit) parts.push(`{{attack=[[1d20${formatModifier(Number(hit[1]))}]]}}`)
  const dmg = [...d.matchAll(/\d+\s*\((\d+d\d+)(?:\s*([+\-−])\s*(\d+))?\)\s*([A-Za-z]+)\s+damage/gi)]
  dmg.forEach((m, i) => {
    const bonus = m[2] && m[3] ? `${m[2] === '+' ? '+' : '-'}${m[3]}` : ''
    parts.push(`{{${i === 0 ? 'damage' : `damage ${i + 1}`}=[[${m[1].toLowerCase()}${bonus}]] ${m[4].toLowerCase()}}}`)
  })
  const save = /DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+saving throw/i.exec(d)
    ?? /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Saving Throw:\s*DC\s*(\d+)/i.exec(d)
  if (save) {
    const [dc, ab] = /^\d+$/.test(save[1]) ? [save[1], save[2]] : [save[2], save[1]]
    parts.push(`{{save=DC ${dc} ${ab.slice(0, 3)}}}`)
  }
  if (d.trim()) parts.push(`{{description=${clean(d).slice(0, 900)}}}`)
  return parts.join(' ')
}
