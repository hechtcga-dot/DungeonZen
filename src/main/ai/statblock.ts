// Monster/NPC sheet › AI stat block: a whole 5e (2024) stat block from the DM's description
// and options. Pure: builds the request and reads the answer. Nothing is saved until the DM
// presses "Use this stat block" (rules 2, 10).

import { StatBlock, statLine, readStatBlock, ABILITY_KEYS } from '../../shared/statblock'
import type { AbilityKind } from '../../shared/schemas'
import type { SheetView } from '../../shared/types'
import { extractJson } from '../importers/notes'

export const STATBLOCK_SYSTEM = [
  'You write Dungeons & Dragons 5e (2024 rules, SRD 5.2) stat blocks for a Dungeon Master.',
  'Follow the Dungeon Master\'s Guide numbers for the challenge rating (hit points, AC, attack bonus, damage per round, save DC).',
  'Write actions the 2024 way, for example "Melee Attack Roll: +5, reach 5 ft. 6 (1d6 + 3) Slashing damage." or',
  '"Dexterity Saving Throw: DC 13, each creature in a 15-foot Cone. Failure: 10 (3d6) Fire damage. Success: Half damage."',
  'Reply with ONE JSON object and nothing else:',
  '{"statblock": {"size","creatureType","alignment","ac","acDetail","hp","hitDice","speed","str","dex","con","int","wis","cha",',
  '"saves","skills","vulnerabilities","resistances","immunities","conditionImmunities","senses","languages","cr","traits":[{"name","desc"}]},',
  '"actions": [{"name","kind":"ACTION|BONUS_ACTION|REACTION|LEGENDARY_ACTION","desc"}]}.',
  'Ability scores are whole numbers 1 to 30; text fields are short text as printed in a book.'
].join(' ')

export interface StatBlockAsk {
  description: string
  cr: string
  size: string
  creatureType: string
  role: string
}

export function statBlockPrompt(sheet: SheetView, ask: StatBlockAsk): string {
  const e = sheet.entity
  const sb = readStatBlock(e.attributes.statblock)
  const text = (k: string) => (typeof e.attributes[k] === 'string' ? (e.attributes[k] as string).trim() : '')
  const lines = [`Creature: ${e.name} (${e.type === 'NPC' ? 'a non-player character' : 'a monster'}).`]
  for (const [k, label] of [['summary', 'Summary'], ['bio', 'Bio'], ['motivation', 'Wants']] as const) if (text(k)) lines.push(`${label}: ${text(k).slice(0, 800)}`)
  if (sb && sb.cr) lines.push(`Its stat block now: ${statLine(sb)}. Keep what fits, improve the rest.`)
  if (sheet.abilities.length) lines.push(`Its actions now: ${sheet.abilities.map((a) => a.name).join(', ')}.`)
  if (ask.description.trim()) lines.push(`The DM describes it: ${ask.description.trim().slice(0, 2000)}`)
  const opts = [ask.cr && `challenge rating ${ask.cr}`, ask.size && `size ${ask.size}`, ask.creatureType && `type ${ask.creatureType}`, ask.role && `role in a fight: ${ask.role}`].filter(Boolean)
  if (opts.length) lines.push(`Must have: ${opts.join('; ')}.`)
  lines.push('Make it fun and clear to run at the table: what it does each turn, and one or two tricks.')
  return lines.join('\n')
}

const KINDS = new Set(['ACTION', 'BONUS_ACTION', 'REACTION', 'LEGENDARY_ACTION'])

export interface StatBlockAnswer {
  statblock: StatBlock
  actions: Array<{ name: string; kind: AbilityKind; description: string }>
}

/** Reads the reply; scores are clamped to 1–30 and text cut to size, so a near miss still works. */
export function parseStatBlock(reply: string): StatBlockAnswer {
  const raw = extractJson(reply) as { statblock?: Record<string, unknown>; actions?: unknown }
  const sbIn = { ...(raw.statblock ?? {}) }
  const lengths: Record<string, number> = { size: 40, creatureType: 80, alignment: 80, ac: 20, acDetail: 80, hp: 20, hitDice: 40, speed: 120, saves: 200, skills: 300, vulnerabilities: 200, resistances: 200, immunities: 200, conditionImmunities: 200, senses: 200, languages: 200, cr: 10 }
  for (const [k, max] of Object.entries(lengths)) sbIn[k] = sbIn[k] == null ? '' : String(sbIn[k]).slice(0, max)
  for (const k of ABILITY_KEYS) { const n = Math.round(Number(sbIn[k])); sbIn[k] = Number.isFinite(n) ? Math.min(30, Math.max(1, n)) : 10 }
  sbIn.traits = (Array.isArray(sbIn.traits) ? sbIn.traits : []).slice(0, 50)
    .map((t: { name?: unknown; desc?: unknown }) => ({ name: String(t?.name ?? '').slice(0, 120), desc: String(t?.desc ?? '').slice(0, 5000) }))
    .filter((t: { name: string }) => t.name)
  const parsed = StatBlock.safeParse(sbIn)
  if (!parsed.success) throw new Error('The AI answer was not a stat block. Try again, or a different model.')
  const actions = (Array.isArray(raw.actions) ? raw.actions : []).slice(0, 30)
    .map((a: { name?: unknown; kind?: unknown; desc?: unknown }) => ({
      name: String(a?.name ?? '').trim().slice(0, 120),
      kind: (KINDS.has(String(a?.kind)) ? String(a?.kind) : 'ACTION') as AbilityKind,
      description: String(a?.desc ?? '').slice(0, 5000)
    }))
    .filter((a) => a.name)
  return { statblock: parsed.data, actions }
}
