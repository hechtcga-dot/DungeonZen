import { z } from 'zod'

// Run encounter (combat tracker). No dice, no initiative: the DM orders the list (owner,
// 2026-10-06). The whole fight is one JSON state in the `combat` table, so every change is
// one undo step. Morale and tactics hints come from local rules here (pure, tested).

export const CONDITIONS = [
  'Blinded', 'Charmed', 'Deafened', 'Exhaustion', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible',
  'Paralyzed', 'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious', 'Concentrating', 'Bloodied'
]

export const Condition = z.object({ name: z.string().min(1).max(60), rounds: z.number().int().min(1).max(1000).nullable() })
export type Condition = z.infer<typeof Condition>

export const Combatant = z.object({
  id: z.string().max(80),
  entityId: z.string().max(80).nullable(),
  name: z.string().min(1).max(200),
  side: z.enum(['party', 'foe', 'ally']),
  hp: z.number().int().min(0).max(100000),
  maxHp: z.number().int().min(0).max(100000),
  tempHp: z.number().int().min(0).max(100000),
  ac: z.string().max(20),
  conditions: z.array(Condition).max(30),
  notes: z.string().max(2000),
  out: z.enum(['down', 'fled', 'surrendered']).nullable()
})
export type Combatant = z.infer<typeof Combatant>

export const CombatState = z.object({
  round: z.number().int().min(1).max(10000),
  turn: z.number().int().min(0).max(1000),
  combatants: z.array(Combatant).max(200),
  log: z.array(z.string().max(500)).max(1000)
})
export type CombatState = z.infer<typeof CombatState>

/** What the tracker knows about each creature's card, for the hints. */
export interface CombatantInfo {
  creatureType: string
  /** Leads the others (captain, chief, boss…, or "leader" in its text). */
  leader: boolean
  /** Traits or actions that help allies, with the text to remember. */
  boosts: Array<{ name: string; text: string }>
  legendary: boolean
  recharge: string[]
}

export interface CombatHint { level: 'warn' | 'info'; text: string }

const LEADER = /\b(captain|commander|chief|chieftain|boss|leader|warlord|lieutenant|sergeant|king|queen|lord)\b/i
const FEARLESS = /\b(undead|construct|ooze|plant)\b/i
const GUARD = /\bguard/i

export function isLeaderName(name: string): boolean { return LEADER.test(name) }

/** Text of a trait or action that helps allies (e.g. a Guard Captain's or a war chief's). */
export function boostsAllies(text: string): boolean {
  return /\b(allies|ally|each friendly|friendly creature|its companions)\b/i.test(text) && /\b(advantage|bonus|\+\d|extra|add|temporary hit points|reaction|attack)\b/i.test(text)
}

/** Base name without the number added for copies: "Bandit 3" → "Bandit". */
export const baseName = (name: string) => name.replace(/\s+\d+$/, '')

/** Moves to the next creature still in the fight; past the last one a new round starts and conditions count down. */
export function nextTurn(s: CombatState): CombatState {
  const n = s.combatants.length
  if (!n) return s
  let turn = s.turn
  let round = s.round
  const log = [...s.log]
  let combatants = s.combatants
  for (let i = 0; i < n; i++) {
    turn++
    if (turn >= n) {
      turn = 0
      round++
      // Durations count down once a round, at its end.
      combatants = combatants.map((c) => {
        const kept: Condition[] = []
        for (const k of c.conditions) {
          if (k.rounds == null) kept.push(k)
          else if (k.rounds > 1) kept.push({ ...k, rounds: k.rounds - 1 })
          else log.push(`Round ${round}: ${c.name} is no longer ${k.name.toLowerCase()}.`)
        }
        return { ...c, conditions: kept }
      })
      log.push(`Round ${round} begins.`)
    }
    if (!combatants[turn].out) break
  }
  return { ...s, round, turn, combatants, log }
}

export function previousTurn(s: CombatState): CombatState {
  if (!s.combatants.length) return s
  if (s.turn > 0) return { ...s, turn: s.turn - 1 }
  return s.round > 1 ? { ...s, round: s.round - 1, turn: s.combatants.length - 1 } : s
}

/** Damage (temporary hit points first) or healing. Concentration and dropping to 0 are logged. */
export function changeHp(s: CombatState, id: string, amount: number): CombatState {
  const log = [...s.log]
  const combatants = s.combatants.map((c) => {
    if (c.id !== id) return c
    if (amount >= 0) {
      const hp = c.maxHp ? Math.min(c.maxHp, c.hp + amount) : c.hp + amount
      log.push(`Round ${s.round}: ${c.name} heals ${amount} (${hp} HP).`)
      return { ...c, hp, out: c.out === 'down' && hp > 0 ? null : c.out }
    }
    const dmg = -amount
    const fromTemp = Math.min(c.tempHp, dmg)
    const hp = Math.max(0, c.hp - (dmg - fromTemp))
    log.push(`Round ${s.round}: ${c.name} takes ${dmg} damage (${hp} HP${c.tempHp - fromTemp ? `, ${c.tempHp - fromTemp} temporary` : ''}).`)
    if (c.conditions.some((k) => k.name === 'Concentrating') && hp > 0) {
      log.push(`Round ${s.round}: ${c.name} makes a Constitution save, DC ${Math.min(30, Math.max(10, Math.floor(dmg / 2)))}, to keep concentrating.`)
    }
    if (hp === 0 && c.hp > 0) log.push(`Round ${s.round}: ${c.name} drops to 0 hit points.`)
    return { ...c, hp, tempHp: c.tempHp - fromTemp, out: hp === 0 && c.side !== 'party' ? 'down' as const : c.out }
  })
  return { ...s, combatants, log }
}

/**
 * Morale and tactics hints from the state (local rules): a side that lost half its numbers
 * may flee, guards hold while their commander stands, a fallen leader breaks the rest, badly
 * hurt creatures look for a way out (not the fearless kinds), and helpers' boosts are reminders.
 */
export function combatHints(s: CombatState, info: Record<string, CombatantInfo | undefined>): CombatHint[] {
  const hints: CombatHint[] = []
  const foes = s.combatants.filter((c) => c.side === 'foe')
  if (!foes.length) return hints
  const standing = (c: Combatant) => !c.out
  const inf = (c: Combatant) => (c.entityId ? info[c.entityId] : undefined)
  const leaders = foes.filter((c) => inf(c)?.leader ?? isLeaderName(c.name))
  const leaderUp = leaders.filter(standing)
  const fearless = (c: Combatant) => FEARLESS.test(inf(c)?.creatureType ?? '')

  // Group by kind: "Bandit 1…4" are one group.
  const groups = new Map<string, Combatant[]>()
  for (const c of foes) groups.set(baseName(c.name), [...(groups.get(baseName(c.name)) ?? []), c])
  for (const [name, list] of groups) {
    const out = list.filter((c) => c.out).length
    const left = list.length - out
    if (list.length < 2 || left === 0 || out * 2 < list.length) continue
    if (list.every(fearless)) { hints.push({ level: 'info', text: `${name}: half are down, but they know no fear and fight on.` }); continue }
    if (GUARD.test(name) && leaderUp.length) {
      hints.push({ level: 'info', text: `${name}: half are down, but guards hold their ground while ${leaderUp.map((l) => l.name).join(' and ')} still stands.` })
      continue
    }
    if (leaderUp.length && !leaders.some((l) => baseName(l.name) === name)) {
      hints.push({ level: 'info', text: `${name}: half are down. They hold while ${leaderUp[0].name} keeps them in line; one more loss and they may break.` })
      continue
    }
    hints.push({ level: 'warn', text: `${name}: half are down (${out} of ${list.length}). The other ${left} may flee or surrender.` })
  }
  for (const l of leaders.filter((c) => c.out)) {
    const rest = foes.filter((c) => standing(c) && !fearless(c) && c.id !== l.id)
    if (rest.length) hints.push({ level: 'warn', text: `${l.name} is ${l.out}: ${rest.length} follower${rest.length === 1 ? '' : 's'} may lose heart and flee or surrender.` })
  }
  for (const c of foes.filter((x) => standing(x) && x.maxHp > 0 && x.hp > 0 && x.hp <= x.maxHp / 4 && !fearless(x))) {
    hints.push({ level: 'info', text: `${c.name} is badly hurt (${c.hp} of ${c.maxHp} HP): it may try to escape, beg or bargain.` })
  }
  const standingFoes = foes.filter(standing)
  if (standingFoes.length === 1 && foes.length > 1 && !fearless(standingFoes[0])) {
    hints.push({ level: 'warn', text: `${standingFoes[0].name} is the last one standing: a good moment to surrender or run.` })
  }
  const seen = new Set<string>()
  for (const c of standingFoes) {
    const i = inf(c)
    if (!i) continue
    const key = baseName(c.name)
    if (seen.has(key)) continue
    seen.add(key)
    for (const b of i.boosts) hints.push({ level: 'info', text: `${c.name}: ${b.name}. ${b.text}` })
    if (i.leader && !i.boosts.length && standingFoes.some((f) => baseName(f.name) !== key)) {
      hints.push({ level: 'info', text: `${c.name} commands the others: they hold while it stands. Its stat block has no boost for allies; add a trait such as Leadership on its sheet and it shows here.` })
    }
    if (i.legendary) hints.push({ level: 'info', text: `${c.name} has legendary actions: use them at the end of other creatures' turns.` })
    if (i.recharge.length) hints.push({ level: 'info', text: `${c.name}: at the start of its turn, roll to recharge ${i.recharge.join(', ')}.` })
  }
  const party = s.combatants.filter((c) => c.side === 'party')
  // Only when their hit points are tracked here (PC hit points are typed in by hand).
  if (party.some((c) => c.maxHp > 0 || c.out) && party.every((c) => c.out || (c.maxHp > 0 && c.hp === 0))) hints.unshift({ level: 'warn', text: 'The whole party is down: death saves, capture or a rescue?' })
  if (!standingFoes.length) hints.unshift({ level: 'info', text: 'No foes left standing: the fight is won. End combat to log it.' })
  return hints
}
