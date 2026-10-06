// The advisor on the live desk: plain, local rules (no AI) that warn the DM.

import { MINUTES_PER_DAY } from '../shared/time'
import { SUNSET_MIN } from '../shared/sky'
import type { AdvisorNote } from '../shared/types'

export interface AdvisorInput {
  nowMin: number
  fightsToday: number
  healthPercent: number | null
  lastLongRestMin: number | null
  sessionStartMin: number | null
  /** Acts on player storylines: title and end, plus whether the DM must choose an outcome. */
  acts: Array<{ title: string; endMin: number; awaiting: boolean }>
}

export function advise(i: AdvisorInput): AdvisorNote[] {
  const notes: AdvisorNote[] = []
  const minOfDay = ((i.nowMin % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  const hp = i.healthPercent

  if (hp !== null && i.fightsToday >= 3 && hp < 70) {
    notes.push({ level: 'warn', text: `The party has had ${i.fightsToday} fights today and is at ${hp}% health. They may not survive another without a rest.` })
  } else if (hp !== null && hp < 40) {
    notes.push({ level: 'warn', text: `The party is badly hurt (${hp}% health).` })
  }
  const toNight = SUNSET_MIN - minOfDay
  if (toNight > 0 && toNight <= 4 * 60) {
    const h = Math.round(toNight / 60)
    notes.push({ level: 'info', text: h <= 0 ? 'Night falls within the hour.' : `Night falls in about ${h} h.` })
  }
  const restFrom = i.lastLongRestMin ?? i.sessionStartMin
  if (restFrom !== null && i.nowMin - restFrom >= 24 * 60) {
    notes.push({ level: 'info', text: `No long rest for ${Math.floor((i.nowMin - restFrom) / 60)} hours.` })
  }
  for (const a of i.acts) {
    if (a.awaiting) notes.push({ level: 'warn', text: `${a.title} has ended and needs your outcome.` })
    else if (a.endMin > i.nowMin && a.endMin - i.nowMin <= 6 * 60) {
      notes.push({ level: 'info', text: `${a.title} ends in about ${Math.max(1, Math.round((a.endMin - i.nowMin) / 60))} h.` })
    }
  }
  return notes
}
