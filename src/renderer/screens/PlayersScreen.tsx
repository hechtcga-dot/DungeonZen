import { useState } from 'react'
import { useBoard } from '../store'
import { DeskFrame } from '../components/DeskFrame'
import { MapView } from '../components/MapView'
import { MapOverlay } from '../components/MapOverlay'
import { Candle, CompassRose } from '../art/props'
import { useLightingPref } from '../art/TableLighting'
import { lightingAt } from '../../shared/sky'
import { regionAt } from '../../shared/geometry'
import type { PlayersView } from '../../shared/types'

/**
 * Player preview: only what the party knows. Safe to show the players (a second screen
 * or a screen share): the recap, where they are and are heading, people they met and
 * what they learned about them, revealed discoveries, and the places they have been.
 */
export function PlayersScreen() {
  const players = useBoard((s) => s.players)
  const info = useBoard((s) => s.info)
  const [lighting] = useLightingPref()
  const lit = !lighting || lightingAt(info?.clockMin ?? 0).candlesLit
  return (
    <DeskFrame>
      <main className="desk players-screen" aria-label="Player preview">
        <header className="desk-head">
          <Candle className="desk-candle" lit={lit} />
          <div className="desk-title">
            <span className="desk-eyebrow">{players ? `${players.when} · ${{ night: 'Night', dawn: 'Dawn', daylight: 'Daylight', dusk: 'Dusk' }[players.light]}` : ''}</span>
            <h1>{players?.campaignName ?? 'The story so far'}</h1>
          </div>
          <div className="desk-head-actions">
            <span className="players-safe" title="Only what the party knows is on this screen">Player view · safe to show</span>
          </div>
        </header>
        {!players ? <p className="desk-loading">Gathering what the party knows…</p> : <Players p={players} />}
      </main>
    </DeskFrame>
  )
}

function Players({ p }: { p: PlayersView }) {
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null)
  const map = p.map
  const hovered = map && hover ? map.view.regions.find((r) => r.id === hover.id) : undefined
  return (
    <div className="players-layout">
      <div className="parchment-sheet players-map">
        {map ? (
          <>
            <MapView src={map.view.map.url} alt={`Map of ${map.view.map.name}`} className="full-mapview"
              layer={(ctx) => <MapOverlay view={map.view} ctx={ctx} selectedRegionId={hover?.id ?? null} />}
              onMapHover={(pt, client) => {
                const r = pt ? regionAt(pt, map.view.regions) : null
                setHover(r && client ? { id: r.id, x: client.x, y: client.y } : null)
              }} />
            {hovered && hover && (
              <div className="map-tip" role="tooltip" style={{ left: hover.x + 16, top: hover.y + 12 }}>
                <strong>{hovered.name}</strong>
                {map.notes[hovered.id] ? <p>{map.notes[hovered.id]}</p> : <p className="ink-muted">You have been here.</p>}
              </div>
            )}
            <p className="ink-muted map-foot">Places you have been. Point at one to read about it.</p>
          </>
        ) : (
          <div className="map-empty">
            <CompassRose className="map-empty-rose" />
            <h2>Uncharted</h2>
            <p>The party has not been placed on a map yet.</p>
          </div>
        )}
      </div>
      <aside className="players-side">
        <section className="parchment-note">
          <h2 className="panel-title">Where you are</h2>
          {p.place ? (
            <>
              <p className="players-place">{p.place.name}{p.place.inside ? <span className="ink-muted">, {p.place.inside}</span> : null}</p>
              {p.place.notes && <p className="region-notes">{p.place.notes}</p>}
            </>
          ) : <p className="ink-muted">Somewhere on the road.</p>}
          {p.cameFrom && <p className="ink-muted">You came from {p.cameFrom}.</p>}
          {p.headingTo && <p><strong>Heading to:</strong> {p.headingTo}</p>}
        </section>
        {p.recap && (
          <section className="parchment-note">
            <h2 className="panel-title">Last time (session {p.recap.number})</h2>
            <p className="region-notes">{p.recap.text}</p>
          </section>
        )}
        <section className="parchment-note">
          <h2 className="panel-title">People you have met</h2>
          {p.people.length === 0 ? <p className="ink-muted">Nobody yet.</p> : (
            <ul className="players-people">
              {p.people.map((x) => (
                <li key={x.id}>
                  <strong>{x.name}</strong>
                  {x.facts.map((f) => <span key={f.label} className="fact"><em>{f.label}:</em> {f.value}</span>)}
                </li>
              ))}
            </ul>
          )}
        </section>
        {p.discoveries.length > 0 && (
          <section className="parchment-note">
            <h2 className="panel-title">What you have discovered</h2>
            <ul className="players-people">
              {p.discoveries.map((d) => <li key={d.id}><strong>{d.title || 'A discovery'}</strong>{d.text && <span className="fact">{d.text}</span>}</li>)}
            </ul>
          </section>
        )}
        {p.connections.length > 0 && (
          <section className="parchment-note">
            <h2 className="panel-title">Connections you know</h2>
            <ul className="ink-list">{p.connections.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </section>
        )}
      </aside>
    </div>
  )
}
