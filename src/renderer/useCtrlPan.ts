import { useEffect, type RefObject } from 'react'

/**
 * Ctrl + drag anywhere on the element moves the view and never selects or moves what is under
 * the mouse. Listens in the capture phase so cards, regions and the board never see the press.
 */
export function useCtrlPan(ref: RefObject<HTMLElement | null>, pan: (dx: number, dy: number) => void): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const down = (e: MouseEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      let last = { x: e.clientX, y: e.clientY }
      el.classList.add('is-ctrl-panning')
      const move = (m: MouseEvent) => { pan(m.clientX - last.x, m.clientY - last.y); last = { x: m.clientX, y: m.clientY } }
      const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault() }
      const up = () => {
        window.removeEventListener('mousemove', move, true)
        window.removeEventListener('mouseup', up, true)
        el.classList.remove('is-ctrl-panning')
        // The click that follows the release must not select anything either.
        window.addEventListener('click', swallow, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      }
      window.addEventListener('mousemove', move, true)
      window.addEventListener('mouseup', up, true)
    }
    // The pointer event comes first; stopping it keeps drag libraries from starting.
    const stopPointer = (e: PointerEvent) => { if ((e.ctrlKey || e.metaKey) && e.button === 0) e.stopPropagation() }
    el.addEventListener('pointerdown', stopPointer, true)
    el.addEventListener('mousedown', down, true)
    return () => { el.removeEventListener('pointerdown', stopPointer, true); el.removeEventListener('mousedown', down, true) }
  }) // every render: the element may appear later (an empty timeline has none)
}
