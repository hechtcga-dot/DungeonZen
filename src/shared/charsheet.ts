// Character sheet extras (owner, 2026-10-09, the D&D Beyond list): classes, hit dice, limited
// uses, companions, and the columns of the Actions and Spells tables. All kept in
// entity.attributes; pure helpers here, read by the sheet, the desk and rests.

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
export function hitDice(text: string, classes: ClassLevel[] = []): { total: number; dice: string } {
  let parts = [...text.matchAll(/(\d+)\s*d\s*(\d+)/gi)].map((m) => ({ n: Number(m[1]), d: Number(m[2]) }))
  if (!parts.length) parts = classes.filter((c) => c.level && CLASS_DIE[c.name.trim().toLowerCase()]).map((c) => ({ n: c.level, d: CLASS_DIE[c.name.trim().toLowerCase()] }))
  return { total: parts.reduce((s, p) => s + p.n, 0), dice: parts.map((p) => `${p.n}d${p.d}`).join(' + ') }
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
  const dmg = /\((\d+d\d+(?:\s*[+\-−]\s*\d+)?)\)\s*([A-Za-z]+)\s+damage/i.exec(d) ?? /(\d+d\d+(?:\s*[+\-−]\s*\d+)?)\s+([A-Za-z]+)\s+damage/i.exec(d)
  const reach = [...d.matchAll(/(?:reach|range)\s+([\d/]+\s*(?:ft\.|feet))/gi)].map((m) => m[1]).join(' or ')
  const time = head[1] ?? ({ BONUS_ACTION: 'bonus action', REACTION: 'reaction', ACTION: 'action' } as Record<string, string>)[kind] ?? ''
  const notes = [/concentration/i.test(head.slice(3).join(' ')) && 'Concentration', /ritual/i.test(head.join(' ')) && 'Ritual',
    /\(Recharge [^)]*\)|\(\d+\/Day[^)]*\)/i.exec(d)?.[0]].filter(Boolean).join(', ')
  return {
    time, range: head[2] ?? reach, hitDc: hit ? hit[1] : dc,
    effect: dmg ? `${dmg[1].replace(/\s+/g, '')} ${dmg[2]}` : '', notes, attack: !!hit,
    limited: /\(Recharge|\/Day|per (long|short) rest|once per/i.test(d)
  }
}

/** What any creature can do on its turn (2024 Player's Handbook). */
export const ACTIONS_IN_COMBAT = 'Attack, Dash, Disengage, Dodge, Grapple, Help, Hide, Improvise, Influence, Magic, Ready, Search, Shove, Study, Utilize'
