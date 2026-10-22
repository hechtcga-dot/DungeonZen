import { eq } from 'drizzle-orm'
import { act, actEntity, entity, secret, storyline } from '../db/schema'
import { CalEvent, campaignCalendar, formatDay, dayOfMinutes, useCalendar, WEATHER_KINDS, type CalendarDef, type WeatherDays, type WeatherKind } from '../../shared/calendar'
import type { CalendarView } from '../../shared/types'
import { part } from './part'

// Calendar (3.9): the calendar itself, events, the DM's weather changes and dismissed date words are campaign settings;
// each change is one undoable step (setSettings), removed events and moons stay stored (status defunct, History).

export const calendarPart = part({
  calendar(): CalendarDef {
    const def = campaignCalendar(this.setting('calendar'), this.setting('moon_offset_days'))
    useCalendar(def)
    return def
  },

  calendarEvents(): CalEvent[] {
    const v = this.setting('calendar_events')
    return (Array.isArray(v) ? v : []).flatMap((e) => { const ok = CalEvent.safeParse(e); return ok.success ? [ok.data] : [] })
  },

  calendarView(): CalendarView {
    const def = this.calendar()
    const weather = (this.setting('weather_days') ?? {}) as WeatherDays
    const stories = this.db.select().from(storyline).where(eq(storyline.removed, false)).all()
    const storyNo = new Map(stories.map((s, i) => [s.id, i + 1]))
    const acts = this.db.select().from(act).where(eq(act.status, 'active')).all().filter((a) => storyNo.has(a.storylineId))
    const actCards = new Map<string, string[]>()
    for (const l of this.db.select().from(actEntity).where(eq(actEntity.status, 'active')).all()) actCards.set(l.actId, [...(actCards.get(l.actId) ?? []), l.entityId])
    return {
      def,
      events: this.calendarEvents().filter((e) => e.status !== 'defunct'),
      weather,
      dateWordsOff: (this.setting('date_words_off') ?? {}) as Record<string, string[]>,
      acts: acts.map((a) => ({
        id: a.id, storylineId: a.storylineId, title: a.title, startMin: a.startMin, endMin: a.endMin,
        storyNumber: storyNo.get(a.storylineId) ?? 0, storyTitle: stories.find((s) => s.id === a.storylineId)?.title ?? '', cardIds: actCards.get(a.id) ?? []
      })),
      cards: this.db.select({ id: entity.id, name: entity.name, type: entity.type, status: entity.status }).from(entity).all()
        .filter((e) => e.status !== 'defunct' && e.status !== 'stashed').map(({ id, name, type }) => ({ id, name, type })),
      secrets: this.db.select().from(secret).where(eq(secret.status, 'active')).all().map((s) => ({ id: s.id, text: s.text })),
      storylines: stories.map((s) => ({ id: s.id, title: s.title, number: storyNo.get(s.id) ?? 0 }))
    }
  },

  setCalendar(def: CalendarDef, label = 'Changed the calendar'): void {
    this.setSetting('calendar', def, label)
    useCalendar(def)
  },

  saveEvent(e: CalEvent): void {
    const all = this.calendarEvents()
    const had = all.some((x) => x.id === e.id)
    this.setSetting('calendar_events', had ? all.map((x) => (x.id === e.id ? e : x)) : [...all, e],
      `${had ? 'Changed' : 'Added'} the event ${e.title} (${formatDay(this.calendar(), dayOfMinutes(e.start))})`)
  },

  setEventRemoved(id: string, removed: boolean): void {
    const all = this.calendarEvents()
    const e = all.find((x) => x.id === id)
    if (!e) throw new Error('No such calendar event')
    this.setSetting('calendar_events', all.map((x) => (x.id === id ? { ...x, status: removed ? 'defunct' : 'active' } : x)),
      removed ? `Moved the event ${e.title} to History` : `Restored the event ${e.title}`)
  },

  setWeather(day: number, kind: WeatherKind | null): void {
    const all = { ...((this.setting('weather_days') ?? {}) as WeatherDays) }
    if (kind && WEATHER_KINDS.includes(kind)) all[String(day)] = kind
    else delete all[String(day)]
    const when = formatDay(this.calendar(), day)
    this.setSetting('weather_days', all, kind ? `Set the weather on ${when}` : `Weather on ${when} back to rolled`)
  },

  setDateWordOff(entityId: string, phrase: string): void {
    const all = { ...((this.setting('date_words_off') ?? {}) as Record<string, string[]>) }
    const key = phrase.trim().toLowerCase()
    all[entityId] = [...new Set([...(all[entityId] ?? []), key])]
    this.setSetting('date_words_off', all, `“${phrase.trim()}” is not a date`)
  },

  removedCalendar(): { events: Array<{ id: string; title: string; when: string }>; moons: Array<{ index: number; name: string }> } {
    const def = this.calendar()
    return {
      events: this.calendarEvents().filter((e) => e.status === 'defunct').map((e) => ({ id: e.id, title: e.title, when: formatDay(def, dayOfMinutes(e.start)) })),
      moons: def.moons.flatMap((m, index) => (m.status === 'defunct' ? [{ index, name: m.name }] : []))
    }
  },

  setMoonRemoved(index: number, removed: boolean): void {
    const def = this.calendar()
    const m = def.moons[index]
    if (!m) throw new Error('No such moon')
    this.setCalendar({ ...def, moons: def.moons.map((x, i) => (i === index ? { ...x, status: removed ? 'defunct' : 'active' } : x)) },
      removed ? `Moved the moon ${m.name} to History` : `Restored the moon ${m.name}`)
  }
})
