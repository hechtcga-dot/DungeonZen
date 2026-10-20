// Checks run on every smoke screenshot (in the window, via page.evaluate; keep it self-contained).
// 1. Buttons: none faded, see-through, hidden or covered by something else.
// 2. Text: none cut off by its box or a box around it (scroll boxes are fine: you can scroll to it).
// Returns one line per problem: "<what>: <element> "<text>"".
export function uiProblems() {
  const out = []
  const name = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
    return `${el.tagName.toLowerCase()}${cls}`
  }
  const label = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
  // Rendered and meant to be seen: not in a closed <details>, not screen-reader-only text (a 1 px box).
  const shown = (el) => {
    if (!el.getClientRects().length || getComputedStyle(el).visibility !== 'visible') return false
    const closed = el.closest('details:not([open])')
    if (closed && !closed.querySelector(':scope > summary')?.contains(el)) return false
    for (let e = el; e; e = e.parentElement) { const r = e.getBoundingClientRect(); if (r.width <= 1 && r.height <= 1) return false }
    return true
  }
  const rgba = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a } }
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
  }
  const opacity = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o }
  /** The solid colour behind an element, or null when a picture or gradient is behind it (unknown). */
  const backdrop = (el) => {
    const layers = []
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e)
      if (s.backgroundImage !== 'none') return null
      const c = rgba(s.backgroundColor)
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break }
    }
    let bg = { r: 255, g: 255, b: 255 }
    for (const c of layers.reverse()) bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) }
    return bg
  }
  /** Boxes that cut off what is inside them (overflow hidden or clip), nearest first, up to the nearest scroll box (you can scroll to it). */
  const clippers = (el) => {
    const list = []
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e)
      if ([s.overflowX, s.overflowY].some((o) => o === 'auto' || o === 'scroll')) break
      if ([s.overflowX, s.overflowY].some((o) => o === 'hidden' || o === 'clip')) list.push({ e, x: s.overflowX, y: s.overflowY })
    }
    return list
  }
  const scrolledAway = (el, r) => {
    for (let e = el.parentElement; e; e = e.parentElement) {
      const s = getComputedStyle(e)
      if (![s.overflowX, s.overflowY].some((o) => o === 'auto' || o === 'scroll')) continue
      const b = e.getBoundingClientRect()
      if (r.bottom <= b.top || r.top >= b.bottom || r.right <= b.left || r.left >= b.right) return true
    }
    return r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth
  }
  // With a window (dialog) open, only its own buttons count: the rest are behind it on purpose.
  const dialogs = [...document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')].filter(shown)
  const top = dialogs.at(-1) ?? null

  // 1. Buttons
  for (const el of document.querySelectorAll('button, [role="button"], [role="tab"], a[href]')) {
    if (!shown(el) || el.closest('[aria-hidden="true"], .react-flow__minimap')) continue
    if (top && !top.contains(el)) continue
    const r = el.getBoundingClientRect()
    if (scrolledAway(el, r)) continue
    const what = `${name(el)} "${label(el)}"`
    if (r.width < 4 || r.height < 4) { out.push(`button has no size: ${what}`); continue }
    const off = el.disabled || el.getAttribute('aria-disabled') === 'true'
    const o = opacity(el)
    if (o < (off ? 0.35 : 0.95)) { out.push(`button see-through (opacity ${o.toFixed(2)}): ${what}`); continue }
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1)
    const cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1)
    const hit = document.elementFromPoint(cx, cy)
    if (hit && !el.contains(hit) && !hit.contains(el)) { out.push(`button covered by ${name(hit)}: ${what}`); continue }
    const text = rgba(getComputedStyle(el).color)
    const bg = backdrop(el)
    if (text && bg && label(el) && !off) {
      const fg = { r: text.r * text.a + bg.r * (1 - text.a), g: text.g * text.a + bg.g * (1 - text.a), b: text.b * text.a + bg.b * (1 - text.a) }
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a)
      const ratio = (hi + 0.05) / (lo + 0.05)
      if (ratio < 3) out.push(`button text hard to see (contrast ${ratio.toFixed(1)}:1): ${what}`)
    }
  }

  // 2. Text cut off
  const seen = new Set()
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement
    if (!el || seen.has(el) || !node.textContent.trim()) continue
    if (el.closest('input, textarea, select, option, script, style, svg, [aria-hidden="true"]') || !shown(el)) continue
    if (top && !top.contains(el)) continue
    const s = getComputedStyle(el)
    const own = [s.overflowX, s.overflowY].some((o) => o === 'hidden' || o === 'clip')
    // Its own box: text too long for a box that hides the rest. "…" is fine only with the full text on hover.
    if (own && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      if (!(s.textOverflow === 'ellipsis' && el.closest('[title]'))) {
        seen.add(el)
        out.push(`text cut off${s.textOverflow === 'ellipsis' ? ' (…, no hover text)' : ''}: ${name(el)} "${node.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}"`)
      }
      continue
    }
    if (own && s.textOverflow === 'ellipsis') continue
    const range = document.createRange()
    range.selectNodeContents(node)
    const t = range.getBoundingClientRect()
    if (t.width < 1 || t.height < 1 || scrolledAway(el, t)) continue
    for (const c of clippers(el)) {
      const b = c.e.getBoundingClientRect()
      if (b.width <= 1 && b.height <= 1) break // screen-reader-only text
      const cutX = c.x !== 'visible' && (t.left < b.left - 1 || t.right > b.right + 1)
      const cutY = c.y !== 'visible' && (t.top < b.top - 1 || t.bottom > b.bottom + 1)
      if (cutX || cutY) {
        seen.add(el)
        out.push(`text cut off by ${name(c.e)}: ${name(el)} "${node.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}"`)
        break
      }
    }
  }
  return [...new Set(out)]
}
