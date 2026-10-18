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

export function formatClock(totalMinutes: number): string {
  const { day, hour, minute } = toClockParts(totalMinutes)
  return `Day ${day} · ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

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
