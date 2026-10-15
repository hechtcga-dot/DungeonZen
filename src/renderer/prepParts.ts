import { boxOrder } from './fold'

/** The seven prep sections, in the sheet's own order. */
export const PREP_PARTS = [
  { kind: 'opening', name: 'Session opening' },
  { kind: 'scene', name: 'Likely scenes' },
  { kind: 'discovery', name: 'Links, secrets, clues' },
  { kind: 'npc', name: 'NPCs' },
  { kind: 'thread', name: 'Loose threads' },
  { kind: 'recap', name: 'Session recap' },
  { kind: 'bible', name: 'World bible updates' }
] as const
export type PrepPart = typeof PREP_PARTS[number]

/** The sections in the order the DM moved them to with ↑ / ↓ on Session prep (same rule as the box order there). */
export function prepOrder(): PrepPart[] {
  const want = boxOrder('prep|prep-main') ?? []
  const rank = (p: PrepPart) => { const i = want.findIndex((t) => t.startsWith(p.name)); return i < 0 ? Infinity : i }
  return PREP_PARTS.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p)
}

/** A section's round number: its place in the DM's order. */
export const prepNumber = (kind: string) => prepOrder().findIndex((p) => p.kind === kind) + 1
