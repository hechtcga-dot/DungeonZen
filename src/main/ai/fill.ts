// Card sheet › Fill blanks with AI (ARCHITECTURE.md §4 "Fill blanks"). Pure: builds the
// request from the card and what it is tied to, and reads the answer. The answer is a set
// of suggestions the DM picks from; nothing is saved until "Use selected" (rules 2, 10).

import type { CardField } from '../../shared/cardFields'
import type { SheetView } from '../../shared/types'
import { readStatBlock, statLine } from '../../shared/statblock'
import { extractJson } from '../importers/notes'

export const FILL_SYSTEM = [
  'You help a Dungeon Master fill in the empty fields of a Dungeons & Dragons 5e (2024) campaign card.',
  'Stay consistent with everything already on the card and its connections; never contradict the DM.',
  'Be concrete and short: one line for short fields, two to four sentences for long ones. Invent freely but plausibly.',
  'Reply with ONE JSON object and nothing else: {"fields": {"<key>": "<text>"}, "srd_base": "<SRD creature name or empty>"}.',
  'Only use the field keys you are asked for.'
].join(' ')

export interface FillContext {
  campaignName: string
  sheet: SheetView
  /** Storylines the card is in. */
  storylines: string[]
  /** For a creature without a stat block: SRD creatures to pick a base from. */
  srdNames: string[] | null
}

export function fillPrompt(ctx: FillContext, fields: CardField[], ask: string): string {
  const e = ctx.sheet.entity
  const known = Object.entries(e.attributes)
    .filter(([k, v]) => typeof v === 'string' && v.trim() && !['notes'].includes(k))
    .map(([k, v]) => `${k}: ${String(v).trim().slice(0, 800)}`)
  const sb = readStatBlock(e.attributes.statblock)
  const lines = [
    `Campaign: ${ctx.campaignName}.`,
    `Card: ${e.name} (${e.type.toLowerCase()})${e.tags.length ? `, tags: ${e.tags.join(', ')}` : ''}.`,
    known.length ? `Already on the card:\n${known.join('\n')}` : 'The card has nothing else on it yet.'
  ]
  if (sb) lines.push(`Stat block: ${statLine(sb)}.`)
  const custom = Array.isArray(e.attributes.custom) ? (e.attributes.custom as Array<{ label?: string; value?: string }>).filter((f) => f.label && f.value) : []
  if (custom.length) lines.push(`DM's own fields: ${custom.map((f) => `${f.label}: ${f.value}`).join('; ')}`)
  const notes = typeof e.attributes.notes === 'string' ? e.attributes.notes.trim() : ''
  if (notes) lines.push(`DM notes (private; use them for consistency): ${notes.slice(0, 1500)}`)
  if (ctx.sheet.connections.length) {
    lines.push(`Connections: ${ctx.sheet.connections.slice(0, 20).map((c) => {
      const t = c.relationship.type.toLowerCase().replace(/_/g, ' ')
      return `${c.outgoing ? `${e.name} ${t} ${c.other.name}` : `${c.other.name} ${t} ${e.name}`} (${c.other.type.toLowerCase()}${c.relationship.isSecret ? ', secret' : ''})`
    }).join('; ')}.`)
  }
  if (ctx.storylines.length) lines.push(`Storylines: ${ctx.storylines.join(', ')}.`)
  lines.push(`Fill these empty fields:\n${fields.map((f) => `- ${f.key}: ${f.label}${f.hint ? ` (${f.hint})` : ''}${f.long ? ' [two to four sentences]' : ' [one line]'}`).join('\n')}`)
  if (ctx.srdNames) lines.push(`It has no stat block. In "srd_base", name the creature from this SRD list that fits best as a base: ${ctx.srdNames.join(', ')}.`)
  if (ask.trim()) lines.push(`The DM adds: ${ask.trim().slice(0, 600)}`)
  return lines.join('\n')
}

export interface FillAnswer { fields: Record<string, string>; srdBase: string | null }

/** Keeps only fields that were asked for and are not empty. */
export function parseFill(reply: string, asked: string[]): FillAnswer {
  const raw = extractJson(reply) as { fields?: Record<string, unknown>; srd_base?: unknown }
  const fields: Record<string, string> = {}
  for (const k of asked) {
    const v = raw.fields?.[k]
    if (typeof v === 'string' && v.trim()) fields[k] = v.trim().slice(0, 5000)
    else if (typeof v === 'number') fields[k] = String(v)
  }
  const base = typeof raw.srd_base === 'string' && raw.srd_base.trim() ? raw.srd_base.trim() : null
  return { fields, srdBase: base }
}
