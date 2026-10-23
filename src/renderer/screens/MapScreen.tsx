import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useBoard, useUnits } from '../store'
import { call } from '../api'
import { DeskFrame } from '../components/DeskFrame'
import { ScreenHeader } from '../components/TopBar'
import { MapView, type MapLayerContext } from '../components/MapView'
import { MapOverlay, PartyToken, PcTokenMark, ScaleBar, scaleKeyLayout } from '../components/MapOverlay'
import { CompassRose } from '../art/props'
import { Dialog } from '../components/Dialog'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { CommitField, TitleField } from '../components/fields'
import { MapDialog } from '../components/EditDialogs'
import { FindRegions } from './GuideScreen'
import { OpenFolder } from '../components/OpenFolder'
import { ENTITY_LABELS, useTypeColour } from '../entityStyle'
import { formatClock } from '../../shared/time'
import { centroid, insertOnEdge, regionAt, spotIn, type Point } from '../../shared/geometry'
import { GRID_MAX, GRID_MIN } from '../../shared/battlemap'
import { BIOMES, PLACE_KINDS, PLACE_KIND_LABELS } from '../../shared/places'
import type { EntityBrief, MapScreenView, RegionDetail, RegionView, TravelEstimateView } from '../../shared/types'
import { useSidePanel } from '../components/Splitter'
import { encounterTableFor, findTable, rollOn, travelChecks } from '../../shared/rolltables'
import { fmtSquares, fmtTrip, KM_PER, KM_PER_MILE, kmToShown, LENGTH_UNITS, longUnit, PACES, paceKmh, shownToKm, speedUnit, type LengthUnit, type Units } from '../../shared/units'

type Mode = 'view' | 'draw' | 'edit' | 'scale'

export function MapScreen() {
  const { desk, info, act, mapScreen, goTo } = useBoard()
  const current = desk?.map ?? null
  const [editOpen, setEditOpen] = useState(false)
  const [scaleOpen, setScaleOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('view')
  const view = mapScreen && current && mapScreen.map.id === current.id ? mapScreen : null
  return (
    <DeskFrame>
      <>
      <ScreenHeader title={<>{current ? <TitleField value={current.name} label="Map name" onCommit={(name) => void act('map:rename', { mapId: current.id, name })} /> : 'The map'}</>} eyebrow={<>{info ? formatClock(info.clockMin) : ''}</>}>
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
            <button className="brass" onClick={() => goTo('guide')} title="Import a picture, make a world map here, or have an AI draw one">New map</button>
            {current && findOpen && (
              <Dialog title={`Regions of ${current.name}`} open wide onClose={() => setFindOpen(false)}>
                <FindRegions inMap map={current} onNext={() => setFindOpen(false)} onDraw={() => { setFindOpen(false); setMode('draw') }} />
              </Dialog>
            )}
            {current && <MapDialog open={editOpen} onClose={() => setEditOpen(false)} map={current} />}
            {view && scaleOpen && <ScaleDialog view={view} onClose={() => setScaleOpen(false)} />}
          
</ScreenHeader>
      <main className="desk map-screen" aria-label="Map">
        {current && view ? <MapWorkspace key={current.id} view={view} mode={mode} setMode={setMode} /> : (
          <div className="map-layout">
            <div className="parchment-sheet map-sheet">
              <div className="map-empty">
                <CompassRose className="map-empty-rose" />
                <h2>{current ? 'Unrolling the map…' : 'No map yet'}</h2>
                {!current && <p>Import a picture, make a world map here, or have an AI draw one.</p>}
                {!current && <button className="wax" onClick={() => goTo('guide')}>New map</button>}
              </div>
            </div>
          </div>
        )}
      </main>
      </>
    </DeskFrame>
  )
}

/**
 * Board › Map view (owner, 1.6.0): the same map tools as the Map screen (regions, AI region finder,
 * party token and travel with its checks, scale) for a map, inside the board.
 */
export function MapViewPanel({ mapId, onClose }: { mapId: string; onClose(): void }) {
  const stamp = useBoard((s) => s.view?.undo)
  const [v, setV] = useState<MapScreenView | null>(null)
  const [mode, setMode] = useState<Mode>('view')
  const [findOpen, setFindOpen] = useState(false)
  const [scaleOpen, setScaleOpen] = useState(false)
  useEffect(() => { void call('mapscreen:view', { mapId }).then(setV).catch(() => setV(null)) }, [mapId, stamp])
  if (!v) return <p className="hint">Loading the map…</p>
  return (
    <div className="board-mapview desk-theme">
      <div className="row tight wrap board-mapview-bar">
        <strong>Map view: {v.map.name}</strong>
        <span className="spacer" />
        <button className="ink-button" aria-pressed={mode === 'draw'} onClick={() => setMode(mode === 'draw' ? 'view' : 'draw')}>{mode === 'draw' ? 'Stop drawing' : 'Draw region'}</button>
        {v.map.kind !== 'battle' && <button className="ink-button" onClick={() => { setMode('view'); setFindOpen(true) }}>Find regions with AI</button>}
        <button className="ink-button" onClick={() => setScaleOpen(true)}>Scale and grid</button>
        <button className="ink-button primary-ink" onClick={onClose}>Back to the cards</button>
      </div>
      <MapWorkspace key={v.map.id} view={v} mode={mode} setMode={setMode} />
      {findOpen && (
        <Dialog title={`Regions of ${v.map.name}`} open wide onClose={() => setFindOpen(false)}>
          <FindRegions inMap map={v.map} onNext={() => setFindOpen(false)} onDraw={() => { setFindOpen(false); setMode('draw') }} />
        </Dialog>
      )}
      {scaleOpen && <ScaleDialog view={v} onClose={() => setScaleOpen(false)} />}
    </div>
  )
}

function MapWorkspace({ view, mode, setMode }: { view: MapScreenView; mode: Mode; setMode(m: Mode): void }) {
  const units = useUnits()
  const side = useSidePanel('map-side', 'right', 300)
  const { act, query, info, say } = useBoard()
  const [selected, setSelected] = useState<string | null>(() => {
    // Notes › Show on map: that place's region first, else where the party is.
    const focus = useBoard.getState().mapFocusId
    if (focus) useBoard.setState({ mapFocusId: null })
    const at = focus ?? view.party?.locationId
    return at ? view.regions.find((r) => r.locationId === at)?.id ?? null : null
  })
  const [detail, setDetail] = useState<RegionDetail | null>(null)
  const [draw, setDraw] = useState<Point[]>([])
  const [finishing, setFinishing] = useState<Point[] | null>(null)
  const [editPts, setEditPts] = useState<Point[] | null>(null)
  // Shape editing: the picked corner, "Add point" waiting for a click, and the right-click menu.
  const [corner, setCorner] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)
  const [clearTravel, setClearTravel] = useState(false)
  const [shapeMenu, setShapeMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [tokenAt, setTokenAt] = useState<Point | null>(null)
  const [pcDrag, setPcDrag] = useState<{ id: string; at: Point } | null>(null)
  const centre: Point = [(view.map.width ?? 1000) / 2, (view.map.height ?? 1000) / 2]
  const [pending, setPending] = useState<{ to: Point; estimate: TravelEstimateView } | null>(null)
  const ctxRef = useRef<MapLayerContext | null>(null)
  // Set map scale: the bar (image pixels) and the length the DM types for it.
  const [bar, setBar] = useState<{ x: number; y: number; w: number } | null>(null)
  const [barLen, setBarLen] = useState('1')
  const [barUnit, setBarUnit] = useState<LengthUnit>(units === 'imperial' ? 'mi' : 'km')
  const [keyAt, setKeyAt] = useState<Point | null>(null)
  const lenKm = Number(barLen) * KM_PER[barUnit]
  const barOk = Number(barLen) >= 1 && Number(barLen) <= 999 && !!bar && !!view.map.width
  const barMapKm = barOk ? (lenKm * view.map.width!) / bar!.w : null
  // Change… / Set map scale…: the bar starts in the middle of what is on screen, at its saved length.
  const startScale = () => {
    const v = ctxRef.current?.visible()
    if (!v || !view.map.width) return
    const len = view.map.scaleLen ?? 1
    const unit = view.map.scaleUnit ?? (units === 'imperial' ? 'mi' : 'km')
    const w = view.map.widthKm ? (len * KM_PER[unit] * view.map.width) / view.map.widthKm : v.w / 3
    setBarLen(String(len)); setBarUnit(unit)
    setBar({ x: v.x + (v.w - w) / 2, y: v.y + v.h / 2 - 27 / (ctxRef.current?.scale ?? 1), w })
    setMode('scale')
  }
  const saveScale = async () => {
    if (!barOk || barMapKm == null) return
    await act('map:setScale', { mapId: view.map.id, widthKm: Math.min(200000, barMapKm), bar: { len: Number(barLen), unit: barUnit } })
    setMode('view')
    if (pending) void askTravel(pending.to)
  }
  const region = view.regions.find((r) => r.id === selected) ?? null

  // Load the selected region's details whenever the data changes.
  useEffect(() => {
    if (!selected || !view.regions.some((r) => r.id === selected)) { setDetail(null); return }
    let live = true
    void query('region:detail', { regionId: selected }).then((d) => { if (live && d) setDetail(d) })
    return () => { live = false }
  }, [selected, view, query])

  useEffect(() => { if (mode !== 'draw') setDraw([]); if (mode !== 'edit') setEditPts(null); if (mode !== 'scale') setBar(null) }, [mode])

  const askTravel = async (to: Point) => {
    const estimate = await query('party:estimate', { mapId: view.map.id, x: to[0], y: to[1] })
    if (estimate) setPending({ to, estimate })
  }

  const onMapClick = (p: Point) => {
    if (mode === 'draw') { setDraw((d) => [...d, p]); return }
    if (mode === 'edit') { if (adding) addPoint(p); return }
    const r = regionAt(p, view.regions)
    setSelected(r?.id ?? null)
  }

  const shapeNow = () => editPts ?? region?.polygon ?? []
  const addPoint = (p: Point) => {
    const next = insertOnEdge(shapeNow(), p)
    setEditPts(next)
    setCorner(next.indexOf(p))
    setAdding(false)
  }
  const deletePoint = (i: number) => {
    const pts = shapeNow()
    if (pts.length <= 3) return
    setEditPts(pts.filter((_, j) => j !== i))
    setCorner(null)
  }
  const startEdit = () => { if (region) { setEditPts(region.polygon); setCorner(null); setAdding(false); setMode('edit') } }

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
      <div className="parchment-sheet map-sheet" onContextMenu={mode === 'edit' && region ? (e) => {
        // Right-click on the map while editing a shape: add a point there.
        if (!ctxRef.current || !(e.target as Element).closest('.mapview-frame')) return
        e.preventDefault()
        const p = ctxRef.current.toImage(e.clientX, e.clientY)
        setShapeMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Add a point here', onClick: () => addPoint(p) }] })
      } : undefined}>
        {mode === 'draw' && (
          <div className="map-toolbar" role="status">
            <strong>Drawing a region:</strong> click around its edge. {draw.length} point{draw.length === 1 ? '' : 's'}.
            <button className="ink-button" disabled={draw.length === 0} onClick={() => setDraw((d) => d.slice(0, -1))}>Undo point</button>
            <button className="ink-button primary-ink" disabled={draw.length < 3} onClick={finishDrawing}>Finish (Enter)</button>
            <button className="ink-button" onClick={() => setMode('view')}>Cancel (Esc)</button>
          </div>
        )}
        {mode === 'scale' && (
          <div className="map-toolbar" role="group" aria-label="Set map scale">
            <strong>Set map scale:</strong> stretch the bar over something you know the length of, such as the map's own scale bar or a road.
            <span className="row tight">
              <label htmlFor="scale-len">The bar is</label>
              <input id="scale-len" className="short" inputMode="decimal" value={barLen} onChange={(e) => setBarLen(e.target.value)} />
              <select id="scale-unit" aria-label="Unit" value={barUnit} onChange={(e) => setBarUnit(e.target.value as LengthUnit)}>
                {(units === 'imperial' ? LENGTH_UNITS : (['m', 'km', 'ft', 'mi'] as LengthUnit[])).map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <span>long.</span>
            </span>
            <span className="hint">{SCALE_HINT[units]}</span>
            {barMapKm != null ? <span>The whole map is <strong>{fmtTrip(barMapKm, units)}</strong> across.</span>
              : <span className="danger-text">Type a length from 1 to 999.</span>}
            <button className="ink-button" onClick={() => setMode('view')}>Cancel (Esc)</button>
            <button className="ink-button primary-ink" disabled={!barOk} onClick={() => void saveScale()}>Save scale</button>
          </div>
        )}
        {mode === 'edit' && region && (
          <div className="map-toolbar" role="status">
            <strong>Editing {region.name}:</strong> {adding ? 'click the map where the new point goes.' : 'drag the corners, right-click for more.'}
            <button className="ink-button" aria-pressed={adding} onClick={() => setAdding(!adding)}>{adding ? 'Stop adding' : 'Add point'}</button>
            <button className="ink-button" disabled={corner == null || shapeNow().length <= 3}
              title={corner == null ? 'Click a corner first' : shapeNow().length <= 3 ? 'A region needs at least 3 corners' : undefined}
              onClick={() => corner != null && deletePoint(corner)}>Delete point</button>
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
            if (mode === 'scale') {
              if (e.key === 'Enter') { void saveScale(); return true }
              if (e.key === 'Escape') { setMode('view'); return true }
              return
            }
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
                  ctx={ctx} selectedRegionId={selected} hideParty scaleKey={false} />
                {mode !== 'scale' && (() => {
                  // The scale key: drag it anywhere; its place is saved with the map.
                  const k = scaleKeyLayout(view.map, ctx.scale, units, keyAt)
                  return k && (
                    <g className="scale-key" onContextMenu={(e) => { e.preventDefault(); void act('map:setScaleKey', { mapId: view.map.id, shown: false }) }} onPointerDown={(e) => {
                      if (e.button !== 0) return
                      const [sx, sy] = ctx.toImage(e.clientX, e.clientY), ox = k.x - sx, oy = k.y - sy
                      const to = (p: Point): Point => [p[0] + ox, p[1] + oy]
                      startDrag(e, (p) => setKeyAt(to(p)), (p) => {
                        const [x, y] = to(p)
                        if (Math.hypot(x - k.x, y - k.y) > 0.5) void act('map:setScaleKey', { mapId: view.map.id, x, y }).then(() => setKeyAt(null))
                        else setKeyAt(null)
                      })
                    }}>
                      <title>Scale key: drag to move it, right-click to hide it</title>
                      <ScaleBar {...k} units={units} />
                    </g>
                  )
                })()}
                {mode === 'scale' && bar && (() => {
                  // The scale bar being set: drag the middle to move it, the yellow ends to stretch it.
                  const km = barOk ? lenKm : KM_PER[barUnit]
                  const grab = (e: React.PointerEvent, end: 'l' | 'r' | 'move') => {
                    const [sx, sy] = ctx.toImage(e.clientX, e.clientY), o = bar
                    startDrag(e, ([px, py]) => {
                      const dx = px - sx, dy = py - sy, min = 30 * s
                      if (end === 'r') setBar({ ...o, w: Math.max(min, o.w + dx) })
                      else if (end === 'l') { const w = Math.max(min, o.w - dx); setBar({ ...o, x: o.x + o.w - w, w }) }
                      else setBar({ ...o, x: o.x + dx, y: o.y + dy })
                    }, () => undefined)
                  }
                  return (
                    <g className="scale-setter">
                      <g className="scale-move" onPointerDown={(e) => grab(e, 'move')}><ScaleBar x={bar.x} y={bar.y} km={km} pxPerKm={bar.w / km} s={s} units={units} /></g>
                      {(['l', 'r'] as const).map((end) => (
                        <rect key={end} className="scale-end" x={(end === 'l' ? bar.x : bar.x + bar.w) - 3 * s} y={bar.y + 14 * s} width={6 * s} height={26 * s} rx={2 * s}
                          onPointerDown={(e) => grab(e, end)}><title>Drag to stretch the bar</title></rect>
                      ))}
                    </g>
                  )
                })()}
                {pending && mode === 'view' && view.party && (
                  <line x1={view.party.x} y1={view.party.y} x2={pending.to[0]} y2={pending.to[1]} stroke="#8f2a21" strokeWidth={3 * s}
                    strokeDasharray={`${8 * s} ${6 * s}`} pointerEvents="none" />
                )}
                {shape && (
                  <>
                    <polygon points={shape.map((p) => p.join(',')).join(' ')} fill="#8f2a21" fillOpacity="0.15" stroke="#8f2a21" strokeWidth={3 * s} />
                    {shape.map((p, i) => (
                      <circle key={i} cx={p[0]} cy={p[1]} r={9 * s} className={`vertex${corner === i ? ' is-picked' : ''}`}
                        onContextMenu={(e) => {
                          e.preventDefault(); e.stopPropagation(); setCorner(i)
                          const next = shape[(i + 1) % shape.length]
                          setShapeMenu({ x: e.clientX, y: e.clientY, items: [
                            { label: 'Add a point after this one', onClick: () => addPoint([(p[0] + next[0]) / 2, (p[1] + next[1]) / 2]) },
                            { label: 'Delete this point', danger: true, disabled: shape.length <= 3, hint: shape.length <= 3 ? 'A region needs at least 3 corners' : undefined, onClick: () => deletePoint(i) },
                          ] })
                        }}
                        onPointerDown={(e) => {
                          if (e.button !== 0) return
                          setCorner(i)
                          startDrag(e, (q) => setEditPts((pts) => (pts ?? region!.polygon).map((x, j) => (j === i ? q : x))), () => undefined)
                        }} />
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
        {pending && mode !== 'scale' && (
          <ConfirmTravel key={`${pending.to.join(',')}-${view.map.widthKm}`} view={view} pending={pending} onDone={() => setPending(null)} onSetScale={startScale} />
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
            <span className="map-travel" role="group" aria-label="Party travel">
              <button className="ink-button" disabled={!view.travel.canUndo} title="Party back to where they were; the clock goes back by the trip's time and its log line goes to History"
                onClick={() => void act('party:travel', { mapId: view.map.id, action: 'undo' })}>Undo travel</button>
              <button className="ink-button" disabled={!view.travel.canRedo} title="The undone trip again"
                onClick={() => void act('party:travel', { mapId: view.map.id, action: 'redo' })}>Redo travel</button>
              <button className="ink-button" disabled={!view.travel.canClear} title="Clears the dotted travel line on this map"
                onClick={() => setClearTravel(true)}>Clear travel</button>
            </span>
            {' · '}<button className="link-button" title="A new version of the picture; regions and the party stay on their places" onClick={() => void act('map:reimport', { mapId: view.map.id })}>Re-import picture…</button>
            {' · '}<OpenFolder sub="maps" label="Open maps folder" />
          </p>
        )}
      </div>
      <aside className="parchment-note map-side">
        {side.grip}
        {region && detail ? (
          <RegionPanel detail={detail} view={view}
            onMoveHere={() => void askTravel(spotIn(region, view.regions))}
            onEditShape={startEdit}
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
          </>
          </>
        )}
        {view.map.kind !== 'battle' && <ScaleSection view={view} onSetScale={startScale} />}
        <PartyTokens view={view} onPlace={() => void askTravel(centre)} />
      </aside>
      <Dialog title="Clear party travel?" open={clearTravel} onClose={() => setClearTravel(false)}>
        <p>Are you sure? This clears all party travel shown on this map.</p>
        <p className="hint">The trips still show in the session log, and the party stays where it is. Undo brings the line back.</p>
        <div className="dz-actions">
          <button autoFocus onClick={() => setClearTravel(false)}>Cancel</button>
          <button className="danger" onClick={() => { setClearTravel(false); void act('party:travel', { mapId: view.map.id, action: 'clear' }) }}>Yes, clear it</button>
        </div>
      </Dialog>
      {shapeMenu && <ContextMenu {...shapeMenu} onClose={() => setShapeMenu(null)} />}
      {finishing && <NewRegionDialog view={view} polygon={finishing} onClose={() => { setFinishing(null); setMode('view') }}
        onCreated={(id) => setSelected(id)} />}
    </div>
  )
}

/** Known lengths to set a scale by. */
const SCALE_HINT: Record<Units, string> = {
  imperial: 'Known lengths: a town house 20–30 ft wide · a city block about 300 ft · the walled City of London about 1 mi across · a day on foot 24 mi.',
  metric: 'Known lengths: a town house 6–9 m wide · a city block about 100 m · the walled City of London about 1.6 km across · a day on foot about 38 km.',
}

/** Map scale and the scale key: show or hide it here; it moves by dragging on the map. */
function ScaleSection({ view, onSetScale }: { view: MapScreenView; onSetScale(): void }) {
  const act = useBoard((s) => s.act)
  const units = useUnits()
  return (
    <section aria-label="Map scale">
      <h3 className="panel-subheading">Scale</h3>
      {view.map.widthKm ? <>
        <p>The map is {fmtTrip(view.map.widthKm, units)} across · <button type="button" className="link-button" onClick={onSetScale}>Change…</button></p>
        <div className="field checkbox">
          <input id="side-key" type="checkbox" checked={view.map.scaleKey}
            onChange={(e) => void act('map:setScaleKey', { mapId: view.map.id, shown: e.target.checked })} />
          <label htmlFor="side-key">Show the scale key on the map</label>
        </div>
        <p className="hint">Drag the key to move it; right-click it to hide it.</p>
      </> : <p><button type="button" className="link-button" onClick={onSetScale}>Set map scale…</button> <span className="ink-muted">to work out distance and time</span></p>}
      <p className="hint">{SCALE_HINT[units]}</p>
    </section>
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

const TRAVEL_POS = 'dz-confirm-travel-pos' // where the DM last dragged the window (this computer)

function ConfirmTravel({ view, pending, onDone, onSetScale }: { view: MapScreenView; pending: { to: Point; estimate: TravelEstimateView }; onDone(): void; onSetScale(): void }) {
  const act = useBoard((s) => s.act)
  const units = useUnits()
  const est = pending.estimate
  const first = !view.party
  // Pace starts at Normal walk every time (owner, 2026-10-16); Own speed… is typed in mph or km/h.
  const [pace, setPace] = useState('Normal walk')
  const [own, setOwn] = useState(units === 'imperial' ? '3' : '5')
  const kmhFor = (p: string, o: string) => {
    const known = PACES.find((x) => x.name === p)
    return known ? paceKmh(known, units) : Number(o) * (units === 'imperial' ? KM_PER_MILE : 1)
  }
  const minutesAt = (kmh: number) => (est.km != null && kmh > 0 ? Math.max(1, Math.round((est.km / kmh) * 60)) : est.minutes)
  const start = est.saved ? est.minutes : minutesAt(kmhFor(pace, own))
  const [hours, setHours] = useState(start != null ? String(Math.floor(start / 60)) : '')
  const [mins, setMins] = useState(start != null ? String(start % 60) : '')
  const fill = (p: string, o: string) => {
    const m = minutesAt(kmhFor(p, o))
    if (m != null) { setHours(String(Math.floor(m / 60))); setMins(String(m % 60)) }
  }
  const [remember, setRemember] = useState(false)
  const total = (Number(hours) || 0) * 60 + (Number(mins) || 0)
  const valid = first || (hours !== '' || mins !== '') && total >= 0
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return
    await act('party:move', { mapId: view.map.id, x: pending.to[0], y: pending.to[1], minutes: first ? 0 : total, rememberTime: remember })
    onDone()
  }
  // The window moves by its title; the place is kept for next time.
  const box = useRef<HTMLFormElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(() => {
    try { return JSON.parse(localStorage.getItem(TRAVEL_POS) ?? 'null') } catch { return null }
  })
  const place = (left: number, top: number) => {
    const el = box.current, parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return { left, top }
    return { left: Math.max(0, Math.min(parent.clientWidth - el.offsetWidth, left)), top: Math.max(0, Math.min(parent.clientHeight - 40, top)) }
  }
  const dragTitle = (e: React.PointerEvent<HTMLHeadingElement>) => {
    const el = box.current
    if (!el || e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const sx = e.clientX, sy = e.clientY, ox = el.offsetLeft, oy = el.offsetTop
    let last = { left: ox, top: oy }
    const h = e.currentTarget
    h.onpointermove = (m) => { last = place(ox + m.clientX - sx, oy + m.clientY - sy); setPos(last) }
    h.onpointerup = () => {
      h.onpointermove = null; h.onpointerup = null
      try { localStorage.setItem(TRAVEL_POS, JSON.stringify(last)) } catch { /* kept for this window only */ }
    }
  }
  useEffect(() => { if (pos) setPos(place(pos.left, pos.top)) }, []) // fit a saved place into a smaller window, once
  const from = est.fromName ?? 'Start', to = est.toName ?? 'Destination'
  const world = view.map.kind !== 'battle'
  return (
    <form ref={box} className="confirm-travel" onSubmit={submit} aria-label="Confirm travel" style={pos ? { left: pos.left, top: pos.top, right: 'auto' } : undefined}>
      <h3 className="drag-title" onPointerDown={dragTitle} title="Drag to move this window">{first ? 'Place the party' : 'Confirm travel'}</h3>
      <p>{first ? <>The party starts at <strong>{est.toName ?? 'this spot'}</strong>.</>
        : <>{est.km != null ? <><strong>{fmtTrip(est.km, units)}</strong> from</> : 'From'} <strong>{from}</strong> to <strong>{to}</strong>.</>}</p>
      {!first && (
        <>
          {est.km != null && (
            <div className="row tight">
              <label htmlFor="tr-pace">Pace</label>
              <select id="tr-pace" value={pace} onChange={(e) => { setPace(e.target.value); fill(e.target.value, own) }}>
                {PACES.map((p) => <option key={p.name} value={p.name}>{p.name} ({units === 'imperial' ? p.mph : p.kmh} {speedUnit(units)})</option>)}
                <option value="own">Own speed…</option>
              </select>
              {pace === 'own' && <>
                <input id="tr-own" className="short" inputMode="decimal" aria-label="Own speed" value={own}
                  onChange={(e) => { setOwn(e.target.value); fill('own', e.target.value) }} />
                <span>{speedUnit(units)}</span>
              </>}
            </div>
          )}
          <div className="row tight">
            <label htmlFor="tr-h">Hours</label>
            <input id="tr-h" className="short" type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} autoFocus />
            <label htmlFor="tr-m">Minutes</label>
            <input id="tr-m" className="short" type="number" min={0} max={59} value={mins} onChange={(e) => setMins(e.target.value)} />
          </div>
          {est.saved && <p className="ink-muted">The time you remembered for this route.</p>}
          {!est.saved && start != null && start > 24 * 60 && (
            <p className="travel-warn" role="note">More than a day on the road: this map is drawn at {view.map.widthKm ? fmtTrip(view.map.widthKm, units) : 'a large scale'} across.
              For a shorter trip, type the time, or use Set map scale… below.</p>
          )}
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
      {!first && total >= 60 && <TravelChecks view={view} minutes={total} toLocationId={est.toLocationId} />}
      {!first && <p className="ink-muted">The clock moves on by the travel time{view.sessionRunning ? ' and the trip goes in the session log' : ''}. Undo puts it all back.</p>}
      {world && (
        <div className="travel-scale">
          {view.map.widthKm ? <>
            <span>Map scale: the map is {fmtTrip(view.map.widthKm, units)} across · <button type="button" className="link-button" onClick={onSetScale}>Change…</button></span>
            <div className="field checkbox">
              <input id="tr-key" type="checkbox" checked={view.map.scaleKey}
                onChange={(e) => void act('map:setScaleKey', { mapId: view.map.id, shown: e.target.checked })} />
              <label htmlFor="tr-key">Show the scale key on the map</label>
            </div>
          </> : <span><button type="button" className="link-button" onClick={onSetScale}>Set map scale…</button> <span className="ink-muted">to work out distance and time</span></span>}
        </div>
      )}
    </form>
  )
}

/**
 * Travel checks (owner, 1.6.0): one roll per 4 hours on the road, on the "Every 4 hours" table; an
 * encounter result points at the region's table. The DM rolls here or in Roll20 and decides what
 * happens: nothing is logged until they press Log it.
 */
function TravelChecks({ view, minutes, toLocationId }: { view: MapScreenView; minutes: number; toLocationId: string | null }) {
  const { act, say, goTo } = useBoard()
  const n = travelChecks(minutes)
  const region = view.regions.find((r) => r.locationId === toLocationId)
  const encTable = findTable(encounterTableFor(region?.kind ?? null, region?.biome ?? null))!
  const check = findTable('travel-check')!
  const [rolls, setRolls] = useState<Array<string | null>>(() => Array.from({ length: n }, () => null))
  useEffect(() => setRolls(Array.from({ length: n }, () => null)), [n])
  const rollOne = (i: number) => {
    const r = rollOn(check)
    const text = /random encounter/i.test(r) ? `${r.replace(/ \(roll.*\)/, '')}: ${rollOn(encTable)}` : r
    setRolls((p) => p.map((x, j) => (j === i ? text : x)))
  }
  return (
    <div className="travel-checks">
      <h4>On the road: {n} check{n === 1 ? '' : 's'} (one per 4 hours)</h4>
      <p className="ink-muted">Roll a d20 for each (here or in Roll20): 1–14 nothing, 15 weather, 16–17 an event, 18 signs of danger, 19–20 an encounter from <strong>{encTable.name}</strong>{region ? ` (${region.name})` : ''}.</p>
      <ol>
        {rolls.map((r, i) => (
          <li key={i}>
            {r === null ? <button type="button" className="ink-button" onClick={() => rollOne(i)}>Roll check {i + 1}</button> : (
              <span className="row tight wrap">
                <span className="suggestion-inline">{r}</span>
                {!/^Nothing happens/.test(r) && view.sessionRunning && <button type="button" className="link-button" onClick={async () => { if (await act('log:add', { kind: 'note', text: `On the road: ${r}` })) say('Logged in the session') }}>Log it</button>}
                <button type="button" className="link-button" onClick={() => rollOne(i)}>Roll again</button>
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="hint"><button type="button" className="link-button" onClick={() => goTo('generators')}>Open the tables in Generators</button></p>
    </div>
  )
}

function RegionPanel({ detail, view, onMoveHere, onEditShape, onSelect }: {
  detail: RegionDetail; view: MapScreenView; onMoveHere(): void; onEditShape(): void; onSelect(locationId: string): void
}) {
  const typeColour = useTypeColour()
  const { act, openSheet, showOnBoard, openEncounter } = useBoard()
  const parents = view.regions.filter((r) => r.locationId !== detail.region.locationId)
  const list = (title: string, items: EntityBrief[], empty: string) => (
    <>
      <h3 className="side-h">{title}</h3>
      {items.length === 0 ? <p className="ink-muted">{empty}</p> : (
        <ul className="here-list">
          {items.map((e) => (
            <li key={e.id}>
              <span className="badge" style={{ background: typeColour(e.type) }}>{ENTITY_LABELS[e.type].toUpperCase()}</span>
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
              <span className="badge" style={{ background: typeColour(e.type) }}>{ENTITY_LABELS[e.type].toUpperCase()}</span>
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
      <p className="ink-muted">“Here now” lists cards tied to this place by a link (Located at, Tied to quest) or whose Location field says {detail.location.name}.</p>
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
  const [cols, setCols] = useState(view.map.gridCols != null ? String(view.map.gridCols) : '')
  const [shown, setShown] = useState(view.map.gridShown)
  const m = miles.trim() === '' ? null : Number(miles)
  const g = cols.trim() === '' ? null : Number(cols)
  const gridOk = g === null || (Number.isInteger(g) && g >= GRID_MIN && g <= GRID_MAX)
  const valid = (m === null || (Number.isFinite(m) && m > 0)) && gridOk
  return (
    <Dialog title="Map scale and grid" open onClose={onClose}>
      <form className="dz-form" onSubmit={async (e) => {
        e.preventDefault()
        if (!valid) return
        if (m !== (view.map.widthKm == null ? null : kmToShown(view.map.widthKm, units))) {
          await act('map:setScale', { mapId: view.map.id, widthKm: m === null ? null : shownToKm(m, units) })
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
          <div className="hint">A city map might be {units === 'imperial' ? '2 miles' : '3 km'} across, a kingdom {units === 'imperial' ? '300' : '500'}. Leave empty for no estimates. Or set it with a scale bar on the map: Confirm travel › Set map scale…; the pace is picked per trip there.</div>
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
