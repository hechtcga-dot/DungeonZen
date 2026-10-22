// Time is stored as integer minutes from campaign start (CLAUDE.md rule 5).
// Days and hours are for display only. Minute 0 is Day 1, 00:00.

export const MINUTES_PER_HOUR = 60
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR

export interface ClockParts {
  day: number // 1-based
  hour: number
  minute: number
}

export function toClockParts(totalMinutes: number): ClockParts {
  if (!Number.isInteger(totalMinutes) || totalMinutes < 0) {
    throw new RangeError(`Campaign time must be a whole number of minutes >= 0, got ${totalMinutes}`)
  }
  const day = Math.floor(totalMinutes / MINUTES_PER_DAY) + 1
  const inDay = totalMinutes % MINUTES_PER_DAY
  return { day, hour: Math.floor(inDay / MINUTES_PER_HOUR), minute: inDay % MINUTES_PER_HOUR }
}

// The campaign calendar names the days (3.9, `calendar.ts` `useCalendar`); none set: "Day 12".
let dateOf: ((day: number) => string) | null = null
export function setDateFormatter(fn: ((day: number) => string) | null): void { dateOf = fn }

/** The day's name: "14 Tarsakh 1492 DR" with a calendar, else "Day 12" (campaign day 0 = Day 1). */
export function formatDayName(day: number): string {
  return dateOf ? dateOf(day) : `Day ${day + 1}`
}

export function formatClock(totalMinutes: number): string {
  const { day, hour, minute } = toClockParts(totalMinutes)
  return `${formatDayName(day - 1)} · ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/** "Day 12" for hover text next to a calendar date. */
export const dayNumberText = (totalMinutes: number) => `Day ${Math.floor(totalMinutes / MINUTES_PER_DAY) + 1}`

export function fromClockParts({ day, hour, minute }: ClockParts): number {
  return (day - 1) * MINUTES_PER_DAY + hour * MINUTES_PER_HOUR + minute
}

/** A real-life date the DM set (YYYY-MM-DD), or an ISO time, as "Oct 17, 2026". */
export function playDateText(date: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : new Date(date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(date) ? 'UTC' : undefined })
}

/** How a session's notes are labelled: "Session 3 · The Drowned Bell · Oct 17, 2026" (title and date when there are any). */
export function sessionLabel(number: number, title: string, date: string | null): string {
  return [`Session ${number}`, title.trim(), date ? playDateText(date) : ''].filter(Boolean).join(' · ')
}

/** Ctrl+K time steps (3.1): "+2h", "+30 min", "-1 h", "advance 45m", "+3 days" → minutes; anything else → null. */
export function parseTimeStep(text: string): number | null {
  const t = text.trim()
  const m = /^(?:advance\s+|\+|(-))\s*(\d{1,4})\s*(h|hrs?|hours?|m|mins?|minutes?|d|days?)$/i.exec(t)
  if (!m) return null
  const n = Number(m[2]) * (/^d/i.test(m[3]) ? 1440 : /^h/i.test(m[3]) ? 60 : 1)
  return m[1] ? -n : n
}
export function timeStepLabel(min: number): string {
  const a = Math.abs(min)
  const t = a % 1440 === 0 ? `${a / 1440} day${a === 1440 ? '' : 's'}` : a % 60 === 0 ? `${a / 60} h` : `${a} min`
  return `${min < 0 ? 'Move the clock back' : 'Advance time'} ${t}`
}
