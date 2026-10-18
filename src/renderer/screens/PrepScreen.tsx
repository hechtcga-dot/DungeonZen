import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBoard } from '../store'
import { freshRow } from '../fresh'
import { DeskFrame } from '../components/DeskFrame'
import { CommitField } from '../components/fields'
import { Candle } from '../art/props'
import { useLightingPref } from '../art/TableLighting'
import { lightingAt } from '../../shared/sky'
import { formatClock, sessionLabel } from '../../shared/time'
import { ENTITY_TYPES, type EntityType, type PrepKind, type SceneType } from '../../shared/schemas'
import { ENTITY_LABELS } from '../entityStyle'
import type { EntityBrief, PrepItemView, PrepScreenView, PrepView, SheetView } from '../../shared/types'
import { call } from '../api'
import { Dialog } from '../components/Dialog'
import { LocationPick } from '../components/LocationPick'
import { CardPicker } from '../components/LinkField'
import { DEFAULT_LINK, LinkTypeFields, linkInput, linkReady, type LinkChoice } from '../components/LinkTypeFields'
import { readStatBlock, statLine } from '../../shared/statblock'
import { useSidePanel } from '../components/Splitter'
import { LinkContext, LinkField, withAutoLinks } from '../components/LinkField'
import { AddSecretMenu, SECRET_LABEL, SecretEditor } from '../components/SecretEditor'
import { TypeEmblem } from '../art/emblems'
import { ArtDefs } from '../art/ArtDefs'
import { PREP_PARTS, prepNumber } from '../prepParts'
import { PopOut } from '../components/PopOut'
import { SummaryTools } from '../components/SessionSummary'

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
            {prep && <SaveNote p={prep} />}
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

/** Save as notes file (top of the page, owner 2026-10-18): Notes › Sessions, "Session N · Title · date"; then Open in Notes. */
function SaveNote({ p }: { p: PrepView }) {
  const { act, goTo } = useBoard()
  return (
    <>
      <button className="brass" title="Writes this sheet to Notes › Sessions as a Word file; saving again adds a new version of the same file" onClick={async () => {
        const id = await act('prep:saveNote', { id: p.id })
        if (id) useBoard.setState({ message: { text: `Saved to Notes › Sessions as “${sessionLabel(p.number, p.title, p.playDate)}”.`, isError: false } })
      }}>{p.noteDocId ? 'Save to notes again' : 'Save as notes file'}</button>
      {p.noteDocId && <button className="brass" onClick={() => { useBoard.setState({ notesTab: 'notes', notesOpenId: p.noteDocId, notesOpenHeading: null }); goTo('import') }}>Open in Notes</button>}
    </>
  )
}

function Sheet({ p, s, only }: { p: PrepView; s: PrepScreenView; only?: string }) {
  const side = useSidePanel('prep-side', 'right', 300)
  const { act, say, goTo, openEncounter, openSheet } = useBoard()
  const items = (k: PrepKind) => p.items.filter((i) => i.kind === k)
  const scenes = items('scene')
  const sceneMins = scenes.length ? Math.round(p.pacingMinutes / scenes.length) : null
  const up = (patch: { title?: string; premise?: string; pacingMinutes?: number; backupNames?: string; notes?: string; number?: number; wantNext?: string; playDate?: string | null }) =>
    void act('prep:update', { id: p.id, patch })
  const [pacing, setPacing] = useState(hm(p.pacingMinutes))
  const [cardType, setCardType] = useState<EntityType>('NPC')

  // Words linked to cards: the card shows in the side panel while the cursor is in them; a click elsewhere drops it.
  const [shown, setShown] = useState<string | null>(null)
  const wordLinks = useBoard((st) => st.wordLinks)
  const links = useMemo(() => withAutoLinks(wordLinks, p.links,
    (next) => void act('prep:update', { id: p.id, patch: { links: next } }), setShown), [wordLinks, p.links, p.id, act])
  const card = shown ? s.cards.find((c) => c.id === shown) : undefined
  // In a pop-out window only one section (or one NPC) shows.
  const show = (part: string) => !only || only === part
  const pop = (part: string) => !only && (
    <PopOut title="Open this section in a window of its own (drag it to another screen)" onClick={() => void call('prep:popout', { number: p.number, part })} />
  )
  if (only?.startsWith('npc:')) {
    const list = items('npc')
    const k = list.findIndex((x) => x.id === only.slice(4))
    return (
      <LinkContext.Provider value={links}>
        <section className="parchment-sheet prep-section">
          {k < 0 ? <p className="ink-muted">This NPC is no longer on the prep sheet.</p> : <NpcRow i={list[k]} s={s} k={k} count={list.length} />}
        </section>
      </LinkContext.Provider>
    )
  }

  return (
    <LinkContext.Provider value={links}>
    <div className="prep-layout" style={side.style}>
      <div className="prep-main" onMouseDown={() => setShown(null)}>
        {!only && <section className="parchment-sheet prep-head" aria-label="Session">
          <div className="prep-head-grid">
            <CommitField id="prep-title" label="Session title" value={p.title} placeholder="The Drowned Bell" onCommit={(v) => up({ title: v })} />
            <div className="field">
              <label htmlFor="prep-number">For session</label>
              <input id="prep-number" className="short" type="number" min={1} defaultValue={p.number} key={p.number}
                onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n !== p.number) up({ number: n }) }} />
            </div>
            <div className="field">
              <label htmlFor="prep-date">Played on</label>
              <input id="prep-date" type="date" value={p.playDate ?? ''} title="The real-life date of this session; it labels the session's notes"
                onChange={(e) => up({ playDate: e.target.value || null })} />
            </div>
            <div className="field">
              <label htmlFor="prep-pacing" title="Pacing target, hours:minutes">Pacing (h:mm)</label>
              <input id="prep-pacing" className="short" value={pacing} onChange={(e) => setPacing(e.target.value)}
                onBlur={() => { const m = parseHm(pacing); if (m && m >= 15 && m !== p.pacingMinutes) up({ pacingMinutes: m }); else setPacing(hm(p.pacingMinutes)) }} />
              <span className="hint">{scenes.length ? `${scenes.length} scene${scenes.length === 1 ? '' : 's'}, about ${sceneMins} min each` : 'Add scenes below'}</span>
            </div>
          </div>
        </section>}

        {show('opening') && <section className="parchment-sheet prep-section" aria-labelledby="prep-opening">
          <h2 id="prep-opening" className="panel-title"><span className="prep-n" data-n={prepNumber('opening')} /> Session opening {pop('opening')}</h2>
          <p className="ink-muted prep-hint">One sentence describing how the session begins. Start with something happening rather than asking the players what they want to do.</p>
          <LinkField id="prep-premise" label="Opening" className="label-hidden" multiline rows={2} value={p.premise}
            placeholder="Someone is pounding on the door at 2 a.m." onCommit={(v) => up({ premise: v })} />
        </section>}

        {show('scene') && <PrepSection pop={pop('scene')} p={p} kind="scene" n={prepNumber('scene')} title="Likely scenes" hint="3–5 possible scenes. Keep each to a location + tension. These are possibilities, not a script."
          add={null} extra={<>
            {scenes.length > 1 && <button className="ink-button" onClick={() => void act('prep:spread', { prepId: p.id })}>Spread times evenly</button>}
            <select className="ink-button primary-ink" value="" aria-label="Add a scene" onChange={(e) => {
              if (e.target.value === 'scene') void act('prepItem:add', { prepId: p.id, kind: 'scene' }).then((id) => id && freshRow(id))
              if (e.target.value === 'encounter') void act('prep:addEncounter', { prepId: p.id })
            }}>
              <option value="">Add a scene…</option>
              <option value="scene">Scene</option>
              <option value="encounter">Encounter</option>
            </select>
          </>}>
          {(i, k) => i.encounter ? <EncounterScene i={i} n={k + 1} locations={s.locations} /> : (
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
        </PrepSection>}

        {show('discovery') && <PrepSection pop={pop('discovery')} p={p} kind="discovery" n={prepNumber('discovery')} title="Links, secrets, clues" hint="Things that are true about the world, each tied to the cards it is about (a link on the board for each). Don’t decide in advance where or how the players will discover them. Revealed ones show in Player preview."
          add={null} extra={<AddSecretMenu prepId={p.id} secrets={s.secrets} />}>
          {(i, k) => {
            const sec = i.secretId ? s.secrets.find((x) => x.id === i.secretId) ?? null : null
            const label = `${SECRET_LABEL[sec?.kind ?? 'secret']} ${k + 1}`
            return (
              <>
                <div className="prep-row-fields">
                  <LinkField id={`d-b-${i.id}`} label={label} value={i.body} className="wide" placeholder="The harbormaster was paid to keep quiet."
                    onCommit={(v) => upItem(act, i, { body: v })} />
                  <LinkField id={`d-t-${i.id}`} label="Short name (optional)" value={i.title} onCommit={(v) => upItem(act, i, { title: v })} />
                </div>
                {!sec && i.entityId && (
                  <p className="ink-muted">Shares its text with the Clue card <button className="link-button" onClick={() => void openSheet(i.entityId!)}>{s.cards.find((c) => c.id === i.entityId)?.name ?? 'a card'}</button>
                    {' · '}<button className="link-button" title="This line keeps its text; the card keeps its description" onClick={() => upItem(act, i, { entityId: null })}>Untie</button></p>
                )}
                <SecretEditor key={sec?.id ?? i.id} secret={sec} kind={sec?.kind ?? 'secret'} cards={s.cards} text={i.body} prepItemId={i.id} />
              </>
            )
          }}
        </PrepSection>}

        {show('npc') && <PrepSection pop={pop('npc')} p={p} kind="npc" n={prepNumber('npc')} title="NPCs" hint="Who they are and what they want. Tied to a card, the name, flaws, motivation, description, location and DM notes are the card's own: change them here or on the card."
          add="Add an NPC">
          {(i, k, count) => <NpcRow i={i} s={s} k={k} count={count} />}
        </PrepSection>}

        {show('thread') && <PrepSection pop={pop('thread')} p={p} kind="thread" n={prepNumber('thread')} title="Loose threads" hint="Three unresolved things from the previous session. Possibilities to keep in mind, not objectives to force onto the players."
          add="Add a thread" extra={p.number > 1 && <button className="ink-button" title="Copies last session’s “what the players seem to want next” and its threads not ticked off"
            onClick={async () => { const n = await act('prep:bringThreads', { prepId: p.id }); if (n === 0) say('Nothing new to bring in from last session.') }}>Bring in from last session</button>}>
          {(i, k) => <LinkField id={`l-b-${i.id}`} label={`Thread ${k + 1}`} value={i.body} placeholder="The party promised to investigate the abandoned mine." onCommit={(v) => upItem(act, i, { body: v })} />}
        </PrepSection>}

        {show('recap') && <section className="parchment-sheet prep-section" aria-labelledby="prep-recap">
          <h2 id="prep-recap" className="panel-title"><span className="prep-n" data-n={prepNumber('recap')} /> Session recap {pop('recap')}</h2>
          <p className="ink-muted prep-hint">Write this after the session. The summary is the session’s “What happened” (the same text in Review and Notes, and first in the notes file).</p>
          {p.session
            ? <>
                <LinkField id="prep-happened" label="Summary (what happened)" multiline rows={4} value={p.session.recap}
                  onCommit={(v) => void act('session:update', { id: p.session!.id, patch: { recap: v } })} />
                <SummaryTools sessionId={p.session.id} value={p.session.recap} onSave={(v) => void act('session:update', { id: p.session!.id, patch: { recap: v } })} />
              </>
            : <p className="ink-muted">Summary: write it here once session {p.number} has started.</p>}
          <LinkField id="prep-want" label="What the players seem to want next" multiline rows={2} value={p.wantNext}
            placeholder="They want to track the escaped smuggler and find out who hired him." onCommit={(v) => up({ wantNext: v })} />
        </section>}

        {show('bible') && <PrepSection pop={pop('bible')} p={p} kind="bible" n={prepNumber('bible')} title="World bible updates" hint="Add anything established during play. If something happens at the table, it is now part of the world unless you deliberately retcon it."
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
        </PrepSection>}
      </div>

      {!only && <aside className="prep-side">
        {side.grip}
        {card ? (
          <section className="parchment-note prep-card" aria-label={`Card: ${card.name}`}>
            <div className="row spread">
              <h2 className="panel-title">{card.name}</h2>
              <button className="ink-button" onClick={() => void openSheet(card.id)}>Open full sheet</button>
            </div>
            <span className="ink-muted">{ENTITY_LABELS[card.type]}{card.location ? ` · ${card.location}` : ''}</span>
            <div className="inspector-picture">
              {card.picture ? <img src={`dz-asset://campaign/${card.picture}?w=512`} alt={card.name} /> : <TypeEmblem type={card.type} />}
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
      </aside>}
    </div>
    </LinkContext.Provider>
  )
}

const NEW_NPC = '\u0000new'
/** What "Show from the sheet" can show under a prep NPC (ticks kept on the prep line). */
const SHOW_PARTS = [
  { key: 'statblock', label: 'Stat block summary' }, { key: 'personality', label: 'Personality' }, { key: 'ideals', label: 'Ideals' },
  { key: 'bonds', label: 'Bonds' }, { key: 'voice', label: 'Voice' }, { key: 'tactics', label: 'Tactics' },
  { key: 'actions', label: 'Actions' }, { key: 'spells', label: 'Spells' }
] as const

/**
 * A prep NPC (owner, 2026-10-14): icon tools on top; Name (a card, + Create new NPC… or a one-time NPC without a card),
 * Flaws and Motivation (the card's own); the fold holds Location, Description, Links (+ New link) and DM notes, and
 * "Show from the sheet" ticks.
 */
export function NpcRow({ i, s, k, count }: { i: PrepItemView; s: PrepScreenView; k: number; count: number }) {
  const { act, openSheet } = useBoard()
  const card = i.entityId ? s.cards.find((c) => c.id === i.entityId) : undefined
  const name = (id: string) => s.cards.find((c) => c.id === id)?.name ?? '?'
  const ties = card ? s.strings.filter((r) => r.sourceId === card.id || r.targetId === card.id) : []
  const words = (t: string) => t.replace(/_/g, ' ').toLowerCase()
  const [making, setMaking] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const links = useRef<HTMLDivElement>(null)
  const [linksH, setLinksH] = useState(0)
  useEffect(() => {
    const el = links.current
    if (!el) return
    const ro = new ResizeObserver(() => setLinksH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [card?.id])
  const make = async () => {
    const { info } = useBoard.getState()
    if (!making?.trim() || !info) return
    const made = await act('entity:create', { boardId: info.globalBoardId, type: 'NPC', name: making.trim() })
    setMaking(null)
    if (made) upItem(act, i, { entityId: made.id })
  }
  const shown = i.stats.split(',').filter(Boolean)
  return (
    <div className="npc-row">
      <div className="npc-head">
        <strong className="npc-title">{card?.name ?? (i.title || 'New NPC')}</strong>
        <span className="row tight npc-tools">
          <button className="ink-button icon" title="Move up" aria-label="Move up" disabled={k === 0} onClick={() => void act('prepItem:move', { id: i.id, direction: -1 })}>↑</button>
          <button className="ink-button icon" title="Move down" aria-label="Move down" disabled={k === count - 1} onClick={() => void act('prepItem:move', { id: i.id, direction: 1 })}>↓</button>
          <button className="ink-button icon" title={card ? 'Open card' : 'No card to open (one-time NPC)'} aria-label="Open card" disabled={!card} onClick={() => card && void openSheet(card.id)}>↗</button>
          <PopOut title="Open this NPC in a window of its own" onClick={() => void call('prep:popout', { number: useBoard.getState().prep?.number ?? 1, part: `npc:${i.id}` })} />
          <button className="ink-button icon danger-ink" title="Remove (History brings it back)" aria-label="Remove" onClick={() => void act('prepItem:setStatus', { id: i.id, status: 'defunct' })}>🗑</button>
        </span>
      </div>
      <div className="prep-row-fields npc-top">
        <div className="field">
          <label htmlFor={`n-card-${i.id}`}>Name</label>
          {making === null ? (
            <select id={`n-card-${i.id}`} value={i.entityId ?? ''} onChange={(e) => {
              if (e.target.value === NEW_NPC) setMaking(i.entityId ? '' : i.title)
              else upItem(act, i, { entityId: e.target.value || null })
            }}>
              <optgroup label="NPC cards">{s.people.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
              <option value={NEW_NPC}>+ Create new NPC…</option>
              <option value="">One-time NPC (does not create card)</option>
            </select>
          ) : (
            <form className="row tight" onSubmit={(e) => { e.preventDefault(); void make() }}>
              <input autoFocus value={making} maxLength={200} placeholder="Name of the new NPC" aria-label="Name of the new NPC" onChange={(e) => setMaking(e.target.value)} />
              <button type="submit" disabled={!making.trim()}>Make</button>
              <button type="button" onClick={() => setMaking(null)}>Cancel</button>
            </form>
          )}
          {!card && making === null && (
            <LinkField id={`n-t-${i.id}`} label="Name of the one-time NPC" className="label-hidden" value={i.title} placeholder="Gate guard Bryn" onCommit={(v) => upItem(act, i, { title: v })} />
          )}
        </div>
        {card
          ? <LinkField id={`n-f-${i.id}`} label="Flaws" value={card.flaws} placeholder="Drinks to forget the war" onCommit={(flaws) => void act('entity:update', { id: card.id, patch: { attributes: { flaws } } })} />
          : <LinkField id={`n-f-${i.id}`} label="Flaws" value={i.body} placeholder="Drinks to forget the war" onCommit={(v) => upItem(act, i, { body: v })} />}
        <LinkField id={`n-r-${i.id}`} label="Motivation" value={i.role} placeholder="the party to leave town" onCommit={(v) => upItem(act, i, { role: v })} />
      </div>
      <details className="npc-more">
        <summary>Links and other info</summary>
        {!card ? (
          <div className="npc-more-body">
            <LinkField id={`n-d-${i.id}`} label="Description" multiline rows={2} value={i.description} placeholder="Harbour clerk with ink-stained fingers" onCommit={(v) => upItem(act, i, { description: v })} />
            <p className="ink-muted">A one-time NPC has no card. <button className="link-button" disabled={!i.title.trim()} title={i.title.trim() ? 'A new NPC card with this name, description and motivation (Ctrl+Z undoes)' : 'Give the NPC a name first'}
              onClick={async () => { const id = await act('prep:makeCard', { itemId: i.id, type: 'NPC' }); if (id) void openSheet(id) }}>Make a card</button> for location, links and DM notes.</p>
          </div>
        ) : (
          <>
            <div className="npc-grid">
              <LocationPick id={`n-l-${i.id}`} value={card.location} exclude={card.id} onChange={(location) => void act('entity:update', { id: card.id, patch: { attributes: { location } } })} />
              <LinkField id={`n-d-${i.id}`} label="Description" multiline rows={2} value={i.description} placeholder="Harbour clerk with ink-stained fingers" onCommit={(v) => upItem(act, i, { description: v })} />
              <div className="field">
                <span className="field-label">Links</span>
                <div ref={links} className="npc-links">
                  {ties.length === 0 ? <p className="ink-muted">No links on this card yet.</p> : (
                    <ul className="ties">
                      {ties.map((r) => {
                        const other = r.sourceId === card.id ? r.targetId : r.sourceId
                        return (
                          <li key={r.id}>
                            <span className="tie-type">{r.isSecret ? 'Secret · ' : ''}{words(r.type)}</span> {r.sourceId === card.id ? '→' : '←'}{' '}
                            <button className="link-button" onClick={() => void openSheet(other)}>{name(other)}</button>{' '}
                            <button className="link-button danger-link" aria-label="Remove this link" title="Remove this link (it goes to History; Ctrl+Z undoes)"
                              onClick={() => void act('relationship:setStatus', { id: r.id, status: 'defunct' })}>×</button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <button className="ink-button" onClick={() => setLinking(true)}>+ New link</button>
                </div>
              </div>
              <LinkField id={`n-n-${i.id}`} label="DM notes" multiline rows={2} value={card.notes} minHeight={card.notes ? undefined : Math.min(linksH, 200)}
                placeholder="Notes for you only…" onCommit={(notes) => void act('entity:update', { id: card.id, patch: { attributes: { notes } } })} />
            </div>
            <ShowFromSheet i={i} cardId={card.id} shown={shown} />
          </>
        )}
      </details>
      {linking && card && <NewLinkDialog from={card} cards={s.cards} onClose={() => setLinking(false)} />}
    </div>
  )
}

/** Ticked parts of the NPC's card, read-only (change them on the card). */
function ShowFromSheet({ i, cardId, shown }: { i: PrepItemView; cardId: string; shown: string[] }) {
  const { act, view } = useBoard()
  const [sheet, setSheet] = useState<SheetView | null>(null)
  useEffect(() => { if (shown.length) void call('sheet:view', { entityId: cardId }).then(setSheet).catch(() => setSheet(null)) }, [cardId, shown.length, view?.undo])
  const a = (sheet?.entity.attributes ?? {}) as Record<string, unknown>
  const t = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '')
  const sb = readStatBlock(a.statblock)
  const part = (key: string): ReactNode => {
    if (!sheet) return null
    if (key === 'statblock') return sb ? <>{statLine(sb) || 'No stat block details yet'}<br /><span className="ink-muted">STR {sb.str} DEX {sb.dex} CON {sb.con} INT {sb.int} WIS {sb.wis} CHA {sb.cha}{sb.speed ? ` · Speed ${sb.speed}` : ''}</span></> : 'No stat block on this card.'
    if (key === 'actions' || key === 'spells') {
      const list = sheet.abilities.filter((x) => (key === 'spells') === (x.kind === 'SPELL'))
      return list.length ? list.map((x) => x.name).join(' · ') : 'None on the card.'
    }
    return t(key) || 'Empty on the card.'
  }
  return (
    <details className="npc-show" open={shown.length > 0}>
      <summary>Show from the sheet <span className="ink-muted">(this NPC)</span></summary>
      <div className="row tight wrap">
        {SHOW_PARTS.map((p) => (
          <label key={p.key} className="field checkbox">
            <input type="checkbox" checked={shown.includes(p.key)}
              onChange={(e) => upItem(act, i, { stats: (e.target.checked ? [...shown, p.key] : shown.filter((x) => x !== p.key)).join(',') })} /> {p.label}
          </label>
        ))}
      </div>
      {SHOW_PARTS.filter((p) => shown.includes(p.key)).map((p) => (
        <div key={p.key} className="npc-show-part"><strong>{p.label}:</strong> {part(p.key)}</div>
      ))}
    </details>
  )
}

/** + New link from a prep NPC: this card – link type – another card (picked or made). A string on the board, Ctrl+Z undoes. */
function NewLinkDialog({ from, cards, onClose }: { from: EntityBrief; cards: EntityBrief[]; onClose(): void }) {
  const act = useBoard((st) => st.act)
  const [choice, setChoice] = useState<LinkChoice>(DEFAULT_LINK)
  const [target, setTarget] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const save = async () => {
    if (!target || !linkReady(choice)) return
    await act('relationship:create', { sourceId: from.id, targetId: target, ...linkInput(choice) })
    onClose()
  }
  return (
    <Dialog title="New link" open onClose={onClose}>
      <div className="dz-form">
        <div className="new-link-row">
          <div className="field"><span className="field-label">Card</span><p><strong>{from.name}</strong></p></div>
          <div><LinkTypeFields id={`nl-${from.id}`} value={choice} onChange={setChoice} /></div>
          <div className="field"><span className="field-label">Card</span>
            <button type="button" onClick={() => setPicking(true)}>{target ? cards.find((c) => c.id === target)?.name ?? 'A card' : 'Pick or make a card…'}</button></div>
        </div>
        <div className="dz-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!target || !linkReady(choice)} onClick={() => void save()}>Add link</button>
        </div>
      </div>
      {picking && <CardPicker words="" title="Link to which card?" cards={cards.filter((c) => c.id !== from.id)} onClose={() => setPicking(false)} onPick={(id) => { setTarget(id); setPicking(false) }} />}
    </Dialog>
  )
}

/** A likely scene that is an encounter: its main fields here, everything else on Encounters. */
function EncounterScene({ i, n, locations }: { i: PrepItemView; n: number; locations: EntityBrief[] }) {
  const { act, openEncounter } = useBoard()
  const e = i.encounter!
  const up = (patch: Record<string, unknown>) => void act('encounter:update', { id: i.entityId!, patch })
  return (
    <>
      <div className="prep-row-fields">
        <CommitField id={`e-n-${i.id}`} label={`Encounter ${n}`} value={e.name} onCommit={(v) => v.trim() && up({ name: v.trim() })} />
        <CardPick id={`e-loc-${i.id}`} label="Location card" value={e.locationId} cards={locations} onPick={(v) => up({ locationId: v })} />
        <div className="field">
          <label htmlFor={`e-t-${i.id}`}>Aim for</label>
          <select id={`e-t-${i.id}`} value={e.target} onChange={(ev) => up({ target: ev.target.value })}>
            <option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option>
          </select>
        </div>
        <TimeRange i={i} />
      </div>
      <LinkField id={`e-b-${i.id}`} label="What happens" value={e.scene} placeholder="Bandits wait at the ford; they want the cart, not a fight." onCommit={(v) => up({ scene: v })} />
      <div className="row tight wrap">
        <span className="ink-muted">{e.creatures ? `${e.creatures} creature${e.creatures === 1 ? '' : 's'}` : 'No creatures yet'}</span>
        <button className="ink-button" title="Monsters, battle map, story and the rest" onClick={() => openEncounter(i.entityId!)}>Open in Encounters</button>
      </div>
    </>
  )
}

function upItem(act: ReturnType<typeof useBoard.getState>['act'], i: PrepItemView, patch: Record<string, unknown>) {
  void act('prepItem:update', { id: i.id, patch })
}

function PrepSection({ p, kind, n, title, hint, add, extra, children, pop }: {
  p: PrepView; kind: PrepKind; n: number; title: string; hint: string; add: string | null; extra?: ReactNode; pop?: ReactNode
  children(i: PrepItemView, index: number, count: number): ReactNode
}) {
  const act = useBoard((s) => s.act)
  const list = p.items.filter((i) => i.kind === kind)
  return (
    <section className="parchment-sheet prep-section" aria-labelledby={`prep-${kind}`}>
      <div className="prep-section-head">
        <h2 id={`prep-${kind}`} className="panel-title"><span className="prep-n" data-n={n} /> {title} {pop}</h2>
        <div className="row tight wrap">
          {extra}
          {add && <button className="ink-button primary-ink" onClick={() => void act('prepItem:add', { prepId: p.id, kind }).then((id) => id && freshRow(id))}>{add}</button>}
        </div>
      </div>
      <p className="ink-muted prep-hint">{hint}</p>
      {list.length === 0 ? <p className="ink-muted">None yet.</p> : (
        <ol className="prep-list">
          {list.map((i, k) => (
            <li key={i.id} data-row={i.id} className={`prep-item${i.done ? ' is-done' : ''}`}>
              <div className="prep-item-body">{children(i, k, list.length)}</div>
              {kind !== 'npc' && <div className="prep-item-tools">
                {DONE_LABEL[kind] && (
                  <label className="prep-done">
                    <input type="checkbox" checked={i.done} onChange={(e) => void act('prepItem:done', { id: i.id, done: e.target.checked })} />
                    {DONE_LABEL[kind]}{i.done && i.doneAtMin != null ? <span className="ink-muted"> {formatClock(i.doneAtMin)}</span> : null}
                  </label>
                )}
                <button className="ink-button" aria-label="Move up" disabled={k === 0} onClick={() => void act('prepItem:move', { id: i.id, direction: -1 })}>↑</button>
                <button className="ink-button" aria-label="Move down" disabled={k === list.length - 1} onClick={() => void act('prepItem:move', { id: i.id, direction: 1 })}>↓</button>
                <button className="ink-button danger-ink" onClick={() => void act('prepItem:setStatus', { id: i.id, status: 'defunct' })}>Remove</button>
              </div>}
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

/**
 * A pop-out window with one prep section or one NPC (owner, 2026-10-14). It reads and writes the same campaign as the
 * main window; changes either side show on both. Card sheets open in the main window.
 */
export function PrepWindow({ number, part }: { number: number; part: string }) {
  const { prep, prepScreen } = useBoard()
  const [none, setNone] = useState(false)
  useEffect(() => {
    useBoard.setState({ openSheet: async (entityId: string) => { await call('main:openSheet', { entityId }) } })
    void (async () => {
      const info = await call('campaign:info', undefined).catch(() => null)
      if (!info) { setNone(true); return }
      useBoard.setState({ info, boardId: info.globalBoardId, screen: 'prep', prepNumber: number })
      await useBoard.getState().refresh()
    })()
    return window.dungeonzen.onChanged(() => void useBoard.getState().refresh())
  }, [number])
  const names: Record<string, string> = Object.fromEntries(PREP_PARTS.map((x) => [x.kind, x.name]))
  const npc = part.startsWith('npc:') ? prep?.items.find((x) => x.id === part.slice(4)) : undefined
  const title = npc ? (prepScreen?.cards.find((c) => c.id === npc.entityId)?.name ?? (npc.title || 'NPC')) : names[part] ?? 'Session prep'
  useEffect(() => { document.title = `${title} · Session ${number} · Dungeon Zen` }, [title, number])
  return (
    <div className="desk-screen desk-theme prep-window-frame"><ArtDefs /><main className="desk prep-screen prep-window">
      {none ? <p className="desk-loading">Open a campaign in Dungeon Zen first.</p>
        : !prep || !prepScreen ? <p className="desk-loading">Opening…</p>
        : <div className="prep-main"><Sheet p={prep} s={prepScreen} only={part} /></div>}
    </main></div>
  )
}
