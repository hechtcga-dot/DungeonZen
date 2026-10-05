import srdData from '../../resources/srd/srd-2024.json'
import { StatBlock, crToNumber } from '../shared/statblock'
import type { AbilityKind } from '../shared/schemas'
import type { SrdItemSummary, SrdMonsterSummary, SrdSearch } from '../shared/types'
import type { NewAbility } from './campaign/campaign'

// SRD 5.2 monsters and items, shipped with the app (built by scripts/build-srd.mjs
// from the Open5e project's data). Searching works offline; "Add copy" copies an
// entry into the campaign, so nothing refers back to this data (CLAUDE.md rule 8).

interface SrdMonster {
  key: string
  name: string
  statblock: unknown
  actions: Array<{ name: string; kind: string; desc: string; macro: string }>
}
interface SrdItem {
  key: string
  name: string
  category: string
  rarity: string
  magic: boolean
  attunement: boolean
  desc: string
}
interface SrdFile {
  source: string
  license: string
  attribution: string
  monsters: SrdMonster[]
  items: SrdItem[]
}

const data = srdData as SrdFile
const monstersByKey = new Map(data.monsters.map((m) => [m.key, m]))
const itemsByKey = new Map(data.items.map((i) => [i.key, i]))
const MAX_RESULTS = 60

export const SRD_ATTRIBUTION = data.attribution
export const SRD_SOURCE = 'SRD 5.2'

export interface SrdFilters {
  query: string
  kind: 'monsters' | 'items' | 'both'
  crMin?: number
  crMax?: number
}

function monsterSummary(m: SrdMonster): SrdMonsterSummary {
  const sb = StatBlock.parse(m.statblock)
  return {
    key: m.key, name: m.name, kind: [sb.size, sb.creatureType].filter(Boolean).join(' '),
    cr: sb.cr, ac: sb.ac, hp: sb.hp
  }
}

export function searchSrd(f: SrdFilters): SrdSearch {
  const q = f.query.trim().toLowerCase()
  const monsters = f.kind === 'items' ? [] : data.monsters.filter((m) => {
    const sb = m.statblock as { creatureType?: string; cr?: string }
    if (q && !`${m.name} ${sb.creatureType ?? ''}`.toLowerCase().includes(q)) return false
    const cr = crToNumber(sb.cr ?? '')
    if (f.crMin != null && (cr == null || cr < f.crMin)) return false
    if (f.crMax != null && (cr == null || cr > f.crMax)) return false
    return true
  })
  const items = f.kind === 'monsters' || f.crMin != null || f.crMax != null ? [] : data.items.filter((i) =>
    !q || `${i.name} ${i.category} ${i.rarity}`.toLowerCase().includes(q))
  return {
    monsters: monsters.slice(0, MAX_RESULTS).map(monsterSummary),
    items: items.slice(0, MAX_RESULTS).map((i): SrdItemSummary => ({
      key: i.key, name: i.name, category: i.category, rarity: i.rarity, magic: i.magic
    })),
    totalMonsters: monsters.length,
    totalItems: items.length,
    attribution: data.attribution
  }
}

const KINDS = new Set<AbilityKind>(['ACTION', 'BONUS_ACTION', 'REACTION', 'LEGENDARY_ACTION'])

/** What to create in the campaign for an SRD entry: a monster with stat block and actions, or an item. */
export function srdCopy(key: string): {
  type: 'MONSTER' | 'ITEM'
  name: string
  attributes: Record<string, unknown>
  abilities: NewAbility[]
} {
  const source = { name: SRD_SOURCE, key, license: data.license }
  const m = monstersByKey.get(key)
  if (m) {
    const statblock = StatBlock.parse(m.statblock)
    return {
      type: 'MONSTER',
      name: m.name,
      attributes: { statblock, source, summary: '' },
      abilities: m.actions.map((a) => ({
        name: a.name,
        kind: KINDS.has(a.kind as AbilityKind) ? (a.kind as AbilityKind) : 'OTHER',
        description: a.desc,
        macroText: a.macro,
        showTokenAction: true,
        showMacroBar: false
      }))
    }
  }
  const i = itemsByKey.get(key)
  if (i) {
    const summary = [i.rarity, i.category, i.attunement ? 'requires attunement' : ''].filter(Boolean).join(' · ')
    return { type: 'ITEM', name: i.name, attributes: { summary, description: i.desc, source }, abilities: [] }
  }
  throw new Error(`No SRD entry ${key}`)
}

