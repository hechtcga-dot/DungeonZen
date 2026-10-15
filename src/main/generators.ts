// On-the-fly generators for the live session desk. They work offline from
// built-in word lists and the bundled SRD, and only *propose*: nothing is saved
// until the DM puts the result on the board or saves it for later (rule 2).
// Names and details are made up for play.

import { THEMES } from './encounterThemes'
import type { SrdMonsterIndexEntry } from './srd'
import { DIFFICULTIES, encounterBudget, xpForCr, type Difficulty } from '../shared/encounter'

export type Rng = () => number

/** A small seeded random number generator (mulberry32), so tests are repeatable. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]

const FIRST = ['Ada', 'Bram', 'Cora', 'Doran', 'Elsbeth', 'Fenn', 'Greta', 'Hollis', 'Ilsa', 'Jory', 'Kesta', 'Lorn', 'Maren', 'Nils', 'Orla', 'Pell',
  'Quill', 'Rosk', 'Sabine', 'Tamsin', 'Ulric', 'Vesna', 'Wren', 'Yorick', 'Zelda', 'Aldric', 'Brisa', 'Corvin', 'Dagna', 'Emrys'] as const
const LAST = ['Ashgrove', 'Blackwater', 'Cobble', 'Dunmore', 'Emberly', 'Farrow', 'Greaves', 'Hightower', 'Ironwood', 'Juniper', 'Kettle', 'Lark',
  'Marsh', 'Nettle', 'Oakhart', 'Pike', 'Quarry', 'Reed', 'Saltmarsh', 'Thorne', 'Underhill', 'Vale', 'Whitlock', 'Yarrow'] as const
const SPECIES = ['Human', 'Human', 'Human', 'Elf', 'Dwarf', 'Halfling', 'Gnome', 'Orc', 'Tiefling', 'Dragonborn', 'Goliath', 'Aasimar'] as const
const OCCUPATIONS: ReadonlyArray<[string, string]> = [
  ['farmer', 'Commoner'], ['fishmonger', 'Commoner'], ['baker', 'Commoner'], ['stablehand', 'Commoner'], ['town guard', 'Guard'],
  ['retired soldier', 'Warrior Infantry'], ['smuggler', 'Bandit'], ['dock thug', 'Tough'], ['minor noble', 'Noble'], ['temple acolyte', 'Priest Acolyte'],
  ['village priest', 'Priest'], ['travelling scout', 'Scout'], ['informant', 'Spy'], ['hedge wizard', 'Mage'], ['pirate deckhand', 'Pirate'],
  ['captain of the watch', 'Guard Captain'], ['grove keeper', 'Druid'], ['pit fighter', 'Gladiator']
]
const ATTITUDES = ['friendly', 'wary', 'helpful but greedy', 'suspicious of strangers', 'nervous', 'boastful', 'grieving', 'cheerfully rude', 'secretive', 'eager to please'] as const
const QUIRKS = ['hums old sea shanties', 'never looks anyone in the eye', 'collects buttons', 'speaks in whispers', 'laughs at the wrong moments',
  'quotes a long-dead poet', 'always eating something', 'counts coins while talking', 'has a pet rat in a pocket', 'cannot remember names',
  'swears by a saint nobody has heard of', 'wears far too much perfume'] as const
const WANTS = ['to pay off a gambling debt', 'news of a missing sibling', 'to leave town before winter', 'revenge on a former partner',
  'a cure for a sick child', 'to be taken seriously', 'a quiet life', 'to find a buyer for stolen goods', 'to get into the temple archive'] as const

export interface GeneratedCharacter {
  name: string
  species: string
  occupation: string
  attitude: string
  quirk: string
  wants: string
  /** SRD stat block to copy for this person, by monster name. */
  statblockName: string
  summary: string
}

/** Spare names for people the party meets unexpectedly (prep sheet: backup names). */
export function rollNames(rng: Rng, count: number): string[] {
  const out = new Set<string>()
  for (let tries = 0; out.size < count && tries < count * 20; tries++) out.add(`${pick(rng, FIRST)} ${pick(rng, LAST)}`)
  return [...out]
}

export function rollCharacter(rng: Rng): GeneratedCharacter {
  const [occupation, statblockName] = pick(rng, OCCUPATIONS)
  const c = {
    name: `${pick(rng, FIRST)} ${pick(rng, LAST)}`,
    species: pick(rng, SPECIES),
    occupation,
    attitude: pick(rng, ATTITUDES),
    quirk: pick(rng, QUIRKS),
    wants: pick(rng, WANTS),
    statblockName
  }
  return { ...c, summary: `${c.species} ${c.occupation} · ${c.attitude}` }
}

const TAVERN_ADJ = ['Drowned', 'Gilded', 'Crooked', 'Sleeping', 'Rusty', 'Laughing', 'Silver', 'Broken', 'Wandering', 'Lucky', 'Black', 'Merry'] as const
const TAVERN_NOUN = ['Bell', 'Goat', 'Lantern', 'Anchor', 'Griffon', 'Kettle', 'Crown', 'Oar', 'Fox', 'Stag', 'Barrel', 'Moon'] as const
const RUMOURS = ['Lights have been seen in the old lighthouse again.', 'The miller paid for his drinks in foreign gold.',
  'Someone has been stealing church bells along the coast.', 'A wolf the size of a horse was seen on the north road.',
  'The duke’s tax collector never came back from the marsh.', 'They say the well water tastes of salt since the storm.'] as const
const DISHES = ['eel pie', 'mutton stew', 'black bread and goat cheese', 'smoked trout', 'turnip soup', 'honey cakes'] as const

export interface GeneratedTavern {
  name: string
  keeper: GeneratedCharacter
  patrons: GeneratedCharacter[]
  rumour: string
  dish: string
  summary: string
}

export function fillTavern(rng: Rng): GeneratedTavern {
  const name = `The ${pick(rng, TAVERN_ADJ)} ${pick(rng, TAVERN_NOUN)}`
  const keeper = { ...rollCharacter(rng), occupation: 'innkeeper', statblockName: 'Commoner' }
  keeper.summary = `${keeper.species} innkeeper · ${keeper.attitude}`
  const count = 3 + Math.floor(rng() * 3)
  const patrons = Array.from({ length: count }, () => rollCharacter(rng))
  const dish = pick(rng, DISHES)
  return { name, keeper, patrons, rumour: pick(rng, RUMOURS), dish, summary: `Tavern kept by ${keeper.name} · tonight: ${dish}` }
}

export { DIFFICULTIES, encounterBudget, xpForCr, type Difficulty }

export interface EncounterGroup { key: string; name: string; cr: string; count: number; xp: number }
export interface GeneratedEncounter {
  difficulty: Difficulty
  budget: number
  totalXp: number
  creatureType: string
  groups: EncounterGroup[]
  summary: string
  /** Why nothing was rolled (no monster matches the words, or all that match cost more than the budget). */
  note?: string
}

/** Most creatures one roll puts in (a very cheap pool with a big budget would otherwise fill a page). */
export const MAX_ROLLED = 30

/** Monsters whose stat block has every word (a word matches the start of any word written there; "hills" finds "hill"); a creature type word means that type. */
export function matchMonsters(monsters: SrdMonsterIndexEntry[], words = ''): SrdMonsterIndexEntry[] {
  const stems = words.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1).map((w) => w.length > 3 ? w.replace(/(es|s)$/, '') : w)
  if (!stems.length) return monsters
  // A word that is a creature type (undead, beasts) means that type, not every stat block that mentions it.
  const types = new Set(monsters.map((m) => m.creatureType.toLowerCase()))
  const tests = stems.map((w) => {
    if (types.has(w)) return (m: SrdMonsterIndexEntry) => m.creatureType.toLowerCase() === w
    const re = new RegExp(`\\b${w}`)
    return (m: SrdMonsterIndexEntry) => re.test(m.text ?? `${m.name} ${m.creatureType}`.toLowerCase())
  })
  return monsters.filter((m) => tests.every((t) => t(m)))
}

/**
 * A random roll of SRD monsters within the 2024 XP budget: every pick is any monster that still fits
 * (all equally likely), until nothing fits or MAX_ROLLED creatures are in. Words narrow the pool to
 * monsters whose stat block mentions them. Never exceeds the budget. Null only when the SRD is empty.
 */
export function suggestEncounter(
  rng: Rng, monsters: SrdMonsterIndexEntry[], partyLevel: number, partySize: number, difficulty: Difficulty, words?: string,
  budgetFactor = 1
): GeneratedEncounter | null {
  const budget = Math.round(encounterBudget(partyLevel, partySize, difficulty) * budgetFactor)
  const matching = matchMonsters(monsters.filter((m) => xpForCr(m.cr) > 0), words)
  const empty = (note: string): GeneratedEncounter => ({ difficulty, budget, totalXp: 0, creatureType: '', groups: [], summary: note, note })
  if (!matching.length) return words?.trim() ? empty(`No SRD monster mentions “${words.trim()}”.`) : null
  const pool = matching.filter((m) => xpForCr(m.cr) <= budget)
  if (!pool.length) {
    const cheapest = [...matching].sort((x, y) => xpForCr(x.cr) - xpForCr(y.cr)).slice(0, 3).map((m) => `${m.name} (CR ${m.cr}, ${xpForCr(m.cr)} XP)`)
    return empty(`${cheapest.join(', ')}${matching.length > 3 ? ` and ${matching.length - 3} more` : ''} match, but each costs more than the ${budget} XP budget.`)
  }
  const groups: EncounterGroup[] = []
  let left = budget, count = 0
  for (;;) {
    const fits = pool.filter((m) => xpForCr(m.cr) <= left)
    if (!fits.length || count >= MAX_ROLLED) break
    const m = pick(rng, fits)
    const xp = xpForCr(m.cr)
    const g = groups.find((x) => x.key === m.key)
    if (g) { g.count++; g.xp += xp } else groups.push({ key: m.key, name: m.name, cr: m.cr, count: 1, xp })
    left -= xp; count++
  }
  groups.sort((x, y) => y.xp / y.count - x.xp / x.count)
  const totalXp = budget - left
  const creatureType = [...new Set(groups.map((g) => monsters.find((m) => m.key === g.key)?.creatureType ?? ''))].filter(Boolean).join(', ')
  const summary = groups.map((g) => `${g.count} × ${g.name}`).join(', ') + ` · ${difficulty} · ${totalXp} of ${budget} XP`
  return { difficulty, budget, totalXp, creatureType, groups, summary }
}

export interface ThemedEncounter extends GeneratedEncounter { theme: string; scene: string }

/**
 * A themed roll (owner, 2026-10-15): one creature family from THEMES for the land of the place (or the
 * cards the DM included), a leader costing at most 60 % of what is left, then troops of that family until
 * the budget is spent. `spentXp` is what included cards already cost. Null when no theme fits.
 */
export function suggestThemed(
  rng: Rng, monsters: SrdMonsterIndexEntry[], partyLevel: number, partySize: number, difficulty: Difficulty,
  opts: { lands: string[]; creatureType?: string; spentXp?: number; includeNames?: string[]; budgetFactor?: number }
): ThemedEncounter | null {
  const budget = Math.round(encounterBudget(partyLevel, partySize, difficulty) * (opts.budgetFactor ?? 1))
  let left = budget - (opts.spentXp ?? 0)
  const byName = new Map(monsters.map((m) => [m.name, m]))
  const found = (names: string[]) => names.map((n) => byName.get(n)).filter((m): m is SrdMonsterIndexEntry => !!m && xpForCr(m.cr) > 0)
  let themes = THEMES.filter((t) => found(t.troops).some((m) => xpForCr(m.cr) <= left))
  if (opts.creatureType) themes = themes.filter((t) => found([...t.leaders, ...t.troops]).some((m) => m.creatureType === opts.creatureType))
  const words = new Set((opts.includeNames ?? []).flatMap((n) => n.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 2))
  const byInclude = themes.filter((t) => [...t.leaders, ...t.troops].some((n) => n.toLowerCase().split(/[^a-z]+/).some((w) => words.has(w))))
  const byLand = themes.filter((t) => t.lands.some((l) => opts.lands.includes(l)))
  const pool = byInclude.length ? byInclude : byLand.length ? byLand : themes
  if (!pool.length) return null
  const theme = pick(rng, pool)
  const groups: EncounterGroup[] = []
  let count = 0
  const add = (m: SrdMonsterIndexEntry) => {
    const xp = xpForCr(m.cr)
    const g = groups.find((x) => x.key === m.key)
    if (g) { g.count++; g.xp += xp } else groups.push({ key: m.key, name: m.name, cr: m.cr, count: 1, xp })
    left -= xp; count++
  }
  const leader = found(theme.leaders).filter((m) => xpForCr(m.cr) <= left * 0.6).sort((a, b) => xpForCr(b.cr) - xpForCr(a.cr))[0]
  if (leader) add(leader)
  const troops = found(theme.troops).filter((m) => !leader || m.key !== leader.key || theme.troops.length === 1)
  for (;;) {
    const fits = troops.filter((m) => xpForCr(m.cr) <= left)
    if (!fits.length || count >= MAX_ROLLED) break
    add(pick(rng, fits))
  }
  if (!groups.length) return null
  groups.sort((x, y) => y.xp / y.count - x.xp / x.count)
  const totalXp = groups.reduce((n, g) => n + g.xp, 0)
  const creatureType = [...new Set(groups.map((g) => byName.get(g.name)?.creatureType ?? ''))].filter(Boolean).join(', ')
  const summary = groups.map((g) => `${g.count} × ${g.name}`).join(', ') + ` · ${difficulty} · ${totalXp + (opts.spentXp ?? 0)} of ${budget} XP`
  return { difficulty, budget, totalXp, creatureType, groups, summary, theme: theme.name, scene: theme.scene }
}
