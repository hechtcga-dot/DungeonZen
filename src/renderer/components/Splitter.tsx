import { useState, type PointerEvent } from 'react'

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
export function Splitter({ value, onChange, side, min, max, label, initial }: {
  value: number; onChange(n: number): void; side: 'left' | 'right'; min: number; max: number; label: string; initial?: number
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
    <div className="splitter" role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={Math.round(value)}
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
