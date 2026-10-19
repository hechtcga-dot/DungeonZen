// Encounter story (owner, 2026-10-15): NPCs, items on the ground (things inside things), checks with DC
// tiers and rewards. Stored on the encounter card (attributes.story); every part editable, undoable.

import { z } from 'zod'

export const CHECK_SKILLS = ['Perception', 'Investigation', 'Insight', 'Survival', 'Nature', 'Arcana (magic)', 'History', 'Religion', 'Medicine', 'Athletics',
  'Acrobatics', 'Animal Handling', 'Stealth', 'Sleight of Hand', 'Deception', 'Intimidation', 'Performance', 'Persuasion'] as const

const RowId = z.string().min(1).max(64)
const Line = z.string().max(2000)
export const EncounterStory = z.object({
  npcs: z.array(z.object({ id: RowId, name: z.string().max(200), entityId: z.string().max(64).nullable(), notes: Line })).max(40),
  items: z.array(z.object({ id: RowId, name: z.string().max(200), count: z.number().int().min(1).max(100000), notes: Line, parentId: z.string().max(64).nullable(), entityId: z.string().max(64).nullable() })).max(200),
  checks: z.array(z.object({ id: RowId, skill: z.string().max(60), tiers: z.array(z.object({ dc: z.string().max(10), text: Line })).max(12) })).max(12),
  rewards: z.object({ gold: z.string().max(500), items: z.string().max(2000), secretIds: z.array(z.string().max(64)).max(20) })
})
export type EncounterStory = z.infer<typeof EncounterStory>

export const newRowId = (): string => Math.random().toString(36).slice(2, 10)

/** A new encounter's story: one Perception check with four empty results. */
export function emptyStory(): EncounterStory {
  return {
    npcs: [], items: [],
    checks: [{ id: newRowId(), skill: 'Perception', tiers: ['5', '10', '15', '20+'].map((dc) => ({ dc, text: '' })) }],
    rewards: { gold: '', items: '', secretIds: [] }
  }
}

/** The stored story, or a fresh one when there is none (or it no longer reads). */
export function readStory(raw: unknown): EncounterStory {
  const r = EncounterStory.safeParse(raw)
  return r.success ? r.data : emptyStory()
}

/** Items in the order they show: each one followed by what is inside it, with its depth. */
export function itemTree(items: EncounterStory['items']): Array<{ item: EncounterStory['items'][number]; depth: number }> {
  const out: Array<{ item: EncounterStory['items'][number]; depth: number }> = []
  const walk = (parentId: string | null, depth: number) => {
    for (const it of items.filter((x) => x.parentId === parentId)) { out.push({ item: it, depth }); if (depth < 6) walk(it.id, depth + 1) }
  }
  walk(null, 0)
  // Orphans (their container removed) show at the top level.
  for (const it of items) if (!out.some((o) => o.item === it)) out.push({ item: it, depth: 0 })
  return out
}

/** An item and everything inside it (to remove together). */
export function withContents(items: EncounterStory['items'], id: string): Set<string> {
  const ids = new Set([id])
  for (let grew = true; grew;) {
    grew = false
    for (const it of items) if (it.parentId && ids.has(it.parentId) && !ids.has(it.id)) { ids.add(it.id); grew = true }
  }
  return ids
}
