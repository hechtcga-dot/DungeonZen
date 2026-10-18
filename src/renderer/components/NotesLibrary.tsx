import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { sessionLabel } from '../../shared/time'
import { SummaryTools } from './SessionSummary'
import { Dialog } from './Dialog'
import { NoteEditor, type NoteEditorHandle } from './NoteEditor'
import { CardIcon, CardPicker, NoteReader, UpdateCards } from './NoteReader'
import type { IpcInput } from '../../shared/ipc'
import type { ImportDraft } from '../../shared/notesImport'
import type { NoteDocView, NotesScreenView } from '../../shared/types'
import { OpenFolder } from './OpenFolder'
import { ImportCharSheet } from './ImportCharSheet'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { blockLines, headingLevel, type Block, type HeadingLevel } from '../../shared/noteDoc'
import type { IpcOutputs } from '../../shared/ipc'
import { PopOut } from './PopOut'

type Open = { kind: 'master' } | { kind: 'dm' } | { kind: 'session'; id: string } | { kind: 'doc'; id: string }
type Outline = IpcOutputs['notes:outline']
/** Jump to the n-th heading of the open note (nonce: jump again to the same one). */
type Jump = { n: number; nonce: number } | null
const KIND_LABEL: Record<NoteDocView['kind'], string> = { word: 'Word', pdf: 'PDF', text: 'Text', picture: 'Picture' }
const LEVEL_LABEL: Record<HeadingLevel, string> = { h1: 'Title', h2: 'Heading', h3: 'Small heading' }
const keyOf = (o: Open) => (o.kind === 'session' ? `session:${o.id}` : o.kind === 'doc' ? `doc:${o.id}` : o.kind)
const words = (t: string) => (t.trim() ? `${t.trim().split(/\s+/).length} words` : '')
const COLLAPSE_KEY = 'dz-notes-list-collapsed'

const THEME_KEY = 'dz-notes-theme'
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const byTitle = (a: NoteDocView, b: NoteDocView) => natural(a.title, b.title)

/** A plain folder. */
function FolderIcon() {
  return <svg className="nb-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 4 H6 L7.5 5.5 H15 V13.5 H1Z" fill="var(--nb-head)" /></svg>
}

/** Open tabs and back/forward, kept while the app runs. */
const nav: { tabs: Open[]; cur: number; back: Open[]; fwd: Open[] } = { tabs: [{ kind: 'dm' }], cur: 0, back: [], fwd: [] }
const same = (a: Open, b: Open) => keyOf(a) === keyOf(b)

/** Light or dark book (owner, 2.8.0); this computer only. */
export function useNotesTheme(): ['light' | 'dark', (t: 'light' | 'dark') => void] {
  const [t, setT] = useState<'light' | 'dark'>(() => { try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light' } catch { return 'light' } })
  return [t, (v) => { setT(v); try { localStorage.setItem(THEME_KEY, v) } catch { /* this session only */ } }]
}

/**
 * Notes (owner, 2.8.0; Obsidian and the official books): notes tree with search, starred and recent on the left; tabs
 * with back / forward on top; notes files as book pages in the middle (NoteReader), with Contents, Peek, Links,
 * Mentions and Linked from on the right. DM notes, session notes and Master notes keep their own views.
 * Notes files: Ctrl/Shift+click selects several; right-click for Open file location, Rename, Duplicate, Combine, folders, Delete.
 */
export function NotesLibrary({ onOpen, onImport }: { onOpen(d: ImportDraft): void; onImport(): void }) {
  const { query, act, view, say } = useBoard()
  const info = useBoard((s) => s.info)
  const [theme, setTheme] = useNotesTheme()
  const [data, setData] = useState<NotesScreenView | null>(null)
  const [outline, setOutline] = useState<Outline>({})
  const [, rerender] = useState(0)
  const [jump, setJump] = useState<Jump>(null)
  const [edited, setEdited] = useState<Array<{ id: string; title: string }>>([])
  const [newTitle, setNewTitle] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [naming, setNaming] = useState<{ title: string; label?: string; value: string; onDone(v: string): void } | null>(null)
  const [linking, setLinking] = useState<{ onPick(id: string | null): void } | null>(null)
  const wordLinks = useBoard((s) => s.wordLinks)
  const [combining, setCombining] = useState<string[] | null>(null)
  const [left, setLeft] = useState<'notes' | 'starred' | 'recent'>('notes')
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<IpcOutputs['notes:search'] | null>(null)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } })
  const recentKey = `dz-notes-recent:${info?.globalBoardId ?? ''}`
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(recentKey) ?? '[]') as string[] } catch { return [] } })
  const load = useCallback(() => {
    void query('notes:screen', undefined).then((d) => { if (d) setData(d) })
    void query('notedoc:edited', undefined).then((e) => setEdited(e ?? []))
    void query('notes:outline', undefined).then((o) => { if (o) setOutline(o) })
  }, [query])
  useEffect(load, [load, view?.undo])
  // Coming back from Word: look for changes.
  useEffect(() => { window.addEventListener('focus', load); return () => window.removeEventListener('focus', load) }, [load])
  // Another screen asked for a note (a sheet's "In your notes", Session prep): open it in the current tab.
  useEffect(() => {
    const st = useBoard.getState()
    if (!st.notesOpenId) return
    go({ kind: 'doc', id: st.notesOpenId }, st.notesOpenHeading ?? -1)
    useBoard.setState({ notesOpenId: null, notesOpenHeading: null })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!q.trim()) { setHits(null); return }
    const t = setTimeout(() => void call('notes:search', { q: q.trim() }).then(setHits).catch(() => setHits([])), 250)
    return () => clearTimeout(t)
  }, [q])

  const open = nav.tabs[nav.cur] ?? { kind: 'dm' }
  /** Open a note in the current tab (back remembers where you were). */
  function go(o: Open, n = -1, newTab = false) {
    const curr = nav.tabs[nav.cur]
    if (newTab) { nav.tabs.splice(nav.cur + 1, 0, o); nav.cur++ }
    else if (!curr || !same(curr, o)) { if (curr) nav.back.push(curr); nav.fwd = []; nav.tabs[nav.cur] = o }
    setJump(n < 0 ? null : { n, nonce: Date.now() })
    if (o.kind === 'doc') {
      const next = [o.id, ...recent.filter((x) => x !== o.id)].slice(0, 15)
      setRecent(next)
      try { localStorage.setItem(recentKey, JSON.stringify(next)) } catch { /* this session only */ }
    } else setSelected(new Set())
    rerender((x) => x + 1)
  }
  const goBack = () => { const o = nav.back.pop(); if (!o) return; nav.fwd.push(nav.tabs[nav.cur]); nav.tabs[nav.cur] = o; setJump(null); rerender((x) => x + 1) }
  const goFwd = () => { const o = nav.fwd.pop(); if (!o) return; nav.back.push(nav.tabs[nav.cur]); nav.tabs[nav.cur] = o; setJump(null); rerender((x) => x + 1) }
  const closeTab = (i: number) => {
    nav.tabs.splice(i, 1)
    if (!nav.tabs.length) nav.tabs.push({ kind: 'dm' })
    nav.cur = Math.min(nav.cur > i ? nav.cur - 1 : nav.cur, nav.tabs.length - 1)
    nav.back = []; nav.fwd = []
    rerender((x) => x + 1)
  }

  const collapse = (v: boolean) => { setCollapsed(v); try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* per-viewer convenience only */ } }
  const create = async () => {
    const title = newTitle?.trim()
    if (!title) return
    const id = await act('notedoc:create', { title })
    setNewTitle(null)
    if (id) { load(); go({ kind: 'doc', id }) }
  }
  if (!data) return <p className="ink-muted page-pad">Loading…</p>
  const doc = open.kind === 'doc' ? data.docs.find((d) => d.id === open.id) : undefined
  const sess = open.kind === 'session' ? data.sessions.find((x) => x.id === open.id) : undefined
  const tabTitle = (o: Open) => (o.kind === 'master' ? 'Master notes' : o.kind === 'dm' ? 'DM notes' : o.kind === 'session'
    ? `Session ${data.sessions.find((x) => x.id === o.id)?.number ?? ''}` : data.docs.find((d) => d.id === o.id)?.title ?? 'Gone')

  // Folders nest ("A/B/C", 2.8.0); sorted by name with numbers in order, then the notes in them.
  const folders = [...data.folders].sort(natural)
  const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
  const leaf = (p: string) => p.split('/').pop() ?? p
  const subFolders = (p: string) => folders.filter((f) => parentOf(f) === p).sort((a, b) => natural(leaf(a), leaf(b)))
  const docsIn = (p: string) => data.docs.filter((d) => d.folder === p).sort(byTitle)
  const countIn = (p: string): number => docsIn(p).length + subFolders(p).reduce((n, f) => n + countIn(f), 0)
  const flatIn = (p: string): NoteDocView[] => [...subFolders(p).flatMap((f) => (closedFolders.has(f) ? [] : flatIn(f))), ...docsIn(p)]
  const flat = flatIn('')
  const inFolder = doc ? docsIn(doc.folder) : []
  const cardById = new Map((wordLinks?.cards ?? []).map((c) => [c.id, c]))
  const pathLabel = (p: string) => p.split('/').join(' › ')
  const at = doc ? inFolder.findIndex((d) => d.id === doc.id) : -1
  const toggle = (set: Set<string>, key: string) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); return n }
  const ids = (id: string) => (selected.has(id) ? [...selected] : [id])
  const starred = new Set(data.starred)
  const remove = async (list: string[]) => {
    for (const id of list) await act('notedoc:setStatus', { id, status: 'defunct' })
    setSelected(new Set()); load()
    say(`${list.length === 1 ? 'Note' : `${list.length} notes`} moved to History. Ctrl+Z brings ${list.length === 1 ? 'it' : 'the last one'} back.`)
  }
  const moveTo = (list: string[], folder: string) => void act('notedoc:setFolder', { ids: list, folder }).then(load)
  const newFolder = (list: string[]) => setNaming({ title: 'New folder', label: 'Folder name', value: '', onDone: (v) => moveTo(list, v.replace(/\//g, '-')) })
  const folderItems = (list: string[]): MenuItem[] => [
    ...folders.map((f) => ({ label: pathLabel(f), onClick: () => moveTo(list, f) })),
    ...(folders.length ? ['separator' as const] : []),
    { label: 'New folder…', onClick: () => newFolder(list) },
    { label: 'No folder (top level)', onClick: () => moveTo(list, ''), disabled: list.every((id) => !data.docs.find((d) => d.id === id)?.folder) }
  ]
  const folder = (a: IpcInput<'notes:folder'>) => void act('notes:folder', a).then(load)
  const newNoteIn = (path: string) => setNaming({ title: path ? `New note in ${leaf(path)}` : 'New note', label: 'Note title', value: '',
    onDone: (title) => void act('notedoc:create', { title, folder: path }).then((id) => { load(); if (id) go({ kind: 'doc', id }) }) })
  const newFolderIn = (path: string) => setNaming({ title: path ? `New folder in ${leaf(path)}` : 'New folder', label: 'Folder name', value: '',
    onDone: (v) => folder({ action: 'create', path: path ? `${path}/${v.replace(/\//g, '-')}` : v.replace(/\//g, '-') }) })
  /** Link to a card / Open the card / Unlink, for a note or a folder (one card each). */
  const linkItems = (card: string | undefined, setCard: (id: string | null) => void): MenuItem[] => {
    const c = card ? cardById.get(card) : undefined
    return [
      { label: c ? `Linked to ${c.name} · Change…` : 'Link to a card…', hint: 'Shows the card’s icon here; the card’s sheet lists it under Notes', onClick: () => setLinking({ onPick: setCard }) },
      ...(c ? [{ label: `Open ${c.name}’s sheet`, onClick: () => void useBoard.getState().openSheet(c.id) }, { label: 'Unlink from the card', onClick: () => setCard(null) }] : [])
    ]
  }
  const docMenu = (e: ReactMouseEvent, d: NoteDocView) => {
    e.preventDefault()
    const many = selected.has(d.id) && selected.size > 1
    if (!selected.has(d.id)) { setSelected(new Set([d.id])); setAnchor(d.id) }
    const list = many ? [...selected] : [d.id]
    const words2 = data.docs.filter((x) => list.includes(x.id) && x.kind !== 'picture')
    setMenu({
      x: e.clientX, y: e.clientY, items: many ? [
        { label: `Combine ${list.length} notes…`, disabled: words2.length < 2, hint: 'A new note made of these, in the order you choose', onClick: () => setCombining(list) },
        { label: 'Move to folder', items: folderItems(list) },
        'separator',
        { label: `Delete ${list.length} notes (to History)`, danger: true, onClick: () => void remove(list) }
      ] : [
        { label: 'Open', onClick: () => go({ kind: 'doc', id: d.id }) },
        { label: 'Open in a new tab', onClick: () => go({ kind: 'doc', id: d.id }, -1, true) },
        { label: 'Open in its own window', onClick: () => void call('notes:popNote', { id: d.id }) },
        { label: starred.has(d.id) ? 'Unstar' : 'Star', onClick: () => void act('notes:star', { id: d.id, on: !starred.has(d.id) }).then(load) },
        { label: 'Open file location', hint: 'Shows the file in Windows Explorer', onClick: () => void act('notedoc:showInFolder', { id: d.id }) },
        'separator',
        { label: 'Rename', onClick: () => setRenaming({ id: d.id, title: d.title }) },
        { label: 'Duplicate', onClick: () => void act('notedoc:duplicate', { id: d.id }).then((id) => { load(); if (id) go({ kind: 'doc', id }) }) },
        ...(d.kind !== 'picture' ? [{ label: 'Save a copy as Word…', onClick: () => void act('notedoc:saveCopy', { id: d.id }).then((p) => { if (p) say(`Saved ${p}`) }) }] : []),
        { label: 'Move to folder', items: folderItems(list) },
        'separator',
        ...linkItems(d.meta.card, (card) => void act('notedoc:setMeta', { id: d.id, meta: { ...d.meta, card: card ?? undefined } }).then(load)),
        'separator',
        { label: 'Delete (to History)', danger: true, onClick: () => void remove(list) }
      ]
    })
  }
  const folderMenu = (e: ReactMouseEvent, f: string) => {
    e.preventDefault()
    const list = docsIn(f).map((d) => d.id)
    const up = parentOf(f)
    const into = (to: string) => folder({ action: 'rename', from: f, to: to ? `${to}/${leaf(f)}` : leaf(f) })
    setMenu({
      x: e.clientX, y: e.clientY, items: [
        { label: 'New note in this folder…', onClick: () => newNoteIn(f) },
        { label: 'New folder inside…', onClick: () => newFolderIn(f) },
        'separator',
        ...linkItems(data.folderLinks[f], (card) => folder({ action: 'link', path: f, card })),
        'separator',
        { label: 'Rename folder…', onClick: () => setNaming({ title: `Rename the folder ${leaf(f)}`, label: 'Folder name', value: leaf(f), onDone: (v) => folder({ action: 'rename', from: f, to: up ? `${up}/${v.replace(/\//g, '-')}` : v.replace(/\//g, '-') }) }) },
        { label: 'Move to folder', items: [
          { label: 'Top level', disabled: !up, onClick: () => into('') },
          ...folders.filter((x) => x !== up && x !== f && !x.startsWith(`${f}/`)).map((x) => ({ label: pathLabel(x), onClick: () => into(x) }))
        ] },
        { label: up ? `Take the notes out (into ${leaf(up)})` : 'Take the notes out (top level)', disabled: !list.length, onClick: () => moveTo(list, up) },
        'separator',
        { label: `Delete folder${countIn(f) ? ` (${countIn(f)} notes to History)` : ''}`, danger: true, hint: 'Ctrl+Z brings it back', onClick: () => folder({ action: 'delete', path: f }) }
      ]
    })
  }
  const clickDoc = (e: ReactMouseEvent, d: NoteDocView) => {
    if (e.ctrlKey || e.metaKey) { setSelected(toggle(selected, d.id)); setAnchor(d.id); return }
    if (e.shiftKey && anchor) {
      const a = flat.findIndex((x) => x.id === anchor)
      const b = flat.findIndex((x) => x.id === d.id)
      if (a >= 0 && b >= 0) { setSelected(new Set(flat.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id))); return }
    }
    setSelected(new Set([d.id])); setAnchor(d.id); go({ kind: 'doc', id: d.id })
  }
  const drag = (e: DragEvent, id: string) => { e.dataTransfer.setData('text/x-dz-notes', JSON.stringify(ids(id))); e.dataTransfer.effectAllowed = 'move' }
  // Drop notes or a folder onto a folder (or the Notes files heading = top level).
  const dropOn = (target: string) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('text/x-dz-notes') || e.dataTransfer.types.includes('text/x-dz-folder')) e.preventDefault() },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      const f = e.dataTransfer.getData('text/x-dz-folder')
      if (f) { if (f !== target && !target.startsWith(`${f}/`) && parentOf(f) !== target) folder({ action: 'rename', from: f, to: target ? `${target}/${leaf(f)}` : leaf(f) }); return }
      try { moveTo(JSON.parse(e.dataTransfer.getData('text/x-dz-notes')) as string[], target) } catch { /* not ours */ }
    }
  })

  /** One note in the list, with its headings when opened out. */
  const entry = (o: Open, title: string, sub: string, d?: NoteDocView) => {
    const key = keyOf(o)
    const heads = outline[key] ?? []
    return (
      <li key={key} draggable={!!d} onDragStart={d ? (e) => drag(e, d.id) : undefined} onContextMenu={d ? (e) => docMenu(e, d) : undefined}
        onAuxClick={(e) => { if (e.button === 1) go(o, -1, true) }}>
        <div className={`nb-row${same(open, o) ? ' is-cur' : ''}${d && selected.has(d.id) && selected.size > 1 ? ' is-sel' : ''}`}>
          {heads.length > 0
            ? <button className="nb-tog" aria-expanded={expanded.has(key)} aria-label={`${expanded.has(key) ? 'Close' : 'Open out'} the headings of ${title}`}
                onClick={() => setExpanded(toggle(expanded, key))}>{expanded.has(key) ? '▾' : '▸'}</button>
            : <span className="nb-tog" aria-hidden="true" />}
          {d && <CardIcon card={d.meta.card ? cardById.get(d.meta.card) : undefined} />}
          {d && renaming?.id === d.id
            ? <input autoFocus className="tree-rename" value={renaming.title} maxLength={200} aria-label="Note title"
                onChange={(e) => setRenaming({ id: d.id, title: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }}
                onBlur={() => { const t = renaming.title.trim(); if (t && t !== d.title) void act('notedoc:rename', { id: d.id, title: t }).then(load); setRenaming(null) }} />
            : <button className="nb-open" aria-current={same(open, o)} aria-selected={d ? selected.has(d.id) : undefined}
                onClick={(e) => (d ? clickDoc(e, d) : go(o))}>{title}{sub && <span className="nb-sub">{sub}</span>}</button>}
          {d && starred.has(d.id) && <span className="nb-star" title="Starred">★</span>}
        </div>
        {expanded.has(key) && heads.length > 0 && (
          <ul className="nb-heads">
            {heads.map((h, i) => <li key={i}><button className={h.level} onClick={() => go(o, i)}>{h.text}</button></li>)}
          </ul>
        )}
      </li>
    )
  }
  const docEntry = (d: NoteDocView) => entry({ kind: 'doc', id: d.id }, d.title, d.kind === 'word' ? '' : KIND_LABEL[d.kind], d)
  const running = data.sessions.some((x) => x.running)

  /** A folder's folders, then its notes; each folder opens and closes, right-click for more, drag to move. */
  const folderTree = (p: string): ReactNode[] => [
    ...subFolders(p).map((f) => {
      const card = data.folderLinks[f] ? cardById.get(data.folderLinks[f]) : undefined
      return (
        <li key={`folder:${f}`}>
          <button className="nb-folder" aria-expanded={!closedFolders.has(f)} onClick={() => setClosedFolders(toggle(closedFolders, f))} title={card ? `Linked to ${card.name}` : undefined}
            onContextMenu={(e) => folderMenu(e, f)} draggable onDragStart={(e) => { e.dataTransfer.setData('text/x-dz-folder', f); e.dataTransfer.effectAllowed = 'move' }} {...dropOn(f)}>
            <span className="nb-chev" aria-hidden="true">{closedFolders.has(f) ? '▸' : '▾'}</span>{card ? <CardIcon card={card} /> : <FolderIcon />}<span className="nb-fname">{leaf(f)}</span>
            <span className="nb-muted" style={{ marginLeft: 'auto' }}>{countIn(f)}</span>
          </button>
          {!closedFolders.has(f) && <ul className="nb-in">{folderTree(f)}</ul>}
        </li>
      )
    }),
    ...docsIn(p).map(docEntry)
  ]
  const tree = (
    <ul aria-multiselectable="true" aria-label="Notes" onKeyDown={(e) => { if (e.key === 'Delete' && selected.size && !renaming) void remove([...selected]) }}>
      <li className="nb-lsec nb-lsec-row" {...dropOn('')} title="Drop notes or folders here to put them at the top level">Notes files
        <button title="New folder at the top level" onClick={() => newFolderIn('')}>＋ Folder</button>
        <button title="New note at the top level" onClick={() => newNoteIn('')}>＋ Note</button></li>
      {data.docs.length === 0 && folders.length === 0 && <li className="nb-muted" style={{ padding: '0 6px' }}>None yet. Import notes or make a new one.</li>}
      {folderTree('')}
      <li className="nb-lsec">DM notes</li>
      {entry({ kind: 'master' }, 'Master notes', 'every note in one document')}
      {entry({ kind: 'dm' }, 'Between sessions', words(data.dmNotes) || 'empty')}
      {data.sessions.map((x) => entry({ kind: 'session', id: x.id }, sessionLabel(x.number, x.title, x.playDate ?? x.startedAt), x.running ? 'running now · on the desk' : words(x.dmNotes) || 'no notes'))}
    </ul>
  )
  const listOf = (idList: string[], empty: string) => {
    const list = idList.map((id) => data.docs.find((d) => d.id === id)).filter((d): d is NoteDocView => !!d)
    return list.length ? <ul>{list.map(docEntry)}</ul> : <p className="nb-muted" style={{ padding: '0 6px' }}>{empty}</p>
  }

  return (
    <div className={`nb${collapsed ? ' no-left' : ''}${doc ? '' : ' no-right'}`} data-nb-theme={theme}>
      <div className="nb-top">
        <div className="nb-nav">
          <button title={collapsed ? 'Show the notes list' : 'Hide the notes list'} aria-label={collapsed ? 'Show the notes list' : 'Hide the notes list'} onClick={() => collapse(!collapsed)}>{collapsed ? '»' : '«'}</button>
          <button title="Back" aria-label="Back" disabled={!nav.back.length} onClick={goBack}>←</button>
          <button title="Forward" aria-label="Forward" disabled={!nav.fwd.length} onClick={goFwd}>→</button>
        </div>
        <div className="nb-tabs" role="tablist" aria-label="Open notes">
          {nav.tabs.map((o, i) => (
            <div key={`${keyOf(o)}-${i}`} className={`nb-tab${i === nav.cur ? ' is-on' : ''}`} role="tab" aria-selected={i === nav.cur}
              onClick={() => { nav.cur = i; setJump(null); rerender((x) => x + 1) }} onAuxClick={(e) => { if (e.button === 1) closeTab(i) }}>
              <span>{tabTitle(o)}</span>
              {o.kind === 'doc' && <button title="Open in its own window" aria-label="Open in its own window" onClick={(e) => { e.stopPropagation(); void call('notes:popNote', { id: o.id }) }}>⧉</button>}
              <button title="Close tab" aria-label="Close tab" onClick={(e) => { e.stopPropagation(); closeTab(i) }}>×</button>
            </div>
          ))}
          <button className="nb-tab" title="New tab (then pick a note on the left)" aria-label="New tab" onClick={() => go(open, -1, true)}>+</button>
        </div>
        <div className="nb-topr">
          <button className="nb-btn" onClick={onImport}>Import notes…</button>
          <span>Page</span>
          <div className="nb-seg" role="group" aria-label="Page colours">
            <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Light</button>
            <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</button>
          </div>
        </div>
      </div>

      <aside className="nb-left" aria-label="Notes list">
        <div className="nb-ltools">
          <button aria-pressed={left === 'notes'} onClick={() => setLeft('notes')}>▤ Notes</button>
          <button aria-pressed={left === 'starred'} onClick={() => setLeft('starred')}>★ Starred</button>
          <button aria-pressed={left === 'recent'} onClick={() => setLeft('recent')}>◷ Recent</button>
        </div>
        <label className="nb-search"><span aria-hidden="true">⌕</span>
          <input type="search" value={q} placeholder="Search all notes" aria-label="Search all notes" onChange={(e) => setQ(e.target.value)} /></label>
        {edited.map((e) => (
          <div key={e.id} className="nb-edited" role="status">
            <strong>{e.title}</strong> changed in Word.{' '}
            <TakeEdit id={e.id} onDone={(changed) => { load(); go({ kind: 'doc', id: e.id }); if (changed.length) useBoard.setState({ message: { text: `${changed.length} changed part${changed.length === 1 ? '' : 's'} brought in.`, isError: false } }) }} onOpen={onOpen} />
          </div>
        ))}
        <div className="nb-tree">
          {hits ? (
            hits.length === 0 ? <p className="nb-muted">Nothing found.</p> : hits.map((h, i) => (
              <button key={i} className="nb-hit" onClick={() => go({ kind: 'doc', id: h.docId }, h.heading)}>
                <b>{h.title}{h.headingText ? ` › ${h.headingText}` : ''}</b>{h.text && <span>{h.text}</span>}
              </button>
            ))
          ) : left === 'starred' ? listOf(data.starred, 'No starred notes. Right-click a note › Star.')
            : left === 'recent' ? listOf(recent, 'Notes you open show here.') : tree}
          {selected.size > 1 && (
            <p className="nb-muted" role="status">{selected.size} selected. Right-click for Combine, Move to folder or Delete.{' '}
              <button className="link-button" onClick={() => setSelected(new Set())}>Clear</button></p>
          )}
        </div>
        <div className="nb-lfoot">
          {newTitle === null ? (
            <>
              <button className="nb-btn" onClick={() => setNewTitle('')}>New note</button>
              <ImportCharSheet />
              <OpenFolder sub="notes" label="Open notes folder" />
            </>
          ) : (
            <form className="row tight" onSubmit={(e) => { e.preventDefault(); void create() }}>
              <input autoFocus value={newTitle} maxLength={200} placeholder="Note title" aria-label="New note title" onChange={(e) => setNewTitle(e.target.value)} />
              <button type="submit" className="nb-btn is-pri" disabled={!newTitle.trim()}>Add</button>
              <button type="button" className="nb-btn" onClick={() => setNewTitle(null)}>Cancel</button>
            </form>
          )}
        </div>
      </aside>

      {doc ? (
        <NoteReader key={doc.id} doc={doc} docs={data.docs} jump={jump} folder={doc.folder} onChanged={load} onOpenDraft={onOpen}
          prev={at > 0 ? inFolder[at - 1] : undefined} next={at >= 0 && at < inFolder.length - 1 ? inFolder[at + 1] : undefined}
          onOpenDoc={(id, n = -1) => go({ kind: 'doc', id }, n)} />
      ) : (
        <section className="nb-mid nb-oldview">
          {open.kind === 'master' && <MasterNotes onOpen={(o) => go(o)} />}
          {open.kind === 'dm' && (
            <TextNote key="dm" title="DM notes between sessions" text={data.dmNotes} jump={jump}
              hint={running ? 'A session is running: the desk journal writes to that session’s notes.' : 'The desk journal shows these while no session runs.'}
              popout={!running} onSave={(text) => act('notes:set', { text }).then(load)} />
          )}
          {sess && (
            <TextNote key={sess.id} title={sessionLabel(sess.number, sess.title, sess.playDate ?? sess.startedAt)} text={sess.dmNotes} popout={sess.running} jump={jump}
              extra={<label className="row tight nb-date" title="The real-life date of this session (also on its prep sheet)">Played on
                <input type="date" value={sess.playDate ?? sess.startedAt.slice(0, 10)} onChange={(e) => void act('session:setDate', { number: sess.number, date: e.target.value || null }).then(load)} /></label>}
              hint={sess.running ? 'This session is running: the desk journal is these notes.' : 'DM notes from this session.'}
              below={<SessionSummaryBox id={sess.id} recap={sess.recap} onSaved={load} />} onSave={(text) => act('session:notes', { id: sess.id, text }).then(load)} />
          )}
          {open.kind === 'doc' && <p className="nb-muted">That note is gone (moved to History or undone).</p>}
        </section>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {naming && <NameDialog {...naming} onClose={() => setNaming(null)} />}
      {linking && <CardPicker title="Link to a card" cards={wordLinks?.cards ?? []} onClose={() => setLinking(null)} onPick={(id) => { linking.onPick(id); setLinking(null) }} />}
      {combining && <CombineDialog docs={combining.map((id) => data.docs.find((d) => d.id === id)).filter((d): d is NoteDocView => !!d)}
        onClose={() => setCombining(null)} onDone={(id) => { setCombining(null); setSelected(new Set()); load(); go({ kind: 'doc', id }) }} />}
    </div>
  )
}

/** Asks for a folder name (new folder, rename folder). */
function NameDialog({ title, label = 'Folder name', value, onDone, onClose }: { title: string; label?: string; value: string; onDone(v: string): void; onClose(): void }) {
  const [v, setV] = useState(value)
  return (
    <Dialog title={title} open onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onDone(v.trim()); onClose() } }}>
        <div className="field"><label htmlFor="dz-folder-name">{label}</label>
          <input id="dz-folder-name" autoFocus value={v} maxLength={200} onChange={(e) => setV(e.target.value)} /></div>
        <div className="dz-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="primary" disabled={!v.trim()}>OK</button></div>
      </form>
    </Dialog>
  )
}

/** Combine (owner, 1.7.0): order, title, and keep the originals or move them to History. */
function CombineDialog({ docs, onClose, onDone }: { docs: NoteDocView[]; onClose(): void; onDone(id: string): void }) {
  const act = useBoard((s) => s.act)
  const [order, setOrder] = useState(docs.filter((d) => d.kind !== 'picture'))
  const [title, setTitle] = useState('Combined notes')
  const [remove, setRemove] = useState(false)
  const pictures = docs.length - order.length
  const move = (k: number, by: number) => { const n = [...order]; [n[k], n[k + by]] = [n[k + by], n[k]]; setOrder(n) }
  return (
    <Dialog title="Combine notes" open onClose={onClose}>
      <p>A new Word note with each note under its own title, in this order.</p>
      <ol className="combine-list">
        {order.map((d, k) => (
          <li key={d.id}><span>{d.title}</span>
            <button className="ink-button" aria-label={`Move ${d.title} up`} disabled={k === 0} onClick={() => move(k, -1)}>↑</button>
            <button className="ink-button" aria-label={`Move ${d.title} down`} disabled={k === order.length - 1} onClick={() => move(k, 1)}>↓</button>
          </li>
        ))}
      </ol>
      {pictures > 0 && <p className="hint">{pictures} picture{pictures === 1 ? '' : 's'} left out: pictures can’t go into a Word note here.</p>}
      <div className="field"><label htmlFor="dz-combine-title">Title of the new note</label>
        <input id="dz-combine-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></div>
      <fieldset className="field">
        <legend>The original notes</legend>
        <label><input type="radio" name="dz-combine-keep" checked={!remove} onChange={() => setRemove(false)} /> Keep them as they are</label>
        <label><input type="radio" name="dz-combine-keep" checked={remove} onChange={() => setRemove(true)} /> Move them to History (Ctrl+Z undoes)</label>
      </fieldset>
      <div className="dz-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!title.trim() || order.length < 2} onClick={async () => {
          const id = await act('notedoc:combine', { ids: order.map((d) => d.id), title: title.trim(), removeOriginals: remove })
          if (id) onDone(id)
        }}>Combine</button>
      </div>
    </Dialog>
  )
}

/** The open note's contents: its headings, click to jump; Find headings when the note has none or misses some. */
function Contents({ heads, onJump, onFind }: { heads: Array<{ level: HeadingLevel; text: string }>; onJump(n: number): void; onFind?(): void }) {
  return (
    <nav className="parchment-note notes-toc" aria-label="Contents">
      <h3 className="side-h">Contents</h3>
      {heads.length === 0 ? <p className="ink-muted">No headings yet.</p> : (
        <ol>{heads.map((h, i) => <li key={i} className={`toc-${h.level}`}><button className="link-button" onClick={() => onJump(i)}>{h.text}</button></li>)}</ol>
      )}
      {onFind && <button className="ink-button" title="Looks for lines that read like headings (Chapter…, numbered, ALL CAPS, bold lines); you tick which to make headings" onClick={onFind}>Find headings…</button>}
    </nav>
  )
}

/** Find headings: the lines that look like headings, ticked; Make headings changes only the ticked ones (one undoable save). */
function FindHeadings({ found, onApply, onClose }: { found: Array<{ key: number; text: string; level: HeadingLevel }>; onApply(chosen: Map<number, HeadingLevel>): void; onClose(): void }) {
  const [chosen, setChosen] = useState(() => new Map(found.map((f) => [f.key, f.level])))
  return (
    <Dialog title="Find headings" open onClose={onClose}>
      {found.length === 0 ? <p>No lines that look like headings. Make headings yourself with the Title, Heading and Small heading buttons.</p> : (
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

function TakeEdit({ id, onDone, onOpen }: { id: string; onDone(changed: string[]): void; onOpen(d: ImportDraft): void }) {
  const [changed, setChanged] = useState<string[] | null>(null)
  return (
    <>
      <button className="link-button" onClick={async () => {
        const r = await useBoard.getState().act('notedoc:takeEdit', { id })
        if (r) { onDone(r.changed); if (r.changed.length) setChanged(r.changed) }
      }}>Bring in the changes</button>
      {changed && <UpdateCards id={id} lines={changed} onClose={() => setChanged(null)} onOpen={onOpen} />}
    </>
  )
}

function TextNote({ title, text, hint, below, popout, jump, onSave, extra }: {
  title: string; text: string; hint: string; below?: ReactNode; popout: boolean; jump: Jump; onSave(text: string): Promise<unknown>; extra?: ReactNode
}) {
  const [draft, setDraft] = useState(text)
  const [finding, setFinding] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setDraft(text), [text])
  const save = () => { if (draft !== text) void onSave(draft) }
  const lines = draft.split('\n')
  const heads = lines.flatMap((l, line) => { const m = /^(#{1,3}) +(.+)$/.exec(l); return m ? [{ level: `h${m[1].length}` as HeadingLevel, text: m[2].trim(), line }] : [] })
  // Scrolls the text box to a line: measure with the text up to it, then put the whole text back.
  const toLine = (line: number) => {
    const ta = area.current
    if (!ta) return
    const pos = lines.slice(0, line).join('\n').length + (line ? 1 : 0)
    ta.value = draft.slice(0, pos)
    ta.scrollTop = ta.scrollHeight
    const top = ta.scrollTop
    ta.value = draft
    ta.scrollTop = top ? top + ta.clientHeight - 40 : 0
    ta.focus({ preventScroll: true })
    ta.setSelectionRange(pos, pos)
  }
  const jumpTo = (n: number) => { const h = heads[n]; if (h) toLine(h.line) }
  useEffect(() => { if (jump) jumpTo(jump.n) }, [jump]) // eslint-disable-line react-hooks/exhaustive-deps
  const found = lines.flatMap((l, key) => {
    if (/^\s*(#|[-*] )/.test(l)) return []
    const level = headingLevel(l)
    return level ? [{ key, text: l.trim(), level }] : []
  })
  return (
    <div className="notes-with-toc">
      <div className="parchment-sheet notes-text">
        <div className="notes-head">
          <h2 className="panel-title">{title}</h2>
          <span className="row tight wrap">
            {extra}
            {popout && <PopOut title="Open these notes in their own window; drag it to another screen" onClick={() => void call('notes:popout', undefined)} />}
            <button className="ink-button" onClick={async () => { const p = await call('file:saveDocx', { name: title.replace(/[^\w\s-]/g, ''), text: draft }).catch(() => null); if (p) useBoard.getState().say(`Saved ${p}`) }}>Save as Word…</button>
          </span>
        </div>
        <p className="ink-muted">{hint} Saved when you click away; Ctrl+Z undoes. Lines starting with # are headings.</p>
        {below}
        {below && <h3 className="side-h">DM notes</h3>}
        <textarea ref={area} className="journal-text notes-textarea" value={draft} aria-label={title} onChange={(e) => setDraft(e.target.value)} onBlur={save} />
      </div>
      <Contents heads={heads} onJump={jumpTo} onFind={() => setFinding(true)} />
      {finding && <FindHeadings found={found} onClose={() => setFinding(false)} onApply={(chosen) => {
        const next = lines.map((l, k) => { const lv = chosen.get(k); return lv ? `${'#'.repeat(Number(lv[1]))} ${l.trim()}` : l }).join('\n')
        setDraft(next); void onSave(next)
      }} />}
    </div>
  )
}

/** Notes › a session: its summary (the session's "What happened"), editable, with Fill from the session and Write with AI. */
function SessionSummaryBox({ id, recap, onSaved }: { id: string; recap: string; onSaved(): void }) {
  const act = useBoard((s) => s.act)
  const [draft, setDraft] = useState(recap)
  useEffect(() => setDraft(recap), [recap])
  const save = (text: string) => { setDraft(text); if (text !== recap) void act('session:update', { id, patch: { recap: text } }).then(onSaved) }
  return (
    <div className="session-summary">
      <h3 className="side-h">Summary</h3>
      <textarea className="notes-summary" rows={4} value={draft} aria-label="Session summary" placeholder="What happened this session: the same text as in Review and on the prep sheet."
        onChange={(e) => setDraft(e.target.value)} onBlur={() => save(draft)} />
      <SummaryTools sessionId={id} value={draft} onSave={save} />
    </div>
  )
}

type Section = IpcOutputs['notes:master'][number]

/** Blocks back to the plain text the DM and session notes keep ("# " headings, "- " lists). */
const blocksToText = (blocks: Block[]) => blocks.map((b) => {
  if (b.kind === 'table' || b.kind === 'pic' || b.kind === 'stat') return blockLines([b]).join('\n')
  const t = b.runs.map((r) => r.text).join('')
  return b.kind === 'h1' ? `# ${t}` : b.kind === 'h2' ? `## ${t}` : b.kind === 'h3' ? `### ${t}` : b.kind === 'bullet' ? `- ${t}` : b.kind === 'number' ? `1. ${t}` : t
}).join('\n\n')

/**
 * Notes › Master notes (owner, 1.6.0): every note as one long document. Contents down the side
 * (each note and its headings), search, edit a section in place. A section ticked "Linked" is the
 * note itself, so edits go both ways; unticked, the master keeps its own copy.
 */
function MasterNotes({ onOpen }: { onOpen(o: Open): void }) {
  const { act, say, view } = useBoard()
  const [secs, setSecs] = useState<Section[] | null>(null)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const ed = useRef<NoteEditorHandle>(null)
  const load = useCallback(() => { void call('notes:master', undefined).then(setSecs).catch(() => setSecs([])) }, [])
  useEffect(load, [load, view?.undo])
  if (!secs) return <p className="ink-muted">Loading…</p>
  const lower = q.trim().toLowerCase()
  const shown = lower ? secs.filter((s) => `${s.title}\n${blockLines(s.blocks).join('\n')}`.toLowerCase().includes(lower)) : secs
  const headings = (s: Section) => s.blocks.filter((b) => b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3')
    .map((b) => ({ level: b.kind, text: 'runs' in b ? b.runs.map((r) => r.text).join('') : '' }))
  const jump = (id: string, n = -1) => {
    const el = document.getElementById(`m-${id}`)
    const target = n < 0 ? el : el?.querySelectorAll('.note-page h1, .note-page h2, .note-page h3')[n]
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const save = async (s: Section) => {
    const blocks = ed.current?.blocks() ?? []
    if (!s.linked) await act('notes:masterSave', { section: s.id, blocks })
    else if (s.kind === 'dm') await act('notes:set', { text: blocksToText(blocks) })
    else if (s.kind === 'session') await act('session:notes', { id: s.id.slice(8), text: blocksToText(blocks) })
    else await act('notedoc:save', { id: s.id.slice(4), blocks })
    setEditing(null)
    say(s.linked ? `Saved to ${s.title} too` : 'Saved in the master only')
  }
  return (
    <div className="master-notes">
      <nav className="parchment-note master-toc" aria-label="Contents">
        <input type="search" value={q} placeholder="Search all notes" aria-label="Search all notes" onChange={(e) => setQ(e.target.value)} />
        {lower && <p className="ink-muted">{shown.length} of {secs.length} notes match</p>}
        <ol>
          {shown.map((s) => (
            <li key={s.id}>
              <button className="link-button" onClick={() => jump(s.id)}>{s.title}</button>
              {headings(s).length > 0 && <ol>{headings(s).map((h, i) => (
                <li key={i} className={`toc-${h.level}`}><button className="link-button" onClick={() => jump(s.id, i)}>{h.text}</button></li>
              ))}</ol>}
            </li>
          ))}
        </ol>
        <div className="row tight wrap">
          <button className="ink-button" onClick={async () => { const f = await act('notes:masterDocx', undefined); if (f) say(`Saved ${f}`) }}>Save as Word…</button>
        </div>
        <p className="hint">In Word, the headings show in the Navigation pane.</p>
      </nav>
      <div className="master-doc">
        {shown.map((s) => (
          <section key={s.id} id={`m-${s.id}`} className="parchment-sheet master-section">
            <div className="row spread wrap">
              <h2 className="panel-title">{s.title}</h2>
              <span className="row tight wrap">
                <label className="field checkbox" title={s.linked ? 'Edits here change the note, and the note shows here' : 'The master keeps its own copy; the note is not changed'}>
                  <input type="checkbox" checked={s.linked} onChange={(e) => void act('notes:masterLink', { section: s.id, linked: e.target.checked })} /> Linked to the note
                </label>
                {!s.picture && (editing === s.id
                  ? <><button className="ink-button primary-ink" onClick={() => void save(s)}>Save</button><button className="ink-button" onClick={() => setEditing(null)}>Cancel</button></>
                  : <button className="ink-button" onClick={() => setEditing(s.id)}>Edit</button>)}
                <button className="link-button" onClick={() => onOpen(s.kind === 'dm' ? { kind: 'dm' } : s.kind === 'session' ? { kind: 'session', id: s.id.slice(8) } : { kind: 'doc', id: s.id.slice(4) })}>Open the note</button>
              </span>
            </div>
            {s.picture ? <img className="notes-picture" src={s.picture} alt={s.title} />
              : editing === s.id ? <NoteEditor ref={ed} initial={s.blocks} label={s.title} onDirty={() => undefined} />
                : s.blocks.length ? <NoteEditor initial={s.blocks} readOnly label={s.title} onDirty={() => undefined} /> : <p className="ink-muted">Empty.</p>}
          </section>
        ))}
      </div>
    </div>
  )
}
