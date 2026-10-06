// Encounter planner › Ask AI to rate: the encounter, the party, the 2024 numbers, how
// past fights went and the DM's own house rules (FEATURES.md: "DM can upload rules for
// the model to work from"). The answer is advice shown as an AI suggestion; nothing changes.

import { RATING_LABELS } from '../../shared/encounter'
import type { EncounterView, EncountersView } from '../../shared/types'

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
