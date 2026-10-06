import { useState, type ReactNode } from 'react'
import { useBoard } from '../store'
import { DeskFrame } from '../components/DeskFrame'
import { CommitField } from '../components/fields'
import { Candle } from '../art/props'
import { useLightingPref } from '../art/TableLighting'
import { lightingAt } from '../../shared/sky'
import { formatClock } from '../../shared/time'
import type { PrepKind, SceneType } from '../../shared/schemas'
import type { EntityBrief, PrepItemView, PrepScreenView, PrepView } from '../../shared/types'

/** "1:15" for 75 minutes at the table. */
export const hm = (min: number | null) => (min == null ? '' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`)
/** Reads "1:15", "75" or "1h15" as minutes; empty is null; anything else is undefined (rejected). */
export function parseHm(text: string): number | null | undefined {
  const t = text.trim()
  if (!t) return null
  const m = /^(\d{1,2})\s*[:h]\s*(\d{1,2})?$/.exec(t) ?? /^(\d{1,4})$/.exec(t)
  if (!m) return undefined
  const total = m[2] !== undefined || t.includes(':') || t.includes('h') ? Number(m[1]) * 60 + Number(m[2] ?? 0) : Number(m[1])
  return total <= 1440 ? total : undefined
}

const SCENE_TYPES: SceneType[] = ['social', 'exploration', 'combat', 'other']
const DONE_LABEL: Record<PrepKind, string> = { discovery: 'Revealed', scene: 'Played', clue: 'Found', npc: 'Met', threat: 'Fought' }

/** DM Prep › Session prep: the one-page prep sheet (premise, discoveries, scenes, clues, key NPCs, threats). */
export function PrepScreen() {
  const { prepScreen, prep, info, act, prepNumber, setPrepNumber } = useBoard()
  const [lighting] = useLightingPref()
  const minutes = info?.clockMin ?? 0
  const number = prep?.number ?? prepNumber ?? prepScreen?.openNumber ?? prepScreen?.nextNumber ?? 1
  const numbers = prepScreen ? Array.from(new Set([...prepScreen.sheets.map((x) => x.number), prepScreen.nextNumber, number])).sort((a, b) => a - b) : [number]
  return (
    <DeskFrame>
      <main className="desk prep-screen" aria-label="Session prep">
        <header className="desk-head">
          <Candle className="desk-candle" lit={!lighting || lightingAt(minutes).candlesLit} />
          <div className="desk-title">
            <span className="desk-eyebrow">DM prep · {info ? formatClock(info.clockMin) : ''}</span>
            <h1>Session {number}{prep?.title ? `: ${prep.title}` : ''}</h1>
          </div>
          <div className="desk-head-actions">
            <label htmlFor="prep-pick" className="visually-hidden">Prep sheet for session</label>
            <select id="prep-pick" className="ink-select on-wood" value={number} onChange={(e) => setPrepNumber(Number(e.target.value))}>
              {numbers.map((n) => (
                <option key={n} value={n}>
                  Session {n}{n === prepScreen?.openNumber ? ' (running)' : n === prepScreen?.nextNumber ? ' (next)' : ''}
                  {prepScreen?.sheets.find((x) => x.number === n)?.title ? `: ${prepScreen.sheets.find((x) => x.number === n)!.title}` : ''}
                </option>
              ))}
            </select>
            {prep && <button className="brass" onClick={() => void act('prep:setStatus', { id: prep.id, status: 'defunct' })}>Remove sheet</button>}
          </div>
        </header>
        {!prepScreen ? <p className="desk-loading">Opening the prep sheet…</p> : !prep ? (
          <div className="parchment-sheet prep-empty">
            <h2 className="panel-title">No prep sheet for session {number} yet</h2>
            <p>A one-page sheet: the premise, what the players can discover, the scenes you expect, the clues that lead to each
              discovery, the people they will meet and the threats they will face. Everything on it shows up on the Live desk.</p>
            <button className="wax" onClick={() => void act('prep:create', { number })}>Start the prep sheet</button>
          </div>
        ) : <Sheet p={prep} s={prepScreen} />}
      </main>
    </DeskFrame>
  )
}

function Sheet({ p, s }: { p: PrepView; s: PrepScreenView }) {
  const act = useBoard((st) => st.act)
  const items = (k: PrepKind) => p.items.filter((i) => i.kind === k)
  const scenes = items('scene')
  const discoveries = items('discovery')
  const sceneMins = scenes.length ? Math.round(p.pacingMinutes / scenes.length) : null
  const up = (patch: Parameters<typeof updatePrep>[1]) => updatePrep(p.id, patch)
  const updatePrep = (id: string, patch: { title?: string; premise?: string; pacingMinutes?: number; backupNames?: string; notes?: string; number?: number }) =>
    void act('prep:update', { id, patch })
  const [pacing, setPacing] = useState(hm(p.pacingMinutes))

  return (
    <div className="prep-layout">
      <div className="prep-main">
        <section className="parchment-sheet prep-head" aria-label="Session">
          <div className="prep-head-grid">
            <CommitField id="prep-title" label="Session title" value={p.title} placeholder="The Drowned Bell" onCommit={(v) => up({ title: v })} />
            <div className="field">
              <label htmlFor="prep-pacing">Pacing target (hours:minutes)</label>
              <input id="prep-pacing" className="short" value={pacing} onChange={(e) => setPacing(e.target.value)}
                onBlur={() => { const m = parseHm(pacing); if (m && m >= 15 && m !== p.pacingMinutes) up({ pacingMinutes: m }); else setPacing(hm(p.pacingMinutes)) }} />
              <span className="hint">{scenes.length ? `${scenes.length} scene${scenes.length === 1 ? '' : 's'}, about ${sceneMins} min each` : 'Add scenes below'}</span>
            </div>
            <div className="field">
              <label htmlFor="prep-number">For session</label>
              <input id="prep-number" className="short" type="number" min={1} defaultValue={p.number} key={p.number}
                onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n !== p.number) up({ number: n }) }} />
            </div>
          </div>
          <CommitField id="prep-premise" label="Session premise" multiline rows={2} value={p.premise}
            placeholder="One or two sentences: the core situation or conflict." onCommit={(v) => up({ premise: v })} />
        </section>

        <PrepSection p={p} kind="discovery" n={1} title="Discoveries" hint="Secrets, plot twists and revelations for this session. Tick them as they are revealed; revealed ones show in Player preview."
          add="Add a discovery">
          {(i, k) => (
            <>
              <CommitField id={`d-t-${i.id}`} label={`Discovery ${k + 1}`} value={i.title} placeholder="Short name" onCommit={(v) => upItem(act, i, { title: v })} />
              <CommitField id={`d-b-${i.id}`} label="The secret, plot point or lore" multiline rows={2} value={i.body} onCommit={(v) => upItem(act, i, { body: v })} />
            </>
          )}
        </PrepSection>

        <PrepSection p={p} kind="scene" n={2} title="Scenes" hint="The key encounters and places, with a target time to watch pacing. Reskin them if the party goes elsewhere."
          add="Add a scene" extra={scenes.length > 1 && <button className="ink-button" onClick={() => void act('prep:spread', { prepId: p.id })}>Spread times evenly</button>}>
          {(i, k) => (
            <>
              <div className="prep-row-fields">
                <CommitField id={`s-t-${i.id}`} label={`Scene ${k + 1}`} value={i.title} placeholder="The bell tower" onCommit={(v) => upItem(act, i, { title: v })} />
                <div className="field">
                  <label htmlFor={`s-type-${i.id}`}>Type</label>
                  <select id={`s-type-${i.id}`} value={i.sceneType ?? 'other'} onChange={(e) => upItem(act, i, { sceneType: e.target.value as SceneType })}>
                    {SCENE_TYPES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                  </select>
                </div>
                <CardPick id={`s-loc-${i.id}`} label="Where" value={i.locationId} cards={s.locations} onPick={(v) => upItem(act, i, { locationId: v })} />
                <TimeRange i={i} />
              </div>
              <CommitField id={`s-b-${i.id}`} label="Setup or key event" multiline rows={2} value={i.body} onCommit={(v) => upItem(act, i, { body: v })} />
            </>
          )}
        </PrepSection>

        <PrepSection p={p} kind="clue" n={3} title="Clues" hint="Concrete clues that lead to the discoveries. Drop them wherever the players look."
          add="Add a clue">
          {(i) => (
            <>
              <div className="prep-row-fields">
                <div className="field">
                  <label htmlFor={`c-d-${i.id}`}>Leads to</label>
                  <select id={`c-d-${i.id}`} value={i.discoveryId ?? ''} onChange={(e) => upItem(act, i, { discoveryId: e.target.value || null })}>
                    <option value="">No discovery</option>
                    {discoveries.map((d, k) => <option key={d.id} value={d.id}>Discovery {k + 1}{d.title ? `: ${d.title}` : ''}</option>)}
                  </select>
                </div>
                <CardPick id={`c-loc-${i.id}`} label="Where (optional)" value={i.locationId} cards={s.locations} onPick={(v) => upItem(act, i, { locationId: v })} />
              </div>
              <CommitField id={`c-b-${i.id}`} label="The clue" multiline rows={2} value={i.body}
                placeholder="A sealed letter on the assassin; scorch marks along the village edge…" onCommit={(v) => upItem(act, i, { body: v })} />
            </>
          )}
        </PrepSection>

        <PrepSection p={p} kind="npc" n={4} title="Key NPCs" hint="Memorable, recurring characters. Link a card to fill in their role and look; change anything."
          add="Add a key NPC">
          {(i) => (
            <div className="prep-row-fields">
              <CardPick id={`n-card-${i.id}`} label="Card" value={i.entityId} cards={s.people} onPick={(v) => upItem(act, i, { entityId: v, ...(v ? { title: s.people.find((c) => c.id === v)?.name ?? i.title } : {}) })} />
              <CommitField id={`n-t-${i.id}`} label="Name" value={i.title} onCommit={(v) => upItem(act, i, { title: v })} />
              <CommitField id={`n-r-${i.id}`} label="Role or faction" value={i.role} onCommit={(v) => upItem(act, i, { role: v })} />
              <CommitField id={`n-b-${i.id}`} label="Aspect (look or quirk)" value={i.body} className="wide" onCommit={(v) => upItem(act, i, { body: v })} />
            </div>
          )}
        </PrepSection>

        <PrepSection p={p} kind="threat" n={5} title="Enemies and threats" hint="Stats and instincts for running them quickly. Link a monster card to fill in its stat line."
          add="Add a threat">
          {(i) => (
            <>
              <div className="prep-row-fields">
                <CardPick id={`t-card-${i.id}`} label="Card" value={i.entityId} cards={s.threats} onPick={(v) => upItem(act, i, { entityId: v, ...(v ? { title: s.threats.find((c) => c.id === v)?.name ?? i.title } : {}) })} />
                <CommitField id={`t-t-${i.id}`} label="Enemy group or creature" value={i.title} onCommit={(v) => upItem(act, i, { title: v })} />
                <CommitField id={`t-s-${i.id}`} label="Stats (CR, AC, HP, initiative)" value={i.stats} className="wide" onCommit={(v) => upItem(act, i, { stats: v })} />
              </div>
              <div className="prep-row-fields two">
                <CommitField id={`t-b-${i.id}`} label="Attacks and abilities" multiline rows={2} value={i.body} onCommit={(v) => upItem(act, i, { body: v })} />
                <CommitField id={`t-x-${i.id}`} label="Tactics and instinct" multiline rows={2} value={i.tactics}
                  placeholder="Swarms spellcasters, flees at half HP…" onCommit={(v) => upItem(act, i, { tactics: v })} />
              </div>
            </>
          )}
        </PrepSection>
      </div>

      <aside className="prep-side">
        <section className="parchment-note">
          <h2 className="panel-title">Backup names</h2>
          <p className="ink-muted">For people the party meets unexpectedly. One per line.</p>
          <CommitField id="prep-names" label="Names" multiline rows={4} value={p.backupNames} className="label-hidden" onCommit={(v) => up({ backupNames: v })} />
          <button className="ink-button" onClick={async () => {
            const names = await act('prep:rollNames', { count: 4 })
            if (names) up({ backupNames: [p.backupNames.trim(), ...names].filter(Boolean).join('\n') })
          }}>Roll 4 names</button>
        </section>
        <section className="parchment-note">
          <h2 className="panel-title">Notes</h2>
          <CommitField id="prep-notes" label="Notes" multiline rows={4} value={p.notes} className="label-hidden" placeholder="Anything else for this session…" onCommit={(v) => up({ notes: v })} />
        </section>
        <section className="parchment-note cheat-sheet">
          <h2 className="panel-title">Cheat sheet</h2>
          <ul className="ink-list">
            <li><strong>Pacing check:</strong> if an hour has passed and Scene 1 is not finished, skip ahead, wrap up the scene or push a direct hook.</li>
            <li><strong>Clues go where they look:</strong> never tie a clue to one room or action; put it wherever the players choose to search.</li>
            <li><strong>Off script?</strong> Reskin the prepped scenes and NPC aspects to fit where they went.</li>
          </ul>
        </section>
      </aside>
    </div>
  )
}

function upItem(act: ReturnType<typeof useBoard.getState>['act'], i: PrepItemView, patch: Record<string, unknown>) {
  void act('prepItem:update', { id: i.id, patch })
}

function PrepSection({ p, kind, n, title, hint, add, extra, children }: {
  p: PrepView; kind: PrepKind; n: number; title: string; hint: string; add: string; extra?: ReactNode
  children(i: PrepItemView, index: number): ReactNode
}) {
  const act = useBoard((s) => s.act)
  const list = p.items.filter((i) => i.kind === kind)
  return (
    <section className="parchment-sheet prep-section" aria-labelledby={`prep-${kind}`}>
      <div className="prep-section-head">
        <h2 id={`prep-${kind}`} className="panel-title"><span className="prep-n">{n}</span> {title}</h2>
        <div className="row tight wrap">
          {extra}
          <button className="ink-button primary-ink" onClick={() => void act('prepItem:add', { prepId: p.id, kind })}>{add}</button>
        </div>
      </div>
      <p className="ink-muted prep-hint">{hint}</p>
      {list.length === 0 ? <p className="ink-muted">None yet.</p> : (
        <ol className="prep-list">
          {list.map((i, k) => (
            <li key={i.id} className={`prep-item${i.done ? ' is-done' : ''}`}>
              <div className="prep-item-body">{children(i, k)}</div>
              <div className="prep-item-tools">
                {kind !== 'npc' && kind !== 'threat' && (
                  <label className="prep-done">
                    <input type="checkbox" checked={i.done} onChange={(e) => void act('prepItem:done', { id: i.id, done: e.target.checked })} />
                    {DONE_LABEL[kind]}{i.done && i.doneAtMin != null ? <span className="ink-muted"> {formatClock(i.doneAtMin)}</span> : null}
                  </label>
                )}
                <button className="ink-button" aria-label="Move up" disabled={k === 0} onClick={() => void act('prepItem:move', { id: i.id, direction: -1 })}>↑</button>
                <button className="ink-button" aria-label="Move down" disabled={k === list.length - 1} onClick={() => void act('prepItem:move', { id: i.id, direction: 1 })}>↓</button>
                <button className="ink-button danger-ink" onClick={() => void act('prepItem:setStatus', { id: i.id, status: 'defunct' })}>Remove</button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function CardPick({ id, label, value, cards, onPick }: { id: string; label: string; value: string | null; cards: EntityBrief[]; onPick(id: string | null): void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ''} onChange={(e) => onPick(e.target.value || null)}>
        <option value="">None</option>
        {cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </div>
  )
}

function TimeRange({ i }: { i: PrepItemView }) {
  const act = useBoard((s) => s.act)
  const [from, setFrom] = useState(hm(i.targetStart))
  const [to, setTo] = useState(hm(i.targetEnd))
  const [last, setLast] = useState(`${i.targetStart}-${i.targetEnd}`)
  if (`${i.targetStart}-${i.targetEnd}` !== last) { setLast(`${i.targetStart}-${i.targetEnd}`); setFrom(hm(i.targetStart)); setTo(hm(i.targetEnd)) }
  const commit = () => {
    const a = parseHm(from)
    const b = parseHm(to)
    if (a === undefined || b === undefined) { setFrom(hm(i.targetStart)); setTo(hm(i.targetEnd)); return }
    if (a !== i.targetStart || b !== i.targetEnd) upItem(act, i, { targetStart: a, targetEnd: b })
  }
  return (
    <div className="field">
      <label htmlFor={`s-from-${i.id}`}>Target time</label>
      <div className="row tight">
        <input id={`s-from-${i.id}`} className="short" placeholder="0:00" value={from} aria-label="Starts at" onChange={(e) => setFrom(e.target.value)} onBlur={commit} />
        <span aria-hidden="true">–</span>
        <input className="short" placeholder="0:30" value={to} aria-label="Ends at" onChange={(e) => setTo(e.target.value)} onBlur={commit} />
      </div>
    </div>
  )
}
