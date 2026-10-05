import { z } from 'zod'

// The 5e stat block kept in entity.attributes.statblock (NPC, PC, MONSTER).
// Text fields stay free text so the DM can write them as in a printed book.

const Score = z.number().int().min(1).max(30)

export const StatBlock = z.object({
  size: z.string().max(40).default(''),
  creatureType: z.string().max(80).default(''),
  alignment: z.string().max(80).default(''),
  ac: z.string().max(20).default(''),
  acDetail: z.string().max(80).default(''),
  hp: z.string().max(20).default(''),
  hitDice: z.string().max(40).default(''),
  speed: z.string().max(120).default(''),
  str: Score.default(10),
  dex: Score.default(10),
  con: Score.default(10),
  int: Score.default(10),
  wis: Score.default(10),
  cha: Score.default(10),
  saves: z.string().max(200).default(''),
  skills: z.string().max(300).default(''),
  vulnerabilities: z.string().max(200).default(''),
  resistances: z.string().max(200).default(''),
  immunities: z.string().max(200).default(''),
  conditionImmunities: z.string().max(200).default(''),
  senses: z.string().max(200).default(''),
  languages: z.string().max(200).default(''),
  cr: z.string().max(10).default(''),
  traits: z.array(z.object({ name: z.string().max(120), desc: z.string().max(5000) })).max(50).default([])
})
export type StatBlock = z.infer<typeof StatBlock>

export const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
export type AbilityKey = (typeof ABILITY_KEYS)[number]

export function emptyStatBlock(): StatBlock {
  return StatBlock.parse({})
}

/** Reads a stored stat block, filling gaps; returns null when there is none or it is unreadable. */
export function readStatBlock(value: unknown): StatBlock | null {
  if (value == null) return null
  const parsed = StatBlock.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

export function formatModifier(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`
}

/** "1/4" → 0.25, "3" → 3, anything else → null. */
export function crToNumber(cr: string): number | null {
  const t = cr.trim()
  if (!t) return null
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t)
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2])
  const n = Number.parseFloat(t)
  return Number.isFinite(n) ? n : null
}

/** First whole number in a text such as "82 (11d8 + 33)". */
export function leadingNumber(text: string): number | null {
  const m = /-?\d+/.exec(text)
  return m ? Number(m[0]) : null
}

/** One line for a board card, for example "Medium undead · CR 1 · HP 22 · AC 12". */
export function statLine(sb: StatBlock): string {
  const kind = [sb.size, sb.creatureType].filter(Boolean).join(' ')
  const parts = [
    kind,
    sb.cr && `CR ${sb.cr}`,
    sb.hp && `HP ${leadingNumber(sb.hp) ?? sb.hp}`,
    sb.ac && `AC ${leadingNumber(sb.ac) ?? sb.ac}`
  ]
  return parts.filter(Boolean).join(' · ')
}

export const HAS_STATBLOCK = new Set(['NPC', 'PC', 'MONSTER'])
