// Encounter planner › Ask AI to rate: the encounter, the party, the 2024 numbers, how
// past fights went and the DM's own house rules (FEATURES.md: "DM can upload rules for
// the model to work from"). The answer is advice shown as an AI suggestion; nothing changes.

import { RATING_LABELS } from '../../shared/encounter'
import type { BuiltCreature, EncounterView, EncountersView } from '../../shared/types'
import { extractJson } from '../importers/notes'
import { parseStatBlock } from './statblock'

export const RATE_SYSTEM = [
  'You help a Dungeon Master balance Dungeons & Dragons 5e (2024 rules) encounters.',
  "Follow the DM's house rules when given; they override the book.",
  'Answer in under 150 words: a one-line verdict (too easy, about right, hard, deadly) for this party,',
  'the main risks (action economy, damage spikes, terrain, conditions), and two concrete tweaks.'
].join(' ')

export function ratePrompt(e: EncounterView, v: Pick<EncountersView, 'party' | 'adaptation' | 'houseRules'>, place: string | null): string {
  const d = e.difficulty
  const lines = [
    `Party: ${v.party.size} characters of level ${v.party.level}.`,
    `Encounter: ${e.name}${place ? ` at ${place}` : ''}. The DM is aiming for ${e.target}.`,
    'Creatures:',
    ...e.creatures.map((c) => `- ${c.count} × ${c.name} (CR ${c.cr || '?'}${c.statLine ? `; ${c.statLine}` : ''})${c.notes ? ` — ${c.notes}` : ''}`),
    `2024 numbers: ${d.totalXp} XP against budgets Low ${d.budgets.low}, Moderate ${d.budgets.moderate}, High ${d.budgets.high}: ${RATING_LABELS[d.rating]}.`,
    `How past fights went: ${v.adaptation.explain}`
  ]
  if (e.tactics.trim()) lines.push(`Tactics: ${e.tactics.trim()}`)
  if (e.notes.trim()) lines.push(`Notes: ${e.notes.trim()}`)
  if (v.houseRules.trim()) lines.push(`House rules:\n${v.houseRules.trim().slice(0, 6000)}`)
  return lines.join('\n')
}

// Encounter planner › Build with AI: the AI picks SRD monsters or makes new ones for the scene.
// The answer is a proposal; nothing is added until the DM ticks and adds (rules 2, 10). New
// monsters stay in the encounter (not on the board) until "Put on board" (owner, 2026-10-06).

export const BUILD_SYSTEM = [
  'You build encounters for Dungeons & Dragons 5e (2024 rules) for a Dungeon Master.',
  "Fit the scene, the place and the DM's wishes; follow the DM's house rules; hit the XP budget asked for (2024 encounter rules).",
  'Prefer SRD monsters by their exact SRD name; make a new monster only when nothing in the SRD fits, with a full 2024 stat block.',
  'Reply with ONE JSON object and nothing else:',
  '{"creatures": [{"srd": "<exact SRD name>", "count": 2, "notes": "<where it stands, what it does>"},',
  '{"new": {"name", "statblock": {"size","creatureType","alignment","ac","acDetail","hp","hitDice","speed","str","dex","con","int","wis","cha",',
  '"saves","skills","vulnerabilities","resistances","immunities","conditionImmunities","senses","languages","cr","traits":[{"name","desc"}]},',
  '"actions": [{"name","kind":"ACTION|BONUS_ACTION|REACTION|LEGENDARY_ACTION","desc"}]}, "count": 1, "notes": "..."}],',
  '"tactics": "<two or three sentences: how they fight, when they flee or surrender>"}'
].join(' ')

export function buildPrompt(e: EncounterView, v: Pick<EncountersView, 'party' | 'adaptation' | 'houseRules'>, srdNames: string[], ask: string): string {
  const d = e.difficulty
  const lines = [
    `Party: ${v.party.size} characters of level ${v.party.level}.`,
    `Encounter: ${e.name}${e.locationName ? ` at ${e.locationName}` : ''}.`,
    e.scene.trim() ? `The scene: ${e.scene.trim().slice(0, 3000)}` : 'No scene written yet: invent one that fits.',
    `Aim for ${e.target}: about ${d.budgets[e.target]} XP in total (Low ${d.budgets.low}, Moderate ${d.budgets.moderate}, High ${d.budgets.high}).`,
    e.creatures.length ? `Already in it (keep them, add to them): ${e.creatures.map((c) => `${c.count} × ${c.name} (CR ${c.cr || '?'})`).join(', ')}.` : 'Nobody is in it yet.'
  ]
  if (ask.trim()) lines.push(`The DM wants: ${ask.trim().slice(0, 1500)}`)
  if (v.houseRules.trim()) lines.push(`House rules:\n${v.houseRules.trim().slice(0, 4000)}`)
  lines.push(`SRD monsters (name, CR): ${srdNames.join('; ')}`)
  return lines.join('\n')
}


/** Reads the reply: SRD names must match the SRD; new monsters need a readable stat block. */
export function parseBuild(reply: string, index: Array<{ key: string; name: string; cr: string }>): { creatures: BuiltCreature[]; tactics: string } {
  const raw = extractJson(reply) as { creatures?: unknown; tactics?: unknown }
  const byName = new Map(index.map((m) => [m.name.toLowerCase(), m]))
  const creatures: BuiltCreature[] = []
  for (const c of (Array.isArray(raw.creatures) ? raw.creatures : []).slice(0, 12) as Array<Record<string, unknown>>) {
    const count = Math.min(30, Math.max(1, Math.round(Number(c.count) || 1)))
    const notes = String(c.notes ?? '').slice(0, 1000)
    if (typeof c.srd === 'string') {
      const m = byName.get(c.srd.replace(/\s*\(CR[^)]*\)\s*$/i, '').trim().toLowerCase())
      if (m) creatures.push({ kind: 'srd', key: m.key, name: m.name, cr: m.cr, count, notes })
    } else if (c.new && typeof c.new === 'object') {
      const n = c.new as { name?: unknown }
      const name = String(n.name ?? '').trim().slice(0, 200)
      if (!name) continue
      try {
        const sb = parseStatBlock(JSON.stringify(n))
        creatures.push({ kind: 'new', name, statblock: sb.statblock, actions: sb.actions, count, notes })
      } catch { /* not a stat block: skip it */ }
    }
  }
  if (!creatures.length) throw new Error('The AI answer had no creatures in it. Try again, or a different model.')
  return { creatures, tactics: typeof raw.tactics === 'string' ? raw.tactics.trim().slice(0, 3000) : '' }
}
