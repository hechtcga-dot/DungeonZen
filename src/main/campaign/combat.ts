import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { classesOf, hitDice, levelOf, usesOf } from '../../shared/charsheet'
import { combat, ability, entity, encounterCreature, logEntry } from '../db/schema'
import { type Writer } from './commandLog'
import type { RowStatus } from '../../shared/schemas'
import { ABILITY_KEYS, leadingNumber, passiveScore, readStatBlock, saveBonus } from '../../shared/statblock'
import { battlePlan, spellRoles, type BattlePlan, type PlanFoe, type PlanPc } from '../../shared/battleplan'
import { spellLevel } from '../../shared/attacks'
import type { CombatView, LogView } from '../../shared/types'
import { boostsAllies, CombatState, DAMAGE_TYPES, isLeaderName, legendaryCount, limitedUses, newCombatant, type Combatant, type CombatantInfo } from '../../shared/combat'
import { xpForCr } from '../../shared/encounter'
import { pactLeft, slotsLeft, slotState } from '../../shared/slots'
import { SpellRules, spellsInText } from '../../shared/spellcast'
import { part } from './part'


export const combatPart = part({
  // ---- run encounter (combat tracker)

  /** A creature or player character as it enters a fight: hit points and AC from its card. */
  fightCombatant(entityId: string, side: Combatant['side'], name: string): Combatant {
    const e = this.entityRow(entityId)
    const sb = readStatBlock(e.attributes.statblock)
    const max = leadingNumber(sb?.hp ?? '') ?? 0
    const hp = side === 'party' && typeof e.attributes.current_hp === 'number' ? e.attributes.current_hp : max
    const texts = [...(sb?.traits ?? []).map((t) => `${t.name} ${t.desc}`), ...this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all().map((a) => a.name)]
    return newCombatant({
      id: randomUUID(), entityId, name, side, hp, maxHp: max, ac: String(leadingNumber(sb?.ac ?? '') ?? ''),
      tempHp: side === 'party' && typeof e.attributes.temp_hp === 'number' ? e.attributes.temp_hp : 0,
      displacement: texts.some((t) => /^displacement\b/i.test(t)) ? 'on' : null
    })
  },

  /** Starts a fight from an encounter (or returns the one still running): the party, then the foes in the encounter's order. */
  startCombat(encounterId: string): string {
    const running = this.db.select().from(combat).where(and(eq(combat.encounterId, encounterId), eq(combat.status, 'active'))).get()
    if (running) return running.id
    const enc = this.encounterView(encounterId)
    const combatants: Combatant[] = enc.pcs.filter((p) => p.in).map((p) => this.fightCombatant(p.id, 'party', p.name))
    for (const cr of enc.creatures) {
      for (let i = 1; i <= cr.count; i++) combatants.push({ ...this.fightCombatant(cr.entityId, 'foe', cr.count > 1 ? `${cr.name} ${i}` : cr.name), notes: cr.notes })
    }
    const id = randomUUID()
    this.log.run(`Started the fight: ${enc.name}`, (w) => {
      w.insert('combat', { id, encounterId, status: 'active', createdAt: new Date().toISOString(), state: { round: 1, turn: 0, combatants, log: [`Round 1: ${enc.name} begins.`], effects: [] } })
    })
    return id
  },

  /**
   * The running fight follows its encounter (owner, 1.4.0): more creatures join at the end of the order
   * with full hit points; fewer take unhurt copies out first. Runs inside the change to the encounter.
   */
  syncFight(w: Writer, encounterId: string): void {
    const row = this.db.select().from(combat).where(and(eq(combat.encounterId, encounterId), eq(combat.status, 'active'))).get()
    if (!row) return
    const st = CombatState.parse(row.state)
    const want = new Map<string, number>()
    for (const r of this.db.select().from(encounterCreature).where(and(eq(encounterCreature.encounterId, encounterId), eq(encounterCreature.status, 'active'))).all()) {
      want.set(r.entityId, (want.get(r.entityId) ?? 0) + r.count)
    }
    let list = [...st.combatants]
    const log = [...st.log]
    const ids = new Set([...want.keys(), ...list.filter((c) => c.side === 'foe' && c.entityId).map((c) => c.entityId!)])
    for (const eid of ids) {
      const mine = list.filter((c) => c.side === 'foe' && c.entityId === eid)
      const need = want.get(eid) ?? 0
      if (need > mine.length) {
        const name = this.entityRow(eid).name
        // "Bandit" becomes "Bandit 1" once a second one joins.
        if (mine.length === 1 && mine[0].name === name) list = list.map((c) => (c.id === mine[0].id ? { ...c, name: `${name} 1` } : c))
        const used = new Set(list.map((c) => c.name))
        let k = 1
        for (let n = mine.length; n < need; n++) {
          while (used.has(`${name} ${k}`)) k++
          const label = need > 1 ? `${name} ${k}` : name
          used.add(label)
          list.push(this.fightCombatant(eid, 'foe', label))
          log.push(`Round ${st.round}: ${label} joins the fight.`)
        }
      } else if (need < mine.length) {
        const unhurt = (c: Combatant) => c.hp >= c.maxHp && !c.conditions.length && !c.out
        const leave = [...mine].sort((a, b) => Number(unhurt(b)) - Number(unhurt(a)) || list.indexOf(b) - list.indexOf(a)).slice(0, mine.length - need)
        for (const c of leave) log.push(`Round ${st.round}: ${c.name} leaves the fight (taken out of the encounter).`)
        const current = list[st.turn]?.id
        list = list.filter((c) => !leave.includes(c))
        st.turn = Math.max(0, list.findIndex((c) => c.id === current))
      }
    }
    w.update('combat', row.id, { state: { ...st, combatants: list, log, turn: Math.min(st.turn, Math.max(0, list.length - 1)) } })
  },

  /** A player character joins every running fight (or the one for `encounterId`) on the party side, once. */
  joinFights(w: Writer, entityId: string, encounterId?: string): void {
    for (const row of this.db.select().from(combat).where(eq(combat.status, 'active')).all()) {
      if (encounterId && row.encounterId !== encounterId) continue
      const st = CombatState.parse(row.state)
      if (st.combatants.some((x) => x.entityId === entityId)) continue
      const c = this.fightCombatant(entityId, 'party', this.entityRow(entityId).name)
      w.update('combat', row.id, { state: { ...st, combatants: [...st.combatants, c], log: [...st.log, `Round ${st.round}: ${c.name} joins the fight.`] } })
    }
  },

  /** What the tracker knows about a card: hints, CR or level, limited abilities, defences, spell slots. */
  combatantInfo(entityId: string, partyLevel: number): CombatantInfo | null {
    const e = this.db.select().from(entity).where(eq(entity.id, entityId)).get()
    if (!e) return null
    const sb = readStatBlock(e.attributes.statblock)
    const acts = this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all()
    const texts = [...(sb?.traits ?? []).map((t) => ({ name: t.name, text: t.desc })), ...acts.map((a) => ({ name: a.name, text: a.description }))]
    const all = texts.map((t) => `${t.name}. ${t.text}`).join('\n')
    const split = texts.find((t) => /^split\b/i.test(t.name) || /\bsplits? into two\b/i.test(t.text))
    const lvl = Number.parseInt(String(e.attributes.level ?? ''), 10)
    const level = e.type === 'PC' ? (Number.isFinite(lvl) && lvl > 0 ? lvl : null) : null
    const dc = /spell save DC\s*(\d+)/i.exec(all) ?? /\bDC\s*(\d+)/.exec(all)
    return {
      creatureType: sb?.creatureType ?? '',
      leader: isLeaderName(e.name) || texts.some((t) => /\bleadership\b/i.test(t.name)),
      boosts: texts.filter((t) => boostsAllies(t.text)).map((t) => ({ name: t.name, text: t.text.length > 220 ? `${t.text.slice(0, 220)}…` : t.text })),
      legendary: acts.some((a) => a.kind === 'LEGENDARY_ACTION'),
      recharge: limitedUses(texts).filter((l) => l.kind === 'recharge').map((l) => `${l.name} (Recharge ${l.recharge})`),
      cr: e.type === 'PC' ? '' : sb?.cr ?? '',
      level: e.type === 'PC' ? level ?? partyLevel : null,
      xp: e.type === 'PC' ? 0 : xpForCr(sb?.cr ?? ''),
      pp: sb ? passiveScore(sb, 'Perception') : null,
      saveDc: dc ? Number(dc[1]) : null,
      dexMod: sb ? Math.floor((sb.dex - 10) / 2) : 0,
      resist: sb?.resistances ?? '', immune: sb?.immunities ?? '', vuln: sb?.vulnerabilities ?? '', condImmune: sb?.conditionImmunities ?? '',
      magicResist: texts.some((t) => /^magic resistance\b/i.test(t.name)),
      limited: limitedUses(texts),
      legendaryActions: legendaryCount(texts.map((t) => t.text), acts.some((a) => a.kind === 'LEGENDARY_ACTION')),
      lair: /lair action/i.test(all),
      split: split ? DAMAGE_TYPES.filter((d) => new RegExp(`\\b${d}\\b`, 'i').test(split.text)) : null,
      splitOnBloodied: !!split && /becomes bloodied/i.test(split.text),
      mirrorImage: /mirror image/i.test(all),
      displacement: texts.some((t) => /^displacement\b/i.test(t.name)),
      actions: acts.map((a) => ({ name: a.name, kind: a.kind, text: a.description.length > 300 ? `${a.description.slice(0, 300)}…` : a.description, full: a.description })),
      slots: slotState(e.attributes, all),
      spellList: spellsInText(all),
      actionGroups: e.attributes.action_groups && typeof e.attributes.action_groups === 'object' ? e.attributes.action_groups as Record<string, string> : {},
      cardType: e.type,
      size: sb?.size ?? '',
      pc: e.type !== 'PC' ? null : (() => {
        const hd = hitDice(sb?.hitDice || sb?.hp || '', classesOf(e.attributes), levelOf(e.attributes))
        return {
          inspiration: e.attributes.inspiration === true,
          exhaustion: typeof e.attributes.exhaustion === 'number' ? e.attributes.exhaustion : 0,
          uses: usesOf(e.attributes),
          hitDice: { ...hd, used: Math.min(hd.total, typeof e.attributes.hit_dice_used === 'number' ? e.attributes.hit_dice_used : 0) }
        }
      })()
    }
  },

  combatView(id: string): CombatView {
    const row = this.db.select().from(combat).where(eq(combat.id, id)).get()
    if (!row || row.status === 'defunct') throw new Error('That fight is no longer here')
    const state = CombatState.parse(row.state)
    const partyLevel = Number(this.setting('party_level') ?? 1)
    const info: Record<string, CombatantInfo> = {}
    for (const entityId of new Set(state.combatants.map((c) => c.entityId).filter((x): x is string => !!x))) {
      const i = this.combatantInfo(entityId, partyLevel)
      if (i) info[entityId] = i
    }
    // A character's hit points and death saves live on its card (Live desk, sheet and fight show the same).
    const combatants = state.combatants.map((c) => {
      const saved = c.side === 'party' && c.entityId ? this.deathSavesOf(c.entityId) : null
      return saved ? { ...c, ...this.cardHp(c.entityId!, c), death: saved } : c
    })
    return {
      id, encounterId: row.encounterId, encounterName: this.nameOf(row.encounterId), status: row.status === 'ended' ? 'ended' : 'active',
      state: { ...state, combatants }, info, sessionRunning: !!this.openSession(), spellRules: this.spellRules()
    }
  },

  /**
   * Battle planner for an encounter: from the running fight (HP, who is down or concentrating, foes still
   * standing) or, before it, from the party and the encounter's creatures. Spell slots left count.
   */
  battlePlan(encounterId: string): BattlePlan {
    const fight = this.db.select().from(combat).where(and(eq(combat.encounterId, encounterId), eq(combat.status, 'active'))).get()
    const state = fight ? CombatState.parse(fight.state) : null
    const pcs: PlanPc[] = state
      ? state.combatants.filter((c) => c.side === 'party' && c.entityId).map((c) => this.planPc(c.entityId!, c.hp, c.maxHp,
        c.out === 'down' || (c.maxHp > 0 && c.hp === 0), !!(c.rounds[String(state.round)]?.c || c.rounds[String(state.round - 1)]?.c)))
      : this.encounterView(encounterId).pcs.filter((p) => p.in).map((p) => this.planPc(p.id, p.hp, p.maxHp, p.maxHp > 0 && p.hp === 0, false))
    const counts = new Map<string, number>()
    if (state) {
      for (const c of state.combatants) if (c.side === 'foe' && c.entityId && !c.out && !(c.maxHp > 0 && c.hp === 0)) counts.set(c.entityId, (counts.get(c.entityId) ?? 0) + 1)
    } else {
      for (const cr of this.encounterView(encounterId).creatures) counts.set(cr.entityId, (counts.get(cr.entityId) ?? 0) + cr.count)
    }
    const foes = [...counts].map(([id, count]) => this.planFoe(id, count)).filter((f): f is PlanFoe => !!f)
    return battlePlan(pcs, foes)
  },

  planPc(entityId: string, hp: number, maxHp: number, down: boolean, concentrating: boolean): PlanPc {
    const e = this.entityRow(entityId)
    const sb = readStatBlock(e.attributes.statblock)
    const acts = this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all()
    const slots = slotState(e.attributes, (sb?.traits ?? []).map((t) => `${t.name} ${t.desc}`).join('\n'))
    const left = slotsLeft(slots)
    if (pactLeft(slots)) left[slots.pact.level - 1] += pactLeft(slots)
    return {
      name: e.name, ac: sb ? leadingNumber(sb.ac) : null, hp, maxHp, down, concentrating,
      slotsLeft: left,
      powers: acts.map((a) => ({
        name: a.name, level: a.kind === 'SPELL' ? spellLevel(a.description) : null, roles: spellRoles(a.name, a.description),
        save: /(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s+Saving Throw/i.exec(a.description)?.[1] ?? '',
        text: a.description.slice(0, 3000)
      }))
    }
  },

  planFoe(entityId: string, count: number): PlanFoe | null {
    const e = this.db.select().from(entity).where(eq(entity.id, entityId)).get()
    if (!e) return null
    const sb = readStatBlock(e.attributes.statblock)
    const acts = this.db.select().from(ability).where(and(eq(ability.entityId, entityId), eq(ability.status, 'active'))).all()
    const texts = [...(sb?.traits ?? []).map((t) => `${t.name}. ${t.desc}`), ...acts.map((a) => `${a.name}. ${a.description}`)]
    return {
      name: e.name, count, int: sb?.int ?? 10, cr: sb?.cr ?? '',
      ranged: texts.some((t) => /Ranged Attack Roll|ranged weapon attack|\brange \d+/i.test(t)),
      flies: /\bfly \d+/i.test(sb?.speed ?? ''),
      legendaryResist: texts.some((t) => /legendary resistance/i.test(t)),
      leader: isLeaderName(e.name) || texts.some((t) => /^leadership\b/i.test(t)),
      caster: acts.some((a) => a.kind === 'SPELL') || texts.some((t) => /^spellcasting\b|\bcasts? one of the following spells\b/i.test(t)),
      saves: Object.fromEntries(ABILITY_KEYS.map((k) => [k, sb ? saveBonus(sb, k).bonus : 0]))
    }
  },

  /** A character's hit points as its card holds them (none typed yet = full). */
  cardHp(entityId: string, c: Combatant): { hp: number; tempHp: number } {
    const a = this.entityRow(entityId).attributes
    return { hp: typeof a.current_hp === 'number' ? a.current_hp : c.maxHp, tempHp: typeof a.temp_hp === 'number' ? a.temp_hp : 0 }
  },

  deathSavesOf(entityId: string): { s: number; f: number } | null {
    const e = this.db.select().from(entity).where(eq(entity.id, entityId)).get()
    if (!e || e.type !== 'PC') return null
    const d = (e.attributes.death_saves && typeof e.attributes.death_saves === 'object' ? e.attributes.death_saves : {}) as { s?: unknown; f?: unknown }
    const n = (v: unknown) => Math.max(0, Math.min(3, Math.round(Number(v)) || 0))
    return { s: n(d.s), f: n(d.f) }
  },

  /** The DM's own spell rule fields, by lower-case spell name (campaign setting `spell_rules`). */
  spellRules(): Record<string, SpellRules> {
    const v = this.setting('spell_rules')
    const out: Record<string, SpellRules> = {}
    for (const [k, r] of Object.entries(v && typeof v === 'object' ? v : {})) { const p = SpellRules.safeParse(r); if (p.success) out[k] = p.data }
    return out
  },

  /** Keeps (or with null drops) the DM's own rule fields for a spell, for every caster in the campaign. One undo step. */
  setSpellRules(name: string, rules: SpellRules | null): void {
    const key = name.trim().toLowerCase()
    const all = { ...this.spellRules() }
    if (rules) all[key] = rules
    else delete all[key]
    this.setSetting('spell_rules', all, rules ? `Rule fields for ${name.trim()}` : `${name.trim()}: back to the SRD or its text`)
  },

  /**
   * The DM's change to the fight (damage, a condition, the next turn…): one undo step each; changed death saves go to the card.
   * `cards`: changes to cards in the same step (a cast spends a slot or a use kept on the card).
   */
  updateCombat(id: string, state: CombatState, label: string, cards: Array<{ entityId: string; attributes: Record<string, unknown> }> = []): void {
    this.log.run(label, (w) => {
      w.update('combat', id, { state })
      for (const c of cards) {
        const e = this.entityRow(c.entityId)
        w.update('entity', e.id, { attributes: { ...e.attributes, ...c.attributes } })
      }
      for (const c of state.combatants) {
        const saved = c.side === 'party' && c.entityId ? this.deathSavesOf(c.entityId) : null
        if (!saved) continue
        const was = this.cardHp(c.entityId!, c)
        if (saved.s === c.death.s && saved.f === c.death.f && was.hp === c.hp && was.tempHp === c.tempHp) continue
        const e = this.entityRow(c.entityId!)
        w.update('entity', e.id, { attributes: { ...e.attributes, current_hp: c.hp, temp_hp: c.tempHp, death_saves: c.death.s || c.death.f ? c.death : null } })
      }
    })
  },

  /** Ends the fight (one undo step): optionally marks defeated cards resolved and logs a summary in the running session. */
  endCombat(id: string, opts: { resolveIds?: string[]; summary?: string; xp?: { each: number; pcIds: string[] } } = {}): void {
    const row = this.db.select().from(combat).where(eq(combat.id, id)).get()
    if (!row) throw new Error('That fight is no longer here')
    const open = this.openSession()
    this.log.run(`Ended the fight: ${this.nameOf(row.encounterId)}`, (w) => {
      w.update('combat', id, { status: 'ended' })
      // XP shared equally (owner, 1.6.0): added to each character's running total.
      for (const pid of opts.xp && opts.xp.each > 0 ? opts.xp.pcIds : []) {
        const e = this.db.select().from(entity).where(eq(entity.id, pid)).get()
        if (e) w.update('entity', pid, { attributes: { ...e.attributes, xp: (typeof e.attributes.xp === 'number' ? e.attributes.xp : 0) + opts.xp!.each } })
      }
      for (const eid of opts.resolveIds ?? []) {
        const e = this.db.select().from(entity).where(eq(entity.id, eid)).get()
        if (e && e.status === 'active') w.update('entity', eid, { status: 'resolved' })
      }
      // One log line per fight: "Log it in the session" earlier in this session gets the summary instead of a second line.
      const logged = open ? this.db.select().from(logEntry).where(and(eq(logEntry.sessionId, open.id), eq(logEntry.encounterId, row.encounterId), eq(logEntry.kind, 'fight'), eq(logEntry.status, 'active'))).all()
        .find((l) => l.createdAt >= row.createdAt) : undefined
      if (logged && opts.summary?.trim()) w.update('log_entry', logged.id, { text: opts.summary.trim().slice(0, 5000) })
      else if (open && opts.summary?.trim()) {
        w.insert('log_entry', {
          id: randomUUID(), sessionId: open.id, atMin: this.info().clockMin, kind: 'fight', text: opts.summary.trim().slice(0, 5000),
          entityId: null, minutesTaken: 0, createdAt: new Date().toISOString(), status: 'active', encounterId: row.encounterId
        })
      }
    })
  },

  updateEncounterCreature(rowId: string, patch: { count?: number; notes?: string }): void {
    const r = this.creatureRow(rowId)
    this.log.run(`Changed ${this.nameOf(r.entityId)} in ${this.nameOf(r.encounterId)}`, (w) => {
      w.update('encounter_creature', rowId, patch.count === 0 ? { status: 'defunct' } : patch)
      this.syncFight(w, r.encounterId)
    })
  },

  setEncounterCreatureStatus(rowId: string, status: RowStatus): void {
    const r = this.creatureRow(rowId)
    this.log.run(`${status === 'defunct' ? 'Took' : 'Put'} ${this.nameOf(r.entityId)} ${status === 'defunct' ? 'out of' : 'back in'} ${this.nameOf(r.encounterId)}`, (w) => {
      w.update('encounter_creature', rowId, { status })
      this.syncFight(w, r.encounterId)
    })
  },

  /** Legacy encounters have no rows yet: turn them into rows, then act on the one for this card. */
  removeEncounterCreature(encounterId: string, entityId: string): void {
    this.log.run(`Took ${this.nameOf(entityId)} out of ${this.nameOf(encounterId)}`, (w) => {
      this.adoptLegacyCreatures(w, encounterId)
      const row = this.db.select().from(encounterCreature).where(and(eq(encounterCreature.encounterId, encounterId), eq(encounterCreature.entityId, entityId), eq(encounterCreature.status, 'active'))).get()
      if (row) w.update('encounter_creature', row.id, { status: 'defunct' })
      this.syncFight(w, encounterId)
    })
  },

  /** Logs the encounter as a fight in the running session, linked to the plan. */
  runEncounter(encounterId: string): LogView {
    const e = this.entityRow(encounterId)
    return this.addLog({ kind: 'fight', text: e.name, encounterId })
  },

  creatureRow(id: string) {
    const r = this.db.select().from(encounterCreature).where(eq(encounterCreature.id, id)).get()
    if (!r) throw new Error(`No encounter line with id ${id}`)
    return r
  },

})
