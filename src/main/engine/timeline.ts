// Storylines, acts, outcomes and cross-storyline triggers (docs/ARCHITECTURE.md
// §3.4–3.6). Pure: no UI or DB imports.
//
// The engine only *projects*: it works out what would happen given the DM's
// data and the current time. It never writes. Anything it decides on its own
// (a default outcome, a trigger firing) comes back marked so the DM can approve
// it (CLAUDE.md rule 2).

export type StorylineStatus = 'inactive' | 'autonomous' | 'player_active' | 'concluded'

export interface TStoryline { id: string; status: StorylineStatus }
export interface TAct {
  id: string
  storylineId: string
  number: number
  startMin: number
  endMin: number
  /** The outcome the DM recorded, if any. */
  chosenOutcomeId: string | null
}
export interface TOutcome { id: string; actId: string; isDefault: boolean }

export type TriggerEffect =
  | { type: 'shift_act'; actId: string; minutes: number }
  | { type: 'force_outcome'; actId: string; outcomeId: string }
  | { type: 'set_status'; status: StorylineStatus }

export interface TTrigger {
  id: string
  sourceActId: string
  /** Fires when the source act ends with this outcome. */
  outcomeId: string
  targetStorylineId: string
  effect: TriggerEffect
}

export interface TimelineInput {
  storylines: TStoryline[]
  acts: TAct[]
  outcomes: TOutcome[]
  triggers: TTrigger[]
  /** The campaign clock. Act ends at or before this minute are resolved. */
  nowMin: number
}

export type ActState = 'upcoming' | 'running' | 'resolved' | 'awaiting'
export type ResolvedBy = 'dm' | 'default' | 'trigger'

export interface ActProjection {
  id: string
  storylineId: string
  startMin: number
  endMin: number
  /** Minutes this act was moved by triggers (0 if none). */
  shiftedBy: number
  state: ActState
  outcomeId: string | null
  resolvedBy: ResolvedBy | null
  /** Outcome a trigger forces on this act (it still ends on its own time). */
  forcedOutcomeId: string | null
  /** Outcome that will apply if nobody intervenes before the act ends. */
  defaultOutcomeId: string | null
}

export interface FiredTrigger { triggerId: string; atMin: number }

export interface TimelineProjection {
  acts: Map<string, ActProjection>
  storylineStatus: Map<string, StorylineStatus>
  fired: FiredTrigger[]
}

/**
 * Projects the timeline up to `nowMin`.
 *
 * Rules:
 * - Acts are processed in order of when they end. An act that has ended takes the
 *   DM's chosen outcome; failing that a forced outcome from a trigger; failing that,
 *   if its storyline runs on its own (autonomous), the default outcome. A
 *   player-active storyline never resolves on its own: its ended act is "awaiting"
 *   the DM (so is an autonomous act with no default). Inactive and concluded
 *   storylines do not move.
 * - When an act resolves, each trigger on that act and outcome fires once, at the
 *   act's end. Effects only reach forward in time: shift_act moves an act (and the
 *   later acts of its storyline) only if it starts at or after the firing minute;
 *   force_outcome only marks an act that has not ended yet. So triggers cannot loop.
 */
export function projectTimeline(input: TimelineInput): TimelineProjection {
  const status = new Map(input.storylines.map((s) => [s.id, s.status]))
  const defaults = new Map<string, string>()
  for (const o of input.outcomes) if (o.isDefault && !defaults.has(o.actId)) defaults.set(o.actId, o.id)
  const validOutcome = new Set(input.outcomes.map((o) => `${o.actId}:${o.id}`))

  const acts = new Map<string, ActProjection>(input.acts.map((a) => [a.id, {
    id: a.id, storylineId: a.storylineId, startMin: a.startMin, endMin: a.endMin, shiftedBy: 0,
    state: 'upcoming' as ActState, outcomeId: null, resolvedBy: null, forcedOutcomeId: null,
    defaultOutcomeId: defaults.get(a.id) ?? null
  }]))
  const chosen = new Map(input.acts.map((a) => [a.id, a.chosenOutcomeId]))
  const byStoryline = new Map<string, ActProjection[]>()
  for (const a of acts.values()) byStoryline.set(a.storylineId, [...(byStoryline.get(a.storylineId) ?? []), a])
  for (const list of byStoryline.values()) list.sort((a, b) => a.startMin - b.startMin)

  const done = new Set<string>()
  const firedIds = new Set<string>()
  const fired: FiredTrigger[] = []

  for (;;) {
    // The next unprocessed act whose end has come.
    const next = [...acts.values()]
      .filter((a) => !done.has(a.id) && a.endMin <= input.nowMin)
      .sort((a, b) => a.endMin - b.endMin || a.startMin - b.startMin || a.id.localeCompare(b.id))[0]
    if (!next) break
    done.add(next.id)
    const st = status.get(next.storylineId) ?? 'inactive'
    const dmChoice = chosen.get(next.id) ?? null
    if (dmChoice && validOutcome.has(`${next.id}:${dmChoice}`)) {
      next.outcomeId = dmChoice; next.resolvedBy = 'dm'
    } else if (next.forcedOutcomeId) {
      next.outcomeId = next.forcedOutcomeId; next.resolvedBy = 'trigger'
    } else if (st === 'autonomous' && next.defaultOutcomeId) {
      next.outcomeId = next.defaultOutcomeId; next.resolvedBy = 'default'
    }
    if (!next.outcomeId) {
      // A moving storyline whose act ended without an outcome waits for the DM.
      next.state = st === 'player_active' || st === 'autonomous' ? 'awaiting' : 'upcoming'
      continue
    }
    next.state = 'resolved'

    for (const t of input.triggers) {
      if (firedIds.has(t.id) || t.sourceActId !== next.id || t.outcomeId !== next.outcomeId) continue
      firedIds.add(t.id)
      const at = next.endMin
      fired.push({ triggerId: t.id, atMin: at })
      const e = t.effect
      if (e.type === 'set_status') {
        status.set(t.targetStorylineId, e.status)
      } else if (e.type === 'shift_act') {
        const target = acts.get(e.actId)
        if (!target || target.storylineId !== t.targetStorylineId || target.startMin < at) continue
        for (const a of byStoryline.get(target.storylineId) ?? []) {
          if (a.startMin >= target.startMin && !done.has(a.id)) {
            a.startMin = Math.max(at, a.startMin + e.minutes)
            a.endMin = Math.max(a.startMin, a.endMin + e.minutes)
            a.shiftedBy += e.minutes
          }
        }
      } else if (e.type === 'force_outcome') {
        const target = acts.get(e.actId)
        if (target && !done.has(target.id) && target.endMin > at && validOutcome.has(`${target.id}:${e.outcomeId}`)) {
          target.forcedOutcomeId = e.outcomeId
        }
      }
    }
  }

  // Acts that have not ended: running if under way and the storyline is moving.
  for (const a of acts.values()) {
    if (done.has(a.id)) continue
    const st = status.get(a.storylineId) ?? 'inactive'
    const moving = st === 'autonomous' || st === 'player_active'
    a.state = moving && a.startMin <= input.nowMin ? 'running' : 'upcoming'
  }
  return { acts, storylineStatus: status, fired }
}

export interface WhatIfChange {
  actId: string
  field: 'outcomeId' | 'startMin' | 'endMin' | 'state'
  before: unknown
  after: unknown
}

/**
 * What would change if act `actId` ended with `outcomeId` instead (a what-if).
 * Projects both versions to `horizonMin` (default: far future) and lists every
 * act whose outcome, times or state differ, plus storylines whose status differs.
 */
export function whatIf(
  input: TimelineInput, actId: string, outcomeId: string, horizonMin = Number.MAX_SAFE_INTEGER
): { acts: WhatIfChange[]; storylines: Array<{ storylineId: string; before: StorylineStatus; after: StorylineStatus }> } {
  const base = { ...input, nowMin: horizonMin }
  const alt = { ...base, acts: input.acts.map((a) => (a.id === actId ? { ...a, chosenOutcomeId: outcomeId } : a)) }
  const before = projectTimeline(base)
  const after = projectTimeline(alt)
  const changes: WhatIfChange[] = []
  for (const [id, b] of before.acts) {
    const a = after.acts.get(id)!
    for (const field of ['outcomeId', 'startMin', 'endMin', 'state'] as const) {
      if (b[field] !== a[field]) changes.push({ actId: id, field, before: b[field], after: a[field] })
    }
  }
  const storylines = [...before.storylineStatus].flatMap(([id, s]) => {
    const t = after.storylineStatus.get(id)!
    return s !== t ? [{ storylineId: id, before: s, after: t }] : []
  })
  return { acts: changes, storylines }
}
