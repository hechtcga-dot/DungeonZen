// On-the-fly generators for the live session desk. They work offline from
// built-in word lists and the bundled SRD, and only *propose*: nothing is saved
// until the DM puts the result on the board or saves it for later (rule 2).
// Names and details are made up for play.

import { crToNumber } from '../shared/statblock'
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
}

/**
 * Builds an encounter from SRD monsters of one creature type, spending up to the
 * 2024 XP budget: a leader (the strongest monster that fits) and, when budget is
 * left, a pack of weaker ones. Never exceeds the budget.
 */
export function suggestEncounter(
  rng: Rng, monsters: SrdMonsterIndexEntry[], partyLevel: number, partySize: number, difficulty: Difficulty, creatureType?: string,
  budgetFactor = 1
): GeneratedEncounter | null {
  const budget = Math.round(encounterBudget(partyLevel, partySize, difficulty) * budgetFactor)
  const usable = monsters.filter((m) => xpForCr(m.cr) > 0 && xpForCr(m.cr) <= budget)
  const types = [...new Set(usable.map((m) => m.creatureType))].filter(Boolean)
  const type = creatureType && types.includes(creatureType) ? creatureType : pick(rng, types.length ? types : [''])
  const pool = usable.filter((m) => !type || m.creatureType === type)
  if (pool.length === 0) return null
  // Leader: something between half and all of the budget if possible.
  const strong = pool.filter((m) => xpForCr(m.cr) >= budget * 0.35)
  const leader = pick(rng, strong.length ? strong : pool)
  const groups: EncounterGroup[] = [{ key: leader.key, name: leader.name, cr: leader.cr, count: 1, xp: xpForCr(leader.cr) }]
  let left = budget - xpForCr(leader.cr)
  const minions = pool.filter((m) => m.key !== leader.key && xpForCr(m.cr) <= left && (crToNumber(m.cr) ?? 0) < (crToNumber(leader.cr) ?? 0))
  if (minions.length && left > 0) {
    const m = pick(rng, minions)
    const count = Math.min(8, Math.floor(left / xpForCr(m.cr)))
    if (count > 0) { groups.push({ key: m.key, name: m.name, cr: m.cr, count, xp: count * xpForCr(m.cr) }); left -= count * xpForCr(m.cr) }
  }
  const totalXp = budget - left
  const summary = groups.map((g) => `${g.count} × ${g.name}`).join(' and ') + ` · ${difficulty} · ${totalXp} of ${budget} XP`
  return { difficulty, budget, totalXp, creatureType: type, groups, summary }
}
