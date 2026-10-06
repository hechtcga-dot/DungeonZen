import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { fitTransform, zoomAt, type Transform } from '../../shared/zoom'

export interface MapLayerContext {
  /** Current zoom (screen pixels per image pixel). Divide sizes by it to keep markers the same size on screen. */
  scale: number
  /** Converts a screen point (clientX, clientY) to image pixel coordinates. */
  toImage(clientX: number, clientY: number): [number, number]
}

/**
 * A map image you can zoom (mouse wheel, buttons, + and - keys, double-click)
 * and pan (drag, arrow keys). Zoom follows the pointer. `layer` draws on top of
 * the image in image pixel coordinates (an SVG the size of the image).
 */
export function MapView(props: {
  src: string
  alt: string
  className?: string
  layer?: (ctx: MapLayerContext) => ReactNode
  /** A click (not a drag) on the map, in image coordinates. */
  onMapClick?(p: [number, number]): void
  /** When true, double-click does not zoom (drawing tools use it). */
  noDoubleClickZoom?: boolean
  onKeyDown?(e: KeyboardEvent): boolean | void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [t, setT] = useState<Transform>({ scale: 1, x: 0, y: 0 })
  const tRef = useRef(t)
  tRef.current = t
  const [fitScale, setFitScale] = useState(1)
  const drag = useRef<{ id: number; x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)

  const fit = useCallback(() => {
    const el = frame.current
    if (!el || !natural) return
    const next = fitTransform(natural.w, natural.h, el.clientWidth, el.clientHeight)
    setFitScale(next.scale)
    setT(next)
  }, [natural])

  useEffect(() => { fit() }, [fit])
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    return () => ro.disconnect()
  }, [fit])

  const limits = { min: fitScale * 0.5, max: Math.max(fitScale * 12, 4) }

  const zoomBy = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = frame.current
    if (!el) return
    setT((cur) => zoomAt(cur, factor, cx ?? el.clientWidth / 2, cy ?? el.clientHeight / 2, limits.min, limits.max))
  }, [limits.min, limits.max])

  // Wheel zoom needs a non-passive listener so the page does not scroll instead.
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  const toImage = useCallback((clientX: number, clientY: number): [number, number] => {
    const rect = frame.current?.getBoundingClientRect()
    const cur = tRef.current
    if (!rect) return [0, 0]
    return [(clientX - rect.left - cur.x) / cur.scale, (clientY - rect.top - cur.y) / cur.scale]
  }, [])

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moved: false }
  }
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true
    if (d.moved) setT((cur) => ({ ...cur, x: d.tx + e.clientX - d.x, y: d.ty + e.clientY - d.y }))
  }
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved && props.onMapClick) props.onMapClick(toImage(e.clientX, e.clientY))
  }

  const onKey = (e: KeyboardEvent) => {
    if (props.onKeyDown?.(e)) { e.preventDefault(); return }
    const step = 60
    if (e.key === '+' || e.key === '=') zoomBy(1.25)
    else if (e.key === '-' || e.key === '_') zoomBy(0.8)
    else if (e.key === '0') fit()
    else if (e.key === 'ArrowLeft') setT((c) => ({ ...c, x: c.x + step }))
    else if (e.key === 'ArrowRight') setT((c) => ({ ...c, x: c.x - step }))
    else if (e.key === 'ArrowUp') setT((c) => ({ ...c, y: c.y + step }))
    else if (e.key === 'ArrowDown') setT((c) => ({ ...c, y: c.y - step }))
    else return
    e.preventDefault()
  }

  const percent = fitScale ? Math.round((t.scale / fitScale) * 100) : 100
  return (
    <div className={`mapview ${props.className ?? ''}`}>
      <div
        ref={frame}
        className="mapview-frame"
        tabIndex={0}
        role="application"
        aria-label={`${props.alt}. Scroll or press plus and minus to zoom, drag or use the arrow keys to move, 0 to fit.`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null }}
        onDoubleClick={(e) => {
          if (props.noDoubleClickZoom) return
          const rect = e.currentTarget.getBoundingClientRect()
          zoomBy(1.6, e.clientX - rect.left, e.clientY - rect.top)
        }}
        onKeyDown={onKey}
      >
        <div className="mapview-layer" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})` }}>
          <img
            src={props.src}
            alt=""
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
          {natural && props.layer && (
            <svg className="mapview-svg" width={natural.w} height={natural.h} viewBox={`0 0 ${natural.w} ${natural.h}`}>
              {props.layer({ scale: t.scale, toImage })}
            </svg>
          )}
        </div>
      </div>
      <div className="mapview-controls" role="group" aria-label="Map zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>+</button>
        <span className="mapview-zoom mono" aria-live="polite">{percent}%</span>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>−</button>
        <button type="button" onClick={fit}>Fit</button>
      </div>
    </div>
  )
}
