import { useState } from 'react'
import { useBoard } from '../store'
import { Candle, CompassRose, D20, Leaf, Potion, Quill } from '../art/props'
import { PartyEmblem, roman, StoryEmblemArt, storyEmblemFor } from '../art/emblems'
import { TarotCard } from '../art/TarotCard'
import { ClockDial, MoonDisc } from '../art/sky'
import { MapView } from '../components/MapView'
import { DeskRail } from '../components/DeskRail'
import { ArtDefs } from '../art/ArtDefs'
import { lightingAt, moonOn, skyAt } from '../../shared/sky'
import { TableLighting, useLightingPref } from '../art/TableLighting'
import { formatClock } from '../../shared/time'
import type { DeskView } from '../../shared/types'

const STATUS_LABELS: Record<string, string> = {
  inactive: 'Not started', autonomous: 'Running on its own', player_active: 'Players active', concluded: 'Concluded'
}

export function DeskScreen() {
  const desk = useBoard((s) => s.desk)
  const minutes = useBoard((s) => s.info?.clockMin ?? 0)
  return (
    <div className="desk-screen">
      <TableLighting minutes={minutes} />
      <ArtDefs />
      <DeskRail />
      {desk ? <Desk desk={desk} /> : <p className="desk-loading">Laying out the desk…</p>}
    </div>
  )
}

function Desk({ desk }: { desk: DeskView }) {
  const { info, act, showBoard, openSheet, goTo, undo, redo, view } = useBoard()
  const minutes = info?.clockMin ?? 0
  const sky = skyAt(minutes)
  const moon = moonOn(minutes, desk.moonOffsetDays)
  const [newStory, setNewStory] = useState<string | null>(null)
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
          <button className="ink-button" onClick={() => void newCard('PC')}>Add a player character</button>
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
              <TarotCard
                key={s.boardId}
                numeral={roman(i + 1)}
                title={s.title}
                subtitle={STATUS_LABELS[s.status] ?? s.status}
                art={<StoryEmblemArt emblem={storyEmblemFor(s.storylineId)} />}
                footer={`${s.cardCount} card${s.cardCount === 1 ? '' : 's'}`}
                onClick={() => void showBoard(s.boardId)}
                label={`Open storyline ${s.title} on the board`}
                dimmed={s.status === 'concluded'}
              />
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
                <div className="map-cartouche"><span>{desk.map.name}</span></div>
                <MapView src={desk.map.url} alt={`Map of ${desk.map.name}`} className="desk-mapview" />
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
          <Journal notes={desk.dmNotes} />
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
            {desk.party.map((p, i) => (
              <TarotCard
                key={p.id}
                className="tarot-pc"
                numeral={roman(i + 1)}
                title={p.name}
                subtitle={p.summary || 'Player character'}
                art={<PartyEmblem index={i} />}
                tint={['#23395b', '#7a2230', '#24553a', '#4b2d6b'][i % 4]}
                footer={(
                  <span className="pc-stats">
                    <span title="Armor class"><b>AC</b> {p.ac || '–'}</span>
                    <span title="Hit points"><b>HP</b> {p.hp || '–'}</span>
                    <span title="Passive Perception"><b>PP</b> {p.passivePerception ?? '–'}</span>
                  </span>
                )}
                onClick={() => void openSheet(p.id)}
                label={`Open ${p.name}'s sheet`}
              />
            ))}
            <button className="tarot tarot-new tarot-pc" onClick={() => void newCard('PC')}>
              <span className="tarot-plus" aria-hidden="true">+</span>
              <span>Add a player character</span>
            </button>
          </div>
        </div>
      </section>
    </main>
  )
}

function Journal({ notes }: { notes: string }) {
  const act = useBoard((s) => s.act)
  const [draft, setDraft] = useState(notes)
  const [last, setLast] = useState(notes)
  if (notes !== last) { setLast(notes); setDraft(notes) }
  return (
    <div className="journal">
      <div className="journal-page">
        <Quill className="journal-quill" />
        <label htmlFor="dm-journal" className="journal-title">DM notes</label>
        <textarea id="dm-journal" value={draft} placeholder="Plans, reminders, names you made up on the spot…"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== notes) void act('notes:set', { text: draft }) }} />
        <span className="journal-hint">Saved when you click away. Only you see these.</span>
      </div>
    </div>
  )
}
