import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Dialog } from './Dialog'
import { ENTITY_LABELS, useTypeColour } from '../entityStyle'
import { ENTITY_TYPES } from '../../shared/schemas'
import type { EntityType } from '../../shared/schemas'
import type { EntityBrief, WordLinksView } from '../../shared/types'
import { useBoard } from '../store'
import { autoNames, DEFAULT_LINK_RULES, linksByItself } from '../../shared/noteLinks'
import { DateWordContext, DateWordDialog, EventDialog, type EventDraft } from './CalendarDialogs'
import { dayOfMinutes, findDateWords, type DateWord } from '../../shared/calendar'

/** auto: a card's own name, linked only as whole words; exact: only as written (a one-word name with its capital). */
export type WordLink = { text: string; entityId: string; auto?: boolean; exact?: boolean }

/** What a sheet gives its linkable text boxes: the links, the cards, and the card shown beside the sheet. */
export const LinkContext = createContext<{
  links: WordLink[]
  cards: EntityBrief[]
  setLinks(links: WordLink[]): void
  show(entityId: string | null): void
} | null>(null)

type Hit = { from: number; to: number; link: WordLink }
type LinkCtx = NonNullable<React.ContextType<typeof LinkContext>>

/**
 * Card names link by themselves (whole words; shared/noteLinks.ts autoNames, the same rule as Notes); own links win.
 * Stopping a name's link unticks "Link this name by itself" on its card, undoable.
 */
export function withAutoLinks(w: WordLinksView | null, own: WordLink[], setOwn: (links: WordLink[]) => void, show: (id: string | null) => void): LinkCtx {
  const cards = w?.cards ?? []
  const taken = new Set(own.map((l) => l.text.toLowerCase()))
  const auto: WordLink[] = autoNames(cards, w?.rules ?? DEFAULT_LINK_RULES, w?.off ?? []).filter((n) => !taken.has(n.text.toLowerCase()))
    .map((n) => ({ text: n.text, entityId: n.target, auto: true, exact: n.exact }))
  return {
    links: [...own, ...auto], cards, show,
    setLinks: (next) => {
      const nextOwn = next.filter((l) => !l.auto).map(({ text, entityId }) => ({ text, entityId }))
      const dropped = auto.filter((l) => !next.includes(l) && !nextOwn.some((o) => o.text.toLowerCase() === l.text.toLowerCase()))
      for (const l of dropped) void useBoard.getState().act('entity:update', { id: l.entityId, patch: { attributes: { link_name: false } } })
      if (nextOwn.length !== own.length || nextOwn.some((l, i) => l.text !== own[i].text || l.entityId !== own[i].entityId)) setOwn(nextOwn)
    }
  }
}

/** The whole app's linked words (no sheet of its own): the card shows in a note at the corner. */
export function GlobalLinks({ children }: { children: ReactNode }) {
  const w = useBoard((s) => s.wordLinks)
  const value = useMemo(() => withAutoLinks(w, w?.own ?? [],
    (own) => void useBoard.getState().act('links:set', { own, off: w?.off ?? [] }),
    (id) => useBoard.setState({ linkCard: id })), [w])
  return <LinkContext.Provider value={value}>{children}</LinkContext.Provider>
}

/** The card behind linked words, in a note at the bottom right. */
export function LinkedCardNote() {
  const id = useBoard((s) => s.linkCard)
  const card = useBoard((s) => (id ? s.wordLinks?.cards.find((c) => c.id === id) : undefined))
  if (!card) return null
  return (
    <aside className="parchment-note linked-card-note" aria-label={`Card: ${card.name}`} onMouseDown={(e) => e.preventDefault()}>
      <div className="row spread">
        <strong>{card.name}</strong>
        <span className="row tight">
          <button className="ink-button" onClick={() => { useBoard.setState({ linkCard: null }); void useBoard.getState().openSheet(card.id) }}>Open full sheet</button>
          <button aria-label="Close the card" onClick={() => useBoard.setState({ linkCard: null })}>×</button>
        </span>
      </div>
      <span className="ink-muted">{ENTITY_LABELS[card.type]}{card.location ? ` · ${card.location}` : ''}</span>
      {card.summary && <p>{card.summary}</p>}
    </aside>
  )
}

/** Read-only text with card names linked (Live): click a name to show its card in the corner note. */
export function LinkedText({ text }: { text: string }) {
  const ctx = useContext(LinkContext)
  const typeColour = useTypeColour()
  if (!ctx || !text) return <>{text}</>
  const out: ReactNode[] = []
  let k = 0
  for (const h of findLinks(text, ctx.links)) {
    const c = ctx.cards.find((x) => x.id === h.link.entityId) as (EntityBrief & { colour?: string }) | undefined
    out.push(text.slice(k, h.from), (
      <button key={h.from} type="button" className="linked-word" style={{ '--lc': c ? c.colour ?? typeColour(c.type) : '#2f5d8a' } as CSSProperties}
        title={`Show ${c?.name ?? 'the card'}`} onClick={(e) => { e.preventDefault(); ctx.show(h.link.entityId) }}>{text.slice(h.from, h.to)}</button>
    ))
    k = h.to
  }
  out.push(text.slice(k))
  return <>{out}</>
}

/** Every place a linked phrase appears in the text (any case), longest phrases first, never overlapping. */
export function findLinks(text: string, links: WordLink[]): Hit[] {
  const low = text.toLowerCase()
  const hits: Hit[] = []
  for (const link of [...links].sort((a, b) => b.text.length - a.text.length)) {
    const t = link.exact ? link.text : link.text.toLowerCase()
    const hay = link.exact ? text : low
    for (let i = hay.indexOf(t); i >= 0 && t; i = hay.indexOf(t, i + t.length)) {
      if (link.auto && (/[\p{L}\p{N}]/u.test(text[i - 1] ?? '') || /[\p{L}\p{N}]/u.test(text[i + t.length] ?? ''))) continue
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
  /** Starts at least this tall (px), e.g. to line up with a box beside it. */
  minHeight?: number
}) {
  const ctx = useContext(LinkContext)
  const [draft, setDraft] = useState(props.value)
  useEffect(() => setDraft(props.value), [props.value])
  const area = useRef<HTMLTextAreaElement>(null)
  const back = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [picking, setPicking] = useState<string | null>(null)
  const hits = ctx ? findLinks(draft, ctx.links) : []
  // Date words (3.9, card sheets only, not in history/background boxes): dotted until the DM adds them, solid once added.
  const dateCtx = useContext(DateWordContext)
  const calendar = useBoard((s) => (dateCtx ? s.calendar : null))
  const nowMin = useBoard((s) => s.info?.clockMin ?? 0)
  const [dateWord, setDateWord] = useState<{ phrase: string; day: number; sentence: string } | null>(null)
  const [eventDraft, setEventDraft] = useState<EventDraft | null>(null)
  const dateWords: Array<DateWord & { eventId?: string }> = useMemo(() => {
    if (!dateCtx || !calendar || /history|background|backstory|past|recap/i.test(props.label)) return []
    const off = calendar.dateWordsOff[dateCtx.entityId] ?? []
    const mine = calendar.events.filter((e) => e.links.some((l) => l.kind === 'card' && l.id === dateCtx.entityId) && e.source)
    return findDateWords(calendar.def, draft, nowMin).filter((w) => !off.includes(w.phrase.trim().toLowerCase()))
      .map((w) => ({ ...w, eventId: mine.find((e) => e.source!.includes(`“${w.phrase}”`))?.id }))
  }, [dateCtx, calendar, draft, nowMin, props.label])
  const dates = dateWords.filter((w) => !hits.some((h) => w.from < h.to && w.to > h.from))
  const sentenceOf = (w: { from: number; to: number }) => {
    const start = Math.max(draft.lastIndexOf('.', w.from - 1), draft.lastIndexOf('\n', w.from - 1)) + 1
    const ends = ['.', '!', '?', '\n'].map((c) => draft.indexOf(c, w.to)).filter((i) => i >= 0)
    return draft.slice(start, ends.length ? Math.min(...ends) + 1 : draft.length)
  }
  const openDate = (w: DateWord & { eventId?: string }) => {
    const e = w.eventId ? calendar?.events.find((x) => x.id === w.eventId) : undefined
    if (e) setEventDraft({ event: e })
    else setDateWord({ phrase: w.phrase, day: w.day, sentence: sentenceOf(w) })
  }
  const dateUnder = (x: number, y: number) => {
    const marks = back.current?.querySelectorAll<HTMLElement>('mark.date-word') ?? []
    for (const m of marks) {
      if ([...m.getClientRects()].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return dates.find((w) => w.from === Number(m.dataset.from))
    }
    return undefined
  }
  // Linked words take their card's colour (its own, else its type's).
  const typeColour = useTypeColour()
  const colourOf = (id: string) => {
    const c = ctx?.cards.find((x) => x.id === id) as (EntityBrief & { colour?: string }) | undefined
    return c ? c.colour ?? typeColour(c.type) : '#2f5d8a'
  }
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

  // The copy behind must wrap like the box: when the box shows a scrollbar its text is narrower by the bar's width.
  useLayoutEffect(() => {
    const a = area.current, b = back.current
    if (!a || !b) return
    const fit = () => {
      const cs = getComputedStyle(a)
      const bar = a.offsetWidth - a.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth)
      b.style.paddingRight = `${parseFloat(cs.paddingRight) + Math.max(0, bar)}px`
      b.scrollTop = a.scrollTop
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(a)
    return () => ro.disconnect()
  })

  const at = () => {
    const a = area.current
    return a ? hits.find((h) => a.selectionStart >= h.from && a.selectionEnd <= h.to) : undefined
  }
  /** The linked words under the mouse (right-click does not move the cursor). */
  const under = (x: number, y: number) => {
    const marks = back.current?.querySelectorAll('mark') ?? []
    for (const m of marks) {
      if ([...m.getClientRects()].some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) return hits.find((h) => h.from === Number(m.dataset.from))
    }
    return undefined
  }
  const check = () => ctx?.show(at()?.link.entityId ?? null)
  const commit = () => { const next = draft.trim(); if (next !== props.value) props.onCommit(next) }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); area.current?.blur() }
    if (e.key === 'Escape') { setDraft(props.value); area.current?.blur() }
  }
  const onMenu = (e: MouseEvent) => {
    const a = area.current
    if (!ctx || !a) return
    const words = draft.slice(a.selectionStart, a.selectionEnd).trim()
    const hit = under(e.clientX, e.clientY) ?? at()
    const dw = !words && !hit ? dateUnder(e.clientX, e.clientY) : undefined
    if (dw) { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [{ label: dw.eventId ? 'Open the event' : `Add “${dw.phrase}” to the calendar…`, onClick: () => openDate(dw) }] }); return }
    if (!words && !hit) return // the usual menu (spelling)
    e.preventDefault()
    const items: MenuItem[] = []
    if (words) items.push({ label: `Link “${words.length > 30 ? `${words.slice(0, 30)}…` : words}” to a card…`, onClick: () => setPicking(words) })
    if (words && dateCtx && calendar) {
      const from = a.selectionStart, to = a.selectionEnd
      const found = findDateWords(calendar.def, words, nowMin)[0]
      items.push({ label: `Add “${words.length > 30 ? `${words.slice(0, 30)}…` : words}” to the calendar…`, onClick: () => setDateWord({ phrase: words, day: found?.day ?? dayOfMinutes(nowMin) + 1, sentence: sentenceOf({ from, to }) }) })
    }
    const card = hit && ctx.cards.find((c) => c.id === hit.link.entityId)
    if (hit && card && hit.link.auto && draft.slice(hit.from, hit.to) !== card.name) {
      items.push({ label: `Write it as “${card.name}”`, onClick: () => {
        const next = draft.slice(0, hit.from) + card.name + draft.slice(hit.to)
        setDraft(next)
        if (next.trim() !== props.value) props.onCommit(next.trim())
      } })
    }
    if (hit) {
      items.push({ label: `Show ${ctx.cards.find((c) => c.id === hit.link.entityId)?.name ?? 'the card'}`, onClick: () => ctx.show(hit.link.entityId) })
      items.push({ label: hit.link.auto ? `Stop linking “${hit.link.text}” by itself (unticks it on the card)` : `Remove the link on “${hit.link.text}” (the words stay)`, danger: true, onClick: () => ctx.setLinks(ctx.links.filter((l) => l !== hit.link)) })
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // The marks are drawn on a copy of the text behind the (see-through) box, scrolled with it.
  const marked: ReactNode[] = []
  let k = 0
  const spans = [...hits.map((h) => ({ from: h.from, to: h.to, h })), ...dates.map((w) => ({ from: w.from, to: w.to, w }))].sort((a, b) => a.from - b.from)
  for (const s of spans) {
    marked.push(draft.slice(k, s.from), 'h' in s
      ? <mark key={s.from} data-from={s.from} style={{ '--lc': colourOf(s.h.link.entityId) } as CSSProperties}>{draft.slice(s.from, s.to)}</mark>
      : <mark key={s.from} data-from={s.from} className={`date-word${s.w.eventId ? ' added' : ''}`}>{draft.slice(s.from, s.to)}</mark>)
    k = s.to
  }
  marked.push(draft.slice(k), '\n')
  return (
    <div className={`field link-field${props.multiline ? '' : ' is-line'}${props.className ? ` ${props.className}` : ''}`}>
      <label htmlFor={props.id}>{props.label}</label>
      <div className="lf-wrap">
        <div ref={back} className="lf-back" aria-hidden="true">{marked}</div>
        <textarea ref={area} id={props.id} value={draft} rows={props.multiline ? props.rows ?? 5 : 1} placeholder={props.placeholder}
          className={props.multiline ? 'grow' : 'grow line'} style={{ '--rows': props.multiline ? props.rows ?? 5 : 1, ...(props.minHeight ? { minHeight: props.minHeight } : {}) } as CSSProperties}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit} onKeyDown={onKey} onSelect={check} onContextMenu={onMenu}
          onClick={(e) => { const a = area.current; if (a && a.selectionStart === a.selectionEnd) { const w = dateUnder(e.clientX, e.clientY); if (w) openDate(w) } }}
          title={dates.length ? 'Blue dotted words are dates: click one to add it to the calendar' : undefined}
          onScroll={(e) => { if (back.current) { back.current.scrollTop = e.currentTarget.scrollTop; back.current.scrollLeft = e.currentTarget.scrollLeft } }} />
      </div>
      {props.hint && <span className="hint">{props.hint}</span>}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {dateCtx && <DateWordDialog word={dateWord ? { ...dateWord, entityId: dateCtx.entityId, entityName: dateCtx.entityName, field: props.label } : null} onClose={() => setDateWord(null)} />}
      {dateCtx && <EventDialog draft={eventDraft} onClose={() => setEventDraft(null)} />}
      {ctx && picking !== null && (
        <CardPicker words={picking} cards={ctx.cards} onClose={() => setPicking(null)}
          onPick={(entityId, made) => {
            setPicking(null)
            ctx.setLinks([...ctx.links.filter((l) => l.text.toLowerCase() !== picking.toLowerCase()), { text: picking, entityId }])
            if (made) void useBoard.getState().openSheet(entityId)
            else ctx.show(entityId)
          }} />
      )}
    </div>
  )
}

/** Every card, by type, with a search box. */
export function CardPicker({ words, cards, onPick, onClose, title }: { words: string; cards: EntityBrief[]; onPick(id: string, made?: boolean): void; onClose(): void; title?: string }) {
  const [q, setQ] = useState('')
  // Or a new card named from the words: the link is made and its sheet opens.
  const [type, setType] = useState<EntityType>('NPC')
  const [name, setName] = useState(words.slice(0, 200))
  const make = async () => {
    const { act, info } = useBoard.getState()
    if (!info || !name.trim()) return
    const card = await act('entity:create', { boardId: info.globalBoardId, type, name: name.trim() })
    if (card) onPick(card.id, true)
  }
  const t = q.trim().toLowerCase()
  const shown = cards.filter((c) => !t || c.name.toLowerCase().includes(t))
  return (
    <Dialog title={title ?? `Link “${words}” to a card`} open onClose={onClose}>
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
        <form className="card-picker-new" onSubmit={(e) => { e.preventDefault(); void make() }}>
          <span className="field-label">Or make a new card</span>
          <div className="row tight">
            <select value={type} aria-label="Card type" onChange={(e) => setType(e.target.value as EntityType)}>
              {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABELS[t]}</option>)}
            </select>
            <input value={name} maxLength={200} aria-label="New card name" onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="primary" disabled={!name.trim()}>Make card and link</button>
          </div>
        </form>
        <div className="actions"><button onClick={onClose}>Cancel</button></div>
      </div>
    </Dialog>
  )
}

/** Card sheet and board side panel: "Link this name by itself" (3.0, owner; starts ticked for NPC, PC, Location, Faction). */
export function LinkNameTick({ entity, id }: { entity: { id: string; type: EntityType; attributes: Record<string, unknown> }; id: string }) {
  const act = useBoard((s) => s.act)
  const linkName = typeof entity.attributes.link_name === 'boolean' ? entity.attributes.link_name : undefined
  return (
    <div className="field checkbox">
      <input id={id} type="checkbox" checked={linksByItself({ type: entity.type, linkName })}
        onChange={(e) => void act('entity:update', { id: entity.id, patch: { attributes: { link_name: e.target.checked } } })} />
      <label htmlFor={id}>Link this name by itself in notes and text boxes</label>
    </div>
  )
}
