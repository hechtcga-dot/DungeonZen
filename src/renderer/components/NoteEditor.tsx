import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { Block, Run } from '../../shared/noteDoc'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const runHtml = (r: Run) => {
  let h = esc(r.text).replace(/\n/g, '<br>').replace(/\t/g, '&emsp;')
  if (r.u) h = `<u>${h}</u>`
  if (r.i) h = `<i>${h}</i>`
  if (r.b) h = `<b>${h}</b>`
  return h
}

/** Blocks as HTML for the editor (consecutive list items share one list). */
export function blocksToHtml(blocks: Block[]): string {
  let out = ''
  let list: 'ul' | 'ol' | null = null
  for (const b of blocks) {
    const want = b.kind === 'bullet' ? 'ul' : b.kind === 'number' ? 'ol' : null
    if (list && want !== list) { out += `</${list}>`; list = null }
    if (want && !list) { out += `<${want}>`; list = want }
    if (b.kind === 'table') {
      out += `<table><tbody>${b.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell.map(runHtml).join('') || '<br>'}</td>`).join('')}</tr>`).join('')}</tbody></table>`
    } else {
      const inner = b.runs.map(runHtml).join('') || '<br>'
      out += want ? `<li>${inner}</li>` : `<${b.kind}>${inner}</${b.kind}>`
    }
  }
  if (list) out += `</${list}>`
  return out || '<p><br></p>'
}

/** Reads the editor back into blocks: headings, paragraphs, lists, tables, bold/italic/underline. */
export function htmlToBlocks(root: HTMLElement): Block[] {
  const runsOf = (node: Node, fmt: { b?: boolean; i?: boolean; u?: boolean } = {}): Run[] => {
    const out: Run[] = []
    const push = (text: string, f: typeof fmt) => {
      if (!text) return
      const last = out.at(-1)
      if (last && !!last.b === !!f.b && !!last.i === !!f.i && !!last.u === !!f.u) last.text += text
      else out.push({ text, ...(f.b ? { b: true } : {}), ...(f.i ? { i: true } : {}), ...(f.u ? { u: true } : {}) })
    }
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) { push((child.textContent ?? '').replace(/ /g, '\t'), fmt); return }
      if (!(child instanceof HTMLElement)) return
      if (child.tagName === 'BR') { push('\n', fmt); return }
      const st = child.style
      const f = {
        b: fmt.b || ['B', 'STRONG'].includes(child.tagName) || st.fontWeight === 'bold' || Number(st.fontWeight) >= 600,
        i: fmt.i || ['I', 'EM'].includes(child.tagName) || st.fontStyle === 'italic',
        u: fmt.u || child.tagName === 'U' || st.textDecoration.includes('underline')
      }
      for (const r of runsOf(child, f)) push(r.text, r)
      if (['DIV', 'P'].includes(child.tagName) && child.nextSibling) push('\n', fmt)
    })
    // No trailing line break from the editor's own <br> placeholders.
    const last = out.at(-1)
    if (last) { last.text = last.text.replace(/\n+$/, ''); if (!last.text) out.pop() }
    return out
  }
  const blocks: Block[] = []
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) blocks.push({ kind: 'p', runs: [{ text: node.textContent }] })
      return
    }
    if (!(node instanceof HTMLElement)) return
    const tag = node.tagName
    if (tag === 'UL' || tag === 'OL') {
      node.querySelectorAll(':scope > li').forEach((li) => blocks.push({ kind: tag === 'UL' ? 'bullet' : 'number', runs: runsOf(li) }))
    } else if (tag === 'TABLE') {
      const rows = [...node.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll(':scope > td, :scope > th')].map((td) => runsOf(td)))
      if (rows.length) blocks.push({ kind: 'table', rows })
    } else {
      const kind = tag === 'H1' ? 'h1' : tag === 'H2' ? 'h2' : ['H3', 'H4', 'H5', 'H6'].includes(tag) ? 'h3' : 'p'
      const runs = runsOf(node)
      if (runs.some((r) => r.text.trim())) blocks.push({ kind, runs })
    }
  })
  return blocks
}

export interface NoteEditorHandle { blocks(): Block[] }

/** A small word processor: bold, italic, underline, headings, bullet and numbered lists; tables keep their text. */
export const NoteEditor = forwardRef<NoteEditorHandle, { initial: Block[]; readOnly?: boolean; onDirty(): void; label: string }>(
  function NoteEditor({ initial, readOnly, onDirty, label }, ref) {
    const el = useRef<HTMLDivElement>(null)
    useEffect(() => { if (el.current) el.current.innerHTML = blocksToHtml(initial) }, [initial])
    useImperativeHandle(ref, () => ({ blocks: () => (el.current ? htmlToBlocks(el.current) : []) }), [])
    const cmd = (name: string, value?: string) => { el.current?.focus(); document.execCommand(name, false, value); onDirty() }
    const tool = (text: string, title: string, run: () => void, cls?: string) => (
      <button type="button" className={cls} title={title} aria-label={title} onMouseDown={(e) => e.preventDefault()} onClick={run}>{text}</button>
    )
    return (
      <div className="note-editor">
        {!readOnly && (
          <div className="note-tools" role="toolbar" aria-label="Formatting">
            {tool('B', 'Bold (Ctrl+B)', () => cmd('bold'), 'is-b')}
            {tool('I', 'Italic (Ctrl+I)', () => cmd('italic'), 'is-i')}
            {tool('U', 'Underline (Ctrl+U)', () => cmd('underline'), 'is-u')}
            <span className="note-tools-gap" />
            {tool('Title', 'Heading 1', () => cmd('formatBlock', 'h1'))}
            {tool('Heading', 'Heading 2', () => cmd('formatBlock', 'h2'))}
            {tool('Small heading', 'Heading 3', () => cmd('formatBlock', 'h3'))}
            {tool('Text', 'Normal text', () => cmd('formatBlock', 'p'))}
            <span className="note-tools-gap" />
            {tool('• List', 'Bullet list', () => cmd('insertUnorderedList'))}
            {tool('1. List', 'Numbered list', () => cmd('insertOrderedList'))}
          </div>
        )}
        <div ref={el} className="note-page" contentEditable={!readOnly} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label}
          onInput={onDirty} />
      </div>
    )
  }
)
