import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useBoard, useUnits } from '../store'
import { DeskFrame } from '../components/DeskFrame'
import { MapView, type MapLayerContext } from '../components/MapView'
import { MapOverlay, PartyToken, PcTokenMark } from '../components/MapOverlay'
import { Candle, CompassRose } from '../art/props'
import { useLightingPref } from '../art/TableLighting'
import { Dialog } from '../components/Dialog'
import { CommitField } from '../components/fields'
import { MapDialog } from '../components/EditDialogs'
import { FindRegions } from './GuideScreen'
import { OpenFolder } from '../components/OpenFolder'
import { ENTITY_COLOURS, ENTITY_LABELS } from '../entityStyle'
import { lightingAt } from '../../shared/sky'
import { formatClock } from '../../shared/time'
import { centroid, regionAt, type Point } from '../../shared/geometry'
import { GRID_MAX, GRID_MIN } from '../../shared/battlemap'
import { BIOMES, PLACE_KINDS, PLACE_KIND_LABELS } from '../../shared/places'
import type { EntityBrief, MapScreenView, RegionDetail, RegionView, TravelEstimateView } from '../../shared/types'
import { useSidePanel } from '../components/Splitter'
import { fmtSquares, kmToShown, longUnit, shownToKm, speedUnit } from '../../shared/units'

type Mode = 'view' | 'draw' | 'edit'

export function MapScreen() {
  const { desk, info, act, mapScreen, setBattleMapOpen } = useBoard()
  const current = desk?.map ?? null
  const minutes = info?.clockMin ?? 0
  const [lighting] = useLightingPref()
  const [editOpen, setEditOpen] = useState(false)
  const [scaleOpen, setScaleOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('view')
  // A new map: offer the AI region finder straight away.
  const importMap = async () => { if (await act('map:importDialog', undefined)) { setMode('view'); setFindOpen(true) } }
  const view = mapScreen && current && mapScreen.map.id === current.id ? mapScreen : null
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
                  {desk.maps.some((m) => m.kind === 'world') && (
                    <optgroup label="Maps">{desk.maps.filter((m) => m.kind === 'world').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
                  )}
                  {desk.maps.some((m) => m.kind === 'battle') && (
                    <optgroup label="Battle maps">{desk.maps.filter((m) => m.kind === 'battle').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
                  )}
                </select>
              </>
            )}
            {current && (
              <>
                <button className="brass" aria-pressed={mode === 'draw'} onClick={() => setMode(mode === 'draw' ? 'view' : 'draw')}>
                  {mode === 'draw' ? 'Stop drawing' : 'Draw region'}
                </button>
                {current.kind !== 'battle' && <button className="brass" onClick={() => { setMode('view'); setFindOpen(true) }}>Find regions with AI</button>}
                <button className="brass" onClick={() => setScaleOpen(true)}>Scale and grid</button>
                <button className="brass" onClick={() => setEditOpen(true)}>Rename or remove</button>
              </>
            )}
            <button className="brass" onClick={() => setBattleMapOpen(true)}>Draw a battle map</button>
            <button className="brass" onClick={importMap}>Import map</button>
            {current && findOpen && (
              <Dialog title={`Regions of ${current.name}`} open wide onClose={() => setFindOpen(false)}>
                <FindRegions inMap map={current} onNext={() => setFindOpen(false)} onDraw={() => { setFindOpen(false); setMode('draw') }} />
              </Dialog>
            )}
            {current && <MapDialog open={editOpen} onClose={() => setEditOpen(false)} map={current} />}
            {view && scaleOpen && <ScaleDialog view={view} onClose={() => setScaleOpen(false)} />}
          </div>
        </header>
        {current && view ? <MapWorkspace key={current.id} view={view} mode={mode} setMode={setMode} /> : (
          <div className="map-layout">
            <div className="parchment-sheet map-sheet">
              <div className="map-empty">
                <CompassRose className="map-empty-rose" />
                <h2>{current ? 'Unrolling the map…' : 'No map yet'}</h2>
                {!current && <p>Import a map image (PNG, JPEG or WebP). Large maps are fine: zoom in with the mouse wheel.</p>}
                {!current && <button className="wax" onClick={importMap}>Import a map</button>}
              </div>
            </div>
          </div>
        )}
      </main>
    </DeskFrame>
  )
}

function MapWorkspace({ view, mode, setMode }: { view: MapScreenView; mode: Mode; setMode(m: Mode): void }) {
  const units = useUnits()
  const side = useSidePanel('map-side', 'right', 300)
  const { act, query, info, say } = useBoard()
  const [selected, setSelected] = useState<string | null>(view.party?.locationId ? view.regions.find((r) => r.locationId === view.party?.locationId)?.id ?? null : null)
  const [detail, setDetail] = useState<RegionDetail | null>(null)
  const [draw, setDraw] = useState<Point[]>([])
  const [finishing, setFinishing] = useState<Point[] | null>(null)
  const [editPts, setEditPts] = useState<Point[] | null>(null)
  const [tokenAt, setTokenAt] = useState<Point | null>(null)
  const [pcDrag, setPcDrag] = useState<{ id: string; at: Point } | null>(null)
  const centre: Point = [(view.map.width ?? 1000) / 2, (view.map.height ?? 1000) / 2]
  const [pending, setPending] = useState<{ to: Point; estimate: TravelEstimateView } | null>(null)
  const ctxRef = useRef<MapLayerContext | null>(null)
  const region = view.regions.find((r) => r.id === selected) ?? null

  // Load the selected region's details whenever the data changes.
  useEffect(() => {
    if (!selected || !view.regions.some((r) => r.id === selected)) { setDetail(null); return }
    let live = true
    void query('region:detail', { regionId: selected }).then((d) => { if (live && d) setDetail(d) })
    return () => { live = false }
  }, [selected, view, query])

  useEffect(() => { if (mode !== 'draw') setDraw([]); if (mode !== 'edit') setEditPts(null) }, [mode])

  const askTravel = async (to: Point) => {
    const estimate = await query('party:estimate', { mapId: view.map.id, x: to[0], y: to[1] })
    if (estimate) setPending({ to, estimate })
  }

  const onMapClick = (p: Point) => {
    if (mode === 'draw') { setDraw((d) => [...d, p]); return }
    if (mode === 'edit') return
    const r = regionAt(p, view.regions)
    setSelected(r?.id ?? null)
  }

  const finishDrawing = () => { if (draw.length >= 3) { setFinishing(draw); setDraw([]) } }

  // Dragging something on the map (party token or a corner of a region) follows the pointer in image coordinates.
  const startDrag = (e: React.PointerEvent, onMove: (p: Point) => void, onEnd: (p: Point) => void) => {
    e.stopPropagation()
    e.preventDefault()
    const move = (ev: globalThis.PointerEvent) => { if (ctxRef.current) onMove(ctxRef.current.toImage(ev.clientX, ev.clientY)) }
    const up = (ev: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (ctxRef.current) onEnd(ctxRef.current.toImage(ev.clientX, ev.clientY))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const tokenPos: Point | null = tokenAt ?? (pending ? pending.to : view.party ? [view.party.x, view.party.y] : null)

  return (
    <div className="map-layout" style={side.style}>
      <div className="parchment-sheet map-sheet">
        {mode === 'draw' && (
          <div className="map-toolbar" role="status">
            <strong>Drawing a region:</strong> click around its edge. {draw.length} point{draw.length === 1 ? '' : 's'}.
            <button className="ink-button" disabled={draw.length === 0} onClick={() => setDraw((d) => d.slice(0, -1))}>Undo point</button>
            <button className="ink-button primary-ink" disabled={draw.length < 3} onClick={finishDrawing}>Finish (Enter)</button>
            <button className="ink-button" onClick={() => setMode('view')}>Cancel (Esc)</button>
          </div>
        )}
        {mode === 'edit' && region && (
          <div className="map-toolbar" role="status">
            <strong>Editing {region.name}:</strong> drag the corners.
            <button className="ink-button primary-ink" onClick={async () => {
              if (editPts) await act('region:update', { id: region.id, patch: { polygon: editPts } })
              setMode('view')
            }}>Save shape</button>
            <button className="ink-button" onClick={() => setMode('view')}>Cancel</button>
          </div>
        )}
        <MapView src={view.map.url} alt={`Map of ${view.map.name}`} className="full-mapview"
          onMapClick={onMapClick} noDoubleClickZoom={mode === 'draw'}
          onKeyDown={(e) => {
            if (mode !== 'draw') return
            if (e.key === 'Enter') { finishDrawing(); return true }
            if (e.key === 'Escape') { setMode('view'); return true }
            if (e.key === 'Backspace') { setDraw((d) => d.slice(0, -1)); return true }
          }}
          layer={(ctx) => {
            ctxRef.current = ctx
            const s = 1 / ctx.scale
            const shape = mode === 'edit' && region ? (editPts ?? region.polygon) : null
            return (
              <>
                <MapOverlay view={mode === 'edit' && region ? { ...view, regions: view.regions.filter((r) => r.id !== region.id) } : view}
                  ctx={ctx} selectedRegionId={selected} hideParty />
                {shape && (
                  <>
                    <polygon points={shape.map((p) => p.join(',')).join(' ')} fill="#8f2a21" fillOpacity="0.15" stroke="#8f2a21" strokeWidth={3 * s} />
                    {shape.map((p, i) => (
                      <circle key={i} cx={p[0]} cy={p[1]} r={9 * s} className="vertex"
                        onPointerDown={(e) => startDrag(e,
                          (q) => setEditPts((pts) => (pts ?? region!.polygon).map((x, j) => (j === i ? q : x))),
                          () => undefined)} />
                    ))}
                  </>
                )}
                {draw.length > 0 && (
                  <>
                    <polyline points={draw.map((p) => p.join(',')).join(' ')} fill="none" stroke="#8f2a21" strokeWidth={3 * s} strokeDasharray={`${8 * s} ${5 * s}`} />
                    {draw.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={6 * s} fill={i === 0 ? '#f6c945' : '#8f2a21'} stroke="#2a1f12" strokeWidth={1.5 * s} />)}
                  </>
                )}
                {tokenPos && mode === 'view' && (
                  <PartyToken x={tokenPos[0]} y={tokenPos[1]} scale={ctx.scale} dragging={!!tokenAt}
                    onPointerDown={(e) => startDrag(e, (p) => setTokenAt(p), (p) => { setTokenAt(null); void askTravel(p) })} />
                )}
                {mode === 'view' && view.pcs.filter((p) => p.split?.mapId === view.map.id).map((p) => {
                  const at = pcDrag?.id === p.entityId ? pcDrag.at : [p.split!.x, p.split!.y]
                  return <PcTokenMark key={p.entityId} x={at[0]} y={at[1]} name={p.name} scale={ctx.scale} dragging={pcDrag?.id === p.entityId}
                    onPointerDown={(e) => startDrag(e, (q) => setPcDrag({ id: p.entityId, at: q }),
                      (q) => { setPcDrag(null); void act('pc:move', { entityId: p.entityId, mapId: view.map.id, x: q[0], y: q[1] }) })} />
                })}
                {!view.party && mode === 'view' && !pending && <text x={20 * s} y={34 * s} fontSize={18 * s} fill="#2a1f12" className="map-hint-text">
                  Press “Place party token”, or select a region and press “Move party here”.</text>}
              </>
            )
          }}
        />
        {pending && (
          <ConfirmTravel view={view} pending={pending} onDone={() => setPending(null)} />
        )}
        {view.map.kind === 'battle' ? (
          <div className="ink-muted map-foot">
            Battle map{view.map.gridCols && view.map.gridRows ? `: ${view.map.gridCols} × ${view.map.gridRows} squares (${fmtSquares(view.map.gridCols, units)} × ${fmtSquares(view.map.gridRows, units)})` : ''}.
            {view.map.source && <> <span className="ai-badge">Drawn by AI · {view.map.source}</span></>}
            {' '}<button className="link-button" onClick={async () => { const f = await act('map:saveImage', { mapId: view.map.id }); if (f) say(`Saved ${f}. In Roll20, make a page ${view.map.gridCols ?? '?'} × ${view.map.gridRows ?? '?'} units and stretch the image to it.`) }}>Save image for Roll20…</button>
            {view.map.prompt && (
              <details className="map-prompt"><summary>What the AI was asked</summary><p>{view.map.prompt}</p></details>
            )}
            {' · '}<button className="link-button" onClick={() => void act('map:reimport', { mapId: view.map.id })}>Re-import picture…</button>
            {' · '}<OpenFolder sub="maps" label="Open maps folder" />
          </div>
        ) : (
          <p className="ink-muted map-foot">
            {view.party ? <>Party location: <strong>{view.party.locationName ?? 'between places'}</strong> since {formatClock(view.party.atMin)}. Drag the banner to move them.</>
              : <>The party is not on this map yet. <button className="link-button" onClick={() => void askTravel(centre)}>Place party token</button></>}
            {!view.map.widthKm && ' Set the map scale to get travel time estimates.'}
            {' · '}<button className="link-button" title="A new version of the picture; regions and the party stay on their places" onClick={() => void act('map:reimport', { mapId: view.map.id })}>Re-import picture…</button>
            {' · '}<OpenFolder sub="maps" label="Open maps folder" />
          </p>
        )}
      </div>
      <aside className="parchment-note map-side">
        {side.grip}
        {region && detail ? (
          <RegionPanel detail={detail} view={view}
            onMoveHere={() => void askTravel(centroid(region.polygon))}
            onEditShape={() => { setEditPts(region.polygon); setMode('edit') }}
            onSelect={(locationId) => setSelected(view.regions.find((r) => r.locationId === locationId)?.id ?? null)} />
        ) : (
          <>
          <>
            <h2 className="panel-title">Using the map</h2>
            <ul className="ink-list">
              <li>Click a region to see who and what is there at {info ? formatClock(info.clockMin) : 'the current time'}.</li>
              <li>“Draw region” and click around a district, town or room. Double-check the corners, then Finish.</li>
              <li>Drag the party banner to move them: you confirm the travel time and the clock moves on.</li>
              <li>Scroll to zoom, drag to move around, 0 fits the whole map.</li>
            </ul>
            {view.regions.length === 0 && <p className="ink-muted">No regions on this map yet.</p>}
            {view.unplacedLocations.length > 0 && (
              <p className="ink-muted">Locations not drawn yet: {view.unplacedLocations.map((l) => l.name).join(', ')}.</p>
            )}
          </>
          </>
        )}
        <PartyTokens view={view} onPlace={() => void askTravel(centre)} />
      </aside>
      {finishing && <NewRegionDialog view={view} polygon={finishing} onClose={() => { setFinishing(null); setMode('view') }}
        onCreated={(id) => setSelected(id)} />}
    </div>
  )
}

/** Party and player character tokens: place the party, split a character off or merge them back. */
function PartyTokens({ view, onPlace }: { view: MapScreenView; onPlace(): void }) {
  const act = useBoard((s) => s.act)
  const mapName = useBoard((s) => s.desk?.maps)
  return (
    <section className="pc-tokens" aria-label="Party tokens">
      <h3 className="panel-subheading">Tokens</h3>
      {!view.party && <button className="ink-button" onClick={onPlace}>Place party token</button>}
      {view.pcs.length === 0 ? <p className="ink-muted">No player characters yet: add them on the desk to give each a token.</p> : (
        <ul className="pc-token-list">
          {view.pcs.map((p) => (
            <li key={p.entityId}>
              <span><strong>{p.name}</strong> <span className="ink-muted">{p.split
                ? p.split.mapId === view.map.id ? `on their own${p.split.locationName ? ` in ${p.split.locationName}` : ''}` : `on their own on ${mapName?.find((m) => m.id === p.split!.mapId)?.name ?? 'another map'}`
                : 'with the party'}</span></span>
              {p.split
                ? <button className="link-button" onClick={() => void act('pc:move', { entityId: p.entityId, mapId: p.split!.mapId, joined: true })}>Merge with party</button>
                : <button className="link-button" disabled={!view.party} title={view.party ? 'Gives them their own token next to the party' : 'Place the party first'}
                    onClick={() => void act('pc:move', { entityId: p.entityId, mapId: view.map.id })}>Split from party</button>}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">A split character moves on their own: drag their token. Only the party's travel moves the clock.</p>
    </section>
  )
}

function ConfirmTravel({ view, pending, onDone }: { view: MapScreenView; pending: { to: Point; estimate: TravelEstimateView }; onDone(): void }) {
  const act = useBoard((s) => s.act)
  const est = pending.estimate
  const first = !view.party
  const [hours, setHours] = useState(est.minutes != null ? String(Math.floor(est.minutes / 60)) : '')
  const [mins, setMins] = useState(est.minutes != null ? String(est.minutes % 60) : '')
  const [remember, setRemember] = useState(false)
  const total = (Number(hours) || 0) * 60 + (Number(mins) || 0)
  const valid = first || (hours !== '' || mins !== '') && total >= 0
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    await act('party:move', { mapId: view.map.id, x: pending.to[0], y: pending.to[1], minutes: first ? 0 : total, rememberTime: remember })
    onDone()
  }
  return (
    <form className="confirm-travel" onSubmit={submit} aria-label="Confirm travel">
      <h3>{first ? 'Place the party' : 'Confirm travel'}</h3>
      <p>{first ? <>The party starts at <strong>{est.toName ?? 'this spot'}</strong>.</>
        : <>From <strong>{est.fromName ?? 'where they are'}</strong> to <strong>{est.toName ?? 'a spot outside any region'}</strong>.</>}</p>
      {!first && (
        <>
          <p className="ink-muted">{est.minutes != null ? `Estimate: ${Math.floor(est.minutes / 60)} h ${est.minutes % 60} min, from ${est.basis}.` : `No estimate: ${est.basis}.`}</p>
          <div className="row tight">
            <label htmlFor="tr-h">Hours</label>
            <input id="tr-h" className="short" type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} autoFocus />
            <label htmlFor="tr-m">Minutes</label>
            <input id="tr-m" className="short" type="number" min={0} max={59} value={mins} onChange={(e) => setMins(e.target.value)} />
          </div>
          {est.fromName && est.toName && (
            <div className="field checkbox">
              <input id="tr-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <label htmlFor="tr-remember">Remember this time for {est.fromName} to {est.toName}</label>
            </div>
          )}
        </>
      )}
      <div className="row tight wrap">
        <button type="submit" className="ink-button primary-ink" disabled={!valid}>{first ? 'Place the party' : 'Confirm travel'}</button>
        <button type="button" className="ink-button" onClick={onDone}>Cancel</button>
      </div>
      {!first && <p className="ink-muted">The clock moves on by the travel time{view.sessionRunning ? ' and the trip goes in the session log' : ''}. Undo puts it all back.</p>}
    </form>
  )
}

function RegionPanel({ detail, view, onMoveHere, onEditShape, onSelect }: {
  detail: RegionDetail; view: MapScreenView; onMoveHere(): void; onEditShape(): void; onSelect(locationId: string): void
}) {
  const { act, openSheet, showOnBoard, openEncounter } = useBoard()
  const parents = view.regions.filter((r) => r.locationId !== detail.region.locationId)
  const list = (title: string, items: EntityBrief[], empty: string) => (
    <>
      <h3 className="side-h">{title}</h3>
      {items.length === 0 ? <p className="ink-muted">{empty}</p> : (
        <ul className="here-list">
          {items.map((e) => (
            <li key={e.id}>
              <span className="badge" style={{ background: ENTITY_COLOURS[e.type] }}>{ENTITY_LABELS[e.type].toUpperCase()}</span>
              <button className="ledger-name" onClick={() => void openSheet(e.id)}>{e.name}</button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
  return (
    <div className="region-panel">
      <h2 className="panel-title region-name">{detail.location.name}</h2>
      <p className="ink-muted">Region{detail.region.parentLocationId ? ` in ${view.regions.find((r) => r.locationId === detail.region.parentLocationId)?.name ?? 'another region'}` : ''}</p>
      <h3 className="side-h">Here now</h3>
      {detail.partyHere && <p className="here-party"><span className="badge party-badge">PARTY</span> The party</p>}
      {detail.hereNow.length === 0 && !detail.partyHere ? <p className="ink-muted">Nobody, as far as your cards say.</p> : (
        <ul className="here-list">
          {detail.hereNow.map((e) => (
            <li key={e.id}>
              <span className="badge" style={{ background: ENTITY_COLOURS[e.type] }}>{ENTITY_LABELS[e.type].toUpperCase()}</span>
              <button className="ledger-name" onClick={() => void openSheet(e.id)}>{e.name}</button>
            </li>
          ))}
        </ul>
      )}
      {list('Planned encounters', detail.encounters, 'None yet.')}
      <button className="ink-button" onClick={async () => {
        const id = await act('encounter:create', { name: `Encounter at ${detail.location.name}`, locationId: detail.location.id })
        if (id) openEncounter(id)
      }}>Plan an encounter here</button>
      {list('Plot points and scenes', detail.plotPoints, 'None tied to this place.')}
      <h3 className="side-h">Notes</h3>
      {detail.notes ? <p className="region-notes">{detail.notes}</p> : <p className="ink-muted">Nothing written on the location card.</p>}
      <CommitField id={`player-notes-${detail.location.id}`} label="What the players see (shown in Player preview)" multiline rows={3}
        value={typeof detail.location.attributes.player_notes === 'string' ? detail.location.attributes.player_notes : ''}
        placeholder="Fog-wet piers, a fish market, the old bell tower…"
        onCommit={(v) => void act('entity:update', { id: detail.location.id, patch: { attributes: { player_notes: v } } })} />
      <h3 className="side-h">Sub-regions</h3>
      {detail.subRegions.length === 0 ? <p className="ink-muted">None yet.</p> : (
        <ul className="here-list">{detail.subRegions.map((s) => <li key={s.locationId}><button className="ledger-name" onClick={() => onSelect(s.locationId)}>{s.name}</button></li>)}</ul>
      )}
      <div className="row tight wrap region-kind">
        <div className="field">
          <label htmlFor="region-kind">Kind of place</label>
          <select id="region-kind" className="ink-select" value={detail.region.kind ?? ''}
            onChange={(e) => void act('entity:update', { id: detail.location.id, patch: { attributes: { place_kind: e.target.value || null } } })}>
            <option value="">Not set</option>
            {PLACE_KINDS.map((k) => <option key={k} value={k}>{PLACE_KIND_LABELS[k]}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="region-biome">Land (biome)</label>
          <select id="region-biome" className="ink-select" value={detail.region.biome ?? ''}
            onChange={(e) => void act('entity:update', { id: detail.location.id, patch: { attributes: { biome: e.target.value || null } } })}>
            <option value="">Not set</option>
            {BIOMES.map((b) => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="region-parent">Inside</label>
        <select id="region-parent" className="ink-select" value={detail.region.parentLocationId ?? ''}
          onChange={(e) => void act('region:update', { id: detail.region.id, patch: { parentLocationId: e.target.value || null } })}>
          <option value="">Not inside another region</option>
          {parents.map((r) => <option key={r.id} value={r.locationId}>{r.name}</option>)}
        </select>
      </div>
      <div className="row tight wrap">
        <button className="ink-button primary-ink" onClick={onMoveHere} disabled={detail.partyHere}>Move party here</button>
        <button className="ink-button" onClick={() => void openSheet(detail.location.id)}>Open sheet</button>
        <button className="ink-button" onClick={() => void showOnBoard(detail.location.id)}>Show on board</button>
        <button className="ink-button" onClick={onEditShape}>Edit shape</button>
        <button className="ink-button danger-ink" onClick={() => void act('region:setStatus', { id: detail.region.id, status: 'defunct' })}>Remove region</button>
      </div>
      <p className="ink-muted">“Here now” lists cards tied to this place by a string (Located at, Tied to quest) or whose Location field says {detail.location.name}.</p>
    </div>
  )
}

function NewRegionDialog({ view, polygon, onClose, onCreated }: { view: MapScreenView; polygon: Point[]; onClose(): void; onCreated(id: string): void }) {
  const act = useBoard((s) => s.act)
  const [locationId, setLocationId] = useState('')
  const [name, setName] = useState('')
  const inside = regionAt(centroid(polygon), view.regions)
  const [parent, setParent] = useState(inside?.locationId ?? '')
  const valid = locationId !== '' || name.trim() !== ''
  return (
    <Dialog title="New region" open onClose={onClose}>
      <form className="dz-form" onSubmit={async (e) => {
        e.preventDefault()
        if (!valid) return
        const id = await act('region:create', {
          mapId: view.map.id, polygon, parentLocationId: parent || null,
          ...(locationId ? { locationId } : { newName: name.trim() })
        })
        if (id) { onCreated(id); onClose() }
      }}>
        {view.unplacedLocations.length > 0 && (
          <div className="field">
            <label htmlFor="nr-loc">Use a Location card you already have</label>
            <select id="nr-loc" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">No: make a new Location card</option>
              {view.unplacedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}
        {!locationId && (
          <div className="field">
            <label htmlFor="nr-name">Name of the new location</label>
            <input id="nr-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="District C, the Old Market…" maxLength={200} />
          </div>
        )}
        <div className="field">
          <label htmlFor="nr-parent">Inside</label>
          <select id="nr-parent" value={parent} onChange={(e) => setParent(e.target.value)}>
            <option value="">Not inside another region</option>
            {view.regions.map((r) => <option key={r.id} value={r.locationId}>{r.name}</option>)}
          </select>
          <div className="hint">A region inside another (a market in a district) is a sub-region.</div>
        </div>
        <div className="dz-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!valid}>Add region</button>
        </div>
      </form>
    </Dialog>
  )
}

function ScaleDialog({ view, onClose }: { view: MapScreenView; onClose(): void }) {
  const act = useBoard((s) => s.act)
  const units = useUnits()
  const [miles, setMiles] = useState(view.map.widthKm != null ? String(kmToShown(view.map.widthKm, units)) : '')
  const [mph, setMph] = useState(String(kmToShown(view.map.travelKmh, units)))
  const [cols, setCols] = useState(view.map.gridCols != null ? String(view.map.gridCols) : '')
  const [shown, setShown] = useState(view.map.gridShown)
  const m = miles.trim() === '' ? null : Number(miles)
  const g = cols.trim() === '' ? null : Number(cols)
  const gridOk = g === null || (Number.isInteger(g) && g >= GRID_MIN && g <= GRID_MAX)
  const valid = (m === null || (Number.isFinite(m) && m > 0)) && Number(mph) > 0 && gridOk
  return (
    <Dialog title="Map scale and grid" open onClose={onClose}>
      <form className="dz-form" onSubmit={async (e) => {
        e.preventDefault()
        if (!valid) return
        if (m !== (view.map.widthKm == null ? null : kmToShown(view.map.widthKm, units)) || Number(mph) !== kmToShown(view.map.travelKmh, units)) {
          await act('map:setScale', { mapId: view.map.id, widthKm: m === null ? null : shownToKm(m, units), travelKmh: shownToKm(Number(mph), units) })
        }
        if (g !== view.map.gridCols) await act('map:setGrid', { mapId: view.map.id, cols: g })
        if (shown !== view.map.gridShown) await act('map:setGridShown', { mapId: view.map.id, shown })
        onClose()
      }}>
        <div className="field">
          <label htmlFor="sc-grid">Grid: how many squares across ({fmtSquares(1, units)} each)?</label>
          <input id="sc-grid" className="short" inputMode="numeric" value={cols} onChange={(e) => setCols(e.target.value)} />
          <div className="hint">For battle maps. {GRID_MIN} to {GRID_MAX}; leave empty for no grid. The app draws the lines, so they always line up.</div>
          <label className="field checkbox"><input type="checkbox" checked={shown} disabled={g === null} onChange={(e) => setShown(e.target.checked)} /> Show the grid lines on the map</label>
        </div>
        <div className="field">
          <label htmlFor="sc-miles">How many {longUnit(units)} is the map across (left to right)?</label>
          <input id="sc-miles" className="short" inputMode="decimal" value={miles} onChange={(e) => setMiles(e.target.value)} />
          <div className="hint">A city map might be {units === 'imperial' ? '2 miles' : '3 km'} across, a kingdom {units === 'imperial' ? '300' : '500'}. Leave empty for no estimates.</div>
        </div>
        <div className="field">
          <label htmlFor="sc-mph">Travel pace ({speedUnit(units)})</label>
          <input id="sc-mph" className="short" inputMode="decimal" value={mph} onChange={(e) => setMph(e.target.value)} />
          <div className="hint">On foot: {units === 'imperial' ? '3 at a normal pace, 4 fast, 2 slow' : '4.8 at a normal pace, 6.4 fast, 3.2 slow'}. Mounted or by cart is usually faster over a day.</div>
        </div>
        <div className="dz-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={!valid}>Save</button>
        </div>
      </form>
    </Dialog>
  )
}

export type { RegionView }
