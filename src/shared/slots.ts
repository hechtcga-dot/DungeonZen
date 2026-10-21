import { usesOf } from './charsheet'

// Spell slots kept on a card (owner, 3.5.0). The most per level (`spell_slots`) is only changed by
// the DM on the sheet; casting ticks `slots_used`. Slots made from Sorcery Points sit on top
// (`slots_bonus`) until a long rest. Pact Magic (`pact_slots`: how many, their level; `pact_used`)
// comes back on a short rest. Pure.

export interface SlotState {
  max: number[]
  bonus: number[]
  used: number[]
  pact: { count: number; level: number; used: number }
}

/** Spell slots from a Spellcasting text ("1st level (4 slots)"), levels 1–9. */
export function slotsFromText(text: string): number[] {
  const slots = Array<number>(9).fill(0)
  for (const m of text.matchAll(/(\d)(?:st|nd|rd|th)[ -]level\s*\((\d+)\s*slots?\)/gi)) slots[Number(m[1]) - 1] = Number(m[2])
  return slots
}

const nine = (v: unknown) => (Array.isArray(v) ? Array.from({ length: 9 }, (_, i) => Math.max(0, Math.round(Number(v[i])) || 0)) : null)

/** The card's slots; the most per level falls back on its Spellcasting text ("1st level (4 slots)"). */
export function slotState(attrs: Record<string, unknown>, text = ''): SlotState {
  const p = (attrs.pact_slots && typeof attrs.pact_slots === 'object' ? attrs.pact_slots : {}) as { count?: unknown; level?: unknown }
  const count = Math.max(0, Math.min(9, Math.round(Number(p.count)) || 0))
  return {
    max: nine(attrs.spell_slots) ?? slotsFromText(text),
    bonus: nine(attrs.slots_bonus) ?? Array<number>(9).fill(0),
    used: nine(attrs.slots_used) ?? Array<number>(9).fill(0),
    pact: { count, level: Math.max(1, Math.min(5, Math.round(Number(p.level)) || 1)), used: Math.min(count, Math.max(0, Math.round(Number(attrs.pact_used)) || 0)) }
  }
}

/** Slots per level 1–9 counting bonus ones (index 0 = level 1). */
export const slotsTotal = (s: SlotState) => s.max.map((m, i) => m + s.bonus[i])
/** Slots left per level 1–9 (Pact Magic not counted). */
export const slotsLeft = (s: SlotState) => slotsTotal(s).map((t, i) => Math.max(0, t - s.used[i]))
export const pactLeft = (s: SlotState) => Math.max(0, s.pact.count - s.pact.used)

/** The attribute change that spends one slot of this level (or a Pact Magic slot); null when none is left. */
export function spendSlot(s: SlotState, level: number, pact = false): Record<string, unknown> | null {
  if (pact) return pactLeft(s) > 0 && s.pact.level === level ? { pact_used: s.pact.used + 1 } : null
  const k = level - 1
  if (k < 0 || k > 8 || slotsLeft(s)[k] <= 0) return null
  return { slots_used: s.used.map((u, i) => (i === k ? u + 1 : u)) }
}

/** Font of Magic (2024): Sorcery Points to make a slot of level 1–5. */
export const SORCERY_COST = [2, 3, 5, 6, 7]

/**
 * Convert Sorcery Points (2024): spend points for a slot of level 1–5 (it vanishes on a long rest),
 * or spend a slot to gain as many points as its level (never above the most). The change to the
 * card, or why it cannot be done.
 */
export function convertSorcery(attrs: Record<string, unknown>, s: SlotState, how: 'make' | 'burn', level: number): { patch: Record<string, unknown> } | { error: string } {
  const uses = usesOf(attrs)
  const i = uses.findIndex((u) => /sorcery points?/i.test(u.name))
  if (i < 0) return { error: 'No Sorcery Points on this sheet: add them under Limited uses.' }
  const sp = uses[i]
  const left = sp.max - sp.used
  const k = level - 1
  if (how === 'make') {
    const cost = SORCERY_COST[k]
    if (!cost) return { error: 'Sorcery Points make slots of level 1 to 5.' }
    if (left < cost) return { error: `A level ${level} slot costs ${cost} Sorcery Points; ${left} left.` }
    return { patch: { uses: uses.map((u, j) => (j === i ? { ...u, used: u.used + cost } : u)), slots_bonus: s.bonus.map((b, j) => (j === k ? b + 1 : b)) } }
  }
  const spend = spendSlot(s, level)
  if (!spend) return { error: `No level ${level} slot left.` }
  if (sp.used <= 0) return { error: 'Sorcery Points are already full.' }
  return { patch: { ...spend, uses: uses.map((u, j) => (j === i ? { ...u, used: Math.max(0, u.used - level) } : u)) } }
}

/** One line for the turn panel: "1: 3/4, 2: 2/3 · Pact (level 3): 1/2". */
export function slotsLine(s: SlotState): string {
  const total = slotsTotal(s)
  const left = slotsLeft(s)
  const parts = total.map((t, k) => (t ? `${k + 1}: ${left[k]}/${t}` : '')).filter(Boolean)
  if (s.pact.count) parts.push(`Pact (level ${s.pact.level}): ${pactLeft(s)}/${s.pact.count}`)
  return parts.join(', ')
}
