import { useEffect, useState } from 'react'
import { TitleField } from '../components/fields'
import { useBoard } from '../store'
import { freshCard } from '../fresh'
import { call } from '../api'
import { Candle, CompassRose, Leaf, Potion, Quill } from '../art/props'
import { EggCandle, EggDice } from '../art/DeskEggs'
import { PartyEmblem, roman, StoryEmblemArt } from '../art/emblems'
import { CampaignSettingsDialog, emblemOf, MapDialog, StorylineDialog, STORYLINE_STATUS_LABELS } from '../components/EditDialogs'
import { TarotCard } from '../art/TarotCard'
import { ClockDial, MoonDisc } from '../art/sky'
import { HourScene, MoonArt } from '../art/adventure'
import { useSkin } from '../skin'
import { MapView } from '../components/MapView'
import { readOnlyLayer } from '../components/MapOverlay'
import { DeskFrame } from '../components/DeskFrame'
import { ScreenHeader } from '../components/TopBar'
import { lightingAt, skyAt } from '../../shared/sky'
import { ClockDialog, MoonsDialog, calendarNow } from '../components/CalendarDialogs'
import { dayOfMinutes, formatDay, occurrences, timeText, weekdayOf, dateOfDay, seasonOn } from '../../shared/calendar'
import { useLightingPref } from '../art/TableLighting'
import { dayNumberText, formatClock } from '../../shared/time'
import { ImportCharSheet } from '../components/ImportCharSheet'
import { PopOut } from '../components/PopOut'
import { xpProgress } from '../../shared/charsheet'
import { prepOrder } from '../prepParts'
import type { DeskPartyMember, DeskView, PrepItemView, PrepView } from '../../shared/types'


export function DeskScreen() {
  const desk = useBoard((s) => s.desk)
  return (
    <DeskFrame>
      {desk ? <Desk desk={desk} /> : <p className="desk-loading">Laying out the desk…</p>}
    </DeskFrame>
  )
}

function Desk({ desk }: { desk: DeskView }) {
  const { info, act, showBoard, openSheet, goTo, mapScreen, calendar } = useBoard()
  const minutes = info?.clockMin ?? 0
  const sky = skyAt(minutes)
  const today = calendar ? calendarNow(calendar, minutes) : null
  const moons = today?.moons ?? []
  const moon = moons[0]?.state ?? { phase: 0.5, name: 'Full moon', illumination: 1, nightsUntilFull: 0 }
  const [newStory, setNewStory] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [clockOpen, setClockOpen] = useState(false)
  const [moonsOpen, setMoonsOpen] = useState(false)
  const [editStory, setEditStory] = useState<DeskView['storylines'][number] | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [pcChoice, setPcChoice] = useState(false)
  const [lighting] = useLightingPref()
  const adventure = useSkin()[0] === 'adventure'
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
    if (e) { await openSheet(e.id); freshCard(e.id) }
  }

  return (
    <>
    <ScreenHeader title={info ? <TitleField value={info.name} label="Campaign name" onCommit={(name) => void act('campaign:update', { name })} /> : 'Desk'}
      eyebrow="The campaign of" candle={<EggCandle lit={candlesLit} fullMoonNight={moon.name === 'Full moon' && lightingAt(minutes).darkness > 0.5} />}>
      <button className="brass" onClick={() => goTo('guide')} title="World map, regions and importing notes, step by step">Getting started</button>
      <button className="brass" onClick={() => setSettingsOpen(true)}>Campaign settings</button>
    </ScreenHeader>
    <main className="desk" aria-label="DM desk">

      {/* The DM screen: a wooden frame with parchment panels. */}
      <section className="dm-screen" aria-label="DM screen">
        {/* More than three PCs make the panels tall: time and buttons go under a bigger dial (owner, 2026-10-19). */}
        <div className="dm-panel clock-panel">
          <h2 className="panel-title">The hour</h2>
          <div className="dm-panel-row">
            {adventure ? <HourScene minutes={minutes} weather={today?.weather} className="adv-art-hour" />
              : <ClockDial minutes={minutes} moonLit={moon.illumination} cloudy={!!today && today.weather !== 'clear'} />}
            <div className="clock-side">
              <div className="clock-text" title={dayNumberText(minutes)}>{formatClock(minutes)}</div>
              <div className="ink-muted">{{ night: 'Night', dawn: 'Dawn', daylight: 'Daylight', dusk: 'Dusk' }[sky.light]}{today ? ` · ${today.weatherWord}` : ''}</div>
              <div className="row tight wrap">
                <button className="ink-button" aria-label="Move the clock back one hour" onClick={() => void act('clock:shift', { minutes: -60 })}>−1 h</button>
                <button className="ink-button" aria-label="Move the clock forward one hour" onClick={() => void act('clock:shift', { minutes: 60 })}>+1 h</button>
                <button className="ink-button" onClick={() => setClockOpen(true)} title="Set the time of day">Set…</button>
              </div>
            </div>
          </div>
        </div>

        <div className="dm-panel moon-panel">
          <h2 className="panel-title">{moons.length > 1 ? 'The moons' : 'The moon'}</h2>
          <div className={`moon-list${moons.length > 1 ? ' many' : ''}`}>
            {moons.slice(0, 3).map(({ moon: m, state: st }) => (
              <div key={m.name} className="dm-panel-row">
                {adventure ? <MoonArt phase={st.phase} name={`${m.name}: ${st.name}`} className="adv-art-moon" /> : <MoonDisc moon={st} />}
                <div>
                  {moons.length > 1 && <div className="moon-of">{m.name}</div>}
                  <div className="moon-name">{st.name}</div>
                  <div className="ink-muted">{st.nightsUntilFull === 0 ? 'Full tonight' : `Full in ${st.nightsUntilFull} night${st.nightsUntilFull === 1 ? '' : 's'}`}</div>
                </div>
              </div>
            ))}
            {moons.length === 0 && <p className="ink-muted">No moons.</p>}
            {moons.length > 3 && <span className="ink-muted">and {moons.length - 3} more (Calendar)</span>}
          </div>
          <div className="row tight moon-set"><button className="ink-button" onClick={() => setMoonsOpen(true)} title="Moon dates and cycles">Set…</button></div>
        </div>

        <CalendarBox minutes={minutes} />

        <SessionPanel desk={desk} />
      </section>

      {/* The leather mat with storylines, the map and the journal. */}
      <section className="mat" aria-label="Campaign table">
        <Leaf className="leaf leaf-a" />
        <Leaf className="leaf leaf-b" colour="#c9862e" />
        <EggDice />
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
                  <button className="ink-button" onClick={() => goTo('map')}>Full Map / Party Travel Options</button>
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
            <button className="brass" aria-expanded={pcChoice} onClick={() => setPcChoice(!pcChoice)}>Add a player character</button>
            {pcChoice && (
              <div className="chest-choice">
                <button className="brass" onClick={() => { setPcChoice(false); void newCard('PC') }}>Create from scratch</button>
                <ImportCharSheet className="brass" label="Import a character sheet…" />
              </div>
            )}
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
      <ClockDialog open={clockOpen} onClose={() => setClockOpen(false)} />
      <MoonsDialog open={moonsOpen} onClose={() => setMoonsOpen(false)} />
      {editStory && (
        <StorylineDialog open onClose={() => setEditStory(null)} storylineId={editStory.storylineId}
          detail={{ title: editStory.title, status: editStory.status, isMajor: editStory.isMajor, emblem: editStory.emblem, colour: editStory.colour }} />
      )}
    </main>
    </>
  )
}

/** Desk › Calendar (3.9, replaces The party; owner 2026-10-22): the date, the next events, Open calendar. */
function CalendarBox({ minutes }: { minutes: number }) {
  const { calendar, showCalendar } = useBoard()
  if (!calendar) return <div className="dm-panel calendar-panel"><h2 className="panel-title">Calendar</h2></div>
  const def = calendar.def
  const day = dayOfMinutes(minutes)
  const date = dateOfDay(def, day)
  const wd = weekdayOf(def, date)
  const s = seasonOn(def, date)
  const beats = calendar.acts.filter((a) => a.startMin >= minutes).map((a) => ({ key: a.id, at: a.startMin, day: dayOfMinutes(a.startMin), title: `${a.title}`, colour: '#5c6b73' }))
  const next = [
    ...occurrences(def, calendar.events, day, day + 400).filter((o) => o.startDay > day || o.event.allDay || o.startMin >= minutes)
      .map((o) => ({ key: o.event.id + o.startDay, at: o.startMin, day: o.startDay, title: o.event.title, colour: o.event.colour })),
    ...beats
  ].sort((a, b) => a.at - b.at).slice(0, 3)
  return (
    <div className="dm-panel calendar-panel">
      <h2 className="panel-title">Calendar</h2>
      <div className="cal-box-date" title={`Day ${day + 1}`}>{formatDay(def, day)}</div>
      <div className="ink-muted">{[wd !== null ? def.weekdays[wd] : null, s >= 0 ? def.seasons[s].name : null].filter(Boolean).join(' · ')}</div>
      <ul className="cal-box-next" aria-label="Coming up">
        {next.map((n) => (
          <li key={n.key} title={`${formatDay(def, n.day)}: ${n.title}`}>
            <span className="cal-dot" style={{ background: n.colour }} aria-hidden="true" />
            <span className="cal-when">{n.day === day ? (n.at % 1440 ? timeText(n.at) : 'Today') : formatDay(def, n.day, false)}</span>
            <span className="cal-what">{n.title}</span>
          </li>
        ))}
        {next.length === 0 && <li className="ink-muted">Nothing coming up.</li>}
      </ul>
      <div className="row tight cal-box-actions"><button className="ink-button primary-ink" onClick={() => showCalendar(null, 'month')}>Open calendar</button></div>
    </div>
  )
}

// The section the Session box shows; kept while the app is open.
let sessionPart = 0

/**
 * Desk › Session (owner, 2026-10-15): the running or next session's prep sheet, one section at a time (‹ › flip, in the
 * DM's order from Session prep). Short lines; hover shows the rest. ⧉ opens that section in a window of its own.
 */
function SessionPanel({ desk }: { desk: DeskView }) {
  const { goTo, act } = useBoard()
  const [prep, setPrep] = useState<PrepView | null | undefined>(undefined)
  const [at, setAt] = useState(sessionPart)
  // The desk view changes with every write, so the sheet here follows edits made anywhere.
  useEffect(() => { void call('prep:view', {}).then(setPrep).catch(() => setPrep(null)) }, [desk])
  const parts = prepOrder()
  const i = ((at % parts.length) + parts.length) % parts.length
  const part = parts[i]
  const flip = (d: number) => { sessionPart = i + d; setAt(i + d) }
  if (prep === undefined) return <div className="dm-panel session-panel"><h2 className="panel-title">Session</h2></div>
  if (!prep) {
    return (
      <div className="dm-panel session-panel">
        <h2 className="panel-title">Session</h2>
        <p className="ink-muted">No prep sheet for the next session yet.</p>
        <button className="ink-button" onClick={() => goTo('prep')}>Open Session prep</button>
      </div>
    )
  }
  const items = prep.items.filter((x) => x.kind === part.kind)
  const lines: Array<{ id: string; text: string; more: string; done?: boolean }> =
    part.kind === 'opening' ? (prep.premise ? [{ id: 'o', text: prep.premise, more: prep.premise }] : [])
      : part.kind === 'recap' ? [
          ...(prep.session?.recap ? [{ id: 'h', text: `Happened: ${prep.session.recap}`, more: prep.session.recap }] : []),
          ...(prep.wantNext ? [{ id: 'w', text: `Want next: ${prep.wantNext}`, more: prep.wantNext }] : [])
        ]
      : items.map((x) => ({ id: x.id, text: lineOf(x), more: moreOf(x), done: x.done }))
  return (
    <div className="dm-panel session-panel">
      <div className="session-head">
        <PopOut title="Open the whole Session prep in a window of its own" onClick={() => void call('window:popScreen', { screen: 'prep' })} />
        <h2 className="panel-title" title={prep.title ? `Session ${prep.number}: ${prep.title}` : undefined}><span className="session-title-text">Session {prep.number}{prep.title ? `: ${prep.title}` : ''}</span></h2>
      </div>
      <div className="session-nav">
        <button className="ink-button icon" aria-label="Previous section" title="Previous section" onClick={() => flip(-1)}>‹</button>
        <button className="session-part" title="Open this section on Session prep" onClick={() => { useBoard.setState({ prepNumber: prep.number }); goTo('prep') }}>
          <span className="prep-n" data-n={i + 1} /> {part.name}
        </button>
        <button className="ink-button icon" aria-label="Next section" title="Next section" onClick={() => flip(1)}>›</button>
      </div>
      {lines.length === 0
        ? <p className="ink-muted session-empty">Nothing here yet.</p>
        : (
          <ul className={`session-lines${part.kind === 'opening' || part.kind === 'recap' ? ' is-text' : ''}`}>
            {lines.map((l) => (
              <li key={l.id} title={l.more} className={l.done ? 'is-done' : undefined}>
                {DONE[part.kind]
                  ? <input type="checkbox" checked={!!l.done} aria-label={`${DONE[part.kind]}: ${l.text}`} title={DONE[part.kind]}
                      onChange={(e) => void act('prepItem:done', { id: l.id, done: e.target.checked })} />
                  : null}
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}

const DONE: Record<string, string> = { scene: 'Played', thread: 'Followed up', discovery: 'Revealed' }
const lineOf = (x: PrepItemView): string =>
  x.kind === 'npc' ? (x.entityName || x.title || 'NPC') + (x.description ? `: ${x.description}` : '')
    : x.kind === 'scene' ? (x.title || 'Scene') + (x.body ? `: ${x.body}` : '')
    : x.title || x.body || '(empty)'
const moreOf = (x: PrepItemView): string => [
  x.kind === 'npc' ? x.entityName || x.title : x.title,
  x.kind === 'npc' ? x.description : x.body,
  x.kind === 'scene' && x.locationName ? `At ${x.locationName}` : '',
  x.kind === 'npc' && x.role ? `Wants: ${x.role}` : ''
].filter(Boolean).join('\n')

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
          <PopOut title="Open the notes in their own window; drag it to another screen" onClick={() => void call('notes:popout', undefined)} />
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
        ? <img className="tarot-portrait" src={`dz-asset://campaign/${p.picture}?w=400`} alt={`Portrait of ${p.name}`} />
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
          {(() => {
            const x = xpProgress(p.xp, p.level)
            return <span className={`pc-line${x.levelUp || x.close ? ' pc-xp-close' : ''}`} title="Experience points (fights add to them; change on the sheet)">
              XP {p.xp.toLocaleString()}{x.levelUp ? ` · level ${x.xpLevel} reached` : x.toNext !== null ? ` · ${x.toNext.toLocaleString()} to next level` : ''}</span>
          })()}
          <input className="pc-conditions" value={conditions} placeholder="No conditions" aria-label={`${p.name} conditions`}
            onChange={(e) => setConditions(e.target.value)} onBlur={saveConditions} onKeyDown={blurOnEnter} />
          <button type="button" className="pc-open" onClick={() => void openSheet(p.id)}>Open sheet</button>
        </span>
      )}
    />
  )
}
