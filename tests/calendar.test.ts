import { afterEach, describe, expect, it } from 'vitest'
import {
  CALENDAR_PRESETS, CalendarDef, absOf, campaignCalendar, dateOfAbs, dateOfDay, dayOfDate, findDateWords, festivalOn, formatDate, formatDay,
  isLeapYear, monthShape, moonAt, nextFullDay, occurrences, presetCalendar, rolledWeather, seasonOn, useCalendar, weekdayOf, yearLength, type CalEvent
} from '../src/shared/calendar'
import { formatClock, setDateFormatter } from '../src/shared/time'

const harptos = presetCalendar('harptos')!
const greg = presetCalendar('gregorian')!
const ev = (p: Partial<CalEvent>): CalEvent => ({ id: 'e', title: 'Event', start: 0, end: null, allDay: true, colour: '#2f6f8f', notes: '', repeat: 'none', links: [], known: false, showNotes: false, ...p })

afterEach(() => setDateFormatter(null))

describe('calendar presets', () => {
  it('are valid calendars', () => {
    for (const p of CALENDAR_PRESETS) expect(CalendarDef.safeParse(p).success, p.name).toBe(true)
  })
  it('have the right year lengths', () => {
    expect(yearLength(harptos, 1492)).toBe(366) // leap: Shieldmeet
    expect(yearLength(harptos, 1491)).toBe(365)
    expect(yearLength(greg, 2024)).toBe(366)
    expect(yearLength(greg, 1900)).toBe(365)
    expect(yearLength(greg, 2000)).toBe(366)
    expect(yearLength(presetCalendar('exandria')!, 835)).toBe(328)
    expect(yearLength(presetCalendar('greyhawk')!, 576)).toBe(364)
    expect(isLeapYear(greg, 2100)).toBe(false)
  })
  it('Gregorian weekdays match the real ones', () => {
    expect(greg.weekdays[weekdayOf(greg, { year: 2026, month: 0, day: 1 })!]).toBe('Thursday')
    expect(greg.weekdays[weekdayOf(greg, { year: 2026, month: 9, day: 22 })!]).toBe('Thursday')
    expect(greg.weekdays[weekdayOf(greg, { year: 2000, month: 1, day: 29 })!]).toBe('Tuesday')
  })
})

describe('dates', () => {
  it('Day 1 is the start date; festival days sit past the month', () => {
    expect(formatDay(harptos, 0)).toBe('1 Hammer 1492 DR')
    expect(formatDay(harptos, 29)).toBe('30 Hammer 1492 DR')
    expect(formatDay(harptos, 30)).toBe('Midwinter 1492 DR')
    expect(formatDay(harptos, 31)).toBe('1 Alturiak 1492 DR')
    expect(formatDay(harptos, 104)).toBe('14 Tarsakh 1492 DR')
    expect(festivalOn(harptos, dateOfDay(harptos, 30))).toBe('Midwinter')
    expect(weekdayOf(harptos, dateOfDay(harptos, 30))).toBeNull()
    expect(harptos.weekdays[weekdayOf(harptos, dateOfDay(harptos, 104))!]).toBe('Fourth-day')
  })
  it('round-trips days and dates across years, also before Day 1', () => {
    for (const def of CALENDAR_PRESETS) for (const d of [-800, -1, 0, 1, 364, 365, 366, 1500, 40000]) expect(dayOfDate(def, dateOfDay(def, d)), def.name).toBe(d)
    for (const a of [-3000, -1, 0, 5, 1000000]) expect(absOf(greg, dateOfAbs(greg, a))).toBe(a)
  })
  it('leap-only festivals exist only in leap years', () => {
    expect(monthShape(harptos, 1492, 6).extra.map((x) => x.name)).toEqual(['Midsummer', 'Shieldmeet'])
    expect(monthShape(harptos, 1493, 6).extra.map((x) => x.name)).toEqual(['Midsummer'])
  })
  it('festivals on a day inside the month name that day', () => {
    const ex = presetCalendar('exandria')!
    expect(festivalOn(ex, { year: 835, month: 0, day: 1 })).toBe('New Dawn')
    expect(formatDate(ex, { year: 835, month: 0, day: 1 })).toBe('1 Horisal 835 P.D.')
  })
  it('formatClock shows the calendar date once a calendar is in use', () => {
    expect(formatClock(0)).toBe('Day 1 · 00:00')
    useCalendar(harptos)
    expect(formatClock(104 * 1440 + 617)).toBe('14 Tarsakh 1492 DR · 10:17')
  })
})

describe('moons, seasons, weather', () => {
  it('a moon is full on its full date', () => {
    const m = harptos.moons[0]
    const day = dayOfDate(harptos, m.full)
    expect(moonAt(harptos, m, day * 1440).name).toBe('Full moon')
    const next = nextFullDay(harptos, m, 0)
    expect(next).toBeGreaterThanOrEqual(0)
    expect(moonAt(harptos, m, next * 1440 + 720).name).toBe('Full moon')
  })
  it('an older campaign keeps its full-moon day as Manual Lunar Dates', () => {
    const def = campaignCalendar(undefined, -9) // "full on day 10"
    expect(def.moons[0].manual).toBe(true)
    expect(def.moons[0].cycle).toBe(29.5)
    expect(moonAt(def, def.moons[0], 9 * 1440).name).toBe('Full moon')
  })
  it('seasons follow their start dates', () => {
    expect(harptos.seasons[seasonOn(harptos, { year: 1492, month: 3, day: 14 })].name).toBe('Spring')
    expect(harptos.seasons[seasonOn(harptos, { year: 1492, month: 0, day: 5 })].name).toBe('Winter')
    expect(harptos.seasons[seasonOn(harptos, { year: 1492, month: 11, day: 25 })].name).toBe('Winter')
  })
  it('weather rolls the same for the same day and never snows in a snowless season', () => {
    expect(rolledWeather(harptos, 100)).toBe(rolledWeather(harptos, 100))
    for (let d = 140; d < 230; d++) expect(rolledWeather(harptos, d)).not.toBe('snow') // summer
  })
})

describe('events', () => {
  it('repeat weekly, monthly and yearly', () => {
    const w = occurrences(harptos, [ev({ repeat: 'weekly', start: 2 * 1440 })], 0, 40)
    expect(w.map((o) => o.startDay)).toEqual([2, 12, 22, 32])
    const m = occurrences(harptos, [ev({ repeat: 'monthly', start: 2 * 1440 })], 0, 100)
    expect(m.map((o) => formatDay(harptos, o.startDay, false))).toEqual(['3 Hammer', '3 Alturiak', '3 Ches', '3 Tarsakh'])
    const y = occurrences(harptos, [ev({ repeat: 'yearly', start: 30 * 1440 })], 0, 800)
    expect(y.map((o) => formatDay(harptos, o.startDay))).toEqual(['Midwinter 1492 DR', 'Midwinter 1493 DR', 'Midwinter 1494 DR'])
  })
  it('a past yearly event (before Day 1) shows in later years', () => {
    const y = occurrences(harptos, [ev({ repeat: 'yearly', start: -3 * 365 * 1440 })], 0, 300)
    expect(y.length).toBe(1)
  })
  it('spanning events touch every day between', () => {
    const o = occurrences(harptos, [ev({ start: 10 * 1440, end: 14 * 1440 + 60 })], 12, 12)
    expect(o[0].endDay).toBe(14)
  })
  it('removed events do not show', () => {
    expect(occurrences(harptos, [ev({ status: 'defunct' })], 0, 5)).toEqual([])
  })
})

describe('date words', () => {
  const now = 104 * 1440 + 600 // 14 Tarsakh 1492
  const words = (t: string) => findDateWords(harptos, t, now).map((w) => [w.phrase, formatDay(harptos, w.day)])
  it('reads forward dates', () => {
    expect(words('He returns in 10 days.')).toEqual([['in 10 days', '24 Tarsakh 1492 DR']])
    expect(words('The guild has three days to pay.')).toEqual([['three days to', '17 Tarsakh 1492 DR']])
    expect(words('He will name an heir on the 30th.')).toEqual([['on the 30th', '30 Tarsakh 1492 DR']])
    expect(words('Done by the end of the month.')).toEqual([['by the end of the month', '30 Tarsakh 1492 DR']])
    expect(words('They sail on 3 Mirtul.')).toEqual([['3 Mirtul', '3 Mirtul 1492 DR']])
    expect(words('A feast at Midsummer.')).toEqual([['at Midsummer', 'Midsummer 1492 DR']])
    expect(words('Come back tomorrow.')).toEqual([['tomorrow', '15 Tarsakh 1492 DR']])
    expect(words('The cult strikes at the next full moon.').length).toBe(1)
  })
  it('skips past wording', () => {
    expect(words('He has been searching for weeks.')).toEqual([])
    expect(words('Ten days ago this happened.')).toEqual([])
    expect(words('He arrived on the 30th.')).toEqual([])
    expect(words('It began 3 Ches.')).toEqual([]) // already past this year? no: next year — but -ed verb before
    expect(words('She was born on 2 Hammer.')).toEqual([])
    expect(words('Since last month he waits.')).toEqual([])
  })
})
