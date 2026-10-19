import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { act, actOutcome, board, entity, actEntity, storyline, storyTrigger, type ActRow, type OutcomeRow, type TriggerRow } from '../db/schema'
import type { RowStatus, StorylineStatus } from '../../shared/schemas'
import { formatClock } from '../../shared/time'
import type { HistoryView, TimelineView, TriggerEffectView, WhatIfView } from '../../shared/types'
import { projectTimeline, whatIf, type TimelineInput } from '../engine/timeline'
import { part } from './part'
import type { Campaign } from './campaign'
import { toOutcomeView, toEffect, checkSpan } from './common'

export const timelinePart = part({
  // ---- timeline: acts, outcomes, triggers ------------------------------------

  timelineRows() {
    const stories = this.db.select().from(storyline).where(eq(storyline.removed, false)).all()
    const storyIds = new Set(stories.map((s) => s.id))
    const acts = this.db.select().from(act).where(eq(act.status, 'active')).all().filter((a) => storyIds.has(a.storylineId))
    const actIds = new Set(acts.map((a) => a.id))
    const outcomes = this.db.select().from(actOutcome).where(eq(actOutcome.status, 'active')).orderBy(asc(actOutcome.sort)).all()
      .filter((o) => actIds.has(o.actId))
    const outcomeIds = new Set(outcomes.map((o) => o.id))
    const triggers = this.db.select().from(storyTrigger).orderBy(asc(storyTrigger.createdAt)).all()
    return { stories, acts, outcomes, outcomeIds, actIds, storyIds, triggers }
  },

  engineInput(rows: ReturnType<Campaign['timelineRows']>, nowMin: number): TimelineInput {
    return {
      nowMin,
      storylines: rows.stories.map((s) => ({ id: s.id, status: s.status as StorylineStatus })),
      acts: rows.acts.map((a, i) => ({
        id: a.id, storylineId: a.storylineId, number: i, startMin: a.startMin, endMin: a.endMin,
        chosenOutcomeId: a.chosenOutcomeId && rows.outcomeIds.has(a.chosenOutcomeId) ? a.chosenOutcomeId : null
      })),
      outcomes: rows.outcomes.map((o) => ({ id: o.id, actId: o.actId, isDefault: o.isDefault })),
      triggers: rows.triggers
        .filter((t) => t.status === 'active' && rows.actIds.has(t.sourceActId) && rows.storyIds.has(t.targetStorylineId))
        .map((t) => ({
          id: t.id, sourceActId: t.sourceActId, outcomeId: t.outcomeId, targetStorylineId: t.targetStorylineId,
          effect: toEffect(t)
        }))
    }
  },

  timeline(): TimelineView {
    const nowMin = this.info().clockMin
    const rows = this.timelineRows()
    const projection = projectTimeline(this.engineInput(rows, nowMin))
    const boardOf = new Map(this.db.select().from(board).all().map((b) => [b.storylineId, b.id]))
    const actNumber = new Map<string, number>()
    for (const s of rows.stories) {
      rows.acts.filter((a) => a.storylineId === s.id).sort((a, b) => a.startMin - b.startMin)
        .forEach((a, i) => actNumber.set(a.id, i + 1))
    }
    const fired = new Map(projection.fired.map((f) => [f.triggerId, f.atMin]))
    const names = new Map(this.db.select({ id: entity.id, name: entity.name, status: entity.status }).from(entity).all()
      .filter((e) => e.status !== 'defunct').map((e) => [e.id, e.name]))
    const actCards = new Map<string, Array<{ id: string; name: string }>>()
    for (const l of this.db.select().from(actEntity).where(eq(actEntity.status, 'active')).all()) {
      const name = names.get(l.entityId)
      if (name) actCards.set(l.actId, [...(actCards.get(l.actId) ?? []), { id: l.entityId, name }])
    }
    // Labels follow creation order over every trigger ever made, so they never renumber.
    const labels = new Map(rows.triggers.map((t, i) => [t.id, `T${i + 1}`]))
    return {
      nowMin,
      moonOffsetDays: Number(this.setting('moon_offset_days') ?? 0),
      storylines: rows.stories.map((s) => ({
        storylineId: s.id, boardId: boardOf.get(s.id) ?? '', title: s.title, status: s.status as StorylineStatus,
        projectedStatus: projection.storylineStatus.get(s.id) ?? (s.status as StorylineStatus),
        isMajor: s.isMajor, emblem: s.emblem, colour: s.colour
      })),
      acts: rows.acts.map((a) => {
        const p = projection.acts.get(a.id)!
        return {
          id: a.id, storylineId: a.storylineId, number: actNumber.get(a.id) ?? 0, title: a.title, summary: a.summary,
          plannedStartMin: a.startMin, plannedEndMin: a.endMin, startMin: p.startMin, endMin: p.endMin,
          shiftedBy: p.shiftedBy, chosenOutcomeId: a.chosenOutcomeId, state: p.state, outcomeId: p.outcomeId,
          resolvedBy: p.resolvedBy, forcedOutcomeId: p.forcedOutcomeId, defaultOutcomeId: p.defaultOutcomeId,
          outcomes: rows.outcomes.filter((o) => o.actId === a.id).map(toOutcomeView),
          cards: actCards.get(a.id) ?? []
        }
      }).sort((a, b) => a.startMin - b.startMin),
      triggers: rows.triggers
        .filter((t) => t.status === 'active' && rows.actIds.has(t.sourceActId))
        .map((t) => ({
          id: t.id, label: labels.get(t.id)!, sourceActId: t.sourceActId, outcomeId: t.outcomeId,
          targetStorylineId: t.targetStorylineId, effect: toEffect(t) as TriggerEffectView, note: t.note,
          firedAtMin: fired.get(t.id) ?? null
        }))
    }
  },

  createAct(input: { storylineId: string; title: string; startMin: number; endMin: number }): string {
    const s = this.storylineRow(input.storylineId)
    checkSpan(input.startMin, input.endMin)
    const id = randomUUID()
    this.log.run(`Added act ${input.title} to ${s.title}`, (w) => {
      w.insert('act', {
        id, storylineId: s.id, title: input.title, summary: '', startMin: input.startMin, endMin: input.endMin,
        chosenOutcomeId: null, status: 'active'
      })
      // Every act starts with the outcome that happens if nobody intervenes.
      w.insert('act_outcome', {
        id: randomUUID(), actId: id, label: 'If nobody intervenes', description: '', isDefault: true, sort: 0, status: 'active'
      })
    })
    return id
  },

  updateAct(id: string, patch: { title?: string; summary?: string; startMin?: number; endMin?: number }): void {
    const a = this.actRow(id)
    checkSpan(patch.startMin ?? a.startMin, patch.endMin ?? a.endMin)
    this.log.run(`Edited act ${patch.title ?? a.title}`, (w) => { w.update('act', id, patch) })
  },

  setActStatus(id: string, status: RowStatus): void {
    const a = this.actRow(id)
    this.log.run(status === 'defunct' ? `Moved act ${a.title} to History` : `Restored act ${a.title}`, (w) => {
      w.update('act', id, { status })
    })
  },

  /** The DM records what happened in an act (null clears it). This is the approval step for outcomes. */
  chooseOutcome(actId: string, outcomeId: string | null): void {
    const a = this.actRow(actId)
    const o = outcomeId ? this.outcomeRow(outcomeId) : null
    if (o && o.actId !== actId) throw new Error('That outcome belongs to another act')
    this.log.run(o ? `${a.title} ended: ${o.label}` : `Cleared the outcome of ${a.title}`, (w) => {
      w.update('act', actId, { chosenOutcomeId: outcomeId })
    })
  },

  addOutcome(actId: string, label: string): string {
    const a = this.actRow(actId)
    const sort = this.db.select().from(actOutcome).where(eq(actOutcome.actId, actId)).all().reduce((m, o) => Math.max(m, o.sort + 1), 0)
    const id = randomUUID()
    this.log.run(`Added outcome ${label} to ${a.title}`, (w) => {
      w.insert('act_outcome', { id, actId, label, description: '', isDefault: false, sort, status: 'active' })
    })
    return id
  },

  /** Edits an outcome. Making it the default takes the default away from the act's other outcomes. */
  updateOutcome(id: string, patch: { label?: string; description?: string; isDefault?: boolean }): void {
    const o = this.outcomeRow(id)
    this.log.run(`Edited outcome ${patch.label ?? o.label}`, (w) => {
      if (patch.isDefault) {
        for (const other of this.db.select().from(actOutcome).where(eq(actOutcome.actId, o.actId)).all()) {
          if (other.id !== id && other.isDefault) w.update('act_outcome', other.id, { isDefault: false })
        }
      }
      w.update('act_outcome', id, patch)
    })
  },

  setOutcomeStatus(id: string, status: RowStatus): void {
    const o = this.outcomeRow(id)
    this.log.run(status === 'defunct' ? `Removed outcome ${o.label}` : `Restored outcome ${o.label}`, (w) => {
      w.update('act_outcome', id, { status })
      const a = this.actRow(o.actId)
      if (status === 'defunct' && a.chosenOutcomeId === id) w.update('act', a.id, { chosenOutcomeId: null })
    })
  },

  addTrigger(input: { sourceActId: string; outcomeId: string; targetStorylineId: string; effect: TriggerEffectView; note?: string }): string {
    const a = this.actRow(input.sourceActId)
    const o = this.outcomeRow(input.outcomeId)
    if (o.actId !== a.id) throw new Error('That outcome belongs to another act')
    this.storylineRow(input.targetStorylineId)
    const id = randomUUID()
    const { type, ...payload } = input.effect
    this.log.run(`Added a trigger from ${a.title}`, (w) => {
      w.insert('story_trigger', {
        id, sourceActId: a.id, outcomeId: o.id, targetStorylineId: input.targetStorylineId, effectType: type,
        payload, note: input.note ?? '', createdAt: new Date().toISOString(), status: 'active'
      })
    })
    return id
  },

  updateTrigger(id: string, patch: { outcomeId?: string; targetStorylineId?: string; effect?: TriggerEffectView; note?: string }): void {
    const t = this.triggerRow(id)
    if (patch.outcomeId && this.outcomeRow(patch.outcomeId).actId !== t.sourceActId) throw new Error('That outcome belongs to another act')
    if (patch.targetStorylineId) this.storylineRow(patch.targetStorylineId)
    this.log.run('Edited a trigger', (w) => {
      const { effect, ...rest } = patch
      w.update('story_trigger', id, {
        ...rest,
        ...(effect ? { effectType: effect.type, payload: (({ type: _t, ...p }) => p)(effect) } : {})
      })
    })
  },

  setTriggerStatus(id: string, status: RowStatus): void {
    this.triggerRow(id)
    this.log.run(status === 'defunct' ? 'Removed a trigger' : 'Restored a trigger', (w) => { w.update('story_trigger', id, { status }) })
  },

  /** What would change if this act ended with that outcome. Nothing is saved. */
  whatIf(actId: string, outcomeId: string): WhatIfView {
    const view = this.timeline()
    const rows = this.timelineRows()
    const diff = whatIf(this.engineInput(rows, view.nowMin), actId, outcomeId)
    const acts = new Map(view.acts.map((a) => [a.id, a]))
    const titles = new Map(view.storylines.map((s) => [s.storylineId, s.title]))
    const outcomeLabel = new Map(view.acts.flatMap((a) => a.outcomes.map((o) => [o.id, o.label] as const)))
    const name = (id: string) => { const a = acts.get(id)!; return `${titles.get(a.storylineId)} · Act ${a.number} (${a.title})` }
    const lines = diff.acts.map((c) => {
      if (c.field === 'outcomeId') {
        return `${name(c.actId)}: ends "${c.after ? outcomeLabel.get(c.after as string) : 'with no outcome yet'}" instead of "${c.before ? outcomeLabel.get(c.before as string) : 'no outcome yet'}"`
      }
      if (c.field === 'startMin') return `${name(c.actId)}: starts ${formatClock(c.after as number)} instead of ${formatClock(c.before as number)}`
      if (c.field === 'endMin') return `${name(c.actId)}: ends ${formatClock(c.after as number)} instead of ${formatClock(c.before as number)}`
      const word = (st: unknown) => ({ upcoming: 'not started', running: 'in progress', resolved: 'over', awaiting: 'waiting for your outcome' } as Record<string, string>)[String(st)] ?? String(st)
      return `${name(c.actId)}: ${word(c.after)} instead of ${word(c.before)}`
    })
    const status = (st: string) => ({ inactive: 'not started', autonomous: 'running on its own', player_active: 'players active', concluded: 'concluded' } as Record<string, string>)[st] ?? st
    for (const s of diff.storylines) lines.push(`${titles.get(s.storylineId)}: ${status(s.after)} instead of ${status(s.before)}`)
    return { actId, outcomeId, lines }
  },

  removedTimeline(): Pick<HistoryView, 'removedActs' | 'removedOutcomes' | 'removedTriggers'> {
    const acts = this.db.select().from(act).all()
    const actTitle = new Map(acts.map((a) => [a.id, a.title]))
    const storyTitle = new Map(this.db.select().from(storyline).all().map((s) => [s.id, s.title]))
    const triggers = this.db.select().from(storyTrigger).orderBy(asc(storyTrigger.createdAt)).all()
    return {
      removedActs: acts.filter((a) => a.status === 'defunct')
        .map((a) => ({ id: a.id, title: a.title, storylineTitle: storyTitle.get(a.storylineId) ?? '?' })),
      removedOutcomes: this.db.select().from(actOutcome).where(eq(actOutcome.status, 'defunct')).all()
        .map((o) => ({ id: o.id, label: o.label, actTitle: actTitle.get(o.actId) ?? '?' })),
      removedTriggers: triggers.flatMap((t, i) => t.status === 'defunct'
        ? [{ id: t.id, label: `T${i + 1}`, actTitle: actTitle.get(t.sourceActId) ?? '?' }] : [])
    }
  },

  actRow(id: string): ActRow {
    const row = this.db.select().from(act).where(eq(act.id, id)).get()
    if (!row) throw new Error(`No act with id ${id}`)
    return row
  },

  outcomeRow(id: string): OutcomeRow {
    const row = this.db.select().from(actOutcome).where(eq(actOutcome.id, id)).get()
    if (!row) throw new Error(`No outcome with id ${id}`)
    return row
  },

  triggerRow(id: string): TriggerRow {
    const row = this.db.select().from(storyTrigger).where(eq(storyTrigger.id, id)).get()
    if (!row) throw new Error(`No trigger with id ${id}`)
    return row
  },

})
