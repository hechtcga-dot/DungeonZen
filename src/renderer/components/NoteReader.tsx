import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import '@fontsource/alegreya/400.css'
import '@fontsource/alegreya/400-italic.css'
import '@fontsource/alegreya/700.css'
import '@fontsource/alegreya-sc/500.css'
import '@fontsource/alegreya-sc/700.css'
import '@fontsource/alegreya-sans/400.css'
import '@fontsource/alegreya-sans/500.css'
import '@fontsource/alegreya-sans/700.css'
import '@fontsource/alegreya-sans-sc/800.css'
import '@fontsource/cinzel/700.css'
import '../notes.css'
import { call } from '../api'
import { useBoard } from '../store'
import { ENTITY_LABELS, useTypeColour } from '../entityStyle'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Dialog } from './Dialog'
import { StatBlockView } from './FightSummary'
import { CharSheetDialog } from './CharSheetDialog'
import { blocksToHtml, htmlToBlocks, picHtml, statHtml } from './NoteEditor'
import { readStatBlock } from '../../shared/statblock'
import { guessHeadings, headingsOf, type Block, type HeadingLevel, type Run } from '../../shared/noteDoc'
import { autoBanner, autoPictures, blockRuns, findAll, makeMatcher, paragraphLinks, setLinkRange, unknownNames, type Hit, type LinkCard, type Matcher } from '../../shared/noteLinks'
import { COMMON_SPELL_WORDS, RULES_TERMS } from '../../shared/rulesTerms'
import type { SrdAttacks, SrdSpell } from '../../shared/attacks'
import type { ImportDraft } from '../../shared/notesImport'
import type { NoteDocView, NoteMeta, SheetView, WordLinksView } from '../../shared/types'
import type { EntityType } from '../../shared/schemas'

type Card = WordLinksView['cards'][number]
type Pic = Extract<Block, { kind: 'pic' }>
type Stat = Extract<Block, { kind: 'stat' }>
/** Where a link sits: block, table cell (0 outside tables), characters. */
type At = { block: number; cell: number; from: number; to: number }

const asset = (path: string, w = 512) => `dz-asset://campaign/${path}?w=${w}`
type TextBlock = Extract<Block, { runs: Run[] }>
const isHeading = (b: Block): b is TextBlock & { kind: 'h1' | 'h2' | 'h3' } => b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3'
const WIDE = new Set<EntityType>(['LOCATION', 'BUILDING'])

let spellsP: Promise<SrdAttacks> | null = null
/** SRD spells (shipped with the app), for links and hover notes. */
function useSpells(): Map<string, SrdSpell> {
  const [map, setMap] = useState<Map<string, SrdSpell>>(new Map())
  useEffect(() => {
    spellsP ??= call('srd:attacks', undefined)
    void spellsP.then((d) => setMap(new Map(d.spells.map((s) => [s.name.toLowerCase(), s])))).catch(() => { spellsP = null })
  }, [])
  return map
}

/** The book's link rules for this campaign: cards, the DM's own linked words, conditions, senses and spells. */
export function useNoteMatcher(): { m: Matcher; cards: Card[]; spells: Map<string, SrdSpell> } {
  const w = useBoard((s) => s.wordLinks)
  const spells = useSpells()
  const cards = useMemo(() => w?.cards ?? [], [w])
  const m = useMemo(() => {
    const terms = [...Object.keys(RULES_TERMS), ...[...spells.values()].map((s) => s.name).filter((n) => n.length > 3 && !COMMON_SPELL_WORDS.has(n))]
    return makeMatcher(cards as LinkCard[], w?.own ?? [], w?.off ?? [], terms)
  }, [cards, w, spells])
  return { m, cards, spells }
}

/** A picture in the book: a card's (its name below) or the DM's own file; ⇄ other side, × take it out. */
function Figure({ src, caption, side, wide, onSide, onRemove, onOpen, onMenu }: {
  src: string; caption?: string; side: 'left' | 'right'; wide?: boolean; onSide(): void; onRemove(): void; onOpen?(): void; onMenu(e: ReactMouseEvent): void
}) {
  return (
    <figure className={`nb-pic${side === 'left' ? ' is-left' : ''}${wide ? ' is-wide' : ''}`} onContextMenu={onMenu}>
      <img src={src} alt={caption ?? ''} onClick={onOpen} draggable={false} />
      {caption && <figcaption>{caption}</figcaption>}
      <div className="ctl">
        <button title="Move to the other side" aria-label="Move to the other side" onClick={onSide}>⇄</button>
        <button title="Take this picture out (Ctrl+Z brings it back)" aria-label="Take this picture out" onClick={onRemove}>×</button>
      </div>
    </figure>
  )
}

/** A note or folder's icon: the linked card's kind in its colour (person, place, thing), else a page. */
export function CardIcon({ card }: { card?: { type: EntityType; colour?: string; name: string } }) {
  const typeColour = useTypeColour()
  if (!card) return <svg className="nb-ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="1.5" width="10" height="13" rx="1" fill="none" stroke="var(--nb-head)" strokeWidth="1.4" /><path d="M5.5 5h5M5.5 8h5M5.5 11h3" stroke="var(--nb-head)" strokeWidth="1.2" /></svg>
  const c = card.colour ?? typeColour(card.type)
  const shape = ['NPC', 'PC', 'MONSTER'].includes(card.type)
    ? <><circle cx="8" cy="5.5" r="3" fill={c} /><path d="M2.5 15 Q3 9.5 8 9.5 Q13 9.5 13.5 15Z" fill={c} />{card.type === 'PC' && <path d="M5 2.2 L8 0.6 L11 2.2" stroke="#c9a34a" strokeWidth="1.5" fill="none" />}</>
    : card.type === 'LOCATION' ? <><path d="M8 15 Q2 8 2 6 A6 6 0 0 1 14 6 Q14 8 8 15Z" fill={c} /><circle cx="8" cy="6" r="2.2" fill="var(--nb-panel)" /></>
    : card.type === 'BUILDING' ? <path d="M2 7 L8 2 L14 7 V14.5 H2Z" fill={c} />
    : <path d="M8 1.5 L14.5 8 L8 14.5 L1.5 8Z" fill={c} />
  return <svg className="nb-ico" viewBox="0 0 16 16" role="img" aria-label={`Linked to ${card.name}`}><title>{`Linked to ${card.name}`}</title>{shape}</svg>
}

/**
 * A card's stat block in the note (owner, 2.8.0; starts full width): always the card's current one, with its picture.
 * Hover: ⇄ other side, ▭ full width / beside the text, − fold, × take out. The name opens the sheet.
 */
function InlineStat({ b, card, onChange, onRemove }: { b: Stat; card: Card | undefined; onChange(b: Stat): void; onRemove(): void }) {
  const { query, openSheet } = useBoard()
  const stamp = useBoard((s) => s.view?.undo)
  const [sheet, setSheet] = useState<SheetView | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => { if (card) void query('sheet:view', { entityId: card.id }).then((s) => setSheet(s ?? null)) }, [card?.id, stamp]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!card) return <div className="nb-stat"><p className="nb-muted">That card is gone (History brings it back). <button className="link-button" onClick={onRemove}>Take this out</button></p></div>
  const sb = sheet ? readStatBlock(sheet.entity.attributes.statblock) : null
  const tools = (
    <div className="ctl">
      {b.layout === 'beside' && <button title="Move to the other side" aria-label="Move to the other side" onClick={() => onChange({ ...b, side: b.side === 'left' ? 'right' : 'left' })}>⇄</button>}
      {b.layout !== 'fold' && <button title={b.layout === 'full' ? 'Beside the text' : 'Full width'} aria-label={b.layout === 'full' ? 'Beside the text' : 'Full width'} onClick={() => onChange({ ...b, layout: b.layout === 'full' ? 'beside' : 'full' })}>▭</button>}
      <button title={b.layout === 'fold' ? 'Open out (stays open)' : 'Fold to one line'} aria-label={b.layout === 'fold' ? 'Open out' : 'Fold'} onClick={() => onChange({ ...b, layout: b.layout === 'fold' ? 'full' : 'fold' })}>{b.layout === 'fold' ? '+' : '−'}</button>
      <button title="Take it out (Ctrl+Z brings it back)" aria-label="Take the stat block out" onClick={onRemove}>×</button>
    </div>
  )
  const whole = (
    <div onClick={(e) => { if ((e.target as HTMLElement).closest('.sb-name')) void openSheet(card.id) }}>
      {card.picture && b.layout !== 'fold' && <img className="nb-stat-pic" src={asset(card.picture, 256)} alt="" />}
      {sb && sheet ? <StatBlockView name={card.name} sb={sb} actions={sheet.abilities} />
        : <div className="statblock"><h2 className="sb-name">{card.name}</h2><p className="nb-muted">{sheet ? 'No stat block on this card yet. Click the name to open its sheet.' : 'Loading…'}</p></div>}
    </div>
  )
  if (b.layout === 'fold') {
    return (
      <div className="nb-stat is-fold">
        <button className="nb-statline" aria-expanded={open} onClick={() => setOpen(!open)}>
          {card.picture && <img src={asset(card.picture, 96)} alt="" />}<b>{card.name}</b>
          {sb && <span className="nums">AC {sb.ac || '?'} · HP {sb.hp || '?'} · CR {sb.cr || '?'}</span>}<span className="chev">{open ? '▾' : '▸'}</span>
        </button>
        {open && whole}
        {tools}
      </div>
    )
  }
  return <div className={`nb-stat${b.layout === 'beside' ? ` is-beside${b.side === 'left' ? ' is-left' : ''}` : ''}`}>{whole}{tools}</div>
}

/** Choose a card (cards with a picture only, or every card and note), or make a new card. */
export function CardPicker({ title, cards, notes = [], onPick, onMake, onClose, at }: {
  title: string; cards: Card[]; notes?: NoteDocView[]; onPick(target: string, name: string): void; onMake?(name: string): void; onClose(): void; at?: { x: number; y: number }
}) {
  const [q, setQ] = useState('')
  const [k, setK] = useState(0)
  const low = q.trim().toLowerCase()
  const list = [
    ...cards.filter((c) => !low || c.name.toLowerCase().includes(low)).map((c) => ({ id: c.id, name: c.name, sub: c.encounter ? 'Encounter' : ENTITY_LABELS[c.type] })),
    ...notes.filter((d) => !low || d.title.toLowerCase().includes(low)).map((d) => ({ id: `note:${d.id}`, name: d.title, sub: 'Note' }))
  ].slice(0, 60)
  const make = onMake && q.trim() && !cards.some((c) => c.name.toLowerCase() === low)
  const choose = (i: number) => { const x = list[i]; if (x) onPick(x.id, x.name); else if (make) onMake(q.trim()) }
  const body = (
    <div className="nb-linkpick" role="dialog" aria-label={title} style={at ? { left: Math.min(at.x, window.innerWidth - 310), top: Math.min(at.y, window.innerHeight - 330) } : { position: 'static', width: '100%', boxShadow: 'none' }}
      onMouseDown={(e) => e.stopPropagation()}>
      <input autoFocus value={q} placeholder="Type a name" aria-label="Find a card" onChange={(e) => { setQ(e.target.value); setK(0) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
          if (e.key === 'ArrowDown') { e.preventDefault(); setK(Math.min(k + 1, list.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setK(Math.max(k - 1, 0)) }
          if (e.key === 'Enter') { e.preventDefault(); choose(list.length ? k : -1) }
        }} />
      {list.map((x, i) => (
        <button key={x.id} aria-selected={i === k} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
          <span>{x.name}</span><span className="nb-muted" style={{ marginLeft: 'auto' }}>{x.sub}</span>
        </button>
      ))}
      {make && <button onMouseDown={(e) => e.preventDefault()} onClick={() => onMake(q.trim())}>Make a new card: <b>{q.trim()}</b></button>}
      {!list.length && !make && <p className="nb-muted">No cards{q ? ' by that name' : ' with a picture'}.</p>}
    </div>
  )
  if (at) return <><div style={{ position: 'fixed', inset: 0, zIndex: 89 }} onMouseDown={onClose} />{body}</>
  return <Dialog title={title} open onClose={onClose}>{body}<div className="dz-actions"><button onClick={onClose}>Cancel</button></div></Dialog>
}

/** "Notes changed: update cards?" The AI reads only the changed parts and proposes card changes (nothing changes until approved). */
export function UpdateCards({ id, lines, onClose, onOpen }: { id: string; lines: string[]; onClose(): void; onOpen(d: ImportDraft): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')
  useEffect(() => window.dungeonzen.onImportProgress((p) => setProgress(p.message)), [])
  return (
    <Dialog title="Notes changed: update cards?" open onClose={onClose}>
      <p>{lines.length} part{lines.length === 1 ? '' : 's'} of this note changed or are new. The writing AI can read just those and propose changes to your cards: new cards, and details for the ones you have.</p>
      <ul className="notes-changed">{lines.slice(0, 6).map((l, i) => <li key={i}>{l.length > 160 ? `${l.slice(0, 160)}…` : l}</li>)}{lines.length > 6 && <li className="ink-muted">and {lines.length - 6} more</li>}</ul>
      <p className="hint">You review every proposal side by side with the card it would change; nothing changes until you approve, and Ctrl+Z undoes it.</p>
      {busy && <p role="status">{progress || 'Reading…'}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dz-actions">
        <button onClick={onClose}>Not now</button>
        <button className="primary" disabled={busy} onClick={async () => {
          setBusy(true); setError('')
          try { const d = await call('notedoc:updateCards', { id, lines }); onClose(); onOpen(d) } catch (e) { setError((e as Error).message) }
          setBusy(false)
        }}>{busy ? 'Reading…' : 'Yes, propose card changes'}</button>
      </div>
    </Dialog>
  )
}

type RTab = 'contents' | 'peek' | 'links' | 'mentions' | 'from'

/**
 * A notes file as a book page (owner, 2.8.0): banner, headings, read-aloud boxes and sidebars; card names, spells
 * and conditions linked at their first mention in each paragraph (hover for a note, click for the side panel,
 * Ctrl+click for the sheet); a card's picture at its first mention. ✎ Edit types into the same page.
 * Renders the middle and right columns of the Notes screen (`.nb` grid).
 */
export function NoteReader({ doc, docs, jump, onOpenDoc, onChanged, onOpenDraft, prev, next, folder, standalone }: {
  doc: NoteDocView; docs: NoteDocView[]; jump: { n: number; nonce: number } | null
  onOpenDoc(id: string, heading?: number): void; onChanged(): void; onOpenDraft?(d: ImportDraft): void
  prev?: NoteDocView; next?: NoteDocView; folder: string; standalone?: boolean
}) {
  const { act, say, openSheet } = useBoard()
  const info = useBoard((s) => s.info)
  const typeColour = useTypeColour()
  const { m, cards, spells } = useNoteMatcher()
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards])
  const [blocks, setBlocks] = useState<Block[] | null>(null)
  const [pictureUrl, setPictureUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [rtab, setRtab] = useState<RTab>('contents')
  const [peek, setPeek] = useState<string | null>(null)
  const [tip, setTip] = useState<{ target: string; x: number; top: number; bottom: number } | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [picker, setPicker] = useState<{ title: string; withPictures: boolean; notes?: boolean; stats?: boolean; at?: { x: number; y: number }; onPick(target: string, name: string): void; onMake?(name: string): void } | null>(null)
  const [changed, setChanged] = useState<string[] | null>(null)
  const [making, setMaking] = useState(false)
  const [finding, setFinding] = useState<Array<{ key: number; text: string; level: HeadingLevel }> | null>(null)
  const page = useRef<HTMLDivElement>(null)
  const ed = useRef<HTMLDivElement>(null)
  const dirty = useRef(false)
  const meta = doc.meta

  useEffect(() => {
    void call('notedoc:content', { id: doc.id }).then((c) => { setBlocks(c.blocks); setPictureUrl(c.url) }).catch((e) => setError((e as Error).message))
  }, [doc.id, doc.updatedAt])
  useEffect(() => { setEditing(false); setPeek(null) }, [doc.id])
  const heads = useMemo(() => headingsOf(blocks ?? []), [blocks])
  const jumpTo = useCallback((n: number) => page.current?.querySelector(`[data-head="${n}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), [])
  useEffect(() => { if (blocks && jump) requestAnimationFrame(() => jumpTo(jump.n)) }, [blocks, jump, jumpTo])

  const setMeta = (patch: Partial<NoteMeta>) => act('notedoc:setMeta', { id: doc.id, meta: { ...meta, ...patch } })
  const save = async (next: Block[], quiet = false) => {
    const r = await act('notedoc:save', { id: doc.id, blocks: next })
    if (!r) return
    setBlocks(next)
    onChanged()
    if (r.changed.length && onOpenDraft) setChanged(r.changed)
    else if (!quiet) say('Saved.')
  }

  // ---- links and terms
  const showPeek = (target: string) => { setPeek(target); setRtab('peek'); setTip(null) }
  const openTarget = (target: string, e?: { ctrlKey: boolean; metaKey: boolean }) => {
    if (target.startsWith('note:')) { onOpenDoc(target.slice(5)); return }
    if ((e?.ctrlKey || e?.metaKey) && byId.has(target)) { void openSheet(target); return }
    showPeek(target)
  }
  // Encounters are Scene cards (grey): their links get an amber of their own.
  const linkStyle = (c: Card | undefined): CSSProperties => ({ '--lc': c ? c.colour ?? (c.encounter ? '#9a6a10' : typeColour(c.type)) : 'var(--nb-head)' } as CSSProperties)

  /** A paragraph with its links. */
  const renderRuns = (runs: Run[], at: { block: number; cell: number }, links = true): ReactNode => {
    const hits: Hit[] = links ? paragraphLinks(runs, m) : []
    const out: ReactNode[] = []
    let pos = 0
    runs.forEach((r, ri) => {
      // Cut this run at link edges.
      const cuts = new Set([0, r.text.length])
      for (const h of hits) { if (h.from > pos && h.from < pos + r.text.length) cuts.add(h.from - pos); if (h.to > pos && h.to < pos + r.text.length) cuts.add(h.to - pos) }
      const edges = [...cuts].sort((a, b) => a - b)
      for (let k = 0; k < edges.length - 1; k++) {
        const text = r.text.slice(edges[k], edges[k + 1])
        const p0 = pos + edges[k]
        let node: ReactNode = text.split('\n').map((t, i) => <Fragment key={i}>{i > 0 && <br />}{t}</Fragment>)
        if (r.u) node = <u>{node}</u>
        if (r.i) node = <i>{node}</i>
        if (r.b) node = <b>{node}</b>
        const h = hits.find((x) => p0 >= x.from && p0 < x.to)
        const key = `${ri}-${k}`
        if (h) {
          const data = { 'data-target': h.target, 'data-at': `${at.block}:${at.cell}:${h.from}:${h.to}` }
          if (h.target.startsWith('term:')) {
            const name = h.target.slice(5)
            const kind = RULES_TERMS[name]?.kind
            node = <span key={key} className={`nb-t ${kind === 'Condition' ? 'cond' : kind ? 'rule' : 'spell'}`} {...data}>{node}</span>
          } else node = <span key={key} className="nb-k" style={linkStyle(byId.get(h.target))} role="link" tabIndex={-1} {...data}>{node}</span>
        } else node = <Fragment key={key}>{node}</Fragment>
        out.push(node)
      }
      pos += r.text.length
    })
    return out
  }

  // ---- pictures

  const cardPicture = (id: string) => { const c = byId.get(id); return c?.picture ? asset(c.picture) : '' }
  const picSrc = (b: Pic) => (b.card ? cardPicture(b.card) : b.file ? asset(b.file, 1024) : '')
  const removeAuto = (id: string) => { void setMeta({ hide: [...new Set([...(meta.hide ?? []), id])] }); say('Picture taken out. Ctrl+Z brings it back.') }
  const flipAuto = (id: string) => { const left = new Set(meta.left ?? []); if (left.has(id)) left.delete(id); else left.add(id); void setMeta({ left: [...left] }) }
  const insertPic = (at: number, pic: Pic | Stat) => {
    if (!blocks) return
    if (pic.card && meta.hide?.includes(pic.card)) void setMeta({ hide: meta.hide.filter((x) => x !== pic.card) })
    void save([...blocks.slice(0, at), pic, ...blocks.slice(at)], true)
  }
  const pickOwnPicture = async (): Promise<string | null> => (await act('notedoc:pickPicture', undefined)) ?? null
  const cardsWithPictures = useMemo(() => cards.filter((c) => c.picture), [cards])
  const pictureMenu = (at: number, extra: MenuItem[] = []): MenuItem[] => [
    ...extra,
    { label: 'Insert a card’s picture here…', onClick: () => setPicker({ title: 'Insert a card’s picture', withPictures: true, onPick: (id) => { setPicker(null); insertPic(at, { kind: 'pic', card: id, side: 'right' }) } }) },
    { label: 'Insert your own picture here…', onClick: () => void pickOwnPicture().then((file) => { if (file) insertPic(at, { kind: 'pic', file, side: 'right' }) }) },
    { label: 'Insert a stat block here…', onClick: () => setPicker({ title: 'Insert a stat block', withPictures: false, stats: true, onPick: (id) => { setPicker(null); insertPic(at + 1, { kind: 'stat', card: id, layout: 'full', side: 'right' }) } }) }
  ]

  // ---- banner: the DM's choice, else the first place mentioned
  const bannerCard = meta.banner?.card ?? (meta.banner?.file || meta.banner?.none ? null : blocks ? autoBanner(blocks, m, cards as LinkCard[]) : null)
  // The banner's card does not get a picture in the text too.
  const pics = useMemo(() => (blocks ? autoPictures(blocks, m, cards as LinkCard[], [...(meta.hide ?? []), ...(bannerCard ? [bannerCard] : [])]) : new Map<number, string>()), [blocks, m, cards, meta.hide, bannerCard])
  const bannerSrc = meta.banner?.none ? '' : meta.banner?.file ? asset(meta.banner.file, 1600) : bannerCard && byId.get(bannerCard)?.picture ? asset(byId.get(bannerCard)!.picture, 1600) : ''
  const bannerMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    setMenu({
      x: e.clientX, y: e.clientY, items: [
        { label: 'Use a place’s picture…', onClick: () => setPicker({ title: 'Banner: a place’s picture', withPictures: true, notes: false, onPick: (id) => { setPicker(null); void setMeta({ banner: { card: id } }) } }) },
        { label: 'Use another card’s picture…', onClick: () => setPicker({ title: 'Banner: a card’s picture', withPictures: true, onPick: (id) => { setPicker(null); void setMeta({ banner: { card: id } }) } }) },
        { label: 'Insert your own picture…', onClick: () => void pickOwnPicture().then((file) => { if (file) void setMeta({ banner: { file } }) }) },
        'separator',
        { label: 'Back to the first place in the note', disabled: !meta.banner, onClick: () => void setMeta({ banner: undefined }) },
        { label: 'Remove the banner', danger: true, disabled: !!meta.banner?.none, onClick: () => void setMeta({ banner: { none: true } }) }
      ]
    })
  }

  // ---- right-click in the page
  const blockOf = (el: HTMLElement | null) => Number(el?.closest<HTMLElement>('[data-block]')?.dataset.block ?? -1)
  const changeRuns = (at: At, fn: (runs: Run[]) => Run[]) => {
    if (!blocks) return
    const next = blocks.map((b, i) => {
      if (i !== at.block) return b
      if (b.kind === 'table') { let n = 0; return { ...b, rows: b.rows.map((row) => row.map((cell) => (n++ === at.cell ? fn(cell) : cell))) } }
      return 'runs' in b ? { ...b, runs: fn(b.runs) } : b
    })
    void save(next, true)
  }
  const setKind = (i: number, kind: 'p' | 'read' | 'side') => {
    if (!blocks) return
    void save(blocks.map((b, k) => (k === i && 'runs' in b && !isHeading(b) ? { ...b, kind } : b)), true)
  }
  const pageMenu = (e: ReactMouseEvent) => {
    if (editing) return
    const el = e.target as HTMLElement
    const linkEl = el.closest<HTMLElement>('[data-target]')
    const i = blockOf(el)
    if (i < 0 || !blocks) return
    e.preventDefault()
    const b = blocks[i]
    if (linkEl) {
      const target = linkEl.dataset.target!
      const [block, cell, from, to] = linkEl.dataset.at!.split(':').map(Number)
      const at: At = { block, cell, from, to }
      const c = byId.get(target)
      const isTerm = target.startsWith('term:')
      const words = (linkEl.closest('[data-block]')?.textContent ?? '').slice(from, to) || c?.name || target.slice(5)
      setMenu({
        x: e.clientX, y: e.clientY, items: [
          ...(c ? [{ label: 'Open the sheet', onClick: () => void openSheet(target) }, { label: 'Show in the side panel', onClick: () => showPeek(target) },
            { label: 'Show its picture here', disabled: !c.picture, onClick: () => insertPic(i, { kind: 'pic', card: target, side: 'right' }) }] : [{ label: 'Show in the side panel', onClick: () => showPeek(target) }]),
          ...pictureMenu(i).slice(1),
          'separator',
          { label: `Stop linking “${words}” here`, onClick: () => changeRuns(at, (runs) => setLinkRange(runs, from, to, '')) },
          { label: `Stop linking “${words}” everywhere`, hint: 'Every note and text box; Ctrl+Z undoes', onClick: () => { const w = useBoard.getState().wordLinks; void act('links:set', { own: w?.own ?? [], off: [...new Set([...(w?.off ?? []), words.toLowerCase()])] }) } },
          ...(isTerm ? [] : [{ label: 'Link to another card…', onClick: () => setPicker({ title: `Link “${words}” to`, withPictures: false, notes: true, onPick: (id) => { setPicker(null); changeRuns(at, (runs) => setLinkRange(runs, from, to, id)) } }) }])
        ]
      })
      return
    }
    const box: MenuItem[] = 'runs' in b && !isHeading(b) ? [
      'separator',
      b.kind === 'read' ? { label: 'Make this plain text', onClick: () => setKind(i, 'p') } : { label: 'Make this a read-aloud box', onClick: () => setKind(i, 'read') },
      b.kind === 'side' ? { label: 'Make this plain text', onClick: () => setKind(i, 'p') } : { label: 'Make this a sidebar', onClick: () => setKind(i, 'side') }
    ] : []
    setMenu({ x: e.clientX, y: e.clientY, items: [...pictureMenu(i), ...box] })
  }

  // ---- hover notes
  const hover = (e: ReactMouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-target]')
    if (!el) { if (tip) setTip(null); return }
    if (tip?.target === el.dataset.target) return
    const r = el.getBoundingClientRect()
    setTip({ target: el.dataset.target!, x: r.left, top: r.top, bottom: r.bottom })
  }

  // ---- editing
  useLayoutEffect(() => {
    const el = ed.current
    if (!editing || !el || !blocks) return
    el.innerHTML = blocksToHtml(blocks, picSrc, (id) => byId.get(id)?.name ?? 'a card')
    dirty.current = false
    el.focus()
    return () => {
      // Leaving the note while typing keeps the words.
      if (dirty.current) void act('notedoc:save', { id: doc.id, blocks: htmlToBlocks(el) }).then(onChanged)
      dirty.current = false
    }
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps
  const cmd = (name: string, value?: string) => { ed.current?.focus(); document.execCommand(name, false, value); dirty.current = true }
  const topBlock = () => {
    const sel = window.getSelection()
    let n: Node | null = sel?.anchorNode ?? null
    while (n && n.parentNode !== ed.current) n = n.parentNode
    return n instanceof HTMLElement ? n : null
  }
  const boxToggle = (cls: 'nb-read' | 'nb-side') => {
    const el = topBlock()
    if (!el || ['UL', 'OL', 'TABLE', 'FIGURE'].includes(el.tagName)) return
    const to = document.createElement(el.classList.contains(cls) ? 'p' : 'div')
    if (!el.classList.contains(cls)) to.className = cls
    to.innerHTML = el.innerHTML
    el.replaceWith(to)
    dirty.current = true
  }
  const savedRange = useRef<Range | null>(null)
  const keepRange = () => { const s = window.getSelection(); savedRange.current = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null }
  const backToRange = () => { ed.current?.focus(); const s = window.getSelection(); if (s && savedRange.current) { s.removeAllRanges(); s.addRange(savedRange.current) } }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const caretAt = () => { const s = window.getSelection(); const r = s?.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null; return r && (r.left || r.top) ? { x: r.left, y: r.bottom + 4 } : { x: 300, y: 200 } }
  const makeCard = async (name: string) => {
    if (!info) return null
    const e = await act('entity:create', { boardId: info.globalBoardId, type: 'NPC', name })
    if (e) say(`Made the NPC card ${name}; change its type on the sheet.`)
    return e?.id ?? null
  }
  const linkPicker = (typed: boolean) => {
    keepRange()
    const selected = typed ? '' : window.getSelection()?.toString() ?? ''
    const put = (id: string, name: string) => {
      setPicker(null)
      backToRange()
      if (typed) { const s = window.getSelection(); s?.modify('extend', 'backward', 'character'); s?.modify('extend', 'backward', 'character'); if (s?.toString() === '[[') document.execCommand('delete') }
      document.execCommand('insertHTML', false, `<span class="nb-own" data-link="${esc(id)}">${esc(selected || name)}</span>&nbsp;`)
      dirty.current = true
    }
    setPicker({ title: selected ? `Link “${selected}” to` : 'Link to a card or note', withPictures: false, notes: true, at: caretAt(), onPick: put,
      onMake: (name) => void makeCard(name).then((id) => { if (id) put(id, name) }) })
  }
  const editPicture = (own: boolean) => {
    keepRange()
    const put = (pic: Pic) => { backToRange(); document.execCommand('insertHTML', false, picHtml(pic, picSrc)); dirty.current = true }
    if (own) void pickOwnPicture().then((file) => { if (file) put({ kind: 'pic', file, side: 'right' }) })
    else setPicker({ title: 'Insert a card’s picture', withPictures: true, onPick: (id) => { setPicker(null); put({ kind: 'pic', card: id, side: 'right' }) } })
  }
  const editStat = () => {
    keepRange()
    setPicker({ title: 'Insert a stat block', withPictures: false, stats: true, onPick: (id, name) => {
      setPicker(null); backToRange()
      document.execCommand('insertHTML', false, statHtml({ kind: 'stat', card: id, layout: 'full', side: 'right' }, name)); dirty.current = true
    } })
  }
  const done = async () => {
    if (!ed.current) return
    const next = htmlToBlocks(ed.current)
    dirty.current = false
    setEditing(false)
    await save(next)
  }

  // ---- what to draw
  const docIndex = (blocks ?? []).map((b, i) => [b, i] as const)
  let head = -1
  const body: ReactNode[] = []
  for (let k = 0; k < docIndex.length; k++) {
    const [b, i] = docIndex[k]
    const auto = pics.get(i)
    if (auto) {
      const c = byId.get(auto)!
      body.push(<Figure key={`a${i}`} src={cardPicture(auto)} caption={c.name} wide={WIDE.has(c.type)} side={meta.left?.includes(auto) ? 'left' : 'right'}
        onSide={() => flipAuto(auto)} onRemove={() => removeAuto(auto)} onOpen={() => showPeek(auto)}
        onMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Move to the other side', onClick: () => flipAuto(auto) }, ...pictureMenu(i).map((x) => x), 'separator', { label: 'Take this picture out', danger: true, onClick: () => removeAuto(auto) }] }) }} />)
    }
    if (b.kind === 'stat') {
      body.push(<div key={i} data-block={i} className="nb-stat-wrap"><InlineStat b={b} card={byId.get(b.card)}
        onChange={(nb) => void save(blocks!.map((x, j) => (j === i ? nb : x)), true)}
        onRemove={() => { void save(blocks!.filter((_, j) => j !== i), true); say('Stat block taken out. Ctrl+Z brings it back.') }} /></div>)
      continue
    }
    if (b.kind === 'pic') {
      const c = b.card ? byId.get(b.card) : undefined
      const src = picSrc(b)
      if (src) body.push(<Figure key={i} src={src} caption={c?.name} wide={!!c && WIDE.has(c.type)} side={b.side}
        onSide={() => void save(blocks!.map((x, j) => (j === i ? { ...b, side: b.side === 'left' ? 'right' : 'left' } : x)), true)}
        onRemove={() => { void save(blocks!.filter((_, j) => j !== i), true); say('Picture taken out. Ctrl+Z brings it back.') }}
        onOpen={b.card ? () => showPeek(b.card!) : undefined}
        onMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY, items: [
          { label: 'Use another card’s picture…', onClick: () => setPicker({ title: 'Use another card’s picture', withPictures: true, onPick: (id) => { setPicker(null); void save(blocks!.map((x, j) => (j === i ? { kind: 'pic', card: id, side: b.side } : x)), true) } }) },
          { label: 'Insert your own picture…', onClick: () => void pickOwnPicture().then((file) => { if (file) void save(blocks!.map((x, j) => (j === i ? { kind: 'pic', file, side: b.side } : x)), true) }) },
          'separator', { label: 'Take this picture out', danger: true, onClick: () => void save(blocks!.filter((_, j) => j !== i), true) }] }) }} />)
      continue
    }
    if (isHeading(b)) {
      const has = b.runs.some((r) => r.text.trim())
      if (has) head++
      const H = b.kind
      body.push(<H key={i} data-block={i} data-head={has ? head : undefined}>{renderRuns(b.runs, { block: i, cell: 0 }, false)}</H>)
      continue
    }
    if (b.kind === 'table') {
      let cell = 0
      body.push(<table key={i} data-block={i}><tbody>{b.rows.map((row, r) => <tr key={r}>{row.map((runs, c) => <td key={c}>{renderRuns(runs, { block: i, cell: cell++ })}</td>)}</tr>)}</tbody></table>)
      continue
    }
    if (b.kind === 'bullet' || b.kind === 'number') {
      const items: ReactNode[] = []
      let j = k
      for (; j < docIndex.length && docIndex[j][0].kind === b.kind && !pics.get(docIndex[j][1]); j++) {
        const [li, n] = docIndex[j] as [TextBlock, number]
        items.push(<li key={n} data-block={n}>{renderRuns(li.runs, { block: n, cell: 0 })}</li>)
      }
      if (j === k) { const [li, n] = docIndex[j] as [TextBlock, number]; items.push(<li key={n} data-block={n}>{renderRuns(li.runs, { block: n, cell: 0 })}</li>); j++ }
      body.push(b.kind === 'bullet' ? <ul key={`l${i}`}>{items}</ul> : <ol key={`l${i}`}>{items}</ol>)
      k = j - 1
      continue
    }
    const Tag = b.kind === 'p' ? 'p' : 'div'
    body.push(<Tag key={i} data-block={i} className={b.kind === 'read' ? 'nb-read' : b.kind === 'side' ? 'nb-side' : undefined}>{renderRuns(b.runs, { block: i, cell: 0 })}</Tag>)
  }

  const isText = doc.kind !== 'picture'
  const fileMenu = (e: ReactMouseEvent) => setMenu({
    x: e.currentTarget.getBoundingClientRect().left, y: e.currentTarget.getBoundingClientRect().bottom + 4, items: [
      { label: doc.kind === 'word' ? 'Open in Word' : doc.kind === 'pdf' ? 'Open the PDF' : doc.kind === 'picture' ? 'Open the picture' : 'Open the file',
        onClick: () => void act('notedoc:openInWord', { id: doc.id }).then(() => { if (doc.kind === 'word') say('Opened in Word. Save there; when you come back, Dungeon Zen offers to bring the changes in.') }) },
      { label: 'Open file location', hint: 'Shows the file in Windows Explorer', onClick: () => void act('notedoc:showInFolder', { id: doc.id }) },
      ...(isText ? [{ label: 'Save a copy as Word…', onClick: () => void act('notedoc:saveCopy', { id: doc.id }).then((p) => { if (p) say(`Saved ${p}`) }) }] : []),
      'separator',
      { label: 'Re-import file…', hint: 'A new copy of the file; this one stays under Earlier versions', onClick: () => void act('notedoc:reimport', { id: doc.id }).then((r) => { if (r) { onChanged(); if (r.changed.length && onOpenDraft) setChanged(r.changed); else say('Re-imported. Nothing new for the cards.') } }) },
      ...(isText && onOpenDraft ? [{ label: 'Read again with AI…', hint: 'The AI reads the whole note again and proposes card changes', onClick: () => void act('notedoc:allLines', { id: doc.id }).then((l) => { if (l?.length) setChanged(l) }) }] : []),
      { label: 'Make a character card…', hint: 'The AI copies a character sheet into a character card', onClick: () => setMaking(true) },
      meta.card && byId.get(meta.card) ? { label: `Linked to ${byId.get(meta.card)!.name}`, items: [
        { label: 'Link to another card…', onClick: () => setPicker({ title: 'Link this note to a card', withPictures: false, onPick: (id) => { setPicker(null); void setMeta({ card: id }) } }) },
        { label: 'Unlink from the card', onClick: () => void setMeta({ card: undefined }) }] }
        : { label: 'Link to a card…', hint: 'The card’s sheet lists this note; the notes list shows its icon', onClick: () => setPicker({ title: 'Link this note to a card', withPictures: false, onPick: (id) => { setPicker(null); void setMeta({ card: id }) } }) },
      ...(isText ? [{ label: 'Find headings…', hint: 'Lines that read like headings; you tick which', onClick: () => setFinding(guessHeadings(blocks ?? []).map((g) => ({ key: g.index, text: g.text, level: g.level }))) }] : []),
      ...(doc.versions.length ? [{ label: `Earlier versions (${doc.versions.length})`, items: doc.versions.map((v) => ({ label: `${new Date(v.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · Bring back`, onClick: () => void act('notedoc:restore', { id: doc.id, file: v.file }).then(onChanged) })) }] : []),
      'separator',
      { label: 'Delete (to History)', danger: true, onClick: () => void act('notedoc:setStatus', { id: doc.id, status: 'defunct' }).then(onChanged) }
    ]
  })

  return (
    <>
      <section className="nb-mid" aria-label={doc.title}>
        <div className="nb-crumbs">
          <span>{folder ? `${folder.split('/').join(' › ')} › ` : ''}<b>{doc.title}</b></span>
          {isText && (editing
            ? <><button className="nb-btn is-pri" onClick={() => void done()}>✓ Done</button><button className="nb-tool" onClick={() => { dirty.current = false; setEditing(false) }} title="Leave without saving the changes">Cancel</button></>
            : <button className="nb-tool" onClick={() => setEditing(true)} title="Type into the page; ✓ Done saves (Ctrl+Z undoes)">✎ Edit</button>)}
          <button className="nb-tool" onClick={fileMenu} aria-haspopup="menu">File ▾</button>
          {!standalone && <button className="nb-tool" title="Open this note in its own window" onClick={() => void call('notes:popNote', { id: doc.id })}>⧉</button>}
          <span className="nb-pn">
            <button disabled={!prev} onClick={() => prev && onOpenDoc(prev.id)} title={prev ? `Open ${prev.title}` : undefined}>‹ {prev?.title}</button>
            <button disabled={!next} onClick={() => next && onOpenDoc(next.id)} title={next ? `Open ${next.title}` : undefined}>{next?.title} ›</button>
          </span>
          {editing && (
            <div className="nb-etools" role="toolbar" aria-label="Formatting" onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault() }}>
              <button title="Bold (Ctrl+B)" onClick={() => cmd('bold')}><b>B</b></button>
              <button title="Italic (Ctrl+I)" onClick={() => cmd('italic')}><i>I</i></button>
              <button title="Underline (Ctrl+U)" onClick={() => cmd('underline')}><u>U</u></button>
              <span className="gap" />
              <button onClick={() => cmd('formatBlock', 'h1')}>Title</button>
              <button onClick={() => cmd('formatBlock', 'h2')}>Heading</button>
              <button onClick={() => cmd('formatBlock', 'h3')}>Subheading</button>
              <button onClick={() => cmd('formatBlock', 'p')}>Text</button>
              <span className="gap" />
              <button onClick={() => cmd('insertUnorderedList')}>• List</button>
              <button onClick={() => cmd('insertOrderedList')}>1. List</button>
              <button title="Turn the paragraph into a read-aloud box (again: back to text)" onClick={() => boxToggle('nb-read')}>Read-aloud</button>
              <button title="Turn the paragraph into a DM sidebar (again: back to text)" onClick={() => boxToggle('nb-side')}>Sidebar</button>
              <button title="A table of 3 columns" onClick={() => cmd('insertHTML', '<table><tbody><tr><td>d6</td><td>Heading</td><td>Heading</td></tr><tr><td>1</td><td><br></td><td><br></td></tr><tr><td>2</td><td><br></td><td><br></td></tr></tbody></table><p><br></p>')}>Table</button>
              <button title="A card’s picture at the cursor" onClick={() => editPicture(false)}>Card picture</button>
              <button title="A picture file of your own at the cursor" onClick={() => editPicture(true)}>Own picture</button>
              <button title="A monster or NPC card’s stat block at the cursor" onClick={editStat}>Stat block</button>
              <button title="Link the selected words, or type [[ in the text" onClick={() => linkPicker(false)}>[[ Link</button>
            </div>
          )}
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div className="nb-book-wrap" ref={page}>
          {!editing && bannerSrc && (
            <div className="nb-banner" onContextMenu={bannerMenu} title="Right-click to change the banner">
              <img src={bannerSrc} alt="" />
              <span className="src">{meta.banner?.file ? 'Your picture' : `From ${byId.get(bannerCard ?? '')?.name ?? 'a card'}`} · right-click to change</span>
            </div>
          )}
          {doc.kind === 'picture' ? <div className="nb-book"><h1 className="nb-title">{doc.title}</h1>{pictureUrl && <img src={pictureUrl} alt={doc.title} style={{ maxWidth: '100%' }} />}</div>
            : editing ? (
              <div className="nb-book">
                <h1 className="nb-title">{doc.title}</h1>
                <div ref={ed} className="nb-book" style={{ padding: 0 }} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={doc.title}
                  onInput={() => { dirty.current = true; const s = window.getSelection(); const n = s?.anchorNode; if (n?.nodeType === Node.TEXT_NODE && (n.textContent ?? '').slice(0, s!.anchorOffset).endsWith('[[')) linkPicker(true) }}
                  onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void done() } }} />
              </div>
            ) : (
              <article className="nb-book" onMouseOver={hover} onMouseLeave={() => setTip(null)} onContextMenu={pageMenu}
                onClick={(e) => { const el = (e.target as HTMLElement).closest<HTMLElement>('[data-target]'); if (el) openTarget(el.dataset.target!, e) }}>
                <h1 className="nb-title" onContextMenu={(e) => { if (!bannerSrc && meta.banner?.none) bannerMenu(e) }}>{doc.title}</h1>
                <div className="nb-byline">From {doc.originalName}{!bannerSrc && <> · <button className="link-button" onClick={bannerMenu}>Banner picture…</button></>}</div>
                {meta.card && byId.get(meta.card) && (
                  <button className="nb-linked" onClick={() => showPeek(meta.card!)} title="Show the card in the side panel (File ▾ changes the link)">
                    <CardIcon card={byId.get(meta.card)} />Linked to the card <b>{byId.get(meta.card)!.name}</b> ({ENTITY_LABELS[byId.get(meta.card)!.type]})
                  </button>
                )}
                {blocks && blocks.length === 0 && <p className="nb-empty">Empty. Click ✎ Edit to write.</p>}
                {body}
              </article>
            )}
        </div>
      </section>
      <RightPanel tab={rtab} setTab={setRtab} doc={doc} docs={docs} blocks={blocks ?? []} heads={heads} m={m} cards={cards} byId={byId} spells={spells} peek={peek}
        onJump={jumpTo} onPeek={showPeek} onOpenDoc={onOpenDoc} setMeta={setMeta} linkStyle={linkStyle} standalone={standalone}
        onLinkNote={(id, name) => {
          if (!blocks) return
          // The first place the note's title appears becomes a link to it.
          const low = name.toLowerCase()
          for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i]
            if (!('runs' in b) || isHeading(b)) continue
            const text = b.runs.map((r) => r.text).join('')
            const at = text.toLowerCase().indexOf(low)
            if (at >= 0) { changeRuns({ block: i, cell: 0, from: at, to: at + name.length }, (runs) => setLinkRange(runs, at, at + name.length, `note:${id}`)); return }
          }
        }} />
      {tip && <Tip tip={tip} byId={byId} spells={spells} docs={docs} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {picker && <CardPicker title={picker.title} at={picker.at} cards={picker.stats ? cards.filter((c) => c.type === 'MONSTER' || c.type === 'NPC' || c.type === 'PC')
        : picker.withPictures ? cardsWithPictures.filter((c) => picker.notes !== false || c.type === 'LOCATION' || c.type === 'BUILDING') : cards}
        notes={picker.notes ? docs.filter((d) => d.id !== doc.id) : []} onPick={picker.onPick} onMake={picker.onMake} onClose={() => setPicker(null)} />}
      {changed && onOpenDraft && <UpdateCards id={doc.id} lines={changed} onClose={() => setChanged(null)} onOpen={onOpenDraft} />}
      {making && <CharSheetDialog doc={doc} docs={docs} onClose={() => setMaking(false)} />}
      {finding && <FindHeadingsDialog found={finding} onClose={() => setFinding(null)} onApply={(chosen) => {
        if (blocks) void save(blocks.map((b, k) => { const lv = chosen.get(k); return lv && 'runs' in b ? { ...b, kind: lv } : b }))
      }} />}
    </>
  )
}

const LEVEL_LABEL: Record<HeadingLevel, string> = { h1: 'Title', h2: 'Heading', h3: 'Subheading' }

/** Find headings: the lines that look like headings, ticked; Make headings changes only the ticked ones (one undoable save). */
export function FindHeadingsDialog({ found, onApply, onClose }: { found: Array<{ key: number; text: string; level: HeadingLevel }>; onApply(chosen: Map<number, HeadingLevel>): void; onClose(): void }) {
  const [chosen, setChosen] = useState(() => new Map(found.map((f) => [f.key, f.level])))
  return (
    <Dialog title="Find headings" open onClose={onClose}>
      {found.length === 0 ? <p>No lines that look like headings. Make headings yourself with ✎ Edit and the Title, Heading and Subheading buttons.</p> : (
        <>
          <p>These lines look like headings. Untick any that are not, or change the level. Nothing changes until you click Make headings, and Ctrl+Z undoes it.</p>
          <ul className="find-heads">
            {found.map((f) => (
              <li key={f.key}>
                <label><input type="checkbox" checked={chosen.has(f.key)} onChange={(e) => { const n = new Map(chosen); if (e.target.checked) n.set(f.key, f.level); else n.delete(f.key); setChosen(n) }} /> {f.text}</label>
                <select aria-label={`Level for ${f.text}`} value={chosen.get(f.key) ?? f.level} disabled={!chosen.has(f.key)}
                  onChange={(e) => setChosen(new Map(chosen).set(f.key, e.target.value as HeadingLevel))}>
                  {(['h1', 'h2', 'h3'] as const).map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="dz-actions">
        <button onClick={onClose}>Cancel</button>
        {found.length > 0 && <button className="primary" disabled={!chosen.size} onClick={() => { onApply(chosen); onClose() }}>Make {chosen.size} heading{chosen.size === 1 ? '' : 's'}</button>}
      </div>
    </Dialog>
  )
}

/** The hover note: a card's picture and summary, or a spell or condition in short. */
function Tip({ tip, byId, spells, docs }: { tip: { target: string; x: number; top: number; bottom: number }; byId: Map<string, Card>; spells: Map<string, SrdSpell>; docs: NoteDocView[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(tip.bottom + 6)
  useLayoutEffect(() => { const h = ref.current?.offsetHeight ?? 0; setTop(tip.bottom + 6 + h > window.innerHeight - 8 ? tip.top - h - 6 : tip.bottom + 6) }, [tip])
  const t = tip.target
  let body: ReactNode
  if (t.startsWith('term:')) {
    const name = t.slice(5)
    const rule = RULES_TERMS[name]
    const sp = spells.get(name.toLowerCase())
    body = rule ? <><h5>{name}</h5><div className="ty">{rule.kind}</div><p>{rule.text}</p><div className="hint">Click for the side panel</div></>
      : sp ? <><h5>{sp.name}</h5><div className="ty">{sp.level ? `Level ${sp.level} ${sp.school}` : `${sp.school} cantrip`}{sp.ritual ? ' · ritual' : ''} · {sp.time} · {sp.range}</div>
        <p>{sp.desc.length > 260 ? `${sp.desc.slice(0, 260)}…` : sp.desc}</p><div className="hint">SRD 5.2 · click for the whole spell</div></> : null
  } else if (t.startsWith('note:')) {
    const d = docs.find((x) => x.id === t.slice(5))
    body = d ? <><h5>{d.title}</h5><div className="ty">Note{d.folder ? ` · ${d.folder}` : ''}</div><div className="hint">Click to open</div></> : null
  } else {
    const c = byId.get(t)
    body = c ? (
      <>
        <div className="th">{c.picture && <img src={asset(c.picture, 128)} alt="" />}<div><h5>{c.name}</h5><div className="ty">{c.encounter ? 'Encounter' : ENTITY_LABELS[c.type]}{c.location ? ` · ${c.location}` : ''}</div></div></div>
        {c.summary && <p>{c.summary.length > 220 ? `${c.summary.slice(0, 220)}…` : c.summary}</p>}
        <div className="hint">Click: side panel · Ctrl+click: the sheet · right-click: more</div>
      </>
    ) : null
  }
  if (!body) return null
  return <div ref={ref} className="nb-tip" style={{ left: Math.max(8, Math.min(tip.x, window.innerWidth - 310)), top }} role="tooltip">{body}</div>
}

/** The Notes screen's right column: Contents, Peek, Links, Mentions, Linked from. */
function RightPanel(p: {
  tab: RTab; setTab(t: RTab): void; doc: NoteDocView; docs: NoteDocView[]; blocks: Block[]; heads: Array<{ level: HeadingLevel; text: string }>; m: Matcher
  cards: Card[]; byId: Map<string, Card>; spells: Map<string, SrdSpell>; peek: string | null; standalone?: boolean
  onJump(n: number): void; onPeek(t: string): void; onOpenDoc(id: string, heading?: number): void; setMeta(patch: Partial<NoteMeta>): Promise<unknown>
  linkStyle(c: Card | undefined): CSSProperties; onLinkNote(id: string, title: string): void
}) {
  const { act, say } = useBoard()
  const info = useBoard((s) => s.info)
  const typeColour = useTypeColour()
  const links = useMemo(() => {
    const count = new Map<string, number>()
    for (const b of p.blocks) for (const runs of blockRuns(b)) for (const h of paragraphLinks(runs, p.m)) count.set(h.target, (count.get(h.target) ?? 0) + 1)
    return count
  }, [p.blocks, p.m])
  // Words of another note's title (Salt and Silver) are that note, not new names.
  const unknown = useMemo(() => unknownNames(p.blocks, p.m, p.doc.meta.ignore ?? [])
    .filter((u) => !p.docs.some((d) => findAll(d.title, { phrases: [{ text: u.name, target: '' }] }).length)), [p.blocks, p.m, p.doc.meta.ignore, p.docs])
  const otherNotes = useMemo(() => {
    const text = p.blocks.flatMap(blockRuns).map((runs) => runs.map((r) => r.text).join('')).join('\n')
    const linked = new Set([...links.keys()])
    return p.docs.filter((d) => d.id !== p.doc.id && d.title.length > 3 && !linked.has(`note:${d.id}`) && !(p.doc.meta.ignore ?? []).includes(d.title.toLowerCase())
      && findAll(text, { phrases: [{ text: d.title, target: d.id }] }).length > 0)
  }, [p.blocks, p.docs, p.doc, links])
  const [from, setFrom] = useState<{ preps: Array<{ number: number; title: string }>; notes: Array<{ id: string; title: string }> } | null>(null)
  useEffect(() => { if (p.tab === 'from') void call('notes:linkedFrom', { id: p.doc.id }).then(setFrom).catch(() => setFrom(null)) }, [p.tab, p.doc.id, p.doc.updatedAt])
  const ignore = (name: string) => void p.setMeta({ ignore: [...new Set([...(p.doc.meta.ignore ?? []), name.toLowerCase()])] })
  const make = async (name: string, type: EntityType) => {
    if (!info) return
    const e = await act('entity:create', { boardId: info.globalBoardId, type, name })
    if (e) say(`Made the ${ENTITY_LABELS[type]} card ${name}. It links in the note now.`)
  }
  const [makeMenu, setMakeMenu] = useState<{ x: number; y: number; name: string } | null>(null)
  const cardLinks = [...links].filter(([t]) => p.byId.has(t))
  const termLinks = [...links].filter(([t]) => t.startsWith('term:'))
  const noteLinks = [...links].filter(([t]) => t.startsWith('note:'))
  const groups = new Map<string, Array<[string, number]>>()
  for (const x of cardLinks) { const c = p.byId.get(x[0])!; const g = c.encounter ? 'Encounters' : `${ENTITY_LABELS[c.type]}s`; groups.set(g, [...(groups.get(g) ?? []), x]) }
  const tabBtn = (t: RTab, label: string, n?: number) => <button role="tab" aria-selected={p.tab === t} onClick={() => p.setTab(t)}>{label}{n ? <span className="n">{n}</span> : null}</button>
  return (
    <aside className="nb-right" aria-label="Note side panel">
      <div className="nb-rtabs" role="tablist">
        {tabBtn('contents', 'Contents')}
        {tabBtn('peek', 'Peek')}
        {tabBtn('links', 'Links', links.size)}
        {tabBtn('mentions', 'Mentions', unknown.length + otherNotes.length)}
        {tabBtn('from', 'Linked from')}
      </div>
      <div className="nb-rbody">
        {p.tab === 'contents' && (p.heads.length === 0 ? <p className="nb-muted">No headings yet. ✎ Edit makes them, or File ▾ › Find headings…</p>
          : <nav className="nb-toc" aria-label="Contents">{p.heads.map((h, i) => <button key={i} className={h.level} onClick={() => p.onJump(i)}>{h.text}</button>)}</nav>)}
        {p.tab === 'peek' && <Peek target={p.peek} byId={p.byId} spells={p.spells} standalone={p.standalone} />}
        {p.tab === 'links' && (
          <>
            {links.size === 0 && <p className="nb-muted">Nothing linked yet. Card names, spells and conditions link by themselves.</p>}
            {[...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([g, list]) => (
              <div key={g}>
                <div className="nb-grp">{g}</div>
                {list.sort((a, b) => p.byId.get(a[0])!.name.localeCompare(p.byId.get(b[0])!.name)).map(([t, n]) => {
                  const c = p.byId.get(t)!
                  return <button key={t} className="nb-chip" onClick={() => p.onPeek(t)}><span className="dot" style={{ background: c.colour ?? typeColour(c.type) }} />{c.name}<span className="c">{n}×</span></button>
                })}
              </div>
            ))}
            {noteLinks.length > 0 && <><div className="nb-grp">Notes</div>{noteLinks.map(([t]) => <button key={t} className="nb-chip" onClick={() => p.onOpenDoc(t.slice(5))}><span className="dot" style={{ background: 'var(--nb-head)' }} />{p.docs.find((d) => d.id === t.slice(5))?.title ?? 'A note'}</button>)}</>}
            {termLinks.length > 0 && <><div className="nb-grp">Rules from the SRD</div>{termLinks.map(([t, n]) => <button key={t} className="nb-chip" onClick={() => p.onPeek(t)}><span className="dot" style={{ background: RULES_TERMS[t.slice(5)]?.kind === 'Condition' ? 'var(--nb-cond)' : RULES_TERMS[t.slice(5)] ? 'var(--nb-rulec)' : 'var(--nb-spell)' }} />{t.slice(5)}<span className="c">{n}×</span></button>)}</>}
          </>
        )}
        {p.tab === 'mentions' && (
          <>
            <p className="nb-muted" style={{ marginTop: 0 }}>Names in this note that are not cards yet, and other notes it names.</p>
            {unknown.length === 0 && otherNotes.length === 0 && <p className="nb-muted">Nothing new.</p>}
            {otherNotes.length > 0 && <div className="nb-grp">Other notes named here</div>}
            {otherNotes.map((d) => (
              <div key={d.id} className="nb-mention"><b>{d.title}</b>
                <div className="acts"><button className="nb-btn is-pri" onClick={() => p.onLinkNote(d.id, d.title)}>Link to the note</button><button className="nb-btn" onClick={() => ignore(d.title)}>Ignore</button></div></div>
            ))}
            {unknown.length > 0 && <div className="nb-grp">Not a card yet</div>}
            {unknown.map((u) => (
              <div key={u.name} className="nb-mention">{u.text}<div className="nb-muted"><b>{u.name}</b> · {u.count}×</div>
                <div className="acts">
                  <button className="nb-btn is-pri" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMakeMenu({ x: r.left, y: r.bottom + 4, name: u.name }) }}>Make a card ▾</button>
                  <button className="nb-btn" onClick={() => ignore(u.name)}>Ignore</button>
                </div>
              </div>
            ))}
            {makeMenu && <ContextMenu x={makeMenu.x} y={makeMenu.y} onClose={() => setMakeMenu(null)}
              items={(['NPC', 'LOCATION', 'BUILDING', 'MONSTER', 'ITEM', 'FACTION', 'OTHER'] as EntityType[]).map((t) => ({ label: ENTITY_LABELS[t], onClick: () => void make(makeMenu.name, t) }))} />}
          </>
        )}
        {p.tab === 'from' && (
          !from ? <p className="nb-muted">Looking…</p> : (
            <>
              {from.preps.length === 0 && from.notes.length === 0 && <p className="nb-muted">Nothing links here yet. Other notes link here with [[ in ✎ Edit, or Mentions › Link to the note; a Session prep sheet saved as notes shows here.</p>}
              {from.preps.length > 0 && <><div className="nb-grp">Session prep</div>{from.preps.map((x) => <button key={x.number} className="nb-chip" onClick={() => { useBoard.getState().setPrepNumber(x.number); useBoard.getState().goTo('prep') }}><span className="dot" style={{ background: 'var(--nb-muted)' }} />Session {x.number}{x.title ? ` · ${x.title}` : ''}</button>)}</>}
              {from.notes.length > 0 && <><div className="nb-grp">Notes</div>{from.notes.map((x) => <button key={x.id} className="nb-chip" onClick={() => p.onOpenDoc(x.id)}><span className="dot" style={{ background: 'var(--nb-head)' }} />{x.title}</button>)}</>}
            </>
          )
        )}
      </div>
    </aside>
  )
}

/** Peek: what was clicked in the note. Monsters show their stat block; places who is there; encounters their buttons. */
function Peek({ target, byId, spells, standalone }: { target: string | null; byId: Map<string, Card>; spells: Map<string, SrdSpell>; standalone?: boolean }) {
  const { act, query, openSheet, showOnBoard, openEncounter, openCombat, goTo } = useBoard()
  const view = useBoard((s) => s.view)
  const [sheet, setSheet] = useState<SheetView | null>(null)
  const [adding, setAdding] = useState(false)
  const card = target ? byId.get(target) : undefined
  useEffect(() => { setSheet(null); if (card) void query('sheet:view', { entityId: card.id }).then((s) => setSheet(s ?? null)) }, [card?.id, view?.undo]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return <p className="nb-muted">Click a coloured name in the note to see it here. Ctrl+click opens the full sheet.</p>
  if (target.startsWith('term:')) {
    const name = target.slice(5)
    const rule = RULES_TERMS[name]
    const sp = spells.get(name.toLowerCase())
    if (rule) return <><div className="nb-peekhead"><div><h3>{name}</h3><small>{rule.kind}</small></div></div><p className="nb-peektext">{rule.text}</p><p className="nb-muted">A short form of the SRD 5.2 rule.</p></>
    if (!sp) return <p className="nb-muted">Not found.</p>
    return (
      <>
        <div className="nb-peekhead"><div><h3>{sp.name}</h3><small>{sp.level ? `Level ${sp.level} ${sp.school}` : `${sp.school} cantrip`}{sp.ritual ? ' (ritual)' : ''}</small></div></div>
        <dl className="nb-kv"><dt>Casting time</dt><dd>{sp.time}</dd><dt>Range</dt><dd>{sp.range}</dd><dt>Duration</dt><dd>{sp.concentration ? 'Concentration, ' : ''}{sp.duration}</dd>{sp.classes.length > 0 && <><dt>Classes</dt><dd>{sp.classes.join(', ')}</dd></>}</dl>
        <p className="nb-peektext">{sp.desc}</p>
        {sp.higher && <p className="nb-peektext"><b>At higher levels.</b> {sp.higher}</p>}
        <p className="nb-muted">SRD 5.2, copied into the app.</p>
      </>
    )
  }
  if (!card) return <p className="nb-muted">That card is gone (History brings it back).</p>
  const a = (sheet?.entity.attributes ?? {}) as Record<string, unknown>
  const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '')
  const sb = readStatBlock(a.statblock)
  const isPlace = card.type === 'LOCATION' || card.type === 'BUILDING'
  const here = isPlace ? [...byId.values()].filter((c) => c.location && c.location.toLowerCase() === card.name.toLowerCase() && c.id !== card.id) : []
  const encounters = [...byId.values()].filter((c) => c.encounter)
  const secrets = (sheet?.secrets ?? []).filter((x) => x.connections.some((c) => c.sourceId === card.id || c.targetId === card.id))
  const btn = (label: string, run: () => void, pri = false) => <button className={`nb-btn${pri ? ' is-pri' : ''}`} onClick={run}>{label}</button>
  return (
    <>
      <div className="nb-peekhead">
        {card.picture ? <img src={asset(card.picture, 256)} alt="" /> : <span className="ph" />}
        <div><h3>{card.name}</h3><small>{card.encounter ? 'Encounter' : ENTITY_LABELS[card.type]}{card.location ? ` · ${card.location}` : ''}</small></div>
      </div>
      <div className="nb-peekacts">
        {btn('Open sheet', () => void openSheet(card.id), true)}
        {!standalone && btn('Show on board', () => void showOnBoard(card.id))}
        {!standalone && isPlace && btn('Show on map', () => { useBoard.setState({ mapFocusId: card.id }); goTo('map') })}
        {!standalone && card.encounter && btn('Open encounter', () => openEncounter(card.id))}
        {!standalone && card.encounter && btn('Run encounter', () => void act('combat:start', { encounterId: card.id }).then((id) => { if (id) void openCombat(id) }))}
        {(card.type === 'MONSTER' || card.type === 'NPC') && encounters.length > 0 && btn('Add to an encounter…', () => setAdding(!adding))}
      </div>
      {adding && (
        <div className="nb-pick">
          {encounters.map((e) => <button key={e.id} className="nb-chip" onClick={() => void act('encounter:addCreature', { encounterId: e.id, entityId: card.id, count: 1 }).then(() => { setAdding(false); useBoard.getState().say(`${card.name} added to ${e.name}.`) })}>
            <span className="dot" style={{ background: 'var(--nb-head)' }} />{e.name}</button>)}
        </div>
      )}
      {sb && sheet && <StatBlockView name={card.name} sb={sb} actions={sheet.abilities} />}
      {card.summary && <p className="nb-peektext">{card.summary}</p>}
      <dl className="nb-kv">
        {s('motivation') && <><dt>Motivation</dt><dd>{s('motivation')}</dd></>}
        {s('flaws') && <><dt>Flaws</dt><dd>{s('flaws')}</dd></>}
        {here.length > 0 && <><dt>Here</dt><dd>{here.map((c) => c.name).join(', ')}</dd></>}
      </dl>
      {s('description') && <><div className="nb-grp">Description</div><p className="nb-peektext">{s('description')}</p></>}
      {secrets.length > 0 && <><div className="nb-grp">Secrets</div>{secrets.map((x) => <p key={x.id} className="nb-peektext">{x.text}</p>)}</>}
      {s('notes') && <><div className="nb-grp">DM notes</div><p className="nb-peektext">{s('notes')}</p></>}
    </>
  )
}
