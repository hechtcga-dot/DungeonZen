import { useEffect, useRef, useState } from 'react'
import { call } from '../api'
import { useUnits } from '../store'
import type { MapView } from '../../shared/types'
import { fmtSquares } from '../../shared/units'
import { fitToMax, GRID_MAX, GRID_MIN, type Crop, type FollowSource } from '../../shared/battlemap'

const WHOLE: Crop = { x: 0, y: 0, w: 1, h: 1 }
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const fit = (n: number) => Math.min(GRID_MAX, Math.max(GRID_MIN, n))

/**
 * Battle map Draw window: "Follow a picture". The DM picks a map or uploads a picture and drags a box
 * round the part to turn into a battle map; the AI keeps that part's layout and draws it at battle-map scale.
 */
export function FollowPicture({ value, onChange, cols, onSize }: {
  value: FollowSource | null
  onChange(next: FollowSource | null): void
  cols: number
  /** Size in squares for this part (rows follow its shape; cols too when the map's scale is used). */
  onSize(cols: number, rows: number): void
}) {
  const units = useUnits()
  const [maps, setMaps] = useState<MapView[]>([])
  const [loaded, setLoaded] = useState<[number, number] | null>(null)
  const [drag, setDrag] = useState<Crop | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const start = useRef<[number, number] | null>(null)
  useEffect(() => { void call('desk:view', undefined).then((d) => setMaps(d.maps)).catch(() => setMaps([])) }, [])

  const map = value?.mapId ? maps.find((m) => m.id === value.mapId) ?? null : null
  const url = map?.url ?? (value?.path ? `dz-asset://campaign/${value.path.split('/').map(encodeURIComponent).join('/')}` : null)
  const px: [number, number] | null = map?.width && map.height ? [map.width, map.height] : loaded

  const pick = async (v: string) => {
    setLoaded(null)
    if (v === '') return onChange(null)
    if (v === 'upload') {
      const path = await call('outline:upload', 'follow')
      if (path) onChange({ path, crop: WHOLE, buildings: value?.buildings })
      return
    }
    if (maps.some((x) => x.id === v)) onChange({ mapId: v, crop: WHOLE, buildings: value?.buildings })
  }
  const rowsOf = (c: Crop, across: number) => px ? Math.round((across * c.h * px[1]) / (c.w * px[0])) : across
  const setCrop = (crop: Crop) => {
    if (!value) return
    onChange({ ...value, crop })
    onSize(cols, fit(rowsOf(crop, cols)))
  }

  const at = (e: React.PointerEvent): [number, number] => {
    const r = frame.current!.getBoundingClientRect()
    return [clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)]
  }
  const boxFrom = (a: [number, number], b: [number, number]): Crop => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) })

  // Real size of the boxed part in squares, when the map has a scale (Map › Scale and grid).
  const across = value && map?.widthKm ? Math.round((value.crop.w * map.widthKm * 1000) / 1.5) : null
  const deep = value && across !== null ? rowsOf(value.crop, across) : null
  const tooBig = value && across !== null && deep !== null ? fitToMax(value.crop, { across, deep }) : null
  const crop = drag ?? value?.crop ?? WHOLE

  return (
    <div className="blueprint-box follow-box">
      <label className="field">
        <span><strong>Follow a picture</strong> <span className="hint">(optional)</span></span>
        <select value={value ? value.mapId ?? 'uploaded' : ''} onChange={(e) => void pick(e.target.value)} aria-label="Picture to follow">
          <option value="">None</option>
          {maps.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.kind === 'world' ? 'map' : 'battle map'})</option>)}
          {value?.path && <option value="uploaded">Uploaded picture</option>}
          <option value="upload">Upload a picture…</option>
        </select>
      </label>
      <span className="hint">The AI keeps the layout of the part you box (roads, rivers, buildings, trees, fields) and redraws it as a detailed battle map at 5 ft squares, without any text, symbols or watermarks. The sketch is not sent while a picture is followed.</span>
      {value && !url && <span className="field-error">That map is no longer in the campaign. Choose another picture.</span>}
      {value && url && (
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
            <img src={url} alt={`${map?.name ?? 'Uploaded picture'}: drag a box round the part to use`} draggable={false}
              onLoad={(e) => setLoaded([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])} />
            <span className="follow-crop" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
          </div>
          {across !== null && deep !== null && (tooBig ? (
            <div className="field-warning" role="status">
              <span>At the map's scale this part is about {fmtSquares(across, units)} × {fmtSquares(deep, units)} ({across} × {deep} squares). Battle maps go up to {GRID_MAX} squares ({fmtSquares(GRID_MAX, units)}), so the AI would have to squeeze it.</span>
              <button type="button" onClick={() => { onChange({ ...value, crop: tooBig.crop }); onSize(tooBig.cols, tooBig.rows) }}>
                Make the largest map: {tooBig.cols} × {tooBig.rows} squares ({fmtSquares(tooBig.cols, units)} × {fmtSquares(tooBig.rows, units)})
              </button>
              <span className="hint">Shrinks the box round its middle to that size at the map's scale.</span>
            </div>
          ) : (
            <span className="hint">
              At the map's scale this part is about {fmtSquares(across, units)} × {fmtSquares(deep, units)} ({across} × {deep} squares).{' '}
              {across >= GRID_MIN && deep >= GRID_MIN && <button type="button" className="link-button" onClick={() => onSize(across, deep)}>Use the map's scale</button>}
            </span>
          ))}
        </>
      )}
    </div>
  )
}
