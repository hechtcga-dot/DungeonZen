// World state from deltas (docs/ARCHITECTURE.md §3.2–3.3). Pure: no UI or DB imports.

export type DeltaOp =
  | { op: 'set'; field: string; value: unknown }
  | { op: 'unset'; field: string }
  | { op: 'list_add'; field: string; value: unknown }
  | { op: 'list_remove'; field: string; value: unknown }

export type DeltaOrigin = 'autonomous' | 'player' | 'manual' | 'import'

export interface Delta {
  id: string
  targetKind: 'entity' | 'relationship'
  targetId: string
  atMin: number
  seq: number
  ops: DeltaOp[]
  origin: DeltaOrigin
  supersededBy: string | null
  /** null = canon; otherwise the what-if scenario it belongs to. */
  scenarioId: string | null
}

export type Fields = Record<string, unknown>
export type WorldState = Map<string, Fields> // key: `${targetKind}:${targetId}`

export const stateKey = (kind: Delta['targetKind'], id: string) => `${kind}:${id}`

/** DM-approved changes beat autonomous ones made in the same minute. */
const ORIGIN_RANK: Record<DeltaOrigin, number> = { autonomous: 0, import: 1, player: 2, manual: 2 }

/** The order deltas apply in: by minute, then origin rank, then seq. Later wins. */
export function compareDeltas(a: Delta, b: Delta): number {
  return a.atMin - b.atMin || ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] || a.seq - b.seq
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function applyOps(fields: Fields, ops: DeltaOp[]): Fields {
  const out: Fields = { ...fields }
  for (const o of ops) {
    if (o.op === 'set') out[o.field] = o.value
    else if (o.op === 'unset') delete out[o.field]
    else {
      const list = Array.isArray(out[o.field]) ? [...(out[o.field] as unknown[])] : []
      if (o.op === 'list_add') { if (!list.some((x) => same(x, o.value))) list.push(o.value) }
      else { const i = list.findIndex((x) => same(x, o.value)); if (i >= 0) list.splice(i, 1) }
      out[o.field] = list
    }
  }
  return out
}

/**
 * World state at minute `atMin`: base fields plus every non-superseded delta at or
 * before that minute. Canon deltas always count; a scenario's draft deltas count
 * only when that scenario is asked for (a what-if layered over canon).
 */
export function worldAt(base: WorldState, deltas: Delta[], atMin: number, scenarioId: string | null = null): WorldState {
  const out: WorldState = new Map([...base].map(([k, v]) => [k, { ...v }]))
  const live = deltas
    .filter((d) => d.supersededBy === null && d.atMin <= atMin && (d.scenarioId === null || d.scenarioId === scenarioId))
    .sort(compareDeltas)
  for (const d of live) {
    const key = stateKey(d.targetKind, d.targetId)
    out.set(key, applyOps(out.get(key) ?? {}, d.ops))
  }
  return out
}
