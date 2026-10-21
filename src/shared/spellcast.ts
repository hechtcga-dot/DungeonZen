import { z } from 'zod'
import { ABILITIES6, adjustDamage, changeHp, CONDITIONS, type Combatant, type CombatantInfo, type CombatState } from './combat'
import { spellLevel, type SrdSpell } from './attacks'

// Casting a spell in a fight (owner, 3.5.0): the rule fields a spell needs for the checks, read from
// the SRD or the spell's own text (or the DM's own, kept per campaign by spell name), the checks
// (red: will not work, yellow: a catch, green: legal), reactions that may answer it, and the cast
// itself on the fight. Range, sight and cover are never known: the DM checks those. Red warns, never
// blocks (the DM may cast anyway; the log says so). Pure.

export const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] as const
export const CREATURE_TYPES = ['Aberration', 'Beast', 'Celestial', 'Construct', 'Dragon', 'Elemental', 'Fey', 'Fiend', 'Giant', 'Humanoid', 'Monstrosity', 'Ooze', 'Plant', 'Undead'] as const

export const SpellRules = z.object({
  level: z.number().int().min(0).max(9),
  time: z.enum(['action', 'bonus', 'reaction', 'other']),
  /** Spell attack roll: melee or ranged ('' none). */
  attack: z.enum(['', 'melee', 'ranged']),
  save: z.enum(['', ...ABILITIES6]),
  halfOnSave: z.boolean(),
  /** Damage types, lower case. */
  damage: z.array(z.string().max(20)).max(6),
  heal: z.boolean(),
  /** Conditions it gives (on a hit or a failed save). */
  conditions: z.array(z.string().max(60)).max(6),
  /** Only these creature types (empty: any). */
  types: z.array(z.string().max(30)).max(14),
  /** No effect on these creature types. */
  notTypes: z.array(z.string().max(30)).max(14),
  /** Largest size it works on ('' any); sizeAll false: only part of it stops (a push), not the spell. */
  maxSize: z.enum(['', ...SIZES]),
  sizeAll: z.boolean(),
  verbal: z.boolean(),
  somatic: z.boolean(),
  material: z.boolean(),
  concentration: z.boolean(),
  /** How long its conditions last, in rounds (null: until removed). */
  rounds: z.number().int().min(1).max(100000).nullable(),
  /** A hit takes away the target's reactions until its next turn. */
  noReactions: z.boolean(),
  /** Reaction spells: when it is cast. */
  trigger: z.string().max(300)
})
export type SpellRules = z.infer<typeof SpellRules>
export type RulesSource = 'yours' | 'srd' | 'text'

/** Where the spell rule fields were found, for the panel. */
export const SOURCE_LABEL: Record<RulesSource, string> = { yours: 'your rule fields', srd: 'SRD 5.2', text: 'read from the spell text' }

const ABILITY_WORD: Record<string, (typeof ABILITIES6)[number]> = { str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA' }
const abilityOf = (w: string) => ABILITY_WORD[w.slice(0, 3).toLowerCase()] ?? ''
const TYPE_RE = CREATURE_TYPES.join('|')
const CONDITION_RE = CONDITIONS.filter((c) => !['Concentrating', 'Bloodied', 'Exhaustion'].includes(c)).join('|')

/** Duration in rounds: "1 minute" → 10, "1 hour" → 600, "1 round" → 1; instantaneous or "until…" → null. */
export function durationRounds(text: string): number | null {
  const m = /(\d+)\s*(round|minute|hour|day)/i.exec(text)
  if (!m) return null
  return Number(m[1]) * ({ round: 1, minute: 10, hour: 600, day: 14400 } as Record<string, number>)[m[2].toLowerCase()]
}

/** What any spell text says: creature types, size, conditions, half on a save, reactions taken away. */
function fromWords(desc: string): Pick<SpellRules, 'types' | 'notTypes' | 'maxSize' | 'sizeAll' | 'conditions' | 'halfOnSave' | 'noReactions'> {
  const first = desc.split(/(?<=\.)\s/).slice(0, 2).join(' ')
  // "Choose a Humanoid that you can see", "One Beast you can see", "Target a Beast or Humanoid within range".
  const want = new RegExp(`\\b(?:[Aa]n?|[Oo]ne|[Tt]arget)\\s+(${TYPE_RE})(?:\\s+or\\s+(?:a\\s+|an\\s+)?(${TYPE_RE}))?\\b(?=[^.]*\\b(?:you can see|within range|you touch|in range))`).exec(first)
  const not = /\bno effect on ([^.]+)/i.exec(desc)
  const sentences = desc.split(/(?<=[.!?])\s+/)
  // Only a size limit on creatures (not on objects, walls or the area).
  const sizeSentence = sentences.find((x) => /\b(Tiny|Small|Medium|Large|Huge) or smaller\b/.test(x) && /\bcreature|target\b/i.test(x)) ?? ''
  const size = /\b(Tiny|Small|Medium|Large|Huge) or smaller\b/.exec(sizeSentence)
  const conditions = new Set<string>()
  // Not the sentences that end, remove or guard against a condition.
  const gives = sentences.filter((x) => !/immun|unaffected|remove|can't be|isn't|cure|if it has|\bends? (?:the|a|one|on)\b|condition ends/i.test(x)).join(' ')
  for (const m of gives.matchAll(new RegExp(`\\b(?:has|have|gains?|is|are|be|falls?|knocked)\\s+(?:the\\s+)?(${CONDITION_RE})(?:\\s+and\\s+(${CONDITION_RE}))?\\b`, 'g'))) {
    conditions.add(m[1]); if (m[2]) conditions.add(m[2])
  }
  return {
    types: want ? [want[1], want[2]].filter(Boolean) : [],
    notTypes: not ? CREATURE_TYPES.filter((t) => new RegExp(`\\b${t}s?\\b`, 'i').test(not[1])) : [],
    maxSize: (size?.[1] ?? '') as SpellRules['maxSize'],
    // The size limit stops the whole spell when it picks the target; otherwise only part of it (a push).
    sizeAll: !!size && /\b(target|choose|one|creature you can see)\b/i.test(sizeSentence) && !/\bpush|pull|moved?|object\b/i.test(sizeSentence),
    conditions: [...conditions].slice(0, 6),
    halfOnSave: /half as much damage|half damage|takes? half/i.test(desc),
    noReactions: /can'?t take reactions|ability to take reactions|can'?t use (?:its )?reaction/i.test(desc)
  }
}

const TIME = (t: string): SpellRules['time'] => (/bonus/i.test(t) ? 'bonus' : /reaction/i.test(t) ? 'reaction' : /\baction\b/i.test(t) ? 'action' : 'other')

/** An SRD 5.2 spell's rule fields. */
export function srdSpellRules(s: SrdSpell): SpellRules {
  const comps = s.components ?? ''
  return {
    level: s.level, time: TIME(s.time), save: abilityOf(s.save), damage: s.types.map((t) => t.toLowerCase()),
    attack: !s.attack ? '' : /melee spell attack/i.test(s.desc) ? 'melee' : 'ranged',
    heal: !s.types.length && /\bregains?\b[^.]*hit points/i.test(s.desc),
    verbal: comps.includes('V'), somatic: comps.includes('S'), material: comps.includes('M'),
    concentration: s.concentration, rounds: durationRounds(s.duration), trigger: s.trigger ?? '',
    ...fromWords(s.desc)
  }
}

/**
 * Rule fields read from a spell's text on a sheet (the picker's "Level 2 Enchantment · action · 60 feet ·
 * V, S, M · Concentration, 1 minute. … Wisdom Saving Throw: DC 15" or a sheet's own words such as
 * "Cantrip Evocation, 1 Action, Range 120 ft., Spell Attack +12, 2d10 Fire damage").
 */
export function textSpellRules(description: string): SpellRules {
  const d = description
  const words = fromWords(d)
  const save = /\b(Str|Dex|Con|Int|Wis|Cha)[a-z]*\.?\s+(?:Saving Throw|Save)\b/i.exec(d)
  const comps = /(?:^|[·,(]\s*)(V(?:,\s*S)?(?:,\s*M)?|S(?:,\s*M)?|M)(?=\s*(?:[·,.)]|\(|$))/.exec(d)?.[1] ?? ''
  return {
    level: spellLevel(d) ?? (/^\s*level\s*(\d)/i.exec(d) ? Number(/^\s*level\s*(\d)/i.exec(d)![1]) : 0),
    time: TIME(/\b(1\s+)?(bonus action|reaction|action)\b/i.exec(d)?.[0] ?? ''),
    attack: /melee spell attack|melee attack roll/i.test(d) ? 'melee' : /spell attack|attack roll/i.test(d) ? 'ranged' : '',
    save: save ? abilityOf(save[1]) : '',
    damage: [...new Set([...d.matchAll(/\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\s+damage/gi)].map((m) => m[1].toLowerCase()))].slice(0, 6),
    heal: /\bregains?\b[^.]*hit points/i.test(d) && !/\bdamage\b/i.test(d),
    verbal: /\bV\b/.test(comps), somatic: /\bS\b/.test(comps), material: /\bM\b/.test(comps),
    concentration: /\bconcentration\b/i.test(d),
    rounds: durationRounds(/(?:concentration,?\s*)?(?:up to\s*)?(\d+\s*(?:rounds?|minutes?|hours?|days?))/i.exec(d)?.[1] ?? ''),
    trigger: '',
    ...words,
    // A sheet's short text names conditions bare ("CON Save DC 20, Prone / Push").
    conditions: words.conditions.length ? words.conditions : [...new Set(d.match(new RegExp(`\\b(?:${CONDITION_RE})\\b`, 'g')) ?? [])].slice(0, 6)
  }
}

/** The rule fields for a spell: the DM's own (campaign, by name), else the SRD, else its text. */
export function spellRulesFor(name: string, description: string, yours: Record<string, unknown>, srd: SrdSpell[]): { rules: SpellRules; source: RulesSource } {
  const key = name.trim().toLowerCase()
  const own = SpellRules.safeParse(yours[key])
  if (own.success) return { rules: own.data, source: 'yours' }
  const s = srd.find((x) => x.name.toLowerCase() === key)
  if (s) return { rules: srdSpellRules(s), source: 'srd' }
  return { rules: textSpellRules(description), source: 'text' }
}

/** Spells a stat block's Spellcasting text lists: "At Will: Detect Magic, Light", "2/Day Each: Fireball" (key: its uses). */
export function spellsInText(text: string): Array<{ name: string; useKey: string | null }> {
  const out: Array<{ name: string; useKey: string | null }> = []
  for (const m of text.matchAll(/(at will|\d+\s*\/\s*day(?:\s+each)?)\s*:\**\s*([^\n]+)/gi)) {
    for (const name of m[2].split(',').map((x) => x.replace(/\(.*?\)|\*/g, '').trim()).filter(Boolean).slice(0, 20)) {
      out.push({ name, useKey: /day/i.test(m[1]) ? `day:${name}` : null })
    }
  }
  return out
}

export type CheckLevel = 'red' | 'yellow' | 'green'
export interface CheckLine { level: CheckLevel; text: string }

const SIZE_INDEX = (s: string) => SIZES.findIndex((x) => s.toLowerCase().startsWith(x.toLowerCase()))
const BLOCKS_CASTING = /incapacitated|paralyzed|petrified|stunned|unconscious/i
/** Shell Defense (Tortle) and the like: withdrawn, nothing to cast or react with. */
const WITHDRAWN = /withdraw|in (?:its|his|her|their) shell/i
const has = (list: string, word: string) => new RegExp(`\\b${word}\\b`, 'i').test(list)

export interface CasterCheck {
  name: string
  conditions: string[]
  /** Effects on it (Silence…). */
  effects: string[]
  /** A slot (or a use) is there for this cast. */
  slotOk: boolean
  /** Spells it cast on this turn: a bonus action spell, a spell with a slot. */
  turn: { bonus: boolean; slot: boolean } | null
  /** The spell it is concentrating on now. */
  concentrating: string | null
}

/** Red, yellow or green lines about the caster. */
export function checkCaster(r: SpellRules, c: CasterCheck, usesSlot: boolean): CheckLine[] {
  const out: CheckLine[] = []
  const blocked = c.conditions.find((k) => BLOCKS_CASTING.test(k))
  if (blocked) out.push({ level: 'red', text: `${c.name} is ${blocked.toLowerCase()}: can't cast.` })
  if (c.conditions.some((k) => WITHDRAWN.test(k))) out.push({ level: 'red', text: `${c.name} is withdrawn in its shell: can't cast.` })
  if (r.verbal && (c.conditions.some((k) => /silenced/i.test(k)) || c.effects.some((e) => /^silence$/i.test(e)))) out.push({ level: 'red', text: `${c.name} is in Silence and this spell has a Verbal component.` })
  if (!c.slotOk) out.push({ level: 'red', text: usesSlot ? 'No spell slot left at that level.' : 'No uses left today.' })
  if (c.turn && r.time !== 'reaction') {
    if (c.turn.bonus && usesSlot) out.push({ level: 'red', text: 'Already cast a Bonus Action spell this turn: no other spell with a slot this turn (2024 rules).' })
    if (r.time === 'bonus' && c.turn.slot) out.push({ level: 'red', text: 'Already cast a spell with a slot this turn: a Bonus Action spell can\'t follow (2024 rules).' })
  }
  if (r.concentration && c.concentrating) out.push({ level: 'yellow', text: `Ends ${c.name}'s concentration on ${c.concentrating}.` })
  return out
}

export interface TargetCheck {
  name: string
  creatureType: string
  size: string
  resist: string
  immune: string
  vuln: string
  condImmune: string
  conditions: string[]
  magicResist: boolean
  /** Legendary Resistance uses left (0: none). */
  legendaryLeft: number
}

/** Red, yellow or green lines about one target. A missing creature type or size is left out (not known). */
export function checkTarget(r: SpellRules, t: TargetCheck, numbers: string): CheckLine[] {
  const out: CheckLine[] = []
  const type = t.creatureType.toLowerCase()
  if (type && r.types.length && !r.types.some((x) => type.includes(x.toLowerCase()))) out.push({ level: 'red', text: `Works only on ${r.types.join(' or ')}; ${t.name} is ${t.creatureType}.` })
  const notOn = r.notTypes.find((x) => type.includes(x.toLowerCase()))
  if (type && notOn) out.push({ level: 'red', text: `No effect on ${notOn}.` })
  const size = SIZE_INDEX(t.size)
  if (r.maxSize && size > SIZES.indexOf(r.maxSize)) {
    out.push({ level: r.sizeAll ? 'red' : 'yellow', text: r.sizeAll ? `${t.name} is too big (${r.maxSize} or smaller).` : `${t.name} is too big for part of it (${r.maxSize} or smaller), e.g. the push.` })
  }
  if (!r.heal && r.damage.length) {
    const immune = r.damage.filter((d) => has(t.immune, d))
    if (immune.length === r.damage.length && !r.conditions.length) out.push({ level: 'red', text: `Immune to ${immune.join(' and ')} damage.` })
    else if (immune.length) out.push({ level: 'yellow', text: `Immune to ${immune.join(' and ')} damage.` })
    const resists = r.damage.filter((d) => has(t.resist, d))
    if (resists.length) out.push({ level: 'yellow', text: `Resists ${resists.join(' and ')}: half damage.` })
    const vuln = r.damage.filter((d) => has(t.vuln, d))
    if (vuln.length) out.push({ level: 'green', text: `Vulnerable to ${vuln.join(' and ')}: double damage.` })
  }
  const immuneTo = r.conditions.filter((k) => has(t.condImmune, k))
  if (immuneTo.length) out.push({ level: immuneTo.length === r.conditions.length && !r.damage.length ? 'red' : 'yellow', text: `Immune to ${immuneTo.join(' and ')}.` })
  const already = r.conditions.filter((k) => t.conditions.some((x) => x.toLowerCase() === k.toLowerCase()))
  if (already.length) out.push({ level: 'yellow', text: `Already ${already.join(' and ').toLowerCase()}.` })
  if (r.save && t.magicResist) out.push({ level: 'yellow', text: 'Magic Resistance: Advantage on the save.' })
  if (r.save && t.legendaryLeft > 0) out.push({ level: 'yellow', text: `Legendary Resistance: can choose to succeed (${t.legendaryLeft} left today).` })
  if (!out.some((l) => l.level === 'red')) out.unshift({ level: 'green', text: numbers || 'Legal.' })
  return out
}

/** What the DM still checks by hand, and checks that could not run without the rule fields. */
export function manualChecks(source: RulesSource, targetsKnown: boolean): string[] {
  const out = ['Range, line of sight and cover: you check.']
  if (source === 'text') out.push('Rule fields read from the spell text: creature type, size and components may be missing. Fill its rule fields to check them.')
  if (!targetsKnown) out.push('A target without a stat block: type, size and defences not checked.')
  return out
}

// ---- reactions

export type Trigger = 'melee' | 'ranged' | 'attack' | 'spell' | 'damage' | 'save'
/** Common reactions by name, for those whose text does not say when (2024 rules). */
const KNOWN: Record<string, { on: Trigger[]; types?: string[] }> = {
  shield: { on: ['attack'] }, counterspell: { on: ['spell'] }, 'absorb elements': { on: ['damage'], types: ['acid', 'cold', 'fire', 'lightning', 'thunder'] },
  parry: { on: ['melee'] }, riposte: { on: ['melee'] }, 'uncanny dodge': { on: ['attack'] }, 'deflect missiles': { on: ['ranged'] }, 'deflect missile': { on: ['ranged'] },
  'deflect attacks': { on: ['attack'] }, 'hellish rebuke': { on: ['damage'] }, 'silvery barbs': { on: ['save'] }, protection: { on: ['attack'] }, 'redirect attack': { on: ['attack'] }
}

/** When a reaction can be used, from its name, its words or the reaction spells it casts. */
export function reactionTriggers(name: string, text: string): { on: Trigger[]; types: string[] } | null {
  const known = KNOWN[name.toLowerCase().replace(/\s*\(.*\)\s*/, '').trim()]
  if (known) return { on: known.on, types: known.types ?? [] }
  // "casts Counterspell or Shield": the spells' own triggers.
  const spells = Object.keys(KNOWN).filter((k) => new RegExp(`\\bcasts?\\b[^.]*\\b${k}\\b`, 'i').test(text))
  if (spells.length) return { on: [...new Set(spells.flatMap((k) => KNOWN[k].on))], types: [...new Set(spells.flatMap((k) => KNOWN[k].types ?? []))] }
  const t = text.toLowerCase()
  const on = new Set<Trigger>()
  if (/melee attack/.test(t)) on.add('melee')
  else if (/ranged attack/.test(t)) on.add('ranged')
  else if (/attack roll|hit by an attack|is hit\b|would hit/.test(t)) on.add('attack')
  if (/casts? a spell|casting a spell|targeted by[^.]*spell/.test(t)) on.add('spell')
  if (/takes? damage|taking damage|subjected to [a-z ,]+damage/.test(t)) on.add('damage')
  if (/saving throw/.test(t) && /trigger/.test(t)) on.add('save')
  if (!on.size) return null
  const types = /subjected to|takes? [a-z ,]+ damage/.test(t) ? ['acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'].filter((d) => new RegExp(`\\b${d}\\b`).test(t)) : []
  return { on: [...on], types }
}

export interface ReactionOption {
  name: string
  text: string
  /** Can be used now. */
  ready: boolean
  /** Why not, or "check by hand" (its trigger is not known). */
  why: string
  /** Reaction spells: their level (a slot is spent). */
  level: number | null
}

/** Reactions a target may use against this spell, and whether it can now. */
export function reactionOptions(s: CombatState, target: Combatant, i: CombatantInfo | undefined, r: SpellRules, rulesOf: (name: string, text: string) => SpellRules): ReactionOption[] {
  if (!i) return []
  const used = target.rounds[String(s.round)]?.r
  const blocked = target.conditions.find((k) => BLOCKS_CASTING.test(k.name) || WITHDRAWN.test(k.name) || /^no reactions$/i.test(k.name))
  const out: ReactionOption[] = []
  for (const a of i.actions) {
    const text = a.full ?? a.text
    const spell = a.kind === 'SPELL' ? rulesOf(a.name, text) : null
    if (a.kind !== 'REACTION' && spell?.time !== 'reaction') continue
    const trig = reactionTriggers(a.name, `${spell?.trigger ?? ''} ${text}`)
    const fits = !trig ? null
      : trig.on.includes('spell') || (r.attack && (trig.on.includes('attack') || trig.on.includes(r.attack)))
        || (r.save !== '' && trig.on.includes('save'))
        || (r.damage.length > 0 && trig.on.includes('damage') && (!trig.types.length || r.damage.some((d) => trig.types.includes(d))))
    if (fits === false) continue
    const level = spell && spell.level > 0 ? spell.level : null
    const noSlot = level !== null && !i.slots.max.some((m, k) => k + 1 >= level && m + i.slots.bonus[k] - i.slots.used[k] > 0)
      && !(i.slots.pact.count - i.slots.pact.used > 0 && i.slots.pact.level >= level)
    const why = used ? 'Reaction already used this round.' : blocked ? `${blocked.name}: no reactions.` : noSlot ? 'No spell slot left for it.' : fits === null ? 'Check by hand: when it can be used is not known.' : ''
    const plain = text.replace(/[_*]+/g, '')
    out.push({ name: a.name, text: plain.length > 240 ? `${plain.slice(0, 240)}…` : plain, ready: !used && !blocked && !noSlot, why, level })
  }
  return out
}

// ---- the cast

export type Outcome = 'hit' | 'miss' | 'failed' | 'saved' | 'auto'

/** Ends a combatant's concentration: the conditions its spell gave go, and so does its Concentrating. */
export function endConcentration(s: CombatState, casterId: string): CombatState {
  const c = s.combatants.find((x) => x.id === casterId)
  if (!c?.conc) return s
  const src = `${casterId}:${c.conc}`
  return {
    ...s,
    combatants: s.combatants.map((x) => ({
      ...x, conc: x.id === casterId ? null : x.conc,
      conditions: x.conditions.filter((k) => k.src !== src && !(x.id === casterId && k.name === 'Concentrating'))
    })),
    log: [...s.log, `Round ${s.round}: ${c.name} stops concentrating on ${c.conc}.`]
  }
}

export interface CastInput {
  casterId: string
  spell: string
  rules: SpellRules
  /** "level 2 slot", "Pact slot (level 3)", "2/Day", "cantrip"… for the log. */
  how: string
  usesSlot: boolean
  targets: Array<{ id: string; outcome: Outcome; conditions: string[] }>
  /** The damage (or healing) rolled, the same for every target. */
  amount: number
  damageType: string
  /** Red lines the DM cast past. */
  overrides: string[]
}

/** The cast on the fight: concentration, damage or healing per target (half on a save when the spell says so), conditions, the log. */
export function applyCast(s0: CombatState, x: CastInput, info?: Record<string, CombatantInfo | undefined>): CombatState {
  const caster = s0.combatants.find((c) => c.id === x.casterId)
  if (!caster) return s0
  let s = x.rules.concentration ? endConcentration(s0, x.casterId) : s0
  const names: string[] = []
  for (const t of x.targets) {
    const c = s.combatants.find((y) => y.id === t.id)
    if (!c) continue
    const lands = t.outcome === 'hit' || t.outcome === 'failed' || t.outcome === 'auto'
    const amount = lands ? x.amount : t.outcome === 'saved' && x.rules.halfOnSave ? Math.floor(x.amount / 2) : 0
    if (amount > 0) s = changeHp(s, t.id, x.rules.heal ? amount : -amount, x.rules.heal ? '' : x.damageType, info)
    const add = lands ? t.conditions : []
    const extra = lands && x.rules.noReactions ? ['No reactions'] : []
    if (add.length || extra.length) {
      s = {
        ...s, combatants: s.combatants.map((y) => (y.id !== t.id ? y : {
          ...y, conditions: [...y.conditions,
            ...add.map((name) => ({ name, rounds: x.rules.rounds, src: x.rules.concentration ? `${x.casterId}:${x.spell}` : undefined })),
            ...extra.map((name) => ({ name, rounds: 1 }))]
        }))
      }
    }
    const word = { hit: 'hit', miss: 'missed', failed: 'failed the save', saved: 'saved', auto: '' }[t.outcome]
    const adj = amount && !x.rules.heal ? adjustDamage(amount, x.damageType, c.entityId ? info?.[c.entityId] : undefined).amount : amount
    names.push(`${c.name}${word ? ` (${word}` : ' ('}${amount ? `${word ? ', ' : ''}${adj} ${x.rules.heal ? 'healed' : `${x.damageType} damage`.trim()}` : ''}${add.length ? `, ${add.join(' and ').toLowerCase()}` : ''})`.replace(' ()', ''))
  }
  const ownTurn = s.combatants[s.turn]?.id === x.casterId && x.rules.time !== 'reaction'
  const prev = caster.cast && caster.cast.round === s.round ? caster.cast : { round: s.round, bonus: false, slot: false }
  s = {
    ...s,
    combatants: s.combatants.map((c) => (c.id !== x.casterId ? c : {
      ...c,
      cast: ownTurn ? { round: s.round, bonus: prev.bonus || x.rules.time === 'bonus', slot: prev.slot || x.usesSlot } : c.cast,
      conc: x.rules.concentration ? x.spell : c.conc,
      conditions: x.rules.concentration ? [...c.conditions.filter((k) => k.name !== 'Concentrating'), { name: 'Concentrating', rounds: x.rules.rounds, src: `${x.casterId}:${x.spell}` }] : c.conditions,
      rounds: x.rules.time === 'reaction' ? { ...c.rounds, [String(s.round)]: { ...(c.rounds[String(s.round)] ?? { dmg: 0, heal: 0, r: false, c: false }), r: true } } : c.rounds
    }))
  }
  const line = `Round ${s.round}: ${caster.name} casts ${x.spell} (${x.how})${names.length ? ` on ${names.join(', ')}` : ''}.${x.overrides.length ? ` Cast despite: ${x.overrides.join('; ')}` : ''}`
  return { ...s, log: [...s.log, line.slice(0, 500)] }
}

/** A target uses its reaction: marked for this round and logged. */
export function useReaction(s: CombatState, id: string, name: string): CombatState {
  const c = s.combatants.find((x) => x.id === id)
  if (!c) return s
  const rec = c.rounds[String(s.round)] ?? { dmg: 0, heal: 0, r: false, c: false }
  return {
    ...s,
    combatants: s.combatants.map((x) => (x.id === id ? { ...x, rounds: { ...x.rounds, [String(s.round)]: { ...rec, r: true } } } : x)),
    log: [...s.log, `Round ${s.round}: ${c.name} uses ${name} (reaction).`]
  }
}

/** Spell attack bonus or save DC written in a spell's text ("Spell Attack +12", "DC 20"). */
export function castNumbers(text: string, fallbackDc: number | null): { attack: number | null; dc: number | null } {
  const atk = /(?:spell attack|attack roll):?\s*([+−-]\d+)/i.exec(text)
  const dc = /\bDC\s*(\d+)/.exec(text)
  return { attack: atk ? Number(atk[1].replace('−', '-')) : null, dc: dc ? Number(dc[1]) : fallbackDc }
}
