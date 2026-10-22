import { useState, type ReactNode } from 'react'
import { useBoard } from '../store'
import { DeskFrame } from '../components/DeskFrame'
import { ScreenHeader } from '../components/TopBar'
import { CalendarSettingsDialog, DatePick, EventDialog, MoonIcon, WeatherIcon, daysFromNow, type EventDraft } from '../components/CalendarDialogs'
import {
  WEATHER_KINDS, WEATHER_WORDS, activeMoons, addMonths, dateOfDay, dayOfDate, dayOfMinutes, festivalOn, formatDate, formatDay, monthShape,
  moonAt, occurrences, pickWeather, seasonOn, timeText, weatherOn, weekdayOf, yearText, type CalDate, type CalendarDef, type Occurrence, type WeatherKind
} from '../../shared/calendar'
import { MINUTES_PER_DAY } from '../../shared/time'
import type { CalendarView } from '../../shared/types'

// Calendar screen (3.9): Day, Week, Month and Year views of the campaign's calendar. Events, Timeline beats (click opens
// the Timeline), card dates (events linked to cards), moons, weather, festivals and seasons. The side panel (Settings ›)
// moves the campaign clock, sets the day's weather and opens Calendar settings; folded by default (owner, 2026-10-22).

type Mode = 'day' | 'week' | 'month' | 'year'
type Show = 'events' | 'beats' | 'moons' | 'weather' | 'festivals'
const SHOW_LABELS: Record<Show, string> = { events: 'Events', beats: 'Timeline beats', moons: 'Moons', weather: 'Weather', festivals: 'Festivals' }
let panelOpen = false
let shown: Record<Show, boolean> = { events: true, beats: true, moons: true, weather: true, festivals: true }

export function CalendarScreen() {
  const calendar = useBoard((s) => s.calendar)
  return (
    <DeskFrame>
      <ScreenHeader title="Calendar" />
      {calendar ? <Calendar cal={calendar} /> : <p className="desk-loading">Opening the calendar…</p>}
    </DeskFrame>
  )
}

interface Beat { id: string; storylineId: string; title: string; startMin: number; endMin: number; label: string }
interface DayItems { occ: Occurrence[]; beats: Beat[] }

function Calendar({ cal }: { cal: CalendarView }) {
  const { info, act, calendarDay, calendarMode, showCalendar } = useBoard()
  const def = cal.def
  const now = info?.clockMin ?? 0
  const today = dayOfMinutes(now)
  const day = calendarDay ?? today
  const mode = calendarMode
  const [panel, setPanel] = useState(panelOpen)
  const [show, setShow] = useState(shown)
  const [draft, setDraft] = useState<EventDraft | null>(null)
  const [settings, setSettings] = useState(false)
  const date = dateOfDay(def, day)
  const go = (d: number, m: Mode = mode) => showCalendar(d, m)

  // What a span of days holds (events, beats).
  const itemsFor = (from: number, to: number): Map<number, DayItems> => {
    const map = new Map<number, DayItems>()
    const at = (d: number) => { let x = map.get(d); if (!x) { x = { occ: [], beats: [] }; map.set(d, x) } return x }
    if (show.events) for (const o of occurrences(def, cal.events, from, to)) for (let d = Math.max(from, o.startDay); d <= Math.min(to, o.endDay); d++) at(d).occ.push(o)
    if (show.beats) for (const a of cal.acts) {
      const d = dayOfMinutes(a.startMin)
      if (d >= from && d <= to) at(d).beats.push({ id: a.id, storylineId: a.storylineId, title: a.title, startMin: a.startMin, endMin: a.endMin, label: roman(a.storyNumber) })
    }
    return map
  }
  const openBeat = (b: Beat) => { useBoard.setState({ timelineFocus: b.storylineId }); useBoard.getState().goTo('timeline') }
  const step = (n: number) => {
    if (mode === 'day') go(day + n)
    else if (mode === 'week') go(day + n * def.weekdays.length)
    else if (mode === 'month') go(dayOfDate(def, { ...addMonths(def, date, n), day: 1 }))
    else go(dayOfDate(def, { year: date.year + n, month: 0, day: 1 }))
  }
  const title = mode === 'year' ? yearText(def, date.year)
    : mode === 'month' ? `${def.months[date.month].name} ${yearText(def, date.year)}`
      : mode === 'week' ? weekTitle(def, weekDays(def, day))
        : formatDay(def, day)

  return (
    <>
    <main className="calendar-screen">
      {panel && (
        <SidePanel cal={cal} now={now} show={show} setShow={(s) => { shown = s; setShow(s) }} onSettings={() => setSettings(true)} />
      )}
      <section className="cal-main" aria-label="Calendar">
        <div className="cal-bar">
          <button className="brass" aria-expanded={panel} onClick={() => { panelOpen = !panel; setPanel(!panel) }}>{panel ? '‹ Settings' : 'Settings ›'}</button>
          <button className="brass" aria-label={`Previous ${mode}`} onClick={() => step(-1)}>‹</button>
          <h2 className="cal-title" title={mode === 'day' ? `Day ${day + 1}` : undefined}>{title}</h2>
          <button className="brass" aria-label={`Next ${mode}`} onClick={() => step(1)}>›</button>
          <button className="brass" onClick={() => go(today)}>Today</button>
          <span className="spacer" />
          <span className="seg on-wood" role="group" aria-label="View">
            {(['day', 'week', 'month', 'year'] as Mode[]).map((m) => <button key={m} className="brass" aria-pressed={mode === m} onClick={() => go(day, m)}>{m[0].toUpperCase() + m.slice(1)}</button>)}
          </span>
          <button className="wax" onClick={() => setDraft({ start: day * MINUTES_PER_DAY })}>+ Add event</button>
        </div>
        {mode === 'month' && <MonthView cal={cal} date={date} today={today} day={day} show={show} itemsFor={itemsFor} go={go} add={(d) => setDraft({ start: d * MINUTES_PER_DAY })} openEvent={(e) => setDraft({ event: e })} openBeat={openBeat} />}
        {mode === 'week' && <WeekView cal={cal} days={weekDays(def, day)} today={today} show={show} itemsFor={itemsFor} go={go} openEvent={(e) => setDraft({ event: e })} openBeat={openBeat} />}
        {mode === 'day' && <DayView cal={cal} day={day} now={now} show={show} items={itemsFor(day, day).get(day) ?? { occ: [], beats: [] }} add={() => setDraft({ start: day * MINUTES_PER_DAY })}
          openEvent={(e) => setDraft({ event: e })} openBeat={openBeat} setClock={() => void act('clock:set', { minutes: Math.max(0, day * MINUTES_PER_DAY + (now % MINUTES_PER_DAY)) })} />}
        {mode === 'year' && <YearView cal={cal} year={date.year} today={today} itemsFor={itemsFor} go={go} />}
        <p className="cal-tip">Click a day: Day view. Double-click: new event on that day. Hover a date for its campaign day number.</p>
      </section>
    </main>
    <EventDialog draft={draft} onClose={() => setDraft(null)} />
    <CalendarSettingsDialog open={settings} onClose={() => setSettings(false)} />
    </>
  )
}

const roman = (n: number) => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][n] ?? String(n)

/** The days of the week that holds `day` (weeks restart each month: within that month). */
function weekDays(def: CalendarDef, day: number): number[] {
  const n = def.weekdays.length
  const date = dateOfDay(def, day)
  const wd = weekdayOf(def, date)
  if (wd === null) return [day] // a festival day outside the weeks
  const first = day - wd
  return [...Array(n)].map((_, i) => first + i)
}
const weekTitle = (def: CalendarDef, days: number[]) => days.length === 1 ? formatDay(def, days[0])
  : `${formatDay(def, days[0], false)} – ${formatDay(def, days[days.length - 1])}`

function Chip({ o, onClick, past }: { o: Occurrence; onClick(): void; past: boolean }) {
  const e = o.event
  const repeat = e.repeat !== 'none' ? '↻ ' : ''
  const card = e.links.some((l) => l.kind === 'card') ? '◆ ' : ''
  return (
    <button className={`cal-chip${past ? ' past' : ''}`} style={{ background: e.colour }} onClick={(ev) => { ev.stopPropagation(); onClick() }}
      title={`${e.title}${e.allDay ? '' : ` · ${timeText(o.startMin)}`}${e.known ? ' · the party knows' : ''}`}>
      {repeat}{card}{e.allDay ? '' : `${timeText(o.startMin)} `}{e.title}{e.known ? ' ★' : ''}
    </button>
  )
}
function BeatChip({ b, onClick, past }: { b: Beat; onClick(): void; past: boolean }) {
  return (
    <button className={`cal-chip beat${past ? ' past' : ''}`} onClick={(ev) => { ev.stopPropagation(); onClick() }} title={`Timeline beat: ${b.title} (opens the Timeline)`}>
      <b>{b.label}</b> {b.title}
    </button>
  )
}

interface ViewProps {
  cal: CalendarView; today: number; show: Record<Show, boolean>; itemsFor(from: number, to: number): Map<number, DayItems>; go(d: number, m?: Mode): void
  openEvent(e: Occurrence['event']): void; openBeat(b: Beat): void
}

function DayCell({ cal, d, today, show, items, children, selected, onOpen, onAdd, openEvent, openBeat }: {
  cal: CalendarView; d: number; today: number; show: Record<Show, boolean>; items?: DayItems; children?: ReactNode; selected?: boolean
  onOpen(): void; onAdd(): void; openEvent(e: Occurrence['event']): void; openBeat(b: Beat): void
}) {
  const def = cal.def
  const date = dateOfDay(def, d)
  const fest = show.festivals && !children ? festivalOn(def, date) : null
  const moons = show.moons ? activeMoons(def).slice(0, 3) : []
  const w = show.weather ? weatherOn(def, cal.weather, d) : null
  const past = d < today
  return (
    <div className={`cal-cell${d === today ? ' today' : ''}${past ? ' past' : ''}${selected ? ' selected' : ''}`} onClick={onOpen} onDoubleClick={onAdd}
      role="button" tabIndex={0} aria-label={`${formatDay(def, d)}${d === today ? ', today' : ''}`} title={`${formatDay(def, d)} · Day ${d + 1}`}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <div className="cal-cell-head">
        <span className="cal-num">{children ?? date.day}</span>
        <span className="spacer" />
        {moons.map((m) => { const s = moonAt(def, m, d * MINUTES_PER_DAY + 22 * 60); return <MoonIcon key={m.name} phase={s.phase} colour={m.colour} title={`${m.name}: ${s.name}`} /> })}
        {w && <WeatherIcon kind={w.kind} />}
      </div>
      {fest && <div className="cal-fest">{fest}</div>}
      {items?.occ.map((o) => <Chip key={o.event.id + o.startDay} o={o} past={past} onClick={() => openEvent(o.event)} />)}
      {items?.beats.map((b) => <BeatChip key={b.id} b={b} past={past} onClick={() => openBeat(b)} />)}
    </div>
  )
}

function MonthView(p: ViewProps & { date: CalDate; day: number; add(d: number): void }) {
  const def = p.cal.def
  const shape = monthShape(def, p.date.year, p.date.month)
  const first = dayOfDate(def, { ...p.date, day: 1 })
  const n = def.weekdays.length
  const lead = weekdayOf(def, { ...p.date, day: 1 }) ?? 0
  const items = p.itemsFor(first, first + shape.days + shape.extra.length - 1)
  const cells = [...Array(shape.days)].map((_, i) => first + i)
  return (
    <div className="cal-month parchment-note">
      <div className="cal-weekdays" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {def.weekdays.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="cal-grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {[...Array(lead)].map((_, i) => <div key={`lead${i}`} className="cal-cell blank" aria-hidden="true" />)}
        {cells.map((d) => <DayCell key={d} cal={p.cal} d={d} today={p.today} show={p.show} items={items.get(d)} selected={d === p.day}
          onOpen={() => p.go(d, 'day')} onAdd={() => p.add(d)} openEvent={p.openEvent} openBeat={p.openBeat} />)}
      </div>
      {shape.extra.length > 0 && (
        <div className="cal-extra">
          {shape.extra.map((x) => {
            const d = first + x.day - 1
            return <DayCell key={d} cal={p.cal} d={d} today={p.today} show={p.show} items={items.get(d)} selected={d === p.day}
              onOpen={() => p.go(d, 'day')} onAdd={() => p.add(d)} openEvent={p.openEvent} openBeat={p.openBeat}>{x.name}</DayCell>
          })}
          <span className="hint">Festival day{shape.extra.length > 1 ? 's' : ''} after the month, outside the weeks</span>
        </div>
      )}
    </div>
  )
}

function WeekView(p: ViewProps & { days: number[] }) {
  const def = p.cal.def
  const items = p.itemsFor(p.days[0], p.days[p.days.length - 1])
  return (
    <div className="cal-week parchment-note" style={{ gridTemplateColumns: `repeat(${p.days.length}, minmax(0, 1fr))` }}>
      {p.days.map((d) => {
        const date = dateOfDay(def, d)
        const wd = weekdayOf(def, date)
        const it = items.get(d)
        return (
          <div key={d} className={`cal-week-day${d === p.today ? ' today' : ''}${d < p.today ? ' past' : ''}`}>
            <button className="cal-week-head" onClick={() => p.go(d, 'day')} title={`Day ${d + 1}`}>
              <span>{wd !== null ? def.weekdays[wd] : festivalOn(def, date)}</span><strong>{formatDate(def, date, false)}</strong>
            </button>
            {p.show.weather && <span className="cal-week-weather"><WeatherIcon kind={weatherOn(def, p.cal.weather, d).kind} /> {WEATHER_WORDS[weatherOn(def, p.cal.weather, d).kind].day}</span>}
            {it?.occ.map((o) => <Chip key={o.event.id + o.startDay} o={o} past={d < p.today} onClick={() => p.openEvent(o.event)} />)}
            {it?.beats.map((b) => <BeatChip key={b.id} b={b} past={d < p.today} onClick={() => p.openBeat(b)} />)}
          </div>
        )
      })}
    </div>
  )
}

function DayView(p: { cal: CalendarView; day: number; now: number; show: Record<Show, boolean>; items: DayItems; add(): void; openEvent(e: Occurrence['event']): void; openBeat(b: Beat): void; setClock(): void }) {
  const { act } = useBoard()
  const def = p.cal.def
  const date = dateOfDay(def, p.day)
  const today = dayOfMinutes(p.now)
  const wd = weekdayOf(def, date)
  const s = seasonOn(def, date)
  const w = weatherOn(def, p.cal.weather, p.day)
  const fest = festivalOn(def, date)
  const spans = occurrences(def, p.cal.events, p.day, p.day).filter((o) => o.endDay > o.startDay)
  return (
    <div className="cal-day parchment-note">
      <p className="ink-muted">{[wd !== null ? def.weekdays[wd] : null, fest, `Day ${p.day + 1}`, daysFromNow(p.day, today), s >= 0 ? def.seasons[s].name : null].filter(Boolean).join(' · ')}</p>
      <div className="cal-day-boxes">
        <div className="cal-box">
          <h3 className="panel-title">Weather</h3>
          <WeatherSetter cal={p.cal} day={p.day} />
          {!w.set && <div className="hint">Rolled for {s >= 0 ? def.seasons[s].name.toLowerCase() : 'the season'}.</div>}
        </div>
        <div className="cal-box">
          <h3 className="panel-title">Moons</h3>
          {activeMoons(def).map((m) => { const st = moonAt(def, m, p.day * MINUTES_PER_DAY + 22 * 60); return <div key={m.name} className="row tight"><MoonIcon phase={st.phase} colour={m.colour} size={20} title={st.name} /> {m.name}: {st.name}</div> })}
          <div className="hint">Sunrise 06:00 · Sunset 18:00</div>
        </div>
      </div>
      <h3 className="panel-title">On this day</h3>
      {p.items.occ.length === 0 && p.items.beats.length === 0 && <p className="ink-muted">Nothing yet.</p>}
      <ul className="cal-day-list">
        {p.items.occ.map((o) => (
          <li key={o.event.id + o.startDay}>
            <span className="ink-muted">{o.event.allDay ? 'All day' : timeText(o.startMin)}</span>
            <button className="cal-day-item" style={{ borderLeftColor: o.event.colour }} onClick={() => p.openEvent(o.event)}>
              <strong>{o.event.repeat !== 'none' ? '↻ ' : ''}{o.event.title}{o.event.known ? ' ★' : ''}</strong>
              {o.event.notes && <span className="ink-muted">{o.event.notes}</span>}
              {o.event.links.length > 0 && <span className="ink-muted">Linked: {o.event.links.map((l) => linkName(p.cal, l)).join(', ')}</span>}
            </button>
          </li>
        ))}
        {p.items.beats.map((b) => (
          <li key={b.id}>
            <span className="ink-muted">{timeText(b.startMin)}</span>
            <button className="cal-day-item beat" onClick={() => p.openBeat(b)}><strong>{b.label} · {b.title}</strong><span className="ink-muted">Timeline beat, ends {formatDay(def, dayOfMinutes(b.endMin))} {timeText(b.endMin)}. Opens the Timeline.</span></button>
          </li>
        ))}
      </ul>
      {spans.length > 0 && (
        <>
          <h3 className="panel-title">Running</h3>
          {spans.map((o) => <p key={o.event.id}>{o.event.title}: {formatDay(def, o.startDay, false)} to {formatDay(def, o.endDay)} (day {p.day - o.startDay + 1} of {o.endDay - o.startDay + 1})</p>)}
        </>
      )}
      <div className="row tight wrap">
        <button className="ink-button primary-ink" onClick={p.add}>+ Add event on this day</button>
        {p.day !== today && <button className="ink-button" onClick={p.setClock}>Set the clock to this day</button>}
        {w.set && <button className="ink-button" onClick={() => void act('calendar:setWeather', { day: p.day, kind: null })}>Weather back to rolled</button>}
      </div>
    </div>
  )
}

function linkName(cal: CalendarView, l: { kind: string; id: string }): string {
  if (l.kind === 'card') return cal.cards.find((c) => c.id === l.id)?.name ?? '(gone)'
  if (l.kind === 'secret') return `secret “${(cal.secrets.find((s) => s.id === l.id)?.text ?? '').slice(0, 40)}”`
  return cal.storylines.find((s) => s.id === l.id)?.title ?? '(gone)'
}

/** The day's weather with a picker (the DM's change, undoable) and Roll again. */
export function WeatherSetter({ cal, day }: { cal: CalendarView; day: number }) {
  const { act } = useBoard()
  const def = cal.def
  const w = weatherOn(def, cal.weather, day)
  const s = seasonOn(def, dateOfDay(def, day))
  return (
    <div className="row tight wrap weather-set">
      <WeatherIcon kind={w.kind} size={26} />
      <label className="visually-hidden" htmlFor={`weather-${day}`}>Weather</label>
      <select id={`weather-${day}`} className="ink-select" value={w.kind} onChange={(e) => void act('calendar:setWeather', { day, kind: e.target.value as WeatherKind })}>
        {WEATHER_KINDS.map((k) => <option key={k} value={k}>{WEATHER_WORDS[k].day}</option>)}
      </select>
      <button className="ink-button" onClick={() => void act('calendar:setWeather', { day, kind: pickWeather(def.weather[s], Math.random()) })}>Roll again</button>
      {w.set && <span className="ink-muted">set by the DM</span>}
    </div>
  )
}

function YearView({ cal, year, today, itemsFor, go }: { cal: CalendarView; year: number; today: number; itemsFor: ViewProps['itemsFor']; go(d: number, m?: Mode): void }) {
  const def = cal.def
  const first = dayOfDate(def, { year, month: 0, day: 1 })
  const last = dayOfDate(def, { year: year + 1, month: 0, day: 1 }) - 1
  const items = itemsFor(first, last)
  const fulls = new Set<number>()
  const moon = activeMoons(def)[0]
  if (moon) for (let d = first; d <= last; d++) { const a = moonAt(def, moon, d * MINUTES_PER_DAY).phase, b = moonAt(def, moon, (d + 1) * MINUTES_PER_DAY).phase; if (a <= 0.5 && b > 0.5) fulls.add(d) }
  return (
    <div className="cal-year">
      {def.months.map((m, mi) => {
        const shape = monthShape(def, year, mi)
        const start = dayOfDate(def, { year, month: mi, day: 1 })
        const s = def.seasons[seasonOn(def, { year, month: mi, day: 1 })]
        return (
          <div key={mi} className={`cal-year-month parchment-note${today >= start && today < start + shape.days + shape.extra.length ? ' now' : ''}`}>
            <button className="cal-year-name" onClick={() => go(start, 'month')}>{m.name}</button>
            <div className="cal-year-days" style={{ gridTemplateColumns: `repeat(${Math.min(def.weekdays.length, 10)}, minmax(0, 1fr))` }}>
              {[...Array(shape.days)].map((_, i) => {
                const d = start + i
                const it = items.get(d)
                return <button key={d} className={`cal-year-day${d === today ? ' today' : ''}${d < today ? ' past' : ''}${it && (it.occ.length || it.beats.length) ? ' busy' : ''}${fulls.has(d) ? ' full' : ''}`}
                  title={`${formatDay(def, d)} · Day ${d + 1}${it ? ` · ${[...it.occ.map((o) => o.event.title), ...it.beats.map((b) => b.title)].join(', ')}` : ''}`} onClick={() => go(d, 'day')}>{i + 1}</button>
              })}
            </div>
            {s && <div className="cal-year-season" style={{ background: s.colour }} title={s.name} />}
            {shape.extra.length > 0 && <div className="hint">Then: {shape.extra.map((x) => x.name).join(', ')}</div>}
          </div>
        )
      })}
    </div>
  )
}

function SidePanel({ cal, now, show, setShow, onSettings }: { cal: CalendarView; now: number; show: Record<Show, boolean>; setShow(s: Record<Show, boolean>): void; onSettings(): void }) {
  const { act } = useBoard()
  const def = cal.def
  const today = dayOfMinutes(now)
  const date = dateOfDay(def, today)
  const inDay = now - today * MINUTES_PER_DAY
  const setDate = (d: CalDate) => { const day = dayOfDate(def, d); if (day >= 0) void act('clock:set', { minutes: day * MINUTES_PER_DAY + inDay }) }
  const shift = (min: number) => void act('clock:set', { minutes: Math.max(0, now + min) })
  const s = seasonOn(def, date)
  return (
    <aside className="cal-side parchment-note" aria-label="Calendar settings and the clock">
      <h2 className="panel-title">Now</h2>
      <div className="mono" title={`Day ${today + 1}`}>{formatDay(def, today)} · {timeText(now)}</div>
      <div className="hint">{weekdayOf(def, date) !== null ? `${def.weekdays[weekdayOf(def, date)!]} · ` : ''}Day {today + 1}{s >= 0 ? ` · ${def.seasons[s].name}` : ''}</div>
      <div className="cal-side-steps">
        <span className="row tight"><button className="ink-button" aria-label="Year back" onClick={() => setDate({ ...date, year: date.year - 1 })}>−</button><span className="cal-side-val">{yearText(def, date.year)}</span><button className="ink-button" aria-label="Year on" onClick={() => setDate({ ...date, year: date.year + 1 })}>+</button></span>
        <span className="row tight"><button className="ink-button" aria-label="Month back" onClick={() => setDate(addMonths(def, date, -1))}>−</button><span className="cal-side-val">{def.months[date.month].name}</span><button className="ink-button" aria-label="Month on" onClick={() => setDate(addMonths(def, date, 1))}>+</button></span>
        <span className="row tight"><button className="ink-button" aria-label="Day back" onClick={() => shift(-MINUTES_PER_DAY)}>−</button><span className="cal-side-val">{formatDate(def, date, false)}</span><button className="ink-button" aria-label="Day on" onClick={() => shift(MINUTES_PER_DAY)}>+</button></span>
        <span className="row tight"><button className="ink-button" onClick={() => shift(-60)}>−1 h</button><button className="ink-button" onClick={() => shift(-30)}>−30 m</button><span className="cal-side-val mono">{timeText(now)}</span><button className="ink-button" onClick={() => shift(30)}>+30 m</button><button className="ink-button" onClick={() => shift(60)}>+1 h</button></span>
      </div>
      <div className="field"><span className="field-label">Go to a date</span><DatePick def={def} value={date} onChange={setDate} idPrefix="side-date" /></div>
      <div className="hint">Moves the campaign clock (undoable). Clicking a day only looks at it.</div>
      <h2 className="panel-title">Weather today</h2>
      <WeatherSetter cal={cal} day={today} />
      <div className="hint">Climate: {def.climate}. Set in Calendar settings.</div>
      <h2 className="panel-title">Show</h2>
      <div className="cal-show">
        {(Object.keys(SHOW_LABELS) as Show[]).map((k) => <label key={k} className="row tight"><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {SHOW_LABELS[k]}</label>)}
      </div>
      <h2 className="panel-title">Key</h2>
      <div className="cal-key">
        <span><span className="cal-chip" style={{ background: '#2f6f8f' }}>Event</span> colour the DM picks</span>
        <span><span className="cal-chip beat"><b>II</b> Beat</span> Timeline beat</span>
        <span><span className="cal-chip" style={{ background: '#6b4f8f' }}>◆ Card</span> linked to a card</span>
        <span><span className="cal-chip" style={{ background: '#2f6f8f' }}>↻ Repeats</span> ★ party knows</span>
      </div>
      <button className="ink-button" onClick={onSettings}>Calendar settings…</button>
    </aside>
  )
}
