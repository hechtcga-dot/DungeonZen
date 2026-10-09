import { useEffect, useState, type FormEvent } from 'react'
import { useBoard } from '../store'
import { DeskFrame } from '../components/DeskFrame'
import { Candle, D20 } from '../art/props'
import { ClockDial } from '../art/sky'
import { MapView } from '../components/MapView'
import { WhereTheyAre } from '../components/WhereTheyAre'
import { readOnlyLayer } from '../components/MapOverlay'
import { Dialog } from '../components/Dialog'
import { CampaignSettingsDialog } from '../components/EditDialogs'
import { useLightingPref } from '../art/TableLighting'
import { lightingAt, skyAt } from '../../shared/sky'
import { formatClock, toClockParts } from '../../shared/time'
import type { LogKind } from '../../shared/schemas'
import type { AiSuggestion, GeneratedView, LiveView, LogView, PartyHealth } from '../../shared/types'
import { providerById } from '../../shared/aiProviders'
import { call } from '../api'
import { useSidePanel } from '../components/Splitter'

const KIND_LABELS: Record<LogKind, string> = {
  note: 'Note', fight: 'Fight', meeting: 'Met', quest: 'Quest delivered', rest: 'Rest', travel: 'Travel'
}
const TIME_CHOICES: Array<[number, string]> = [[0, 'No time'], [10, '10 min'], [30, '30 min'], [60, '1 h'], [240, '4 h']]
const CREATURE_TYPES = ['', 'aberration', 'beast', 'celestial', 'construct', 'dragon', 'elemental', 'fey', 'fiend', 'giant', 'humanoid', 'monstrosity', 'ooze', 'plant', 'undead']

export function LiveScreen() {
  const live = useBoard((s) => s.live)
  return (
    <DeskFrame>
      {live ? <Live v={live} /> : <p className="desk-loading">Lighting the candles…</p>}
    </DeskFrame>
  )
}

function healthWord(p: number | null): string {
  if (p === null) return 'No hit points recorded yet.'
  if (p >= 90) return 'Fresh.'
  if (p >= 60) return 'Worn down.'
  if (p >= 30) return 'Badly hurt.'
  return 'On their last legs.'
}

function Live({ v }: { v: LiveView }) {
  const left = useSidePanel('live-left', 'left', 340)
  const side = useSidePanel('live-right', 'right', 300)
  const { act, mapScreen, goTo } = useBoard()
  const [lighting] = useLightingPref()
  const [ending, setEnding] = useState(false)
  const [settings, setSettings] = useState(false)
  const lit = !lighting || lightingAt(v.nowMin).candlesLit
  const sky = skyAt(v.nowMin)
  const s = v.session

  return (
    <main className="desk live" aria-label="Live session">
      <header className="desk-head">
        <Candle className="desk-candle" lit={lit} />
        <span className={`live-seal${s ? '' : ' off'}`} aria-hidden="true">{s ? 'Live' : 'Off'}</span>
        <div className="desk-title">
          <span className="desk-eyebrow">{s ? 'Now playing' : 'No session running'}</span>
          <h1>{s ? `Session ${s.number}` : 'Live session'}</h1>
        </div>
        <div className="desk-head-actions">
          {s ? <button className="wax" onClick={() => setEnding(true)}>End session</button>
            : <button className="wax" onClick={() => void act('session:start', undefined)}>Start session {v.sessions.length + 1}</button>}
        </div>
      </header>

      <section className="dm-screen live-screen-bar" aria-label="DM screen">
        <div className="dm-panel clock-panel">
          <h2 className="panel-title">The hour</h2>
          <ClockDial minutes={v.nowMin} />
          <div className="clock-row">
            <div>
              <div className="clock-text">{formatClock(v.nowMin)}</div>
              <div className="ink-muted">{{ night: 'Night', dawn: 'Dawn', daylight: 'Daylight', dusk: 'Dusk' }[sky.light]}</div>
            </div>
          </div>
          <div className="row tight wrap">
            <button className="ink-button" aria-label="Clock back one hour" onClick={() => void act('clock:shift', { minutes: -60 })}>−1 h</button>
            <button className="ink-button" aria-label="Clock forward ten minutes" onClick={() => void act('clock:shift', { minutes: 10 })}>+10 m</button>
            <button className="ink-button" aria-label="Clock forward one hour" onClick={() => void act('clock:shift', { minutes: 60 })}>+1 h</button>
            <button className="ink-button" onClick={() => setSettings(true)}>Set…</button>
          </div>
        </div>

        <div className="dm-panel">
          <h2 className="panel-title">Party health</h2>
          <div className="health-row">
            <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
              <path d="M12 21s-7.5-4.6-9.6-9.2C.7 8 3 4 6.8 4c2.2 0 3.6 1.2 5.2 3 1.6-1.8 3-3 5.2-3C21 4 23.3 8 21.6 11.8 19.5 16.4 12 21 12 21z" fill="#8f2a21" stroke="#4a120d" strokeWidth="1" />
            </svg>
            <span className="health-pct">{v.health.percent === null ? '–' : `${v.health.percent}%`}</span>
            <span className="ink-muted mono">{v.health.hp} of {v.health.maxHp} hit points</span>
          </div>
          <div className="hp-bar big" role="img" aria-label={`Party health ${v.health.percent ?? 0} percent`}>
            <span style={{ width: `${Math.min(100, v.health.percent ?? 0)}%` }} />
          </div>
          <div className="ink-muted">{healthWord(v.health.percent)}</div>
          <div className="row tight wrap">
            <button className="ink-button" onClick={() => void act('party:rest', { kind: 'short' })} title="One hour passes">Short rest</button>
            <button className="ink-button" onClick={() => void act('party:rest', { kind: 'long' })} title="Eight hours pass; everyone back to full hit points">Long rest</button>
          </div>
        </div>

        <div className="dm-panel">
          <h2 className="panel-title">Today so far</h2>
          <ul className="tally">
            {([['fight', 'Fights', v.today.fights], ['meeting', 'Meetings with NPCs', v.today.meetings], ['quest', 'Quests delivered', v.today.quests]] as const).map(([k, label, n]) => (
              <li key={k}>
                <span>{label}</span>
                <span className="tally-n mono">{n}</span>
                <button className="tally-add" disabled={!s} aria-label={`Add one: ${label}`} title={s ? `Log one ${label.toLowerCase()}` : 'Start a session first'}
                  onClick={() => void act('log:add', { kind: k, text: '' })}>+</button>
              </li>
            ))}
          </ul>
          <span className="ink-muted">Counted for the whole campaign day.</span>
        </div>

        <div className="dm-panel advisor">
          <h2 className="panel-title">
            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#2a1f3d" stroke="#b5852f" /><path d="M3 12q9-8 18 0q-9 8-18 0z" fill="#efe3c4" /><circle cx="12" cy="12" r="3.5" fill="#2a1f3d" /></svg>
            The advisor
          </h2>
          {v.advisor.length === 0 ? <p className="advisor-quiet">All quiet. Nothing to warn you about.</p> : (
            <ul className="advisor-notes">
              {v.advisor.map((n, i) => <li key={i} className={`note-${n.level}`}>{n.text}</li>)}
            </ul>
          )}
        </div>
      </section>

      <WhereTheyAre v={v} />

      <section className="mat live-mat" aria-label="Table" style={{ ...left.style, ...side.style }}>
        <D20 className="mat-d20" />
        <div className="live-left">
          {left.grip}
          <QuickLog v={v} />
          <SessionLog v={v} />
        </div>
        <div className="live-map">
          <div className="parchment-sheet">
            {v.map ? <MapView src={v.map.url} alt={`Map of ${v.map.name}`} className="desk-mapview" layer={readOnlyLayer(mapScreen, v.map.id)} />
              : <div className="map-empty"><h2>No map yet</h2><p>Import one on the desk or the Map screen.</p></div>}
            <div className="row tight wrap map-actions">
              <MetSomeoneNew disabled={!s} />
            </div>
            <p className="hint ink-hint">The dotted line is where the party went this session. <button className="link-button" onClick={() => goTo('map')}>Open the map</button> to move them.</p>
          </div>
        </div>
        <div className="live-party">
          {side.grip}
          <h2 className="mat-heading">The party</h2>
          {v.party.length === 0 && <p className="mat-hint">No player characters yet. Add them on the desk.</p>}
          {v.party.map((p, i) => <PartyCard key={p.id} p={p} i={i} />)}
        </div>
      </section>

      <SetTheScene v={v} />
      <OnTheFly v={v} />
      {v.sessions.length > 0 && (
        <section className="past-sessions" aria-labelledby="past-h">
          <h2 id="past-h" className="mat-heading on-wood">Sessions</h2>
          <ul>
            {[...v.sessions].reverse().map((x) => (
              <li key={x.id} className="parchment-note">
                <strong className="panel-title">Session {x.number}</strong>
                <span className="ink-muted">{formatClock(x.startMin)} to {x.endMin === null ? 'now' : formatClock(x.endMin)}{x.ended ? '' : ' · running'}</span>
                <button className="ink-button" onClick={() => void useBoard.getState().openReview(x.id)}>Review</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ending && s && <EndSessionDialog v={v} onClose={() => setEnding(false)} />}
      <CampaignSettingsDialog open={settings} onClose={() => setSettings(false)} />
    </main>
  )
}

function QuickLog({ v }: { v: LiveView }) {
  const act = useBoard((s) => s.act)
  const [text, setText] = useState('')
  const [minutes, setMinutes] = useState(0)
  const [person, setPerson] = useState('')
  const s = v.session
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    const done = await act('log:add', { kind: 'note', text: text.trim(), minutesTaken: minutes })
    if (done) { setText(''); setMinutes(0) }
  }
  return (
    <div className="parchment-note quicklog">
      <h2 className="panel-title">Quick-log</h2>
      {!s && <p className="ink-muted">Start a session to log what happens.</p>}
      <form className="dz-form" onSubmit={submit}>
        <label htmlFor="ql-text" className="visually-hidden">What just happened</label>
        <textarea id="ql-text" rows={3} value={text} disabled={!s} placeholder="Write what just happened, in your own words"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) void submit(e) }} />
        <fieldset className="time-choices">
          <legend>Time it took</legend>
          {TIME_CHOICES.map(([m, label]) => (
            <label key={m} className={`chip-radio${minutes === m ? ' is-on' : ''}`}>
              <input type="radio" name="ql-time" checked={minutes === m} disabled={!s} onChange={() => setMinutes(m)} />{label}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="ink-button primary-ink" disabled={!s || !text.trim()}>Log it</button>
      </form>
      <form className="row tight met-row" onSubmit={async (e) => {
        e.preventDefault()
        if (!person) return
        await act('log:add', { kind: 'meeting', text: '', entityId: person })
        setPerson('')
      }}>
        <label htmlFor="ql-person" className="visually-hidden">They met</label>
        <select id="ql-person" className="ink-select" value={person} disabled={!s} onChange={(e) => setPerson(e.target.value)}>
          <option value="">They met…</option>
          {v.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="submit" className="ink-button" disabled={!s || !person}>Log meeting</button>
      </form>
    </div>
  )
}

function SessionLog({ v }: { v: LiveView }) {
  return (
    <div className="session-log">
      <h2 className="panel-title">Logged this session</h2>
      {v.log.length === 0 ? <p className="log-empty">Nothing logged yet.</p> : (
        <ol>{v.log.map((l) => <LogItem key={l.id} l={l} />)}</ol>
      )}
    </div>
  )
}

function LogItem({ l }: { l: LogView }) {
  const act = useBoard((s) => s.act)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(l.text)
  const what = l.kind === 'meeting' ? `Met ${l.entityName ?? 'someone'}${l.text ? `: ${l.text}` : ''}` : l.text || KIND_LABELS[l.kind]
  return (
    <li>
      <span className="log-time mono">{formatClock(l.atMin).replace('Day ', 'D')}</span>
      <span className={`log-kind k-${l.kind}`}>{KIND_LABELS[l.kind]}</span>
      {editing ? (
        <form className="log-edit" onSubmit={(e) => { e.preventDefault(); void act('log:update', { id: l.id, patch: { text } }); setEditing(false) }}>
          <label htmlFor={`log-${l.id}`} className="visually-hidden">Log text</label>
          <input id={`log-${l.id}`} autoFocus value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setText(l.text); setEditing(false) } }} />
          <button type="submit">Save</button>
        </form>
      ) : <span className="log-text">{what}{l.minutesTaken > 0 && <em> (+{l.minutesTaken >= 60 ? `${l.minutesTaken / 60} h` : `${l.minutesTaken} min`})</em>}</span>}
      {!editing && (
        <span className="log-actions">
          <button aria-label="Edit entry" onClick={() => setEditing(true)}>Edit</button>
          <button aria-label="Remove entry" onClick={() => void act('log:setStatus', { id: l.id, status: 'defunct' })}>×</button>
        </span>
      )}
    </li>
  )
}

function MetSomeoneNew({ disabled }: { disabled: boolean }) {
  const { act, info, openSheet } = useBoard()
  return (
    <button className="ink-button" disabled={disabled} title={disabled ? 'Start a session first' : 'Creates a new NPC card and logs the meeting'}
      onClick={async () => {
        if (!info) return
        const e = await act('entity:create', { boardId: info.globalBoardId, type: 'NPC', name: 'Someone new' })
        if (!e) return
        await act('log:add', { kind: 'meeting', text: '', entityId: e.id })
        await openSheet(e.id)
      }}>They met someone new</button>
  )
}

function PartyCard({ p, i }: { p: PartyHealth; i: number }) {
  const act = useBoard((s) => s.act)
  const openSheet = useBoard((s) => s.openSheet)
  const [edit, setEdit] = useState<string | null>(null)
  const pct = p.maxHp > 0 ? Math.round((p.hp / p.maxHp) * 100) : 0
  const tint = p.colour ?? ['#23395b', '#7a2230', '#24553a', '#4b2d6b'][i % 4]
  const set = (hp: number) => void act('party:setHp', { entityId: p.id, hp: Math.max(0, hp) })
  return (
    <div className="pc-live" style={{ ['--tint' as string]: tint }}>
      <div className="pc-live-head">
        <button className="pc-live-name" onClick={() => void openSheet(p.id)}>{p.name}</button>
        {edit === null ? (
          <button className="pc-live-hp mono" title="Type an exact number" onClick={() => setEdit(String(p.hp))}>HP {p.hp} / {p.maxHp}{p.tempHp ? ` +${p.tempHp}` : ''}</button>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); const n = Number(edit); if (Number.isFinite(n)) set(n); setEdit(null) }}>
            <label htmlFor={`hp-${p.id}`} className="visually-hidden">{p.name} hit points</label>
            <input id={`hp-${p.id}`} className="short" autoFocus inputMode="numeric" value={edit}
              onChange={(e) => setEdit(e.target.value)} onBlur={() => setEdit(null)} />
          </form>
        )}
      </div>
      <div className="hp-bar" role="img" aria-label={`${p.name}: ${p.hp} of ${p.maxHp} hit points`}>
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      {p.maxHp === 0 && <p className="pc-live-hint">Set hit points on the sheet.</p>}
      {p.conditions && <p className="pc-live-hint" title="Conditions (change them on the desk card or the full sheet)">{p.conditions}</p>}
      <div className="hp-buttons">
        {[-5, -1, 1, 5].map((d) => (
          <button key={d} aria-label={`${d > 0 ? 'Heal' : 'Damage'} ${p.name} by ${Math.abs(d)}`} onClick={() => set(p.hp + d)}>{d > 0 ? `+${d}` : `−${-d}`}</button>
        ))}
      </div>
    </div>
  )
}

function SetTheScene({ v }: { v: LiveView }) {
  const act = useBoard((s) => s.act)
  const s = v.session
  const [draft, setDraft] = useState(s?.sceneText ?? '')
  const [last, setLast] = useState(s?.sceneText ?? '')
  if ((s?.sceneText ?? '') !== last) { setLast(s?.sceneText ?? ''); setDraft(s?.sceneText ?? '') }
  const sky = skyAt(v.nowMin)
  const { hour } = toClockParts(v.nowMin)
  return (
    <section className="scene" aria-labelledby="scene-h">
      <h2 id="scene-h" className="mat-heading on-wood">Set the scene</h2>
      <div className="scene-grid">
        <div className="parchment-note">
          <label htmlFor="scene-text" className="panel-title">Read-aloud text</label>
          <textarea id="scene-text" rows={6} value={draft} disabled={!s}
            placeholder="Write what the players see, hear and smell. It stays with this session."
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { if (s && draft !== s.sceneText) void act('session:update', { id: s.id, patch: { sceneText: draft } }) }} />
          <p className="ink-muted">It is {formatClock(v.nowMin)}, {sky.light === 'daylight' ? 'daylight' : sky.light}{hour >= 21 || hour < 5 ? ', the streets are quiet' : ''}.</p>
          {s && <AiSceneHelper current={draft} onUse={(text) => { setDraft(text); void act('session:update', { id: s.id, patch: { sceneText: text } }) }} />}
        </div>
        <div className="parchment-note read-aloud">
          <span className="eyebrow-ink">Read aloud</span>
          {draft.trim() ? <p className="read-aloud-text">{draft}</p> : <p className="ink-muted">Nothing written yet.</p>}
        </div>
      </div>
    </section>
  )
}

/** Asks the chosen writing service for read-aloud text. The answer stays a suggestion until the DM uses it. */
function AiSceneHelper({ current, onUse }: { current: string; onUse(text: string): void }) {
  const setAiSettingsOpen = useBoard((st) => st.setAiSettingsOpen)
  const aiOpen = useBoard((st) => st.aiSettingsOpen)
  const [service, setService] = useState<string | null | undefined>(undefined)
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggestion, setSuggestion] = useState<AiSuggestion | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Which writing service is chosen (read again when the settings close).
  useEffect(() => {
    if (aiOpen) return
    call('ai:settings', undefined).then((st) => setService(st.text.provider ? providerById(st.text.provider)?.name ?? null : null)).catch(() => setService(null))
  }, [aiOpen])
  const draftIt = async () => {
    setBusy(true); setError(null)
    try { setSuggestion(await call('ai:sceneText', { ask })) } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  if (service === undefined) return null
  if (service === null) {
    return (
      <p className="ink-muted ai-off">AI can draft this text from the time, the place and who is there.{' '}
        <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose an AI service…</button></p>
    )
  }
  return (
    <div className="ai-helper">
      <div className="row tight">
        <label htmlFor="scene-ask" className="visually-hidden">What should the AI describe?</label>
        <input id="scene-ask" value={ask} maxLength={2000} placeholder={current.trim() ? 'Optional: how to change it (darker, shorter, rain…)' : 'Optional: what to describe (the docks at night…)'}
          onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void draftIt() }} />
        <button className="ink-button" disabled={busy} onClick={() => void draftIt()}>{busy ? 'Writing…' : current.trim() ? 'Rework with AI' : 'Draft with AI'}</button>
      </div>
      <p className="ink-muted ai-uses">Uses {service}: it is told the time, light, moon, where the party is, the place's notes, who your cards put there, and the last log lines.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {suggestion && (
        <div className="ai-suggestion" role="region" aria-label="AI suggestion">
          <span className="ai-badge">AI suggestion · {suggestion.source}</span>
          <p className="ai-suggestion-text">{suggestion.text}</p>
          <div className="row tight wrap">
            <button className="ink-button primary-ink" onClick={() => { onUse(suggestion.text); setSuggestion(null) }}>Use this</button>
            {current.trim() && <button className="ink-button" onClick={() => { onUse(`${current.trim()}\n\n${suggestion.text}`); setSuggestion(null) }}>Add below mine</button>}
            <button className="ink-button" disabled={busy} onClick={() => void draftIt()}>Try again</button>
            <button className="ink-button" onClick={() => setSuggestion(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}

function OnTheFly({ v }: { v: LiveView }) {
  const act = useBoard((s) => s.act)
  const [result, setResult] = useState<GeneratedView | null>(null)
  const [difficulty, setDifficulty] = useState<'low' | 'moderate' | 'high'>('moderate')
  const [ctype, setCtype] = useState('')
  const roll = async (kind: 'character' | 'tavern' | 'encounter') => {
    const r = kind === 'character' ? await act('generate:character', undefined)
      : kind === 'tavern' ? await act('generate:tavern', undefined)
        : await act('generate:encounter', { difficulty, creatureType: ctype || undefined })
    if (r === null) useBoard.getState().say('No SRD monsters fit that budget and type. Try another type or difficulty.', true)
    else if (r) setResult(r)
  }
  const keep = async (stash: boolean) => {
    if (!result) return
    const ids = await act('generate:keep', { kind: result.kind, payload: result.payload as never, stash })
    if (ids) {
      useBoard.getState().say(stash ? `Saved for later: find it in the Library.` : `Put on the board: ${ids.length} card${ids.length === 1 ? '' : 's'}.`)
      setResult(null)
    }
  }
  return (
    <section className="onthefly" aria-labelledby="otf-h">
      <h2 id="otf-h" className="mat-heading on-wood">On the fly</h2>
      <div className="otf-grid">
        <button className="otf-card" onClick={() => void roll('character')}>
          <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true"><circle cx="20" cy="13" r="8" fill="#e3cfa6" stroke="#2a1f12" /><path d="M6 38q0-14 14-14t14 14z" fill="#2f5d8a" stroke="#2a1f12" /></svg>
          <span><strong>Roll a character</strong><span>Name, species, job, attitude, a want and an SRD stat block</span></span>
        </button>
        <div className="otf-card">
          <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true"><polygon points="20,2 37,11 37,29 20,38 3,29 3,11" fill="#8f2a21" stroke="#3b0c08" /><text x="20" y="25" textAnchor="middle" fontSize="11" fill="#fbe7c6">20</text></svg>
          <span>
            <strong>Suggest an encounter</strong>
            <span>For {v.party.length || 4} characters of level{' '}
              <label htmlFor="otf-level" className="visually-hidden">Party level</label>
              <input id="otf-level" className="tiny" type="number" min={1} max={20} value={v.partyLevel}
                onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= 20) void act('party:setLevel', { level: n }) }} />
            </span>
            <span className="row tight wrap">
              <label htmlFor="otf-diff" className="visually-hidden">Difficulty</label>
              <select id="otf-diff" className="ink-select" value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
                <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option>
              </select>
              <label htmlFor="otf-type" className="visually-hidden">Creature type</label>
              <select id="otf-type" className="ink-select" value={ctype} onChange={(e) => setCtype(e.target.value)}>
                {CREATURE_TYPES.map((t) => <option key={t} value={t}>{t ? t[0].toUpperCase() + t.slice(1) : 'Any creature'}</option>)}
              </select>
              <button className="ink-button" onClick={() => void roll('encounter')}>Suggest</button>
            </span>
          </span>
        </div>
        <button className="otf-card" onClick={() => void roll('tavern')}>
          <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true"><rect x="9" y="10" width="18" height="24" rx="3" fill="#c9893b" stroke="#2a1f12" /><path d="M27 15h4a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-4" fill="none" stroke="#2a1f12" strokeWidth="2" /><path d="M9 12q9-6 18 0" fill="#fffbea" stroke="#2a1f12" /></svg>
          <span><strong>Fill a tavern</strong><span>A named tavern, its keeper and patrons, a rumour</span></span>
        </button>
        <button className="otf-card" onClick={() => useBoard.getState().setBattleMapOpen(true)}>
          <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true"><rect x="4" y="4" width="32" height="32" fill="#efe3c4" stroke="#2a1f12" /><path d="M4 14h32M4 24h32M14 4v32M24 4v32" stroke="#2a1f12" opacity="0.5" /><rect x="15" y="15" width="8" height="8" fill="#8f2a21" /></svg>
          <span><strong>Draw a battle map</strong><span>Top-down, on a grid, from the scene, in the style of your example maps (AI image service)</span></span>
        </button>
      </div>
      {result && (
        <div className="otf-result suggestion" role="status">
          <span className="eyebrow-ink">Suggested · not saved yet</span>
          <h3>{result.title}</h3>
          <p className="ink-muted">{result.summary}</p>
          <ul>{result.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <div className="row tight wrap">
            <button className="ink-button primary-ink" onClick={() => void keep(false)}>Put on the board</button>
            <button className="ink-button" onClick={() => void keep(true)}>Save for later</button>
            <button className="ink-button" onClick={() => void roll(result.kind)}>Roll again</button>
            <button className="ink-button" onClick={() => setResult(null)}>Dismiss</button>
          </div>
          <p className="ink-muted">Everything it makes is editable afterwards, like any other card.</p>
        </div>
      )}
    </section>
  )
}

function EndSessionDialog({ v, onClose }: { v: LiveView; onClose(): void }) {
  const act = useBoard((s) => s.act)
  const s = v.session!
  const [recap, setRecap] = useState(s.recap || [...v.log].reverse().map((l) =>
    `${formatClock(l.atMin)}: ${l.kind === 'meeting' ? `met ${l.entityName ?? 'someone'}` : l.text || KIND_LABELS[l.kind]}`).join('\n'))
  return (
    <Dialog title={`End session ${s.number}`} open onClose={onClose} wide>
      <form className="dz-form" onSubmit={async (e) => {
        e.preventDefault()
        await act('session:update', { id: s.id, patch: { recap } })
        await act('session:end', { id: s.id })
        onClose()
        await useBoard.getState().openReview(s.id)
      }}>
        <div className="field">
          <label htmlFor="end-recap">Recap</label>
          <textarea id="end-recap" rows={12} value={recap} onChange={(e) => setRecap(e.target.value)} />
          <div className="hint">Started from your log. Edit it freely. The full review (conflicts and proposed changes) comes next.</div>
        </div>
        <div className="dz-actions">
          <button type="button" onClick={onClose}>Keep playing</button>
          <button type="submit" className="primary">End session and review</button>
        </div>
      </form>
    </Dialog>
  )
}
