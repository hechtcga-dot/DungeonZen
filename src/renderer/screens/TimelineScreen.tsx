import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useBoard } from '../store'
import { DeskFrame } from '../components/DeskFrame'
import { TopBar } from '../components/TopBar'
import { CommitField } from '../components/fields'
import { StorylineDialog, STORYLINE_STATUS_LABELS } from '../components/EditDialogs'
import { Dialog } from '../components/Dialog'
import { moonOn } from '../../shared/sky'
import { formatClock, fromClockParts, MINUTES_PER_DAY, toClockParts } from '../../shared/time'
import { StorylineStatus } from '../../shared/schemas'
import type { ActView, TimelineStoryline, TimelineView, TriggerEffectView, TriggerView, WhatIfView } from '../../shared/types'

const LANE_HEAD = 220
const LANE_H = 120
const ZOOMS = [60, 90, 140, 200, 300, 420] // pixels per day

export function TimelineScreen() {
  const timeline = useBoard((s) => s.timeline)
  return (
    <DeskFrame>
      <TopBar />
      {timeline ? <Timeline t={timeline} /> : <p className="desk-loading">Unrolling the timeline…</p>}
    </DeskFrame>
  )
}

function actLabel(t: TimelineView, a: ActView): string {
  const s = t.storylines.find((x) => x.storylineId === a.storylineId)
  return `${s?.title ?? '?'} · Act ${a.number}`
}

function effectText(t: TimelineView, e: TriggerEffectView): string {
  const act = (id: string) => t.acts.find((a) => a.id === id)
  if (e.type === 'shift_act') {
    const a = act(e.actId)
    const h = Math.abs(e.minutes) / 60
    const span = h % 24 === 0 ? `${h / 24} day${h / 24 === 1 ? '' : 's'}` : `${h} h`
    return `move ${a ? `Act ${a.number} (${a.title})` : 'an act'} ${e.minutes >= 0 ? 'later' : 'earlier'} by ${span}`
  }
  if (e.type === 'force_outcome') {
    const a = act(e.actId)
    const o = a?.outcomes.find((x) => x.id === e.outcomeId)
    return `make ${a ? `Act ${a.number} (${a.title})` : 'an act'} end "${o?.label ?? '?'}"`
  }
  return `set the storyline to "${STORYLINE_STATUS_LABELS[e.status]}"`
}

function Timeline({ t }: { t: TimelineView }) {
  const [zoom, setZoom] = useState(2)
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ storylineId: string; startMin: number } | null>(null)
  const [editStory, setEditStory] = useState<TimelineStoryline | null>(null)
  const pxPerDay = ZOOMS[zoom]
  const pxPerMin = pxPerDay / MINUTES_PER_DAY
  const lastMin = Math.max(t.nowMin, ...t.acts.map((a) => Math.max(a.endMin, a.plannedEndMin)))
  const days = Math.max(7, Math.ceil(lastMin / MINUTES_PER_DAY) + 2)
  const width = days * pxPerDay
  const laneIndex = new Map(t.storylines.map((s, i) => [s.storylineId, i]))
  const selectedAct = t.acts.find((a) => a.id === selected) ?? null

  useEffect(() => { if (selected && !t.acts.some((a) => a.id === selected)) setSelected(null) }, [t, selected])

  // Day headers with notable moon phases.
  const dayHeads = useMemo(() => Array.from({ length: days }, (_, d) => {
    const moon = moonOn(d * MINUTES_PER_DAY + 22 * 60, t.moonOffsetDays)
    const note = moon.name === 'Full moon' ? 'Full moon' : moon.name === 'New moon' ? 'New moon' : ''
    return { day: d + 1, note }
  }), [days, t.moonOffsetDays])

  return (
    <>
      <div className="page-head">
        <div className="page-title"><h1>Timeline</h1></div>
        <div className="row tight wrap">
          <button className="brass icon" aria-label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => z - 1)}>−</button>
          <span className="zoom-label mono" aria-live="polite">{pxPerDay} px a day</span>
          <button className="brass icon" aria-label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => z + 1)}>+</button>
          <button className="brass" onClick={() => document.getElementById('tl-now')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })}>
            Jump to now
          </button>
        </div>
      </div>
      <div className="timeline-layout">
        <section className="panel timeline-sheet" aria-label="Storyline lanes">
          {t.storylines.length === 0 ? (
            <div className="timeline-empty">
              <h2 className="panel-heading">No storylines yet</h2>
              <p className="hint">Add a storyline on the desk or the board, then give it acts here.</p>
            </div>
          ) : (
            <div className="tl-scroll">
              <div className="tl-grid" style={{ width: LANE_HEAD + width }}>
                <div className="tl-days" style={{ marginLeft: LANE_HEAD, width }}>
                  {dayHeads.map((d) => (
                    <div key={d.day} className="tl-day" style={{ width: pxPerDay }}>
                      <span className="tl-day-name">Day {d.day}</span>
                      {d.note && <span className={`tl-day-note${d.note === 'Full moon' ? ' full' : ''}`}>{d.note}</span>}
                    </div>
                  ))}
                </div>
                {t.storylines.map((s) => (
                  <div key={s.storylineId} className="tl-lane" style={{ height: LANE_H }}>
                    <div className="tl-lane-head" style={{ width: LANE_HEAD }}>
                      <button className="tl-lane-title" onClick={() => setEditStory(s)} title={`${s.title} (edit storyline)`}>{s.title}</button>
                      <span className="tl-lane-row">
                        <span className="tl-lane-kind">{s.isMajor ? 'Major' : 'Minor'}</span>
                        <span className={`tl-status st-${s.projectedStatus}`}>{STORYLINE_STATUS_LABELS[s.projectedStatus]}</span>
                      </span>
                      {s.projectedStatus !== s.status && <span className="tl-lane-kind">after a trigger (now: {STORYLINE_STATUS_LABELS[s.status]})</span>}
                      <button className="tl-add" onClick={() => setAdding({ storylineId: s.storylineId, startMin: Math.floor(t.nowMin / MINUTES_PER_DAY) * MINUTES_PER_DAY })}
                        aria-label={`Add an act to ${s.title}`}>+ Act</button>
                    </div>
                    <div
                      className="tl-track" style={{ width, ['--day' as string]: `${pxPerDay}px` }}
                      onDoubleClick={(e) => {
                        const x = e.clientX - e.currentTarget.getBoundingClientRect().left
                        const day = Math.floor(x / pxPerDay)
                        setAdding({ storylineId: s.storylineId, startMin: day * MINUTES_PER_DAY })
                      }}
                      title="Double-click an empty spot to add an act there"
                    >
                      {t.acts.filter((a) => a.storylineId === s.storylineId).map((a) => (
                        <ActBlock key={a.id} a={a} s={s} pxPerMin={pxPerMin} selected={a.id === selected}
                          onSelect={() => setSelected(a.id)} />
                      ))}
                    </div>
                  </div>
                ))}
                <TriggerLines t={t} pxPerMin={pxPerMin} laneIndex={laneIndex} />
                <div id="tl-now" className="tl-now" style={{ left: LANE_HEAD + t.nowMin * pxPerMin, top: 0, height: 44 + t.storylines.length * LANE_H }}>
                  <span>NOW · {formatClock(t.nowMin)}</span>
                </div>
              </div>
            </div>
          )}
          <div className="tl-legend" aria-label="Legend">
            <span><i className="sw sw-running" />In progress with players</span>
            <span><i className="sw sw-default" />Resolves by default if ignored</span>
            <span><i className="sw sw-awaiting" />Needs your outcome</span>
            <span><i className="sw sw-resolved" />Over</span>
            <span><i className="sw sw-trigger" />Cross-storyline trigger</span>
            <span><i className="sw sw-now" />Current time</span>
          </div>
        </section>
        <aside className="panel timeline-side" aria-label="Selected act">
          {selectedAct ? <ActPanel key={selectedAct.id} t={t} a={selectedAct} onClose={() => setSelected(null)} />
            : (
              <>
                <h2 className="panel-heading">Acts and outcomes</h2>
                <p className="hint">Select an act to see its outcomes, choose what happened, add triggers and preview a what-if.</p>
                <p className="hint">Storylines the players ignore move on by themselves: when an act's time is up, its default outcome happens. You approve it by choosing it.</p>
                <p className="hint">Double-click an empty spot in a lane, or use + Act, to add an act.</p>
              </>
            )}
        </aside>
      </div>
      {adding && <AddActDialog t={t} initial={adding} onClose={() => setAdding(null)} onAdded={(id) => setSelected(id)} />}
      {editStory && (
        <StorylineDialog open onClose={() => setEditStory(null)} storylineId={editStory.storylineId}
          detail={{ title: editStory.title, status: editStory.status, isMajor: editStory.isMajor, emblem: editStory.emblem }} />
      )}
    </>
  )
}

function ActBlock({ a, s, pxPerMin, selected, onSelect }: {
  a: ActView; s: TimelineStoryline; pxPerMin: number; selected: boolean; onSelect(): void
}) {
  const left = a.startMin * pxPerMin
  const w = Math.max(28, (a.endMin - a.startMin) * pxPerMin - 4)
  const willDefault = a.state !== 'resolved' && s.projectedStatus === 'autonomous' && !!a.defaultOutcomeId && !a.chosenOutcomeId
  const kind = a.state === 'resolved' ? 'resolved' : a.state === 'awaiting' ? 'awaiting'
    : a.state === 'running' && s.projectedStatus === 'player_active' ? 'running' : willDefault ? 'default' : 'plain'
  const outcome = a.outcomes.find((o) => o.id === a.outcomeId)
  const stateText = a.state === 'resolved'
    ? `ended: ${outcome?.label ?? '?'}${a.resolvedBy === 'default' ? ' (by default, not yet approved)' : a.resolvedBy === 'trigger' ? ' (forced by a trigger)' : ''}`
    : a.state === 'awaiting' ? 'needs your outcome' : a.state === 'running' ? 'in progress' : 'upcoming'
  return (
    <>
      {a.shiftedBy !== 0 && (
        <div className="tl-ghost" aria-hidden="true"
          style={{ left: a.plannedStartMin * pxPerMin, width: Math.max(28, (a.plannedEndMin - a.plannedStartMin) * pxPerMin - 4) }} />
      )}
      <button className={`tl-act k-${kind}${selected ? ' is-selected' : ''}`} style={{ left, width: w }} onClick={onSelect}
        aria-label={`Act ${a.number}, ${a.title}, ${formatClock(a.startMin)} to ${formatClock(a.endMin)}, ${stateText}`}>
        <span className="tl-act-title">Act {a.number} · {a.title}</span>
        <span className="tl-act-when">{formatClock(a.startMin)} → {formatClock(a.endMin)}</span>
        <span className="tl-act-state">{stateText}{a.shiftedBy !== 0 ? ` · moved ${a.shiftedBy > 0 ? 'later' : 'earlier'}` : ''}</span>
      </button>
    </>
  )
}

/** Dotted connectors from where a trigger fires (end of its act) down or up to the storyline it affects. */
function TriggerLines({ t, pxPerMin, laneIndex }: { t: TimelineView; pxPerMin: number; laneIndex: Map<string, number> }) {
  return (
    <>
      {t.triggers.map((tr) => {
        const src = t.acts.find((a) => a.id === tr.sourceActId)
        if (!src) return null
        const from = laneIndex.get(src.storylineId)
        const to = laneIndex.get(tr.targetStorylineId)
        if (from === undefined || to === undefined) return null
        const x = LANE_HEAD + src.endMin * pxPerMin - 2
        const y1 = 44 + Math.min(from, to) * LANE_H + LANE_H / 2
        const y2 = 44 + Math.max(from, to) * LANE_H + LANE_H / 2
        return (
          <div key={tr.id} className={`tl-trigger${tr.firedAtMin !== null ? ' fired' : ''}`} style={{ left: x, top: y1, height: Math.max(24, y2 - y1) }}
            title={`${tr.label}: ${effectText(t, tr.effect)}`}>
            <span className="tl-badge" style={{ top: -12 }}>{tr.label}</span>
            {y2 > y1 && <span className="tl-badge" style={{ bottom: -12 }}>{tr.label}</span>}
          </div>
        )
      })}
    </>
  )
}

function DayTime({ id, label, value, onChange }: { id: string; label: string; value: number; onChange(min: number): void }) {
  const p = toClockParts(value)
  return (
    <fieldset className="field daytime">
      <legend>{label}</legend>
      <div className="row tight">
        <label htmlFor={`${id}-day`}>Day</label>
        <input id={`${id}-day`} className="short" type="number" min={1} value={p.day}
          onChange={(e) => onChange(fromClockParts({ ...p, day: Math.max(1, Number(e.target.value) || 1) }))} />
        <label htmlFor={`${id}-hour`}>at</label>
        <input id={`${id}-hour`} className="short" type="number" min={0} max={23} value={p.hour}
          onChange={(e) => onChange(fromClockParts({ ...p, hour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) }))} />
        <span>:00</span>
      </div>
    </fieldset>
  )
}

function AddActDialog({ t, initial, onClose, onAdded }: {
  t: TimelineView; initial: { storylineId: string; startMin: number }; onClose(): void; onAdded(id: string): void
}) {
  const act = useBoard((s) => s.act)
  const [storylineId, setStorylineId] = useState(initial.storylineId)
  const [title, setTitle] = useState('')
  const [start, setStart] = useState(initial.startMin)
  const [end, setEnd] = useState(initial.startMin + MINUTES_PER_DAY)
  const valid = title.trim() !== '' && end > start
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    const id = await act('act:create', { storylineId, title: title.trim(), startMin: start, endMin: end })
    if (id) { onAdded(id); onClose() }
  }
  return (
    <Dialog title="Add an act" open onClose={onClose}>
      <form className="dz-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="na-story">Storyline</label>
          <select id="na-story" value={storylineId} onChange={(e) => setStorylineId(e.target.value)}>
            {t.storylines.map((s) => <option key={s.storylineId} value={s.storylineId}>{s.title}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="na-title">Act title</label>
          <input id="na-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>
        <DayTime id="na-start" label="Starts" value={start} onChange={(m) => { setStart(m); if (end <= m) setEnd(m + MINUTES_PER_DAY) }} />
        <DayTime id="na-end" label="Ends" value={end} onChange={setEnd} />
        {end <= start && <div className="field-error">The act must end after it starts.</div>}
        <p className="hint">The act starts with one outcome, "If nobody intervenes", which is what happens if the players ignore it. Add more outcomes afterwards.</p>
        <div className="dz-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!valid}>Add act</button>
        </div>
      </form>
    </Dialog>
  )
}

function ActPanel({ t, a, onClose }: { t: TimelineView; a: ActView; onClose(): void }) {
  const act = useBoard((s) => s.act)
  const [start, setStart] = useState(a.plannedStartMin)
  const [end, setEnd] = useState(a.plannedEndMin)
  const [newOutcome, setNewOutcome] = useState('')
  const [preview, setPreview] = useState<WhatIfView | null>(null)
  const [addingTrigger, setAddingTrigger] = useState(false)
  const timesChanged = start !== a.plannedStartMin || end !== a.plannedEndMin
  const triggers = t.triggers.filter((x) => x.sourceActId === a.id)
  const incoming = t.triggers.filter((x) => x.effect.type !== 'set_status' && 'actId' in x.effect && x.effect.actId === a.id)

  return (
    <div className="act-panel">
      <div className="row spread">
        <h2 className="panel-heading">{actLabel(t, a)}</h2>
        <button aria-label="Close" onClick={onClose}>×</button>
      </div>
      <CommitField id={`act-${a.id}-title`} label="Title" value={a.title} required onCommit={(title) => void act('act:update', { id: a.id, patch: { title } })} />
      <CommitField id={`act-${a.id}-summary`} label="What happens in this act" value={a.summary} multiline rows={3}
        onCommit={(summary) => void act('act:update', { id: a.id, patch: { summary } })} />
      <DayTime id={`act-${a.id}-start`} label="Planned start" value={start} onChange={setStart} />
      <DayTime id={`act-${a.id}-end`} label="Planned end" value={end} onChange={setEnd} />
      {timesChanged && (
        <div className="row tight">
          <button className="primary" disabled={end <= start} onClick={() => void act('act:update', { id: a.id, patch: { startMin: start, endMin: end } })}>Save times</button>
          <button onClick={() => { setStart(a.plannedStartMin); setEnd(a.plannedEndMin) }}>Cancel</button>
        </div>
      )}
      {a.shiftedBy !== 0 && <p className="hint">A trigger moved this act: it now runs {formatClock(a.startMin)} to {formatClock(a.endMin)}.</p>}
      {incoming.length > 0 && <p className="hint">Affected by {incoming.map((x) => x.label).join(', ')}.</p>}

      <h3 className="sub-heading">Outcomes</h3>
      <ul className="outcomes">
        {a.outcomes.map((o) => {
          const happened = a.chosenOutcomeId === o.id
          const projected = a.outcomeId === o.id && !happened
          return (
            <li key={o.id} className={`${happened ? 'is-happened' : ''}${o.isDefault ? ' is-default' : ''}`}>
              <CommitField id={`out-${o.id}-label`} label="Outcome" value={o.label} required
                onCommit={(label) => void act('outcome:update', { id: o.id, patch: { label } })} />
              <CommitField id={`out-${o.id}-desc`} label="What it means" value={o.description} multiline rows={2}
                onCommit={(description) => void act('outcome:update', { id: o.id, patch: { description } })} />
              <div className="row tight wrap">
                <div className="field checkbox">
                  <input id={`out-${o.id}-default`} type="radio" name={`default-${a.id}`} checked={o.isDefault}
                    onChange={() => void act('outcome:update', { id: o.id, patch: { isDefault: true } })} />
                  <label htmlFor={`out-${o.id}-default`}>Default if ignored</label>
                </div>
              </div>
              <div className="row tight wrap">
                {happened
                  ? <><span className="seal">Happened</span><button onClick={() => void act('act:chooseOutcome', { actId: a.id, outcomeId: null })}>Undo choice</button></>
                  : <button className="primary" onClick={() => void act('act:chooseOutcome', { actId: a.id, outcomeId: o.id })}>
                    {projected ? 'Approve: this happened' : 'This happened'}
                  </button>}
                <button onClick={async () => { const r = await act('timeline:whatIf', { actId: a.id, outcomeId: o.id }); if (r) setPreview(r) }}>Preview what-if</button>
                <button className="danger" onClick={() => void act('outcome:setStatus', { id: o.id, status: 'defunct' })}>Remove</button>
              </div>
              {projected && <p className="hint">{a.resolvedBy === 'trigger' ? 'A trigger forces this outcome.' : 'This happens by default because the storyline runs on its own.'} It is not saved until you approve it.</p>}
            </li>
          )
        })}
      </ul>
      <form className="row tight" onSubmit={async (e) => {
        e.preventDefault()
        if (!newOutcome.trim()) return
        await act('outcome:add', { actId: a.id, label: newOutcome.trim() })
        setNewOutcome('')
      }}>
        <label htmlFor={`act-${a.id}-new-outcome`} className="visually-hidden">New outcome</label>
        <input id={`act-${a.id}-new-outcome`} value={newOutcome} placeholder="New outcome, e.g. Players succeed" onChange={(e) => setNewOutcome(e.target.value)} />
        <button type="submit" disabled={!newOutcome.trim()}>Add</button>
      </form>

      {preview && (
        <div className="whatif" role="status">
          <h3 className="sub-heading">What if: {a.outcomes.find((o) => o.id === preview.outcomeId)?.label}</h3>
          {preview.lines.length === 0 ? <p className="hint">Nothing else would change.</p>
            : <ul>{preview.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          <p className="hint">This is only a preview. Nothing has changed.</p>
          <button onClick={() => setPreview(null)}>Close preview</button>
        </div>
      )}

      <h3 className="sub-heading">Triggers from this act</h3>
      {triggers.length === 0 && <p className="hint">A trigger reacts to how this act ends: it can move another storyline's act, force its outcome, or change its status.</p>}
      <ul className="trigger-list">
        {triggers.map((tr) => <TriggerItem key={tr.id} t={t} tr={tr} a={a} />)}
      </ul>
      {addingTrigger ? <TriggerForm t={t} a={a} onDone={() => setAddingTrigger(false)} />
        : <button className="align-start" disabled={a.outcomes.length === 0} onClick={() => setAddingTrigger(true)}>Add trigger</button>}

      <div className="actions">
        <button className="danger" onClick={() => void act('act:setStatus', { id: a.id, status: 'defunct' })}>Move act to History</button>
      </div>
    </div>
  )
}

function TriggerItem({ t, tr, a }: { t: TimelineView; tr: TriggerView; a: ActView }) {
  const act = useBoard((s) => s.act)
  const [editing, setEditing] = useState(false)
  const outcome = a.outcomes.find((o) => o.id === tr.outcomeId)
  const target = t.storylines.find((s) => s.storylineId === tr.targetStorylineId)
  if (editing) return <li><TriggerForm t={t} a={a} existing={tr} onDone={() => setEditing(false)} /></li>
  return (
    <li>
      <span className="tl-badge static">{tr.label}</span>
      <span className="trigger-text">
        When this act ends "{outcome?.label ?? '?'}": in {target?.title ?? '?'}, {effectText(t, tr.effect)}.
        {tr.firedAtMin !== null && <em> Fired {formatClock(tr.firedAtMin)}.</em>}
        {tr.note && <span className="hint"> {tr.note}</span>}
      </span>
      <span className="row tight">
        <button onClick={() => setEditing(true)}>Edit</button>
        <button className="danger" onClick={() => void act('trigger:setStatus', { id: tr.id, status: 'defunct' })}>Remove</button>
      </span>
    </li>
  )
}

function TriggerForm({ t, a, existing, onDone }: { t: TimelineView; a: ActView; existing?: TriggerView; onDone(): void }) {
  const act = useBoard((s) => s.act)
  const others = t.storylines.filter((s) => s.storylineId !== a.storylineId)
  const [outcomeId, setOutcomeId] = useState(existing?.outcomeId ?? a.outcomes[0]?.id ?? '')
  const [target, setTarget] = useState(existing?.targetStorylineId ?? others[0]?.storylineId ?? a.storylineId)
  const [type, setType] = useState<TriggerEffectView['type']>(existing?.effect.type ?? 'shift_act')
  const targetActs = t.acts.filter((x) => x.storylineId === target && x.id !== a.id)
  const e = existing?.effect
  const [targetAct, setTargetAct] = useState(e && 'actId' in e ? e.actId : '')
  const [hours, setHours] = useState(e?.type === 'shift_act' ? String(e.minutes / 60) : '24')
  const [forceOutcome, setForceOutcome] = useState(e?.type === 'force_outcome' ? e.outcomeId : '')
  const [status, setStatus] = useState<StorylineStatus>(e?.type === 'set_status' ? e.status : 'autonomous')
  const [note, setNote] = useState(existing?.note ?? '')
  const actForTarget = targetActs.find((x) => x.id === targetAct)

  const effect: TriggerEffectView | null = type === 'set_status' ? { type, status }
    : type === 'shift_act' ? (actForTarget && Number.isFinite(Number(hours)) && Number(hours) !== 0 ? { type, actId: actForTarget.id, minutes: Math.round(Number(hours) * 60) } : null)
      : (actForTarget && forceOutcome ? { type, actId: actForTarget.id, outcomeId: forceOutcome } : null)
  const valid = !!outcomeId && !!target && !!effect

  const save = async (ev: FormEvent) => {
    ev.preventDefault()
    if (!valid || !effect) return
    if (existing) await act('trigger:update', { id: existing.id, patch: { outcomeId, targetStorylineId: target, effect, note } })
    else await act('trigger:add', { sourceActId: a.id, outcomeId, targetStorylineId: target, effect, note })
    onDone()
  }
  const p = existing ? `trg-${existing.id}` : `trg-new-${a.id}`
  return (
    <form className="dz-form trigger-form subcard" onSubmit={save}>
      <div className="field">
        <label htmlFor={`${p}-outcome`}>When this act ends with</label>
        <select id={`${p}-outcome`} value={outcomeId} onChange={(ev) => setOutcomeId(ev.target.value)}>
          {a.outcomes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${p}-target`}>In storyline</label>
        <select id={`${p}-target`} value={target} onChange={(ev) => { setTarget(ev.target.value); setTargetAct('') }}>
          {t.storylines.map((s) => <option key={s.storylineId} value={s.storylineId}>{s.title}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${p}-type`}>Do this</label>
        <select id={`${p}-type`} value={type} onChange={(ev) => setType(ev.target.value as TriggerEffectView['type'])}>
          <option value="shift_act">Move an act later or earlier</option>
          <option value="force_outcome">Force how an act ends</option>
          <option value="set_status">Change the storyline's status</option>
        </select>
      </div>
      {type !== 'set_status' && (
        <div className="field">
          <label htmlFor={`${p}-act`}>Act</label>
          <select id={`${p}-act`} value={targetAct} onChange={(ev) => { setTargetAct(ev.target.value); setForceOutcome('') }}>
            <option value="">Choose an act…</option>
            {targetActs.map((x) => <option key={x.id} value={x.id}>Act {x.number} · {x.title}</option>)}
          </select>
          {targetActs.length === 0 && <div className="hint">That storyline has no acts yet.</div>}
        </div>
      )}
      {type === 'shift_act' && (
        <div className="field">
          <label htmlFor={`${p}-hours`}>By how many hours (negative = earlier)</label>
          <input id={`${p}-hours`} className="short" type="number" value={hours} onChange={(ev) => setHours(ev.target.value)} />
        </div>
      )}
      {type === 'force_outcome' && actForTarget && (
        <div className="field">
          <label htmlFor={`${p}-force`}>Make it end with</label>
          <select id={`${p}-force`} value={forceOutcome} onChange={(ev) => setForceOutcome(ev.target.value)}>
            <option value="">Choose an outcome…</option>
            {actForTarget.outcomes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </div>
      )}
      {type === 'set_status' && (
        <div className="field">
          <label htmlFor={`${p}-status`}>New status</label>
          <select id={`${p}-status`} value={status} onChange={(ev) => setStatus(ev.target.value as StorylineStatus)}>
            {StorylineStatus.options.map((s) => <option key={s} value={s}>{STORYLINE_STATUS_LABELS[s]}</option>)}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor={`${p}-note`}>Note (optional)</label>
        <input id={`${p}-note`} value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={2000} />
      </div>
      <p className="hint">A trigger fires once, when this act ends with that outcome, and only changes things later in time.</p>
      <div className="dz-actions">
        <button type="button" onClick={onDone}>Cancel</button>
        <button type="submit" className="primary" disabled={!valid}>{existing ? 'Save trigger' : 'Add trigger'}</button>
      </div>
    </form>
  )
}
