import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Dialog } from './Dialog'
import { ENTITY_LABELS } from '../entityStyle'
import { ENTITY_TYPES } from '../../shared/schemas'
import type { EntityBrief } from '../../shared/types'

export type WordLink = { text: string; entityId: string }

/** What a sheet gives its linkable text boxes: the links, the cards, and the card shown beside the sheet. */
export const LinkContext = createContext<{
  links: WordLink[]
  cards: EntityBrief[]
  setLinks(links: WordLink[]): void
  show(entityId: string | null): void
} | null>(null)

type Hit = { from: number; to: number; link: WordLink }

/** Every place a linked phrase appears in the text (any case), longest phrases first, never overlapping. */
export function findLinks(text: string, links: WordLink[]): Hit[] {
  const low = text.toLowerCase()
  const hits: Hit[] = []
  for (const link of [...links].sort((a, b) => b.text.length - a.text.length)) {
    const t = link.text.toLowerCase()
    for (let i = low.indexOf(t); i >= 0 && t; i = low.indexOf(t, i + t.length)) {
      if (!hits.some((h) => i < h.to && i + t.length > h.from)) hits.push({ from: i, to: i + t.length, link })
    }
  }
  return hits.sort((a, b) => a.from - b.from)
}

/**
 * A text box whose words can be linked to cards: select words, right-click, Link to a card. Linked words are marked;
 * putting the cursor in them shows the card beside the sheet. Saved when you click away (Enter in one-line boxes).
 */
export function LinkField(props: {
  id: string; label: string; value: string; onCommit(value: string): void
  multiline?: boolean; rows?: number; placeholder?: string; className?: string; hint?: string
}) {
  const ctx = useContext(LinkContext)
  const [draft, setDraft] = useState(props.value)
  useEffect(() => setDraft(props.value), [props.value])
  const area = useRef<HTMLTextAreaElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const hits = ctx ? findLinks(draft, ctx.links) : []
  // The copy behind takes the box's own look (font, padding, border, background) so the marks sit under the words.
  useLayoutEffect(() => {
    const a = area.current, b = back.current
    if (!a || !b) return
    const cs = getComputedStyle(a)
    for (const k of ['font', 'letterSpacing', 'lineHeight', 'padding', 'borderWidth', 'borderRadius', 'boxSizing'] as const) b.style[k] = cs[k]
    b.style.borderStyle = 'solid'
    b.style.borderColor = 'transparent'
    b.style.background = cs.backgroundColor
    a.style.background = 'transparent'
  }, [])

  const at = () => {
    const a = area.current
    return a ? hits.find((h) => a.selectionStart >= h.from && a.selectionEnd <= h.to) : undefined
  }
  const check = () => ctx?.show(at()?.link.entityId ?? null)
  const commit = () => { const next = draft.trim(); if (next !== props.value) props.onCommit(next) }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (!props.multiline || e.ctrlKey)) { e.preventDefault(); area.current?.blur() }
    if (e.key === 'Escape') { setDraft(props.value); area.current?.blur() }
  }
  const onMenu = (e: MouseEvent) => {
    const a = area.current
    if (!ctx || !a) return
    const words = draft.slice(a.selectionStart, a.selectionEnd).trim()
    const hit = at()
    if (!words && !hit) return // the usual menu (spelling)
    e.preventDefault()
    const items: MenuItem[] = []
    if (words) items.push({ label: `Link “${words.length > 30 ? `${words.slice(0, 30)}…` : words}” to a card…`, onClick: () => setPicking(words) })
    if (hit) {
      items.push({ label: `Show ${ctx.cards.find((c) => c.id === hit.link.entityId)?.name ?? 'the card'}`, onClick: () => ctx.show(hit.link.entityId) })
      items.push({ label: `Remove the link on “${hit.link.text}”`, danger: true, onClick: () => ctx.setLinks(ctx.links.filter((l) => l !== hit.link)) })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // The marks are drawn on a copy of the text behind the (see-through) box, scrolled with it.
  const marked: ReactNode[] = []
  let k = 0
  for (const h of hits) {
    marked.push(draft.slice(k, h.from), <mark key={h.from}>{draft.slice(h.from, h.to)}</mark>)
    k = h.to
  }
  marked.push(draft.slice(k), '\n')
  return (
    <div className={`field link-field${props.multiline ? '' : ' is-line'}${props.className ? ` ${props.className}` : ''}`}>
      <label htmlFor={props.id}>{props.label}</label>
      <div className="lf-wrap">
        <div ref={back} className="lf-back" aria-hidden="true">{marked}</div>
        <textarea ref={area} id={props.id} value={draft} rows={props.multiline ? props.rows ?? 5 : 1} placeholder={props.placeholder}
          onChange={(e) => setDraft(props.multiline ? e.target.value : e.target.value.replace(/\n/g, ' '))}
          onBlur={commit} onKeyDown={onKey} onSelect={check} onContextMenu={onMenu}
          onScroll={(e) => { if (back.current) { back.current.scrollTop = e.currentTarget.scrollTop; back.current.scrollLeft = e.currentTarget.scrollLeft } }} />
      </div>
      {props.hint && <span className="hint">{props.hint}</span>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {ctx && picking !== null && (
        <CardPicker words={picking} cards={ctx.cards} onClose={() => setPicking(null)}
          onPick={(entityId) => {
            setPicking(null)
            ctx.setLinks([...ctx.links.filter((l) => l.text.toLowerCase() !== picking.toLowerCase()), { text: picking, entityId }])
            ctx.show(entityId)
          }} />
      )}
    </div>
  )
}

/** Every card, by type, with a search box. */
export function CardPicker({ words, cards, onPick, onClose }: { words: string; cards: EntityBrief[]; onPick(id: string): void; onClose(): void }) {
  const [q, setQ] = useState('')
  const t = q.trim().toLowerCase()
  const shown = cards.filter((c) => !t || c.name.toLowerCase().includes(t))
  return (
    <Dialog title={`Link “${words}” to a card`} open onClose={onClose}>
      <div className="card-picker">
        <input autoFocus type="search" placeholder="Search cards…" value={q} aria-label="Search cards" onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && shown.length === 1) onPick(shown[0].id) }} />
        <div className="card-picker-list">
          {shown.length === 0 && <p className="hint">No card by that name.</p>}
          {ENTITY_TYPES.map((type) => {
            const list = shown.filter((c) => c.type === type)
            return list.length === 0 ? null : (
              <section key={type}>
                <h3 className="panel-subheading">{ENTITY_LABELS[type]} ({list.length})</h3>
                <ul>{list.map((c) => <li key={c.id}><button className="link-button" onClick={() => onPick(c.id)}>{c.name}</button></li>)}</ul>
              </section>
            )
          })}
        </div>
        <div className="actions"><button onClick={onClose}>Cancel</button></div>
      </div>
    </Dialog>
  )
}
