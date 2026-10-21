import { average } from './attacks'
import type { Combatant, CombatantInfo, CombatState } from './combat'
import { slotsLeft, pactLeft } from './slots'
import { checkTarget, type SpellRules } from './spellcast'

// Run encounter turn panel (owner, 2026-10-21): a creature's attacks, spells and features in three groups
// (combat first, most likely first; situational; out of combat), the DM's own group per line kept on the
// card (`attributes.action_groups`, by name), and two or three likely moves for this turn from the fight as
// it stands (local rules, no AI). Pure.

export type ActionGroup = 'combat' | 'situational' | 'other'
export const GROUP_LABEL: Record<ActionGroup, string> = { combat: 'Combat', situational: 'Situational', other: 'Out of combat' }

type Action = CombatantInfo['actions'][number]
type RulesOf = (name: string, text: string) => SpellRules

const HARMS = /attack roll|to hit|saving throw|\bsave\b|\bdamage\b|multiattack|\bsummon|\bconjure/i
const SITUATIONAL = /\breaction\b|withdraw|emerge|\bdodge\b|\bdisengage\b|\bdash\b|regain|heal|temporary hit points|sorcery points|\bconvert\b|spell slots?/i

/** The group a line belongs in: the DM's own, else from what it does. */
export function actionGroup(a: Action, r: SpellRules | null, own?: unknown): ActionGroup {
  if (own === 'combat' || own === 'situational' || own === 'other') return own
  const text = `${a.name}. ${a.full ?? a.text}`
  if (a.kind === 'REACTION') return 'situational'
  if (a.kind === 'LEGENDARY_ACTION') return 'combat'
  if (r) {
    if (r.time === 'reaction' || r.heal) return 'situational'
    if (r.time === 'other') return 'other'
    if (r.attack || r.save || r.damage.length || r.conditions.length) return 'combat'
    return 'other'
  }
  if (SITUATIONAL.test(text) && !/attack roll|to hit/i.test(text)) return 'situational'
  return HARMS.test(text) ? 'combat' : 'situational'
}

/** Average damage written in a line ("2d10 Fire", "1d6 + 3"), 0 when none. */
export function lineDamage(text: string): number {
  const m = /(\d+d\d+)(?:\s*([+−-])\s*(\d+))?/.exec(text)
  if (!m) return 0
  return average(m[1], m[3] ? (m[2] === '+' ? 1 : -1) * Number(m[3]) : 0) ?? 0
}

/** A slot of this level or higher left (or Pact Magic). */
export function hasSlotFor(i: CombatantInfo, level: number): boolean {
  if (level <= 0) return true
  return slotsLeft(i.slots).some((n, k) => k + 1 >= level && n > 0) || (pactLeft(i.slots) > 0 && i.slots.pact.level >= level)
}

/** How likely in a fight (higher first): spells with a slot, then cantrips and attacks, then bonus actions; no slot left last. */
export function combatScore(a: Action, r: SpellRules | null, i: CombatantInfo): number {
  const text = `${a.name}. ${a.full ?? a.text}`
  const dmg = lineDamage(a.full ?? a.text)
  const control = r?.conditions.some((k) => /paralyzed|stunned|restrained|incapacitated|frightened|charmed|blinded|prone/i.test(k)) ? 15 : 0
  const bonus = a.kind === 'BONUS_ACTION' || r?.time === 'bonus'
  if (r && r.level > 0 && !hasSlotFor(i, r.level) && !i.spellList?.some((s) => s.name.toLowerCase() === a.name.toLowerCase() && s.useKey)) return -100 + dmg
  if (bonus) return 20 + dmg + control
  if (/^multiattack/i.test(a.name)) return 90
  if (r && r.level > 0) return 100 + r.level * 5 + dmg + control
  return 50 + dmg + control + (HARMS.test(text) ? 0 : -20)
}

export interface GroupedAction extends Action { group: ActionGroup; score: number; noSlot: boolean }

/** The lines in their groups, combat ones most likely first. */
export function groupActions(i: CombatantInfo, rulesOf: RulesOf, own: Record<string, unknown>): Record<ActionGroup, GroupedAction[]> {
  const out: Record<ActionGroup, GroupedAction[]> = { combat: [], situational: [], other: [] }
  for (const a of i.actions) {
    const r = a.kind === 'SPELL' ? rulesOf(a.name, a.full ?? a.text) : null
    const group = actionGroup(a, r, own[a.name])
    const score = combatScore(a, r, i)
    out[group].push({ ...a, group, score, noSlot: !!r && r.level > 0 && !hasSlotFor(i, r.level) })
  }
  out.combat.sort((x, y) => y.score - x.score)
  return out
}

/** Who a creature fights: the other side, still up. */
export function foesOf(s: CombatState, c: Combatant): Combatant[] {
  return s.combatants.filter((x) => x.id !== c.id && !x.out && !(x.maxHp > 0 && x.hp === 0) && (c.side === 'foe' ? x.side !== 'foe' : x.side === 'foe'))
}

const bloodied = (x: Combatant) => x.maxHp > 0 && x.hp <= x.maxHp / 2

/** The best target for a line: a legal hit (no red check), Bloodied and low hit points first. */
function bestTarget(foes: Combatant[], r: SpellRules | null, info: Record<string, CombatantInfo | undefined>): Combatant | null {
  const legal = foes.filter((t) => {
    if (!r) return true
    const ti = t.entityId ? info[t.entityId] : undefined
    return !checkTarget(r, {
      name: t.name, creatureType: ti?.creatureType ?? '', size: ti?.size ?? '', resist: ti?.resist ?? '', immune: ti?.immune ?? '', vuln: ti?.vuln ?? '',
      condImmune: ti?.condImmune ?? '', conditions: t.conditions.map((k) => k.name), magicResist: !!ti?.magicResist, legendaryLeft: 0
    }, '').some((l) => l.level === 'red')
  })
  return [...legal].sort((a, b) => Number(bloodied(b)) - Number(bloodied(a)) || a.hp - b.hp)[0] ?? null
}

const targetText = (t: Combatant) => `${t.name} (AC ${t.ac || '?'}${bloodied(t) ? ', Bloodied' : ''}, ${t.hp}/${t.maxHp} HP)`

/**
 * Two or three likely moves this turn (no AI): the best combat option at a legal target, a concentration spell
 * when not concentrating, a defensive or healing option when Bloodied, the best bonus action.
 */
export function likelyThisTurn(s: CombatState, c: Combatant, i: CombatantInfo | undefined, info: Record<string, CombatantInfo | undefined>, rulesOf: RulesOf, own: Record<string, unknown>): string[] {
  if (!i || c.out || (c.maxHp > 0 && c.hp === 0)) return []
  const g = groupActions(i, rulesOf, own)
  const foes = foesOf(s, c)
  const out: string[] = []
  const usable = g.combat.filter((a) => !a.noSlot)
  const rules = (a: GroupedAction) => (a.kind === 'SPELL' ? rulesOf(a.name, a.full ?? a.text) : null)
  const main = usable.filter((a) => a.kind !== 'BONUS_ACTION' && rules(a)?.time !== 'bonus')
  const concentrating = !!c.conc || c.conditions.some((k) => k.name === 'Concentrating')
  // The two best options with a legal target (concentration spells only while not concentrating).
  for (const a of main) {
    if (out.length >= 2) break
    const r = rules(a)
    if (r?.concentration && concentrating) continue
    const t = bestTarget(foes, r, info)
    if (!t && foes.length) continue
    const why = [r?.level ? `level ${r.level} slot` : '', r?.concentration ? 'not concentrating now' : ''].filter(Boolean).join(', ')
    out.push(`${a.name}${t ? ` → ${targetText(t)}` : ''}${why ? `: ${why}` : ''}.`)
  }
  if (bloodied(c)) {
    const safe = g.situational.find((a) => /withdraw|dodge|disengage|heal|regain|temporary hit points|shield|misty step/i.test(`${a.name} ${a.full ?? a.text}`))
    if (safe) out.push(`Bloodied (${c.hp}/${c.maxHp} HP): ${safe.name}?`)
  }
  const bonus = usable.find((a) => (a.kind === 'BONUS_ACTION' || rules(a)?.time === 'bonus') && !out.some((l) => l.startsWith(a.name)))
  if (bonus && out.length < 3) {
    const t = bestTarget(foes, rules(bonus), info)
    out.push(`Bonus action: ${bonus.name}${t && HARMS.test(bonus.full ?? bonus.text) ? ` → ${t.name}` : ''}.`)
  }
  return out.slice(0, 3)
}
