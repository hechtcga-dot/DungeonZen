import { useEffect, useState } from 'react'
import { useBoard } from '../store'
import { call } from '../api'
import { providerById } from '../../shared/aiProviders'
import { formatClock } from '../../shared/time'
import type { AiSuggestion, LiveView, PrepItemView, WhereView } from '../../shared/types'

type Preset = 'npc' | 'scene' | 'complication' | 'rumours' | 'loot' | 'names'
const PRESETS: Array<[Preset, string]> = [
  ['npc', 'An NPC here'], ['scene', 'A scene here'], ['complication', 'Complications'],
  ['rumours', 'Rumours'], ['loot', 'Something to find'], ['names', 'Names']
]
const hm = (min: number) => `${Math.floor(min / 60)}:${String(Math.max(0, min % 60)).padStart(2, '0')}`

/** Minutes since a real date, ticking every half minute. */
function useElapsed(since: string | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!since) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [since])
  return since ? Math.max(0, Math.floor((now - Date.parse(since)) / 60_000)) : null
}

/**
 * Live desk › Where they are: the place, where they came from and are heading, who is here
 * (met or not), secrets that could come out, tonight's prep, pacing, and Ask AI.
 */
export function WhereTheyAre({ v }: { v: LiveView }) {
  const where = useBoard((s) => s.where)
  const { act, openSheet, goTo, openEncounter } = useBoard()
  if (!where) return null
  const prep = where.prep
  const discoveries = prep?.items.filter((i) => i.kind === 'discovery') ?? []
  const scenes = prep?.items.filter((i) => i.kind === 'scene') ?? []
  return (
    <section className="where" aria-labelledby="where-h">
      <div className="where-head">
        <h2 id="where-h" className="mat-heading on-wood">Where they are</h2>
        <div className="where-route on-wood">
          {where.cameFrom && <span>From <strong>{where.cameFrom.name}</strong> ({formatClock(where.cameFrom.atMin)})</span>}
          <span className="where-here">{where.place ? <><strong>{where.place.name}</strong>{where.place.inside ? `, ${where.place.inside}` : ''}</> : 'Not placed on a map'}</span>
          <label className="where-heading">
            Heading to
            <select className="ink-select on-wood" value={where.headingTo?.locationId ?? ''}
              onChange={(e) => void act('live:setHeading', { locationId: e.target.value || null })}>
              <option value="">Not set</option>
              {where.places.filter((p) => p.id !== where.place?.locationId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {where.headingTo?.travel && <span className="ink-muted-light">{where.headingTo.travel}</span>}
          </label>
          <button className="brass" onClick={() => goTo('map')}>{where.place ? 'Open the map' : 'Place them on the map'}</button>
        </div>
      </div>

      <div className="where-grid">
        <div className="parchment-note where-panel">
          <h3 className="side-h">Tips</h3>
          {where.tips.length ? <ul className="ink-list where-tips">{where.tips.map((t, i) => <li key={i}>{t}</li>)}</ul> : <p className="ink-muted">Nothing to point out.</p>}
          {where.encounters.length > 0 && (
            <>
              <h3 className="side-h">Encounters here</h3>
              <ul className="here-list">
                {where.encounters.map((e) => (
                  <li key={e.id}>
                    <button className="ledger-name" onClick={() => openEncounter(e.id)}>{e.name}</button>
                    <span className="met-badge">{e.rating}{e.runs ? ` · run ${e.runs}×` : ''}</span>
                    {v.session && <button className="link-button" onClick={() => void act('encounter:run', { encounterId: e.id })}>Start fight</button>}
                  </li>
                ))}
              </ul>
            </>
          )}
          {where.place?.notes && (<><h3 className="side-h">Notes on {where.place.name}</h3><p className="region-notes">{where.place.notes}</p></>)}
        </div>

        <div className="parchment-note where-panel">
          <h3 className="side-h">Who is here</h3>
          {where.people.length === 0 ? <p className="ink-muted">Nobody, as far as your cards say.</p> : (
            <ul className="here-list">
              {where.people.map((p) => (
                <li key={p.id}>
                  <button className="ledger-name" onClick={() => void openSheet(p.id)}>{p.name}</button>
                  {p.keyNpc && <span className="badge key-badge">KEY</span>}
                  <span className={`met-badge${p.met ? ' is-met' : ''}`}>{p.met ? 'Met' : 'Not met'}</span>
                  {!p.met && v.session && (
                    <button className="link-button" onClick={() => void act('log:add', { kind: 'meeting', text: '', entityId: p.id })}>They meet</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <h3 className="side-h">Secrets here <span className="dm-only">DM only</span></h3>
          {where.secrets.length === 0 ? <p className="ink-muted">No secrets tied to this place or the people here.</p> : (
            <ul className="secret-list">
              {where.secrets.map((x) => (
                <li key={x.id} className={x.done ? 'is-done' : undefined}>
                  {x.source === 'clue'
                    ? <label><input type="checkbox" checked={!!x.done} onChange={(e) => void act('prepItem:done', { id: x.id, done: e.target.checked })} /> {x.text}</label>
                    : <span>{x.text}</span>}
                  <span className="secret-src">{x.source === 'string' ? 'secret string' : x.source === 'card' ? 'clue card' : 'prep clue'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="parchment-note where-panel">
          <h3 className="side-h">Tonight's prep {prep ? `(session ${prep.number})` : ''}</h3>
          {!prep ? (
            <p className="ink-muted">No prep sheet for this session. <button className="link-button" onClick={() => goTo('prep')}>Start one</button></p>
          ) : (
            <>
              {prep.premise && <p className="prep-premise">{prep.premise}</p>}
              <Pacing v={v} scenes={scenes} pacing={prep.pacingMinutes} />
              <PrepTicks title="Discoveries" one="Discovery" items={discoveries} label="Revealed" />
              <PrepTicks title="Scenes" one="Scene" items={scenes} label="Played" here={where.place?.locationId} />
            </>
          )}
        </div>
      </div>
      <AskAi where={where} hasSession={!!v.session} />
    </section>
  )
}

function Pacing({ v, scenes, pacing }: { v: LiveView; scenes: PrepItemView[]; pacing: number }) {
  const startedAt = v.session && !v.session.ended ? v.session.startedAt : null
  const elapsed = useElapsed(startedAt)
  if (elapsed == null) return <p className="ink-muted">Pacing target {hm(pacing)}. The pacing check starts with the session.</p>
  const current = scenes.find((s) => !s.done)
  const late = current?.targetEnd != null && elapsed > current.targetEnd
  return (
    <p className={`pacing${late ? ' is-late' : ''}`} role="status">
      {hm(elapsed)} of {hm(pacing)} played.{' '}
      {current ? (late
        ? <>Behind: <strong>{current.title || 'this scene'}</strong> was meant to end by {hm(current.targetEnd!)}. Skip ahead, wrap it up or push a hook.</>
        : <>Now: <strong>{current.title || 'untitled scene'}</strong>{current.targetEnd != null ? `, until ${hm(current.targetEnd)}` : ''}.</>)
        : 'All planned scenes played.'}
    </p>
  )
}

function PrepTicks({ title, one, items, label, here }: { title: string; one: string; items: PrepItemView[]; label: string; here?: string }) {
  const act = useBoard((s) => s.act)
  if (!items.length) return null
  return (
    <>
      <h4 className="ticks-h">{title}</h4>
      <ul className="tick-list">
        {items.map((i, k) => (
          <li key={i.id} className={`${i.done ? 'is-done' : ''}${here && i.locationId === here ? ' is-here' : ''}`}>
            <label title={`${label}${i.done && i.doneAtMin != null ? ` at ${formatClock(i.doneAtMin)}` : ''}`}>
              <input type="checkbox" checked={i.done} onChange={(e) => void act('prepItem:done', { id: i.id, done: e.target.checked })} />
              <span><strong>{i.title || `${one} ${k + 1}`}</strong>{i.body ? `: ${i.body}` : ''}{i.locationName ? ` (${i.locationName})` : ''}</span>
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}

function AskAi({ where, hasSession }: { where: WhereView; hasSession: boolean }) {
  const { act, say, setAiSettingsOpen, aiSettingsOpen } = useBoard()
  const [service, setService] = useState<string | null | undefined>(undefined)
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState<Preset | 'free' | null>(null)
  const [answer, setAnswer] = useState<(AiSuggestion & { what: string }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (aiSettingsOpen) return
    call('ai:settings', undefined).then((st) => setService(st.text.provider ? providerById(st.text.provider)?.name ?? null : null)).catch(() => setService(null))
  }, [aiSettingsOpen])
  const run = async (preset: Preset | null) => {
    setBusy(preset ?? 'free'); setError(null)
    try {
      const r = await call('ai:ask', { preset, ask })
      setAnswer({ ...r, what: [PRESETS.find(([k]) => k === preset)?.[1], ask.trim()].filter(Boolean).join(': ') || 'Idea' })
    } catch (e) { setError((e as Error).message) }
    setBusy(null)
  }
  return (
    <div className="parchment-note ask-ai">
      <h3 className="side-h">Ask AI about {where.place?.name ?? 'this moment'}</h3>
      {service === null ? (
        <p className="ink-muted">Pick a writing service to get NPCs, scenes, rumours and more for where the party is.{' '}
          <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose an AI service…</button>
          {' '}Offline, use “On the fly” below.</p>
      ) : (
        <>
          <div className="row tight wrap">
            {PRESETS.map(([k, label]) => (
              <button key={k} className="ink-button" disabled={busy !== null} onClick={() => void run(k)}>{busy === k ? 'Asking…' : label}</button>
            ))}
          </div>
          <div className="row tight">
            <label htmlFor="ask-ai" className="visually-hidden">Ask the AI</label>
            <input id="ask-ai" value={ask} maxLength={2000} placeholder="Or type anything: “what does the harbourmaster know about the bell?”"
              onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !busy && ask.trim()) void run(null) }} />
            <button className="ink-button primary-ink" disabled={busy !== null || !ask.trim()} onClick={() => void run(null)}>{busy === 'free' ? 'Asking…' : 'Ask'}</button>
          </div>
          <p className="ink-muted ai-uses">Uses {service ?? '…'} with the time, place, people here, where they came from and are heading, tonight's prep and the secrets here (the AI may hint at them).</p>
        </>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      {answer && (
        <div className="ai-suggestion" role="region" aria-label="AI suggestion">
          <span className="ai-badge">AI suggestion · {answer.source}</span>
          <p className="ai-suggestion-text">{answer.text}</p>
          <div className="row tight wrap">
            {hasSession && <button className="ink-button primary-ink" onClick={async () => {
              if (await act('log:add', { kind: 'note', text: `${answer.what}: ${answer.text}` }) !== undefined) { say('Added to the session log'); setAnswer(null) }
            }}>Add to session log</button>}
            <button className="ink-button" onClick={async () => {
              await act('notes:append', { text: `${answer.what}\n${answer.text}` }); say('Added to your DM notes'); setAnswer(null)
            }}>Save to DM notes</button>
            <button className="ink-button" onClick={() => { void navigator.clipboard.writeText(answer.text); say('Copied') }}>Copy</button>
            <button className="ink-button" onClick={() => setAnswer(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}
