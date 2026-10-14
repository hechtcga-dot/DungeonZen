import { useEffect } from 'react'
import { useBoard } from './store'

// Every titled panel on every screen folds to its title: a − / + sign after the title (click the title).
// Done once for the whole app: titles are found as screens draw, and the folded ones are remembered on this computer.
const KEY = 'dz-folded'
const TITLES = '.panel-title, .panel-heading, .mat-heading'
const BOXES = 'section, .parchment-sheet, .parchment-note, .panel'

function load(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]) } catch { return new Set() }
}
const folded = load()
const keyOf = (h: Element) => `${useBoard.getState().screen}|${h.textContent?.trim() ?? ''}`

function mark() {
  for (const h of document.querySelectorAll(TITLES)) {
    const box = h.parentElement?.closest(BOXES)
    if (!box || h.closest('dialog, .ctx-menu')) continue
    if (!h.hasAttribute('data-fold')) { h.setAttribute('data-fold', ''); h.setAttribute('title', 'Click to fold or unfold') }
    box.toggleAttribute('data-folded', folded.has(keyOf(h)))
  }
}

export function useFolding() {
  useEffect(() => {
    let queued = false
    const observer = new MutationObserver(() => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => { queued = false; mark() })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const click = (e: MouseEvent) => {
      const h = (e.target as Element).closest?.('[data-fold]')
      if (!h) return
      const k = keyOf(h)
      if (folded.has(k)) folded.delete(k); else folded.add(k)
      try { localStorage.setItem(KEY, JSON.stringify([...folded])) } catch { /* not kept */ }
      mark()
    }
    document.addEventListener('click', click)
    mark()
    return () => { observer.disconnect(); document.removeEventListener('click', click) }
  }, [])
}
