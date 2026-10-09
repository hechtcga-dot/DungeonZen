import { useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'

/** A width remembered on this computer (per screen). */
export function useSplit(key: string, initial: number): [number, (n: number) => void] {
  const storeKey = `dz-split-${key}`
  const [value, setValue] = useState<number>(() => {
    try { const v = Number(localStorage.getItem(storeKey)); return v > 0 ? v : initial } catch { return initial }
  })
  const set = (n: number) => {
    setValue(n)
    try { localStorage.setItem(storeKey, String(Math.round(n))) } catch { /* not kept */ }
  }
  return [value, set]
}

/**
 * A bar between two areas: drag it to resize the panel on one side (`side`: which side the
 * panel is on). Double-click: back to the normal width. Arrow keys work too.
 */
export function Splitter({ value, onChange, side, min, max, label, initial, className = 'splitter' }: {
  value: number; onChange(n: number): void; side: 'left' | 'right'; min: number; max: number; label: string; initial?: number; className?: string
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n))
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const start = value
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => onChange(clamp(start + (side === 'right' ? startX - ev.clientX : ev.clientX - startX)))
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }
  return (
    <div className={className} role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={Math.round(value)}
      aria-valuemin={min} aria-valuemax={max} tabIndex={0} title={`${label} (drag; double-click for the normal width)`}
      onPointerDown={down}
      onDoubleClick={() => onChange(clamp(initial ?? (min + max) / 2))}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 60 : 20
        if (e.key === 'ArrowLeft') onChange(clamp(value + (side === 'right' ? step : -step)))
        if (e.key === 'ArrowRight') onChange(clamp(value + (side === 'right' ? -step : step)))
      }} />
  )
}

/**
 * A side panel's remembered width plus its grip. Put the grip inside the panel (it sits in the
 * gap beside it) and `style` on the layout, whose CSS reads `var(--side-w)` or `var(--left-w)`.
 */
export function useSidePanel(key: string, side: 'left' | 'right', initial: number, min = 200, max = 720): { width: number; style: CSSProperties; grip: ReactNode } {
  const [width, setWidth] = useSplit(key, initial)
  return {
    width,
    style: { [side === 'right' ? '--side-w' : '--left-w']: `${width}px` } as CSSProperties,
    grip: <Splitter className={`splitter side-grip grip-${side}`} value={width} onChange={setWidth} side={side} min={min} max={max} initial={initial} label="Resize the side panel" />,
  }
}
