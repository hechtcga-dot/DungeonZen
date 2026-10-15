import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useCtrlPan } from '../useCtrlPan'
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
import { useSidePanel } from '../components/Splitter'
import { LinkContext, LinkField, withAutoLinks } from '../components/LinkField'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { TypeEmblem } from '../art/emblems'
import { ENTITY_LABELS } from '../entityStyle'

const LANE_H = 120
const LANE_THIN = 32
const DAYS_H = 44
/** Column sizes and lane folds, kept while the app runs. */
const keep = { pxPerDay: 140, head: 220, closed: new Set<string>(), rows: new Map<string, number>() }

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
  const scrollRef = useRef<HTMLDivElement>(null)
  // Ctrl + drag scrolls the timeline without picking up acts.
  useCtrlPan(scrollRef, useCallback((dx: number, dy: number) => {
    const el = scrollRef.current
    if (el) { el.scrollLeft -= dx; el.scrollTop -= dy }
  }, []))
  const side = useSidePanel('timeline-side', 'right', 380)
  const [pxPerDay, setPxPerDay] = useState(keep.pxPerDay)
  const [head, setHead] = useState(keep.head)
  const [closed, setClosed] = useState(keep.closed)
  const [rows, setRows] = useState(keep.rows)
  useEffect(() => { Object.assign(keep, { pxPerDay, head, closed, rows }) }, [pxPerDay, head, closed, rows])
  // Opened from a storyline's Timeline link: only that storyline open, the others thin rows.
  useEffect(() => {
    const focus = useBoard.getState().timelineFocus
    if (!focus) return
    useBoard.setState({ timelineFocus: null })
    setClosed(new Set(t.storylines.filter((s) => s.storylineId !== focus).map((s) => s.storylineId)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n }
  /** Drag a column's right edge: the title column, or a day (every day takes the new width). */
  const dragSize = (e: ReactPointerEvent, apply: (dx: number) => void) => {
    e.preventDefault(); e.stopPropagation()
    const x0 = e.clientX
    const move = (m: PointerEvent) => apply(m.clientX - x0)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  /** Drag a lane's bottom edge: that storyline's row height. */
  const dragRow = (e: ReactPointerEvent, apply: (dy: number) => void) => {
    e.preventDefault(); e.stopPropagation()
    const y0 = e.clientY
    const move = (m: PointerEvent) => apply(m.clientY - y0)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState<{ storylineId: string; startMin: number } | null>(null)
  const [editStory, setEditStory] = useState<TimelineStoryline | null>(null)
  const pxPerMin = pxPerDay / MINUTES_PER_DAY
  const lastMin = Math.max(t.nowMin, ...t.acts.map((a) => Math.max(a.endMin, a.plannedEndMin)))
  const days = Math.max(7, Math.ceil(lastMin / MINUTES_PER_DAY) + 2)
  const width = days * pxPerDay
  const shown = t.storylines
  const laneH = (id: string) => (closed.has(id) ? LANE_THIN : rows.get(id) ?? LANE_H)
  const laneTop = new Map<string, number>()
  shown.reduce((y, s) => { laneTop.set(s.storylineId, y); return y + laneH(s.storylineId) }, DAYS_H)
  const lanesH = shown.reduce((y, s) => y + laneH(s.storylineId), 0)
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
          <button className="brass icon" title="Show all storylines open" aria-label="Show all"
            onClick={() => setClosed(new Set())}>⊞</button>
          <button className="brass icon" title="Collapse all storylines to thin rows" aria-label="Collapse all"
            onClick={() => setClosed(new Set(t.storylines.map((s) => s.storylineId)))}>⊟</button>
          <button className="brass icon" aria-label="Zoom out" disabled={pxPerDay <= 40} onClick={() => setPxPerDay((p) => Math.max(40, Math.round(p / 1.4)))}>−</button>
          <span className="zoom-label mono" aria-live="polite" title="Or drag the edge of a day">{pxPerDay} px a day</span>
          <button className="brass icon" aria-label="Zoom in" disabled={pxPerDay >= 800} onClick={() => setPxPerDay((p) => Math.min(800, Math.round(p * 1.4)))}>+</button>
          <button className="brass" onClick={() => document.getElementById('tl-now')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })}>
            Jump to now
          </button>
        </div>
      </div>
      <div className="timeline-layout" style={side.style}>
        <section className="panel timeline-sheet" aria-label="Storyline lanes">
          {t.storylines.length === 0 ? (
            <div className="timeline-empty">
              <h2 className="panel-heading">No storylines yet</h2>
              <p className="hint">Add a storyline on the desk or the board, then give it acts here.</p>
            </div>
          ) : (
            <>
            <div className="tl-scroll" ref={scrollRef}>
              <div className="tl-grid" style={{ width: head + width }}>
                <div className="tl-days" style={{ width: head + width }}>
                  <div className="tl-days-corner" style={{ width: head }}>
                    <span className="tl-grip" title="Drag to change the width" onPointerDown={(e) => { const w0 = head; dragSize(e, (dx) => setHead(Math.min(600, Math.max(120, w0 + dx)))) }} />
                  </div>
                  {dayHeads.map((d) => (
                    <div key={d.day} className="tl-day" style={{ width: pxPerDay }}>
                      <span className="tl-day-name">Day {d.day}</span>
                      {d.note && <span className={`tl-day-note${d.note === 'Full moon' ? ' full' : ''}`}>{d.note}</span>}
                      <span className="tl-grip" title="Drag to change the width of the days"
                        onPointerDown={(e) => { const p0 = pxPerDay; dragSize(e, (dx) => setPxPerDay(Math.min(800, Math.max(40, Math.round(p0 + dx / d.day))))) }} />
                    </div>
                  ))}
                </div>
                {shown.map((s) => closed.has(s.storylineId) ? (
                  <div key={s.storylineId} className="tl-lane is-thin" style={{ height: LANE_THIN }}>
                    <div className="tl-lane-head" style={{ width: head }}>
                      <button className="tl-fold" aria-label={`Open ${s.title}`} title="Open" onClick={() => setClosed((c) => toggle(c, s.storylineId))}>▸ {s.title}</button>
                    </div>
                    <div className="tl-track" style={{ width, ['--day' as string]: `${pxPerDay}px` }} />
                  </div>
                ) : (
                  <div key={s.storylineId} className="tl-lane" style={{ height: laneH(s.storylineId) }}>
                    <span className="tl-grip is-row" title="Drag to change the height"
                      onPointerDown={(e) => { const h0 = laneH(s.storylineId); dragRow(e, (dy) => setRows((r) => new Map(r).set(s.storylineId, Math.min(600, Math.max(90, h0 + dy))))) }} />
                    <div className="tl-lane-head" style={{ width: head }}>
                      <span className="tl-lane-row">
                        <button className="tl-fold" aria-label={`Collapse ${s.title}`} title="Collapse to a thin row" onClick={() => setClosed((c) => toggle(c, s.storylineId))}>▾</button>
                        <button className="tl-lane-title" onClick={() => setEditStory(s)} title={`${s.title} (edit storyline)`}>{s.title}</button>
                      </span>
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
                <TriggerLines t={t} pxPerMin={pxPerMin} laneTop={laneTop} laneH={laneH} head={head} />
                <div id="tl-now" className="tl-now" style={{ left: head + t.nowMin * pxPerMin, top: 0, height: DAYS_H + lanesH }}>
                  <span>NOW · {formatClock(t.nowMin)}</span>
                </div>
              </div>
            </div>
            </>
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
        <div className="timeline-side-wrap">{side.grip}<aside className="panel timeline-side" aria-label="Selected act">
          {selectedAct ? <ActPanel key={selectedAct.id} t={t} a={selectedAct} onClose={() => setSelected(null)} />
            : (
              <>
                <h2 className="panel-heading">Acts and outcomes</h2>
                <p className="hint">Select an act to see its outcomes, choose what happened, add triggers and preview a what-if.</p>
                <p className="hint">Storylines the players ignore move on by themselves: when an act's time is up, its default outcome happens. You approve it by choosing it.</p>
                <p className="hint">Double-click an empty spot in a lane, or use + Act, to add an act.</p>
              </>
            )}
        </aside></div>
      </div>
      {adding && <AddActDialog t={t} initial={adding} onClose={() => setAdding(null)} onAdded={(id) => setSelected(id)} />}
      {editStory && (
        <StorylineDialog open onClose={() => setEditStory(null)} storylineId={editStory.storylineId}
          detail={{ title: editStory.title, status: editStory.status, isMajor: editStory.isMajor, emblem: editStory.emblem, colour: editStory.colour }} />
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
function TriggerLines({ t, pxPerMin, laneTop, laneH, head }: { t: TimelineView; pxPerMin: number; laneTop: Map<string, number>; laneH(id: string): number; head: number }) {
  return (
    <>
      {t.triggers.map((tr) => {
        const src = t.acts.find((a) => a.id === tr.sourceActId)
        if (!src) return null
        const from = laneTop.get(src.storylineId)
        const to = laneTop.get(tr.targetStorylineId)
        if (from === undefined || to === undefined) return null
        const x = head + src.endMin * pxPerMin - 2
        const mid = (id: string, top: number) => top + laneH(id) / 2
        const a = mid(src.storylineId, from), b = mid(tr.targetStorylineId, to)
        const y1 = Math.min(a, b)
        const y2 = Math.max(a, b)
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
  const openSheet = useBoard((s) => s.openSheet)
  const openEncounter = useBoard((s) => s.openEncounter)

  // Card names link by themselves; the card shows at the top of this panel.
  const [shownId, setShownId] = useState<string | null>(null)
  const wordLinks = useBoard((st) => st.wordLinks)
  const links = useMemo(() => withAutoLinks(wordLinks, wordLinks?.own ?? [],
    (own) => void act('links:set', { own, off: wordLinks?.off ?? [] }), setShownId), [wordLinks, act])
  const cards = wordLinks?.cards ?? []
  const shownCard = shownId ? cards.find((c) => c.id === shownId) : undefined

  // Encounters tied to this act: encounter cards marked with it.
  const encounters = cards.filter((c) => c.encounter && a.cards.some((m) => m.id === c.id))
  const [encMenu, setEncMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const newEncounter = async () => {
    const id = await act('encounter:create', { name: `${a.title} encounter`.slice(0, 200) })
    if (id) { await act('act:mark', { entityId: id, actId: a.id, on: true }); openEncounter(id) }
  }
  const encItems = (): MenuItem[] => [
    { label: 'New encounter…', onClick: () => void newEncounter() },
    ...(cards.some((c) => c.encounter) ? ['separator' as const] : []),
    ...cards.filter((c) => c.encounter).map((c) => {
      const on = encounters.includes(c)
      return { label: c.name, checked: on, onClick: () => void act('act:mark', { entityId: c.id, actId: a.id, on: !on }) }
    })
  ]

  return (
    <LinkContext.Provider value={links}>
    <div className="act-panel">
      <div className="row spread">
        <h2 className="panel-heading">{actLabel(t, a)}</h2>
        <button aria-label="Close" onClick={onClose}>×</button>
      </div>
      {shownCard && (
        <section className="parchment-note prep-card" aria-label={`Card: ${shownCard.name}`}>
          <div className="row spread">
            <h3 className="panel-title">{shownCard.name}</h3>
            <span className="row tight">
              <button className="ink-button" onClick={() => void openSheet(shownCard.id)}>Open full sheet</button>
              <button aria-label="Close the card" onClick={() => setShownId(null)}>×</button>
            </span>
          </div>
          <span className="ink-muted">{ENTITY_LABELS[shownCard.type]}{shownCard.location ? ` · ${shownCard.location}` : ''}</span>
          <div className="inspector-picture">
            {shownCard.picture ? <img src={`dz-asset://campaign/${shownCard.picture}?w=512`} alt={shownCard.name} /> : <TypeEmblem type={shownCard.type} />}
          </div>
          {shownCard.summary && <p>{shownCard.summary}</p>}
        </section>
      )}
      <CommitField id={`act-${a.id}-title`} label="Title" value={a.title} required onCommit={(title) => void act('act:update', { id: a.id, patch: { title } })} />
      <LinkField id={`act-${a.id}-summary`} label="What happens in this act" value={a.summary} multiline rows={3}
        onCommit={(summary) => void act('act:update', { id: a.id, patch: { summary } })} />
      <div className="tl-encounters">
        <span className="field-label">Encounters</span>
        {encounters.map((c) => (
          <span key={c.id} className="tl-enc">
            <button className="link-button" title="Open in Encounters" onClick={() => openEncounter(c.id)}>{c.name}</button>
            <button className="tl-enc-x" aria-label={`Untie ${c.name} from this act`} title="Untie from this act"
              onClick={() => void act('act:mark', { entityId: c.id, actId: a.id, on: false })}>×</button>
          </span>
        ))}
        <button className="tl-enc-add" aria-label="Tie an encounter or make a new one" title="Tie an encounter, or make a new one"
          onClick={(e) => setEncMenu({ x: e.clientX, y: e.clientY, items: encItems() })}>+</button>
        {encMenu && <ContextMenu x={encMenu.x} y={encMenu.y} items={encMenu.items} onClose={() => setEncMenu(null)} />}
      </div>
      <div className="row tight wrap tl-times">
        <DayTime id={`act-${a.id}-start`} label="Planned start" value={start} onChange={setStart} />
        <DayTime id={`act-${a.id}-end`} label="Planned end" value={end} onChange={setEnd} />
      </div>
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
              <LinkField id={`out-${o.id}-desc`} label="What it means" value={o.description} multiline rows={2}
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
    </LinkContext.Provider>
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
