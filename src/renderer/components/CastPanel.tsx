import { useEffect, useMemo, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import { ABILITIES6, CONDITIONS, DAMAGE_TYPES, effectsOn, type Combatant, type CombatantInfo } from '../../shared/combat'
import { pactLeft, slotsLeft, spendSlot, type SlotState } from '../../shared/slots'
import {
  applyCast, castNumbers, checkCaster, checkTarget, CREATURE_TYPES, manualChecks, reactionOptions, SIZES, SOURCE_LABEL, spellRulesFor, useReaction,
  type CheckLine, type Outcome, type RulesSource, type SpellRules
} from '../../shared/spellcast'
import type { SrdSpell } from '../../shared/attacks'
import type { CombatView } from '../../shared/types'

// Cast a spell (owner, 3.5.0): pick the spell, the slot and the targets; red, yellow and green checks per
// target; type the rolls made in Roll20 (attack or save totals, one damage total); reactions that may
// answer it. Cast spends the slot on the card and changes the fight in one undo step. Red never blocks.

let srdCache: SrdSpell[] | null = null
/** SRD 5.2 spells, read once (they ship with the app). */
export function useSrdSpells(): SrdSpell[] {
  const [list, setList] = useState<SrdSpell[]>(srdCache ?? [])
  useEffect(() => {
    if (srdCache) return
    void call('srd:attacks', undefined).then((a) => { srdCache = a.spells; setList(a.spells) })
  }, [])
  return list
}

const ABILITY_NAME: Record<string, string> = { STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution', INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma' }

/** One line about a spell's rule fields, for the panel. */
export function rulesLine(r: SpellRules): string {
  return [
    r.level ? `Level ${r.level}` : 'Cantrip', { action: 'Action', bonus: 'Bonus Action', reaction: 'Reaction', other: 'Longer' }[r.time],
    r.attack && `${r.attack} spell attack`, r.save && `${ABILITY_NAME[r.save]} save${r.halfOnSave ? ' (half on a success)' : ''}`,
    r.heal ? 'healing' : r.damage.length ? `${r.damage.join(' or ')} damage` : '', r.conditions.length ? r.conditions.join(', ') : '',
    r.types.length ? `only ${r.types.join(' or ')}` : '', r.notTypes.length ? `not ${r.notTypes.join(' or ')}` : '',
    r.maxSize && `${r.maxSize} or smaller${r.sizeAll ? '' : ' (part)'}`, [r.verbal && 'V', r.somatic && 'S', r.material && 'M'].filter(Boolean).join(', '),
    r.concentration ? 'Concentration' : '', r.noReactions ? 'no reactions after a hit' : ''
  ].filter(Boolean).join(' · ')
}

interface Choice { name: string; text: string; useKey: string | null }

/** Spells on the caster's sheet and those its Spellcasting text lists. */
function spellChoices(i: CombatantInfo | undefined, srd: SrdSpell[]): Choice[] {
  if (!i) return []
  const out: Choice[] = i.actions.filter((a) => a.kind === 'SPELL').map((a) => ({ name: a.name, text: a.full ?? a.text, useKey: null }))
  for (const s of i.spellList ?? []) {
    if (out.some((c) => c.name.toLowerCase() === s.name.toLowerCase())) continue
    out.push({ name: s.name, text: srd.find((x) => x.name.toLowerCase() === s.name.toLowerCase())?.desc ?? '', useKey: s.useKey })
  }
  return out
}

/** Slot choices for a spell of this level: levels with slots, Pact Magic, or none (a creature without slots). */
function slotChoices(st: SlotState, level: number): Array<{ key: string; label: string; level: number; pact: boolean; left: number }> {
  const left = slotsLeft(st)
  const out = left.map((n, k) => ({ key: `s${k + 1}`, label: `Level ${k + 1} slot (${n} left)`, level: k + 1, pact: false, left: n }))
    .filter((x) => x.level >= level && (x.left > 0 || st.max[x.level - 1] + st.bonus[x.level - 1] > 0))
  if (st.pact.count && st.pact.level >= level) out.push({ key: 'pact', label: `Pact slot, level ${st.pact.level} (${pactLeft(st)} left)`, level: st.pact.level, pact: true, left: pactLeft(st) })
  return out
}

const Lines = ({ lines }: { lines: CheckLine[] }) => (
  <ul className="cast-lines">{lines.map((l, k) => <li key={k} className={`cast-${l.level}`}>{l.text}</li>)}</ul>
)

export function CastDialog({ v, caster, onClose }: { v: CombatView; caster: Combatant; onClose(): void }) {
  const { act, say } = useBoard()
  const s = v.state
  const srd = useSrdSpells()
  const info = (c: Combatant) => (c.entityId ? v.info[c.entityId] : undefined)
  const ci = info(caster)
  const choices = useMemo(() => spellChoices(ci, srd), [ci, srd])
  const [spellName, setSpellName] = useState('')
  const choice = choices.find((c) => c.name === spellName) ?? choices[0]
  const rulesOf = (name: string, text: string) => spellRulesFor(name, text, v.spellRules, srd).rules
  const found = choice ? spellRulesFor(choice.name, choice.text, v.spellRules, srd) : null
  const r = found?.rules
  const [slotKey, setSlotKey] = useState('')
  const [targets, setTargets] = useState<string[]>([])
  const [rolls, setRolls] = useState<Record<string, string>>({})
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({})
  const [conds, setConds] = useState<Record<string, string[]>>({})
  const [amount, setAmount] = useState('')
  const [dtype, setDtype] = useState('')
  const [editing, setEditing] = useState(false)
  useEffect(() => { setSlotKey(''); setOutcomes({}); setRolls({}); setConds({}); setDtype('') }, [choice?.name])

  if (!choices.length) {
    return (
      <Dialog title={`${caster.name} casts a spell`} open onClose={onClose}>
        <p>No spells on {caster.name}'s sheet or in its Spellcasting text. Add spells on its sheet (Spells tab).</p>
        <div className="dz-actions"><button className="primary" onClick={onClose}>Close</button></div>
      </Dialog>
    )
  }
  if (!choice || !r || !found) return null

  // How it is paid for: a slot (level 1+), a use per day (stat block), or nothing (cantrip, at will, no slots).
  const st = ci?.slots
  const slots = r.level > 0 && !choice.useKey && st ? slotChoices(st, r.level) : []
  const slot = slots.find((x) => x.key === slotKey) ?? slots.find((x) => x.left > 0) ?? slots[0]
  const limited = choice.useKey ? ci?.limited.find((l) => l.key === choice.useKey) : undefined
  const usesLeft = limited ? limited.max - (caster.used[limited.key] ?? 0) : null
  const usesSlot = !!slot
  const how = choice.useKey ? `${limited?.max ?? ''}/Day`.replace(/^\//, '') : slot ? (slot.pact ? `Pact slot, level ${slot.level}` : `level ${slot.level} slot`) : r.level ? `level ${r.level}` : 'cantrip'
  const slotOk = slot ? slot.left > 0 : usesLeft === null || usesLeft > 0
  const yourTurn = s.combatants[s.turn]?.id === caster.id
  const casterLines = checkCaster(r, {
    name: caster.name, conditions: caster.conditions.map((k) => k.name), effects: effectsOn(s, caster.id).map((e) => e.name), slotOk,
    turn: yourTurn && caster.cast?.round === s.round ? caster.cast : null, concentrating: caster.conc
  }, usesSlot)
  const nums = castNumbers(choice.text, ci?.saveDc ?? null)
  const numbersFor = (t: Combatant) => (r.attack ? `Spell attack ${nums.attack !== null ? (nums.attack >= 0 ? `+${nums.attack}` : nums.attack) : '(bonus not known)'} against AC ${t.ac || '?'}.`
    : r.save ? `${ABILITY_NAME[r.save]} save against DC ${nums.dc ?? '?'}.` : r.heal ? 'Heals.' : 'No roll: it just happens.')
  const targetLines = (t: Combatant): CheckLine[] => {
    const ti = info(t)
    const lr = ti?.limited.filter((l) => l.kind === 'legendaryResist') ?? []
    return checkTarget(r, {
      name: t.name, creatureType: ti?.creatureType ?? '', size: ti?.size ?? '', resist: ti?.resist ?? '', immune: ti?.immune ?? '', vuln: ti?.vuln ?? '',
      condImmune: ti?.condImmune ?? '', conditions: t.conditions.map((k) => k.name), magicResist: !!ti?.magicResist,
      legendaryLeft: lr.reduce((n, l) => n + l.max - (t.used[l.key] ?? 0), 0)
    }, numbersFor(t))
  }
  const picked = s.combatants.filter((c) => targets.includes(c.id))
  const outcomeOf = (t: Combatant): Outcome | undefined => {
    if (!r.attack && !r.save) return 'auto'
    if (outcomes[t.id]) return outcomes[t.id]
    const n = Number.parseInt(rolls[t.id] ?? '', 10)
    if (!Number.isFinite(n)) return undefined
    if (r.attack) return n >= (Number.parseInt(t.ac, 10) || 99) ? 'hit' : 'miss'
    return nums.dc !== null ? (n >= nums.dc ? 'saved' : 'failed') : undefined
  }
  const condsOf = (t: Combatant) => conds[t.id] ?? r.conditions
  const reds = [...casterLines, ...picked.flatMap((t) => targetLines(t).map((l) => ({ ...l, text: `${t.name}: ${l.text}` })))].filter((l) => l.level === 'red')
  const missing = picked.filter((t) => !outcomeOf(t))
  const n = Math.max(0, Number.parseInt(amount, 10) || 0)
  const damageType = dtype || r.damage[0] || ''

  const cast = async () => {
    let next = applyCast(s, {
      casterId: caster.id, spell: choice.name, rules: r, how, usesSlot,
      targets: picked.map((t) => ({ id: t.id, outcome: outcomeOf(t)!, conditions: condsOf(t) })), amount: n, damageType, overrides: reds.map((l) => l.text)
    }, v.info)
    if (limited) next = { ...next, combatants: next.combatants.map((c) => (c.id === caster.id ? { ...c, used: { ...c.used, [limited.key]: (c.used[limited.key] ?? 0) + 1 } } : c)) }
    const pay = slot && st && caster.entityId ? spendSlot(st, slot.level, slot.pact) : null
    // act shows its own error; a void channel gives nothing back either way.
    await act('combat:update', { id: v.id, state: next, label: `${caster.name} casts ${choice.name}`, cards: pay && caster.entityId ? [{ entityId: caster.entityId, attributes: pay }] : undefined })
    say(`${caster.name} cast ${choice.name}. Ctrl+Z undoes it.`)
    onClose()
  }
  const react = async (t: Combatant, name: string, level: number | null) => {
    const ti = info(t)
    let pay: Record<string, unknown> | null = null
    if (level && ti) {
      const left = slotsLeft(ti.slots)
      const k = left.findIndex((x, j) => j + 1 >= level && x > 0)
      pay = k >= 0 ? spendSlot(ti.slots, k + 1) : spendSlot(ti.slots, ti.slots.pact.level, true)
    }
    await act('combat:update', { id: v.id, state: useReaction(s, t.id, name), label: `${t.name} uses ${name}`, cards: pay && t.entityId ? [{ entityId: t.entityId, attributes: pay }] : undefined })
  }

  return (
    <Dialog title={`${caster.name} casts a spell`} open onClose={onClose} wide>
      <div className="dz-form cast-form">
        <div className="row tight wrap">
          <div className="field">
            <label htmlFor="cast-spell">Spell</label>
            <select id="cast-spell" value={choice.name} onChange={(e) => setSpellName(e.target.value)}>
              {choices.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </div>
          {slots.length > 0 && (
            <div className="field">
              <label htmlFor="cast-slot">Slot</label>
              <select id="cast-slot" value={slot?.key ?? ''} onChange={(e) => setSlotKey(e.target.value)}>
                {slots.map((x) => <option key={x.key} value={x.key} disabled={x.left <= 0}>{x.label}</option>)}
              </select>
            </div>
          )}
          {limited && <span className="cb-small">{usesLeft} of {limited.max} uses left today</span>}
        </div>
        <p className="cb-small"><b>{choice.name}</b>: {rulesLine(r)} <span className="ink-muted">({SOURCE_LABEL[found.source]})</span>{' '}
          <button type="button" className="link-button" onClick={() => setEditing(true)}>Rule fields…</button></p>
        {casterLines.length > 0 && <Lines lines={casterLines} />}
        <fieldset className="field">
          <legend>Targets</legend>
          <div className="cast-targets">
            {s.combatants.filter((c) => !c.out || targets.includes(c.id)).map((t) => {
              const on = targets.includes(t.id)
              const out = outcomeOf(t)
              const reacts = on ? reactionOptions(s, t, info(t), r, rulesOf) : []
              return (
                <div key={t.id} className={`cast-target${on ? ' is-on' : ''}`}>
                  <label className="field checkbox"><input type="checkbox" checked={on} onChange={(e) => setTargets((p) => (e.target.checked ? [...p, t.id] : p.filter((x) => x !== t.id)))} />
                    <strong>{t.name}</strong> <span className="ink-muted">AC {t.ac || '?'} · {t.hp}/{t.maxHp} HP{info(t)?.size ? ` · ${info(t)!.size}` : ''}{info(t)?.creatureType ? ` ${info(t)!.creatureType}` : ''}</span></label>
                  {on && (
                    <>
                      <Lines lines={targetLines(t)} />
                      {(r.attack || r.save) && (
                        <div className="row tight wrap">
                          <input className="short" inputMode="numeric" aria-label={`${r.attack ? 'Attack roll' : 'Saving throw'} total for ${t.name}`} placeholder={r.attack ? 'attack' : 'save'}
                            value={rolls[t.id] ?? ''} onChange={(e) => { setRolls((p) => ({ ...p, [t.id]: e.target.value })); setOutcomes((p) => { const q = { ...p }; delete q[t.id]; return q }) }} />
                          {(r.attack ? (['hit', 'miss'] as const) : (['failed', 'saved'] as const)).map((o) => (
                            <button key={o} type="button" className={`ink-button${out === o ? ' primary-ink' : ''}`} aria-pressed={out === o} onClick={() => setOutcomes((p) => ({ ...p, [t.id]: o }))}>
                              {{ hit: 'Hit', miss: 'Miss', failed: 'Failed', saved: 'Saved', auto: '' }[o]}</button>
                          ))}
                        </div>
                      )}
                      {r.conditions.length > 0 && (
                        <div className="row tight wrap">
                          {r.conditions.map((k) => (
                            <label key={k} className="field checkbox cb-small"><input type="checkbox" checked={condsOf(t).includes(k)}
                              onChange={(e) => setConds((p) => ({ ...p, [t.id]: e.target.checked ? [...condsOf(t), k] : condsOf(t).filter((x) => x !== k) }))} />
                              {k}{r.rounds ? ` (${r.rounds} rd)` : ''}</label>
                          ))}
                          <span className="cb-small ink-muted">on a {r.attack ? 'hit' : 'failed save'}</span>
                        </div>
                      )}
                      {reacts.map((o) => (
                        <div key={o.name} className="cast-reaction">
                          <span><b>Reaction: {o.name}</b>{o.level ? ` (level ${o.level} spell)` : ''} <span className="ink-muted">{o.text}</span></span>
                          {o.why && <span className={o.ready ? 'cb-small ink-muted' : 'cast-red cb-small'}>{o.why}</span>}
                          <button type="button" className="ink-button" disabled={!o.ready && !o.why.startsWith('Check')} onClick={() => void react(t, o.name, o.level)}>Use reaction</button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </fieldset>
        {(r.damage.length > 0 || r.heal) && (
          <div className="row tight wrap">
            <div className="field">
              <label htmlFor="cast-amount">{r.heal ? 'Healing rolled' : 'Damage rolled'} (the same for every target{r.halfOnSave ? '; half on a save' : ''})</label>
              <input id="cast-amount" className="short" inputMode="numeric" value={amount} placeholder="0" onChange={(e) => setAmount(e.target.value)} />
            </div>
            {!r.heal && r.damage.length > 1 && (
              <div className="field">
                <label htmlFor="cast-type">Type</label>
                <select id="cast-type" value={damageType} onChange={(e) => setDtype(e.target.value)}>{r.damage.map((d) => <option key={d} value={d}>{d}</option>)}</select>
              </div>
            )}
          </div>
        )}
        <ul className="cast-lines">{manualChecks(found.source, picked.every((t) => !!info(t)?.creatureType)).map((t, k) => <li key={k} className="cast-note">{t}</li>)}</ul>
        {missing.length > 0 && <p className="cb-small">Pick {r.attack ? 'Hit or Miss' : 'Failed or Saved'} (or type the roll) for {missing.map((t) => t.name).join(', ')}.</p>}
        <div className="dz-actions">
          <button onClick={onClose}>Cancel</button>
          <button className={reds.length ? 'danger' : 'primary'} disabled={missing.length > 0}
            title={reds.length ? `Will not work: ${reds.map((l) => l.text).join(' ')} You can cast anyway (the log says so).` : undefined}
            onClick={() => void cast()}>{reds.length ? 'Cast anyway' : 'Cast'}</button>
        </div>
      </div>
      {editing && <SpellRulesEditor name={choice.name} description={choice.text} rules={r} source={found.source} onClose={() => setEditing(false)} />}
    </Dialog>
  )
}

/** Rule fields for one spell (kept per campaign by name), back to the SRD or its text, or filled by the AI (a suggestion to keep). */
export function SpellRulesEditor({ name, description, rules, source, onClose }: { name: string; description: string; rules: SpellRules; source: RulesSource; onClose(): void }) {
  const act = useBoard((st) => st.act)
  const [r, setR] = useState<SpellRules>(rules)
  const [ai, setAi] = useState<{ rules: SpellRules; source: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch: Partial<SpellRules>) => setR((p) => ({ ...p, ...patch }))
  const list = (k: 'damage' | 'conditions' | 'types' | 'notTypes', options: readonly string[], label: string) => (
    <fieldset className="field cast-list">
      <legend>{label}</legend>
      {options.map((o) => (
        <label key={o} className="field checkbox cb-small"><input type="checkbox" checked={r[k].includes(o)} onChange={(e) => set({ [k]: e.target.checked ? [...r[k], o] : r[k].filter((x) => x !== o) })} />{o}</label>
      ))}
    </fieldset>
  )
  const flag = (k: 'halfOnSave' | 'heal' | 'sizeAll' | 'verbal' | 'somatic' | 'material' | 'concentration' | 'noReactions', label: string) => (
    <label className="field checkbox"><input type="checkbox" checked={r[k]} onChange={(e) => set({ [k]: e.target.checked })} />{label}</label>
  )
  const save = async (rules: SpellRules | null) => { await act('spells:setRules', { name, rules }); onClose() }
  const askAi = async () => {
    setBusy(true); setError('')
    try { setAi(await call('ai:spellRules', { name, description })) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <Dialog title={`Rule fields: ${name}`} open onClose={onClose} wide busy={busy}>
      <div className="dz-form">
        <p className="hint">What the checks know about this spell, for every caster in this campaign. Now: {SOURCE_LABEL[source]}.</p>
        <div className="row tight wrap">
          <div className="field"><label htmlFor="sr-level">Level</label>
            <select id="sr-level" value={r.level} onChange={(e) => set({ level: Number(e.target.value) })}>{Array.from({ length: 10 }, (_, k) => <option key={k} value={k}>{k || 'Cantrip'}</option>)}</select></div>
          <div className="field"><label htmlFor="sr-time">Casting time</label>
            <select id="sr-time" value={r.time} onChange={(e) => set({ time: e.target.value as SpellRules['time'] })}>
              <option value="action">Action</option><option value="bonus">Bonus Action</option><option value="reaction">Reaction</option><option value="other">Longer</option></select></div>
          <div className="field"><label htmlFor="sr-attack">Spell attack</label>
            <select id="sr-attack" value={r.attack} onChange={(e) => set({ attack: e.target.value as SpellRules['attack'] })}>
              <option value="">None</option><option value="melee">Melee</option><option value="ranged">Ranged</option></select></div>
          <div className="field"><label htmlFor="sr-save">Saving throw</label>
            <select id="sr-save" value={r.save} onChange={(e) => set({ save: e.target.value as SpellRules['save'] })}>
              <option value="">None</option>{ABILITIES6.map((a) => <option key={a} value={a}>{ABILITY_NAME[a]}</option>)}</select></div>
          <div className="field"><label htmlFor="sr-size">Largest size</label>
            <select id="sr-size" value={r.maxSize} onChange={(e) => set({ maxSize: e.target.value as SpellRules['maxSize'] })}>
              <option value="">Any</option>{SIZES.slice(0, 5).map((z) => <option key={z} value={z}>{z} or smaller</option>)}</select></div>
          <div className="field"><label htmlFor="sr-rounds">Conditions last (rounds)</label>
            <input id="sr-rounds" className="short" inputMode="numeric" value={r.rounds ?? ''} placeholder="until removed"
              onChange={(e) => { const x = Math.round(Number(e.target.value)); set({ rounds: e.target.value.trim() && x > 0 ? Math.min(100000, x) : null }) }} /></div>
        </div>
        <div className="row tight wrap">
          {flag('halfOnSave', 'Half damage on a save')}{flag('heal', 'Heals')}{flag('concentration', 'Concentration')}
          {flag('verbal', 'Verbal')}{flag('somatic', 'Somatic')}{flag('material', 'Material')}
          {flag('sizeAll', 'Too big: no effect at all (else only part, e.g. a push)')}{flag('noReactions', 'A hit stops its reactions')}
        </div>
        {list('damage', DAMAGE_TYPES, 'Damage types')}
        {list('conditions', CONDITIONS.filter((c) => !['Concentrating', 'Bloodied'].includes(c)), 'Conditions it gives')}
        {list('types', CREATURE_TYPES, 'Only these creature types (none ticked: any)')}
        {list('notTypes', CREATURE_TYPES, 'No effect on these creature types')}
        {r.time === 'reaction' && (
          <div className="field"><label htmlFor="sr-trigger">When it is cast (reaction)</label>
            <input id="sr-trigger" value={r.trigger} maxLength={300} onChange={(e) => set({ trigger: e.target.value })} /></div>
        )}
        {ai && (
          <div className="ai-suggestion">
            <span className="ai-badge">AI suggestion · {ai.source}</span>
            <p className="cb-small">{rulesLine(ai.rules)}</p>
            <div className="row tight"><button className="ink-button" onClick={() => { setR(ai.rules); setAi(null) }}>Keep (into the fields)</button>
              <button className="ink-button" onClick={() => setAi(null)}>Discard</button></div>
          </div>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="dz-actions">
          <button onClick={() => void askAi()} disabled={busy}>{busy ? 'Asking…' : 'Fill rule fields with AI'}</button>
          {source === 'yours' && <button onClick={() => void save(null)}>Back to the SRD or its text</button>}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => void save(r)}>Save</button>
        </div>
      </div>
    </Dialog>
  )
}
