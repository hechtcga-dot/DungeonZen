import { crToNumber, leadingNumber, type StatBlock } from './statblock'

// Raise or lower a creature's challenge rating by local rules (the DMG's "Monster Statistics
// by Challenge Rating" table): hit points and damage scale by the table's ratio, AC, attack
// bonuses, save DCs and proficiency shift by its differences. The creature keeps its shape.

export const CR_STEPS = ['0', '1/8', '1/4', '1/2', ...Array.from({ length: 30 }, (_, i) => String(i + 1))]

//            prof AC  HP mid  atk dmg mid DC
const TABLE: Array<[number, number, number, number, number, number]> = [
  [2, 13, 3.5, 3, 0.5, 13], [2, 13, 21, 3, 2.5, 13], [2, 13, 42.5, 3, 4.5, 13], [2, 13, 60, 3, 7, 13],
  [2, 13, 78, 3, 11.5, 13], [2, 13, 93, 3, 17.5, 13], [2, 13, 108, 4, 23.5, 13], [2, 14, 123, 5, 29.5, 14],
  [3, 15, 138, 6, 35.5, 15], [3, 15, 153, 6, 41.5, 15], [3, 15, 168, 6, 47.5, 15], [3, 16, 183, 7, 53.5, 16],
  [4, 16, 198, 7, 59.5, 16], [4, 17, 213, 7, 65.5, 16], [4, 17, 228, 8, 71.5, 17], [4, 17, 243, 8, 77.5, 17],
  [5, 18, 258, 8, 83.5, 18], [5, 18, 273, 8, 89.5, 18], [5, 18, 288, 8, 95.5, 18], [5, 18, 303, 9, 101.5, 18],
  [6, 19, 318, 10, 107.5, 19], [6, 19, 333, 10, 113.5, 19], [6, 19, 348, 10, 119.5, 19], [6, 19, 378, 10, 131.5, 19],
  [7, 19, 423, 11, 149.5, 20], [7, 19, 468, 11, 167.5, 20], [7, 19, 513, 11, 185.5, 20], [7, 19, 558, 12, 203.5, 21],
  [8, 19, 603, 12, 221.5, 21], [8, 19, 648, 12, 239.5, 21], [8, 19, 693, 13, 257.5, 22], [8, 19, 738, 13, 275.5, 22],
  [9, 19, 783, 13, 293.5, 22], [9, 19, 828, 14, 311.5, 23]
]

/** The step index of a CR text, or null. */
export function crStep(cr: string): number | null {
  const n = crToNumber(cr)
  if (n == null) return null
  const i = CR_STEPS.findIndex((s) => crToNumber(s) === n)
  return i < 0 ? null : i
}

export interface ScaledAbility { id: string; description: string; macroText: string }

export interface CrScaleResult {
  statblock: StatBlock
  abilities: ScaledAbility[]
  /** What changes, in plain words, for the DM to approve. */
  changes: string[]
}

const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`)

/**
 * Scales a stat block and its actions from its CR to `target` (a CR text). Damage dice keep
 * their die size; the number of dice follows the damage ratio (at least one).
 */
export function scaleToCr(sb: StatBlock, abilities: Array<{ id: string; name: string; description: string; macroText: string }>, target: string): CrScaleResult {
  const from = crStep(sb.cr)
  const to = crStep(target)
  if (from == null) throw new Error('Set the challenge rating first')
  if (to == null) throw new Error(`Unknown challenge rating ${target}`)
  const [pf, acf, hpf, atkf, dmgf, dcf] = TABLE[from]
  const [pt, act, hpt, atkt, dmgt, dct] = TABLE[to]
  const hpRatio = hpt / hpf
  const dmgRatio = dmgf > 0 ? dmgt / dmgf : 1
  const dProf = pt - pf, dAc = act - acf, dAtk = atkt - atkf, dDc = dct - dcf
  const changes: string[] = []
  const dice = (n: number) => Math.max(1, Math.round(n * dmgRatio))

  const scaleText = (text: string) => text
    // "12 (2d6 + 5)" → new dice count and average.
    .replace(/(\d+) \((\d+)d(\d+)(?:\s*([+-])\s*(\d+))?\)/g, (_m, _avg, n, d, op, k) => {
      const count = dice(Number(n))
      const bonus = k ? (op === '-' ? -Number(k) : Number(k)) : 0
      const avg = Math.max(1, Math.floor((count * (Number(d) + 1)) / 2) + bonus)
      return `${avg} (${count}d${d}${k ? ` ${op} ${k}` : ''})`
    })
    .replace(/(Attack Roll:\s*)([+-]\d+)/g, (_m, a, b) => `${a}${sign(Number(b) + dAtk)}`)
    .replace(/([+-]\d+)( to hit)/g, (_m, b, a) => `${sign(Number(b) + dAtk)}${a}`)
    .replace(/DC (\d+)/g, (_m, n) => `DC ${Number(n) + dDc}`)
  const scaleMacro = (text: string) => text
    .replace(/1d20\s*\+\s*(\d+)/g, (_m, b) => `1d20+${Number(b) + dAtk}`)
    .replace(/\[\[(\d+)d(\d+)/g, (_m, n, d) => (d === '20' && n === '1' ? `[[1d20` : `[[${dice(Number(n))}d${d}`))
    .replace(/DC (\d+)/g, (_m, n) => `DC ${Number(n) + dDc}`)

  const hpOld = leadingNumber(sb.hp)
  let hpNew = hpOld == null ? null : Math.max(1, Math.round(hpOld * hpRatio))
  const acOld = leadingNumber(sb.ac)
  const acNew = acOld == null ? null : Math.max(5, acOld + dAc)
  // Hit dice "8d8 + 16": more or fewer dice, the same Constitution bonus per die; HP is their average.
  let hitDice = sb.hitDice
  const hd = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/.exec(sb.hitDice.trim())
  if (hd && hpOld != null) {
    const n = Number(hd[1]), d = Number(hd[2]), k = hd[4] ? (hd[3] === '-' ? -Number(hd[4]) : Number(hd[4])) : 0
    const n2 = Math.max(1, Math.round(n * hpRatio))
    const k2 = Math.round((k / n) * n2)
    hitDice = `${n2}d${d}${k2 ? ` ${k2 < 0 ? '-' : '+'} ${Math.abs(k2)}` : ''}`
    hpNew = Math.max(1, Math.floor((n2 * (d + 1)) / 2) + k2)
  }
  const shiftBonuses = (text: string) => text.replace(/([+-])(\d+)/g, (_m, s, n) => sign((s === '-' ? -Number(n) : Number(n)) + dProf))

  const statblock: StatBlock = {
    ...sb,
    cr: target,
    hp: hpNew == null ? sb.hp : String(hpNew),
    hitDice,
    ac: acNew == null ? sb.ac : String(acNew),
    saves: dProf ? shiftBonuses(sb.saves) : sb.saves,
    skills: dProf ? shiftBonuses(sb.skills) : sb.skills,
    traits: sb.traits.map((t) => ({ ...t, desc: scaleText(t.desc) }))
  }
  changes.push(`Challenge rating ${sb.cr} → ${target}`)
  if (hpOld != null && hpNew !== hpOld) changes.push(`Hit points ${hpOld} → ${hpNew}${hitDice !== sb.hitDice ? ` (${hitDice})` : ''}`)
  if (acOld != null && acNew !== acOld) changes.push(`Armour class ${acOld} → ${acNew}`)
  if (dAtk) changes.push(`Attack bonuses ${sign(dAtk)}`)
  if (dDc) changes.push(`Save DCs ${sign(dDc)}`)
  if (dProf && (sb.saves || sb.skills)) changes.push(`Saving throws and skills ${sign(dProf)}`)
  if (Math.abs(dmgRatio - 1) > 0.01) changes.push(`Damage about ×${Math.round(dmgRatio * 100) / 100} (more or fewer dice)`)

  const scaled = abilities.map((a) => ({ id: a.id, description: scaleText(a.description), macroText: scaleMacro(a.macroText) }))
  return { statblock, abilities: scaled, changes }
}
