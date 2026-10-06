import { centroid } from '../../shared/geometry'
import type { MapScreenView, RegionView } from '../../shared/types'
import type { MapLayerContext } from './MapView'

/** The party's banner token: a flag in a gold ring. Size stays the same on screen at any zoom. */
export function PartyToken({ x, y, scale, onPointerDown, dragging }: {
  x: number; y: number; scale: number; dragging?: boolean
  onPointerDown?(e: React.PointerEvent<SVGGElement>): void
}) {
  const s = 1 / scale
  return (
    <g className={`party-token${onPointerDown ? ' is-draggable' : ''}${dragging ? ' is-dragging' : ''}`}
      transform={`translate(${x} ${y}) scale(${s})`} onPointerDown={onPointerDown}>
      <title>The party{onPointerDown ? ': drag to move them' : ''}</title>
      <circle r="24" fill="#f6c945" stroke="#7a1e16" strokeWidth="4" />
      <circle r="18" fill="none" stroke="#fff3c4" strokeWidth="1.5" />
      <path d="M-6 13 L-6 -13 M-6 -13 L10 -8 L-6 -2" fill="#8f2a21" stroke="#3b0c08" strokeWidth="3" strokeLinejoin="round" />
    </g>
  )
}

const FILL = '#c9b07a'

/** Regions (dashed ink outlines with labels), the route and the party, drawn over a map image. */
// Clicks are handled by the map (MapView onMapClick + regionAt), because the map
// captures the pointer for panning.
export function MapOverlay({ view, ctx, selectedRegionId, hideParty, labels = true }: {
  view: MapScreenView
  ctx: MapLayerContext
  selectedRegionId?: string | null
  hideParty?: boolean
  labels?: boolean
}) {
  const s = 1 / ctx.scale
  const sorted = [...view.regions].sort((a, b) => area(b) - area(a)) // big regions first, sub-regions on top
  return (
    <>
      {view.map.gridCols && view.map.width && view.map.height && (
        <GridLines cols={view.map.gridCols} width={view.map.width} height={view.map.height} scale={ctx.scale} />
      )}
      {sorted.map((r) => {
        const selected = r.id === selectedRegionId
        const party = view.party?.locationId === r.locationId
        return (
          <g key={r.id} className={`map-region${selected ? ' is-selected' : ''}`}>
            <polygon points={r.polygon.map((p) => p.join(',')).join(' ')}
              fill={r.colour ?? FILL} fillOpacity={selected ? 0.35 : party ? 0.25 : 0.14}
              stroke={selected ? '#8f2a21' : '#2a1f12'} strokeWidth={(selected ? 4 : 2.5) * s} strokeDasharray={`${10 * s} ${7 * s}`}
              pointerEvents="none" />
          </g>
        )
      })}
      {labels && sorted.map((r) => {
        const [c0, c1] = centroid(r.polygon)
        const fs = 15 * s
        // The party banner stands on the centroid of its region: lift the name above it.
        const partyHere = view.party?.locationId === r.locationId
        const [cx, cy] = [c0, partyHere ? c1 - 44 * s : c1]
        const w = (r.name.length * 8.4 + 22) * s
        return (
          <g key={`l-${r.id}`} className="map-label" transform={`translate(${cx} ${cy})`} pointerEvents="none">
            <rect x={-w / 2} y={-fs * 1.05} width={w} height={fs * 1.6} rx={2 * s} fill="#2a1f12" fillOpacity="0.88" />
            <text y={fs * 0.1} textAnchor="middle" fontSize={fs} fill="#f1e6c6" fontFamily="'IM Fell English', Georgia, serif">{r.name}</text>
          </g>
        )
      })}
      {view.route.length > 1 && (
        <polyline points={view.route.map((p) => p.join(',')).join(' ')} fill="none" stroke="#8f2a21" strokeWidth={4 * s}
          strokeDasharray={`${2 * s} ${10 * s}`} strokeLinecap="round" pointerEvents="none" />
      )}
      {!hideParty && view.party && <PartyToken x={view.party.x} y={view.party.y} scale={ctx.scale} />}
    </>
  )
}

/** A square grid (5 ft squares) drawn by the app over a battle map, so it always lines up. */
export function GridLines({ cols, width, height, scale }: { cols: number; width: number; height: number; scale: number }) {
  const cell = width / cols
  const rows = Math.ceil(height / cell - 0.01)
  const d: string[] = []
  for (let i = 1; i < cols; i++) d.push(`M${i * cell} 0V${height}`)
  for (let j = 1; j < rows; j++) d.push(`M0 ${j * cell}H${width}`)
  return (
    <g className="grid-lines" pointerEvents="none">
      <path d={d.join('')} stroke="#120c05" strokeOpacity="0.45" strokeWidth={Math.max(1 / scale, cell * 0.012)} fill="none" />
    </g>
  )
}

function area(r: RegionView): number {
  let a = 0
  const p = r.polygon
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1])
  return Math.abs(a / 2)
}

/** A read-only `layer` for MapView (desk and live maps): regions, route and party, if the loaded view is for this map. */
export function readOnlyLayer(view: MapScreenView | null, mapId: string): ((ctx: MapLayerContext) => React.ReactNode) | undefined {
  if (!view || view.map.id !== mapId) return undefined
  return (ctx) => <MapOverlay view={view} ctx={ctx} />
}
