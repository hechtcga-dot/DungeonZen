import { placeLabels } from '../../shared/labels'
import { placeColour } from '../../shared/places'
import type { MapScreenView, RegionView } from '../../shared/types'
import type { MapLayerContext } from './MapView'
import { KM_PER_MILE, niceStep, roundDown, type Units } from '../../shared/units'
import { useUnits } from '../store'

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

/** A player character split from the party: a smaller token with initials and the name under it. */
export function PcTokenMark({ x, y, name, scale, onPointerDown, dragging }: {
  x: number; y: number; name: string; scale: number; dragging?: boolean
  onPointerDown?(e: React.PointerEvent<SVGGElement>): void
}) {
  const s = 1 / scale
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
  return (
    <g className={`party-token pc-token${onPointerDown ? ' is-draggable' : ''}${dragging ? ' is-dragging' : ''}`}
      transform={`translate(${x} ${y}) scale(${s})`} onPointerDown={onPointerDown}>
      <title>{name} (split from the party){onPointerDown ? ': drag to move them; the clock stays' : ''}</title>
      <circle r="16" fill="#e8dcc0" stroke="#1f4f7a" strokeWidth="3.5" />
      <text y="5" textAnchor="middle" fontSize="14" fontWeight="700" fill="#1f2a3a">{initials}</text>
      <text y="33" textAnchor="middle" fontSize="13" className="map-hint-text" fill="#1f2a3a">{name}</text>
    </g>
  )
}

const FILL = '#c9b07a'

/** "Maud · Vey · Hobb +2": the NPCs and monsters in a region, as a small chip under its name. */
function Occupants({ names, y, s }: { names: string[]; y: number; s: number }) {
  if (!names?.length) return null
  const text = `${names.slice(0, 3).join(' · ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`
  const fs = 11 * s
  const w = (text.length * 6 + 26) * s
  return (
    <g className="map-occupants" transform={`translate(0 ${y})`}>
      <title>Here now: {names.join(', ')}</title>
      <rect x={-w / 2} y={0} width={w} height={fs * 1.7} rx={fs * 0.85} fill="#2f5d8a" fillOpacity="0.9" stroke="#f1e6c6" strokeWidth={s} />
      <circle cx={-w / 2 + 10 * s} cy={fs * 0.85} r={3.2 * s} fill="#f1e6c6" />
      <text x={6 * s} y={fs * 1.2} textAnchor="middle" fontSize={fs} fill="#f1e6c6" fontFamily="system-ui, sans-serif">{text}</text>
    </g>
  )
}
const TAG = 12 // name tag font size, screen pixels
/** A place name: cream writing on a dark brown tag, top edge at `y`. */
function NameTag({ name, y, s }: { name: string; y: number; s: number }) {
  const fs = TAG * s
  const w = (name.length * 6.8 + 16) * s
  return (
    <>
      <rect x={-w / 2} y={y} width={w} height={fs * 1.5} rx={2 * s} fill="#2a1f12" fillOpacity="0.85" />
      <text y={y + fs * 1.08} textAnchor="middle" fontSize={fs} fill="#f1e6c6" fontFamily="'IM Fell English', Georgia, serif">{name}</text>
    </>
  )
}
/** Settlements and landmarks are drawn as a marker, land regions as a tinted area. */
export const isSpot = (r: RegionView) => r.kind === 'city' || r.kind === 'town' || r.kind === 'village' || r.kind === 'landmark' || r.kind === 'dungeon'

/** Regions (dashed ink outlines with labels), the route and the party, drawn over a map image. */
// Clicks are handled by the map (MapView onMapClick + regionAt), because the map
// captures the pointer for panning.
export function MapOverlay({ view, ctx, selectedRegionId, hideParty, labels = true, outlines = true, names = true, scaleKey = true }: {
  view: MapScreenView
  ctx: MapLayerContext
  selectedRegionId?: string | null
  hideParty?: boolean
  labels?: boolean
  /** False: names only, no region shapes. */
  outlines?: boolean
  /** False: markers only; the board draws the names (and who is there) as region cards. */
  names?: boolean
  /** False: no scale key (the board, or the Map screen drawing its own movable one). */
  scaleKey?: boolean
}) {
  const s = 1 / ctx.scale
  const sorted = [...view.regions].sort((a, b) => area(b) - area(a)) // big regions first, sub-regions on top
  const at = labels ? placeLabels(sorted.map((r) => ({ polygon: r.polygon, name: r.name, spot: isSpot(r) })), s) : []
  return (
    <>
      {view.map.gridShown && view.map.gridCols && view.map.width && view.map.height && (
        <GridLines cols={view.map.gridCols} width={view.map.width} height={view.map.height} scale={ctx.scale} />
      )}
      {outlines && sorted.map((r) => {
        const selected = r.id === selectedRegionId
        const party = view.party?.locationId === r.locationId
        return (
          <g key={r.id} className={`map-region${selected ? ' is-selected' : ''}`}>
            <polygon points={smooth(r.polygon).map((p) => p.join(',')).join(' ')}
              fill={placeColour(r) ?? FILL} fillOpacity={selected ? 0.35 : party ? 0.25 : isSpot(r) ? 0.06 : 0.12}
              stroke={selected ? '#8f2a21' : '#2a1f12'} strokeOpacity={selected ? 1 : 0.55} strokeWidth={(selected ? 3.5 : 1.8) * s}
              strokeLinejoin="round" pointerEvents="none" />
          </g>
        )
      })}
      {labels && sorted.map((r, i) => {
        const [c0, c1] = at[i]
        // The party banner stands on the centroid of its region: lift the name above it.
        const partyHere = view.party?.locationId === r.locationId
        if (isSpot(r)) {
          // Settlements and landmarks: a marker and the name tag under it.
          const big = r.kind === 'city' ? 9 : r.kind === 'town' ? 7 : 5.5
          return (
            <g key={`l-${r.id}`} className="map-label" transform={`translate(${c0} ${c1})`} pointerEvents="none">
              {r.kind === 'dungeon' || r.kind === 'landmark'
                ? <path d={`M0 ${-big * s}L${big * s} 0L0 ${big * s}L${-big * s} 0Z`} fill={placeColour(r) ?? '#5a3f8a'} stroke="#f1e6c6" strokeWidth={1.5 * s} />
                : <circle r={big * s} fill={placeColour(r) ?? '#8f2a21'} stroke="#f1e6c6" strokeWidth={2 * s} />}
              {names && !partyHere && <NameTag name={r.name} y={(big + 3) * s} s={s} />}
              {names && <Occupants names={r.occupants} y={(big + 5) * s + TAG * 1.6 * s} s={s} />}
            </g>
          )
        }
        // Areas: the same name tag, centred (lifted when the party stands on it).
        if (!names) return null
        return (
          <g key={`l-${r.id}`} className="map-label" transform={`translate(${c0} ${partyHere ? c1 - 44 * s : c1})`} pointerEvents="none">
            <NameTag name={r.name} y={-TAG * 0.75 * s} s={s} />
            <Occupants names={r.occupants} y={(TAG * 0.75 + 2) * s} s={s} />
          </g>
        )
      })}
      {view.route.length > 1 && (
        <polyline points={view.route.map((p) => p.join(',')).join(' ')} fill="none" stroke="#8f2a21" strokeWidth={4 * s}
          strokeDasharray={`${2 * s} ${10 * s}`} strokeLinecap="round" pointerEvents="none" />
      )}
      {scaleKey && <ScaleKey view={view} scale={ctx.scale} />}
      {!hideParty && view.party && <PartyToken x={view.party.x} y={view.party.y} scale={ctx.scale} />}
      {!hideParty && view.pcs?.filter((p) => p.split?.mapId === view.map.id).map((p) => <PcTokenMark key={p.entityId} x={p.split!.x} y={p.split!.y} name={p.name} scale={ctx.scale} />)}
    </>
  )
}

const BAR_H = 54 // scale bar height, screen pixels

/**
 * A printed-style scale bar in image pixels: alternating black and white steps, the DM's system on the top row
 * and the other one underneath; text and line widths stay the same size on screen (s = 1 / zoom).
 */
export function ScaleBar({ x, y, km, pxPerKm, s, units }: { x: number; y: number; km: number; pxPerKm: number; s: number; units: Units }) {
  const w = km * pxPerKm
  const row = (metric: boolean, ry: number, top: boolean) => {
    const total = metric ? km : km / KM_PER_MILE
    const small = metric ? total <= 1 : total < 0.25 // metres up to 1 km, feet under a quarter mile
    const shown = small ? total * (metric ? 1000 : 5280) : total
    const step = niceStep(shown), n = Math.floor(shown / step + 1e-9), per = w / shown, every = n > 5 ? 2 : 1
    const parts: React.ReactNode[] = []
    for (let i = 0; i < n; i++) parts.push(<rect key={`r${i}`} x={i * step * per} y={ry} width={step * per} height={7 * s} fill={i % 2 ? '#fff' : '#111'} stroke="#111" strokeWidth={s} />)
    if (n * step < shown - 1e-9) parts.push(<rect key="rest" x={n * step * per} y={ry} width={(shown - n * step) * per} height={7 * s} fill="none" stroke="#111" strokeWidth={s} />)
    for (let i = 0; i <= n; i += every) {
      parts.push(<text key={`t${i}`} x={i * step * per} y={top ? ry - 4 * s : ry + 19 * s} fontSize={11 * s} textAnchor="middle" fill="#111">{Math.round(i * step * 100) / 100}</text>)
    }
    parts.push(<text key="u" x={w + 8 * s} y={ry + 7 * s} fontSize={10 * s} fontWeight={700} fill="#111">{metric ? (small ? 'm' : 'km') : (small ? 'ft' : 'mi')}</text>)
    return parts
  }
  const imperial = units === 'imperial'
  return (
    <g className="scale-bar" transform={`translate(${x} ${y})`} fontFamily="system-ui, sans-serif">
      <rect x={-8 * s} y={-2 * s} width={w + 34 * s} height={(BAR_H + 2) * s} rx={3 * s} fill="rgba(241,230,198,.92)" className="scale-bar-ground" />
      {row(!imperial, 18 * s, true)}
      {row(imperial, 25 * s, false)}
    </g>
  )
}

/** The map's scale key: a round length about 200 screen pixels long at the current zoom. */
export function scaleKeyLayout(map: MapScreenView['map'], scale: number, units: Units, at?: [number, number] | null) {
  if (!map.widthKm || !map.width || !map.height || !map.scaleKey) return null
  const pxPerKm = map.width / map.widthKm
  const maxKm = 200 / (pxPerKm * scale)
  const km = units === 'imperial'
    ? (maxKm / KM_PER_MILE >= 0.25 ? roundDown(maxKm / KM_PER_MILE) * KM_PER_MILE : roundDown((maxKm / KM_PER_MILE) * 5280) * (KM_PER_MILE / 5280))
    : (maxKm >= 1 ? roundDown(maxKm) : roundDown(maxKm * 1000) / 1000)
  const s = 1 / scale
  const x = at?.[0] ?? map.scaleKeyX ?? map.width * 0.03
  const y = at?.[1] ?? map.scaleKeyY ?? map.height - map.width * 0.03 - BAR_H * s
  return { x, y, km, pxPerKm, s }
}

function ScaleKey({ view, scale }: { view: MapScreenView; scale: number }) {
  const units = useUnits()
  const k = scaleKeyLayout(view.map, scale, units)
  return k && <g pointerEvents="none"><ScaleBar {...k} units={units} /></g>
}

/** A square grid (1.5 m / 5 ft squares) drawn by the app over a battle map, so it always lines up. */
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

/**
 * Rounded outline for drawing only (clicks still use the real polygon): two rounds of corner cutting.
 * Each edge's new points depend on that edge alone, so a border shared by two regions stays one line.
 */
function smooth(poly: Array<[number, number]>, rounds = 2): Array<[number, number]> {
  let p = poly
  for (let k = 0; k < rounds && p.length > 2; k++) {
    p = p.flatMap(([x0, y0], i) => {
      const [x1, y1] = p[(i + 1) % p.length]
      return [[0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]] as Array<[number, number]>
    })
  }
  return p
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
