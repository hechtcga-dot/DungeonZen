// Encounter planner › Ask AI to rate: the encounter, the party, the 2024 numbers, how
// past fights went and the DM's own house rules (FEATURES.md: "DM can upload rules for
// the model to work from"). The answer is advice shown as an AI suggestion; nothing changes.

import { RATING_LABELS } from '../../shared/encounter'
import type { BuiltCreature, CombatView, EncounterView, EncountersView } from '../../shared/types'
import { extractJson } from '../importers/notes'
import { parseStatBlock } from './statblock'
import { CHECK_SKILLS, type EncounterStory } from '../../shared/encounterStory'

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

// Run encounter › Ask AI: what the foes do now (tactics, morale), from the state of the fight.
export const COMBAT_SYSTEM = [
  'You help a Dungeon Master run a Dungeons & Dragons 5e (2024 rules) fight.',
  "Follow the DM's house rules when given. Answer in under 120 words: for the foes still standing, what each group does",
  'this round (targets, positioning, abilities to use) and whether any flee, surrender or call for help, with the reason.'
].join(' ')

export function combatPrompt(v: CombatView, hints: string[], houseRules: string, ask: string, focusId?: string): string {
  const s = v.state
  const line = (c: CombatView['state']['combatants'][number]) =>
    `- ${c.name} (${c.side}): ${c.hp}/${c.maxHp} HP, AC ${c.ac || '?'}${c.conditions.length ? `, ${c.conditions.map((k) => `${k.name}${k.rounds ? ` ${k.rounds} rd` : ''}`).join(', ')}` : ''}${c.out ? `, ${c.out}` : ''}${c.notes ? `; ${c.notes}` : ''}`
  const lines = [`Fight: ${v.encounterName}, round ${s.round}. Turn of ${s.combatants[s.turn]?.name ?? '?'}.`, 'Combatants:', ...s.combatants.map(line)]
  if (hints.length) lines.push(`Local rules say: ${hints.join(' ')}`)
  if (s.log.length) lines.push(`Recent events: ${s.log.slice(-8).join(' ')}`)
  if (houseRules.trim()) lines.push(`House rules:\n${houseRules.trim().slice(0, 3000)}`)
  const focus = focusId ? s.combatants.find((c) => c.id === focusId) : undefined
  if (focus) {
    const i = focus.entityId ? v.info[focus.entityId] : undefined
    const opts = i?.actions.map((a) => `${a.name}: ${a.text}`).join('\n') ?? ''
    lines.push(focus.side === 'party'
      ? `Answer only for ${focus.name} (a player character): their best options this turn, so the DM can remind the player.${opts ? `\nTheir abilities:\n${opts}` : ''}`
      : `Answer only for ${focus.name}: its best tactic this turn (target, movement, which attack, spell or ability, legendary actions).${opts ? `\nIts abilities:\n${opts}` : ''}`)
  }
  if (ask.trim()) lines.push(`The DM asks: ${ask.trim().slice(0, 600)}`)
  return lines.join('\n')
}

// Build an encounter / Write it up with AI (owner, 2026-10-15): one central theme and story, with NPCs, items on
// the ground (things inside things), checks with DC results and rewards. An AI suggestion until the DM keeps it.

export const DRAFT_SYSTEM = [
  'You design encounters for Dungeons & Dragons 5e (2024 rules) for a Dungeon Master.',
  'Every encounter has ONE central theme and a small story: creatures of one family or one cause (a goblin war band with its chief and mage,',
  'a cult and its summoned imp), never a random mix. Fit the place and the DM\'s description; follow the house rules.',
  'Checks: EXACTLY 3 checks, each a different skill, chosen to fit THIS encounter, its creatures and its place.',
  'Perception is the most useful check and usually one of the three; the others must come from the encounter itself:',
  'beasts or plants: Nature (or Survival, Animal Handling); cultists, undead or fiends: Religion; ruins, old orders or nobles: History;',
  'marsh, forest or wilderness: Survival, or Medicine for sickness, poison and wounds; magic or strange runes: Arcana;',
  'a circus, climbing, ropes or water: Athletics or Acrobatics; hidden people or tracks: Investigation or Stealth;',
  'someone lying, bargaining or hiding their fear (a merchant, a captive, a cult recruiter): Insight.',
  'Each check has 2 to 4 results, lowest DC first, each a short text the DM reads to the player who rolled that high; a good last tier gives a real clue.',
  'Items on the ground can hold other items (a cart holds crates, a crate holds wine). Rewards fit the creatures and the place.',
  'Reply with ONE JSON object and nothing else:',
  '{"name": "<short title, e.g. Goblin ambush!>", "scene": "<what the players see, 2-4 sentences, read aloud>",',
  '"creatures": [{"srd": "<exact SRD name>", "count": 3, "notes": "<role: archers in the bushes>"}],',
  '"tactics": "<two sentences>", "npcs": [{"name": "...", "notes": "..."}],',
  '"items": [{"name": "Cart", "count": 1, "notes": "...", "inside": [{"name": "Crates of goods", "count": 3, "notes": "", "inside": []}]}],',
  '"checks": [{"skill": "Perception", "tiers": [{"dc": "5", "text": "..."}, {"dc": "20+", "text": "..."}]}],',
  '"rewards": {"gold": "<e.g. 25 gp>", "items": "<e.g. a share of the wine>", "secrets": [<numbers of the campaign secrets to reveal here, at most 2>]}}'
].join(' ')

export interface DraftContext {
  party: { size: number; level: number }
  place: string
  lands: string[]
  secrets: Array<{ label: string }>
  npcNames: string[]
  houseRules: string
}

const contextLines = (c: DraftContext) => [
  `Party: ${c.party.size} characters of level ${c.party.level}.`,
  `Place: ${c.place || 'not set'}${c.lands.length ? ` (${c.lands.join(', ')})` : ''}.`,
  c.npcNames.length ? `NPC cards in the campaign (use their exact names when one fits): ${c.npcNames.slice(0, 80).join('; ')}` : '',
  c.secrets.length ? `Campaign secrets and clues (numbers for rewards.secrets):\n${c.secrets.slice(0, 60).map((s, i) => `${i + 1}. ${s.label.slice(0, 200)}`).join('\n')}` : 'The campaign has no secrets yet: leave rewards.secrets empty.',
  c.houseRules.trim() ? `House rules:\n${c.houseRules.trim().slice(0, 3000)}` : ''
].filter(Boolean)

/** A new encounter: the AI picks SRD creatures (around the DM's own cards) for the budget, and writes the story. */
export function draftPrompt(c: DraftContext, ask: { budget: number; difficulty: string; creatureType?: string; include: Array<{ name: string; cr: string; count: number }>; description: string }, srdNames: string[]): string {
  return [
    ...contextLines(c),
    `Aim for ${ask.difficulty}: about ${ask.budget} XP in total (2024 rules), counting the DM's own creatures.`,
    ask.include.length ? `Must include the DM's own creatures (do not list them in "creatures"): ${ask.include.map((i) => `${i.count} × ${i.name} (CR ${i.cr || '?'})`).join(', ')}.` : '',
    ask.creatureType ? `Creature type wanted: ${ask.creatureType}.` : '',
    ask.description.trim() ? `The DM's description: ${ask.description.trim()}` : 'No description: invent something that fits the place.',
    `SRD monsters (name, CR): ${srdNames.join('; ')}`
  ].filter(Boolean).join('\n')
}

/** An encounter that already has its creatures: the AI writes the name, scene and story around them. */
export function writePrompt(c: DraftContext, e: EncounterView, ask: string): string {
  return [
    ...contextLines(c),
    `Encounter: ${e.name}.`,
    e.scene.trim() ? `The DM's scene so far: ${e.scene.trim().slice(0, 3000)}` : '',
    e.creatures.length ? `Creatures (keep exactly these; leave "creatures" empty): ${e.creatures.map((x) => `${x.count} × ${x.name} (CR ${x.cr || '?'})${x.notes ? `, ${x.notes}` : ''}`).join('; ')}.` : 'No creatures yet: leave "creatures" empty anyway.',
    e.tactics.trim() ? `Tactics: ${e.tactics.trim()}` : '',
    ask.trim() ? `The DM wants: ${ask.trim().slice(0, 1500)}` : ''
  ].filter(Boolean).join('\n')
}

type RawItem = { name?: unknown; count?: unknown; notes?: unknown; inside?: unknown }
const rid = () => Math.random().toString(36).slice(2, 10)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Reads the AI's JSON into a draft: SRD names must match; NPC names that match a card are tied to it. */
export function parseDraft(reply: string, index: Array<{ key: string; name: string; cr: string }>, npcCards: Array<{ id: string; name: string }>, secretIds: string[]): {
  name: string; scene: string; tactics: string; creatures: Array<{ key: string; name: string; cr: string; count: number; notes: string }>; story: EncounterStory
} {
  const raw = extractJson(reply) as Record<string, unknown>
  const byName = new Map(index.map((m) => [m.name.toLowerCase(), m]))
  const creatures: Array<{ key: string; name: string; cr: string; count: number; notes: string }> = []
  for (const c of (Array.isArray(raw.creatures) ? raw.creatures : []).slice(0, 12) as Array<Record<string, unknown>>) {
    const m = byName.get(str(c.srd, 200).replace(/\s*\(CR[^)]*\)\s*$/i, '').toLowerCase())
    if (m) creatures.push({ key: m.key, name: m.name, cr: m.cr, count: Math.min(30, Math.max(1, Math.round(Number(c.count) || 1))), notes: str(c.notes, 1000) })
  }
  const cardByName = new Map(npcCards.map((n) => [n.name.toLowerCase(), n.id]))
  const npcs = (Array.isArray(raw.npcs) ? raw.npcs : []).slice(0, 12).map((n: Record<string, unknown>) => {
    const name = str(n.name, 200)
    return { id: rid(), name, entityId: cardByName.get(name.toLowerCase()) ?? null, notes: str(n.notes, 2000) }
  }).filter((n) => n.name)
  const items: EncounterStory['items'] = []
  const walk = (list: unknown, parentId: string | null, depth: number) => {
    for (const it of (Array.isArray(list) ? list : []).slice(0, 20) as RawItem[]) {
      const name = str(it.name, 200)
      if (!name || items.length >= 60) continue
      const id = rid()
      items.push({ id, name, count: Math.min(100000, Math.max(1, Math.round(Number(it.count) || 1))), notes: str(it.notes, 2000), parentId, entityId: null })
      if (depth < 4) walk(it.inside, id, depth + 1)
    }
  }
  walk(raw.items, null, 0)
  const skill = (s: string) => CHECK_SKILLS.find((k) => k.toLowerCase().startsWith(s.toLowerCase().split(' ')[0])) ?? (s || 'Perception')
  // Always three checks with different skills (owner, 2026-10-19): repeats dropped, short lists topped up with empty Perception / Investigation / Insight.
  const checks = (Array.isArray(raw.checks) ? raw.checks : []).map((c: Record<string, unknown>) => ({
    id: rid(), skill: skill(str(c.skill, 60)),
    tiers: (Array.isArray(c.tiers) ? c.tiers : []).slice(0, 8).map((t: Record<string, unknown>) => ({ dc: String(t.dc ?? '').slice(0, 10), text: str(t.text, 2000) }))
  })).filter((c, i, all) => all.findIndex((x) => x.skill === c.skill) === i).slice(0, 3)
  for (const k of ['Perception', 'Investigation', 'Insight']) {
    if (checks.length < 3 && !checks.some((c) => c.skill === k)) checks.push({ id: rid(), skill: k, tiers: [{ dc: '10', text: '' }, { dc: '15', text: '' }] })
  }
  const rw = (raw.rewards && typeof raw.rewards === 'object' ? raw.rewards : {}) as Record<string, unknown>
  const picked = (Array.isArray(rw.secrets) ? rw.secrets : []).map((n) => secretIds[Number(n) - 1]).filter((x): x is string => !!x)
  const story: EncounterStory = {
    npcs, items, checks,
    rewards: { gold: str(rw.gold, 500), items: str(rw.items, 2000), secretIds: [...new Set(picked)].slice(0, 20) }
  }
  const name = str(raw.name, 200)
  if (!name && !creatures.length && !npcs.length && !items.length) throw new Error('The AI answer had no encounter in it. Try again, or a different model.')
  return { name, scene: str(raw.scene, 5000), tactics: str(raw.tactics, 3000), creatures, story }
}
