// Character sheet extras (owner, 2026-10-09, the D&D Beyond list): classes, hit dice, limited
// uses, companions, and the columns of the Actions and Spells tables. All kept in
// entity.attributes; pure helpers here, read by the sheet, the desk and rests.

/** Labels of `attrs` for the review. */
export const CHAR_ATTRS: Record<string, string> = {
  inspiration: 'Heroic Inspiration', uses: 'Limited uses', skill_adv: 'Advantage on skills', initiative: 'Initiative', prof_bonus: 'Proficiency bonus',
  spell_bonus: 'Spell bonus (save DC and attack, from items)', temp_hp: 'Temporary hit points', xp: 'Experience points', exhaustion: 'Exhaustion'
}

export interface ClassLevel { name: string; subclass: string; level: number }
export interface LimitedUse { name: string; max: number; used: number; reset: 'short' | 'long' }

const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>> : [])
const int = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || 0))

export function classesOf(attrs: Record<string, unknown>): ClassLevel[] {
  return arr(attrs.classes).map((c) => ({ name: String(c.name ?? ''), subclass: String(c.subclass ?? ''), level: int(c.level, 0, 20) }))
}

/** "Bard 7 (College of Lore) / Warlock 8"; empty when no classes. */
export function classLine(classes: ClassLevel[]): string {
  return classes.filter((c) => c.name.trim()).map((c) => `${c.name.trim()}${c.level ? ` ${c.level}` : ''}${c.subclass.trim() ? ` (${c.subclass.trim()})` : ''}`).join(' / ')
}

export function usesOf(attrs: Record<string, unknown>): LimitedUse[] {
  return arr(attrs.uses).map((u) => {
    const max = int(u.max, 0, 99)
    return { name: String(u.name ?? ''), max, used: int(u.used, 0, max), reset: u.reset === 'short' ? 'short' : 'long' }
  })
}

const CLASS_DIE: Record<string, number> = {
  barbarian: 12, fighter: 10, paladin: 10, ranger: 10, bard: 8, cleric: 8, druid: 8, monk: 8, rogue: 8, warlock: 8, sorcerer: 6, wizard: 6
}

/** Hit dice from the stat block text ("7d8 + 8d8 + 15" → 15 dice: 7d8, 8d8), else from the classes. */
export function hitDice(text: string, classes: ClassLevel[] = [], level = 0): { total: number; dice: string; guessed?: boolean } {
  let parts = [...text.matchAll(/(\d+)\s*d\s*(\d+)/gi)].map((m) => ({ n: Number(m[1]), d: Number(m[2]) }))
  if (!parts.length) parts = classes.filter((c) => c.level && CLASS_DIE[c.name.trim().toLowerCase()]).map((c) => ({ n: c.level, d: CLASS_DIE[c.name.trim().toLowerCase()] }))
  // Only a level typed in (no class yet): that many d8, until a class gives the right die (long playtest, 2026-10-22).
  if (!parts.length && level > 0) return { total: level, dice: `${level}d8`, guessed: true }
  return { total: parts.reduce((s, p) => s + p.n, 0), dice: parts.map((p) => `${p.n}d${p.d}`).join(' + ') }
}

/** The character level typed on the sheet (attributes.level), 0 when none. */
export const levelOf = (attrs: Record<string, unknown>) => Math.max(0, Math.min(20, Number.parseInt(String(attrs.level ?? ''), 10) || 0))

const FULL_CASTERS = new Set(['bard', 'cleric', 'druid', 'sorcerer', 'wizard'])
const HALF_CASTERS = new Set(['paladin', 'ranger'])
/** Spell slots per level 1–9 for a caster level 1–20 (the 2024 table; multiclass: full levels + half casters' levels / 2, rounded up). */
const SLOT_TABLE = [[2], [3], [4, 2], [4, 3], [4, 3, 2], [4, 3, 3], [4, 3, 3, 1], [4, 3, 3, 2], [4, 3, 3, 3, 1], [4, 3, 3, 3, 2], [4, 3, 3, 3, 2, 1], [4, 3, 3, 3, 2, 1],
  [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1],
  [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1]]

export function classSlots(classes: ClassLevel[]): number[] {
  const n = (c: ClassLevel) => c.name.trim().toLowerCase()
  const lvl = classes.reduce((s, c) => s + (FULL_CASTERS.has(n(c)) ? c.level : HALF_CASTERS.has(n(c)) ? Math.ceil(c.level / 2) : 0), 0)
  const row = lvl > 0 ? SLOT_TABLE[Math.min(20, lvl) - 1] : []
  return Array.from({ length: 9 }, (_, i) => row[i] ?? 0)
}

/**
 * Level up one class (sheet › Level up): the class and character level +1, maximum and current hit points + the class
 * die's fixed value (half + 1) + Con modifier (at least 1), spell slots up to the class table (never fewer than the DM set),
 * a warlock's Pact Magic slots. Returns the card's attribute changes (one undo step) and the hit points gained.
 */
export function levelUp(attrs: Record<string, unknown>, sbHp: string, con: number, index: number): { patch: Record<string, unknown>; gain: number; maxHp: number } {
  const classes = classesOf(attrs).map((c, i) => (i === index ? { ...c, level: Math.min(20, c.level + 1) } : c))
  const c = classes[index]
  const die = CLASS_DIE[c.name.trim().toLowerCase()] ?? 8
  const gain = Math.max(1, die / 2 + 1 + Math.floor((con - 10) / 2))
  const max = (Number.parseInt(sbHp, 10) || 0) + gain
  const cur = typeof attrs.current_hp === 'number' ? attrs.current_hp + gain : max
  const had = Array.isArray(attrs.spell_slots) ? attrs.spell_slots.map((x) => Number(x) || 0) : []
  const table = classSlots(classes)
  const patch: Record<string, unknown> = {
    classes, level: String(classes.reduce((s, x) => s + x.level, 0)), current_hp: Math.min(cur, max),
    statblock: { ...(attrs.statblock as Record<string, unknown> ?? {}), hp: String(max) }
  }
  if (table.some((x) => x > 0)) patch.spell_slots = table.map((t, i) => Math.max(t, had[i] ?? 0))
  if (c.name.trim().toLowerCase() === 'warlock') patch.pact_slots = { count: c.level >= 17 ? 4 : c.level >= 11 ? 3 : c.level >= 2 ? 2 : 1, level: Math.min(5, Math.ceil(c.level / 2)) }
  return { patch, gain, maxHp: max }
}

/** Damage takes temporary hit points first; healing never passes the maximum. */
export function applyHp(cur: number, temp: number, max: number | null, amount: number, heal: boolean): { current_hp: number; temp_hp: number } {
  if (heal) return { current_hp: max === null ? cur + amount : Math.min(max, cur + amount), temp_hp: temp }
  const fromTemp = Math.min(temp, amount)
  return { current_hp: Math.max(0, cur - (amount - fromTemp)), temp_hp: temp - fromTemp }
}

export interface AbilityRow { time: string; range: string; hitDc: string; effect: string; notes: string; attack: boolean; limited: boolean }

/** The table columns of an attack or spell, read from its description (as the SRD picker writes it). */
export function abilityRow(description: string, kind: string): AbilityRow {
  const d = description
  const first = d.split(/\.\s/)[0] ?? ''
  // Spells from the picker start "Level 3 Evocation · action · 150 feet · Concentration, up to 1 minute".
  const head = /·/.test(first) ? first.split('·').map((x) => x.trim()) : []
  const hit = /Attack Roll:\s*([+-]\d+)/i.exec(d) ?? /([+-]\d+)\s+to hit/i.exec(d)
  const save = /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Saving Throw:\s*DC\s*(\d+)/i.exec(d)
    ?? /DC\s*(\d+)\s+(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)/i.exec(d)
  const dc = save ? (/^\d+$/.test(save[1]) ? `${save[2].slice(0, 3).toUpperCase()} ${save[1]}` : `${save[1].slice(0, 3).toUpperCase()} ${save[2]}`) : ''
  const heal = /\((\d+d\d+(?:\s*[+\-−]\s*\d+)?)\)\s*Hit Points regained/i.exec(d)
  const dmg = /\((\d+d\d+(?:\s*[+\-−]\s*\d+)?)\)\s*([A-Za-z]+)\s+damage/i.exec(d) ?? /(\d+d\d+(?:\s*[+\-−]\s*\d+)?)\s+([A-Za-z]+)\s+damage/i.exec(d)
  const reach = [...d.matchAll(/(?:reach|range)\s+([\d/]+\s*(?:ft\.|feet))/gi)].map((m) => m[1]).join(' or ')
  const time = head[1] ?? ({ BONUS_ACTION: 'bonus action', REACTION: 'reaction', ACTION: 'action' } as Record<string, string>)[kind] ?? ''
  const notes = [/concentration/i.test(head.slice(3).join(' ')) && 'Concentration', /ritual/i.test(head.join(' ')) && 'Ritual',
    /\(Recharge [^)]*\)|\(\d+\/Day[^)]*\)/i.exec(d)?.[0]].filter(Boolean).join(', ')
  return {
    time, range: head[2] ?? reach, hitDc: hit ? hit[1] : dc,
    effect: heal ? `${heal[1].replace(/\s+/g, '')} Healing` : dmg ? `${dmg[1].replace(/\s+/g, '')} ${dmg[2]}` : '', notes, attack: !!hit,
    limited: /\(Recharge|\/Day|per (long|short) rest|once per/i.test(d)
  }
}

/** What any creature can do on its turn (2024 Player's Handbook). */
export const ACTIONS_IN_COMBAT = 'Attack, Dash, Disengage, Dodge, Grapple, Help, Hide, Improvise, Influence, Magic, Ready, Search, Shove, Study, Utilize'

/** XP needed for each level (PHB, same in 2014 and 2024): index = level - 1. */
export const XP_FOR_LEVEL = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000]

/** Where a character's XP stands: the level it is worth, XP to the next one, and "close" (90% of the way or more). */
export function xpProgress(xp: number, level: number): { xpLevel: number; next: number | null; toNext: number | null; close: boolean; levelUp: boolean } {
  const xpLevel = XP_FOR_LEVEL.filter((n) => xp >= n).length
  const lvl = Math.max(1, Math.min(20, level || xpLevel))
  const next = lvl < 20 ? XP_FOR_LEVEL[lvl] : null
  const from = XP_FOR_LEVEL[lvl - 1]
  return {
    xpLevel, next, toNext: next === null ? null : Math.max(0, next - xp),
    close: next !== null && xp < next && (xp - from) / (next - from) >= 0.9,
    levelUp: xpLevel > lvl
  }
}
