import { useEffect, useMemo, useRef, useState } from 'react'
import { useBoard } from '../store'
import { call } from '../api'
import { DeskFrame } from '../components/DeskFrame'
import { BackButton } from '../components/BackButton'
import { Dialog } from '../components/Dialog'
import { useSidePanel } from '../components/Splitter'
import { isTyping } from '../components/TopBar'
import {
  ABILITIES6, changeHp, combatHints, CONDITIONS, crForXp, DAMAGE_TYPES, deathSave, EFFECT_PRESETS, EFFECT_TRIGGERS, effectLine, effectsOn,
  nextTurn, previousTurn, splitCombatant, turnTips, type Combatant, type CombatantInfo, type CombatState, type Effect
} from '../../shared/combat'
import { encounterBudget, RATING_LABELS, rateEncounter } from '../../shared/encounter'
import type { AiSuggestion, CombatView } from '../../shared/types'

const SIDES: Record<Combatant['side'], string> = { party: 'Party', foe: 'Foe', ally: 'Ally' }
const OUT: Record<NonNullable<Combatant['out']>, string> = { down: 'Down', fled: 'Fled', surrendered: 'Surrendered' }
const bloodied = (c: Combatant) => c.maxHp > 0 && c.hp > 0 && c.hp <= c.maxHp / 2

/** Run encounter: the DM orders the list; rounds, turns, hit points, conditions, effects, limited abilities, tactics. */
export function CombatScreen() {
  const combat = useBoard((s) => s.combat)
  return (
    <DeskFrame>
      <main className="desk combat-screen" aria-label="Run encounter">
        {!combat ? <p className="desk-loading">Drawing steel…</p> : <Fight v={combat} />}
      </main>
    </DeskFrame>
  )
}

function Fight({ v }: { v: CombatView }) {
  const { act, openSheet, say } = useBoard()
  const side = useSidePanel('combat-side', 'right', 380)
  const s = v.state
  const ended = v.status === 'ended'
  const now = s.combatants[s.turn]
  const [selected, setSelected] = useState<string | null>(now?.id ?? null)
  const [multi, setMulti] = useState<Set<string>>(new Set())
  const [ending, setEnding] = useState(false)
  const amountRefs = useRef(new Map<string, HTMLInputElement>())
  // The row whose turn it is becomes the selected one.
  useEffect(() => { if (now) setSelected(now.id) }, [now?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = (state: CombatState, label: string) => act('combat:update', { id: v.id, state, label })
  const edit = (id: string, patch: Partial<Combatant>, label: string) =>
    save({ ...s, combatants: s.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c)) }, label)
  const info = (c: Combatant) => (c.entityId ? v.info[c.entityId] : undefined)
  const move = (i: number, by: number) => {
    const list = [...s.combatants]
    const [c] = list.splice(i, 1)
    list.splice(i + by, 0, c)
    const current = s.combatants[s.turn]?.id
    void save({ ...s, combatants: list, turn: Math.max(0, list.findIndex((x) => x.id === current)) }, `Moved ${c.name} ${by < 0 ? 'up' : 'down'}`)
  }
  const next = () => { const n = nextTurn(s); void save(n, `${n.combatants[n.turn]?.name ?? 'Next'}'s turn (round ${n.round})`) }
  const prev = () => void save(previousTurn(s), 'Back one turn')

  // Keys: N next turn, P previous turn, a number types into the selected row's damage box.
  useEffect(() => {
    if (ended) return
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); next() }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); prev() }
      else if (/^\d$/.test(e.key) && selected) {
        const el = amountRefs.current.get(selected)
        // Focus moves during the key press, so the digit lands in the box.
        if (el) { el.focus(); el.select() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const pick = (id: string, shift: boolean) => {
    if (shift) setMulti((m) => { const n = new Set(m); if (n.has(id)) n.delete(id); else n.add(id); return n })
    else { setSelected(id); setMulti(new Set()) }
  }
  const sel = s.combatants.find((c) => c.id === selected) ?? now

  return (
    <>
      <header className="combat-head">
        <BackButton />
        <div className="combat-title">
          <h1>{v.encounterName}</h1>
          <p className="combat-round">{ended ? 'Fight over' : <>Round <strong>{s.round}</strong>{now && <> · {now.name}'s turn</>}</>}</p>
        </div>
        <button className="ink-button" title="The encounter's pictures and maps folder" onClick={() => void act('encounter:openFolder', { id: v.encounterId })}>Pictures and maps</button>
        {!ended && (
          <div className="row tight wrap">
            <button className="ink-button" title="Key: P" onClick={prev}>Previous turn</button>
            <button className="ink-button primary-ink" title="Key: N" onClick={next}>Next turn</button>
            <button className="ink-button danger-ink" onClick={() => setEnding(true)}>End combat…</button>
          </div>
        )}
        {ended && v.sessionRunning && (
          <button className="ink-button primary-ink" onClick={async () => { if (await act('encounter:run', { encounterId: v.encounterId })) say(`Logged the fight: ${v.encounterName}`) }}>Log it in the session</button>
        )}
      </header>
      <div className="combat-layout" style={side.style}>
        <section className="parchment-sheet combat-list" aria-label="Combatants">
          <Balance v={v} />
          <Effects v={v} ended={ended} save={save} />
          <p className="hint ink-hint">Click a row to see its turn on the right; Shift-click several to damage them together. Keys: N next turn, P previous, a number types damage for the selected row (Enter: damage). Every change can be undone.</p>
          {multi.size > 1 && !ended && <GroupDamage v={v} ids={[...multi]} onDone={() => setMulti(new Set())} save={save} />}
          <datalist id="cb-conditions">{CONDITIONS.map((k) => <option key={k} value={k} />)}</datalist>
          <ol className="combatants">
            {s.combatants.map((c, i) => (
              <CombatantRow key={c.id} c={c} info={info(c)} s={s} i={i} last={i === s.combatants.length - 1} current={!ended && i === s.turn} ended={ended}
                selected={sel?.id === c.id} inGroup={multi.has(c.id)} amountRef={(el) => { if (el) amountRefs.current.set(c.id, el); else amountRefs.current.delete(c.id) }}
                onPick={(shift) => pick(c.id, shift)} onMove={(by) => move(i, by)} onOpen={() => c.entityId && void openSheet(c.entityId)}
                onHp={(amount, type) => void save(changeHp(s, c.id, amount, type, v.info), `${c.name}: ${amount < 0 ? `${-amount}${type ? ` ${type}` : ''} damage` : `healed ${amount}`}`)}
                onEdit={(patch, label) => void edit(c.id, patch, label)} onState={(st, label) => void save(st, label)}
                onRemove={() => void save({ ...s, combatants: s.combatants.filter((x) => x.id !== c.id), turn: Math.min(s.turn, Math.max(0, s.combatants.length - 2)) }, `Took ${c.name} out of the list`)} />
            ))}
          </ol>
          <p className="hint ink-hint">To add creatures, add them to the encounter (Encounters screen): the fight follows it. New player characters join by themselves.</p>
        </section>
        <aside className="parchment-note combat-side">
          {side.grip}
          {sel && <TurnPanel v={v} c={sel} />}
          <Morale v={v} />
          <h2 className="panel-title">What happened</h2>
          <ol className="combat-log" reversed>{[...s.log].reverse().slice(0, 40).map((l, i) => <li key={i}>{l}</li>)}</ol>
        </aside>
      </div>
      {ending && <EndFight v={v} onClose={() => setEnding(false)} />}
    </>
  )
}

/** Encounter CR (from the foes still fighting) against the party's estimated CR, with the 2024 difficulty. */
function Balance({ v }: { v: CombatView }) {
  const s = v.state
  const foes = s.combatants.filter((c) => c.side === 'foe' && !c.out)
  const party = s.combatants.filter((c) => c.side === 'party' && !c.out)
  if (!party.length && !foes.length) return null
  const levels = party.map((c) => (c.entityId ? v.info[c.entityId]?.level : null) ?? 1)
  const avg = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : 1
  const r = rateEncounter(foes.map((c) => ({ cr: (c.entityId ? v.info[c.entityId]?.cr : '') ?? '', count: 1 })), avg, Math.max(1, party.length))
  const partyMatch = crForXp(encounterBudget(avg, Math.max(1, party.length), 'high'))
  const pct = r.budgets.high ? Math.min(100, Math.round((r.totalXp / (r.budgets.high * 1.5)) * 100)) : 0
  return (
    <div className={`cb-balance rating-${r.rating}`} role="status">
      <div className="cb-balance-nums">
        <span><b>Foes</b> ≈ CR {crForXp(r.totalXp)} <span className="ink-muted">({r.totalXp.toLocaleString()} XP, {foes.length} standing)</span></span>
        <span><b>Party</b> ≈ CR {partyMatch} <span className="ink-muted">({party.length} × level {avg})</span></span>
        <strong className="cb-rating">{RATING_LABELS[r.rating]}</strong>
      </div>
      <div className="cb-balance-bar" aria-hidden="true">
        <span className="fill" style={{ width: `${pct}%` }} />
        {(['low', 'moderate', 'high'] as const).map((k) => (
          <span key={k} className="mark" style={{ left: `${Math.min(100, (r.budgets[k] / (r.budgets.high * 1.5)) * 100)}%` }} title={`${k}: ${r.budgets[k].toLocaleString()} XP`} />
        ))}
      </div>
      <span className="ink-muted cb-balance-hint">2024 budgets for {party.length} at level {avg}: Low {r.budgets.low.toLocaleString()}, Moderate {r.budgets.moderate.toLocaleString()}, High {r.budgets.high.toLocaleString()} XP. Party CR ≈ one creature worth their High budget. Changes as foes go down.</span>
    </div>
  )
}

/** Battlefield and spell effects: everyone, or the creatures inside; counted down like conditions. */
function Effects({ v, ended, save }: { v: CombatView; ended: boolean; save(st: CombatState, label: string): unknown }) {
  const s = v.state
  const [adding, setAdding] = useState<Omit<Effect, 'id'> | null>(null)
  const blank: Omit<Effect, 'id'> = { name: '', scope: 'some', ids: [], save: null, dc: null, damage: '', onSave: '', trigger: 'start', rounds: 10, source: '', note: '' }
  const set = (patch: Partial<Omit<Effect, 'id'>>) => setAdding((a) => (a ? { ...a, ...patch } : a))
  return (
    <div className="cb-effects">
      <div className="row tight wrap">
        <h2 className="panel-title">Terrain and spell effects</h2>
        {!ended && !adding && <button className="ink-button" onClick={() => setAdding(blank)}>Add effect…</button>}
      </div>
      {s.effects.length === 0 && !adding && <p className="ink-muted">None. Add strong wind, Spike Growth, a Web…</p>}
      <ul className="cb-effect-list">
        {s.effects.map((e) => (
          <li key={e.id}>
            <span><strong>{effectLine(e)}</strong>{e.rounds ? ` · ${e.rounds} rd` : ''}{e.source ? ` · from ${e.source}` : ''}
              <span className="ink-muted"> · {e.scope === 'all' ? 'everyone' : e.ids.map((id) => s.combatants.find((c) => c.id === id)?.name).filter(Boolean).join(', ') || 'nobody yet'}</span></span>
            {!ended && <button className="link-button danger-link" onClick={() => void save({ ...s, effects: s.effects.filter((x) => x.id !== e.id), log: [...s.log, `Round ${s.round}: ${e.name} ends.`] }, `${e.name} ends`)}>End</button>}
          </li>
        ))}
      </ul>
      {adding && (
        <form className="cb-effect-form" onSubmit={(ev) => {
          ev.preventDefault()
          if (!adding.name.trim()) return
          const e: Effect = { ...adding, id: crypto.randomUUID(), name: adding.name.trim() }
          void save({ ...s, effects: [...s.effects, e], log: [...s.log, `Round ${s.round}: ${effectLine(e)}.`] }, `${e.name} in the fight`)
          setAdding(null)
        }}>
          <div className="row tight wrap">
            <select aria-label="Ready-made effect" value="" onChange={(ev) => {
              const p = EFFECT_PRESETS.find((x) => x.name === ev.target.value)
              if (p) set({ ...p, ids: adding.ids })
            }}>
              <option value="">Ready-made…</option>
              {EFFECT_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <input value={adding.name} maxLength={100} placeholder="Name" aria-label="Effect name" onChange={(ev) => set({ name: ev.target.value })} />
            <input value={adding.source} maxLength={100} placeholder="Cast by (optional)" aria-label="Cast by" onChange={(ev) => set({ source: ev.target.value })} />
          </div>
          <div className="row tight wrap">
            <select aria-label="Saving throw" value={adding.save ?? ''} onChange={(ev) => set({ save: (ev.target.value || null) as Effect['save'] })}>
              <option value="">No save</option>{ABILITIES6.map((a) => <option key={a} value={a}>{a} save</option>)}
            </select>
            <input className="short" inputMode="numeric" value={adding.dc ?? ''} placeholder="DC" aria-label="DC" onChange={(ev) => set({ dc: Number(ev.target.value) > 0 ? Math.min(40, Math.round(Number(ev.target.value))) : null })} />
            <input value={adding.damage} maxLength={100} placeholder="Damage, e.g. 2d4 piercing" aria-label="Damage" onChange={(ev) => set({ damage: ev.target.value })} />
            <input className="short-wide" value={adding.onSave} maxLength={100} placeholder="On a save: half" aria-label="On a successful save" onChange={(ev) => set({ onSave: ev.target.value })} />
          </div>
          <div className="row tight wrap">
            <select aria-label="When" value={adding.trigger} onChange={(ev) => set({ trigger: ev.target.value as Effect['trigger'] })}>
              {Object.entries(EFFECT_TRIGGERS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select>
            <input className="short" inputMode="numeric" value={adding.rounds ?? ''} placeholder="rounds" aria-label="Rounds (empty: until ended)" onChange={(ev) => set({ rounds: Number(ev.target.value) > 0 ? Math.round(Number(ev.target.value)) : null })} />
            <select aria-label="Who" value={adding.scope} onChange={(ev) => set({ scope: ev.target.value as Effect['scope'] })}>
              <option value="all">Everyone (the battlefield)</option><option value="some">Only these creatures:</option>
            </select>
          </div>
          {adding.scope === 'some' && (
            <div className="cb-effect-who">
              {s.combatants.map((c) => (
                <label key={c.id} className="field checkbox"><input type="checkbox" checked={adding.ids.includes(c.id)}
                  onChange={(ev) => set({ ids: ev.target.checked ? [...adding.ids, c.id] : adding.ids.filter((x) => x !== c.id) })} /> {c.name}</label>
              ))}
            </div>
          )}
          <input value={adding.note} maxLength={500} placeholder="What happens (restrained, prone, disadvantage…)" aria-label="Note" onChange={(ev) => set({ note: ev.target.value })} />
          <div className="row tight"><button type="button" className="ink-button" onClick={() => setAdding(null)}>Cancel</button><button type="submit" className="ink-button primary-ink" disabled={!adding.name.trim()}>Add to the fight</button></div>
        </form>
      )}
    </div>
  )
}

/** Shift-clicked rows: one amount of damage, half for those who made the save. */
function GroupDamage({ v, ids, onDone, save }: { v: CombatView; ids: string[]; onDone(): void; save(st: CombatState, label: string): unknown }) {
  const s = v.state
  const [amount, setAmount] = useState('')
  const [type, setType] = useState('')
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const n = Math.round(Number(amount))
  const apply = () => {
    let st = s
    for (const id of ids) st = changeHp(st, id, -(saved.has(id) ? Math.floor(n / 2) : n), type, v.info)
    void save(st, `${n}${type ? ` ${type}` : ''} damage to ${ids.length}`)
    onDone()
  }
  return (
    <div className="cb-group" role="group" aria-label="Damage several">
      <strong>Damage {ids.length} together</strong>
      <div className="row tight wrap">
        <input className="short" inputMode="numeric" value={amount} placeholder="0" aria-label="Damage" onChange={(e) => setAmount(e.target.value)} />
        <TypeSelect value={type} onChange={setType} />
        <button className="ink-button danger-ink" disabled={!(n > 0)} onClick={apply}>Damage</button>
        <button className="link-button" onClick={onDone}>Cancel</button>
      </div>
      <div className="row tight wrap">
        <span className="ink-muted">Made the save (half):</span>
        {ids.map((id) => {
          const c = s.combatants.find((x) => x.id === id)
          return c && <label key={id} className="field checkbox"><input type="checkbox" checked={saved.has(id)} onChange={(e) => setSaved((p) => { const x = new Set(p); if (e.target.checked) x.add(id); else x.delete(id); return x })} /> {c.name}</label>
        })}
      </div>
    </div>
  )
}

function TypeSelect({ value, onChange }: { value: string; onChange(v: string): void }) {
  return (
    <select className="cb-type" value={value} aria-label="Damage type" title="Resistance, immunity and vulnerability come from the stat block" onChange={(e) => onChange(e.target.value)}>
      <option value="">any type</option>
      {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  )
}

function CombatantRow({ c, info, s, i, last, current, ended, selected, inGroup, amountRef, onPick, onMove, onOpen, onHp, onEdit, onState, onRemove }: {
  c: Combatant; info: CombatantInfo | undefined; s: CombatState; i: number; last: boolean; current: boolean; ended: boolean; selected: boolean; inGroup: boolean
  amountRef(el: HTMLInputElement | null): void
  onPick(shift: boolean): void; onMove(by: number): void; onOpen(): void; onHp(amount: number, type: string): void
  onEdit(patch: Partial<Combatant>, label: string): void; onState(st: CombatState, label: string): void; onRemove(): void
}) {
  const [amount, setAmount] = useState('')
  const [type, setType] = useState('')
  const [cond, setCond] = useState('')
  const [rounds, setRounds] = useState('')
  const [open, setOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const n = Math.round(Number(amount))
  const ok = amount.trim() !== '' && Number.isFinite(n) && n >= 0
  const pct = c.maxHp ? Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100)) : 0
  const blood = bloodied(c)
  const rank = c.side === 'party' ? (info?.level ? `Lvl ${info.level}` : 'set level') : info?.cr ? `CR ${info.cr}` : 'CR ?'
  const fx = effectsOn(s, c.id)
  const startFx = current ? fx.filter((e) => e.trigger === 'start' || e.trigger === 'enter') : []
  const damage = () => { onHp(-n, type); setAmount('') }
  return (
    <li className={`combatant side-${c.side}${current ? ' is-current' : ''}${c.out ? ' is-out' : ''}${blood ? ' is-bloodied' : ''}${selected ? ' is-selected' : ''}${inGroup ? ' is-grouped' : ''}`}
      aria-current={current ? 'true' : undefined}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button, input, select, textarea, label, a')) onPick(e.shiftKey) }}>
      <div className="cb-order">
        <button className="ink-button" aria-label={`Move ${c.name} up`} disabled={i === 0 || ended} onClick={() => onMove(-1)}>↑</button>
        <button className="ink-button" aria-label={`Move ${c.name} down`} disabled={last || ended} onClick={() => onMove(1)}>↓</button>
      </div>
      <div className="cb-main">
        <div className="cb-name-row">
          <button className="cb-expand" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} more for ${c.name}`} onClick={() => setOpen((o) => !o)}>{open ? '▾' : '▸'}</button>
          {current && <span className="cb-now">Now</span>}
          <span className={`cb-side cb-${c.side}`}>{SIDES[c.side]}</span>
          <strong className="cb-name" title={c.entityId ? 'Double-click: open its stat block' : undefined} onDoubleClick={onOpen}>{c.name}</strong>
          {blood && <span className="cb-blood">Bloodied</span>}
          {c.mirror ? <span className="cb-tag">{c.mirror} images</span> : null}
          {c.displacement === 'on' && <span className="cb-tag">Displaced</span>}
          <span className="cb-cr" title={c.side === 'party' ? 'Level from the full sheet (else the party level)' : 'Challenge rating'}
            onClick={() => { if (c.side === 'party' && !info?.level) onOpen() }}>{rank}</span>
          <span className="cb-ac">AC {c.ac || '?'}</span>
          {c.out && <span className="cb-out">{OUT[c.out]}</span>}
        </div>
        <div className="cb-hp-row">
          <div className="cb-hpbar" aria-hidden="true"><span style={{ width: `${pct}%` }} className={pct <= 25 ? 'low' : pct <= 50 ? 'mid' : ''} /></div>
          <span className="mono cb-hp">{c.hp}/{c.maxHp}{c.tempHp ? ` +${c.tempHp}` : ''} HP</span>
          {!ended && (
            <span className="row tight">
              <input ref={amountRef} className="short" inputMode="numeric" value={amount} aria-label={`Amount for ${c.name}`} placeholder="0" onChange={(ev) => setAmount(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' && ok) { if (ev.shiftKey) { onHp(n, ''); setAmount('') } else damage() } }} />
              <TypeSelect value={type} onChange={setType} />
              <button className="ink-button danger-ink" disabled={!ok} onClick={damage}>Damage</button>
              <button className="ink-button" disabled={!ok} title="Shift+Enter" onClick={() => { onHp(n, ''); setAmount('') }}>Heal</button>
              <button className="ink-button" disabled={!ok} title="Set the hit points to this number" onClick={() => { onEdit({ hp: n, maxHp: Math.max(c.maxHp, n) }, `${c.name}: HP set to ${n}`); setAmount('') }}>Set HP</button>
              <button className="ink-button" disabled={!ok} title="Temporary hit points" onClick={() => { onEdit({ tempHp: n }, `${c.name}: ${n} temporary HP`); setAmount('') }}>Temp</button>
            </span>
          )}
        </div>
        {startFx.length > 0 && <ul className="cb-fx-now">{startFx.map((e) => <li key={e.id}>{effectLine(e)}</li>)}</ul>}
        {c.entityId && info?.pc && <PcLine entityId={c.entityId} pc={info.pc} name={c.name} />}
        {c.side === 'party' && c.hp === 0 && c.maxHp > 0 && !ended && <DeathSaves c={c} s={s} onState={onState} />}
        <div className="cb-cond-row">
          {c.conditions.map((k, j) => (
            <span key={j} className="cb-cond">{k.name}{k.rounds ? ` (${k.rounds} rd)` : ''}
              {!ended && <button className="link-button" aria-label={`Remove ${k.name} from ${c.name}`} onClick={() => onEdit({ conditions: c.conditions.filter((_, x) => x !== j) }, `${c.name} is no longer ${k.name.toLowerCase()}`)}>×</button>}
            </span>
          ))}
          {fx.map((e) => <span key={e.id} className="cb-cond cb-fx" title={effectLine(e)}>{e.name}</span>)}
          {!ended && (
            <span className="row tight">
              <input list="cb-conditions" className="cb-cond-input" value={cond} placeholder="Condition…" aria-label={`Condition for ${c.name}`} onChange={(ev) => setCond(ev.target.value)} />
              <input className="short" inputMode="numeric" value={rounds} placeholder="rounds" aria-label="Rounds (empty: until removed)" onChange={(ev) => setRounds(ev.target.value)} />
              <button className="ink-button" disabled={!cond.trim()} onClick={() => {
                const r = Math.round(Number(rounds))
                onEdit({ conditions: [...c.conditions, { name: cond.trim().slice(0, 60), rounds: rounds.trim() && r > 0 ? r : null }] }, `${c.name} is ${cond.trim().toLowerCase()}`)
                setCond(''); setRounds('')
              }}>Add</button>
              <select value={c.out ?? ''} aria-label={`${c.name} in the fight`} onChange={(ev) => {
                const out = (ev.target.value || null) as Combatant['out']
                onEdit({ out }, out ? `${c.name}: ${OUT[out].toLowerCase()}` : `${c.name} is back in the fight`)
              }}>
                <option value="">In the fight</option><option value="down">Down</option><option value="fled">Fled</option><option value="surrendered">Surrendered</option>
              </select>
              <button className="link-button danger-link" onClick={onRemove}>Remove</button>
            </span>
          )}
          <span className="cb-notes-wrap">
            <input className="cb-notes" defaultValue={c.notes} key={c.notes} placeholder="Notes: position, targets, spells used…" aria-label={`Notes for ${c.name}`} disabled={ended}
              onBlur={(ev) => { if (ev.target.value !== c.notes) onEdit({ notes: ev.target.value.slice(0, 20000) }, `Notes for ${c.name}`) }} />
            <button className="ink-button cb-notes-open" title="Open the notes in a larger window" aria-label={`Open notes for ${c.name}`} onClick={() => setNotesOpen(true)}>⤢</button>
          </span>
        </div>
        {open && <Details c={c} info={info} s={s} ended={ended} onEdit={onEdit} onState={onState} />}
      </div>
      {notesOpen && <NotesDialog c={c} ended={ended} onSave={(notes) => onEdit({ notes }, `Notes for ${c.name}`)} onClose={() => setNotesOpen(false)} />}
    </li>
  )
}

function NotesDialog({ c, ended, onSave, onClose }: { c: Combatant; ended: boolean; onSave(notes: string): void; onClose(): void }) {
  const [text, setText] = useState(c.notes)
  const close = () => { if (!ended && text !== c.notes) onSave(text.slice(0, 20000)); onClose() }
  return (
    <Dialog title={`Notes: ${c.name}`} open onClose={close} wide>
      <textarea className="cb-notes-big" value={text} rows={18} maxLength={20000} disabled={ended} aria-label={`Notes for ${c.name}`} autoFocus
        placeholder="Position, targets, plans, spells used, what it knows…" onChange={(e) => setText(e.target.value)} />
      <div className="dz-actions"><button className="primary" onClick={close}>{ended ? 'Close' : 'Save and close'}</button></div>
    </Dialog>
  )
}

/** A character's sheet tracking on its row: Heroic Inspiration, exhaustion, hit dice, limited uses (same as the full sheet). */
function PcLine({ entityId, pc, name }: { entityId: string; pc: NonNullable<CombatantInfo['pc']>; name: string }) {
  const act = useBoard((st) => st.act)
  const set = (attributes: Record<string, unknown>) => void act('entity:update', { id: entityId, patch: { attributes } })
  const hdLeft = pc.hitDice.total - pc.hitDice.used
  return (
    <div className="cb-pc">
      <button type="button" className={`cb-insp${pc.inspiration ? ' is-on' : ''}`} aria-pressed={pc.inspiration}
        title={pc.inspiration ? 'Heroic Inspiration: click when spent' : 'Click to give Heroic Inspiration'} onClick={() => set({ inspiration: !pc.inspiration })}>
        {pc.inspiration ? '★' : '☆'} Inspiration
      </button>
      <label className="cb-exh">Exhaustion
        <select aria-label={`${name} exhaustion`} value={pc.exhaustion} onChange={(ev) => set({ exhaustion: Number(ev.target.value) })}>
          {[0, 1, 2, 3, 4, 5, 6].map((k) => <option key={k} value={k}>{k || '–'}</option>)}
        </select>
        {pc.exhaustion > 0 && <span className="cb-tag" title="2024 rules">−{2 * pc.exhaustion} d20, −{5 * pc.exhaustion} ft.</span>}
      </label>
      {pc.hitDice.total > 0 && (
        <span className="cb-hd" title={pc.hitDice.dice}>Hit dice <strong>{hdLeft}/{pc.hitDice.total}</strong>
          <button type="button" className="ink-button" aria-label={`${name}: spend a hit die`} disabled={hdLeft <= 0} onClick={() => set({ hit_dice_used: pc.hitDice.used + 1 })}>−</button>
        </span>
      )}
      {pc.uses.map((u, i) => (
        <span key={i} className="cb-pips" role="group" aria-label={`${u.name} uses`} title={`Back on a ${u.reset} rest`}>
          {u.name}
          {u.max > 10 ? <span className="mono">{u.max - u.used}/{u.max}
            <button type="button" className="ink-button" aria-label={`${name}: use ${u.name}`} disabled={u.used >= u.max}
              onClick={() => set({ uses: pc.uses.map((x, j) => (j === i ? { ...x, used: x.used + 1 } : x)) })}>−</button></span>
            : Array.from({ length: u.max }, (_, k) => (
              <button key={k} type="button" className={`cb-pip${k < u.used ? ' is-used' : ''}`} aria-label={`${u.name} ${k + 1}${k < u.used ? ' used' : ''}`}
                onClick={() => set({ uses: pc.uses.map((x, j) => (j === i ? { ...x, used: k < x.used ? k : k + 1 } : x)) })} />
            ))}
        </span>
      ))}
    </div>
  )
}

function DeathSaves({ c, s, onState }: { c: Combatant; s: CombatState; onState(st: CombatState, label: string): void }) {
  const pips = (kind: 's' | 'f', label: string) => (
    <span className="cb-pips" role="group" aria-label={label}>
      {label}
      {[0, 1, 2].map((k) => (
        <button key={k} className={`cb-pip ${kind === 's' ? 'ok' : 'bad'}${c.death[kind] > k ? ' is-on' : ''}`} aria-label={`${label} ${k + 1}`}
          onClick={() => onState(deathSave(s, c.id, kind, c.death[kind] <= k), `${c.name}: death save`)} />
      ))}
    </span>
  )
  return (
    <div className="cb-death">
      <strong>Death saves</strong>{pips('s', 'Successes')}{pips('f', 'Failures')}
      {c.stable && <span className="cb-tag">Stable</span>}
      {c.death.f >= 3 && <span className="cb-out">Dead</span>}
    </div>
  )
}

/** The expanded row: numbers, round track, reactions, concentration, legendary actions, limited abilities, special abilities. */
function Details({ c, info, s, ended, onEdit, onState }: {
  c: Combatant; info: CombatantInfo | undefined; s: CombatState; ended: boolean
  onEdit(patch: Partial<Combatant>, label: string): void; onState(st: CombatState, label: string): void
}) {
  const act = useBoard((st) => st.act)
  const first = Math.max(1, s.round - 4)
  const roundsShown = Array.from({ length: Math.min(5, s.round) }, (_, k) => first + k)
  const rec = (r: number) => c.rounds[String(r)] ?? { dmg: 0, heal: 0, r: false, c: false }
  const setRec = (r: number, patch: Partial<{ r: boolean; c: boolean }>, label: string) => onEdit({ rounds: { ...c.rounds, [String(r)]: { ...rec(r), ...patch } } }, label)
  const use = (key: string, n: number, label: string) => onEdit({ used: { ...c.used, [key]: Math.max(0, n) } }, label)
  const slots = info?.slots ?? []
  const slotsUsed = info?.slotsUsed ?? []
  const setSlots = (k: number, used: number) => {
    if (!c.entityId) return
    const next = Array.from({ length: 9 }, (_, x) => (x === k ? used : slotsUsed[x] ?? 0))
    void act('entity:update', { id: c.entityId, patch: { attributes: { slots_used: next } } })
  }
  const lr = info?.limited.filter((l) => l.kind === 'legendaryResist') ?? []
  const lim = info?.limited.filter((l) => l.kind !== 'legendaryResist') ?? []
  return (
    <div className="cb-details">
      <div className="cb-circle" aria-label="Numbers">
        <span><b>HP</b> {c.hp}/{c.maxHp}</span><span><b>AC</b> {c.ac || '?'}</span>
        <span><b>DC</b> {info?.saveDc ?? '–'}</span><span><b>PP</b> {info?.pp ?? '–'}</span>
      </div>
      <table className="cb-track">
        <thead><tr><th>Round</th>{roundsShown.map((r) => <th key={r} className={r === s.round ? 'is-now' : ''}>{r}</th>)}</tr></thead>
        <tbody>
          <tr><th>Damage / heal</th>{roundsShown.map((r) => <td key={r}>{rec(r).dmg ? `−${rec(r).dmg}` : ''}{rec(r).heal ? ` +${rec(r).heal}` : ''}</td>)}</tr>
          <tr><th title="Reaction used (comes back at the start of its turn)">Reaction</th>{roundsShown.map((r) => (
            <td key={r}><input type="checkbox" checked={rec(r).r} disabled={ended} aria-label={`Reaction used in round ${r}`} onChange={(e) => setRec(r, { r: e.target.checked }, `${c.name}: reaction ${e.target.checked ? 'used' : 'back'}`)} /></td>
          ))}</tr>
          <tr><th title="Concentrating on a spell">Concentration</th>{roundsShown.map((r) => (
            <td key={r}><input type="checkbox" checked={rec(r).c} disabled={ended} aria-label={`Concentrating in round ${r}`} onChange={(e) => setRec(r, { c: e.target.checked }, `${c.name}: ${e.target.checked ? 'concentrating' : 'not concentrating'}`)} /></td>
          ))}</tr>
        </tbody>
      </table>
      <div className="cb-uses">
        {!!info?.legendaryActions && (
          <Pips label="Legendary actions" max={info.legendaryActions} used={c.legendaryUsed} disabled={ended} hint="Back at the start of its turn"
            onSet={(n) => onEdit({ legendaryUsed: n }, `${c.name}: legendary actions`)} />
        )}
        {lr.map((l) => <Pips key={l.key} label={`${l.name} (${l.max}/Day)`} max={l.max} used={c.used[l.key] ?? 0} disabled={ended} onSet={(n) => use(l.key, n, `${c.name}: ${l.name}`)} />)}
        {info?.lair && <p className="cb-small">Lair action on initiative 20 (losing ties).</p>}
        {lim.map((l) => (
          <div key={l.key} className="cb-use">
            {l.kind === 'recharge' ? (
              <label className="field checkbox"><input type="checkbox" checked={(c.used[l.key] ?? 0) > 0} disabled={ended} onChange={(e) => use(l.key, e.target.checked ? 1 : 0, `${c.name}: ${l.name} ${e.target.checked ? 'used' : 'recharged'}`)} />
                {l.name} <span className="ink-muted">({(c.used[l.key] ?? 0) > 0 ? `spent: recharges on ${l.recharge}` : 'ready'})</span></label>
            ) : <Pips label={`${l.name} (${l.max}/Day)`} max={l.max} used={c.used[l.key] ?? 0} disabled={ended} onSet={(n) => use(l.key, n, `${c.name}: ${l.name}`)} />}
            {!ended && (c.used[l.key] ?? 0) > 0 && <button className="link-button" onClick={() => use(l.key, 0, `${c.name}: ${l.name} refreshed`)}>Refresh</button>}
          </div>
        ))}
        {slots.some((m) => m > 0) && (
          <div className="cb-slots" aria-label="Spell slots">
            <span className="cb-small"><b>Spell slots</b> (kept on the card; Long rest refills)</span>
            {slots.map((m, k) => m > 0 && (
              <Pips key={k} label={`Level ${k + 1}`} max={m} used={Math.min(m, slotsUsed[k] ?? 0)} disabled={ended || !c.entityId} onSet={(n) => setSlots(k, n)} />
            ))}
          </div>
        )}
        {!ended && (Object.values(c.used).some((n) => n > 0) || c.legendaryUsed > 0) && (
          <button className="ink-button" onClick={() => onEdit({ used: {}, legendaryUsed: 0 }, `${c.name}: everything refreshed`)}>Refresh all</button>
        )}
      </div>
      {!ended && (
        <div className="cb-special">
          {info?.split && (
            <span><button className="ink-button" title={`Split: when it takes ${info.split.join(' or ')} damage with at least 10 HP (it happens by itself when you pick that damage type)`}
              onClick={() => onState(splitCombatant(s, c.id, info.size), `${c.name} splits`)}>Split</button>
              <span className="ink-muted"> on {info.split.join(' or ')} damage{info.splitOnBloodied ? ' or when Bloodied' : ''}, 10+ HP, Medium or larger: two with half each, one size smaller (happens by itself)</span></span>
          )}
          {(info?.mirrorImage || c.mirror !== null) && (
            c.mirror ? (
              <span><button className="ink-button" onClick={() => onEdit({ mirror: c.mirror! - 1 }, `${c.name}: a duplicate is destroyed`)}>Hit a duplicate</button>
                <span className="ink-muted"> {c.mirror} left, AC {10 + (info?.dexMod ?? 0)}</span>
                <button className="link-button" onClick={() => onEdit({ mirror: null }, `${c.name}: Mirror Image ends`)}>End</button></span>
            ) : <button className="ink-button" onClick={() => onEdit({ mirror: 3 }, `${c.name} casts Mirror Image`)}>Mirror Image (3 duplicates)</button>
          )}
          {(info?.displacement || c.displacement) && (
            <label className="field checkbox"><input type="checkbox" checked={c.displacement === 'on'} onChange={(e) => onEdit({ displacement: e.target.checked ? 'on' : 'off' }, `${c.name}: Displacement ${e.target.checked ? 'on' : 'off'}`)} />
              Displacement <span className="ink-muted">(off when it takes damage, back at the start of its turn)</span></label>
          )}
          {!info?.mirrorImage && c.mirror === null && <button className="link-button" title="For a creature or character that casts it" onClick={() => onEdit({ mirror: 3 }, `${c.name} casts Mirror Image`)}>Mirror Image…</button>}
        </div>
      )}
    </div>
  )
}

function Pips({ label, max, used, disabled, hint, onSet }: { label: string; max: number; used: number; disabled?: boolean; hint?: string; onSet(n: number): void }) {
  return (
    <span className="cb-pips" role="group" aria-label={`${label}: ${max - used} of ${max} left`} title={hint}>
      <span className="cb-small">{label}</span>
      {Array.from({ length: Math.min(max, 12) }, (_, k) => (
        <button key={k} className={`cb-pip${k < used ? ' is-used' : ''}`} disabled={disabled} aria-label={`${label} ${k + 1}${k < used ? ' (used)' : ''}`}
          onClick={() => onSet(k < used ? k : k + 1)} />
      ))}
      {used > 0 && !disabled && <button className="link-button" onClick={() => onSet(0)}>Refresh</button>}
    </span>
  )
}

/** The selected row's turn: tips by local rules, its attacks and spells, and Ask AI about this one. */
function TurnPanel({ v, c }: { v: CombatView; c: Combatant }) {
  const i = c.entityId ? v.info[c.entityId] : undefined
  const tips = useMemo(() => turnTips(v.state, c, i), [v.state, c, i])
  const [advice, setAdvice] = useState<AiSuggestion | null>(null)
  const [ask, setAsk] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setAdvice(null); setError('') }, [c.id])
  const askAi = async () => {
    setAsking(true); setError('')
    try { setAdvice(await call('ai:combatAdvice', { id: v.id, ask, focusId: c.id })) } catch (err) { setError((err as Error).message) } finally { setAsking(false) }
  }
  return (
    <div className="cb-turn">
      <h2 className="panel-title">{c.side === 'party' ? `${c.name}'s options` : `${c.name}: tactics`}</h2>
      {tips.length > 0 && <ul className="combat-hints">{tips.map((t, k) => <li key={k}>{t}</li>)}</ul>}
      {i && i.actions.length > 0 && (
        <details className="cb-actions" open>
          <summary>{c.side === 'party' ? 'Attacks, spells and features' : 'Attacks, spells and abilities'} ({i.actions.length})</summary>
          <ul>{i.actions.map((a, k) => <li key={k}><strong>{a.name}</strong> <span className="ink-muted">{a.kind.replace(/_/g, ' ').toLowerCase()}</span>{a.text ? `: ${a.text}` : ''}</li>)}</ul>
        </details>
      )}
      {i && !i.actions.length && <p className="ink-muted">No attacks or spells on {c.name}'s sheet yet.</p>}
      <div className="field">
        <label htmlFor="combat-ask">{c.side === 'party' ? `Ask AI: ${c.name}'s best options` : `Ask AI what ${c.name} does now`}</label>
        <div className="row tight">
          <input id="combat-ask" value={ask} maxLength={1000} placeholder="Optional: would it take a hostage?" onChange={(ev) => setAsk(ev.target.value)} />
          <button className="ink-button" disabled={asking} onClick={() => void askAi()}>{asking ? 'Asking…' : 'Ask AI'}</button>
        </div>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {advice && (
        <div className="ai-suggestion"><span className="ai-badge">AI suggestion · {advice.source}</span><p className="ai-suggestion-text">{advice.text}</p>
          <button className="ink-button" onClick={() => setAdvice(null)}>Dismiss</button></div>
      )}
    </div>
  )
}

function Morale({ v }: { v: CombatView }) {
  const hints = combatHints(v.state, v.info)
  return (
    <>
      <h2 className="panel-title">Morale (everyone)</h2>
      {hints.length === 0 ? <p className="ink-muted">Nothing to watch for yet.</p> : (
        <ul className="combat-hints">{hints.map((h, i) => <li key={i} className={`hint-${h.level}`}>{h.text}</li>)}</ul>
      )}
    </>
  )
}

/** End combat: XP for each player character, defeated cards to mark resolved, a summary for the session log. */
function EndFight({ v, onClose }: { v: CombatView; onClose(): void }) {
  const { act, say } = useBoard()
  const s = v.state
  const party = s.combatants.filter((c) => c.side === 'party')
  const beaten = s.combatants.filter((c) => c.side === 'foe' && c.out)
  const xp = beaten.reduce((n, c) => n + ((c.entityId ? v.info[c.entityId]?.xp : 0) ?? 0), 0)
  const each = party.length ? Math.floor(xp / party.length) : xp
  // Cards whose every copy is out; NPCs ticked, monster cards (often reused) not.
  const cards = [...new Set(beaten.map((c) => c.entityId).filter((x): x is string => !!x))]
    .filter((id) => s.combatants.filter((c) => c.entityId === id).every((c) => c.out))
  const [resolve, setResolve] = useState<Set<string>>(new Set(cards.filter((id) => v.info[id]?.cardType === 'NPC')))
  const [summary, setSummary] = useState(() => [
    `${v.encounterName}: ${beaten.length ? `${beaten.map((c) => `${c.name} ${c.out}`).join(', ')}.` : 'no foes defeated.'}`,
    `${s.round} round${s.round === 1 ? '' : 's'}. XP ${xp.toLocaleString()} (${each.toLocaleString()} each for ${party.length}).`,
    party.some((c) => c.maxHp) ? `Party: ${party.map((c) => `${c.name} ${c.hp}/${c.maxHp} HP`).join(', ')}.` : ''
  ].filter(Boolean).join(' '))
  const nameOf = (id: string) => s.combatants.find((c) => c.entityId === id)?.name.replace(/\s+\d+$/, '') ?? 'Card'
  return (
    <Dialog title="End combat" open onClose={onClose} wide>
      <div className="dz-form">
        <p><strong>XP earned: {xp.toLocaleString()}</strong> from {beaten.length} defeated (down, fled or surrendered) · <strong>{each.toLocaleString()} XP each</strong> for {party.length} player character{party.length === 1 ? '' : 's'}.</p>
        {cards.length > 0 && (
          <fieldset className="field">
            <legend>Mark these cards resolved (greyed on the board; undo brings them back)</legend>
            {cards.map((id) => (
              <label key={id} className="field checkbox"><input type="checkbox" checked={resolve.has(id)} onChange={(e) => setResolve((p) => { const n = new Set(p); if (e.target.checked) n.add(id); else n.delete(id); return n })} />
                {nameOf(id)} <span className="ink-muted">({v.info[id]?.cardType === 'NPC' ? 'NPC' : 'monster card: other encounters may use it'})</span></label>
            ))}
          </fieldset>
        )}
        <div className="field">
          <label htmlFor="end-summary">{v.sessionRunning ? 'Summary for the session log' : 'Summary (start a session on the Live desk to log it)'}</label>
          <textarea id="end-summary" rows={4} value={summary} maxLength={5000} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <div className="dz-actions">
          <button onClick={onClose}>Keep fighting</button>
          <button className="primary" onClick={async () => {
            await act('combat:end', { id: v.id, resolveIds: [...resolve], summary: v.sessionRunning ? summary : undefined })
            say(`Fight over${v.sessionRunning ? ': logged in the session' : ''}. Ctrl+Z undoes it.`)
            onClose()
          }}>End combat</button>
        </div>
      </div>
    </Dialog>
  )
}
