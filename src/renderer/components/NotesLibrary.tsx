import { useCallback, useEffect, useRef, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import { NoteEditor, type NoteEditorHandle } from './NoteEditor'
import { useSidePanel } from './Splitter'
import { CharSheetDialog } from './CharSheetDialog'
import type { ImportDraft } from '../../shared/notesImport'
import type { NoteDocView, NotesScreenView } from '../../shared/types'
import type { Block } from '../../shared/noteDoc'

type Open = { kind: 'dm' } | { kind: 'session'; id: string } | { kind: 'doc'; id: string }
const KIND_LABEL: Record<NoteDocView['kind'], string> = { word: 'Word', pdf: 'PDF', text: 'Text', picture: 'Picture' }
const when = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Notes › Your notes: the DM notes (between sessions), each session's notes, and every notes file
 * kept in the campaign. Files open with their formatting; edit here or in Word; changes can update cards.
 */
export function NotesLibrary({ onOpen, onImport }: { onOpen(d: ImportDraft): void; onImport(): void }) {
  const side = useSidePanel('notes-list', 'left', 300)
  const { query, act, view } = useBoard()
  const [data, setData] = useState<NotesScreenView | null>(null)
  const [open, setOpen] = useState<Open>({ kind: 'dm' })
  const [edited, setEdited] = useState<Array<{ id: string; title: string }>>([])
  const [newTitle, setNewTitle] = useState<string | null>(null)
  const load = useCallback(() => {
    void query('notes:screen', undefined).then((d) => { if (d) setData(d) })
    void query('notedoc:edited', undefined).then((e) => setEdited(e ?? []))
  }, [query])
  useEffect(load, [load, view?.undo])
  // Coming back from Word: look for changes.
  useEffect(() => { window.addEventListener('focus', load); return () => window.removeEventListener('focus', load) }, [load])

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

  return (
    <div className="notes-lib" style={side.style}>
      <aside className="parchment-note notes-list">
        {side.grip}
        {edited.map((e) => (
          <div key={e.id} className="notes-edited" role="status">
            <strong>{e.title}</strong> changed in Word.
            <TakeEdit id={e.id} onDone={(changed) => { load(); setOpen({ kind: 'doc', id: e.id }); if (changed.length) useBoard.setState({ message: { text: `${changed.length} changed part${changed.length === 1 ? '' : 's'} brought in.`, isError: false } }) }} onOpen={onOpen} />
          </div>
        ))}
        <h2 className="panel-title">DM notes</h2>
        <ul className="notes-items">
          <li><button aria-current={open.kind === 'dm'} onClick={() => setOpen({ kind: 'dm' })}>Between sessions<span className="ink-muted">{data.dmNotes.trim() ? `${data.dmNotes.trim().split(/\s+/).length} words` : 'empty'}</span></button></li>
          {data.sessions.map((x) => (
            <li key={x.id}><button aria-current={open.kind === 'session' && open.id === x.id} onClick={() => setOpen({ kind: 'session', id: x.id })}>
              Session {x.number} · {when(x.startedAt)}<span className="ink-muted">{x.running ? 'running now · on the desk' : x.dmNotes.trim() ? `${x.dmNotes.trim().split(/\s+/).length} words` : 'no notes'}</span>
            </button></li>
          ))}
        </ul>
        <h2 className="panel-title">Notes files</h2>
        {data.docs.length === 0 && <p className="ink-muted">None yet. Files you import from now on are kept here, and you can write new ones.</p>}
        <ul className="notes-items">
          {data.docs.map((d) => (
            <li key={d.id}><button aria-current={open.kind === 'doc' && open.id === d.id} onClick={() => setOpen({ kind: 'doc', id: d.id })}>
              {d.title}<span className="ink-muted">{KIND_LABEL[d.kind]} · {when(d.updatedAt)}{d.versions.length ? ` · ${d.versions.length + 1} versions` : ''}</span>
            </button></li>
          ))}
        </ul>
        {newTitle === null ? (
          <div className="row tight wrap">
            <button className="ink-button" onClick={() => setNewTitle('')}>New note</button>
            <button className="ink-button" onClick={onImport}>Import notes…</button>
          </div>
        ) : (
          <form className="row tight" onSubmit={(e) => { e.preventDefault(); void create() }}>
            <input autoFocus value={newTitle} maxLength={200} placeholder="Note title" aria-label="New note title" onChange={(e) => setNewTitle(e.target.value)} />
            <button type="submit" className="primary" disabled={!newTitle.trim()}>Add</button>
            <button type="button" onClick={() => setNewTitle(null)}>Cancel</button>
          </form>
        )}
        <p className="ink-muted notes-hint">Notes imported before 1.3 were not kept as files: import them again to see them here.</p>
      </aside>
      <section className="notes-view">
        {open.kind === 'dm' && (
          <TextNote key="dm" title="DM notes between sessions" text={data.dmNotes}
            hint={data.sessions.some((x) => x.running) ? 'A session is running: the desk journal writes to that session’s notes.' : 'The desk journal shows these while no session runs.'}
            popout={!data.sessions.some((x) => x.running)}
            onSave={(text) => act('notes:set', { text })} />
        )}
        {sess && (
          <TextNote key={sess.id} title={`Session ${sess.number} · ${when(sess.startedAt)}`} text={sess.dmNotes} popout={sess.running}
            hint={sess.running ? 'This session is running: the desk journal is these notes.' : 'DM notes from this session.'}
            recap={sess.recap} onSave={(text) => act('session:notes', { id: sess.id, text })} />
        )}
        {doc && <DocNote key={doc.id} doc={doc} docs={data.docs} onOpenDraft={onOpen} onChanged={load} />}
        {open.kind === 'doc' && !doc && <p className="ink-muted">That note is gone (moved to History or undone).</p>}
      </section>
    </div>
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

function TextNote({ title, text, hint, recap, popout, onSave }: {
  title: string; text: string; hint: string; recap?: string; popout: boolean; onSave(text: string): Promise<unknown>
}) {
  const [draft, setDraft] = useState(text)
  useEffect(() => setDraft(text), [text])
  const save = () => { if (draft !== text) void onSave(draft) }
  return (
    <div className="parchment-sheet notes-text">
      <div className="notes-head">
        <h2 className="panel-title">{title}</h2>
        <span className="row tight wrap">
          {popout && <button className="ink-button" title="Open these notes in their own window; drag it to another screen" onClick={() => void call('notes:popout', undefined)}>Pop out</button>}
          <button className="ink-button" onClick={async () => { const p = await call('file:saveDocx', { name: title.replace(/[^\w\s-]/g, ''), text: draft }).catch(() => null); if (p) useBoard.getState().say(`Saved ${p}`) }}>Save as Word…</button>
        </span>
      </div>
      <p className="ink-muted">{hint} Saved when you click away; Ctrl+Z undoes.</p>
      <textarea className="journal-text notes-textarea" value={draft} aria-label={title} onChange={(e) => setDraft(e.target.value)} onBlur={save} />
      {recap?.trim() && (
        <details className="notes-recap"><summary>Session recap</summary><p className="selectable">{recap}</p></details>
      )}
    </div>
  )
}

function DocNote({ doc, docs, onOpenDraft, onChanged }: { doc: NoteDocView; docs: NoteDocView[]; onOpenDraft(d: ImportDraft): void; onChanged(): void }) {
  const { act, say } = useBoard()
  const [content, setContent] = useState<{ blocks: Block[]; url: string | null } | null>(null)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [changed, setChanged] = useState<string[] | null>(null)
  const [title, setTitle] = useState(doc.title)
  const [making, setMaking] = useState(false)
  const editor = useRef<NoteEditorHandle>(null)
  useEffect(() => { void call('notedoc:content', { id: doc.id }).then(setContent).catch((e) => setError((e as Error).message)) }, [doc.id, doc.updatedAt])
  const save = async () => {
    const r = await act('notedoc:save', { id: doc.id, blocks: editor.current?.blocks() ?? [] })
    if (!r) return
    setDirty(false)
    onChanged()
    if (r.changed.length) setChanged(r.changed)
    else say('Saved. Nothing new for the cards.')
  }
  return (
    <div className="parchment-sheet notes-doc">
      <div className="notes-head">
        <input className="notes-title" value={title} aria-label="Note title" maxLength={200} onChange={(e) => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() && title.trim() !== doc.title) void act('notedoc:rename', { id: doc.id, title: title.trim() }); else setTitle(doc.title) }} />
        <span className="row tight wrap">
          {doc.kind !== 'picture' && <button className="primary" disabled={!dirty} onClick={() => void save()} title="Saves a Word version; earlier versions stay below">Save</button>}
          <button className="ink-button" onClick={() => void act('notedoc:openInWord', { id: doc.id }).then(() => {
            if (doc.kind === 'word') say('Opened in Word. Save there; when you come back, Dungeon Zen offers to bring the changes in.')
          })}>{doc.kind === 'word' ? 'Open in Word' : doc.kind === 'pdf' ? 'Open the PDF' : doc.kind === 'picture' ? 'Open the picture' : 'Open the file'}</button>
          {doc.kind !== 'picture' && <button className="ink-button" title="The AI copies a character sheet (and its other files) into a character card" onClick={() => setMaking(true)}>Make a character card…</button>}
          {doc.kind !== 'picture' && <button className="ink-button" onClick={async () => { const p = await act('notedoc:saveCopy', { id: doc.id }); if (p) say(`Saved ${p}`) }}>Save a copy as Word…</button>}
          <button className="ink-button danger-ink" onClick={() => void act('notedoc:setStatus', { id: doc.id, status: 'defunct' }).then(onChanged)}>Move to History</button>
        </span>
      </div>
      <p className="ink-muted">From {doc.originalName}. {doc.kind === 'word' || doc.kind === 'text' ? 'Edit it here (Save writes a Word file) or in Word.' : doc.kind === 'pdf' ? 'The PDF’s text: edit it here and Save to make a Word version.' : ''}</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {content && (doc.kind === 'picture'
        ? <img className="notes-picture" src={content.url ?? ''} alt={doc.title} />
        : <NoteEditor ref={editor} initial={content.blocks} label={doc.title} onDirty={() => setDirty(true)} />)}
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
  )
}
