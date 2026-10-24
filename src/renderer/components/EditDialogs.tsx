import { useState } from 'react'
import { useBoard } from '../store'
import type { Units } from '../../shared/units'
import { Dialog } from './Dialog'
import { TokenSettingsDialog } from './Tokens'
import { STORY_EMBLEMS, StoryEmblemArt, storyEmblemFor, type StoryEmblem } from '../art/emblems'
import { RulesEdition, StorylineStatus } from '../../shared/schemas'
import type { MapView, StorylineDetail } from '../../shared/types'

export const STORYLINE_STATUS_LABELS: Record<StorylineStatus, string> = {
  inactive: 'Not started', autonomous: 'Running on its own', player_active: 'Players active', concluded: 'Concluded'
}

/** Campaign name, rules edition, measurements, prices (time, moons, calendar: their own windows since 3.9). */
export function CampaignSettingsDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Dialog title="Campaign settings" open={open} onClose={onClose}>
      {open && <CampaignSettingsForm onClose={onClose} />}
    </Dialog>
  )
}

function CampaignSettingsForm({ onClose }: { onClose(): void }) {
  const { info, act } = useBoard()
  const [name, setName] = useState(info?.name ?? '')
  const [edition, setEdition] = useState<RulesEdition>(info?.rulesEdition ?? '2024')
  const [units, setUnits] = useState<Units>(info?.units ?? 'imperial')
  const [prices, setPrices] = useState(String(info?.priceScale ?? 100))
  const [tokens, setTokens] = useState(false)
  const pct = Math.round(Number(prices))
  const valid = name.trim() !== '' && pct >= 1 && pct <= 10000

  const save = async () => {
    if (!valid || !info) return
    await act('campaign:update', { name: name.trim(), rulesEdition: edition, units, priceScale: pct })
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
      <div className="field">
        <label htmlFor="cs-units">Measurements</label>
        <select id="cs-units" value={units} onChange={(e) => setUnits(e.target.value as Units)}>
          <option value="imperial">Imperial: feet, miles, mph</option>
          <option value="metric">Metric: metres, km, km/h</option>
        </select>
        <div className="hint">Only changes what the screens show; stat block text keeps its words, and feet or miles in it show converted.</div>
      </div>
      <div className="field">
        <label htmlFor="cs-prices">Shop and tavern prices (%)</label>
        <input id="cs-prices" className="short" type="number" min={1} max={10000} value={prices} onChange={(e) => setPrices(e.target.value)} />
        <div className="hint">100 is the standard 5e price. Every shop and tavern uses this, times its own scale (its Price settings).</div>
      </div>
      <div className="field">
        <span className="field-label">Tokens for Roll20</span>
        <div className="row tight"><button type="button" onClick={() => setTokens(true)}>Token settings…</button>
          <span className="hint">What dragging a portrait gives, token size, border per card type.</span></div>
      </div>
      <div className="hint">The time is set with the clock's Set…; the date, calendar, moons and weather on the Calendar screen.</div>
      <div className="dz-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="submit" className="primary" disabled={!valid}>Save</button>
      </div>
      {tokens && <TokenSettingsDialog onClose={() => setTokens(false)} />}
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
