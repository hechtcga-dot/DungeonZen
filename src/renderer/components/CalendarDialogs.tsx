import { createContext, useState } from 'react'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import { moonLitPath } from '../art/adventure'
import {
  CALENDAR_PRESETS, CLIMATES, EVENT_COLOURS, EVENT_REPEATS, WEATHER_COLUMNS, WEATHER_KINDS, WEATHER_WORDS, climateOdds, dateOfDay,
  dayOfDate, dayOfMinutes, formatDate, formatDay, monthShape, moonAt, nextFullDay, occurrences, presetCalendar, timeText, weatherOn, weekdayOf, yearLength,
  type CalDate, type CalEvent, type CalMoon, type CalendarDef, type Climate, type EventLink, type WeatherKind
} from '../../shared/calendar'
import { MINUTES_PER_DAY } from '../../shared/time'

// Calendar windows (3.9): Clock (time only), Moons, Event, Calendar settings; small date picker and icons.

const REPEAT_LABELS: Record<CalEvent['repeat'], string> = { none: 'Never', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }
const CLIMATE_LABELS: Record<Climate, string> = { temperate: 'Temperate', cold: 'Cold', warm: 'Warm', desert: 'Desert', tropical: 'Tropical', custom: 'Custom' }
const newId = () => crypto.randomUUID()

/** A moon's phase as a small disc. */
export function MoonIcon({ phase, colour, size = 15, title }: { phase: number; colour: string; size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={title} className="moon-icon">
      <title>{title}</title>
      <circle cx="50" cy="50" r="46" fill="#2b2a35" />
      <path d={moonLitPath(phase, 50, 50, 46)} fill={colour} />
    </svg>
  )
}

const WEATHER_PATHS: Record<WeatherKind, string> = {
  clear: 'M6 10a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M10 2v2M10 16v2M2 10h2M16 10h2M4.3 4.3l1.4 1.4M14.3 14.3l1.4 1.4M4.3 15.7l1.4-1.4M14.3 5.7l1.4-1.4',
  cloudy: 'M5 15a3.5 3.5 0 0 1 .5-7A4.5 4.5 0 0 1 14 7.5a3.5 3.5 0 0 1 .5 7.5z',
  rain: 'M5 12a3.5 3.5 0 0 1 .5-7A4.5 4.5 0 0 1 14 4.5a3.5 3.5 0 0 1 .5 7.5zM7 15l-1 3M11 15l-1 3M15 15l-1 3',
  storm: 'M5 11a3.5 3.5 0 0 1 .5-7A4.5 4.5 0 0 1 14 3.5a3.5 3.5 0 0 1 .5 7.5zM11 12l-3 4h3l-2 3',
  snow: 'M5 12a3.5 3.5 0 0 1 .5-7A4.5 4.5 0 0 1 14 4.5a3.5 3.5 0 0 1 .5 7.5zM7 16v.1M10 17.5v.1M13 16v.1M8.5 19v.1M11.5 19v.1',
  fog: 'M3 7h14M2 11h16M4 15h12'
}
export function WeatherIcon({ kind, size = 16 }: { kind: WeatherKind; size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" role="img" aria-label={WEATHER_WORDS[kind].day} className="weather-icon">
      <title>{WEATHER_WORDS[kind].day}</title>
      <path d={WEATHER_PATHS[kind]} />
    </svg>
  )
}

/** Day, month and year of a calendar; festival days past a month are listed under it. */
export function DatePick({ def, value, onChange, idPrefix }: { def: CalendarDef; value: CalDate; onChange(d: CalDate): void; idPrefix: string }) {
  const shape = monthShape(def, value.year, Math.min(value.month, def.months.length - 1))
  const days = [...Array(shape.days)].map((_, i) => i + 1)
  const fix = (d: CalDate): CalDate => {
    const s = monthShape(def, d.year, d.month)
    return { ...d, day: Math.min(d.day, s.days + s.extra.length) }
  }
  return (
    <span className="row tight date-pick">
      <label className="visually-hidden" htmlFor={`${idPrefix}-day`}>Day</label>
      <select id={`${idPrefix}-day`} value={value.day} onChange={(e) => onChange({ ...value, day: Number(e.target.value) })}>
        {days.map((d) => <option key={d} value={d}>{d}{shape.named.get(d) ? ` (${shape.named.get(d)})` : ''}</option>)}
        {shape.extra.map((x) => <option key={x.day} value={x.day}>{x.name}</option>)}
      </select>
      <label className="visually-hidden" htmlFor={`${idPrefix}-month`}>Month</label>
      <select id={`${idPrefix}-month`} value={value.month} onChange={(e) => onChange(fix({ ...value, month: Number(e.target.value) }))}>
        {def.months.map((m, i) => <option key={i} value={i}>{m.name}</option>)}
      </select>
      <label className="visually-hidden" htmlFor={`${idPrefix}-year`}>Year</label>
      <input id={`${idPrefix}-year`} className="short" type="number" value={value.year}
        onChange={(e) => { const y = Number(e.target.value); if (Number.isInteger(y)) onChange(fix({ ...value, year: y })) }} />
      {def.yearLabel && <span className="ink-muted">{def.yearLabel}</span>}
    </span>
  )
}

/** "in 3 days", "today", "2 days ago". */
export function daysFromNow(day: number, today: number): string {
  const n = day - today
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n === -1 ? 'yesterday' : n > 0 ? `in ${n} days` : `${-n} days ago`
}

// ---- Clock: the time of day only (owner, 2026-10-22) -----------------------------------------------------------------

export function ClockDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return <Dialog title="Clock" open={open} onClose={onClose}>{open && <ClockForm onClose={onClose} />}</Dialog>
}

function ClockForm({ onClose }: { onClose(): void }) {
  const { info, act, showCalendar } = useBoard()
  const now = info?.clockMin ?? 0
  const [min, setMin] = useState(now)
  const dayStart = Math.floor(min / MINUTES_PER_DAY) * MINUTES_PER_DAY
  const [hour, setHour] = useState(String(Math.floor((min - dayStart) / 60)))
  const [minute, setMinute] = useState(String((min - dayStart) % 60).padStart(2, '0'))
  const move = (d: number) => {
    const next = Math.max(0, min + d)
    const s = Math.floor(next / MINUTES_PER_DAY) * MINUTES_PER_DAY
    setMin(next); setHour(String(Math.floor((next - s) / 60))); setMinute(String((next - s) % 60).padStart(2, '0'))
  }
  const h = Number(hour), m = Number(minute)
  const valid = Number.isInteger(h) && h >= 0 && h < 24 && Number.isInteger(m) && m >= 0 && m < 60
  const target = valid ? dayStart + h * 60 + m : min
  const save = async () => { if (valid && target !== now) await act('clock:set', { minutes: target }); onClose() }
  return (
    <form className="dz-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <p className="clock-now mono">{formatClockLong(target)}</p>
      <fieldset className="field">
        <legend>Time of day</legend>
        <div className="row tight wrap">
          <button type="button" onClick={() => move(-60)}>−1 h</button>
          <button type="button" onClick={() => move(-30)}>−30 m</button>
          <label className="visually-hidden" htmlFor="clk-hour">Hour</label>
          <input id="clk-hour" className="short" inputMode="numeric" value={hour} onChange={(e) => setHour(e.target.value)} />
          <span aria-hidden="true">:</span>
          <label className="visually-hidden" htmlFor="clk-minute">Minute</label>
          <input id="clk-minute" className="short" inputMode="numeric" value={minute} onChange={(e) => setMinute(e.target.value)} />
          <button type="button" onClick={() => move(30)}>+30 m</button>
          <button type="button" onClick={() => move(60)}>+1 h</button>
        </div>
        {!valid && <div className="field-error">Hour 0 to 23, minute 0 to 59.</div>}
        <div className="hint">Going past midnight moves to the next day. One undoable change. <button type="button" className="link-button" onClick={() => { onClose(); showCalendar(null, 'month') }}>Change the date on the calendar</button></div>
      </fieldset>
      <div className="dz-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!valid}>Set the clock</button>
      </div>
    </form>
  )
}

function formatClockLong(minutes: number): string {
  const cal = useBoard.getState().calendar
  if (!cal) return timeText(minutes)
  return `${formatDay(cal.def, dayOfMinutes(minutes))} · ${timeText(minutes)}`
}

// ---- Moons ------------------------------------------------------------------------------------------------------------

export function MoonsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return <Dialog title="Moons" open={open} onClose={onClose}>{open && <MoonsForm onClose={onClose} />}</Dialog>
}

function MoonsForm({ onClose }: { onClose(): void }) {
  const { calendar, act } = useBoard()
  const [moons, setMoons] = useState<CalMoon[]>(() => structuredClone(calendar?.def.moons ?? []))
  if (!calendar) return null
  const def = calendar.def
  const save = async () => { await act('calendar:set', { calendar: { ...def, moons }, label: 'Changed the moons' }); onClose() }
  return (
    <form className="dz-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <MoonsEditor def={def} moons={moons} onChange={setMoons} />
      <div className="dz-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={moons.some((m) => !m.name.trim() || !(m.cycle >= 1))}>Save</button>
      </div>
    </form>
  )
}

/** The moons list (Moons window and Calendar settings). */
function MoonsEditor({ def, moons, onChange }: { def: CalendarDef; moons: CalMoon[]; onChange(m: CalMoon[]): void }) {
  const now = useBoard((s) => s.info?.clockMin ?? 0)
  const from = presetCalendar(def.preset)?.moons ?? []
  const set = (i: number, patch: Partial<CalMoon>) => onChange(moons.map((m, j) => (j === i ? { ...m, ...patch } : m)))
  return (
    <div className="moons-edit">
      {moons.map((m, i) => m.status === 'defunct' ? null : (
        <fieldset key={i} className="moon-row" aria-label={m.name}>
          <div className="row tight">
            <MoonIcon phase={moonAt(def, m, now).phase} colour={m.colour} size={26} title={moonAt(def, m, now).name} />
            <label className="visually-hidden" htmlFor={`moon-name-${i}`}>Moon name</label>
            <input id={`moon-name-${i}`} value={m.name} maxLength={60} onChange={(e) => set(i, { name: e.target.value })} />
            <label className="visually-hidden" htmlFor={`moon-colour-${i}`}>Colour</label>
            <input id={`moon-colour-${i}`} type="color" value={m.colour} onChange={(e) => set(i, { colour: e.target.value })} />
            <button type="button" onClick={() => set(i, { status: 'defunct' })}>Move to History</button>
          </div>
          <div className="seg" role="group" aria-label="Cycle">
            <button type="button" aria-pressed={!m.manual} disabled={!from[i]} title={from[i] ? `${def.name}: ${from[i].cycle} days` : 'This calendar has no moon here'}
              onClick={() => from[i] && set(i, { manual: false, cycle: from[i].cycle, full: from[i].full })}>From the calendar</button>
            <button type="button" aria-pressed={!!m.manual} onClick={() => set(i, { manual: true })}>Manual Lunar Dates</button>
          </div>
          {m.manual ? (
            <div className="row tight wrap">
              <span>Full on</span>
              <DatePick def={def} value={m.full} onChange={(full) => set(i, { full })} idPrefix={`moon-full-${i}`} />
              <label htmlFor={`moon-cycle-${i}`}>Cycle (days)</label>
              <input id={`moon-cycle-${i}`} className="short" type="number" min={1} step={0.01} value={m.cycle} onChange={(e) => set(i, { cycle: Number(e.target.value) })} />
            </div>
          ) : <div className="hint">{def.name}: cycle {m.cycle} days, full on {formatDate(def, m.full)}.</div>}
          <div className="hint">Next full: {formatDay(def, nextFullDay(def, m, dayOfMinutes(now)))}.</div>
        </fieldset>
      ))}
      <button type="button" onClick={() => onChange([...moons, { name: 'New moon', colour: '#9cc3e0', cycle: 29.5, full: dateOfDay(def, dayOfMinutes(now)), manual: true }])}>+ Add a moon</button>
    </div>
  )
}

// ---- Event ------------------------------------------------------------------------------------------------------------

export interface EventDraft { event?: CalEvent; start?: number; title?: string; links?: EventLink[]; source?: string; colour?: string }

export function EventDialog({ draft, onClose }: { draft: EventDraft | null; onClose(): void }) {
  return <Dialog title="Event" open={!!draft} onClose={onClose} wide>{draft && <EventForm draft={draft} onClose={onClose} />}</Dialog>
}

function EventForm({ draft, onClose }: { draft: EventDraft; onClose(): void }) {
  const { calendar, act, info } = useBoard()
  const today = dayOfMinutes(info?.clockMin ?? 0)
  const [e, setE] = useState<CalEvent>(() => draft.event ? structuredClone(draft.event) : {
    id: newId(), title: draft.title ?? '', start: draft.start ?? (today * MINUTES_PER_DAY + 12 * 60), end: null, allDay: draft.start === undefined || draft.start % MINUTES_PER_DAY === 0,
    colour: draft.colour ?? EVENT_COLOURS[0], notes: '', repeat: 'none', links: draft.links ?? [], known: false, showNotes: false, ...(draft.source ? { source: draft.source } : {})
  })
  const [pick, setPick] = useState('')
  const [tried, setTried] = useState(false)
  if (!calendar) return null
  const def = calendar.def
  const startDay = dayOfMinutes(e.start)
  const inDay = e.start - startDay * MINUTES_PER_DAY
  const startDate = dateOfDay(def, startDay)
  const endDay = e.end === null ? null : dayOfMinutes(e.end)
  const set = (patch: Partial<CalEvent>) => setE((x) => ({ ...x, ...patch }))
  const setStartDate = (d: CalDate) => {
    const day = dayOfDate(def, d)
    const shift = (day - startDay) * MINUTES_PER_DAY
    set({ start: e.start + shift, end: e.end === null ? null : e.end + shift })
  }
  const setTime = (hh: number, mm: number) => set({ start: startDay * MINUTES_PER_DAY + hh * 60 + mm })
  const name = (l: EventLink) => l.kind === 'card' ? calendar.cards.find((c) => c.id === l.id)?.name
    : l.kind === 'secret' ? calendar.secrets.find((s) => s.id === l.id)?.text : calendar.storylines.find((s) => s.id === l.id)?.title
  const valid = e.title.trim() !== '' && (e.end === null || e.end > e.start)
  const save = async () => {
    if (!valid) { setTried(true); return }
    const { status: _s, ...rest } = e
    await act('calendar:saveEvent', { ...rest, title: e.title.trim(), start: e.allDay ? startDay * MINUTES_PER_DAY : e.start })
    onClose()
  }
  const remove = async () => { await act('calendar:setEventRemoved', { id: e.id, removed: true }); onClose() }
  return (
    <form className="dz-form" onSubmit={(ev) => { ev.preventDefault(); void save() }}>
      <div className="ev-grid">
      <div className="ev-col">
      <div className="field">
        <label htmlFor="ev-title">Title</label>
        <input id="ev-title" autoFocus value={e.title} maxLength={200} onChange={(x) => set({ title: x.target.value })} />
        {tried && !e.title.trim() && <div className="field-error">Give the event a title.</div>}
      </div>
      <div className="row wrap ev-when">
        <div className="field">
          <span className="field-label">Starts</span>
          <DatePick def={def} value={startDate} onChange={setStartDate} idPrefix="ev-start" />
          <div className="hint">{weekdayOf(def, startDate) !== null ? `${def.weekdays[weekdayOf(def, startDate)!]} · ` : ''}{daysFromNow(startDay, today)} · Day {startDay + 1}</div>
        </div>
        <div className="field">
          <span className="field-label">Time</span>
          <span className="row tight">
            <label className="row tight"><input type="checkbox" checked={e.allDay} onChange={(x) => set({ allDay: x.target.checked, start: x.target.checked ? startDay * MINUTES_PER_DAY : startDay * MINUTES_PER_DAY + 12 * 60 })} /> All day</label>
            {!e.allDay && <TimeInputs value={inDay} onChange={setTime} idPrefix="ev-time" />}
          </span>
        </div>
      </div>
      <div className="field">
        <span className="field-label">Ends</span>
        <span className="row tight wrap">
          <span className="seg" role="group" aria-label="Ends">
            <button type="button" aria-pressed={e.end === null} onClick={() => set({ end: null })}>Same day</button>
            <button type="button" aria-pressed={e.end !== null} onClick={() => set({ end: (startDay + 1) * MINUTES_PER_DAY + inDay })}>Later</button>
          </span>
          {e.end !== null && endDay !== null && <DatePick def={def} value={dateOfDay(def, endDay)} idPrefix="ev-end"
            onChange={(d) => set({ end: dayOfDate(def, d) * MINUTES_PER_DAY + (e.end! - endDay * MINUTES_PER_DAY) })} />}
          {e.end !== null && !e.allDay && endDay !== null && <TimeInputs value={e.end - endDay * MINUTES_PER_DAY} idPrefix="ev-endtime" onChange={(hh, mm) => set({ end: endDay * MINUTES_PER_DAY + hh * 60 + mm })} />}
        </span>
        {e.end !== null && e.end <= e.start && <div className="field-error">The end is before the start.</div>}
      </div>
      <div className="field">
        <span className="field-label">Repeats</span>
        <span className="seg" role="group" aria-label="Repeats">
          {EVENT_REPEATS.map((r) => <button key={r} type="button" aria-pressed={e.repeat === r} onClick={() => set({ repeat: r })}>{REPEAT_LABELS[r]}</button>)}
        </span>
      </div>
      <div className="field">
        <span className="field-label">Colour</span>
        <span className="row tight swatches">
          {EVENT_COLOURS.map((c) => (
            <label key={c} className={`swatch${e.colour === c ? ' on' : ''}`} style={{ background: c }} title={c}>
              <input type="radio" name="ev-colour" className="visually-hidden" checked={e.colour === c} onChange={() => set({ colour: c })} aria-label={`Colour ${c}`} />
            </label>
          ))}
        </span>
      </div>
      </div>
      <div className="ev-col">
      <div className="field">
        <label htmlFor="ev-notes">Notes</label>
        <textarea id="ev-notes" rows={3} value={e.notes} onChange={(x) => set({ notes: x.target.value })} />
      </div>
      <div className="field">
        <span className="field-label">Linked to</span>
        <span className="row tight wrap">
          {e.links.map((l) => (
            <span key={`${l.kind}${l.id}`} className="link-chip">
              {l.kind === 'secret' ? 'Secret: ' : l.kind === 'storyline' ? 'Storyline: ' : ''}{name(l) ?? '(gone)'}
              <button type="button" aria-label="Remove link" onClick={() => set({ links: e.links.filter((x) => x !== l) })}>×</button>
            </span>
          ))}
          <label className="visually-hidden" htmlFor="ev-link">Link a card, secret or storyline</label>
          <select id="ev-link" value={pick} onChange={(x) => {
            const [kind, id] = x.target.value.split(':') as [EventLink['kind'], string]
            if (id && !e.links.some((l) => l.kind === kind && l.id === id)) set({ links: [...e.links, { kind, id }] })
            setPick('')
          }}>
            <option value="">+ Link a card, secret or storyline…</option>
            <optgroup label="Cards">{calendar.cards.map((c) => <option key={c.id} value={`card:${c.id}`}>{c.name}</option>)}</optgroup>
            <optgroup label="Secrets">{calendar.secrets.map((s) => <option key={s.id} value={`secret:${s.id}`}>{s.text.slice(0, 80)}</option>)}</optgroup>
            <optgroup label="Storylines">{calendar.storylines.map((s) => <option key={s.id} value={`storyline:${s.id}`}>{s.title}</option>)}</optgroup>
          </select>
        </span>
        <div className="hint">The event shows in each linked card's Dates box.</div>
      </div>
      <div className="field known-box">
        <label className="row tight"><input type="checkbox" checked={e.known} onChange={(x) => set({ known: x.target.checked })} /> <strong>The party knows this</strong></label>
        <div className="hint">Shows on What they know (title and date; notes only if ticked below). Linked secrets never show.</div>
        <label className="row tight"><input type="checkbox" checked={e.showNotes} disabled={!e.known} onChange={(x) => set({ showNotes: x.target.checked })} /> Show the notes too</label>
      </div>
      {e.source && <div className="hint">Added from: {e.source}</div>}
      </div>
      </div>
      <div className="dz-actions">
        {draft.event && <button type="button" onClick={() => void remove()}>Move to History</button>}
        <span className="spacer" />
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary">Save</button>
      </div>
    </form>
  )
}

function TimeInputs({ value, onChange, idPrefix }: { value: number; onChange(h: number, m: number): void; idPrefix: string }) {
  const h = Math.floor(value / 60), m = value % 60
  return (
    <span className="row tight">
      <label className="visually-hidden" htmlFor={`${idPrefix}-h`}>Hour</label>
      <input id={`${idPrefix}-h`} className="tiny" type="number" min={0} max={23} value={h} onChange={(e) => onChange(Math.min(23, Math.max(0, Number(e.target.value) || 0)), m)} />
      <span aria-hidden="true">:</span>
      <label className="visually-hidden" htmlFor={`${idPrefix}-m`}>Minute</label>
      <input id={`${idPrefix}-m`} className="tiny" type="number" min={0} max={59} value={String(m).padStart(2, '0')} onChange={(e) => onChange(h, Math.min(59, Math.max(0, Number(e.target.value) || 0)))} />
    </span>
  )
}

// ---- Calendar settings and builder ------------------------------------------------------------------------------------

export function CalendarSettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return <Dialog title="Calendar settings" open={open} onClose={onClose} wide>{open && <CalendarSettingsForm onClose={onClose} />}</Dialog>
}

function CalendarSettingsForm({ onClose }: { onClose(): void }) {
  const { calendar, act, info } = useBoard()
  const [def, setDef] = useState<CalendarDef | null>(() => calendar ? structuredClone(calendar.def) : null)
  if (!calendar || !def) return null
  const set = (patch: Partial<CalendarDef>) => setDef({ ...def, ...patch })
  const today = dayOfMinutes(info?.clockMin ?? 0)
  // Picking a calendar keeps today's position in the campaign: Day 1 becomes that calendar's own start.
  const choose = (id: string) => { const p = presetCalendar(id); if (p) setDef({ ...p, weatherSeed: def.weatherSeed }) }
  const setMonth = (i: number, patch: Partial<CalendarDef['months'][number]>) => set({ months: def.months.map((m, j) => (j === i ? { ...m, ...patch } : m)) })
  const moveMonth = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= def.months.length) return
    const months = [...def.months]; [months[i], months[j]] = [months[j], months[i]]; set({ months })
  }
  const setSeason = (i: number, patch: Partial<CalendarDef['seasons'][number]>) => set({ seasons: def.seasons.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const valid = def.name.trim() !== '' && def.months.every((m) => m.name.trim() && m.days >= 1) && def.weekdays.every((w) => w.trim()) && def.start.month < def.months.length
  const save = async () => { if (valid) { await act('calendar:set', { calendar: def, label: `Calendar settings: ${def.name}` }); onClose() } }
  const leapRule = def.leap.find((r) => r.leap)
  return (
    <form className="dz-form cal-settings" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <div className="cal-settings-grid">
        <div className="cal-col">
          <h3 className="cal-h">Calendar</h3>
          <div className="preset-list" role="group" aria-label="Start from a calendar">
            {CALENDAR_PRESETS.map((p) => (
              <button key={p.preset} type="button" className="preset" aria-pressed={def.preset === p.preset} onClick={() => choose(p.preset)}>
                <strong>{p.name}</strong><span>{p.months.length} months, {p.weekdays.length}-day week{p.moons.length ? `, ${p.moons.length} moon${p.moons.length > 1 ? 's' : ''}` : ''}</span>
              </button>
            ))}
          </div>
          <div className="hint">Picking one replaces these settings (Save to keep, Cancel to drop). Every part below can be changed.</div>
          <h3 className="cal-h">Day 1 of the campaign</h3>
          <DatePick def={def} value={def.start} onChange={(start) => set({ start })} idPrefix="cal-start" />
          <div className="hint">Today is {formatDay(def, today)} (Day {today + 1}). Events stay on their campaign day; their dates follow.</div>
        </div>

        <div className="cal-col">
          <div className="row wrap">
            <div className="field"><label htmlFor="cal-name">Name</label><input id="cal-name" value={def.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></div>
            <div className="field"><label htmlFor="cal-label">Year label</label><input id="cal-label" className="short" value={def.yearLabel} maxLength={20} onChange={(e) => set({ yearLabel: e.target.value })} /></div>
          </div>
          <h3 className="cal-h">Months, with their festival days</h3>
          <table className="cal-months">
            <thead><tr><th>#</th><th>Name</th><th>Days / when</th><th><span className="visually-hidden">Move or remove</span></th></tr></thead>
            <tbody>
              {def.months.map((m, i) => (
                <MonthRows key={i} i={i} m={m} count={def.months.length} set={(p) => setMonth(i, p)} move={(d) => moveMonth(i, d)}
                  remove={() => set({ months: def.months.filter((_x, j) => j !== i), start: def.start.month >= def.months.length - 1 ? { ...def.start, month: 0 } : def.start })} />
              ))}
            </tbody>
          </table>
          <div className="row tight wrap"><button type="button" onClick={() => set({ months: [...def.months, { name: `Month ${def.months.length + 1}`, days: 30 }] })}>+ Month</button>
            <span className="hint">Year: {yearLength(def, def.start.year)} days. A festival on a day past the month's length (31 of 30) is an extra day outside the month and its weeks.</span></div>
          <div className="row wrap cal-week-leap">
            <div className="field">
              <h3 className="cal-h">Week</h3>
              <span className="row tight wrap">
                {def.weekdays.map((w, i) => (
                  <span key={i} className="row tight">
                    <label className="visually-hidden" htmlFor={`cal-wd-${i}`}>Weekday {i + 1}</label>
                    <input id={`cal-wd-${i}`} className="weekday" value={w} maxLength={40} onChange={(e) => set({ weekdays: def.weekdays.map((x, j) => (j === i ? e.target.value : x)) })} />
                  </span>
                ))}
                <button type="button" aria-label="Add a weekday" onClick={() => set({ weekdays: [...def.weekdays, `Day ${def.weekdays.length + 1}`] })}>+</button>
                {def.weekdays.length > 1 && <button type="button" aria-label="Remove the last weekday" onClick={() => set({ weekdays: def.weekdays.slice(0, -1) })}>−</button>}
              </span>
              <label className="row tight"><input type="checkbox" checked={def.weeksRestart} onChange={(e) => set({ weeksRestart: e.target.checked })} /> Weeks restart each month (festival days are outside the weeks)</label>
            </div>
            <div className="field">
              <h3 className="cal-h">Leap years</h3>
              <span className="row tight wrap">Every
                <label className="visually-hidden" htmlFor="cal-leap">Leap year every N years</label>
                <input id="cal-leap" className="tiny" type="number" min={0} value={leapRule?.every ?? 0}
                  onChange={(e) => { const n = Math.max(0, Math.round(Number(e.target.value))); set({ leap: n ? [{ every: n, leap: true }, ...def.leap.filter((r) => r !== leapRule)] : def.leap.filter((r) => r !== leapRule) }) }} /> years (0 = none)</span>
              {def.leap.filter((r) => !r.leap).map((r, i) => <span key={i} className="hint">…except every {r.every} years{def.leap.some((x) => x.leap && x.every > r.every) ? `, unless every ${def.leap.find((x) => x.leap && x.every > r.every)!.every}` : ''}.</span>)}
              <div className="hint">Leap days: per month (extra days in leap years) or a festival with “leap years only”.</div>
            </div>
          </div>
        </div>

        <div className="cal-col">
          <h3 className="cal-h">Moons</h3>
          <MoonsEditor def={def} moons={def.moons} onChange={(moons) => set({ moons })} />
          <h3 className="cal-h">Seasons</h3>
          <table className="cal-seasons">
            <thead><tr><th>Season</th><th>Starts</th><th><span className="visually-hidden">Remove</span></th></tr></thead>
            <tbody>
              {def.seasons.map((s, i) => (
                <tr key={i}>
                  <td><span className="row tight">
                    <label className="visually-hidden" htmlFor={`cal-sc-${i}`}>Colour</label>
                    <input id={`cal-sc-${i}`} type="color" value={s.colour} onChange={(e) => setSeason(i, { colour: e.target.value })} />
                    <label className="visually-hidden" htmlFor={`cal-sn-${i}`}>Season name</label>
                    <input id={`cal-sn-${i}`} value={s.name} maxLength={40} onChange={(e) => setSeason(i, { name: e.target.value })} /></span></td>
                  <td><span className="row tight">
                    <label className="visually-hidden" htmlFor={`cal-sd-${i}`}>Day</label>
                    <input id={`cal-sd-${i}`} className="tiny" type="number" min={1} value={s.day} onChange={(e) => setSeason(i, { day: Math.max(1, Math.round(Number(e.target.value)) || 1) })} />
                    <label className="visually-hidden" htmlFor={`cal-sm-${i}`}>Month</label>
                    <select id={`cal-sm-${i}`} value={s.month} onChange={(e) => setSeason(i, { month: Number(e.target.value) })}>{def.months.map((m, j) => <option key={j} value={j}>{m.name}</option>)}</select></span></td>
                  <td><button type="button" aria-label={`Remove ${s.name}`} onClick={() => set({ seasons: def.seasons.filter((_x, j) => j !== i), weather: def.weather.filter((_x, j) => j !== i) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" onClick={() => set({ seasons: [...def.seasons, { name: 'New season', month: 0, day: 1, colour: '#8a7a5a' }], weather: [...def.weather, [30, 30, 30, 5, 0, 5]] })}>+ Season</button>
          <h3 className="cal-h">Weather</h3>
          <span className="row tight wrap">
            <label htmlFor="cal-climate">Climate</label>
            <select id="cal-climate" value={def.climate} onChange={(e) => {
              const c = e.target.value as Climate
              set(c === 'custom' ? { climate: c } : { climate: c, weather: climateOdds(c, def.seasons) })
            }}>{CLIMATES.map((c) => <option key={c} value={c}>{CLIMATE_LABELS[c]}</option>)}</select>
          </span>
          <div className="hint">Chance each day, by season (changing a number makes the climate Custom):</div>
          <table className="cal-weather">
            <thead><tr><th><span className="visually-hidden">Season</span></th>{WEATHER_KINDS.map((k) => <th key={k}>{WEATHER_COLUMNS[k]}</th>)}</tr></thead>
            <tbody>
              {def.seasons.map((s, i) => (
                <tr key={i}><th scope="row">{s.name}</th>
                  {WEATHER_KINDS.map((k, j) => (
                    <td key={k}><input className="tiny" type="number" min={0} max={1000} aria-label={`${s.name} ${WEATHER_COLUMNS[k]}`} value={def.weather[i]?.[j] ?? 0}
                      onChange={(e) => {
                        const weather = def.seasons.map((_x, a) => [...(def.weather[a] ?? [0, 0, 0, 0, 0, 0])])
                        weather[i][j] = Math.max(0, Math.min(1000, Number(e.target.value) || 0))
                        set({ weather, climate: 'custom' })
                      }} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">Rolled once per day and kept; the DM can change any day on the calendar. No AI.</div>
        </div>
      </div>
      <div className="dz-actions">
        <span className="hint">Switching calendars keeps every event, beat and card date on the same campaign day; only the names change.</span>
        <span className="spacer" />
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!valid}>Save</button>
      </div>
    </form>
  )
}

function MonthRows({ i, m, count, set, move, remove }: { i: number; m: CalendarDef['months'][number]; count: number; set(p: Partial<CalendarDef['months'][number]>): void; move(d: number): void; remove(): void }) {
  const fests = m.festivals ?? []
  const setFest = (k: number, patch: Partial<typeof fests[number]>) => set({ festivals: fests.map((f, j) => (j === k ? { ...f, ...patch } : f)) })
  return (
    <>
      <tr>
        <td className="ink-muted">{i + 1}</td>
        <td><label className="visually-hidden" htmlFor={`cal-m-${i}`}>Month {i + 1} name</label><input id={`cal-m-${i}`} className="month-name" value={m.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} /></td>
        <td><span className="row tight wrap">
          <label className="visually-hidden" htmlFor={`cal-md-${i}`}>Days in {m.name}</label>
          <input id={`cal-md-${i}`} className="tiny" type="number" min={1} max={400} value={m.days} onChange={(e) => set({ days: Math.max(1, Math.round(Number(e.target.value)) || 1) })} /> days
          {(m.leapDays ?? 0) > 0 && <span className="hint">(+{m.leapDays} in leap years)</span>}
          <button type="button" onClick={() => set({ festivals: [...fests, { name: 'Festival', day: m.days + 1, length: 1 }] })}>+ Festival</button>
        </span></td>
        <td><span className="row tight">
          <button type="button" aria-label={`Move ${m.name} up`} disabled={i === 0} onClick={() => move(-1)}>↑</button>
          <button type="button" aria-label={`Move ${m.name} down`} disabled={i === count - 1} onClick={() => move(1)}>↓</button>
          <button type="button" aria-label={`Remove ${m.name}`} disabled={count <= 1} onClick={remove}>×</button>
        </span></td>
      </tr>
      {fests.map((f, k) => (
        <tr key={k} className="festival-row">
          <td />
          <td><span className="row tight"><span aria-hidden="true">↳</span>
            <label className="visually-hidden" htmlFor={`cal-f-${i}-${k}`}>Festival name</label>
            <input id={`cal-f-${i}-${k}`} className="month-name" value={f.name} maxLength={60} onChange={(e) => setFest(k, { name: e.target.value })} /></span></td>
          <td><span className="row tight wrap">on day
            <label className="visually-hidden" htmlFor={`cal-fd-${i}-${k}`}>On day</label>
            <input id={`cal-fd-${i}-${k}`} className="tiny" type="number" min={1} value={f.day} onChange={(e) => setFest(k, { day: Math.max(1, Math.round(Number(e.target.value)) || 1) })} />
            lasting
            <label className="visually-hidden" htmlFor={`cal-fl-${i}-${k}`}>Lasting days</label>
            <input id={`cal-fl-${i}-${k}`} className="tiny" type="number" min={1} max={60} value={f.length} onChange={(e) => setFest(k, { length: Math.max(1, Math.round(Number(e.target.value)) || 1) })} /> day{f.length === 1 ? '' : 's'}
            <label className="row tight"><input type="checkbox" checked={!!f.leapOnly} onChange={(e) => setFest(k, { leapOnly: e.target.checked || undefined })} /> leap years only</label>
          </span></td>
          <td><button type="button" aria-label={`Remove ${f.name}`} onClick={() => set({ festivals: fests.filter((_x, j) => j !== k) })}>×</button></td>
        </tr>
      ))}
    </>
  )
}

// ---- Date word: add it? -------------------------------------------------------------------------------------------------

export function DateWordDialog({ word, onClose }: { word: { phrase: string; day: number; sentence: string; entityId: string; entityName: string; field: string } | null; onClose(): void }) {
  const { calendar, act, info } = useBoard()
  const [date, setDate] = useState<CalDate | null>(null)
  const [title, setTitle] = useState('')
  const [more, setMore] = useState<EventDraft | null>(null)
  if (!word || !calendar) return <EventDialog draft={more} onClose={() => { setMore(null); onClose() }} />
  const def = calendar.def
  const d = date ?? dateOfDay(def, word.day)
  const day = dayOfDate(def, d)
  const t = title || `${word.entityName}: ${word.sentence.trim().slice(0, 80)}`
  const today = dayOfMinutes(info?.clockMin ?? 0)
  const draft = (): EventDraft => ({
    start: day * MINUTES_PER_DAY, title: t, links: [{ kind: 'card', id: word.entityId }], colour: EVENT_COLOURS[0],
    source: `${word.entityName} › ${word.field}, “${word.phrase}”`
  })
  const close = () => { setDate(null); setTitle(''); onClose() }
  const add = async () => {
    const x = draft()
    await act('calendar:saveEvent', { id: newId(), title: x.title!, start: x.start!, end: null, allDay: true, colour: x.colour!, notes: '', repeat: 'none', links: x.links!, known: false, showNotes: false, source: x.source })
    close()
  }
  return (
    <Dialog title="Add to the calendar?" open onClose={close}>
      <form className="dz-form" onSubmit={(e) => { e.preventDefault(); void add() }}>
        <p>“{word.sentence.trim()}”</p>
        <div className="row tight wrap"><DatePick def={def} value={d} onChange={setDate} idPrefix="dw" /><span className="ink-muted">{daysFromNow(day, today)}</span></div>
        <div className="field"><label htmlFor="dw-title">Title</label><input id="dw-title" value={t} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="hint">Read from the clock now ({formatDay(def, today)}). Linked to {word.entityName}. Nothing is added until Add.</div>
        <div className="dz-actions">
          <button type="button" onClick={() => { void act('calendar:dateWordOff', { entityId: word.entityId, phrase: word.phrase }); close() }}>Not a date</button>
          <button type="button" onClick={() => { setMore(draft()); onClose() }}>More…</button>
          <button type="button" onClick={close}>Cancel</button>
          <button type="submit" className="primary">Add</button>
        </div>
      </form>
    </Dialog>
  )
}


/** Today's weather and moons at a campaign minute (Desk, Live). */
export function calendarNow(cal: { def: CalendarDef; weather: Record<string, WeatherKind> }, minutes: number) {
  const day = dayOfMinutes(minutes)
  const w = weatherOn(cal.def, cal.weather, day)
  const night = !isDaytime(minutes)
  return {
    day, weather: w.kind, weatherWord: WEATHER_WORDS[w.kind][night ? 'night' : 'day'],
    moons: cal.def.moons.filter((m) => m.status !== 'defunct').map((m) => ({ moon: m, state: moonAt(cal.def, m, minutes) }))
  }
}
const isDaytime = (minutes: number) => { const m = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY; return m >= 360 && m < 1080 }

// ---- card sheets: the Dates box, and the card date words are read on ----------------------------------------------------

/** The card whose text boxes are being edited (card sheets): its date words can be added to the calendar. */
export const DateWordContext = createContext<{ entityId: string; entityName: string } | null>(null)

/** Card sheet › Dates (3.9): every event linked to this card, and Timeline beats marked with it. */
export function DatesPanel({ entityId, entityName }: { entityId: string; entityName: string }) {
  const { calendar, info, showCalendar } = useBoard()
  const [draft, setDraft] = useState<EventDraft | null>(null)
  if (!calendar) return null
  const def = calendar.def
  const today = dayOfMinutes(info?.clockMin ?? 0)
  const events = calendar.events.filter((e) => e.links.some((l) => l.kind === 'card' && l.id === entityId))
    .map((e) => {
      const next = e.repeat === 'none' ? null : occurrences(def, [e], today, today + 2000)[0]
      return { e, day: next ? next.startDay : dayOfMinutes(e.start) }
    }).sort((a, b) => a.day - b.day)
  const beats = calendar.acts.filter((a) => a.cardIds.includes(entityId))
  return (
    <section className="panel dates-panel">
      <div className="row spread"><h2 className="panel-heading">Dates</h2>
        <button onClick={() => setDraft({ links: [{ kind: 'card', id: entityId }], title: entityName, start: today * MINUTES_PER_DAY })}>+ Add a date</button></div>
      {events.length === 0 && beats.length === 0 && <p className="hint">No dates yet. Add one, or click a dotted date word in this card's text.</p>}
      <ul className="dates-list">
        {events.map(({ e, day }) => (
          <li key={e.id}>
            <span className="dates-when"><strong>{e.repeat === 'yearly' ? `Every ${formatDay(def, day, false)}` : formatDay(def, day)}</strong>
              <span className="hint">{e.repeat !== 'none' ? REPEAT_LABELS[e.repeat].toLowerCase() : daysFromNow(day, today)}{day < 0 ? ' · before Day 1' : ''}</span></span>
            <span className="dates-what"><span className="cal-dot" style={{ background: e.colour }} aria-hidden="true" />{e.title}{e.known && <span className="hint"> · ★ party knows</span>}</span>
            <span className="row tight"><button onClick={() => setDraft({ event: e })}>Edit</button><button onClick={() => showCalendar(day, 'day')}>Open in calendar</button></span>
          </li>
        ))}
        {beats.map((a) => (
          <li key={a.id}>
            <span className="dates-when"><strong>{formatDay(def, dayOfMinutes(a.startMin))}</strong><span className="hint">Timeline beat</span></span>
            <span className="dates-what">{a.title} <span className="hint">(edit it on the Timeline)</span></span>
            <span className="row tight"><button onClick={() => { useBoard.setState({ timelineFocus: a.storylineId }); useBoard.getState().goTo('timeline') }}>Open the beat</button></span>
          </li>
        ))}
      </ul>
      <EventDialog draft={draft} onClose={() => setDraft(null)} />
    </section>
  )
}
