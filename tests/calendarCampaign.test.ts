import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { presetCalendar, type CalEvent } from '../src/shared/calendar'
import { setDateFormatter } from '../src/shared/time'

let dir: string
let c: Campaign
const ev = (p: Partial<CalEvent>): CalEvent => ({ id: 'e1', title: 'Market day', start: 3 * 1440, end: null, allDay: true, colour: '#2f6f8f', notes: 'secret notes', repeat: 'none', links: [], known: false, showNotes: false, ...p })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Calendar test'), 'Calendar test')
})
afterEach(() => {
  c.close()
  setDateFormatter(null)
  rmSync(dir, { recursive: true, force: true })
})

describe('campaign calendar (3.9)', () => {
  it('starts on Harptos, 1 Hammer 1492 DR, and labels use its dates', () => {
    expect(c.calendarView().def.preset).toBe('harptos')
    c.setClock(2 * 1440 + 60)
    expect(c.history().log[0].label).toBe('Set the clock to 3 Hammer 1492 DR · 01:00')
  })

  it('switching calendars is one undoable step and keeps events on their day', () => {
    c.saveEvent(ev({}))
    c.setCalendar(presetCalendar('gregorian')!)
    expect(c.calendarView().def.preset).toBe('gregorian')
    expect(c.calendarView().events[0].start).toBe(3 * 1440)
    c.undo()
    expect(c.calendarView().def.preset).toBe('harptos')
  })

  it('events: add, change, to History and back, each undoable', () => {
    c.saveEvent(ev({}))
    c.saveEvent(ev({ title: 'Market day (moved)' }))
    expect(c.calendarView().events.map((e) => e.title)).toEqual(['Market day (moved)'])
    c.setEventRemoved('e1', true)
    expect(c.calendarView().events).toEqual([])
    expect(c.history().removedEvents.map((e) => e.title)).toEqual(['Market day (moved)'])
    c.setEventRemoved('e1', false)
    expect(c.calendarView().events.length).toBe(1)
    c.undo(); c.undo(); c.undo()
    expect(c.calendarView().events.map((e) => e.title)).toEqual(['Market day'])
  })

  it('weather: the DM sets a day, then back to rolled', () => {
    c.setWeather(5, 'storm')
    expect(c.calendarView().weather['5']).toBe('storm')
    c.setWeather(5, null)
    expect(c.calendarView().weather['5']).toBeUndefined()
    c.undo()
    expect(c.calendarView().weather['5']).toBe('storm')
  })

  it('the players see only events the party knows, notes only when shown', () => {
    c.saveEvent(ev({ id: 'a', title: 'Known', known: true }))
    c.saveEvent(ev({ id: 'b', title: 'Hidden' }))
    c.saveEvent(ev({ id: 'd', title: 'Known with notes', known: true, showNotes: true, notes: 'Wear a flower' }))
    const dates = c.playersView().dates
    expect(dates.map((d) => d.title).sort()).toEqual(['Known', 'Known with notes'])
    expect(dates.find((d) => d.title === 'Known')!.notes).toBe('')
    expect(dates.find((d) => d.title === 'Known with notes')!.notes).toBe('Wear a flower')
  })

  it('a date word marked "not a date" is remembered per card', () => {
    c.setDateWordOff('card-1', 'In 10 days')
    expect(c.calendarView().dateWordsOff['card-1']).toEqual(['in 10 days'])
  })
})
