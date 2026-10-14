import { useMemo, useState, type ReactNode } from 'react'
import { useBoard } from '../store'
import { DeskFrame } from '../components/DeskFrame'
import { CommitField } from '../components/fields'
import { Candle } from '../art/props'
import { useLightingPref } from '../art/TableLighting'
import { lightingAt } from '../../shared/sky'
import { formatClock } from '../../shared/time'
import { ENTITY_TYPES, type EntityType, type PrepKind, type SceneType } from '../../shared/schemas'
import { ENTITY_LABELS } from '../entityStyle'
import type { EntityBrief, PrepItemView, PrepScreenView, PrepView } from '../../shared/types'
import { useSidePanel } from '../components/Splitter'
import { LinkContext, LinkField } from '../components/LinkField'
import { TypeEmblem } from '../art/emblems'

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
const DONE_LABEL: Record<PrepKind, string> = { discovery: 'Revealed', scene: 'Played', clue: 'Found', npc: 'Met', threat: 'Fought', thread: 'Followed up', bible: '' }

/** DM Prep › Session prep: the owner's one-page DM tool (opening, scenes, secrets & clues, NPCs, loose threads, recap, world bible). */
export function PrepScreen() {
  const { prepScreen, prep, info, act, prepNumber, setPrepNumber, goTo } = useBoard()
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
            <button className="brass" onClick={() => goTo('map')}>Map</button>
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
            <p>A one-page sheet: how the session opens, the likely scenes, secrets and clues, the NPCs, loose threads, and after the
              session the recap and world bible updates. Everything on it shows up on the Live desk.</p>
            <button className="wax" onClick={() => void act('prep:create', { number })}>Start the prep sheet</button>
          </div>
        ) : <Sheet p={prep} s={prepScreen} />}
      </main>
    </DeskFrame>
  )
}

function Sheet({ p, s }: { p: PrepView; s: PrepScreenView }) {
  const side = useSidePanel('prep-side', 'right', 300)
  const { act, say, goTo, openEncounter, openSheet } = useBoard()
  const items = (k: PrepKind) => p.items.filter((i) => i.kind === k)
  const scenes = items('scene')
  const sceneMins = scenes.length ? Math.round(p.pacingMinutes / scenes.length) : null
  const up = (patch: { title?: string; premise?: string; pacingMinutes?: number; backupNames?: string; notes?: string; number?: number; wantNext?: string }) =>
    void act('prep:update', { id: p.id, patch })
  const [pacing, setPacing] = useState(hm(p.pacingMinutes))
  const [cardType, setCardType] = useState<EntityType>('NPC')
  const saveNote = async () => {
    const id = await act('prep:saveNote', { id: p.id })
    if (id) useBoard.setState({ message: { text: `Saved to Notes as “Session ${p.number}${p.title.trim() ? ` - ${p.title.trim()}` : ''}”.`, isError: false } })
  }

  // Words linked to cards: the card shows in the side panel while the cursor is in them; a click elsewhere drops it.
  const [shown, setShown] = useState<string | null>(null)
  const links = useMemo(() => ({
    links: p.links, cards: s.cards, show: setShown,
    setLinks: (next: typeof p.links) => void act('prep:update', { id: p.id, patch: { links: next } })
  }), [p.links, p.id, s.cards, act])
  const card = shown ? s.cards.find((c) => c.id === shown) : undefined

  return (
    <LinkContext.Provider value={links}>
    <div className="prep-layout" style={side.style}>
      <div className="prep-main" onMouseDown={() => setShown(null)}>
        <section className="parchment-sheet prep-head" aria-label="Session">
          <div className="prep-head-grid">
            <CommitField id="prep-title" label="Session title" value={p.title} placeholder="The Drowned Bell" onCommit={(v) => up({ title: v })} />
            <div className="field">
              <label htmlFor="prep-number">For session</label>
              <input id="prep-number" className="short" type="number" min={1} defaultValue={p.number} key={p.number}
                onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n !== p.number) up({ number: n }) }} />
            </div>
            <div className="field">
              <label htmlFor="prep-pacing">Pacing target (hours:minutes)</label>
              <input id="prep-pacing" className="short" value={pacing} onChange={(e) => setPacing(e.target.value)}
                onBlur={() => { const m = parseHm(pacing); if (m && m >= 15 && m !== p.pacingMinutes) up({ pacingMinutes: m }); else setPacing(hm(p.pacingMinutes)) }} />
              <span className="hint">{scenes.length ? `${scenes.length} scene${scenes.length === 1 ? '' : 's'}, about ${sceneMins} min each` : 'Add scenes below'}</span>
            </div>
          </div>
          <div className="row tight wrap">
            <button className="ink-button primary-ink" title="Writes this sheet to Notes as a Word file; saving again adds a new version of the same file" onClick={() => void saveNote()}>
              {p.noteDocId ? 'Save to the notes file again' : 'Save as notes file'}
            </button>
            {p.noteDocId && <button className="link-button" onClick={() => { useBoard.setState({ notesTab: 'notes', notesOpenId: p.noteDocId }); goTo('import') }}>Open it in Notes</button>}
          </div>
        </section>

        <section className="parchment-sheet prep-section" aria-labelledby="prep-opening">
          <h2 id="prep-opening" className="panel-title"><span className="prep-n">1</span> Session opening</h2>
          <p className="ink-muted prep-hint">One sentence describing how the session begins. Start with something happening rather than asking the players what they want to do.</p>
          <LinkField id="prep-premise" label="Opening" className="label-hidden" multiline rows={2} value={p.premise}
            placeholder="Someone is pounding on the door at 2 a.m." onCommit={(v) => up({ premise: v })} />
        </section>

        <PrepSection p={p} kind="scene" n={2} title="Likely scenes" hint="3–5 possible scenes. Keep each to a location + tension. These are possibilities, not a script."
          add="Add a scene" extra={scenes.length > 1 && <button className="ink-button" onClick={() => void act('prep:spread', { prepId: p.id })}>Spread times evenly</button>}>
          {(i, k) => (
            <>
              <div className="prep-row-fields">
                <LinkField id={`s-t-${i.id}`} label={`Scene ${k + 1}: location`} value={i.title} placeholder="Dock at night" onCommit={(v) => upItem(act, i, { title: v })} />
                <CardPick id={`s-loc-${i.id}`} label="Location card" value={i.locationId} cards={s.locations} onPick={(v) => upItem(act, i, { locationId: v })} />
                <div className="field">
                  <label htmlFor={`s-type-${i.id}`}>Type</label>
                  <select id={`s-type-${i.id}`} value={i.sceneType ?? 'other'} onChange={(e) => upItem(act, i, { sceneType: e.target.value as SceneType })}>
                    {SCENE_TYPES.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                  </select>
                </div>
                <TimeRange i={i} />
              </div>
              <LinkField id={`s-b-${i.id}`} label="Tension" value={i.body} placeholder="The harbormaster knows what happened and won’t say." onCommit={(v) => upItem(act, i, { body: v })} />
            </>
          )}
        </PrepSection>

        <PrepSection p={p} kind="discovery" n={3} title="Secrets & clues" hint="10 things that are true about the world. Don’t decide in advance where or how the players will discover them. Move clues to wherever the players are looking. Revealed ones show in Player preview."
          add="Add a secret or clue">
          {(i, k) => (
            <div className="prep-row-fields">
              <LinkField id={`d-b-${i.id}`} label={`Secret ${k + 1}`} value={i.body} className="wide" placeholder="The harbormaster was paid to keep quiet."
                hint={i.relationshipId || i.entityId ? 'Shared with the board: editing it here changes it there too.' : undefined} onCommit={(v) => upItem(act, i, { body: v })} />
              <div className="field">
                <label htmlFor={`d-s-${i.id}`}>Secret on the board</label>
                <select id={`d-s-${i.id}`} value={i.relationshipId ? `string:${i.relationshipId}` : i.entityId ? `clue:${i.entityId}` : ''}
                  onChange={(e) => {
                    const [kind, id] = e.target.value.split(':')
                    upItem(act, i, { relationshipId: kind === 'string' ? id : null, entityId: kind === 'clue' ? id : null })
                  }}>
                  <option value="">None</option>
                  {s.boardSecrets.map((b) => <option key={b.id} value={`${b.kind}:${b.id}`}>{b.label}</option>)}
                </select>
              </div>
              <LinkField id={`d-t-${i.id}`} label="Short name (optional)" value={i.title} onCommit={(v) => upItem(act, i, { title: v })} />
              <CardPick id={`d-loc-${i.id}`} label="Where (optional, shows on Live)" value={i.locationId} cards={s.locations} onPick={(v) => upItem(act, i, { locationId: v })} />
            </div>
          )}
        </PrepSection>

        <PrepSection p={p} kind="npc" n={4} title="NPCs" hint="Name, who they are, what they want. Tied to a card, these are the card's name, one-line summary and motivation: change them here or on the card."
          add="Add an NPC">
          {(i) => <NpcRow i={i} s={s} />}
        </PrepSection>

        <PrepSection p={p} kind="thread" n={5} title="Loose threads" hint="Three unresolved things from the previous session. Possibilities to keep in mind, not objectives to force onto the players."
          add="Add a thread" extra={p.number > 1 && <button className="ink-button" title="Copies last session’s “what the players seem to want next” and its threads not ticked off"
            onClick={async () => { const n = await act('prep:bringThreads', { prepId: p.id }); if (n === 0) say('Nothing new to bring in from last session.') }}>Bring in from last session</button>}>
          {(i, k) => <LinkField id={`l-b-${i.id}`} label={`Thread ${k + 1}`} value={i.body} placeholder="The party promised to investigate the abandoned mine." onCommit={(v) => upItem(act, i, { body: v })} />}
        </PrepSection>

        <section className="parchment-sheet prep-section" aria-labelledby="prep-recap">
          <h2 id="prep-recap" className="panel-title"><span className="prep-n">6</span> Session recap</h2>
          <p className="ink-muted prep-hint">Write this after the session. “What happened” is the session’s recap (the same text as in Review).</p>
          {p.session
            ? <LinkField id="prep-happened" label="What happened" multiline rows={3} value={p.session.recap}
                onCommit={(v) => void act('session:update', { id: p.session!.id, patch: { recap: v } })} />
            : <p className="ink-muted">What happened: write it here once session {p.number} has started.</p>}
          <LinkField id="prep-want" label="What the players seem to want next" multiline rows={2} value={p.wantNext}
            placeholder="They want to track the escaped smuggler and find out who hired him." onCommit={(v) => up({ wantNext: v })} />
        </section>

        <PrepSection p={p} kind="bible" n={7} title="World bible updates" hint="Add anything established during play. If something happens at the table, it is now part of the world unless you deliberately retcon it."
          add="Add a line" extra={(
            <label className="row tight">Make cards as
              <select value={cardType} aria-label="Card type for Make a card" onChange={(e) => setCardType(e.target.value as EntityType)}>
                {ENTITY_TYPES.filter((t) => t !== 'PC').map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
              </select>
            </label>
          )}>
          {(i) => (
            <div className="prep-row-fields">
              <LinkField id={`b-b-${i.id}`} label="Established at the table" value={i.body} className="wide" placeholder="The dockworker invented on the spot is now named Pell." onCommit={(v) => upItem(act, i, { body: v })} />
              {i.entityId
                ? <button className="link-button" onClick={() => void openSheet(i.entityId!)}>Open card{i.entityName ? `: ${i.entityName}` : ''}</button>
                : <button className="ink-button" disabled={!i.body.trim()} title="A new card named from this line, with the line as its bio (Ctrl+Z undoes)"
                    onClick={async () => { const id = await act('prep:makeCard', { itemId: i.id, type: cardType }); if (id) void openSheet(id) }}>Make a card</button>}
            </div>
          )}
        </PrepSection>
      </div>

      <aside className="prep-side">
        {side.grip}
        {card ? (
          <section className="parchment-note prep-card" aria-label={`Card: ${card.name}`}>
            <div className="row spread">
              <h2 className="panel-title">{card.name}</h2>
              <button className="ink-button" onClick={() => void openSheet(card.id)}>Open full sheet</button>
            </div>
            <span className="ink-muted">{ENTITY_LABELS[card.type]}{card.location ? ` · ${card.location}` : ''}</span>
            <div className="inspector-picture">
              {card.picture ? <img src={`dz-asset://campaign/${card.picture}?w=512`} alt={card.name} draggable={false} /> : <TypeEmblem type={card.type} />}
            </div>
            {card.summary && <p>{card.summary}</p>}
            {card.notes && <><h3 className="panel-subheading">DM notes</h3><p className="prep-card-notes">{card.notes}</p></>}
            <button className="link-button" onClick={() => setShown(null)}>Back to the prep notes</button>
          </section>
        ) : <>
        <section className="parchment-note cheat-sheet">
          <h2 className="panel-title">The one-page test</h2>
          <p>Before bringing anything to the table, ask: <strong>can I use this in the three seconds between a player asking me something and me answering?</strong></p>
          <ul className="ink-list">
            <li>If yes, it belongs on the session page.</li>
            <li>If no, it may still be valuable worldbuilding, but it probably belongs in the world bible, not the table prep.</li>
          </ul>
          <p className="ink-muted">Prep for possibilities, not player decisions. The clues, NPCs, tensions and loose threads give you enough to respond whichever way the players go.</p>
        </section>
        <section className="parchment-note">
          <h2 className="panel-title">Encounters</h2>
          {s.encounters.length === 0 ? <p className="ink-muted">None planned yet.</p> : (
            <ul className="here-list">
              {s.encounters.map((e) => (
                <li key={e.id}><button className="ledger-name" onClick={() => openEncounter(e.id)}>{e.name}</button>{e.placeName && <span className="ink-muted"> · {e.placeName}</span>}</li>
              ))}
            </ul>
          )}
          <button className="ink-button" onClick={() => goTo('encounters')}>Open Encounters</button>
        </section>
        <section className="parchment-note">
          <h2 className="panel-title">Backup names</h2>
          <p className="ink-muted">For people the party meets unexpectedly. One per line.</p>
          <LinkField id="prep-names" label="Names" multiline rows={4} value={p.backupNames} className="label-hidden" onCommit={(v) => up({ backupNames: v })} />
          <button className="ink-button" onClick={async () => {
            const names = await act('prep:rollNames', { count: 4 })
            if (names) up({ backupNames: [p.backupNames.trim(), ...names].filter(Boolean).join('\n') })
          }}>Roll 4 names</button>
        </section>
        <section className="parchment-note">
          <h2 className="panel-title">Notes</h2>
          <LinkField id="prep-notes" label="Notes" multiline rows={4} value={p.notes} className="label-hidden" placeholder="Anything else for this session…" onCommit={(v) => up({ notes: v })} />
        </section>
        </>}
      </aside>
    </div>
    </LinkContext.Provider>
  )
}

/** A prep NPC: tied to a card (picked or made here) it shares the card's name, summary and motivation; Links and Other info fold out. */
function NpcRow({ i, s }: { i: PrepItemView; s: PrepScreenView }) {
  const { act, openSheet } = useBoard()
  const card = i.entityId ? s.cards.find((c) => c.id === i.entityId) : undefined
  const name = (id: string) => s.cards.find((c) => c.id === id)?.name ?? '?'
  const ties = card ? s.strings.filter((r) => r.sourceId === card.id || r.targetId === card.id) : []
  const words = (t: string) => t.replace(/_/g, ' ').toLowerCase()
  return (
    <>
      <div className="prep-row-fields">
        <div className="field npc-card-pick">
          <label htmlFor={`n-card-${i.id}`}>Card</label>
          <div className="row tight">
            <select id={`n-card-${i.id}`} value={i.entityId ?? ''} onChange={(e) => upItem(act, i, { entityId: e.target.value || null })}>
              <option value="">None</option>
              {s.people.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {card
              ? <button className="ink-button" onClick={() => void openSheet(card.id)}>Open</button>
              : <button className="ink-button" disabled={!i.title.trim()} title={i.title.trim() ? 'A new NPC card with this name, description and motivation (Ctrl+Z undoes)' : 'Give the NPC a name first'}
                  onClick={async () => { const id = await act('prep:makeCard', { itemId: i.id, type: 'NPC' }); if (id) void openSheet(id) }}>Make a card</button>}
          </div>
        </div>
        <LinkField id={`n-t-${i.id}`} label="Name" value={i.title} placeholder="Mara Venn" onCommit={(v) => { if (v || !card) upItem(act, i, { title: v }) }} />
        <LinkField id={`n-d-${i.id}`} label="Description" value={i.description} placeholder="Harbour clerk with ink-stained fingers" onCommit={(v) => upItem(act, i, { description: v })} />
        <LinkField id={`n-r-${i.id}`} label="Motivation" value={i.role} placeholder="the party to leave town" onCommit={(v) => upItem(act, i, { role: v })} />
      </div>
      <details className="npc-more">
        <summary>Links and other info</summary>
        <div className="npc-more-body">
          <div className="field">
            <span className="field-label">Links</span>
            {!card ? <p className="ink-muted">Tie or make a card to see its links.</p> : ties.length === 0 ? <p className="ink-muted">No strings on this card yet.</p> : (
              <ul className="ties">
                {ties.map((r) => {
                  const other = r.sourceId === card.id ? r.targetId : r.sourceId
                  return (
                    <li key={r.id}>
                      <span className="tie-type">{r.isSecret ? 'Secret · ' : ''}{words(r.type)}</span> {r.sourceId === card.id ? '→' : '←'}{' '}
                      <button className="link-button" onClick={() => void openSheet(other)}>{name(other)}</button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <LinkField id={`n-b-${i.id}`} label="How to play them" value={i.body} placeholder="Talks too quickly when lying." onCommit={(v) => upItem(act, i, { body: v })} />
          {card && (
            <>
              <LinkField id={`n-l-${i.id}`} label="Location (on the card)" value={card.location} onCommit={(location) => void act('entity:update', { id: card.id, patch: { attributes: { location } } })} />
              <LinkField id={`n-n-${i.id}`} label="DM notes (on the card)" value={card.notes} multiline rows={3} onCommit={(notes) => void act('entity:update', { id: card.id, patch: { attributes: { notes } } })} />
            </>
          )}
        </div>
      </details>
    </>
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
                {DONE_LABEL[kind] && kind !== 'npc' && (
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
