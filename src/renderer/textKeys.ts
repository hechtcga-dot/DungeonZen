// Text keys for every text box (owner, 2026-10-14): Tab / Shift+Tab indent and un-indent, Enter carries a list on
// ("- ", "• ", "1."), Ctrl+D duplicates the line, Alt+↑ / ↓ moves lines. Done once for the whole app on any <textarea>.
// Edits go through insertText, so Ctrl+Z inside the box and React's onChange work as for typing.

const LIST = /^(\s*)([-*•]|(\d+)([.)]))(\s+)(.*)$/

function put(el: HTMLTextAreaElement, from: number, to: number, text: string, selStart: number, selEnd = selStart) {
  el.setSelectionRange(from, to)
  if (!document.execCommand('insertText', false, text)) el.setRangeText(text, from, to)
  el.setSelectionRange(selStart, selEnd)
}

/** The whole lines the selection touches: [start, end) without the last line's newline. */
function lines(v: string, a: number, b: number) {
  const start = v.lastIndexOf('\n', a - 1) + 1
  if (b > a && v[b - 1] === '\n') b-- // a selection ending at a line start does not take that line
  const nl = v.indexOf('\n', b)
  return { start, end: nl < 0 ? v.length : nl }
}

function onKey(e: KeyboardEvent) {
  const el = e.target
  if (!(el instanceof HTMLTextAreaElement) || el.readOnly || el.disabled || e.defaultPrevented || e.isComposing) return
  const v = el.value, a = el.selectionStart, b = el.selectionEnd
  const { start, end } = lines(v, a, b)
  const block = v.slice(start, end)

  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault()
    const many = block.includes('\n') || LIST.test(block)
    if (!e.shiftKey && !many) return put(el, a, b, '\t', a + 1)
    const rows = block.split('\n')
    const out = rows.map((r) => (e.shiftKey ? r.replace(/^(\t| {1,4})/, '') : `\t${r}`))
    const firstShift = out[0].length - rows[0].length
    const text = out.join('\n')
    put(el, start, end, text, Math.max(start, a + firstShift), Math.max(start, b + text.length - block.length))
    return
  }

  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && a === b) {
    const line = v.slice(start, a)
    const m = LIST.exec(line)
    if (!m) return
    e.preventDefault()
    const [, indent, , num, dot, gap, rest] = m
    if (!rest.trim() && v.slice(a, end).trim() === '') return put(el, start, end, indent, start + indent.length) // empty item ends the list
    const marker = num ? `${Number(num) + 1}${dot}` : m[2]
    const add = `\n${indent}${marker}${gap}`
    put(el, a, a, add, a + add.length)
    return
  }

  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') {
    e.preventDefault()
    put(el, end, end, `\n${block}`, a + block.length + 1, b + block.length + 1)
    return
  }

  if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault()
    if (e.key === 'ArrowUp') {
      if (start === 0) return
      const prevStart = v.lastIndexOf('\n', start - 2) + 1
      const prev = v.slice(prevStart, start - 1)
      put(el, prevStart, end, `${block}\n${prev}`, a - prev.length - 1, b - prev.length - 1)
    } else {
      if (end >= v.length) return
      const nextEnd = v.indexOf('\n', end + 1) < 0 ? v.length : v.indexOf('\n', end + 1)
      const next = v.slice(end + 1, nextEnd)
      put(el, start, nextEnd, `${next}\n${block}`, a + next.length + 1, b + next.length + 1)
    }
  }
}

document.addEventListener('keydown', onKey)
