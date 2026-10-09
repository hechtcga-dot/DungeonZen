import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useBoard } from '../store'
import { call } from '../api'
import { DeskFrame } from '../components/DeskFrame'
import { CommitField } from '../components/fields'
import { Roll20Dialog } from '../components/Roll20Dialog'
import { ExportDialog } from '../components/ExportDialog'
import { Candle } from '../art/props'
import { useLightingPref } from '../art/TableLighting'
import { lightingAt } from '../../shared/sky'
import { formatClock } from '../../shared/time'
import { RATING_LABELS } from '../../shared/encounter'
import type { AiSuggestion, EncountersView, EncounterView, SrdSearch } from '../../shared/types'
import { useSidePanel } from '../components/Splitter'
import { SrdBrowser } from '../components/SrdBrowser'
import { StatBlockView } from '../components/FightSummary'
import type { IpcOutputs } from '../../shared/ipc'

type Suggestion = NonNullable<Awaited<ReturnType<typeof call<'encounter:suggest'>>>>
const FEEL: Record<string, string> = { too_easy: 'too easy', about_right: 'about right', hard: 'hard', nearly_deadly: 'nearly deadly' }

/** DM Prep › Encounters: plan fights per place, rated with the 2024 rules and adapted to the party. */
export function EncountersScreen() {
  const left = useSidePanel('enc-list', 'left', 240)
  const side = useSidePanel('enc-side', 'right', 300)
  const { encounters, encounterId, openEncounter, act, info } = useBoard()
  const [lighting] = useLightingPref()
  const v = encounters
  const current = v?.encounters.find((e) => e.id === encounterId) ?? v?.encounters[0] ?? null
  const create = async () => {
    const id = await act('encounter:create', { name: `Encounter ${(v?.encounters.length ?? 0) + 1}` })
    if (id) openEncounter(id)
  }
  return (
    <DeskFrame>
      <main className="desk encounters-screen" aria-label="Encounters">
        <header className="desk-head">
          <Candle className="desk-candle" lit={!lighting || lightingAt(info?.clockMin ?? 0).candlesLit} />
          <div className="desk-title">
            <span className="desk-eyebrow">DM prep · {v ? `${v.party.size} characters of level ${v.party.level}` : ''}</span>
            <h1>Encounters</h1>
          </div>
          <div className="desk-head-actions">
            <button className="wax" onClick={() => void create()}>New encounter</button>
          </div>
        </header>
        {!v ? <p className="desk-loading">Sharpening blades…</p> : (
          <div className="enc-layout" style={{ ...left.style, ...side.style }}>
            <nav className="parchment-note enc-list" aria-label="Planned encounters">
              {left.grip}
              <h2 className="panel-title">Planned</h2>
              {v.encounters.length === 0 ? <p className="ink-muted">None yet. Plan one here, or from a region on the map.</p> : (
                groupByPlace(v).map(([place, list]) => (
                  <div key={place}>
                    <h3 className="side-h">{place}</h3>
                    <ul className="enc-items">
                      {list.map((e) => (
                        <li key={e.id}>
                          <button className="enc-item" aria-current={current?.id === e.id ? 'true' : undefined} onClick={() => openEncounter(e.id)}>
                            <span>{e.name}</span>
                            <span className={`rating-chip r-${e.difficulty.rating}`}>{RATING_LABELS[e.difficulty.rating]}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </nav>
            {current ? <Editor key={current.id} e={current} v={v} /> : <div className="parchment-sheet enc-editor"><p className="ink-muted">Choose or plan an encounter.</p></div>}
            <PartyPanel v={v} grip={side.grip} />
          </div>
        )}
      </main>
    </DeskFrame>
  )
}

function groupByPlace(v: EncountersView): Array<[string, EncounterView[]]> {
  const groups = new Map<string, EncounterView[]>()
  for (const e of v.encounters) {
    const k = e.locationName ?? 'No place yet'
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  return [...groups.entries()].sort(([a], [b]) => (a === 'No place yet' ? 1 : b === 'No place yet' ? -1 : a.localeCompare(b)))
}

function Editor({ e, v }: { e: EncounterView; v: EncountersView }) {
  const { act, openSheet, openCombat, say, setBattleMapOpen, setAiSettingsOpen } = useBoard()
  const up = (patch: Parameters<typeof call<'encounter:update'>>[1]['patch']) => void act('encounter:update', { id: e.id, patch })
  const [pick, setPick] = useState('')
  const [pickCount, setPickCount] = useState(1)
  const [rating, setRating] = useState<AiSuggestion | null>(null)
  const [ratingBusy, setRatingBusy] = useState(false)
  const [ratingError, setRatingError] = useState<string | null>(null)
  const [roll20, setRoll20] = useState(false)
  const [pdf, setPdf] = useState(false)
  const d = e.difficulty
  // The scale stops at 1.5 × the high budget so the marks stay readable; more than that fills the bar.
  const max = Math.max(d.budgets.high * 1.5, 1)
  const pct = (x: number) => `${Math.min(100, (x / max) * 100)}%`
  const targetBudget = d.budgets[e.target]

  const rate = async () => {
    setRatingBusy(true); setRatingError(null)
    try { setRating(await call('ai:rateEncounter', { encounterId: e.id })) } catch (err) { setRatingError((err as Error).message) }
    setRatingBusy(false)
  }

  return (
    <section className="parchment-sheet enc-editor" aria-label={`Encounter ${e.name}`}>
      <div className="enc-fields">
        <CommitField id="enc-name" label="Name" value={e.name} required onCommit={(name) => up({ name })} />
        <div className="field">
          <label htmlFor="enc-where">Where</label>
          <select id="enc-where" value={e.locationId ?? ''} onChange={(ev) => up({ locationId: ev.target.value || null })}>
            <option value="">No place yet</option>
            {v.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="enc-target">Aiming for</label>
          <select id="enc-target" value={e.target} onChange={(ev) => up({ target: ev.target.value as 'low' | 'moderate' | 'high' })}>
            <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option>
          </select>
        </div>
        <div className="field enc-map-field">
          <label htmlFor="enc-map">Battle map</label>
          <div className="row tight">
            <select id="enc-map" value={e.battleMapId ?? ''} onChange={(ev) => up({ battleMapId: ev.target.value || null })}>
              <option value="">None</option>
              {v.battleMaps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <button className="ink-button" onClick={() => setBattleMapOpen(true)}>Draw…</button>
            <button className="ink-button" title="Use a battle map picture you already have" onClick={async () => {
              const m = await act('battlemap:importDialog', { cols: 20 })
              if (m) { up({ battleMapId: m.id }); say(`Imported ${m.name} with a 20-square grid (change it on the Map under Scale and grid).`) }
            }}>Import…</button>
          </div>
        </div>
      </div>

      <CommitField id="enc-scene" label="Scene" multiline rows={3} value={e.scene}
        placeholder="A collapsed watchtower in the rain; smugglers unload crates by lantern light…"
        hint="What the place looks like and what is going on. Build with AI works from it." onCommit={(scene) => up({ scene })} />

      <div className="enc-meter" role="img" aria-label={`${d.totalXp} XP: ${RATING_LABELS[d.rating]}`}>
        <div className="meter-bar">
          <span className="meter-fill" style={{ width: pct(d.totalXp) }} />
          {(['low', 'moderate', 'high'] as const).map((k) => (
            <span key={k} className={`meter-mark${k === e.target ? ' is-target' : ''}`} style={{ left: pct(d.budgets[k]) }} title={`${k}: ${d.budgets[k]} XP`}>
              <span>{k[0].toUpperCase() + k.slice(1)} {d.budgets[k]}</span>
            </span>
          ))}
        </div>
        <p className={`meter-text r-${d.rating}`}>
          <strong>{d.totalXp} XP: {RATING_LABELS[d.rating]}.</strong>{' '}
          {d.totalXp < targetBudget ? `${targetBudget - d.totalXp} XP left before ${e.target}.` : d.rating === e.target ? 'On target.' : `Over the ${e.target} budget by ${d.totalXp - targetBudget} XP.`}
          {d.factor !== 1 && <span className="ink-muted"> Budgets adapted ×{d.factor} to your party.</span>}
        </p>
      </div>

      <h3 className="side-h">Who fights</h3>
      {e.creatures.length === 0 ? <p className="ink-muted">Nobody yet. Add cards, SRD monsters or a suggestion below.</p> : (
        <table className="enc-table">
          <thead><tr><th>Creature</th><th>CR</th><th>XP each</th><th>How many</th><th>XP</th><th>Notes</th><th /></tr></thead>
          <tbody>
            {e.creatures.map((c) => (
              <tr key={c.entityId}>
                <td><button className="ledger-name" onClick={() => void openSheet(c.entityId)}>{c.name}</button>
                  {c.aiMade && <span className="ai-badge enc-ai">AI</span>}
                  {c.statLine && <div className="ink-muted enc-stat">{c.statLine}</div>}
                  {c.stashed && <div className="enc-stash"><span className="ink-muted">Only in this encounter.</span> <button className="link-button" onClick={() => void act('entity:setStatus', { id: c.entityId, status: 'active' })}>Put on board</button></div>}</td>
                <td>{c.cr || '—'}</td>
                <td>{c.xpEach || '—'}</td>
                <td>
                  <div className="row tight count">
                    <button className="ink-button" aria-label={`One fewer ${c.name}`} disabled={!c.rowId && c.count <= 1}
                      onClick={() => c.rowId ? void act('encounter:creature', { rowId: c.rowId, patch: { count: c.count - 1 } }) : void act('encounter:addCreature', { encounterId: e.id, entityId: c.entityId, count: 1 })}>−</button>
                    <span className="mono">{c.count}</span>
                    <button className="ink-button" aria-label={`One more ${c.name}`} onClick={() => c.rowId
                      ? void act('encounter:creature', { rowId: c.rowId, patch: { count: c.count + 1 } })
                      : void act('encounter:addCreature', { encounterId: e.id, entityId: c.entityId, count: 1 })}>+</button>
                  </div>
                </td>
                <td className="mono">{c.xpEach * c.count}</td>
                <td>{c.rowId ? <CommitField id={`cn-${c.rowId}`} label="Notes" className="label-hidden" value={c.notes} placeholder="Hides in the reeds…" onCommit={(notes) => void act('encounter:creature', { rowId: c.rowId!, patch: { notes } })} /> : null}</td>
                <td><button className="ink-button danger-ink" onClick={() => void act('encounter:removeCreature', { encounterId: e.id, entityId: c.entityId })}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="enc-add">
        <div className="field">
          <label htmlFor="enc-pick">Add a card</label>
          <div className="row tight">
            <select id="enc-pick" value={pick} onChange={(ev) => setPick(ev.target.value)}>
              <option value="">Choose a monster or NPC card…</option>
              {v.fighters.map((f) => <option key={f.id} value={f.id}>{f.name}{f.cr ? ` (CR ${f.cr})` : ''}</option>)}
            </select>
            <input className="short" type="number" min={1} max={100} value={pickCount} aria-label="How many" onChange={(ev) => setPickCount(Math.max(1, Number(ev.target.value) || 1))} />
            <button className="ink-button primary-ink" disabled={!pick} onClick={() => { void act('encounter:addCreature', { encounterId: e.id, entityId: pick, count: pickCount }); setPick('') }}>Add</button>
          </div>
        </div>
        <SrdAdd encounterId={e.id} />
        <Suggest e={e} />
      </div>
      <BuildWithAi e={e} />

      <div className="prep-row-fields two">
        <CommitField id="enc-tactics" label="Tactics" multiline rows={3} value={e.tactics} placeholder="Archers stay on the ledge; the leader flees at half HP…" onCommit={(tactics) => up({ tactics })} />
        <CommitField id="enc-notes" label="Notes" multiline rows={3} value={e.notes} placeholder="Why they are here, what they carry…" onCommit={(notes) => up({ notes })} />
      </div>

      {e.runs.length > 0 && (
        <>
          <h3 className="side-h">Played</h3>
          <ul className="ink-list">{e.runs.map((r, i) => <li key={i}>Session {r.session}, {formatClock(r.atMin)}: {r.feedback ? `the party found it ${FEEL[r.feedback] ?? r.feedback}` : 'not rated yet (rate it in the session review)'}</li>)}</ul>
        </>
      )}

      {ratingError && <p className="field-error" role="alert">{ratingError} {/service/i.test(ratingError) && <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose one…</button>}</p>}
      {rating && (
        <div className="ai-suggestion" role="region" aria-label="AI rating">
          <span className="ai-badge">AI suggestion · {rating.source}</span>
          <p className="ai-suggestion-text">{rating.text}</p>
          <div className="row tight wrap">
            <button className="ink-button primary-ink" onClick={() => { up({ notes: [e.notes.trim(), `AI rating: ${rating.text}`].filter(Boolean).join('\n\n') }); setRating(null) }}>Add to notes</button>
            <button className="ink-button" onClick={() => setRating(null)}>Discard</button>
          </div>
        </div>
      )}

      <div className="row tight wrap enc-actions">
        <button className="ink-button primary-ink" disabled={e.creatures.length === 0} title="Opens the combat tracker: rounds, turns, hit points, conditions, morale"
          onClick={async () => { const id = await act('combat:start', { encounterId: e.id }); if (id) await openCombat(id) }}>Run encounter</button>
        <button className="ink-button primary-ink" title="Everything saves as you go; this makes sure the field you are typing in is kept too"
          onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); say(`Saved ${e.name}`) }}>Save encounter</button>
        {v.sessionRunning
          ? <button className="ink-button primary-ink" onClick={async () => { if (await act('encounter:run', { encounterId: e.id })) say(`Logged the fight: ${e.name}`) }}>Run it now (log the fight)</button>
          : <span className="ink-muted">Start a session to run it as a logged fight.</span>}
        <button className="ink-button" disabled={ratingBusy || e.creatures.length === 0} onClick={() => void rate()}>{ratingBusy ? 'Asking…' : 'Ask AI to rate'}</button>
        <button className="ink-button" disabled={e.creatures.length === 0} onClick={() => setRoll20(true)}>Export to Roll20…</button>
        <button className="ink-button" disabled={e.creatures.length === 0} onClick={() => setPdf(true)}>Stat sheets (PDF/JPG)…</button>
        <button className="ink-button" onClick={() => void openSheet(e.id)}>Open card</button>
        <button className="ink-button danger-ink" onClick={() => void act('entity:setStatus', { id: e.id, status: 'defunct' })}>Remove encounter</button>
      </div>
      {roll20 && <Roll20Dialog entityIds={e.creatures.map((c) => c.entityId)} title={`Roll20: ${e.name}`} mapId={e.battleMapId} onClose={() => setRoll20(false)} />}
      {pdf && <ExportDialog kind="sheets" entityIds={e.creatures.map((c) => c.entityId)} title={e.name} onClose={() => setPdf(false)} />}
    </section>
  )
}

/** Build with AI: the AI picks SRD monsters or makes new ones for the scene; the DM ticks what to add. */
function BuildWithAi({ e }: { e: EncounterView }) {
  const { act, setAiSettingsOpen } = useBoard()
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<IpcOutputs['ai:buildEncounter'] | null>(null)
  const [skip, setSkip] = useState<Set<number>>(new Set())
  const [open, setOpen] = useState<number | null>(null)
  const build = async () => {
    setBusy(true); setError(null)
    try { setPlan(await call('ai:buildEncounter', { encounterId: e.id, ask })); setSkip(new Set()) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const add = async () => {
    if (!plan) return
    const items = plan.creatures.filter((_, i) => !skip.has(i)).map((c) => c.kind === 'srd'
      ? { srdKey: c.key, name: c.name, count: c.count, notes: c.notes }
      : { name: c.name, count: c.count, notes: c.notes, statblock: c.statblock, actions: c.actions })
    if (items.length) await act('encounter:addProposals', { encounterId: e.id, items, tactics: plan.tactics, source: plan.source })
    setPlan(null)
  }
  return (
    <div className="enc-build">
      <div className="field">
        <label htmlFor="enc-build">Build with AI <span className="ink-muted">(it chooses SRD monsters or makes new ones for the scene)</span></label>
        <div className="row tight">
          <input id="enc-build" value={ask} maxLength={2000} placeholder="Optional: goblins with a pet wolf; one should try to flee and warn the camp" onChange={(ev) => setAsk(ev.target.value)} />
          <button className="ink-button primary-ink" disabled={busy} onClick={() => void build()}>{busy ? 'Building…' : plan ? 'Build again' : 'Build with AI'}</button>
        </div>
      </div>
      {error && <p className="field-error battle-error" role="alert"><span>{error}</span><span className="row tight"><button disabled={busy} onClick={() => void build()}>Try again</button><button onClick={() => setAiSettingsOpen(true)}>AI services…</button></span></p>}
      {plan && (
        <div className="ai-suggestion" role="region" aria-label="AI encounter">
          <span className="ai-badge">AI suggestion · {plan.source}</span>
          <ul className="enc-plan">
            {plan.creatures.map((c, i) => (
              <li key={i}>
                <label className="act-tick"><input type="checkbox" checked={!skip.has(i)} onChange={() => setSkip((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })} />
                  <strong>{c.count} × {c.name}</strong></label>
                <span className="ink-muted"> {c.kind === 'srd' ? `SRD, CR ${c.cr}` : `new monster, CR ${c.statblock.cr || '?'}`}</span>
                {c.kind === 'new' && <button className="link-button" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'Hide stat block' : 'Stat block'}</button>}
                {c.notes && <div className="ink-muted">{c.notes}</div>}
                {c.kind === 'new' && open === i && <StatBlockView name={c.name} sb={c.statblock} actions={c.actions} />}
              </li>
            ))}
          </ul>
          {plan.tactics && <p><strong>Tactics:</strong> {plan.tactics}</p>}
          <div className="row tight wrap">
            <button className="ink-button primary-ink" disabled={skip.size === plan.creatures.length} onClick={() => void add()}>Add ticked to the encounter</button>
            <button className="ink-button" onClick={() => setPlan(null)}>Discard</button>
          </div>
          <p className="hint">New monsters stay in this encounter, off the board, until you press Put on board. Tactics fill in when yours are empty.</p>
        </div>
      )}
    </div>
  )
}

function SrdAdd({ encounterId }: { encounterId: string }) {
  const act = useBoard((s) => s.act)
  const [q, setQ] = useState('')
  const [res, setRes] = useState<SrdSearch['monsters']>([])
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return }
    const t = setTimeout(() => {
      call('srd:search', { query: q, kind: 'monsters' }).then((r) => setRes(r.monsters.slice(0, 8))).catch(() => setRes([]))
    }, 200)
    return () => clearTimeout(t)
  }, [q])
  const [browse, setBrowse] = useState(false)
  return (
    <div className="field">
      {browse && <SrdBrowser title="Add SRD monsters to this encounter" actionLabel="Add" onClose={() => setBrowse(false)}
        onPick={(key, count) => act('encounter:addSrd', { encounterId, groups: [{ key, count }] })} />}
      <label htmlFor="enc-srd">Add from the SRD (copied into the campaign) <button type="button" className="link-button" onClick={() => setBrowse(true)}>Browse all…</button></label>
      <input id="enc-srd" value={q} placeholder="ghoul, bandit, young dragon…" onChange={(e) => setQ(e.target.value)} />
      {res.length > 0 && (
        <ul className="srd-hits">
          {res.map((m) => (
            <li key={m.key}>
              <span>{m.name} <span className="ink-muted">CR {m.cr}</span></span>
              <button className="ink-button" onClick={() => void act('encounter:addSrd', { encounterId, groups: [{ key: m.key, count: 1 }] })}>Add</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Suggest({ e }: { e: EncounterView }) {
  const act = useBoard((s) => s.act)
  const [type, setType] = useState('')
  const [s, setS] = useState<Suggestion | null | undefined>(undefined)
  const roll = async () => setS(await call('encounter:suggest', { difficulty: e.target, creatureType: type || undefined }).catch(() => null))
  return (
    <div className="field">
      <label htmlFor="enc-type">Suggest from the SRD for {e.target}</label>
      <div className="row tight">
        <input id="enc-type" value={type} placeholder="Any creature type (undead, beast…)" onChange={(ev) => setType(ev.target.value)} />
        <button className="ink-button" onClick={() => void roll()}>{s ? 'Again' : 'Suggest'}</button>
      </div>
      {s === null && <span className="hint">No SRD monsters fit that budget and type.</span>}
      {s && (
        <div className="enc-suggest">
          <span>{s.groups.map((g) => `${g.count} × ${g.name} (CR ${g.cr})`).join(', ')} · {s.totalXp} of {s.budget} XP</span>
          <button className="ink-button primary-ink" onClick={() => { void act('encounter:addSrd', { encounterId: e.id, groups: s.groups.map((g) => ({ key: g.key, count: g.count })) }); setS(undefined) }}>Add these</button>
        </div>
      )}
    </div>
  )
}

function PartyPanel({ v, grip }: { v: EncountersView; grip: ReactNode }) {
  const act = useBoard((s) => s.act)
  return (
    <aside className="enc-side">
      {grip}
      <section className="parchment-note">
        <h2 className="panel-title">The party</h2>
        <div className="row tight">
          <label htmlFor="enc-level">Level</label>
          <input id="enc-level" className="short" type="number" min={1} max={20} defaultValue={v.party.level} key={v.party.level}
            onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 20 && n !== v.party.level) void act('party:setLevel', { level: n }) }} />
          <span className="ink-muted">{v.party.size} characters (from the PC cards, or 4)</span>
        </div>
        <h3 className="side-h">Adapted to your table</h3>
        <p className="ink-muted">{v.adaptation.explain}</p>
        <p className="hint">Rate fights in the session review (too easy … nearly deadly); the budgets follow the last {10} ratings.</p>
      </section>
      <section className="parchment-note">
        <h2 className="panel-title">House rules</h2>
        <CommitField id="house-rules" label="Rules the AI works from when rating" multiline rows={8} value={v.houseRules}
          placeholder="Paste your house rules: flanking gives advantage, potions are a bonus action, minions die in one hit…"
          onCommit={(text) => void act('encounter:houseRules', { text })} />
      </section>
    </aside>
  )
}
