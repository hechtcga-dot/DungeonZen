// Encounter difficulty with the 2024 rules (XP budgets per character, XP by CR),
// adjusted by how the party found past fights. Pure, shared by main and renderer.

// 2024 rules: XP budget per character by level (Low, Moderate, High).
const XP_BUDGET: Record<number, [number, number, number]> = {
  1: [50, 75, 100], 2: [100, 150, 200], 3: [150, 225, 400], 4: [250, 375, 500], 5: [500, 750, 1100],
  6: [600, 1000, 1400], 7: [750, 1300, 1700], 8: [1000, 1700, 2100], 9: [1300, 2000, 2600], 10: [1600, 2300, 3100],
  11: [1900, 2900, 4100], 12: [2200, 3700, 4700], 13: [2600, 4200, 5400], 14: [2900, 4900, 6200], 15: [3300, 5400, 7800],
  16: [3800, 6100, 9800], 17: [4500, 7200, 11700], 18: [5000, 8700, 14200], 19: [5500, 10700, 17200], 20: [6400, 13200, 22000]
}

const XP_BY_CR: Record<string, number> = {
  '0': 10, '1/8': 25, '1/4': 50, '1/2': 100, '1': 200, '2': 450, '3': 700, '4': 1100, '5': 1800, '6': 2300, '7': 2900, '8': 3900,
  '9': 5000, '10': 5900, '11': 7200, '12': 8400, '13': 10000, '14': 11500, '15': 13000, '16': 15000, '17': 18000, '18': 20000,
  '19': 22000, '20': 25000, '21': 33000, '22': 41000, '23': 50000, '24': 62000, '25': 75000, '26': 90000, '27': 105000,
  '28': 120000, '29': 135000, '30': 155000
}

export const DIFFICULTIES = ['low', 'moderate', 'high'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export function xpForCr(cr: string): number {
  return XP_BY_CR[cr.trim()] ?? 0
}

export function encounterBudget(partyLevel: number, partySize: number, difficulty: Difficulty): number {
  const level = Math.min(20, Math.max(1, Math.round(partyLevel)))
  const row = XP_BUDGET[level]
  return row[DIFFICULTIES.indexOf(difficulty)] * Math.max(1, Math.round(partySize))
}


export type FightFeedback = 'too_easy' | 'about_right' | 'hard' | 'nearly_deadly'

/** How the budgets move per fight: easy fights raise them, hard ones lower them. */
const FEEDBACK_SHIFT: Record<FightFeedback, number> = { too_easy: 0.2, about_right: 0, hard: -0.1, nearly_deadly: -0.25 }
export const ADAPT_WINDOW = 10

export interface Adaptation {
  /** Multiply the 2024 budgets by this (1 = the book). */
  factor: number
  /** How many rated fights it is based on. */
  fights: number
  explain: string
}

/** From the latest rated fights (newest last): the party's own difficulty factor. */
export function adaptation(feedback: FightFeedback[]): Adaptation {
  const recent = feedback.slice(-ADAPT_WINDOW)
  if (!recent.length) return { factor: 1, fights: 0, explain: 'No rated fights yet: the 2024 budgets as written.' }
  const mean = recent.reduce((n, f) => n + FEEDBACK_SHIFT[f], 0) / recent.length
  const factor = Math.round(Math.min(1.4, Math.max(0.7, 1 + mean)) * 100) / 100
  const pct = Math.round((factor - 1) * 100)
  const counts = (['too_easy', 'about_right', 'hard', 'nearly_deadly'] as const)
    .map((f) => [f, recent.filter((x) => x === f).length] as const).filter(([, n]) => n > 0)
    .map(([f, n]) => `${n} ${f.replace('_', ' ')}`).join(', ')
  const way = pct === 0 ? 'the budgets stay as written' : pct > 0 ? `budgets raised ${pct}%` : `budgets lowered ${-pct}%`
  return { factor, fights: recent.length, explain: `From the last ${recent.length} rated fight${recent.length === 1 ? '' : 's'} (${counts}): ${way}.` }
}

export type Rating = 'trivial' | 'low' | 'moderate' | 'high' | 'over_high'
export const RATING_LABELS: Record<Rating, string> = {
  trivial: 'Below Low', low: 'Low', moderate: 'Moderate', high: 'High', over_high: 'Above High (could be deadly)'
}

export interface Difficulty2024 {
  totalXp: number
  budgets: { low: number; moderate: number; high: number }
  rating: Rating
  factor: number
}

/** Rates a group of creatures (CR and count) for a party of a size and level. */
export function rateEncounter(creatures: Array<{ cr: string; count: number }>, partyLevel: number, partySize: number, factor = 1): Difficulty2024 {
  const totalXp = creatures.reduce((n, c) => n + xpForCr(c.cr) * Math.max(0, c.count), 0)
  const b = (d: Difficulty) => Math.round(encounterBudget(partyLevel, partySize, d) * factor)
  const budgets = { low: b('low'), moderate: b('moderate'), high: b('high') }
  const rating: Rating = totalXp === 0 ? 'trivial'
    : totalXp < budgets.low * 0.5 ? 'trivial'
      : totalXp <= budgets.low ? 'low'
        : totalXp <= budgets.moderate ? 'moderate'
          : totalXp <= budgets.high ? 'high' : 'over_high'
  return { totalXp, budgets, rating, factor }
}
