import { useState } from 'react'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import { STORY_EMBLEMS, StoryEmblemArt, storyEmblemFor, type StoryEmblem } from '../art/emblems'
import { RulesEdition, StorylineStatus } from '../../shared/schemas'
import { LUNAR_CYCLE_DAYS } from '../../shared/sky'
import { fromClockParts, toClockParts } from '../../shared/time'
import type { MapView, StorylineDetail } from '../../shared/types'

export const STORYLINE_STATUS_LABELS: Record<StorylineStatus, string> = {
  inactive: 'Not started', autonomous: 'Running on its own', player_active: 'Players active', concluded: 'Concluded'
}

/** Campaign name, rules edition, the exact time and the moon phase. */
export function CampaignSettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Dialog title="Campaign settings" open={open} onClose={onClose}>
      {open && <CampaignSettingsForm onClose={onClose} />}
    </Dialog>
  )
}

function CampaignSettingsForm({ onClose }: { onClose(): void }) {
  const { info, desk, act } = useBoard()
  const clock = toClockParts(info?.clockMin ?? 0)
  const offset = desk?.moonOffsetDays ?? 0
  const [name, setName] = useState(info?.name ?? '')
  const [edition, setEdition] = useState<RulesEdition>(info?.rulesEdition ?? '2024')
  const [day, setDay] = useState(String(clock.day))
  const [hour, setHour] = useState(String(clock.hour))
  const [minute, setMinute] = useState(String(clock.minute).padStart(2, '0'))
  // With offset 0 the moon is full on Day 1; "full on day N" means offset -(N-1) within one cycle.
  const [fullDay, setFullDay] = useState(String(Math.round(((1 - offset - 1) % LUNAR_CYCLE_DAYS + LUNAR_CYCLE_DAYS) % LUNAR_CYCLE_DAYS) + 1))

  const d = Number(day), h = Number(hour), m = Number(minute), f = Number(fullDay)
  const timeValid = Number.isInteger(d) && d >= 1 && Number.isInteger(h) && h >= 0 && h < 24 && Number.isInteger(m) && m >= 0 && m < 60
  const moonValid = Number.isFinite(f) && f >= 1
  const valid = name.trim() !== '' && timeValid && moonValid

  const save = async () => {
    if (!valid || !info) return
    await act('campaign:update', { name: name.trim(), rulesEdition: edition, moonOffsetDays: -(f - 1) })
    const minutes = fromClockParts({ day: d, hour: h, minute: m })
    if (minutes !== info.clockMin) await act('clock:set', { minutes })
    onClose()
  }

  return (
    <form className="dz-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <div className="field">
        <label htmlFor="cs-name">Campaign name</label>
        <input id="cs-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor="cs-edition">Rules edition</label>
        <select id="cs-edition" value={edition} onChange={(e) => setEdition(e.target.value as RulesEdition)}>
          <option value="2024">2024 rules (SRD 5.2)</option>
          <option value="2014">2014 rules (SRD 5.1)</option>
        </select>
      </div>
      <fieldset className="field">
        <legend>Campaign time</legend>
        <div className="row tight wrap">
          <label htmlFor="cs-day">Day</label>
          <input id="cs-day" className="short" inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value)} />
          <label htmlFor="cs-hour">Hour</label>
          <input id="cs-hour" className="short" inputMode="numeric" value={hour} onChange={(e) => setHour(e.target.value)} />
          <label htmlFor="cs-minute">Minute</label>
          <input id="cs-minute" className="short" inputMode="numeric" value={minute} onChange={(e) => setMinute(e.target.value)} />
        </div>
        {!timeValid && <div className="field-error">Day from 1, hour 0 to 23, minute 0 to 59.</div>}
        <div className="hint">Moving the clock is one undoable change. Later, the timeline will use it to move storylines on.</div>
      </fieldset>
      <div className="field">
        <label htmlFor="cs-moon">The moon is full on day</label>
        <input id="cs-moon" className="short" inputMode="numeric" value={fullDay} onChange={(e) => setFullDay(e.target.value)} />
        <div className="hint">The moon then follows a 29.5-day cycle. Custom calendars come later.</div>
      </div>
      <div className="dz-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!valid}>Save</button>
      </div>
    </form>
  )
}

/** Title, status, major or minor, desk emblem; move to History. */
export function StorylineDialog(props: {
  open: boolean
  onClose(): void
  storylineId: string
  detail: StorylineDetail
}) {
  return (
    <Dialog title="Storyline" open={props.open} onClose={props.onClose}>
      {props.open && <StorylineForm {...props} />}
    </Dialog>
  )
}

function StorylineForm({ onClose, storylineId, detail }: { onClose(): void; storylineId: string; detail: StorylineDetail }) {
  const act = useBoard((s) => s.act)
  const [title, setTitle] = useState(detail.title)
  const [status, setStatus] = useState<StorylineStatus>(detail.status)
  const [isMajor, setIsMajor] = useState(detail.isMajor)
  const [emblem, setEmblem] = useState<string | null>(detail.emblem)
  const auto = storyEmblemFor(storylineId)

  const save = async () => {
    if (!title.trim()) return
    await act('storyline:update', { storylineId, patch: { title: title.trim(), status, isMajor, emblem } })
    onClose()
  }
  return (
    <form className="dz-form" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <div className="field">
        <label htmlFor="sl-title">Title</label>
        <input id="sl-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor="sl-status">Status</label>
        <select id="sl-status" value={status} onChange={(e) => setStatus(e.target.value as StorylineStatus)}>
          {StorylineStatus.options.map((s) => <option key={s} value={s}>{STORYLINE_STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      <div className="field checkbox">
        <input id="sl-major" type="checkbox" checked={isMajor} onChange={(e) => setIsMajor(e.target.checked)} />
        <label htmlFor="sl-major">Major storyline</label>
      </div>
      <fieldset className="field">
        <legend>Card picture</legend>
        <div className="emblem-grid" role="radiogroup" aria-label="Card picture">
          <label className={`emblem-choice${emblem === null ? ' is-chosen' : ''}`}>
            <input type="radio" name="sl-emblem" checked={emblem === null} onChange={() => setEmblem(null)} />
            <StoryEmblemArt emblem={auto} />
            <span>Automatic</span>
          </label>
          {(Object.keys(STORY_EMBLEMS) as StoryEmblem[]).map((k) => (
            <label key={k} className={`emblem-choice${emblem === k ? ' is-chosen' : ''}`}>
              <input type="radio" name="sl-emblem" checked={emblem === k} onChange={() => setEmblem(k)} />
              <StoryEmblemArt emblem={k} />
              <span>{k.charAt(0).toUpperCase() + k.slice(1)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="dz-actions">
        <button type="button" className="danger" onClick={async () => {
          await act('storyline:setRemoved', { storylineId, removed: true })
          onClose()
        }}>Move to History</button>
        <span className="spacer" />
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!title.trim()}>Save</button>
      </div>
      <p className="hint">Moving a storyline to History hides its board view. Its cards stay on the global board, and you can restore it from History.</p>
    </form>
  )
}

/** Rename a map or move it to History. */
export function MapDialog({ open, onClose, map }: { open: boolean; onClose(): void; map: MapView }) {
  return (
    <Dialog title="Map" open={open} onClose={onClose}>
      {open && <MapForm map={map} onClose={onClose} />}
    </Dialog>
  )
}

function MapForm({ map, onClose }: { map: MapView; onClose(): void }) {
  const act = useBoard((s) => s.act)
  const [name, setName] = useState(map.name)
  return (
    <form className="dz-form" onSubmit={async (e) => {
      e.preventDefault()
      if (!name.trim()) return
      if (name.trim() !== map.name) await act('map:rename', { mapId: map.id, name: name.trim() })
      onClose()
    }}>
      <div className="field">
        <label htmlFor="map-name">Map name</label>
        <input id="map-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </div>
      <div className="dz-actions">
        <button type="button" className="danger" onClick={async () => {
          await act('map:setStatus', { mapId: map.id, status: 'defunct' })
          onClose()
        }}>Move to History</button>
        <span className="spacer" />
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!name.trim()}>Save</button>
      </div>
    </form>
  )
}

/** The emblem a storyline shows: the DM's choice, or one picked from its id. */
export function emblemOf(storylineId: string, chosen: string | null): StoryEmblem {
  return chosen && chosen in STORY_EMBLEMS ? (chosen as StoryEmblem) : storyEmblemFor(storylineId)
}
