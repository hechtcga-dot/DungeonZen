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

const Count = z.number().int().min(0).max(1000)

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
  notes: z.string().max(20000),
  out: z.enum(['down', 'fled', 'surrendered']).nullable(),
  // 1.4.0 (older fights read these as empty):
  /** Per round: damage taken, healing, reaction used, concentrating. */
  rounds: z.record(z.string(), z.object({ dmg: Count, heal: Count, r: z.boolean(), c: z.boolean() })).default({}),
  legendaryUsed: Count.default(0),
  /** Uses spent of limited abilities, by key (recharge: 1 = used). */
  used: z.record(z.string(), Count).default({}),
  /** Mirror Image duplicates left (null: none). */
  mirror: z.number().int().min(0).max(3).nullable().default(null),
  /** Displacement: on, or off until the start of its next turn (null: it has none). */
  displacement: z.enum(['on', 'off']).nullable().default(null),
  /** Death saving throws (party members at 0 hit points). */
  death: z.object({ s: z.number().int().min(0).max(3), f: z.number().int().min(0).max(3) }).default({ s: 0, f: 0 }),
  stable: z.boolean().default(false),
  /** Sizes smaller than its stat block (after splitting). */
  shrink: z.number().int().min(0).max(5).default(0)
})
export type Combatant = z.infer<typeof Combatant>

export const ABILITIES6 = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const
export const EFFECT_TRIGGERS = { start: 'at the start of its turn', end: 'at the end of its turn', enter: 'when it enters or starts its turn there', move: 'for each 5 ft it moves there', always: 'while there' } as const

/** A terrain or spell effect on the battlefield (everyone) or on the creatures in it. */
export const Effect = z.object({
  id: z.string().max(80),
  name: z.string().min(1).max(100),
  /** Everyone in the fight, or only the listed combatants. */
  scope: z.enum(['all', 'some']),
  ids: z.array(z.string().max(80)).max(200),
  save: z.enum(ABILITIES6).nullable(),
  dc: z.number().int().min(1).max(40).nullable(),
  damage: z.string().max(100),
  onSave: z.string().max(100),
  trigger: z.enum(['start', 'end', 'enter', 'move', 'always']),
  rounds: z.number().int().min(1).max(1000).nullable(),
  source: z.string().max(100),
  note: z.string().max(500)
})
export type Effect = z.infer<typeof Effect>

export const CombatState = z.object({
  round: z.number().int().min(1).max(10000),
  turn: z.number().int().min(0).max(1000),
  combatants: z.array(Combatant).max(200),
  log: z.array(z.string().max(500)).max(1000),
  effects: z.array(Effect).max(100).default([])
})
export type CombatState = z.infer<typeof CombatState>

/** A limited ability read from the stat block: recharge, uses per day, legendary resistance. */
export interface Limited { key: string; name: string; kind: 'recharge' | 'perDay' | 'legendaryResist'; max: number; recharge: string }

/** What the tracker knows about each creature's card, for the hints, the rows and the tactics. */
export interface CombatantInfo {
  creatureType: string
  /** Leads the others (captain, chief, boss…, or "leader" in its text). */
  leader: boolean
  /** Traits or actions that help allies, with the text to remember. */
  boosts: Array<{ name: string; text: string }>
  legendary: boolean
  recharge: string[]
  // 1.4.0
  /** Challenge rating (creatures) and level (player characters; null when not set). */
  cr: string
  level: number | null
  xp: number
  pp: number | null
  /** Spell save DC, when its text gives one. */
  saveDc: number | null
  dexMod: number
  resist: string
  immune: string
  vuln: string
  limited: Limited[]
  /** Legendary actions per round (0: none). */
  legendaryActions: number
  lair: boolean
  /** Split: the damage types that make it split (from its trait or reaction), or null. */
  split: string[] | null
  splitOnBloodied: boolean
  mirrorImage: boolean
  displacement: boolean
  actions: Array<{ name: string; kind: string; text: string; /** The whole description (text is cut to fit the panel). */ full?: string }>
  /** Spell slots per level 1–9: the most, and how many are used (kept on the card). */
  slots: number[]
  slotsUsed: number[]
  /** The card's type (NPC, MONSTER, PC…). */
  cardType: string
  size: string
  /** Player characters: what the full sheet tracks between fights (Heroic Inspiration, exhaustion, limited uses, hit dice). */
  pc: { inspiration: boolean; exhaustion: number; uses: Array<{ name: string; max: number; used: number; reset: 'short' | 'long' }>; hitDice: { total: number; dice: string; used: number } } | null
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
export const baseName = (name: string) => name.replace(/\s+(\d+|[A-Z])$/, '')

export const DAMAGE_TYPES = ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'] as const

/** Limited abilities in a stat block's traits and actions: "(Recharge 5–6)", "(3/Day)", "(3/Day each)", "Legendary Resistance (3/Day)". */
export function limitedUses(texts: Array<{ name: string; text: string }>): Limited[] {
  const out: Limited[] = []
  for (const t of texts) {
    const rech = /\(recharge\s*(\d)(?:\s*[–-]\s*(\d))?\)/i.exec(t.name) ?? /\(recharge\s*(\d)(?:\s*[–-]\s*(\d))?\)/i.exec(t.text.slice(0, 80))
    const day = /\((\d+)\s*\/\s*day/i.exec(t.name)
    const clean = t.name.replace(/\s*\(.*?\)\s*/g, ' ').trim()
    // Breath weapons recharge on 5–6 (2024 rules) even where the copied stat block lost the mark.
    if (!rech && !day && /\bbreath\b/i.test(t.name) && /saving throw/i.test(t.text)) { out.push({ key: `re:${clean}`, name: clean, kind: 'recharge', max: 1, recharge: '5–6' }); continue }
    if (/legendary resistance/i.test(t.name)) out.push({ key: `lr:${clean}`, name: clean, kind: 'legendaryResist', max: day ? Number(day[1]) : 3, recharge: '' })
    else if (rech) out.push({ key: `re:${clean}`, name: clean, kind: 'recharge', max: 1, recharge: rech[2] ? `${rech[1]}–${rech[2]}` : rech[1] })
    else if (day) out.push({ key: `day:${clean}`, name: clean, kind: 'perDay', max: Number(day[1]), recharge: '' })
    // Spells cast "3/Day each: …" inside a Spellcasting text.
    for (const m of t.text.matchAll(/(\d+)\s*\/\s*day(?:\s+each)?\s*:\**\s*([^\n.]+)/gi)) {
      for (const spell of m[2].split(',').map((x) => x.replace(/\(.*?\)|\*/g, '').trim()).filter(Boolean).slice(0, 12)) {
        out.push({ key: `day:${spell}`, name: spell, kind: 'perDay', max: Number(m[1]), recharge: '' })
      }
    }
  }
  return out.filter((x, i) => out.findIndex((y) => y.key === x.key) === i)
}

/** Spell slots from a Spellcasting text ("1st level (4 slots)"), levels 1–9. */
export function slotsFromText(text: string): number[] {
  const slots = Array<number>(9).fill(0)
  for (const m of text.matchAll(/(\d)(?:st|nd|rd|th)[ -]level\s*\((\d+)\s*slots?\)/gi)) slots[Number(m[1]) - 1] = Number(m[2])
  return slots
}

/** Legendary actions per round from the text ("Legendary Action Uses: 3", "can take 3 legendary actions"). */
export function legendaryCount(texts: string[], hasLegendaryActions: boolean): number {
  for (const t of texts) {
    const m = /legendary action uses:?\s*(\d+)/i.exec(t) ?? /can take (\d+|three|two) legendary actions/i.exec(t)
    if (m) return ({ three: 3, two: 2 } as Record<string, number>)[m[1].toLowerCase()] ?? Number(m[1])
  }
  return hasLegendaryActions ? 3 : 0
}

/** Resistance, immunity or vulnerability to a damage type: the amount it takes. */
export function adjustDamage(amount: number, type: string, info: Pick<CombatantInfo, 'resist' | 'immune' | 'vuln'> | undefined): { amount: number; why: string } {
  if (!type || !info) return { amount, why: '' }
  const has = (list: string) => new RegExp(`\\b${type}\\b`, 'i').test(list)
  if (has(info.immune)) return { amount: 0, why: `immune to ${type}` }
  if (has(info.resist)) return { amount: Math.floor(amount / 2), why: `resists ${type}` }
  if (has(info.vuln)) return { amount: amount * 2, why: `vulnerable to ${type}` }
  return { amount, why: '' }
}

const roundKey = (s: { round: number }) => String(s.round)
const roundRec = (c: Combatant, s: CombatState) => c.rounds[roundKey(s)] ?? { dmg: 0, heal: 0, r: false, c: false }

/** Moves to the next creature still in the fight; past the last one a new round starts and conditions and effects count down. */
export function nextTurn(s: CombatState): CombatState {
  const n = s.combatants.length
  if (!n) return s
  let turn = s.turn
  let round = s.round
  const log = [...s.log]
  let combatants = s.combatants
  let effects = s.effects
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
      effects = effects.flatMap((e) => {
        if (e.rounds == null) return [e]
        if (e.rounds > 1) return [{ ...e, rounds: e.rounds - 1 }]
        log.push(`Round ${round}: ${e.name} ends.`)
        return []
      })
      log.push(`Round ${round} begins.`)
    }
    if (!combatants[turn].out) break
  }
  // At the start of its turn: legendary actions come back, Displacement returns.
  combatants = combatants.map((c, i) => (i !== turn ? c : {
    ...c, legendaryUsed: 0, displacement: c.displacement === 'off' && !c.conditions.some((k) => /incapacitated|paralyzed|stunned|unconscious|petrified/i.test(k.name)) ? 'on' : c.displacement
  }))
  return { ...s, round, turn, combatants, log, effects }
}

export function previousTurn(s: CombatState): CombatState {
  if (!s.combatants.length) return s
  if (s.turn > 0) return { ...s, turn: s.turn - 1 }
  return s.round > 1 ? { ...s, round: s.round - 1, turn: s.combatants.length - 1 } : s
}

/**
 * Damage (temporary hit points first; resistance, immunity or vulnerability to its type) or healing.
 * Concentration, Displacement, death saves at 0 HP and a creature that splits are handled and logged.
 */
export function changeHp(s: CombatState, id: string, amount: number, type = '', info?: Record<string, CombatantInfo | undefined>): CombatState {
  const log = [...s.log]
  let split: Combatant | null = null
  const combatants = s.combatants.map((c) => {
    if (c.id !== id) return c
    const rec = roundRec(c, s)
    if (amount >= 0) {
      const hp = c.maxHp ? Math.min(c.maxHp, c.hp + amount) : c.hp + amount
      log.push(`Round ${s.round}: ${c.name} heals ${amount} (${hp} HP).`)
      return {
        ...c, hp, out: c.out === 'down' && hp > 0 ? null : c.out, death: hp > 0 ? { s: 0, f: 0 } : c.death, stable: hp > 0 ? false : c.stable,
        rounds: { ...c.rounds, [roundKey(s)]: { ...rec, heal: rec.heal + amount } }
      }
    }
    const i = c.entityId ? info?.[c.entityId] : undefined
    const adj = adjustDamage(-amount, type, i)
    const dmg = adj.amount
    const fromTemp = Math.min(c.tempHp, dmg)
    const hp = Math.max(0, c.hp - (dmg - fromTemp))
    log.push(`Round ${s.round}: ${c.name} takes ${dmg}${type ? ` ${type}` : ''} damage${adj.why ? ` (${adj.why}: ${-amount} → ${dmg})` : ''} (${hp} HP${c.tempHp - fromTemp ? `, ${c.tempHp - fromTemp} temporary` : ''}).`)
    if (dmg > 0 && (c.conditions.some((k) => k.name === 'Concentrating') || rec.c) && hp > 0) {
      log.push(`Round ${s.round}: ${c.name} makes a Constitution save, DC ${Math.min(30, Math.max(10, Math.floor(dmg / 2)))}, to keep concentrating.`)
    }
    if (hp === 0 && c.hp > 0) log.push(`Round ${s.round}: ${c.name} drops to 0 hit points.`)
    let death = c.death
    if (c.side === 'party' && c.hp === 0 && dmg > 0 && !c.out) {
      death = { ...death, f: Math.min(3, death.f + 1) }
      log.push(`Round ${s.round}: ${c.name} takes damage at 0 HP: a failed death save (${death.f} of 3).`)
    }
    let displacement = c.displacement
    if (dmg > 0 && displacement === 'on') { displacement = 'off'; log.push(`Round ${s.round}: ${c.name}'s Displacement fails until the start of its next turn.`) }
    const next: Combatant = {
      ...c, hp, tempHp: c.tempHp - fromTemp, out: hp === 0 && c.side !== 'party' ? 'down' as const : death.f >= 3 ? 'down' : c.out, death, displacement,
      rounds: { ...c.rounds, [roundKey(s)]: { ...rec, dmg: rec.dmg + dmg } }
    }
    // Split: on its damage types, or (2024 Black Pudding) on becoming bloodied, with 10+ HP left.
    const nowBloodied = c.maxHp > 0 && c.hp > c.maxHp / 2 && hp <= c.maxHp / 2
    if (i?.split && hp >= 10 && ((type && i.split.includes(type)) || (nowBloodied && i.splitOnBloodied))) split = next
    return next
  })
  const after = { ...s, combatants, log }
  const who = split as Combatant | null
  return who ? splitCombatant(after, who.id, who.entityId ? info?.[who.entityId]?.size : undefined) : after
}

const SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']

/**
 * Split (Black Pudding and the like): with at least 10 hit points it becomes two creatures, each with
 * half its hit points rounded down (one size smaller); with fewer it does not split.
 */
export function splitCombatant(s: CombatState, id: string, size?: string): CombatState {
  const i = s.combatants.findIndex((c) => c.id === id)
  const c = s.combatants[i]
  if (!c) return s
  if (c.hp < 10) return { ...s, log: [...s.log, `Round ${s.round}: ${c.name} has fewer than 10 hit points and does not split.`] }
  const base = SIZES.indexOf((size ?? '').trim().toLowerCase())
  if (base >= 0 && base - c.shrink < 2) return { ...s, log: [...s.log, `Round ${s.round}: ${c.name} is too small to split (it must be Medium or larger).`] }
  const half = Math.floor(c.hp / 2)
  const stem = baseName(c.name)
  const taken = new Set(s.combatants.map((x) => x.name))
  const names: string[] = []
  for (let k = 0; names.length < 2 && k < 26; k++) {
    const n = `${stem} ${String.fromCharCode(65 + k)}`
    if (!taken.has(n) || (names.length === 0 && n === c.name)) names.push(n)
  }
  const smaller = base >= 0 ? SIZES[base - c.shrink - 1] : 'one size smaller'
  const a: Combatant = { ...c, name: names[0], hp: half, maxHp: half, shrink: c.shrink + 1, notes: `${c.notes}${c.notes ? ' ' : ''}(${smaller} after splitting)`.trim() }
  const b: Combatant = { ...a, id: `${c.id}-split-${s.round}-${Math.round(c.hp)}`, name: names[1], conditions: [], legendaryUsed: 0, rounds: {} }
  const combatants = [...s.combatants]
  combatants.splice(i, 1, a, b)
  return {
    ...s, combatants, turn: i < s.turn ? s.turn + 1 : s.turn,
    log: [...s.log, `Round ${s.round}: ${c.name} splits into ${a.name} and ${b.name}, ${half} HP each, ${smaller}.`]
  }
}

/** Death saving throw for a party member at 0 hit points: three successes = stable, three failures = dead. */
export function deathSave(s: CombatState, id: string, kind: 's' | 'f', on: boolean): CombatState {
  const log = [...s.log]
  const combatants = s.combatants.map((c) => {
    if (c.id !== id) return c
    const death = { ...c.death, [kind]: Math.max(0, Math.min(3, c.death[kind] + (on ? 1 : -1))) }
    const stable = death.s >= 3
    if (stable && !c.stable) log.push(`Round ${s.round}: ${c.name} is stable.`)
    if (death.f >= 3 && c.death.f < 3) log.push(`Round ${s.round}: ${c.name} has failed three death saves.`)
    return { ...c, death, stable, out: death.f >= 3 ? 'down' as const : c.out }
  })
  return { ...s, combatants, log }
}

/** Effects on a combatant: battlefield-wide ones and those it was put in. */
export const effectsOn = (s: CombatState, id: string) => s.effects.filter((e) => e.scope === 'all' || e.ids.includes(id))

/** One line for an effect: what to roll and what happens. */
export function effectLine(e: Effect): string {
  const save = e.save ? `${e.save} save${e.dc ? ` DC ${e.dc}` : ''}` : ''
  const parts = [save && `${save}${e.damage ? `: ${e.damage}` : ''}${e.onSave ? ` (${e.onSave} on a success)` : ''}`, !save && e.damage]
  return `${e.name}: ${parts.filter(Boolean).join('') || e.note || 'in effect'}${e.trigger !== 'always' ? `, ${EFFECT_TRIGGERS[e.trigger]}` : ''}${e.save && e.note ? `. ${e.note}` : ''}`
}

/** Ready-made terrain and spell effects (2024 rules; the DM changes anything). Spell DCs are the caster's. */
export const EFFECT_PRESETS: Array<Omit<Effect, 'id' | 'ids' | 'source'>> = [
  { name: 'Spike Growth', scope: 'some', save: null, dc: null, damage: '2d4 piercing', onSave: '', trigger: 'move', rounds: 100, note: 'Difficult terrain; no saving throw. Hidden: Wisdom (Perception) against the spell save DC to notice it.' },
  { name: 'Web', scope: 'some', save: 'DEX', dc: null, damage: '', onSave: '', trigger: 'enter', rounds: 600, note: 'Restrained on a failure; difficult terrain, lightly obscured. Burns: 2d4 fire.' },
  { name: 'Entangle', scope: 'some', save: 'STR', dc: null, damage: '', onSave: '', trigger: 'start', rounds: 10, note: 'Restrained on a failure; difficult terrain. Escape: Strength (Athletics) against the DC.' },
  { name: 'Grease', scope: 'some', save: 'DEX', dc: null, damage: '', onSave: '', trigger: 'enter', rounds: 10, note: 'Prone on a failure; difficult terrain.' },
  { name: 'Fog Cloud', scope: 'some', save: null, dc: null, damage: '', onSave: '', trigger: 'always', rounds: 600, note: 'Heavily obscured: creatures inside are effectively blinded.' },
  { name: 'Darkness', scope: 'some', save: null, dc: null, damage: '', onSave: '', trigger: 'always', rounds: 100, note: 'Magical darkness: darkvision cannot see through it.' },
  { name: 'Moonbeam', scope: 'some', save: 'CON', dc: null, damage: '2d10 radiant', onSave: 'half', trigger: 'enter', rounds: 10, note: 'Shapechangers have disadvantage and revert to true form on a failure.' },
  { name: 'Spirit Guardians', scope: 'some', save: 'WIS', dc: null, damage: '3d8 radiant or necrotic', onSave: 'half', trigger: 'enter', rounds: 100, note: 'Speed halved in the aura.' },
  { name: 'Cloud of Daggers', scope: 'some', save: null, dc: null, damage: '4d4 slashing', onSave: '', trigger: 'enter', rounds: 10, note: 'When it enters or ends its turn there.' },
  { name: 'Wall of Fire', scope: 'some', save: 'DEX', dc: null, damage: '5d8 fire', onSave: 'half', trigger: 'enter', rounds: 100, note: 'Also when it ends its turn within 10 ft of the hot side.' },
  { name: 'Silence', scope: 'some', save: null, dc: null, damage: '', onSave: '', trigger: 'always', rounds: 100, note: 'No sound: no spells with a Verbal component; deafened inside; immune to thunder damage.' },
  { name: 'Strong wind', scope: 'all', save: 'STR', dc: 12, damage: '', onSave: '', trigger: 'start', rounds: null, note: 'Pushed 10 ft or knocked prone on a failure (DM). Ranged attacks have disadvantage; flying needs a landing at the end of a turn.' },
  { name: 'Difficult terrain', scope: 'some', save: null, dc: null, damage: '', onSave: '', trigger: 'always', rounds: null, note: 'Each foot costs an extra foot of movement.' },
  { name: 'Ice', scope: 'some', save: 'DEX', dc: 10, damage: '', onSave: '', trigger: 'enter', rounds: null, note: 'Prone on a failure; difficult terrain.' },
  { name: 'Deep water', scope: 'some', save: null, dc: null, damage: '', onSave: '', trigger: 'always', rounds: null, note: 'Swimming: half speed without a swim speed; melee weapon attacks without a swim speed have disadvantage (not daggers, javelins, shortswords, spears, tridents).' },
  { name: 'Lava', scope: 'some', save: null, dc: null, damage: '10d10 fire', onSave: '', trigger: 'enter', rounds: null, note: 'When it enters or starts its turn in it (DM: 6d10 for a brief touch).' }
]

/** The challenge rating whose XP is closest to (not above) this much XP: the encounter's or the party's match. */
export function crForXp(xp: number): string {
  const table: Array<[string, number]> = [['0', 10], ['1/8', 25], ['1/4', 50], ['1/2', 100], ['1', 200], ['2', 450], ['3', 700], ['4', 1100], ['5', 1800], ['6', 2300], ['7', 2900], ['8', 3900],
    ['9', 5000], ['10', 5900], ['11', 7200], ['12', 8400], ['13', 10000], ['14', 11500], ['15', 13000], ['16', 15000], ['17', 18000], ['18', 20000], ['19', 22000], ['20', 25000],
    ['21', 33000], ['22', 41000], ['23', 50000], ['24', 62000], ['25', 75000], ['26', 90000], ['27', 105000], ['28', 120000], ['29', 135000], ['30', 155000]]
  let best = '0'
  for (const [cr, x] of table) if (x <= xp) best = cr
  return best
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

/** A new combatant with the 1.4.0 fields at their starting values. */
export function newCombatant(c: Pick<Combatant, 'id' | 'entityId' | 'name' | 'side' | 'hp' | 'maxHp' | 'ac'> & Partial<Combatant>): Combatant {
  return Combatant.parse({ tempHp: 0, conditions: [], notes: '', out: null, ...c })
}

/**
 * Tips for one combatant's turn (local rules): effects to roll for, what is ready or spent, who to
 * target (foes) or what is left (player characters). The DM's tactics panel shows them for the selected row.
 */
export function turnTips(s: CombatState, c: Combatant, i: CombatantInfo | undefined): string[] {
  const tips: string[] = []
  if (c.out) return [`${c.name} is ${c.out}.`]
  for (const e of effectsOn(s, c.id)) tips.push(effectLine(e))
  if (c.side === 'party' && c.hp === 0 && c.maxHp > 0) tips.push(c.stable ? 'Stable at 0 HP: no death saves.' : `At 0 HP: roll a death save (${c.death.s} success, ${c.death.f} failed).`)
  const rec = c.rounds[String(s.round)]
  if (rec?.r) tips.push('Reaction already used this round.')
  if (rec?.c || c.conditions.some((k) => k.name === 'Concentrating')) tips.push('Concentrating: taking damage means a Constitution save (DC 10 or half the damage).')
  if (c.mirror) tips.push(`Mirror Image: ${c.mirror} duplicate${c.mirror === 1 ? '' : 's'} left (attackers roll to hit a duplicate; AC ${10 + (i?.dexMod ?? 0)}).`)
  if (c.displacement === 'on') tips.push('Displacement: attacks against it have disadvantage.')
  if (!i) return tips
  for (const l of i.limited) {
    const used = c.used[l.key] ?? 0
    if (l.kind === 'recharge') tips.push(used ? `${l.name} is spent: roll a d6 at the start of its turn, recharges on ${l.recharge}.` : `${l.name} is ready.`)
    else if (used >= l.max) tips.push(`${l.name}: none left today.`)
  }
  if (i.legendaryActions) tips.push(`Legendary actions: ${i.legendaryActions - c.legendaryUsed} of ${i.legendaryActions} left, at the end of other creatures' turns.`)
  if (i.lair) tips.push('Lair action on initiative 20 (losing ties).')
  const left = i.slots.map((m, k) => (m ? `${k + 1}: ${Math.max(0, m - (i.slotsUsed[k] ?? 0))}/${m}` : '')).filter(Boolean)
  if (left.length) tips.push(`Spell slots left (level: left/most): ${left.join(', ')}.`)
  if (c.side !== 'party') {
    const party = s.combatants.filter((x) => x.side === 'party' && !x.out && x.hp > 0)
    const bloodied = party.filter((x) => x.maxHp && x.hp <= x.maxHp / 2)
    const conc = party.filter((x) => x.conditions.some((k) => k.name === 'Concentrating') || x.rounds[String(s.round)]?.c)
    if (conc.length) tips.push(`Break concentration: ${conc.map((x) => x.name).join(', ')}.`)
    if (bloodied.length && !/beast/i.test(i.creatureType)) tips.push(`Bloodied targets: ${bloodied.map((x) => `${x.name} (${x.hp} HP)`).join(', ')}.`)
    const lowAc = [...party].sort((a, b) => (Number(a.ac) || 99) - (Number(b.ac) || 99))[0]
    if (lowAc?.ac) tips.push(`Easiest to hit: ${lowAc.name} (AC ${lowAc.ac}).`)
    if (c.maxHp && c.hp <= c.maxHp / 4 && !FEARLESS.test(i.creatureType)) tips.push('Badly hurt: it may flee, beg or bargain.')
  }
  return tips
}
