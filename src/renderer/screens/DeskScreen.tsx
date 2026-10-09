import { useEffect, useState } from 'react'
import { useBoard } from '../store'
import { call } from '../api'
import { Candle, CompassRose, D20, Leaf, Potion, Quill } from '../art/props'
import { PartyEmblem, roman, StoryEmblemArt } from '../art/emblems'
import { CampaignSettingsDialog, emblemOf, MapDialog, StorylineDialog, STORYLINE_STATUS_LABELS } from '../components/EditDialogs'
import { TarotCard } from '../art/TarotCard'
import { ClockDial, MoonDisc } from '../art/sky'
import { MapView } from '../components/MapView'
import { readOnlyLayer } from '../components/MapOverlay'
import { DeskFrame } from '../components/DeskFrame'
import { lightingAt, moonOn, skyAt } from '../../shared/sky'
import { useLightingPref } from '../art/TableLighting'
import { formatClock } from '../../shared/time'
import { ImportCharSheet } from '../components/ImportCharSheet'
import type { DeskPartyMember, DeskView } from '../../shared/types'


export function DeskScreen() {
  const desk = useBoard((s) => s.desk)
  return (
    <DeskFrame>
      {desk ? <Desk desk={desk} /> : <p className="desk-loading">Laying out the desk…</p>}
    </DeskFrame>
  )
}

function Desk({ desk }: { desk: DeskView }) {
  const { info, act, showBoard, openSheet, goTo, undo, redo, view, mapScreen } = useBoard()
  const minutes = info?.clockMin ?? 0
  const sky = skyAt(minutes)
  const moon = moonOn(minutes, desk.moonOffsetDays)
  const [newStory, setNewStory] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editStory, setEditStory] = useState<DeskView['storylines'][number] | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [lighting, setLighting] = useLightingPref()
  const candlesLit = !lighting || lightingAt(minutes).candlesLit

  const addStoryline = async () => {
    const title = newStory?.trim()
    if (!title) return
    const b = await act('storyline:create', { title })
    setNewStory(null)
    if (b) useBoard.getState().say(`Added storyline ${title}. Its cards live on its own board view.`)
  }
  const newCard = async (type: 'NPC' | 'PC') => {
    if (!info) return
    const e = await act('entity:create', { boardId: info.globalBoardId, type, name: type === 'PC' ? 'New player character' : 'New NPC' })
    if (e) await openSheet(e.id)
  }

  return (
    <main className="desk" aria-label="DM desk">
      <header className="desk-head">
        <Candle className="desk-candle" lit={candlesLit} />
        <div className="desk-title">
          <span className="desk-eyebrow">The campaign of</span>
          <h1>{info?.name}</h1>
        </div>
        <div className="desk-head-actions">
          <button className="brass" onClick={() => goTo('guide')} title="World map, regions and importing notes, step by step">Getting started</button>
          <button className="brass" onClick={() => setSettingsOpen(true)}>Campaign settings</button>
          <button className="brass light-toggle" aria-pressed={lighting} onClick={() => setLighting(!lighting)}
            title="Day and night lighting follows the campaign clock; candles burn at night">
            {lighting ? 'Lighting: day and night' : 'Lighting: always bright'}
          </button>
          <button className="brass" disabled={!view?.undo.undoLabel} onClick={() => void undo()}
            title={view?.undo.undoLabel ? `Undo: ${view.undo.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}>Undo</button>
          <button className="brass" disabled={!view?.undo.redoLabel} onClick={() => void redo()}
            title={view?.undo.redoLabel ? `Redo: ${view.undo.redoLabel} (Ctrl+Y)` : 'Nothing to redo'}>Redo</button>
        </div>
      </header>

      {/* The DM screen: a wooden frame with parchment panels. */}
      <section className="dm-screen" aria-label="DM screen">
        <div className="dm-panel clock-panel">
          <h2 className="panel-title">The hour</h2>
          <ClockDial minutes={minutes} moonOffsetDays={desk.moonOffsetDays} />
          <div className="clock-row">
            <div>
              <div className="clock-text">{formatClock(minutes)}</div>
              <div className="ink-muted">{{ night: 'Night', dawn: 'Dawn', daylight: 'Daylight', dusk: 'Dusk' }[sky.light]}</div>
            </div>
            <div className="row tight">
              <button className="ink-button" aria-label="Move the clock back one hour" onClick={() => void act('clock:shift', { minutes: -60 })}>−1 h</button>
              <button className="ink-button" aria-label="Move the clock forward one hour" onClick={() => void act('clock:shift', { minutes: 60 })}>+1 h</button>
              <button className="ink-button" onClick={() => setSettingsOpen(true)} title="Set an exact day and time">Set…</button>
            </div>
          </div>
        </div>

        <div className="dm-panel moon-panel">
          <h2 className="panel-title">The moon</h2>
          <MoonDisc minutes={minutes} offsetDays={desk.moonOffsetDays} />
          <div className="moon-name">{moon.name}</div>
          <div className="ink-muted">{moon.nightsUntilFull === 0 ? 'Full tonight' : `Full in ${moon.nightsUntilFull} night${moon.nightsUntilFull === 1 ? '' : 's'}`}</div>
        </div>

        <div className="dm-panel party-panel">
          <h2 className="panel-title">The party</h2>
          {desk.party.length === 0
            ? <p className="ink-muted">No player characters yet.</p>
            : (
              <ul className="ledger">
                {desk.party.map((p) => (
                  <li key={p.id}>
                    <button className="ledger-name" onClick={() => void openSheet(p.id)}>{p.name}</button>
                    <span className="mono">{p.hp ? `HP ${p.hp}` : ''}{p.ac ? ` · AC ${p.ac}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          <div className="row tight wrap">
            <button className="ink-button" onClick={() => void newCard('PC')}>Add a player character</button>
            <ImportCharSheet />
          </div>
        </div>

        <div className="dm-panel ledger-panel">
          <h2 className="panel-title">On the board</h2>
          <ul className="ledger">
            <li><span>Cards</span><span className="mono">{desk.counts.cards}</span></li>
            <li><span>Strings</span><span className="mono">{desk.counts.strings}</span></li>
            <li><span>Storylines</span><span className="mono">{desk.storylines.length}</span></li>
            <li><span>In History</span><span className="mono">{desk.counts.removed}</span></li>
          </ul>
          <button className="ink-button" onClick={() => goTo('board')}>Open the board</button>
        </div>
      </section>

      {/* The leather mat with storylines, the map and the journal. */}
      <section className="mat" aria-label="Campaign table">
        <Leaf className="leaf leaf-a" />
        <Leaf className="leaf leaf-b" colour="#c9862e" />
        <D20 className="mat-d20" />
        <Potion className="mat-potion" />
        <Candle className="mat-candle" lit={candlesLit} />

        <div className="mat-stories">
          <h2 className="mat-heading">Storylines</h2>
          <div className="tarot-stack">
            {desk.storylines.map((s, i) => (
              <div key={s.boardId} className="tarot-slot">
                <TarotCard
                  numeral={roman(i + 1)}
                  title={s.title}
                  subtitle={`${s.isMajor ? 'Major · ' : ''}${STORYLINE_STATUS_LABELS[s.status]}`}
                  art={<StoryEmblemArt emblem={emblemOf(s.storylineId, s.emblem)} />}
                  footer={`${s.cardCount} card${s.cardCount === 1 ? '' : 's'}`}
                  onClick={() => void showBoard(s.boardId)}
                  label={`Open storyline ${s.title} on the board`}
                  dimmed={s.status === 'concluded'}
                />
                <button className="tarot-edit" aria-label={`Edit storyline ${s.title}`} title="Edit storyline"
                  onClick={() => setEditStory(s)}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13 7l4 4" /></svg>
                </button>
              </div>
            ))}
            {newStory === null ? (
              <button className="tarot tarot-new" onClick={() => setNewStory('')}>
                <span className="tarot-plus" aria-hidden="true">+</span>
                <span>New storyline</span>
              </button>
            ) : (
              <form className="tarot tarot-new tarot-form" onSubmit={(e) => { e.preventDefault(); void addStoryline() }}>
                <label htmlFor="desk-new-story">Storyline title</label>
                <input id="desk-new-story" autoFocus value={newStory} onChange={(e) => setNewStory(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setNewStory(null) }} />
                <div className="row tight">
                  <button type="submit" className="ink-button" disabled={!newStory.trim()}>Add</button>
                  <button type="button" className="ink-button" onClick={() => setNewStory(null)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>

        <div className="mat-map">
          <div className="parchment-sheet">
            {desk.map ? (
              <>
                <div className="map-cartouche">
                  <button className="cartouche-button" onClick={() => setMapOpen(true)} title="Rename or remove this map">
                    {desk.map.name}
                  </button>
                </div>
                <MapDialog open={mapOpen} onClose={() => setMapOpen(false)} map={desk.map} />
                <MapView src={desk.map.url} alt={`Map of ${desk.map.name}`} className="desk-mapview" layer={readOnlyLayer(mapScreen, desk.map.id)} />
                <div className="row tight wrap map-actions">
                  <button className="ink-button" onClick={() => goTo('map')}>Open the full map</button>
                  <button className="ink-button" onClick={() => void act('map:importDialog', undefined)}>Import another map</button>
                  {desk.maps.length > 1 && (
                    <>
                      <label htmlFor="desk-map-pick" className="visually-hidden">Show map</label>
                      <select id="desk-map-pick" className="ink-select" value={desk.map.id}
                        onChange={(e) => void act('map:setActive', { mapId: e.target.value })}>
                        {desk.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="map-empty">
                <CompassRose className="map-empty-rose" />
                <h2>No map on the table yet</h2>
                <p>Import a map of your world, region or city. It is copied into the campaign folder, so it works offline.</p>
                <button className="wax" onClick={() => void act('map:importDialog', undefined)}>Import a map</button>
              </div>
            )}
          </div>
        </div>

        <div className="mat-journal">
          <Journal notes={desk.dmNotes} session={desk.dmNotesSession} />
          <div className="chest" aria-label="Quick actions">
            <h2 className="mat-heading">The chest</h2>
            <button className="brass" onClick={() => void newCard('NPC')}>New NPC</button>
            <button className="brass" onClick={() => goTo('library')}>Library and SRD</button>
            <button className="brass" onClick={() => void act('map:importDialog', undefined)}>Import a map</button>
          </div>
        </div>

        <div className="mat-party">
          <h2 className="mat-heading">The party</h2>
          <div className="party-row">
            {desk.party.map((p, i) => <PartyCard key={p.id} p={p} index={i} />)}
            <button className="tarot tarot-new tarot-pc" onClick={() => void newCard('PC')}>
              <span className="tarot-plus" aria-hidden="true">+</span>
              <span>Add a player character</span>
            </button>
          </div>
        </div>
      </section>
      <CampaignSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {editStory && (
        <StorylineDialog open onClose={() => setEditStory(null)} storylineId={editStory.storylineId}
          detail={{ title: editStory.title, status: editStory.status, isMajor: editStory.isMajor, emblem: editStory.emblem, colour: editStory.colour }} />
      )}
    </main>
  )
}

function Journal({ notes, session }: { notes: string; session: number | null }) {
  const act = useBoard((s) => s.act)
  const [draft, setDraft] = useState(notes)
  const [last, setLast] = useState(notes)
  if (notes !== last) { setLast(notes); setDraft(notes) }
  return (
    <div className="journal">
      <div className="journal-page">
        <Quill className="journal-quill" />
        <div className="journal-top">
          <label htmlFor="dm-journal" className="journal-title">DM notes{session ? ` · Session ${session}` : ''}</label>
          <button className="journal-pop" title="Open the notes in their own window; drag it to another screen"
            onClick={() => void call('notes:popout', undefined)}>Pop out</button>
        </div>
        <textarea id="dm-journal" value={draft} placeholder="Plans, reminders, names you made up on the spot…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== notes) void act('notes:set', { text: draft }) }} />
        <span className="journal-hint">Saved when you click away. Only you see these. All notes: Notes.</span>
      </div>
    </div>
  )
}

/** A player character's tarot card on the mat: portrait, and what the DM checks at the table (HP and conditions editable). */
function PartyCard({ p, index }: { p: DeskPartyMember; index: number }) {
  const { act, openSheet } = useBoard()
  const [hp, setHp] = useState(p.currentHp === null ? '' : String(p.currentHp))
  const [conditions, setConditions] = useState(p.conditions)
  useEffect(() => setHp(p.currentHp === null ? '' : String(p.currentHp)), [p.currentHp])
  useEffect(() => setConditions(p.conditions), [p.conditions])
  const saveHp = () => {
    const n = Number.parseInt(hp, 10)
    if (Number.isFinite(n) && n !== p.currentHp) void act('party:setHp', { entityId: p.id, hp: Math.max(0, n) })
    else setHp(p.currentHp === null ? '' : String(p.currentHp))
  }
  const saveConditions = () => { if (conditions.trim() !== p.conditions) void act('entity:update', { id: p.id, patch: { attributes: { conditions: conditions.trim() } } }) }
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur() }
  return (
    <TarotCard
      className="tarot-pc"
      numeral={roman(index + 1)}
      title={p.name}
      subtitle={p.summary || 'Player character'}
      art={p.picture
        ? <img className="tarot-portrait" src={`dz-asset://campaign/${p.picture}`} alt={`Portrait of ${p.name}`} />
        : <PartyEmblem index={index} />}
      tint={p.colour ?? ['#23395b', '#7a2230', '#24553a', '#4b2d6b'][index % 4]}
      footer={(
        <span className="pc-table">
          <span className="pc-stats">
            <span title="Armor class"><b>AC</b> {p.ac || '–'}</span>
            <label title="Hit points now (type and press Enter; Ctrl+Z undoes)"><b>HP</b>
              <input className="pc-hp" inputMode="numeric" value={hp} aria-label={`${p.name} hit points now`} onChange={(e) => setHp(e.target.value)} onBlur={saveHp} onKeyDown={blurOnEnter} />
              <span className="pc-max">/{p.maxHp ?? '–'}{p.tempHp ? ` +${p.tempHp}` : ''}</span>
            </label>
            <span title="Passive Perception"><b>PP</b> {p.passivePerception ?? '–'}</span>
            <span title="Size"><b>Size</b> {p.size || '–'}</span>
          </span>
          {(p.inspiration || p.exhaustion > 0) && <span className="pc-line">{p.inspiration ? '★ Heroic Inspiration' : ''}{p.inspiration && p.exhaustion ? ' · ' : ''}{p.exhaustion ? `Exhaustion ${p.exhaustion}` : ''}</span>}
          {p.resistances && <span className="pc-line" title={p.resistances}>{p.resistances}</span>}
          <input className="pc-conditions" value={conditions} placeholder="No conditions" aria-label={`${p.name} conditions`}
            onChange={(e) => setConditions(e.target.value)} onBlur={saveConditions} onKeyDown={blurOnEnter} />
          <button type="button" className="pc-open" onClick={() => void openSheet(p.id)}>Open sheet</button>
        </span>
      )}
    />
  )
}
