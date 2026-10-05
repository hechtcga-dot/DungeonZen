import { useBoard } from '../store'
import { DeskFrame } from '../components/DeskFrame'
import { MapView } from '../components/MapView'
import { Candle, CompassRose } from '../art/props'
import { useLightingPref } from '../art/TableLighting'
import { lightingAt } from '../../shared/sky'
import { formatClock } from '../../shared/time'
import { useState } from 'react'
import { MapDialog } from '../components/EditDialogs'

export function MapScreen() {
  const { desk, info, act } = useBoard()
  const current = desk?.map ?? null
  const minutes = info?.clockMin ?? 0
  const [lighting] = useLightingPref()
  const [editOpen, setEditOpen] = useState(false)
  return (
    <DeskFrame>
      <main className="desk map-screen" aria-label="Map">
        <header className="desk-head">
          <Candle className="desk-candle" lit={!lighting || lightingAt(minutes).candlesLit} />
          <div className="desk-title">
            <span className="desk-eyebrow">{info ? formatClock(info.clockMin) : ''}</span>
            <h1>{current?.name ?? 'The map'}</h1>
          </div>
          <div className="desk-head-actions">
            {desk && desk.maps.length > 1 && current && (
              <>
                <label htmlFor="map-pick" className="visually-hidden">Show map</label>
                <select id="map-pick" className="ink-select on-wood" value={current.id}
                  onChange={(e) => void act('map:setActive', { mapId: e.target.value })}>
                  {desk.maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </>
            )}
            {current && <button className="brass" onClick={() => setEditOpen(true)}>Rename or remove</button>}
            <button className="brass" onClick={() => void act('map:importDialog', undefined)}>Import map</button>
            {current && <MapDialog open={editOpen} onClose={() => setEditOpen(false)} map={current} />}
          </div>
        </header>
        <div className="map-layout">
          <div className="parchment-sheet map-sheet">
            {current ? (
              <MapView src={current.url} alt={`Map of ${current.name}`} className="full-mapview" />
            ) : (
              <div className="map-empty">
                <CompassRose className="map-empty-rose" />
                <h2>No map yet</h2>
                <p>Import a map image (PNG, JPEG or WebP). Large maps are fine: zoom in with the mouse wheel.</p>
                <button className="wax" onClick={() => void act('map:importDialog', undefined)}>Import a map</button>
              </div>
            )}
          </div>
          <aside className="parchment-note map-side">
            <h2 className="panel-title">Using the map</h2>
            <ul className="ink-list">
              <li>Scroll to zoom in and out where the pointer is.</li>
              <li>Drag to move around. Double-click to zoom in.</li>
              <li>Keyboard: + and − zoom, arrow keys move, 0 fits the whole map.</li>
            </ul>
            {current?.width && current.height && (
              <p className="ink-muted mono">{current.width} × {current.height} px</p>
            )}
            <h2 className="panel-title">Coming next</h2>
            <p className="ink-muted">Regions you draw on the map, who is where at the current time, and the party token.</p>
          </aside>
        </div>
      </main>
    </DeskFrame>
  )
}
