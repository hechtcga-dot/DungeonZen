import { useEffect } from 'react'
import { create } from 'zustand'
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
// Prep section titles held their number as text until 2.2.3 ("2 Likely scenes"); kept folds and orders drop it.
// Until 2.4.0 prep titles also held "⧉ Window" (the pop-out button, now ⧉ alone and left out of titles).
const unnumber = (t: string) => t.replace(/^(\d+) (?=\D)/, '').replace(/ ?⧉( Window)?$/, '')
const folded = new Set(load<string[]>(FOLD_KEY, []).map((k) => k.startsWith('prep|') ? `prep|${unnumber(k.slice(5))}` : k))
const orders = load<Record<string, string[]>>(ORDER_KEY, {})
for (const k of Object.keys(orders)) if (k.startsWith('prep|')) orders[k] = orders[k].map(unnumber)

/** The box titles in the order the DM chose under one parent (`<screen>|<parent class>`), if they moved any. */
export const boxOrder = (key: string): string[] | undefined => orders[key]

const screen = () => useBoard.getState().screen
const titleOf = (h: Element) => (h.firstChild?.nodeType === Node.TEXT_NODE ? h.textContent ?? '' : h.textContent ?? '').replace(/[−+↑↓⧉]/g, '').trim()
const boxOf = (h: Element) => (h.closest('dialog, .ctx-menu') ? null : h.parentElement?.closest(BOXES) ?? null)
/** The box's title element (its first title, not one inside a nested box). */
const headOf = (box: Element) => [...box.querySelectorAll(TITLES)].find((h) => boxOf(h) === box)
const parentKey = (parent: Element) => `${screen()}|${parent.className}`

// On card sheets a box order is this card's own, or shared by every card of its type (the DM picks; Setup › Box order).
export type OrderScope = 'card' | 'type'
const SCOPE_KEY = 'dz-order-scope'
export const useOrderScope = create<{ scope: OrderScope | null; asking: ((scope: OrderScope | null) => void) | null; set(scope: OrderScope | null): void }>((set) => ({
  scope: load<OrderScope | null>(SCOPE_KEY, null),
  asking: null,
  set(scope) { keep(SCOPE_KEY, scope); set({ scope }) }
}))
const ask = () => new Promise<OrderScope | null>((resolve) => useOrderScope.setState({ asking: (s) => { useOrderScope.setState({ asking: null }); resolve(s) } }))
/** The keys an order is kept under: this card's, then its type's (sheets); the screen's elsewhere. */
function keysOf(parent: Element): { card: string; type: string } | null {
  const sheet = useBoard.getState().sheet
  if (screen() !== 'sheet' || !sheet) return null
  const base = parentKey(parent)
  return { card: `${base}|card:${sheet.entity.id}`, type: `${base}|type:${sheet.entity.type}` }
}
const orderOf = (parent: Element) => { const k = keysOf(parent); return k ? orders[k.card] ?? orders[k.type] : orders[parentKey(parent)] }

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
  const want = orderOf(parent)
  if (!want) return // never reordered: the screen's own layout, untouched
  const rank = (b: HTMLElement) => { const i = want.indexOf(b.dataset.box!); return i < 0 ? Infinity : i }
  const slots = boxes.map((b) => kids.indexOf(b))
  const sorted = [...boxes].sort((a, b) => rank(a) - rank(b) || kids.indexOf(a) - kids.indexOf(b))
  kids.forEach((k, i) => { k.style.order = String(i) })
  sorted.forEach((b, i) => { b.style.order = String(slots[i]) })
  // CSS order works in flex and grid; a plain block parent becomes a column.
  if (getComputedStyle(parent).display === 'block') parent.setAttribute('data-box-column', '')
}

/** Numbered titles (prep sections' round numbers) follow the boxes' shown order. */
function renumber(parent: Element) {
  const kids = [...parent.children] as HTMLElement[]
  const nums = kids.filter((k) => k.hasAttribute('data-box'))
    .map((b) => ({ at: b.style.order === '' ? kids.indexOf(b) : Number(b.style.order), n: headOf(b)?.querySelector<HTMLElement>(':scope > .prep-n') }))
    .filter((x) => x.n).sort((a, b) => a.at - b.at)
  if (nums.length < 2) return // a pop-out window: its number comes from the saved order (prepParts)
  nums.forEach((x, i) => { if (x.n!.dataset.n !== String(i + 1)) x.n!.dataset.n = String(i + 1) })
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
  parents.forEach((p) => { arrange(p); renumber(p) })
}

async function move(box: HTMLElement, dir: -1 | 1) {
  const parent = box.parentElement
  if (!parent) return
  const boxes = ([...parent.children] as HTMLElement[]).filter((k) => k.hasAttribute('data-box'))
    .sort((a, b) => Number(a.style.order) - Number(b.style.order))
  const i = boxes.indexOf(box)
  const j = i + dir
  if (j < 0 || j >= boxes.length) return
  ;[boxes[i], boxes[j]] = [boxes[j], boxes[i]]
  const order = boxes.map((b) => b.dataset.box!)
  const k = keysOf(parent)
  if (k) {
    const scope = useOrderScope.getState().scope ?? await ask()
    if (!scope) return // closed without choosing
    if (scope === 'card') orders[k.card] = order
    else { orders[k.type] = order; delete orders[k.card] }
  } else orders[parentKey(parent)] = order
  keep(ORDER_KEY, orders)
  arrange(parent)
  renumber(parent)
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
      if (!button && t.closest('button, input, select, a')) return // another button in the title (⧉) does its own thing
      const act = button?.dataset.boxAct ?? 'fold' // clicking the title itself folds too
      if (act === 'fold') {
        const k = `${screen()}|${titleOf(h)}`
        if (folded.has(k)) folded.delete(k); else folded.add(k)
        keep(FOLD_KEY, [...folded])
        mark()
      } else void move(box as HTMLElement, act === 'up' ? -1 : 1)
    }
    document.addEventListener('click', click)
    mark()
    return () => { observer.disconnect(); document.removeEventListener('click', click) }
  }, [])
}
