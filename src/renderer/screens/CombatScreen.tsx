import { useState } from 'react'
import { useBoard } from '../store'
import { call } from '../api'
import { DeskFrame } from '../components/DeskFrame'
import { BackButton } from '../components/BackButton'
import { useSidePanel } from '../components/Splitter'
import { changeHp, combatHints, CONDITIONS, nextTurn, previousTurn, type Combatant, type CombatState } from '../../shared/combat'
import type { AiSuggestion, CombatView } from '../../shared/types'

const SIDES: Record<Combatant['side'], string> = { party: 'Party', foe: 'Foe', ally: 'Ally' }
const OUT: Record<NonNullable<Combatant['out']>, string> = { down: 'Down', fled: 'Fled', surrendered: 'Surrendered' }

/** Run encounter: the DM orders the list; rounds, turns, hit points, conditions, morale and tactics hints. */
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
  const side = useSidePanel('combat-side', 'right', 360)
  const [advice, setAdvice] = useState<AiSuggestion | null>(null)
  const [ask, setAsk] = useState('')
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState('')
  const s = v.state
  const ended = v.status === 'ended'
  const save = (state: CombatState, label: string) => act('combat:update', { id: v.id, state, label })
  const edit = (id: string, patch: Partial<Combatant>, label: string) =>
    save({ ...s, combatants: s.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c)) }, label)
  const move = (i: number, by: number) => {
    const list = [...s.combatants]
    const [c] = list.splice(i, 1)
    list.splice(i + by, 0, c)
    // Keep the turn on the same creature.
    const current = s.combatants[s.turn]?.id
    void save({ ...s, combatants: list, turn: Math.max(0, list.findIndex((x) => x.id === current)) }, `Moved ${c.name} ${by < 0 ? 'up' : 'down'}`)
  }
  const hints = combatHints(s, v.info)
  const now = s.combatants[s.turn]

  const askAi = async () => {
    setAsking(true); setAskError('')
    try { setAdvice(await call('ai:combatAdvice', { id: v.id, ask })) } catch (err) { setAskError((err as Error).message) } finally { setAsking(false) }
  }

  return (
    <>
      <header className="combat-head">
        <BackButton />
        <div className="combat-title">
          <h1>{v.encounterName}</h1>
          <p className="combat-round">{ended ? 'Fight over' : <>Round <strong>{s.round}</strong>{now && <> · {now.name}'s turn</>}</>}</p>
        </div>
        {!ended && (
          <div className="row tight wrap">
            <button className="ink-button" onClick={() => void save(previousTurn(s), 'Back one turn')}>Previous turn</button>
            <button className="ink-button primary-ink" onClick={() => { const n = nextTurn(s); void save(n, `${n.combatants[n.turn]?.name ?? 'Next'}'s turn (round ${n.round})`) }}>Next turn</button>
            <button className="ink-button danger-ink" onClick={async () => { await act('combat:end', { id: v.id }); say('Fight over') }}>End combat</button>
          </div>
        )}
        {ended && v.sessionRunning && (
          <button className="ink-button primary-ink" onClick={async () => { if (await act('encounter:run', { encounterId: v.encounterId })) say(`Logged the fight: ${v.encounterName}`) }}>Log it in the session</button>
        )}
      </header>
      <div className="combat-layout" style={side.style}>
        <section className="parchment-sheet combat-list" aria-label="Combatants">
          <p className="hint ink-hint">Order the list as you like (↑ ↓). Double-click a name to open its stat block; Back returns here. Every change can be undone.</p>
          <datalist id="cb-conditions">{CONDITIONS.map((k) => <option key={k} value={k} />)}</datalist>
          <ol className="combatants">
            {s.combatants.map((c, i) => (
              <CombatantRow key={c.id} c={c} i={i} last={i === s.combatants.length - 1} current={!ended && i === s.turn} ended={ended}
                onMove={(by) => move(i, by)} onOpen={() => c.entityId && void openSheet(c.entityId)}
                onHp={(amount) => void save(changeHp(s, c.id, amount), `${c.name}: ${amount < 0 ? `${-amount} damage` : `healed ${amount}`}`)}
                onEdit={(patch, label) => void edit(c.id, patch, label)}
                onRemove={() => void save({ ...s, combatants: s.combatants.filter((x) => x.id !== c.id), turn: Math.min(s.turn, Math.max(0, s.combatants.length - 2)) }, `Took ${c.name} out of the list`)} />
            ))}
          </ol>
          {!ended && <AddCombatant onAdd={(c) => void save({ ...s, combatants: [...s.combatants, c], log: [...s.log, `Round ${s.round}: ${c.name} joins the fight.`] }, `${c.name} joins the fight`)} />}
        </section>
        <aside className="parchment-note combat-side">
          {side.grip}
          <h2 className="panel-title">Morale and tactics</h2>
          {hints.length === 0 ? <p className="ink-muted">Nothing to watch for yet.</p> : (
            <ul className="combat-hints">{hints.map((h, i) => <li key={i} className={`hint-${h.level}`}>{h.text}</li>)}</ul>
          )}
          <div className="field">
            <label htmlFor="combat-ask">Ask AI what the foes do now</label>
            <div className="row tight">
              <input id="combat-ask" value={ask} maxLength={1000} placeholder="Optional: would they take a hostage?" onChange={(ev) => setAsk(ev.target.value)} />
              <button className="ink-button" disabled={asking} onClick={() => void askAi()}>{asking ? 'Asking…' : 'Ask AI'}</button>
            </div>
          </div>
          {askError && <p className="field-error" role="alert">{askError}</p>}
          {advice && (
            <div className="ai-suggestion"><span className="ai-badge">AI suggestion · {advice.source}</span><p className="ai-suggestion-text">{advice.text}</p>
              <button className="ink-button" onClick={() => setAdvice(null)}>Dismiss</button></div>
          )}
          <h2 className="panel-title">What happened</h2>
          <ol className="combat-log" reversed>{[...s.log].reverse().slice(0, 40).map((l, i) => <li key={i}>{l}</li>)}</ol>
        </aside>
      </div>
    </>
  )
}

function CombatantRow({ c, i, last, current, ended, onMove, onOpen, onHp, onEdit, onRemove }: {
  c: Combatant; i: number; last: boolean; current: boolean; ended: boolean
  onMove(by: number): void; onOpen(): void; onHp(amount: number): void; onEdit(patch: Partial<Combatant>, label: string): void; onRemove(): void
}) {
  const [amount, setAmount] = useState('')
  const [cond, setCond] = useState('')
  const [rounds, setRounds] = useState('')
  const n = Math.round(Number(amount))
  const ok = amount.trim() !== '' && Number.isFinite(n) && n >= 0
  const pct = c.maxHp ? Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100)) : 0
  return (
    <li className={`combatant side-${c.side}${current ? ' is-current' : ''}${c.out ? ' is-out' : ''}`} aria-current={current ? 'true' : undefined}>
      <div className="cb-order">
        <button className="ink-button" aria-label={`Move ${c.name} up`} disabled={i === 0 || ended} onClick={() => onMove(-1)}>↑</button>
        <button className="ink-button" aria-label={`Move ${c.name} down`} disabled={last || ended} onClick={() => onMove(1)}>↓</button>
      </div>
      <div className="cb-main">
        <div className="cb-name-row">
          {current && <span className="cb-now">Now</span>}
          <span className={`cb-side cb-${c.side}`}>{SIDES[c.side]}</span>
          <strong className="cb-name" title={c.entityId ? 'Double-click: open its stat block' : undefined} onDoubleClick={onOpen}>{c.name}</strong>
          <span className="cb-ac">AC {c.ac || '?'}</span>
          {c.out && <span className="cb-out">{OUT[c.out]}</span>}
        </div>
        <div className="cb-hp-row">
          <div className="cb-hpbar" aria-hidden="true"><span style={{ width: `${pct}%` }} className={pct <= 25 ? 'low' : pct <= 50 ? 'mid' : ''} /></div>
          <span className="mono cb-hp">{c.hp}/{c.maxHp}{c.tempHp ? ` +${c.tempHp}` : ''} HP</span>
          {!ended && (
            <span className="row tight">
              <input className="short" inputMode="numeric" value={amount} aria-label={`Amount for ${c.name}`} placeholder="0" onChange={(ev) => setAmount(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === 'Enter' && ok) { onHp(-n); setAmount('') } }} />
              <button className="ink-button danger-ink" disabled={!ok} onClick={() => { onHp(-n); setAmount('') }}>Damage</button>
              <button className="ink-button" disabled={!ok} onClick={() => { onHp(n); setAmount('') }}>Heal</button>
              <button className="ink-button" disabled={!ok} title="Set the hit points to this number" onClick={() => { onEdit({ hp: n, maxHp: Math.max(c.maxHp, n) }, `${c.name}: HP set to ${n}`); setAmount('') }}>Set HP</button>
              <button className="ink-button" disabled={!ok} title="Temporary hit points" onClick={() => { onEdit({ tempHp: n }, `${c.name}: ${n} temporary HP`); setAmount('') }}>Temp</button>
            </span>
          )}
        </div>
        <div className="cb-cond-row">
          {c.conditions.map((k, j) => (
            <span key={j} className="cb-cond">{k.name}{k.rounds ? ` (${k.rounds} rd)` : ''}
              {!ended && <button className="link-button" aria-label={`Remove ${k.name} from ${c.name}`} onClick={() => onEdit({ conditions: c.conditions.filter((_, x) => x !== j) }, `${c.name} is no longer ${k.name.toLowerCase()}`)}>×</button>}
            </span>
          ))}
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
          <input className="cb-notes" defaultValue={c.notes} key={c.notes} placeholder="Notes: position, targets, spells used…" aria-label={`Notes for ${c.name}`} disabled={ended}
            onBlur={(ev) => { if (ev.target.value !== c.notes) onEdit({ notes: ev.target.value.slice(0, 2000) }, `Notes for ${c.name}`) }} />
        </div>
      </div>
    </li>
  )
}

function AddCombatant({ onAdd }: { onAdd(c: Combatant): void }) {
  const [name, setName] = useState('')
  const [sideV, setSide] = useState<Combatant['side']>('foe')
  const [hp, setHp] = useState('')
  const [ac, setAc] = useState('')
  return (
    <form className="row tight wrap cb-add" onSubmit={(ev) => {
      ev.preventDefault()
      if (!name.trim()) return
      const h = Math.max(0, Math.round(Number(hp)) || 0)
      onAdd({ id: crypto.randomUUID(), entityId: null, name: name.trim().slice(0, 200), side: sideV, hp: h, maxHp: h, tempHp: 0, ac: ac.trim().slice(0, 20), conditions: [], notes: '', out: null })
      setName(''); setHp(''); setAc('')
    }}>
      <input value={name} maxLength={200} placeholder="Someone joins: name" aria-label="Name" onChange={(ev) => setName(ev.target.value)} />
      <select value={sideV} aria-label="Side" onChange={(ev) => setSide(ev.target.value as Combatant['side'])}><option value="foe">Foe</option><option value="ally">Ally</option><option value="party">Party</option></select>
      <input className="short" inputMode="numeric" value={hp} placeholder="HP" aria-label="Hit points" onChange={(ev) => setHp(ev.target.value)} />
      <input className="short" value={ac} placeholder="AC" aria-label="Armour class" onChange={(ev) => setAc(ev.target.value)} />
      <button className="ink-button" type="submit" disabled={!name.trim()}>Add to the fight</button>
    </form>
  )
}
