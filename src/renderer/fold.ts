import { useEffect } from 'react'
import { useBoard } from './store'

// Every titled box on every screen gets − / + (fold to its title) and ↑ / ↓ (move it among its neighbours).
// Done once for the whole app: titles are found as screens draw. Folds and orders are remembered per screen
// on this computer (owner, 2026-10-14). Moving uses CSS `order`, so React's own markup is never moved.
const FOLD_KEY = 'dz-folded'
const ORDER_KEY = 'dz-box-order'
const TITLES = '.panel-title, .panel-heading, .mat-heading'
const BOXES = 'section, .parchment-sheet, .parchment-note, .panel'

function load<T>(key: string, empty: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? empty } catch { return empty }
}
function keep(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* not kept */ }
}
const folded = new Set(load<string[]>(FOLD_KEY, []))
const orders = load<Record<string, string[]>>(ORDER_KEY, {})

const screen = () => useBoard.getState().screen
const titleOf = (h: Element) => (h.firstChild?.nodeType === Node.TEXT_NODE ? h.textContent ?? '' : h.textContent ?? '').replace(/[−+↑↓]/g, '').trim()
const boxOf = (h: Element) => (h.closest('dialog, .ctx-menu') ? null : h.parentElement?.closest(BOXES) ?? null)
/** The box's title element (its first title, not one inside a nested box). */
const headOf = (box: Element) => [...box.querySelectorAll(TITLES)].find((h) => boxOf(h) === box)
const parentKey = (parent: Element) => `${screen()}|${parent.className}`

function tools(): HTMLSpanElement {
  const t = document.createElement('span')
  t.className = 'box-tools'
  t.setAttribute('contenteditable', 'false')
  for (const [act, label, tip] of [['fold', '−', 'Fold to the title / unfold'], ['up', '↑', 'Move up'], ['down', '↓', 'Move down']] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.boxAct = act
    b.textContent = label
    b.title = tip
    b.setAttribute('aria-label', tip)
    t.append(b)
  }
  return t
}

/** The boxes that sit side by side in one parent, in the order the DM chose (others keep their place). */
function arrange(parent: Element) {
  const kids = [...parent.children] as HTMLElement[]
  const boxes = kids.filter((k) => k.hasAttribute('data-box'))
  if (boxes.length < 2) return
  const want = orders[parentKey(parent)]
  if (!want) return // never reordered: the screen's own layout, untouched
  const rank = (b: HTMLElement) => { const i = want.indexOf(b.dataset.box!); return i < 0 ? Infinity : i }
  const slots = boxes.map((b) => kids.indexOf(b))
  const sorted = [...boxes].sort((a, b) => rank(a) - rank(b) || kids.indexOf(a) - kids.indexOf(b))
  kids.forEach((k, i) => { k.style.order = String(i) })
  sorted.forEach((b, i) => { b.style.order = String(slots[i]) })
  // CSS order works in flex and grid; a plain block parent becomes a column.
  if (getComputedStyle(parent).display === 'block') parent.setAttribute('data-box-column', '')
}

function mark() {
  const parents = new Set<Element>()
  for (const h of document.querySelectorAll(TITLES)) {
    const box = boxOf(h)
    if (!box || headOf(box) !== h) continue
    if (!h.querySelector(':scope > .box-tools')) h.append(tools())
    const title = titleOf(h)
    ;(box as HTMLElement).dataset.box = title
    const isFolded = folded.has(`${screen()}|${title}`)
    box.toggleAttribute('data-folded', isFolded)
    const fold = h.querySelector<HTMLButtonElement>(':scope > .box-tools [data-box-act="fold"]')
    if (fold && fold.textContent !== (isFolded ? '+' : '−')) fold.textContent = isFolded ? '+' : '−'
    if (box.parentElement) parents.add(box.parentElement)
  }
  parents.forEach(arrange)
}

function move(box: HTMLElement, dir: -1 | 1) {
  const parent = box.parentElement
  if (!parent) return
  const boxes = ([...parent.children] as HTMLElement[]).filter((k) => k.hasAttribute('data-box'))
    .sort((a, b) => Number(a.style.order) - Number(b.style.order))
  const i = boxes.indexOf(box)
  const j = i + dir
  if (j < 0 || j >= boxes.length) return
  ;[boxes[i], boxes[j]] = [boxes[j], boxes[i]]
  orders[parentKey(parent)] = boxes.map((b) => b.dataset.box!)
  keep(ORDER_KEY, orders)
  arrange(parent)
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
      const t = e.target as Element
      const button = t.closest?.('[data-box-act]') as HTMLElement | null
      const h = (button ?? t).closest?.(TITLES)
      const box = h && boxOf(h)
      if (!h || !box || headOf(box) !== h) return
      const act = button?.dataset.boxAct ?? 'fold' // clicking the title itself folds too
      if (act === 'fold') {
        const k = `${screen()}|${titleOf(h)}`
        if (folded.has(k)) folded.delete(k); else folded.add(k)
        keep(FOLD_KEY, [...folded])
        mark()
      } else move(box as HTMLElement, act === 'up' ? -1 : 1)
    }
    document.addEventListener('click', click)
    mark()
    return () => { observer.disconnect(); document.removeEventListener('click', click) }
  }, [])
}
