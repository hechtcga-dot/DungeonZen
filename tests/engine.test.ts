import { describe, expect, it } from 'vitest'
import { applyOps, worldAt, type Delta } from '../src/main/engine/deltas'
import { projectTimeline, whatIf, type TimelineInput } from '../src/main/engine/timeline'

const DAY = 1440
let seq = 0
const delta = (p: Partial<Delta> & Pick<Delta, 'targetId' | 'atMin' | 'ops'>): Delta => ({
  id: `d${++seq}`, targetKind: 'entity', seq, origin: 'manual', supersededBy: null, scenarioId: null, ...p
})

describe('deltas and world state', () => {
  const base = new Map([['entity:ciaf', { location: 'District A', allies: ['Boneclaw'] }]])

  it('applies set, unset, list add and list remove', () => {
    expect(applyOps({ a: 1, list: ['x'] }, [
      { op: 'set', field: 'b', value: 2 }, { op: 'unset', field: 'a' },
      { op: 'list_add', field: 'list', value: 'y' }, { op: 'list_add', field: 'list', value: 'y' },
      { op: 'list_remove', field: 'list', value: 'x' }
    ])).toEqual({ b: 2, list: ['y'] })
  })

  it('shows the world at a time: only deltas at or before it, later wins', () => {
    const ds = [
      delta({ targetId: 'ciaf', atMin: 100, ops: [{ op: 'set', field: 'location', value: 'District B' }] }),
      delta({ targetId: 'ciaf', atMin: 200, ops: [{ op: 'set', field: 'location', value: 'District C' }] })
    ]
    expect(worldAt(base, ds, 50).get('entity:ciaf')?.location).toBe('District A')
    expect(worldAt(base, ds, 150).get('entity:ciaf')?.location).toBe('District B')
    expect(worldAt(base, ds, 200).get('entity:ciaf')?.location).toBe('District C')
    // The base is never changed.
    expect(base.get('entity:ciaf')?.location).toBe('District A')
  })

  it('lets a DM change beat an autonomous one in the same minute, whatever the order made', () => {
    const ds = [
      delta({ targetId: 'ciaf', atMin: 100, origin: 'manual', ops: [{ op: 'set', field: 'location', value: 'Tavern' }] }),
      delta({ targetId: 'ciaf', atMin: 100, origin: 'autonomous', ops: [{ op: 'set', field: 'location', value: 'Docks' }] })
    ]
    expect(worldAt(base, ds, 100).get('entity:ciaf')?.location).toBe('Tavern')
  })

  it('ignores superseded deltas and keeps what-if drafts out of canon', () => {
    const ds = [
      delta({ targetId: 'ciaf', atMin: 10, supersededBy: 'x', ops: [{ op: 'set', field: 'location', value: 'Old plan' }] }),
      delta({ targetId: 'ciaf', atMin: 20, scenarioId: 'w1', ops: [{ op: 'set', field: 'location', value: 'What if' }] })
    ]
    expect(worldAt(base, ds, 100).get('entity:ciaf')?.location).toBe('District A')
    expect(worldAt(base, ds, 100, 'w1').get('entity:ciaf')?.location).toBe('What if')
  })

  it('adds and removes list items without replacing the list', () => {
    const ds = [
      delta({ targetId: 'ciaf', atMin: 10, ops: [{ op: 'list_add', field: 'allies', value: 'Mayor' }] }),
      delta({ targetId: 'ciaf', atMin: 20, ops: [{ op: 'list_remove', field: 'allies', value: 'Boneclaw' }] })
    ]
    expect(worldAt(base, ds, 30).get('entity:ciaf')?.allies).toEqual(['Mayor'])
  })
})

/** Two storylines: A (acts a1, a2) and B (acts b1, b2), each act with outcomes ok/bad, bad being the default. */
function world(over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    storylines: [{ id: 'A', status: 'autonomous' }, { id: 'B', status: 'autonomous' }],
    acts: [
      { id: 'a1', storylineId: 'A', number: 1, startMin: 0, endMin: DAY, chosenOutcomeId: null },
      { id: 'a2', storylineId: 'A', number: 2, startMin: DAY, endMin: 3 * DAY, chosenOutcomeId: null },
      { id: 'b1', storylineId: 'B', number: 1, startMin: 0, endMin: 2 * DAY, chosenOutcomeId: null },
      { id: 'b2', storylineId: 'B', number: 2, startMin: 2 * DAY, endMin: 4 * DAY, chosenOutcomeId: null }
    ],
    outcomes: ['a1', 'a2', 'b1', 'b2'].flatMap((act) => [
      { id: `${act}-ok`, actId: act, isDefault: false },
      { id: `${act}-bad`, actId: act, isDefault: true }
    ]),
    triggers: [],
    nowMin: 0,
    ...over
  }
}

describe('timeline projection', () => {
  it('runs an ignored storyline on its own with default outcomes', () => {
    const p = projectTimeline(world({ nowMin: DAY + 60 }))
    expect(p.acts.get('a1')).toMatchObject({ state: 'resolved', outcomeId: 'a1-bad', resolvedBy: 'default' })
    expect(p.acts.get('a2')).toMatchObject({ state: 'running', outcomeId: null })
    expect(p.acts.get('b1')?.state).toBe('running')
  })

  it("uses the DM's outcome over the default", () => {
    const w = world({ nowMin: DAY })
    w.acts[0].chosenOutcomeId = 'a1-ok'
    expect(projectTimeline(w).acts.get('a1')).toMatchObject({ outcomeId: 'a1-ok', resolvedBy: 'dm' })
  })

  it('waits for the DM on a storyline the players are in', () => {
    const p = projectTimeline(world({ storylines: [{ id: 'A', status: 'player_active' }, { id: 'B', status: 'inactive' }], nowMin: 2 * DAY }))
    expect(p.acts.get('a1')).toMatchObject({ state: 'awaiting', outcomeId: null })
    expect(p.acts.get('b1')).toMatchObject({ state: 'upcoming', outcomeId: null }) // inactive: does not move
  })

  it('shifts a later act of another storyline when a trigger fires', () => {
    const w = world({
      nowMin: DAY,
      triggers: [{ id: 'T1', sourceActId: 'a1', outcomeId: 'a1-bad', targetStorylineId: 'B', effect: { type: 'shift_act', actId: 'b2', minutes: DAY } }]
    })
    const p = projectTimeline(w)
    expect(p.fired).toEqual([{ triggerId: 'T1', atMin: DAY }])
    expect(p.acts.get('b2')).toMatchObject({ startMin: 3 * DAY, endMin: 5 * DAY, shiftedBy: DAY })
  })

  it('does not fire a trigger when the act ends with another outcome', () => {
    const w = world({
      nowMin: DAY,
      triggers: [{ id: 'T1', sourceActId: 'a1', outcomeId: 'a1-ok', targetStorylineId: 'B', effect: { type: 'shift_act', actId: 'b2', minutes: DAY } }]
    })
    expect(projectTimeline(w).fired).toEqual([])
  })

  it('forces an outcome on a later act and changes a storyline status', () => {
    const w = world({
      nowMin: 2 * DAY,
      triggers: [
        { id: 'T1', sourceActId: 'a1', outcomeId: 'a1-bad', targetStorylineId: 'B', effect: { type: 'force_outcome', actId: 'b1', outcomeId: 'b1-ok' } },
        { id: 'T2', sourceActId: 'b1', outcomeId: 'b1-ok', targetStorylineId: 'A', effect: { type: 'set_status', status: 'concluded' } }
      ]
    })
    const p = projectTimeline(w)
    expect(p.acts.get('b1')).toMatchObject({ outcomeId: 'b1-ok', resolvedBy: 'trigger' })
    expect(p.storylineStatus.get('A')).toBe('concluded')
    expect(p.fired.map((f) => f.triggerId)).toEqual(['T1', 'T2'])
  })

  it('never reaches back in time: shifting an act that already started does nothing', () => {
    const w = world({
      nowMin: 2 * DAY,
      triggers: [{ id: 'T1', sourceActId: 'b1', outcomeId: 'b1-bad', targetStorylineId: 'A', effect: { type: 'shift_act', actId: 'a2', minutes: DAY } }]
    })
    const p = projectTimeline(w)
    expect(p.fired).toHaveLength(1)
    expect(p.acts.get('a2')).toMatchObject({ startMin: DAY, shiftedBy: 0 })
  })

  it('cannot loop: triggers pointing at each other each fire once', () => {
    const w = world({
      nowMin: 10 * DAY,
      triggers: [
        { id: 'T1', sourceActId: 'a1', outcomeId: 'a1-bad', targetStorylineId: 'B', effect: { type: 'shift_act', actId: 'b2', minutes: 60 } },
        { id: 'T2', sourceActId: 'b2', outcomeId: 'b2-bad', targetStorylineId: 'A', effect: { type: 'shift_act', actId: 'a2', minutes: 60 } },
        { id: 'T3', sourceActId: 'a2', outcomeId: 'a2-bad', targetStorylineId: 'B', effect: { type: 'shift_act', actId: 'b2', minutes: 60 } }
      ]
    })
    const p = projectTimeline(w)
    // T1 (Day 1) moves b2 an hour later; T3 (Day 3) is too late to move b2, which already
    // started; T2 (b2's end) cannot move a2 back. Each fires exactly once.
    expect(p.fired).toEqual([
      { triggerId: 'T1', atMin: DAY }, { triggerId: 'T3', atMin: 3 * DAY }, { triggerId: 'T2', atMin: 4 * DAY + 60 }
    ])
    expect(p.acts.get('b2')).toMatchObject({ startMin: 2 * DAY + 60, shiftedBy: 60 })
    expect(p.acts.get('a2')).toMatchObject({ startMin: DAY, shiftedBy: 0 })
    expect([...p.acts.values()].every((a) => a.state === 'resolved')).toBe(true)
  })

  it('previews a what-if: a different outcome and everything it sets off', () => {
    const w = world({
      nowMin: 0,
      triggers: [{ id: 'T1', sourceActId: 'a1', outcomeId: 'a1-ok', targetStorylineId: 'B', effect: { type: 'shift_act', actId: 'b2', minutes: DAY } }]
    })
    const diff = whatIf(w, 'a1', 'a1-ok')
    expect(diff.acts).toEqual(expect.arrayContaining([
      { actId: 'a1', field: 'outcomeId', before: 'a1-bad', after: 'a1-ok' },
      { actId: 'b2', field: 'startMin', before: 2 * DAY, after: 3 * DAY },
      { actId: 'b2', field: 'endMin', before: 4 * DAY, after: 5 * DAY }
    ]))
    // The input itself is not changed.
    expect(w.acts[0].chosenOutcomeId).toBeNull()
  })
})
