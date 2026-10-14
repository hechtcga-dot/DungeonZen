import { useEffect, useRef, useState } from 'react'
import { call } from '../api'
import { useUnits } from '../store'
import type { MapView } from '../../shared/types'
import { fmtSquares } from '../../shared/units'
import { GRID_MAX, GRID_MIN } from '../../shared/battlemap'

export type Crop = { x: number; y: number; w: number; h: number }
/** A picture to follow: a campaign map or an uploaded picture (copied into the campaign), and the part to use. */
export type Follow = { mapId?: string; path?: string; url: string; name: string; widthKm: number | null; crop: Crop; px: [number, number] | null }

const WHOLE: Crop = { x: 0, y: 0, w: 1, h: 1 }
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * Battle map Draw window: "Follow a picture". The DM picks a map or uploads a picture and drags a box
 * round the part to turn into a battle map; the AI keeps that part's layout and draws it at battle-map scale.
 */
export function FollowPicture({ value, onChange, cols, onSize }: {
  value: Follow | null
  onChange(next: Follow | null): void
  cols: number
  /** Size in squares for this part (rows follow its shape; cols too when the map's scale is used). */
  onSize(cols: number, rows: number): void
}) {
  const units = useUnits()
  const [maps, setMaps] = useState<MapView[]>([])
  const [drag, setDrag] = useState<Crop | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const start = useRef<[number, number] | null>(null)
  useEffect(() => { void call('desk:view', undefined).then((d) => setMaps(d.maps)).catch(() => setMaps([])) }, [])

  const pick = async (v: string) => {
    if (v === '') return onChange(null)
    if (v === 'upload') {
      const path = await call('outline:upload', 'follow')
      if (path) onChange({ path, url: `dz-asset://campaign/${path.split('/').map(encodeURIComponent).join('/')}`, name: 'Uploaded picture', widthKm: null, crop: WHOLE, px: null })
      return
    }
    const m = maps.find((x) => x.id === v)
    if (m) onChange({ mapId: m.id, url: m.url, name: m.name, widthKm: m.widthKm, crop: WHOLE, px: m.width && m.height ? [m.width, m.height] : null })
  }
  const rowsOf = (f: Follow, c: Crop, across: number) => f.px ? Math.round((across * c.h * f.px[1]) / (c.w * f.px[0])) : across
  const fit = (n: number) => Math.min(GRID_MAX, Math.max(GRID_MIN, n))
  const setCrop = (crop: Crop) => {
    if (!value) return
    onChange({ ...value, crop })
    onSize(cols, fit(rowsOf(value, crop, cols)))
  }

  const at = (e: React.PointerEvent): [number, number] => {
    const r = frame.current!.getBoundingClientRect()
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]
  }
  const boxFrom = (a: [number, number], b: [number, number]): Crop => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) })

  // Real size of the chosen part, when the map has a scale (Map › Scale and grid).
  const squaresAcross = value?.widthKm ? Math.round((value.crop.w * value.widthKm * 1000) / 1.5) : null
  const crop = drag ?? value?.crop ?? WHOLE

  return (
    <div className="blueprint-box follow-box">
      <label className="field">
        <span><strong>Follow a picture</strong> <span className="hint">(optional)</span></span>
        <select value={value ? value.mapId ?? 'upload-done' : ''} onChange={(e) => void pick(e.target.value)} aria-label="Picture to follow">
          <option value="">None</option>
          {maps.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.kind === 'world' ? 'map' : 'battle map'})</option>)}
          {value?.path && <option value="upload-done">{value.name}</option>}
          <option value="upload">Upload a picture…</option>
        </select>
      </label>
      <span className="hint">The AI keeps the layout of the part you box (roads, rivers, buildings, trees, fields) and redraws it as a detailed battle map at 5 ft squares, without any text, symbols or watermarks. The sketch is not sent while a picture is followed.</span>
      {value && (
        <>
          <span className="hint">Drag a box round the part to use. <button type="button" className="link-button" onClick={() => setCrop(WHOLE)}>Whole picture</button></span>
          <div ref={frame} className="follow-frame"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start.current = at(e); setDrag(boxFrom(start.current, start.current)) }}
            onPointerMove={(e) => { if (start.current) setDrag(boxFrom(start.current, at(e))) }}
            onPointerUp={(e) => {
              if (!start.current) return
              const box = boxFrom(start.current, at(e))
              start.current = null; setDrag(null)
              if (box.w > 0.01 && box.h > 0.01) setCrop(box)
            }}>
            <img src={value.url} alt={`${value.name}: drag a box round the part to use`} draggable={false}
              onLoad={(e) => { if (!value.px) onChange({ ...value, px: [e.currentTarget.naturalWidth, e.currentTarget.naturalHeight] }) }} />
            <span className="follow-crop" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
          </div>
          {squaresAcross !== null && (
            <span className="hint">
              At the map's scale this part is about {fmtSquares(squaresAcross, units)} across ({squaresAcross} squares).{' '}
              {squaresAcross <= GRID_MAX && squaresAcross >= GRID_MIN
                ? <button type="button" className="link-button" onClick={() => onSize(squaresAcross, fit(rowsOf(value, value.crop, squaresAcross)))}>Use the map's scale ({squaresAcross} × {fit(rowsOf(value, value.crop, squaresAcross))} squares)</button>
                : squaresAcross > GRID_MAX ? `Battle maps go up to ${GRID_MAX} squares: box a smaller part for true scale, or keep ${cols} squares and the AI draws everything at battle-map size.` : ''}
            </span>
          )}
        </>
      )}
    </div>
  )
}
