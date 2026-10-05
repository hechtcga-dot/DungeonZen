import { useEffect, useLayoutEffect, useState } from 'react'
import { lightingAt } from '../../shared/sky'

// How dark the table gets at midnight (0..1). Kept below 1 so text stays readable.
const MAX_DARK = 0.6

function readPref(): boolean {
  try { return localStorage.getItem('dz.lighting') !== 'off' } catch { return true }
}

/** Whether day/night lighting is on. A per-computer preference, remembered in the browser storage. */
export function useLightingPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readPref)
  const set = (next: boolean) => {
    setOn(next)
    try { localStorage.setItem('dz.lighting', next ? 'on' : 'off') } catch { /* storage unavailable: keep for this session */ }
    window.dispatchEvent(new Event('dz-lighting'))
  }
  useEffect(() => {
    const sync = () => setOn(readPref())
    window.addEventListener('dz-lighting', sync)
    return () => window.removeEventListener('dz-lighting', sync)
  }, [])
  return [on, set]
}

interface Pool { x: number; y: number }

/**
 * Darkens the whole screen as night falls, tints dawn and dusk, and lets lit
 * candles (elements with class "candle-light") throw pools of warm light.
 * Purely visual: pointer events pass through.
 */
export function TableLighting({ minutes }: { minutes: number }) {
  const [enabled] = useLightingPref()
  const light = lightingAt(minutes)
  const [pools, setPools] = useState<Pool[]>([])

  // Follow the candles as the page scrolls or resizes.
  useLayoutEffect(() => {
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const found = [...document.querySelectorAll('.candle-light')].map((el) => {
          const r = el.getBoundingClientRect()
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
        })
        setPools((prev) => (JSON.stringify(prev) === JSON.stringify(found) ? prev : found))
      })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    const t = setInterval(measure, 1000) // layout can shift as data loads
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(t)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
    }
  }, [light.candlesLit])

  if (!enabled) return null
  const shade = light.darkness * MAX_DARK
  const lit = light.candlesLit ? pools : []
  const mask = lit.length
    ? lit.map((p) => `radial-gradient(circle at ${p.x}px ${p.y}px, transparent 40px, rgba(0,0,0,0.35) 160px, black 460px)`).join(', ')
    : undefined
  return (
    <div className="table-lighting" aria-hidden="true">
      <div className="light-twilight" style={{ opacity: light.twilight * 0.55 }} />
      <div
        className="light-shade"
        style={{ opacity: shade, maskImage: mask, WebkitMaskImage: mask, maskComposite: 'intersect', WebkitMaskComposite: 'source-in' }}
      />
      <div
        className="light-glow"
        style={{
          opacity: lit.length ? light.darkness * 0.7 : 0,
          background: lit.map((p) => `radial-gradient(circle at ${p.x}px ${p.y}px, rgba(255, 176, 80, 0.55), rgba(255, 140, 50, 0.12) 180px, transparent 420px)`).join(', ') || 'none'
        }}
      />
    </div>
  )
}
