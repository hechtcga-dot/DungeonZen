import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import { NoteEditor, type NoteEditorHandle } from './NoteEditor'
import { useSidePanel } from './Splitter'
import { CharSheetDialog } from './CharSheetDialog'
import type { ImportDraft } from '../../shared/notesImport'
import type { NoteDocView, NotesScreenView } from '../../shared/types'
import { OpenFolder } from './OpenFolder'
import { ImportCharSheet } from './ImportCharSheet'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { blockLines, guessHeadings, headingLevel, type Block, type HeadingLevel } from '../../shared/noteDoc'
import type { IpcOutputs } from '../../shared/ipc'

type Open = { kind: 'master' } | { kind: 'dm' } | { kind: 'session'; id: string } | { kind: 'doc'; id: string }
type Outline = IpcOutputs['notes:outline']
/** Jump to the n-th heading of the open note (nonce: jump again to the same one). */
type Jump = { n: number; nonce: number } | null
const KIND_LABEL: Record<NoteDocView['kind'], string> = { word: 'Word', pdf: 'PDF', text: 'Text', picture: 'Picture' }
const LEVEL_LABEL: Record<HeadingLevel, string> = { h1: 'Title', h2: 'Heading', h3: 'Small heading' }
const when = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
const keyOf = (o: Open) => (o.kind === 'session' ? `session:${o.id}` : o.kind === 'doc' ? `doc:${o.id}` : o.kind)
const words = (t: string) => (t.trim() ? `${t.trim().split(/\s+/).length} words` : '')
const COLLAPSE_KEY = 'dz-notes-list-collapsed'

/**
 * Notes › Your notes (Campfire-style list, owner 1.7.0): Master notes, the DM notes, each session's notes and
 * every notes file, in the DM's folders. Each note opens out to its headings (click to jump). Notes files:
 * Ctrl/Shift+click to select several, right-click for Open file location, Rename, Duplicate, Combine, folders, Delete.
 */
export function NotesLibrary({ onOpen, onImport }: { onOpen(d: ImportDraft): void; onImport(): void }) {
  const side = useSidePanel('notes-list', 'left', 300)
  const { query, act, view, say } = useBoard()
  const [data, setData] = useState<NotesScreenView | null>(null)
  const [outline, setOutline] = useState<Outline>({})
  const [open, setOpen] = useState<Open>(() => {
    const id = useBoard.getState().notesOpenId
    useBoard.setState({ notesOpenId: null })
    return id ? { kind: 'doc', id } : { kind: 'dm' }
  })
  const [jump, setJump] = useState<Jump>(null)
  const [edited, setEdited] = useState<Array<{ id: string; title: string }>>([])
  const [newTitle, setNewTitle] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [closedFolders, setClosedFolders] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [naming, setNaming] = useState<{ title: string; value: string; onDone(v: string): void } | null>(null)
  const [combining, setCombining] = useState<string[] | null>(null)
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } })
  const load = useCallback(() => {
    void query('notes:screen', undefined).then((d) => { if (d) setData(d) })
    void query('notedoc:edited', undefined).then((e) => setEdited(e ?? []))
    void query('notes:outline', undefined).then((o) => { if (o) setOutline(o) })
  }, [query])
  useEffect(load, [load, view?.undo])
  // Coming back from Word: look for changes.
  useEffect(() => { window.addEventListener('focus', load); return () => window.removeEventListener('focus', load) }, [load])

  const collapse = (v: boolean) => { setCollapsed(v); try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0') } catch { /* per-viewer convenience only */ } }
  const create = async () => {
    const title = newTitle?.trim()
    if (!title) return
    const id = await act('notedoc:create', { title })
    setNewTitle(null)
    if (id) { load(); setOpen({ kind: 'doc', id }) }
  }
  if (!data) return <p className="ink-muted page-pad">Loading…</p>
  const doc = open.kind === 'doc' ? data.docs.find((d) => d.id === open.id) : undefined
  const sess = open.kind === 'session' ? data.sessions.find((x) => x.id === open.id) : undefined

  const folders = [...new Set(data.docs.map((d) => d.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const groups: Array<[string, NoteDocView[]]> = [...folders.map((f) => [f, data.docs.filter((d) => d.folder === f)] as [string, NoteDocView[]]), ['', data.docs.filter((d) => !d.folder)]]
  const flat = groups.flatMap(([f, docs]) => (f && closedFolders.has(f) ? [] : docs))
  const toggle = (set: Set<string>, key: string) => { const n = new Set(set); if (n.has(key)) n.delete(key); else n.add(key); return n }
  const openAt = (o: Open, n = -1) => { setOpen(o); setJump(n < 0 ? null : { n, nonce: Date.now() }); if (o.kind !== 'doc') setSelected(new Set()) }
  const ids = (id: string) => (selected.has(id) ? [...selected] : [id])
  const remove = async (list: string[]) => {
    for (const id of list) await act('notedoc:setStatus', { id, status: 'defunct' })
    setSelected(new Set()); load()
    say(`${list.length === 1 ? 'Note' : `${list.length} notes`} moved to History. Ctrl+Z brings ${list.length === 1 ? 'it' : 'the last one'} back.`)
  }
  const moveTo = (list: string[], folder: string) => void act('notedoc:setFolder', { ids: list, folder }).then(load)
  const newFolder = (list: string[]) => setNaming({ title: 'New folder', value: '', onDone: (v) => moveTo(list, v) })
  const folderItems = (list: string[]): MenuItem[] => [
    ...folders.map((f) => ({ label: f, onClick: () => moveTo(list, f) })),
    ...(folders.length ? ['separator' as const] : []),
    { label: 'New folder…', onClick: () => newFolder(list) },
    { label: 'No folder', onClick: () => moveTo(list, ''), disabled: list.every((id) => !data.docs.find((d) => d.id === id)?.folder) }
  ]
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
        { label: 'Open', onClick: () => openAt({ kind: 'doc', id: d.id }) },
        { label: 'Open file location', hint: 'Shows the file in Windows Explorer', onClick: () => void act('notedoc:showInFolder', { id: d.id }) },
        'separator',
        { label: 'Rename', onClick: () => setRenaming({ id: d.id, title: d.title }) },
        { label: 'Duplicate', onClick: () => void act('notedoc:duplicate', { id: d.id }).then((id) => { load(); if (id) openAt({ kind: 'doc', id }) }) },
        ...(d.kind !== 'picture' ? [{ label: 'Save a copy as Word…', onClick: () => void act('notedoc:saveCopy', { id: d.id }).then((p) => { if (p) say(`Saved ${p}`) }) }] : []),
        { label: 'Move to folder', items: folderItems(list) },
        'separator',
        { label: 'Delete (to History)', danger: true, onClick: () => void remove(list) }
      ]
    })
  }
  const folderMenu = (e: ReactMouseEvent, f: string) => {
    e.preventDefault()
    const list = data.docs.filter((d) => d.folder === f).map((d) => d.id)
    setMenu({
      x: e.clientX, y: e.clientY, items: [
        { label: 'Rename folder…', onClick: () => setNaming({ title: `Rename the folder ${f}`, value: f, onDone: (v) => moveTo(list, v) }) },
        { label: 'Take the notes out of this folder', onClick: () => moveTo(list, '') }
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
    setSelected(new Set([d.id])); setAnchor(d.id); openAt({ kind: 'doc', id: d.id })
  }
  const drag = (e: DragEvent, id: string) => { e.dataTransfer.setData('text/x-dz-notes', JSON.stringify(ids(id))); e.dataTransfer.effectAllowed = 'move' }
  const dropOn = (folder: string) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('text/x-dz-notes')) e.preventDefault() },
    onDrop: (e: DragEvent) => { e.preventDefault(); try { moveTo(JSON.parse(e.dataTransfer.getData('text/x-dz-notes')) as string[], folder) } catch { /* not ours */ } }
  })

  /** One note in the list, with its headings when opened out. */
  const entry = (o: Open, title: string, sub: string, extra: Partial<{ doc: NoteDocView }> = {}) => {
    const key = keyOf(o)
    const heads = outline[key] ?? []
    const d = extra.doc
    return (
      <li key={key} className={`tree-item${d && selected.has(d.id) ? ' is-selected' : ''}`} draggable={!!d}
        onDragStart={d ? (e) => drag(e, d.id) : undefined} onContextMenu={d ? (e) => docMenu(e, d) : undefined}>
        <div className="tree-row">
          {heads.length > 0
            ? <button className="tree-toggle" aria-expanded={expanded.has(key)} aria-label={`${expanded.has(key) ? 'Close' : 'Open out'} the headings of ${title}`}
                onClick={() => setExpanded(toggle(expanded, key))}>{expanded.has(key) ? '▾' : '▸'}</button>
            : <span className="tree-toggle" aria-hidden="true" />}
          {d && renaming?.id === d.id
            ? <input autoFocus className="tree-rename" value={renaming.title} maxLength={200} aria-label="Note title"
                onChange={(e) => setRenaming({ id: d.id, title: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null) }}
                onBlur={() => { const t = renaming.title.trim(); if (t && t !== d.title) void act('notedoc:rename', { id: d.id, title: t }).then(load); setRenaming(null) }} />
            : <button aria-current={keyOf(open) === key} aria-selected={d ? selected.has(d.id) : undefined}
                onClick={(e) => (d ? clickDoc(e, d) : openAt(o))}>{title}<span className="ink-muted">{sub}</span></button>}
        </div>
        {expanded.has(key) && heads.length > 0 && (
          <ol className="tree-heads">
            {heads.map((h, i) => <li key={i} className={`toc-${h.level}`}><button className="link-button" onClick={() => openAt(o, i)}>{h.text}</button></li>)}
          </ol>
        )}
      </li>
    )
  }
  const running = data.sessions.some((x) => x.running)

  if (collapsed) {
    return (
      <div className="notes-lib is-collapsed">
        <aside className="parchment-note notes-list notes-list-collapsed">
          <button className="ink-button" title="Show the notes list" aria-label="Show the notes list" onClick={() => collapse(false)}>»</button>
        </aside>
        <section className="notes-view">{view2()}</section>
      </div>
    )
  }
  function view2() {
    return (
      <>
        {open.kind === 'master' && <MasterNotes onOpen={(o) => setOpen(o)} />}
        {open.kind === 'dm' && (
          <TextNote key="dm" title="DM notes between sessions" text={data!.dmNotes} jump={jump}
            hint={running ? 'A session is running: the desk journal writes to that session’s notes.' : 'The desk journal shows these while no session runs.'}
            popout={!running} onSave={(text) => act('notes:set', { text }).then(load)} />
        )}
        {sess && (
          <TextNote key={sess.id} title={`Session ${sess.number} · ${when(sess.startedAt)}`} text={sess.dmNotes} popout={sess.running} jump={jump}
            hint={sess.running ? 'This session is running: the desk journal is these notes.' : 'DM notes from this session.'}
            recap={sess.recap} onSave={(text) => act('session:notes', { id: sess.id, text }).then(load)} />
        )}
        {doc && <DocNote key={doc.id} doc={doc} docs={data!.docs} jump={jump} onOpenDraft={onOpen} onChanged={load} />}
        {open.kind === 'doc' && !doc && <p className="ink-muted">That note is gone (moved to History or undone).</p>}
      </>
    )
  }

  return (
    <div className="notes-lib" style={side.style}>
      <aside className="parchment-note notes-list">
        {side.grip}
        <div className="row spread">
          <h2 className="panel-title">Your notes</h2>
          <button className="ink-button" title="Hide the notes list" aria-label="Hide the notes list" onClick={() => collapse(true)}>«</button>
        </div>
        {edited.map((e) => (
          <div key={e.id} className="notes-edited" role="status">
            <strong>{e.title}</strong> changed in Word.
            <TakeEdit id={e.id} onDone={(changed) => { load(); setOpen({ kind: 'doc', id: e.id }); if (changed.length) useBoard.setState({ message: { text: `${changed.length} changed part${changed.length === 1 ? '' : 's'} brought in.`, isError: false } }) }} onOpen={onOpen} />
          </div>
        ))}
        <ul className="notes-items">
          <li><button aria-current={open.kind === 'master'} onClick={() => setOpen({ kind: 'master' })}>Master notes<span className="ink-muted">every note in one document, with contents and search</span></button></li>
        </ul>
        <h3 className="tree-h">DM notes</h3>
        <ul className="notes-items">
          {entry({ kind: 'dm' }, 'Between sessions', words(data.dmNotes) || 'empty')}
          {data.sessions.map((x) => entry({ kind: 'session', id: x.id }, `Session ${x.number} · ${when(x.startedAt)}`,
            x.running ? 'running now · on the desk' : words(x.dmNotes) || 'no notes'))}
        </ul>
        <h3 className="tree-h" {...dropOn('')} title="Drop notes here to take them out of their folder">Notes files</h3>
        {data.docs.length === 0 && <p className="ink-muted">None yet. Files you import from now on are kept here, and you can write new ones.</p>}
        <ul className="notes-items" aria-multiselectable="true" aria-label="Notes files"
          onKeyDown={(e) => { if (e.key === 'Delete' && selected.size && !renaming) void remove([...selected]) }}>
          {groups.map(([f, docs]) => {
            const items = docs.map((d) => entry({ kind: 'doc', id: d.id }, d.title,
              `${KIND_LABEL[d.kind]} · ${when(d.updatedAt)}${d.versions.length ? ` · ${d.versions.length + 1} versions` : ''}`, { doc: d }))
            if (!f) return items
            return (
              <li key={`folder:${f}`} className="tree-folder">
                <button className="tree-folder-h" aria-expanded={!closedFolders.has(f)} onClick={() => setClosedFolders(toggle(closedFolders, f))}
                  onContextMenu={(e) => folderMenu(e, f)} {...dropOn(f)}>
                  <span aria-hidden="true">{closedFolders.has(f) ? '▸' : '▾'} 📁</span> {f} <span className="ink-muted">{docs.length}</span>
                </button>
                {!closedFolders.has(f) && <ul className="notes-items tree-in">{items}</ul>}
              </li>
            )
          })}
        </ul>
        {selected.size > 1 && (
          <p className="ink-muted notes-hint" role="status">{selected.size} selected. Right-click for Combine, Move to folder or Delete.
            <button className="link-button" onClick={() => setSelected(new Set())}>Clear</button></p>
        )}
        {newTitle === null ? (
          <div className="row tight wrap">
            <button className="ink-button" onClick={() => setNewTitle('')}>New note</button>
            <button className="ink-button" onClick={onImport}>Import notes…</button>
            <ImportCharSheet />
            <OpenFolder sub="notes" label="Open notes folder" />
          </div>
        ) : (
          <form className="row tight" onSubmit={(e) => { e.preventDefault(); void create() }}>
            <input autoFocus value={newTitle} maxLength={200} placeholder="Note title" aria-label="New note title" onChange={(e) => setNewTitle(e.target.value)} />
            <button type="submit" className="primary" disabled={!newTitle.trim()}>Add</button>
            <button type="button" onClick={() => setNewTitle(null)}>Cancel</button>
          </form>
        )}
        <p className="ink-muted notes-hint">Ctrl+click or Shift+click selects several notes files; right-click for more; drag them onto a folder.</p>
      </aside>
      <section className="notes-view">{view2()}</section>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {naming && <NameDialog {...naming} onClose={() => setNaming(null)} />}
      {combining && <CombineDialog docs={combining.map((id) => data.docs.find((d) => d.id === id)).filter((d): d is NoteDocView => !!d)}
        onClose={() => setCombining(null)} onDone={(id) => { setCombining(null); setSelected(new Set()); load(); openAt({ kind: 'doc', id }) }} />}
    </div>
  )
}

/** Asks for a folder name (new folder, rename folder). */
function NameDialog({ title, value, onDone, onClose }: { title: string; value: string; onDone(v: string): void; onClose(): void }) {
  const [v, setV] = useState(value)
  return (
    <Dialog title={title} open onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) { onDone(v.trim()); onClose() } }}>
        <div className="field"><label htmlFor="dz-folder-name">Folder name</label>
          <input id="dz-folder-name" autoFocus value={v} maxLength={80} onChange={(e) => setV(e.target.value)} /></div>
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

/** "Notes changed: update cards?" The AI reads only the changed parts and proposes card changes (nothing changes until approved). */
function UpdateCards({ id, lines, onClose, onOpen }: { id: string; lines: string[]; onClose(): void; onOpen(d: ImportDraft): void }) {
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

function TextNote({ title, text, hint, recap, popout, jump, onSave }: {
  title: string; text: string; hint: string; recap?: string; popout: boolean; jump: Jump; onSave(text: string): Promise<unknown>
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
            {popout && <button className="ink-button" title="Open these notes in their own window; drag it to another screen" onClick={() => void call('notes:popout', undefined)}>Pop out</button>}
            <button className="ink-button" onClick={async () => { const p = await call('file:saveDocx', { name: title.replace(/[^\w\s-]/g, ''), text: draft }).catch(() => null); if (p) useBoard.getState().say(`Saved ${p}`) }}>Save as Word…</button>
          </span>
        </div>
        <p className="ink-muted">{hint} Saved when you click away; Ctrl+Z undoes. Lines starting with # are headings.</p>
        <textarea ref={area} className="journal-text notes-textarea" value={draft} aria-label={title} onChange={(e) => setDraft(e.target.value)} onBlur={save} />
        {recap?.trim() && (
          <details className="notes-recap"><summary>Session recap</summary><p className="selectable">{recap}</p></details>
        )}
      </div>
      <Contents heads={heads} onJump={jumpTo} onFind={() => setFinding(true)} />
      {finding && <FindHeadings found={found} onClose={() => setFinding(false)} onApply={(chosen) => {
        const next = lines.map((l, k) => { const lv = chosen.get(k); return lv ? `${'#'.repeat(Number(lv[1]))} ${l.trim()}` : l }).join('\n')
        setDraft(next); void onSave(next)
      }} />}
    </div>
  )
}

function DocNote({ doc, docs, jump, onOpenDraft, onChanged }: { doc: NoteDocView; docs: NoteDocView[]; jump: Jump; onOpenDraft(d: ImportDraft): void; onChanged(): void }) {
  const { act, say } = useBoard()
  const [content, setContent] = useState<{ blocks: Block[]; url: string | null } | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [changed, setChanged] = useState<string[] | null>(null)
  const [title, setTitle] = useState(doc.title)
  const [making, setMaking] = useState(false)
  const [heads, setHeads] = useState<Array<{ level: HeadingLevel; text: string }>>([])
  const [finding, setFinding] = useState<Array<{ key: number; text: string; level: HeadingLevel }> | null>(null)
  const editor = useRef<NoteEditorHandle>(null)
  const wrap = useRef<HTMLDivElement>(null)
  useEffect(() => { void call('notedoc:content', { id: doc.id }).then(setContent).catch((e) => setError((e as Error).message)) }, [doc.id, doc.updatedAt])
  useEffect(() => setTitle(doc.title), [doc.title])
  const headEls = () => [...(wrap.current?.querySelectorAll<HTMLElement>('.note-page h1, .note-page h2, .note-page h3') ?? [])]
  const readHeads = () => setHeads(headEls().map((h) => ({ level: h.tagName.toLowerCase() as HeadingLevel, text: h.textContent?.trim() ?? '' })).filter((h) => h.text))
  const jumpTo = (n: number) => headEls().filter((h) => h.textContent?.trim())[n]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  useEffect(() => { if (!content) return; readHeads(); if (jump) requestAnimationFrame(() => jumpTo(jump.n)) }, [content, jump]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (blocks = editor.current?.blocks() ?? []) => {
    const r = await act('notedoc:save', { id: doc.id, blocks })
    if (!r) return
    setDirty(false)
    onChanged()
    if (r.changed.length) setChanged(r.changed)
    else say('Saved. Nothing new for the cards.')
  }
  const isText = doc.kind !== 'picture'
  return (
    <div className="notes-with-toc">
      <div className="parchment-sheet notes-doc">
        <div className="notes-head">
          <input className="notes-title" value={title} aria-label="Note title" maxLength={200} onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title.trim() && title.trim() !== doc.title) void act('notedoc:rename', { id: doc.id, title: title.trim() }).then(onChanged); else setTitle(doc.title) }} />
          <span className="row tight wrap">
            {isText && <button className="primary" disabled={!dirty} onClick={() => void save()} title="Saves a Word version; earlier versions stay below">Save</button>}
            <button className="ink-button" onClick={() => void act('notedoc:openInWord', { id: doc.id }).then(() => {
              if (doc.kind === 'word') say('Opened in Word. Save there; when you come back, Dungeon Zen offers to bring the changes in.')
            })}>{doc.kind === 'word' ? 'Open in Word' : doc.kind === 'pdf' ? 'Open the PDF' : doc.kind === 'picture' ? 'Open the picture' : 'Open the file'}</button>
            <button className="ink-button" title="Shows the file in Windows Explorer" onClick={() => void act('notedoc:showInFolder', { id: doc.id })}>Open file location</button>
            <button className="ink-button" title="A new copy of the file; this one stays under Earlier versions" onClick={async () => { const r = await act('notedoc:reimport', { id: doc.id }); if (r) { onChanged(); if (r.changed.length) setChanged(r.changed); else say('Re-imported. Nothing new for the cards.') } }}>Re-import file…</button>
            {isText && <button className="ink-button" title="The AI reads the whole note again and proposes card changes" onClick={async () => { const l = await act('notedoc:allLines', { id: doc.id }); if (l?.length) setChanged(l) }}>Read again with AI…</button>}
            <button className="ink-button" title="The AI copies a character sheet (and its other files) into a character card" onClick={() => setMaking(true)}>Make a character card…</button>
            {isText && <button className="ink-button" onClick={async () => { const p = await act('notedoc:saveCopy', { id: doc.id }); if (p) say(`Saved ${p}`) }}>Save a copy as Word…</button>}
            <button className="ink-button danger-ink" onClick={() => void act('notedoc:setStatus', { id: doc.id, status: 'defunct' }).then(onChanged)}>Delete (to History)</button>
          </span>
        </div>
        <p className="ink-muted">From {doc.originalName}. {doc.kind === 'word' || doc.kind === 'text' ? 'Edit it here (Save writes a Word file) or in Word.' : doc.kind === 'pdf' ? 'The PDF’s text: edit it here and Save to make a Word version.' : ''}</p>
        {error && <p className="field-error" role="alert">{error}</p>}
        <div ref={wrap}>
          {content && (doc.kind === 'picture'
            ? <img className="notes-picture" src={content.url ?? ''} alt={doc.title} />
            : <NoteEditor ref={editor} initial={content.blocks} label={doc.title} onDirty={() => { setDirty(true); readHeads() }} />)}
        </div>
        {doc.versions.length > 0 && (
          <details className="notes-versions">
            <summary>Earlier versions ({doc.versions.length})</summary>
            <ul>
              {doc.versions.map((v) => (
                <li key={v.file}>{new Date(v.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  <button className="link-button" onClick={() => void act('notedoc:restore', { id: doc.id, file: v.file }).then(onChanged)}>Bring back</button></li>
              ))}
            </ul>
          </details>
        )}
        {making && <CharSheetDialog doc={doc} docs={docs} onClose={() => setMaking(false)} />}
        {changed && <UpdateCards id={doc.id} lines={changed} onClose={() => setChanged(null)} onOpen={onOpenDraft} />}
      </div>
      {isText && <Contents heads={heads} onJump={jumpTo}
        onFind={() => setFinding(guessHeadings(editor.current?.blocks() ?? []).map((g) => ({ key: g.index, text: g.text, level: g.level })))} />}
      {finding && <FindHeadings found={finding} onClose={() => setFinding(null)} onApply={(chosen) => {
        const blocks = (editor.current?.blocks() ?? []).map((b, k) => { const lv = chosen.get(k); return lv && b.kind !== 'table' ? { ...b, kind: lv } : b })
        void save(blocks)
      }} />}
    </div>
  )
}

type Section = IpcOutputs['notes:master'][number]

/** Blocks back to the plain text the DM and session notes keep ("# " headings, "- " lists). */
const blocksToText = (blocks: Block[]) => blocks.map((b) => {
  if (b.kind === 'table') return blockLines([b]).join('\n')
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
    .map((b) => ({ level: b.kind, text: b.kind === 'table' ? '' : b.runs.map((r) => r.text).join('') }))
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
