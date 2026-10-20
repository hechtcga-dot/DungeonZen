// Checks run on every smoke screenshot (in the window, via page.evaluate; keep it self-contained).
// 1. Buttons: none faded, see-through, hidden or covered by something else.
// 2. Text: none cut off by its box or a box around it, "…" included (scroll boxes are fine: you can scroll to it).
// 3. Text: none past or touching the edge of a box it sits in (panel, card, button: anything with a border or a fill),
//    even where nothing hides it; at least EDGE px clear of the left and right edges (owner, 2026-10-20).
// 4. Text: none with another element on top of it (a button over a title).
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
  const EDGE = 3
  /**
   * Boxes the text sits in, nearest first: the element and its ancestors that show an edge, up to the nearest scroll box
   * or a positioned layer (a tag or window placed on purpose over its parent). An edge is a side with a visible border,
   * or every side of a filled box that has a border, rounded corners or a shadow (a panel, card or button).
   */
  const boxes = (el) => {
    const list = []
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      const s = getComputedStyle(e)
      if (e !== el && [s.overflowX, s.overflowY].some((o) => o === 'auto' || o === 'scroll')) break
      if (s.display !== 'contents') {
        const bw = ['Top', 'Right', 'Bottom', 'Left'].map((k) => (s[`border${k}Style`] !== 'none' && (rgba(s[`border${k}Color`])?.a ?? 0) > 0 ? Number.parseFloat(s[`border${k}Width`]) : 0))
        const fill = (rgba(s.backgroundColor)?.a ?? 0) > 0 || s.backgroundImage !== 'none'
        const framed = fill && (bw.some((w) => w > 0) || Number.parseFloat(s.borderTopLeftRadius) > 0 || s.boxShadow !== 'none')
        const side = bw.map((w) => w > 0 || framed)
        if (side.some(Boolean)) {
          const r = e.getBoundingClientRect()
          list.push({ e, why: framed ? `fill ${s.backgroundColor}${s.backgroundImage !== 'none' ? ' + picture' : ''}` : 'border', top: side[0] && r.top + bw[0], right: side[1] && r.right - bw[1], bottom: side[2] && r.bottom - bw[2], left: side[3] && r.left + bw[3] })
        }
      }
      if (s.position === 'absolute' || s.position === 'fixed') break
    }
    return list
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
    // Its own box: text too long for a box that hides the rest ("…" counts too: the words are gone, hover text or not).
    if (own && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
      seen.add(el)
      out.push(`text cut off${s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none' ? ' (…)' : ''}: ${name(el)} "${node.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}"`)
      continue
    }
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
    if (seen.has(el)) continue
    const what = `${name(el)} "${node.textContent.trim().replace(/\s+/g, ' ').slice(0, 40)}"`
    const lines = [...range.getClientRects()].filter((r) => r.width >= 1 && r.height >= 1)
    // 3. Past or touching a box edge.
    for (const b of boxes(el)) {
      const gaps = (l) => [b.left !== false ? l.left - b.left : Infinity, b.right !== false ? b.right - l.right : Infinity]
      const bad = lines.find((l) => Math.min(...gaps(l)) < EDGE - 0.5 || (b.top !== false && l.top < b.top - 1) || (b.bottom !== false && l.bottom > b.bottom + 1))
      if (bad) {
        const gap = Math.min(...gaps(bad), b.top !== false ? bad.top - b.top : Infinity, b.bottom !== false ? b.bottom - bad.bottom : Infinity)
        seen.add(el)
        out.push(`text ${gap < 0 ? 'past' : 'touching'} the edge of ${name(b.e)} (${gap.toFixed(1)} px, ${b.why}): ${what}`)
        break
      }
    }
    if (seen.has(el)) continue
    // 4. Something on top: sample along the middle of each line. Board cards and strings are where the DM put them: left out.
    if (el.closest('.react-flow')) continue
    // Text that lets clicks through (a tag on a line) is invisible to elementFromPoint: left out.
    if (getComputedStyle(el).pointerEvents === 'none') continue
    for (const l of lines) {
      const y = l.top + l.height / 2
      const hit = [0.02, 0.25, 0.5, 0.75, 0.98].map((f) => l.left + 1 + (l.width - 2) * f)
        .filter((x) => x >= 0 && x < innerWidth && y >= 0 && y < innerHeight)
        .map((x) => document.elementFromPoint(x, y)).find((h) => h && !el.contains(h) && !h.contains(el))
      if (hit) { seen.add(el); out.push(`text covered by ${name(hit)}: ${what}`); break }
    }
  }
  return [...new Set(out)]
}

/**
 * Buttons with words, for the contrast check on real pixels (backgrounds are often painted parchment or wood):
 * where to sample the button's own background (just inside its border) and its text colour with opacity.
 */
export function buttonSamples() {
  const out = []
  const dialogs = [...document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')].filter((d) => d.getClientRects().length)
  const top = dialogs.at(-1) ?? null
  for (const el of document.querySelectorAll('button, [role="button"], [role="tab"]')) {
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ')
    if (!text || !el.getClientRects().length || getComputedStyle(el).visibility !== 'visible' || el.closest('[aria-hidden="true"], details:not([open]), .react-flow__minimap')) continue
    if (top && !top.contains(el)) continue
    const r = el.getBoundingClientRect()
    // Cards and tiles (a picture with a caption) are not plain buttons: left out.
    if (r.width < 8 || r.height < 8 || r.height > 80 || r.left < 2 || r.top < 2 || r.right > innerWidth - 2 || r.bottom > innerHeight - 2) continue
    if (document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button, [role="button"], [role="tab"]') !== el) continue
    const s = getComputedStyle(el)
    const m = /rgba?\(([^)]+)\)/.exec(s.color)
    if (!m) continue
    const [cr, cg, cb, ca = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number)
    let o = ca
    for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity)
    const bw = Number.parseFloat(s.borderTopWidth) || 0
    const own = bw > 0 || (/rgba?\(([^)]+)\)/.exec(s.backgroundColor)?.[1].split(/[ ,/]+/)[3] ?? '1') !== '0' || s.backgroundImage !== 'none'
    // Its own background: just inside the top and bottom edges, mid-width (inside rounded ends and seals).
    // A text link (no fill, no border): what is around it, just outside.
    const y1 = own ? r.top + bw + 2 : r.top - 2
    const y2 = own ? r.bottom - bw - 2 : r.bottom + 2
    out.push({
      what: `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''} "${text.slice(0, 40)}"`,
      off: el.disabled || el.getAttribute('aria-disabled') === 'true',
      fg: { r: cr, g: cg, b: cb, a: o },
      points: [0.3, 0.5, 0.7].flatMap((f) => [[r.left + r.width * f, y1], [r.left + r.width * f, y2]])
    })
  }
  return { list: out, width: innerWidth }
}

/** The map on screen sits in the middle of the part of its frame you can see, whole; a problem line, or null. */
export function mapCentred() {
  const frame = document.querySelector('.mapview-frame')
  const img = frame?.querySelector('img')
  if (!frame || !img) return 'no map on screen'
  const f = frame.getBoundingClientRect()
  const v = { left: Math.max(f.left, 0), top: Math.max(f.top, 0), right: Math.min(f.right, innerWidth), bottom: Math.min(f.bottom, innerHeight) }
  for (let e = frame.parentElement; e; e = e.parentElement) {
    const s = getComputedStyle(e)
    if (![s.overflowX, s.overflowY].some((o) => o !== 'visible')) continue
    const b = e.getBoundingClientRect()
    v.left = Math.max(v.left, b.left); v.top = Math.max(v.top, b.top); v.right = Math.min(v.right, b.right); v.bottom = Math.min(v.bottom, b.bottom)
  }
  const m = img.getBoundingClientRect()
  const dx = (m.left + m.right) / 2 - (v.left + v.right) / 2
  const dy = (m.top + m.bottom) / 2 - (v.top + v.bottom) / 2
  const whole = m.left >= v.left - 1 && m.right <= v.right + 1 && m.top >= v.top - 1 && m.bottom <= v.bottom + 1
  if (Math.abs(dx) > 2 || Math.abs(dy) > 2 || !whole) return `map not centred in view (off by ${dx.toFixed(0)}, ${dy.toFixed(0)} px${whole ? '' : '; part of it out of view'}; frame ${Math.round(f.height)} px high, ${Math.round(v.bottom - v.top)} px visible)`
  return null
}

/**
 * Centring and sizing (owner, 2026-10-20), a problem line each:
 * 5. Centring: things stacked one above the other in a box share one alignment (a centred picture with
 *    left-aligned words under it is wrong). What counts is what you see: the words, the picture, a framed box.
 * 6. Sizing: a picture alone in a frame fills it (90 % of its width or height); no picture is stretched out
 *    of shape; icons of the same kind side by side (a rail, a toolbar) are the same size.
 */
export function layoutProblems() {
  const out = []
  const name = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`
  const seen = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible' && Number(getComputedStyle(el).opacity) > 0
    && !el.closest('[aria-hidden="true"], details:not([open]), .react-flow, .visually-hidden')
  const dialogs = [...document.querySelectorAll('dialog[open], [role="dialog"], [aria-modal="true"]')].filter(seen)
  const top = dialogs.at(-1) ?? null
  const inView = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  const framed = (el) => {
    const s = getComputedStyle(el)
    const bg = /rgba?\(([^)]+)\)/.exec(s.backgroundColor)?.[1].split(/[ ,/]+/)[3]
    return ['Top', 'Right', 'Bottom', 'Left'].some((k) => s[`border${k}Style`] !== 'none' && Number.parseFloat(s[`border${k}Width`]) > 0) || (bg !== undefined && bg !== '0') || (bg === undefined && s.backgroundColor !== 'transparent') || s.backgroundImage !== 'none'
  }
  /** What you see of an element: its box when framed or a picture, else the union of its words, pictures and framed parts. */
  const extent = (el) => {
    if (framed(el) || ['IMG', 'SVG', 'svg', 'CANVAS', 'VIDEO', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName)) return el.getBoundingClientRect()
    let box = null
    const add = (r) => { if (!r.width || !r.height) return; box = box ? { left: Math.min(box.left, r.left), right: Math.max(box.right, r.right), top: Math.min(box.top, r.top), bottom: Math.max(box.bottom, r.bottom) } : { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
    const walk = (e) => {
      for (const c of e.childNodes) {
        if (c.nodeType === 3 && c.textContent.trim()) { const g = document.createRange(); g.selectNodeContents(c); add(g.getBoundingClientRect()) }
        else if (c.nodeType === 1 && seen(c)) { if (framed(c) || ['IMG', 'svg', 'CANVAS', 'VIDEO', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(c.tagName)) add(c.getBoundingClientRect()); else walk(c) }
      }
    }
    walk(el)
    return box
  }

  // 5. Centring
  for (const box of document.querySelectorAll('body *')) {
    if (!seen(box) || (top && !top.contains(box)) || ['svg', 'SELECT', 'P', 'SPAN', 'LABEL', 'BUTTON', 'A', 'UL', 'OL', 'TABLE', 'TBODY', 'TR'].includes(box.tagName)) continue
    const kids = [...box.children].filter((k) => seen(k) && !['absolute', 'fixed'].includes(getComputedStyle(k).position))
    if (kids.length < 2) continue
    const s = getComputedStyle(box)
    const b = box.getBoundingClientRect()
    if (!inView(b) || b.width < 120) continue
    const inner = { left: b.left + Number.parseFloat(s.borderLeftWidth) + Number.parseFloat(s.paddingLeft), right: b.right - Number.parseFloat(s.borderRightWidth) - Number.parseFloat(s.paddingRight) }
    const width = inner.right - inner.left
    const all = kids.map((k) => ({ k, r: k.getBoundingClientRect(), e: extent(k) })).filter((x) => x.e && x.e.right - x.e.left > 4)
    // Stacked: every item has the full row to itself (no two side by side).
    if (all.length < 2 || all.some((x, i) => all.some((y, j) => i !== j && x.r.top < y.r.bottom - 2 && y.r.top < x.r.bottom - 2))) continue
    // Compared: pictures and words. Headings (left above anything by convention), form fields, lists and rows of buttons are left out.
    const rows = all.filter(({ k }) => !/^(H[1-6]|LEGEND|UL|OL|DL)$/.test(k.tagName) && !k.matches('.panel-title, .panel-heading, .dz-actions')
      && !k.matches('input, select, textarea, fieldset, label') && !k.querySelector('input, select, textarea')
      && !(k.tagName !== 'BUTTON' && [...k.querySelectorAll('button')].reduce((n, b) => n + (b.textContent || '').length, 0) >= (k.textContent || '').trim().length && k.querySelector('button')))
    const sort = rows.filter((x) => x.e.right - x.e.left < width * 0.85).map((x) => {
      const mid = (x.e.left + x.e.right) / 2 - (inner.left + inner.right) / 2
      return { x, kind: Math.abs(mid) <= 3 ? 'centre' : Math.abs(x.e.left - inner.left) <= 3 ? 'left' : Math.abs(inner.right - x.e.right) <= 3 ? 'right' : 'other' }
    })
    const kinds = new Set(sort.map((x) => x.kind))
    if (kinds.has('centre') && (kinds.has('left') || kinds.has('right'))) {
      const c = sort.find((x) => x.kind === 'centre').x.k
      const o = sort.find((x) => x.kind !== 'centre' && x.kind !== 'other').x.k
      out.push(`mixed alignment in ${name(box)}: ${name(c)} centred, ${name(o)} ${sort.find((x) => x.x.k === o).kind}-aligned`)
    }
  }

  // 6. Sizing
  for (const m of document.querySelectorAll('img, svg, canvas, video')) {
    if (!seen(m) || (top && !top.contains(m)) || m.closest('svg') !== m && m.tagName === 'svg' && m.parentElement.closest('svg')) continue
    const r = m.getBoundingClientRect()
    if (!inView(r)) continue
    if (m.tagName === 'IMG' && m.naturalWidth && m.naturalHeight && getComputedStyle(m).objectFit === 'fill') {
      const k = (r.width / r.height) / (m.naturalWidth / m.naturalHeight)
      if (Math.abs(k - 1) > 0.03) out.push(`picture stretched out of shape (${Math.round(Math.abs(k - 1) * 100)} %): ${name(m)} ${m.getAttribute('alt') ?? ''}`)
    }
    if (r.width < 24 || r.height < 24 || m.closest('button')) continue
    // Alone in a frame: the nearest framed box around it holds no words and no other picture.
    let f = m.parentElement
    for (let n = 0; f && n < 3 && !framed(f); n++) f = f.parentElement
    if (!f || !framed(f) || f === document.body) continue
    if ((f.textContent || '').trim() || f.querySelectorAll('img, svg, canvas, video, input, button').length > 1 + m.querySelectorAll('svg').length) continue
    const fs = getComputedStyle(f)
    const fr = f.getBoundingClientRect()
    const fw = fr.width - Number.parseFloat(fs.borderLeftWidth) - Number.parseFloat(fs.borderRightWidth) - Number.parseFloat(fs.paddingLeft) - Number.parseFloat(fs.paddingRight)
    const fh = fr.height - Number.parseFloat(fs.borderTopWidth) - Number.parseFloat(fs.borderBottomWidth) - Number.parseFloat(fs.paddingTop) - Number.parseFloat(fs.paddingBottom)
    if (fw > 0 && fh > 0 && r.width < fw * 0.9 && r.height < fh * 0.9) out.push(`picture too small for its frame (${Math.round(Math.max(r.width / fw, r.height / fh) * 100)} %): ${name(m)} in ${name(f)}`)
  }
  // Icons of one kind in one group (rail, toolbar, tabs): same size.
  const groups = new Map()
  for (const svg of document.querySelectorAll('button > svg, a > svg, [role="tab"] > svg')) {
    const btn = svg.parentElement
    // Icons are aria-hidden (decoration for screen readers) but on screen: judged by their button.
    if (!seen(btn) || getComputedStyle(svg).visibility !== 'visible' || (top && !top.contains(svg))) continue
    const key = `${name(btn.parentElement)}|${btn.className}`
    const r = svg.getBoundingClientRect()
    if (!inView(r)) continue
    const g = groups.get(key) ?? []
    g.push({ btn, w: r.width, h: r.height })
    groups.set(key, g)
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const w = g.map((x) => x.w).sort((a, b) => a - b)[Math.floor(g.length / 2)]
    for (const x of g) if (Math.abs(x.w - w) > 1 || Math.abs(x.h - g.map((y) => y.h).sort((a, b) => a - b)[Math.floor(g.length / 2)]) > 1) {
      out.push(`icon not the size of the others beside it (${Math.round(x.w)}×${Math.round(x.h)} px, others ${Math.round(w)} px): ${name(x.btn)} "${(x.btn.textContent || x.btn.getAttribute('aria-label') || '').trim().slice(0, 30)}"`)
    }
  }
  return [...new Set(out)]
}
