import { factsText, summaryText, type SessionFacts } from '../../shared/sessionSummary'
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { entity, knowledge, logEntry, partyPosition,   relationship, reviewDecision, sessionPrep, prepItem } from '../db/schema'
import { type Writer } from './commandLog'
import type { EncounterFeedback, KnowledgeField, ReviewDecisionKind } from '../../shared/schemas'
import { formatClock } from '../../shared/time'
import type { ReviewConflict, ReviewProposal, ReviewView } from '../../shared/types'
import { part } from './part'
import { toSessionView, cap } from './common'

export const reviewPart = part({
  // ---- session review ---------------------------------------------------------

  /**
   * Everything a session changed or left open, for the DM to approve. Proposals
   * come from the engine (acts resolved by default, acts waiting for an outcome,
   * with the triggers they set off) and from the log (people the party met).
   * Nothing here writes; decide() does, one undo step per decision.
   */
  review(sessionId: string): ReviewView {
    const sRow = this.sessionRow(sessionId)
    const nowMin = this.info().clockMin
    const endMin = sRow.endMin ?? nowMin
    const decisions = this.decisions(sessionId)
    const logs = this.db.select().from(logEntry).where(and(eq(logEntry.sessionId, sessionId), eq(logEntry.status, 'active'))).all()
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
    const entities = new Map(this.db.select().from(entity).all().map((e) => [e.id, e]))

    // Conflicts: the log says they met someone who is in History.
    const conflicts: ReviewConflict[] = logs
      .filter((l) => l.kind === 'meeting' && l.entityId && entities.get(l.entityId)?.status === 'defunct')
      .map((l) => {
        const name = entities.get(l.entityId!)!.name
        return {
          key: `history-meet:${l.id}`,
          text: `Your log says the party met ${name} at ${formatClock(l.atMin)}, but ${name} is in History.`,
          quote: l.text || null,
          options: [
            { action: 'revive' as const, label: `The log is right: bring ${name} back` },
            { action: 'remove_entry' as const, label: 'The log is wrong: remove the entry' }
          ],
          decision: decisions.get(`history-meet:${l.id}`) ?? null
        }
      })

    // Acts: ended by this session's end without an outcome the DM approved.
    const tl = this.timeline()
    const storyTitle = new Map(tl.storylines.map((x) => [x.storylineId, x.title]))
    const actName = (id: string) => {
      const a = tl.acts.find((x) => x.id === id)
      return a ? `${storyTitle.get(a.storylineId)} · Act ${a.number} (${a.title})` : 'an act'
    }
    const proposals: ReviewProposal[] = []
    for (const a of tl.acts) {
      const decided = decisions.get(`act:${a.id}`)
      // Open items: ended by the session's end with no outcome the DM approved.
      // Items decided in this review stay listed with their decision.
      if (!decided) {
        if (a.chosenOutcomeId || a.endMin > endMin) continue
        if (!(a.state === 'awaiting' || (a.state === 'resolved' && a.resolvedBy !== 'dm'))) continue
      }
      const outcome = a.outcomes.find((o) => o.id === (a.chosenOutcomeId ?? a.outcomeId))
      const ripples = tl.triggers.filter((t) => t.sourceActId === a.id && t.firedAtMin !== null).map((t) => {
        const target = storyTitle.get(t.targetStorylineId) ?? '?'
        const e = t.effect
        const what = e.type === 'shift_act' ? `moves ${actName(e.actId)} ${e.minutes >= 0 ? 'later' : 'earlier'} by ${Math.abs(e.minutes) / 60} h`
          : e.type === 'force_outcome' ? `decides how ${actName(e.actId)} ends`
            : `sets ${target} to ${e.status.replace('_', ' ')}`
        return `${t.label}: ${what}`
      })
      proposals.push({
        kind: 'act',
        key: `act:${a.id}`,
        actId: a.id,
        what: `${storyTitle.get(a.storylineId)} · Act ${a.number} outcome`,
        sub: decided?.decision === 'approved' ? 'You decided this in the review.'
          : a.state === 'awaiting' ? 'The act has ended. The players were in it, so you decide.'
            : a.resolvedBy === 'trigger' ? 'A trigger decided this.' : 'Ignored by the players: ran on its own.',
        before: decided?.decision === 'approved' ? 'Open' : a.state === 'awaiting' ? 'Waiting' : 'In progress',
        after: outcome?.label ?? 'Choose an outcome',
        outcomeId: outcome?.id ?? null,
        outcomes: a.outcomes.map((o) => ({ id: o.id, label: o.label })),
        ripples,
        decision: decisions.get(`act:${a.id}`) ?? null
      })
    }

    // What the party knows: everyone met this session whose name is not yet known.
    const known = new Set(this.db.select().from(knowledge).where(eq(knowledge.status, 'active')).all()
      .map((k) => `${k.entityId}:${k.field}`))
    const met = [...new Set(logs.filter((l) => l.kind === 'meeting' && l.entityId).map((l) => l.entityId!))]
    for (const id of met) {
      const e = entities.get(id)
      if (!e || e.status === 'defunct') continue
      const decided = decisions.get(`know:${id}`)
      const unknown: KnowledgeField[] = (['name', 'location'] as const).filter((f) => !known.has(`${id}:${f}`))
      if (unknown.length === 0 && !decided) continue
      const fields: KnowledgeField[] = unknown.length ? unknown : ['name', 'location']
      const already = (['name', 'location'] as const).filter((f) => known.has(`${id}:${f}`))
      proposals.push({
        kind: 'knowledge', key: `know:${id}`, entityId: id,
        what: `${e.name} · what the party knows`, sub: 'They met this session.',
        before: decided?.decision === 'approved' ? 'DM only' : already.length ? already.map(cap).join(', ') : 'DM only',
        after: `Known to party: ${fields.map(cap).join(', ')}`,
        fields, decision: decided ?? null
      })
    }

    const fights = logs.filter((l) => l.kind === 'fight')
      .map((l) => ({ logId: l.id, atMin: l.atMin, text: l.text, feedback: (l.feedback as EncounterFeedback | null) ?? null }))
    return {
      session: toSessionView(sRow),
      during: { startMin: sRow.startMin, endMin, entries: logs.length, meetings: met.length },
      conflicts, proposals, fights
    }
  },

  decisions(sessionId: string): Map<string, { decision: ReviewDecisionKind; note: string }> {
    return new Map(this.db.select().from(reviewDecision)
      .where(and(eq(reviewDecision.sessionId, sessionId), eq(reviewDecision.status, 'active'))).all()
      .map((d) => [d.itemKey, { decision: d.decision as ReviewDecisionKind, note: d.note }]))
  },

  recordDecision(w: Writer, sessionId: string, itemKey: string, decision: ReviewDecisionKind, note = ''): void {
    const existing = this.db.select().from(reviewDecision)
      .where(and(eq(reviewDecision.sessionId, sessionId), eq(reviewDecision.itemKey, itemKey))).get()
    if (existing) w.update('review_decision', existing.id, { decision, note, status: 'active' })
    else w.insert('review_decision', { id: randomUUID(), sessionId, itemKey, decision, note, createdAt: new Date().toISOString(), status: 'active' })
  },

  /** One review decision, applied together with what it means, as one undo step. */
  decide(sessionId: string, input: {
    key: string
    action: 'approve' | 'reject' | 'flag' | 'explain' | 'revive' | 'remove_entry' | 'reopen'
    outcomeId?: string
    fields?: KnowledgeField[]
    note?: string
  }): void {
    const view = this.review(sessionId)
    const proposal = view.proposals.find((p) => p.key === input.key)
    const conflict = view.conflicts.find((c) => c.key === input.key)
    if (!proposal && !conflict) throw new Error('That review item is no longer open')
    const label = {
      approve: 'Approved', reject: 'Rejected', flag: 'Flagged', explain: 'Explained', revive: 'Resolved', remove_entry: 'Resolved', reopen: 'Reopened'
    }[input.action]
    const title = proposal?.what ?? conflict?.text ?? input.key
    this.log.run(`${label}: ${title}`, (w) => this.applyDecision(w, sessionId, input, proposal, conflict))
  },

  /** Approves every open proposal that is not flagged or rejected and has a clear outcome, as one undo step. */
  approveAllUnflagged(sessionId: string): number {
    const view = this.review(sessionId)
    const open = view.proposals.filter((p) => !p.decision && (p.kind !== 'act' || p.outcomeId))
    if (open.length === 0) return 0
    this.log.run(`Approved ${open.length} change${open.length === 1 ? '' : 's'} from session ${view.session.number}`, (w) => {
      for (const p of open) this.applyDecision(w, sessionId, { key: p.key, action: 'approve' }, p, undefined)
    })
    return open.length
  },

  applyDecision(
    w: Writer, sessionId: string,
    input: { key: string; action: string; outcomeId?: string; fields?: KnowledgeField[]; note?: string },
    proposal: ReviewProposal | undefined, conflict: ReviewConflict | undefined
  ): void {
    if (input.action === 'reopen') {
      const existing = this.db.select().from(reviewDecision)
        .where(and(eq(reviewDecision.sessionId, sessionId), eq(reviewDecision.itemKey, input.key))).get()
      if (existing) w.update('review_decision', existing.id, { status: 'defunct' })
      return
    }
    if (input.action === 'reject') return this.recordDecision(w, sessionId, input.key, 'rejected', input.note ?? '')
    if (input.action === 'flag') return this.recordDecision(w, sessionId, input.key, 'flagged', input.note ?? '')
    if (input.action === 'explain') return this.recordDecision(w, sessionId, input.key, 'explained', input.note ?? '')
    if (conflict) {
      const logId = input.key.slice('history-meet:'.length)
      const l = this.logRow(logId)
      if (input.action === 'revive' && l.entityId) w.update('entity', l.entityId, { status: 'active' })
      if (input.action === 'remove_entry') w.update('log_entry', logId, { status: 'defunct' })
      return this.recordDecision(w, sessionId, input.key, 'resolved', input.note ?? '')
    }
    if (!proposal || input.action !== 'approve') throw new Error('Nothing to approve')
    if (proposal.kind === 'act') {
      const outcomeId = input.outcomeId ?? proposal.outcomeId
      if (!outcomeId || !proposal.outcomes.some((o) => o.id === outcomeId)) throw new Error('Choose an outcome first')
      w.update('act', proposal.actId, { chosenOutcomeId: outcomeId })
    } else {
      const fields = input.fields ?? proposal.fields
      const now = this.info().clockMin
      for (const field of fields) {
        const existing = this.db.select().from(knowledge)
          .where(and(eq(knowledge.entityId, proposal.entityId), eq(knowledge.field, field))).get()
        if (existing) w.update('knowledge', existing.id, { status: 'active', knownFromMin: now })
        else w.insert('knowledge', { id: randomUUID(), entityId: proposal.entityId, field, knownFromMin: now, status: 'active' })
      }
    }
    this.recordDecision(w, sessionId, input.key, 'approved', input.note ?? '')
  },

  setFeedback(logId: string, feedback: EncounterFeedback | null): void {
    const l = this.logRow(logId)
    this.log.run(`Rated a fight${l.text ? `: ${l.text}` : ''}`, (w) => { w.update('log_entry', logId, { feedback }) })
  },

  /**
   * A recap for the players, drafted from the log: meetings name only people
   * whose name the party knows, everyone else is "a stranger". Not saved.
   */
  draftPlayerRecap(sessionId: string): string {
    this.sessionRow(sessionId)
    const known = new Set(this.db.select().from(knowledge).where(and(eq(knowledge.status, 'active'), eq(knowledge.field, 'name'))).all()
      .map((k) => k.entityId))
    const names = new Map(this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name]))
    return this.db.select().from(logEntry).where(and(eq(logEntry.sessionId, sessionId), eq(logEntry.status, 'active'))).all()
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
      .map((l) => {
        const when = formatClock(l.atMin)
        if (l.kind === 'meeting') {
          const who = l.entityId && known.has(l.entityId) ? names.get(l.entityId) : 'a stranger'
          return `${when}: The party met ${who}.`
        }
        if (l.kind === 'fight') return `${when}: A fight${l.text ? `: ${l.text}` : '.'}`
        if (l.kind === 'quest') return `${when}: A quest was delivered${l.text ? `: ${l.text}` : '.'}`
        if (l.kind === 'rest') return `${when}: ${l.text || 'The party rested.'}`
        return `${when}: ${l.text}`
      }).join('\n')
  },

  /** What the AI recap reads: the log (player-safe draft for the players), the session's DM notes, and the recap so far. */
  /** The plain summary from the session's facts (no AI); the DM keeps or edits it. */
  summaryDraft(sessionId: string): string {
    return summaryText(this.sessionFacts(sessionId))
  },

  /** What the table did this session, for its summary (owner, 2026-10-18): places, people met, clues, scenes, fights, log moments, Live notes. */
  sessionFacts(sessionId: string): SessionFacts {
    const s = this.sessionRow(sessionId)
    const cards = new Map(this.db.select().from(entity).all().map((e) => [e.id, e]))
    const card = (id: string | null | undefined) => (id ? cards.get(id) : undefined)
    const brief = (id: string | null | undefined) => {
      const e = card(id)
      return e ? { name: e.name, about: typeof e.attributes.summary === 'string' ? e.attributes.summary : '' } : null
    }
    const placeOf = (id: string) => {
      const r = this.db.select().from(relationship).where(and(eq(relationship.sourceId, id), eq(relationship.type, 'LOCATED_AT'), eq(relationship.status, 'active'))).get()
      return card(r?.targetId)?.name ?? null
    }
    const startRow = this.db.select().from(partyPosition).where(eq(partyPosition.status, 'active')).all()
      .filter((p) => !p.entityId && p.atMin <= s.startMin && p.locationId)
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt)).at(-1)
    const log = this.db.select().from(logEntry).where(and(eq(logEntry.sessionId, sessionId), eq(logEntry.status, 'active'))).all()
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
    const prep = this.db.select().from(sessionPrep).where(and(eq(sessionPrep.number, s.number), eq(sessionPrep.status, 'active'))).get()
    const items = prep ? this.db.select().from(prepItem).where(and(eq(prepItem.prepId, prep.id), eq(prepItem.status, 'active'), eq(prepItem.done, true))).all().sort((a, b) => a.sort - b.sort) : []
    const uniq = <T extends { name: string }>(xs: Array<T | null>) => xs.filter((x, i, all): x is T => !!x && all.findIndex((y) => y?.name === x.name) === i)
    const encounters = new Set(this.encounterCards().map((e) => e.id))
    const fights = log.filter((l) => l.kind === 'fight').map((l) => {
      const enc = card(l.encounterId)
      return { name: enc?.name ?? l.text.split('\n')[0].slice(0, 120), place: enc ? placeOf(enc.id) : null }
    })
    for (const i of items.filter((x) => x.kind === 'scene' && x.entityId && encounters.has(x.entityId))) {
      const enc = card(i.entityId)!
      if (!fights.some((f) => f.name === enc.name)) fights.push({ name: enc.name, place: placeOf(enc.id) })
    }
    return {
      number: s.number,
      start: brief(startRow?.locationId),
      places: uniq(log.filter((l) => l.kind === 'travel' && l.entityId && card(l.entityId)?.type !== 'PC').map((l) => brief(l.entityId))),
      npcs: uniq([...log.filter((l) => l.kind === 'meeting').map((l) => brief(l.entityId)), ...items.filter((i) => i.kind === 'npc').map((i) => brief(i.entityId) ?? (i.title ? { name: i.title, about: i.description } : null))]),
      clues: items.filter((i) => i.kind === 'discovery').map((i) => (i.body || i.title).trim()).filter(Boolean),
      scenes: items.filter((i) => i.kind === 'scene' && !(i.entityId && encounters.has(i.entityId)) && i.title.trim()).map((i) => ({ title: i.title.trim(), place: card(i.locationId)?.name ?? null })),
      fights,
      events: log.filter((l) => l.kind === 'note' || l.kind === 'quest' || l.kind === 'rest').map((l) => l.text.trim()).filter(Boolean),
      notes: s.dmNotes
    }
  },

  recapSources(sessionId: string, playerSafe: boolean): { number: number; log: string; notes: string; current: string; facts: string } {
    const s = this.sessionRow(sessionId)
    const names = new Map(this.db.select({ id: entity.id, name: entity.name }).from(entity).all().map((e) => [e.id, e.name]))
    const log = playerSafe ? this.draftPlayerRecap(sessionId) : this.db.select().from(logEntry)
      .where(and(eq(logEntry.sessionId, sessionId), eq(logEntry.status, 'active'))).all()
      .sort((a, b) => a.atMin - b.atMin || a.createdAt.localeCompare(b.createdAt))
      .map((l) => `${formatClock(l.atMin)} (${l.kind}): ${[l.entityId ? names.get(l.entityId) : '', l.text].filter(Boolean).join(': ')}`).join('\n')
    return { number: s.number, log, notes: playerSafe ? '' : s.dmNotes, current: playerSafe ? s.playerRecap : s.recap, facts: playerSafe ? '' : factsText(this.sessionFacts(sessionId)) }
  },

  /** Undoes everything since the session started (the session itself included). Redo brings it back. */
  undoSession(sessionId: string): number {
    const started = this.log.recent(5000).find((c) => c.state === 'done' &&
      c.payload.some((ch) => ch.table === 'session' && ch.id === sessionId && ch.before === null))
    if (!started) throw new Error('The start of this session is no longer in the change log')
    return this.undoTo(started.id)
  },

})
