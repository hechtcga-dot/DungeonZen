import { useEffect, useMemo, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import type { IpcOutputs } from '../../shared/ipc'
import { OpenFolder } from './OpenFolder'
import type { LibraryPictureView, SheetView, StyleExampleView, StyleUse } from '../../shared/types'

const ASSET = 'dz-asset://campaign/'
export const STYLE_USE_LABELS: Record<StyleUse, string> = { portraits: 'Portraits', maps: 'Maps', battle: 'Battle maps' }

/** The art style line every drawing starts with (Setup in each Draw window; campaign setting). */
export const withArtStyle = (prompt: string, artStyle: string) => (artStyle.trim() ? `${prompt}\nArt style: ${artStyle.trim()}` : prompt)

/**
 * In every Draw window: "Prompt being sent" (open it to read or change every word), and the Library
 * pictures ticked as style examples for this kind of drawing (all on; untick any for this drawing only).
 */
export function DrawExtras({ use, prompt, onPrompt, onReset, picked, onPicked }: {
  use: StyleUse
  prompt: string
  onPrompt(next: string): void
  onReset(): void
  picked: Set<string>
  onPicked(next: Set<string>): void
}) {
  const { act, info } = useBoard()
  const [styles, setStyles] = useState<StyleExampleView[] | null>(null)
  const [service, setService] = useState<IpcOutputs['ai:imageInfo'] | null>(null)
  const [artStyle, setArtStyle] = useState(info?.artStyle ?? '')
  useEffect(() => {
    void call('style:list', { use }).then((s) => { setStyles(s); onPicked(new Set(s.map((x) => x.id))) }).catch(() => setStyles([]))
    void call('ai:imageInfo', undefined).then(setService).catch(() => setService(null))
  }, [use])
  const max = service?.maxReferences ?? 0
  const sending = Math.min(max, picked.size)
  return (
    <>
      <details className="draw-prompt">
        <summary>Prompt being sent to the AI <span className="muted">(open to read and change it)</span></summary>
        <textarea aria-label="Prompt being sent to the AI" rows={7} value={prompt} maxLength={4000} onChange={(e) => onPrompt(e.target.value)} />
        <div className="row tight">
          <button type="button" onClick={onReset}>Reset</button>
          <span className="hint">Exactly this text goes to {service?.name ?? 'the image service'}.</span>
        </div>
        <div className="field">
          <label htmlFor={`art-style-${use}`}>Art style in words (added to every drawing in this campaign)</label>
          <div className="row tight">
            <input id={`art-style-${use}`} value={artStyle} maxLength={500} placeholder="watercolour, muted earth colours, ink outlines"
              onChange={(e) => setArtStyle(e.target.value)} />
            <button type="button" disabled={artStyle.trim() === (info?.artStyle ?? '')}
              onClick={() => void act('campaign:update', { artStyle: artStyle.trim() }).then(onReset)}>Save style</button>
          </div>
        </div>
      </details>
      <fieldset className="draw-styles">
        <legend>Style examples ({STYLE_USE_LABELS[use].toLowerCase()})</legend>
        {styles === null ? <p className="hint">Loading…</p> : styles.length === 0 ? (
          <p className="hint">No Library pictures are ticked for {STYLE_USE_LABELS[use].toLowerCase()}. Add art in Library › Pictures.</p>
        ) : (
          <>
            <div className="draw-thumbs">
              {styles.map((s) => (
                <label key={s.id} className={`draw-thumb${picked.has(s.id) ? ' is-on' : ''}`} title={s.name}>
                  <input type="checkbox" checked={picked.has(s.id)} onChange={(e) => {
                    const next = new Set(picked)
                    if (e.target.checked) next.add(s.id); else next.delete(s.id)
                    onPicked(next)
                  }} />
                  <img src={s.url} alt={s.name} />
                </label>
              ))}
            </div>
            <p className="hint">
              {!service?.name
                ? 'No image service is chosen yet (AI services). '
                : max === 0
                ? `${service.name} can't see examples; the style is described in words only (the art style above).`
                : `${service?.name} takes ${max === 1 ? 'one example' : `up to ${max} examples`}: ${sending ? `the first ${sending} ticked go with this drawing` : 'none ticked'}.`}
              {' '}Unticking only changes this drawing.
            </p>
          </>
        )}
      </fieldset>
    </>
  )
}

/** Draw a card's picture with AI: optional wishes, the prompt, style examples; Keep, Draw again or Cancel. */
export function DrawPictureDialog({ entity, onClose }: { entity: SheetView['entity']; onClose(): void }) {
  const { act, setAiSettingsOpen, info } = useBoard()
  const [ask, setAsk] = useState('')
  const [prompt, setPrompt] = useState('')
  const [edited, setEdited] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drawn, setDrawn] = useState<IpcOutputs['entity:drawPicture'] | null>(null)
  const use: StyleUse = 'portraits'
  const build = (wish: string) => call('entity:picturePrompt', { entityId: entity.id, ask: wish })
    .then((p) => setPrompt(withArtStyle(p, useBoard.getState().info?.artStyle ?? info?.artStyle ?? ''))).catch(() => undefined)
  // The prompt follows the wishes until the DM edits it by hand.
  useEffect(() => {
    if (edited) return
    const t = setTimeout(() => void build(ask), 300)
    return () => clearTimeout(t)
  }, [ask, edited])
  const draw = async () => {
    setBusy(true); setError('')
    try {
      if (drawn) await call('battlemap:discard', { pendingId: drawn.pendingId })
      setDrawn(await call('entity:drawPicture', { entityId: entity.id, prompt, styleIds: [...picked] }))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const close = () => { if (drawn) void call('battlemap:discard', { pendingId: drawn.pendingId }); onClose() }
  return (
    <Dialog title={`Draw ${entity.name}`} open onClose={close} wide>
      <div className="dz-form">
        <div className="field">
          <label htmlFor="pic-ask">Anything to add? (optional)</label>
          <input id="pic-ask" value={ask} maxLength={2000} placeholder="scarred face, red cloak, holding a lantern" onChange={(ev) => setAsk(ev.target.value)} />
          <div className="hint">The card's appearance, summary and description go with it. Uses the image service chosen in AI services.</div>
        </div>
        <DrawExtras use={use} prompt={prompt} onPrompt={(p) => { setPrompt(p); setEdited(true) }}
          onReset={() => { setEdited(false); void build(ask) }} picked={picked} onPicked={setPicked} />
        {error && (
          <div className="field-error battle-error" role="alert"><span>{error}</span>
            <span className="row tight"><button disabled={busy} onClick={() => void draw()}>Try again</button><button onClick={() => setAiSettingsOpen(true)}>AI services…</button></span></div>
        )}
        {drawn && <div className="ai-suggestion"><span className="ai-badge">AI suggestion · {drawn.source}</span><img className="pic-preview" src={drawn.url} alt="The AI's drawing" /></div>}
        <div className="dz-actions">
          <button type="button" onClick={close}>Cancel</button>
          <button disabled={busy || prompt.trim().length < 10} onClick={() => void draw()}>{busy ? 'Drawing…' : drawn ? 'Draw again' : 'Draw'}</button>
          {drawn && <button className="primary" onClick={async () => {
            await act('entity:keepPicture', { entityId: entity.id, pendingId: drawn.pendingId, source: drawn.source })
            onClose()
          }}>Keep this picture</button>}
        </div>
      </div>
    </Dialog>
  )
}

/** Picks a picture from Library › Pictures, opened at a folder. */
export function PicturePicker({ folder, title, onPick, onClose }: { folder: string; title: string; onPick(p: LibraryPictureView): void; onClose(): void }) {
  const [view, setView] = useState<IpcOutputs['pictures:view'] | null>(null)
  const [open, setOpen] = useState(folder)
  useEffect(() => { void call('pictures:view', undefined).then(setView).catch(() => setView({ pictures: [], folders: [] })) }, [])
  const shown = view?.pictures.filter((p) => p.folder === open) ?? []
  return (
    <Dialog title={title} open onClose={onClose} wide>
      {!view ? <p className="hint">Loading…</p> : (
        <div className="pic-picker">
          <nav className="pic-folders" aria-label="Folders">
            {view.folders.map((f) => (
              <button key={f} aria-pressed={f === open} onClick={() => setOpen(f)}>{f} <span className="muted">{view.pictures.filter((p) => p.folder === f).length}</span></button>
            ))}
          </nav>
          <div className="pic-grid">
            {shown.length === 0 && <p className="hint">Nothing in {open} yet.</p>}
            {shown.map((p) => (
              <button key={p.key} className="pic-tile" onClick={() => onPick(p)} title={p.name}>
                <img src={p.url} alt="" loading="lazy" />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  )
}

const FOLDER_FOR: Partial<Record<string, string>> = { NPC: 'Portraits', PC: 'Portraits', MONSTER: 'Portraits', LOCATION: 'Places', ITEM: 'Items' }
export const pictureFolderFor = (type: string) => FOLDER_FOR[type] ?? 'Art'

/** Top of every card sheet: its picture, Choose from Library, Upload, Draw with AI, Remove. */
export function PicturePanel({ sheet }: { sheet: SheetView }) {
  const { act, say } = useBoard()
  const e = sheet.entity
  const [mode, setMode] = useState<'pick' | 'draw' | null>(null)
  const picture = typeof e.attributes.picture === 'string' ? e.attributes.picture : null
  const source = typeof e.attributes.picture_source === 'string' ? e.attributes.picture_source : null
  const folder = useMemo(() => pictureFolderFor(e.type), [e.type])
  return (
    <section className="panel card-picture">
      {picture ? <img src={ASSET + picture} alt={`Picture of ${e.name}`} /> : <div className="fight-nopic">No picture yet</div>}
      {source && <span className="ai-badge">Drawn by AI · {source}</span>}
      <div className="row tight wrap">
        <button onClick={() => setMode('pick')}>Choose from Library…</button>
        <button onClick={() => void act('entity:pictureDialog', { entityId: e.id })} title={`Saved in Library › Pictures › ${folder}`}>Upload…</button>
        <button onClick={() => setMode('draw')}>Draw with AI…</button>
        {picture && <button onClick={() => void act('entity:removePicture', { entityId: e.id })} title="Ctrl+Z puts it back">Remove picture</button>}
        <OpenFolder sub="pictures" label="Open pictures folder" />
      </div>
      {mode === 'draw' && <DrawPictureDialog entity={e} onClose={() => setMode(null)} />}
      {mode === 'pick' && (
        <PicturePicker folder={folder} title={`Choose a picture for ${e.name}`} onClose={() => setMode(null)}
          onPick={(p) => { setMode(null); void act('entity:usePicture', { entityId: e.id, path: p.path }).then(() => say(`${p.name} is now the picture of ${e.name}.`)) }} />
      )}
    </section>
  )
}

/**
 * Library › Pictures: every picture in the campaign, in folders. Upload several at once, rename, move
 * between folders (drag onto a folder), tick what each one is a style example for, move to History.
 */
export function PicturesTab() {
  const { act, query, view: boardView, openSheet, goTo, say } = useBoard()
  const [data, setData] = useState<IpcOutputs['pictures:view'] | null>(null)
  const [folder, setFolder] = useState('All')
  const [newFolder, setNewFolder] = useState<string | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const load = () => void query('pictures:view', undefined).then((v) => { if (v) setData(v) })
  useEffect(load, [query, boardView?.undo])
  const update = (p: LibraryPictureView, patch: { name?: string; folder?: string; styleFor?: StyleUse[] }) => void act('pictures:update', { key: p.key, patch }).then(load)
  if (!data) return <p className="hint">Loading…</p>
  const shown = folder === 'All' ? data.pictures : data.pictures.filter((p) => p.folder === folder)
  const count = (f: string) => data.pictures.filter((p) => p.folder === f).length
  const upload = async () => {
    const n = await act('pictures:upload', { folder: folder === 'All' ? 'Art' : folder })
    if (n) { say(`Added ${n} picture${n === 1 ? '' : 's'}. New art is a style example for portraits, maps and battle maps; untick what you don't want.`); load() }
  }
  return (
    <div className="panel pictures-tab">
      <nav className="pic-folders" aria-label="Picture folders">
        <button aria-pressed={folder === 'All'} onClick={() => setFolder('All')}>All pictures <span className="muted">{data.pictures.length}</span></button>
        {data.folders.map((f) => (
          <button key={f} aria-pressed={folder === f} onClick={() => setFolder(f)}
            className={dragKey ? 'is-drop' : undefined}
            onDragOver={(e) => { if (dragKey) e.preventDefault() }}
            onDrop={(e) => {
              e.preventDefault()
              const p = data.pictures.find((x) => x.key === dragKey)
              setDragKey(null)
              if (p && p.folder !== f) update(p, { folder: f })
            }}>{f} <span className="muted">{count(f)}</span></button>
        ))}
        {newFolder === null ? <button className="link-button" onClick={() => setNewFolder('')}>+ New folder</button> : (
          <form className="row tight" onSubmit={(e) => { e.preventDefault(); if (newFolder.trim()) void act('pictures:addFolder', { name: newFolder.trim() }).then(() => { setFolder(newFolder.trim()); setNewFolder(null); load() }) }}>
            <input autoFocus value={newFolder} maxLength={80} placeholder="Folder name" aria-label="New folder name" onChange={(e) => setNewFolder(e.target.value)} />
            <button type="submit" disabled={!newFolder.trim()}>Add</button>
          </form>
        )}
        <p className="hint">Drag a picture onto a folder to move it.</p>
      </nav>
      <section className="pic-main">
        <div className="row tight wrap">
          <button className="primary" onClick={() => void upload()}>Upload pictures…</button>
          <span className="hint">Into {folder === 'All' ? 'Art' : folder}. Maps, card pictures and background pictures show up here by themselves.</span>
          <OpenFolder sub="assets" label="Open pictures folder" />
        </div>
        <p className="hint">Style examples: ticked pictures go with AI drawings of that kind, to anchor the art style. Each Draw window lets you untick them for one drawing.</p>
        {shown.length === 0 && <p className="hint">No pictures in {folder} yet.</p>}
        <div className="pic-cards">
          {shown.map((p) => (
            <article key={p.key} className="pic-card" draggable onDragStart={() => setDragKey(p.key)} onDragEnd={() => setDragKey(null)}>
              <img src={p.url} alt="" loading="lazy" />
              <CommitName value={p.name} label={`Name of ${p.name}`} onCommit={(name) => update(p, { name })} />
              <div className="pic-uses" role="group" aria-label={`Style example for (${p.name})`}>
                <span className="field-label">Style example for</span>
                {(Object.keys(STYLE_USE_LABELS) as StyleUse[]).map((u) => (
                  <label key={u} className="field checkbox">
                    <input type="checkbox" checked={p.styleFor.includes(u)}
                      onChange={(e) => update(p, { styleFor: e.target.checked ? [...p.styleFor, u] : p.styleFor.filter((x) => x !== u) })} /> {STYLE_USE_LABELS[u]}
                  </label>
                ))}
              </div>
              <div className="row tight wrap">
                <select aria-label={`Folder of ${p.name}`} value={p.folder} onChange={(e) => update(p, { folder: e.target.value })}>
                  {data.folders.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
                {p.from?.kind === 'card' && <button className="link-button" onClick={() => void openSheet(p.from!.id)}>Open card</button>}
                {p.from?.kind === 'map' && <button className="link-button" onClick={() => goTo('map')}>Open map</button>}
                {p.key.startsWith('lib:') && (
                  <button className="link-button danger-link" title="Ctrl+Z or History brings it back"
                    onClick={() => void act('style:setStatus', { id: p.key.slice(4), status: 'defunct' }).then(load)}>Remove</button>
                )}
              </div>
              {p.from && <span className="hint">{p.from.kind === 'card' ? 'Picture of' : p.from.kind === 'map' ? 'Map:' : 'On the board:'} {p.from.name}</span>}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function CommitName({ value, label, onCommit }: { value: string; label: string; onCommit(v: string): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input className="pic-name" aria-label={label} value={draft} maxLength={200} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() && draft.trim() !== value) onCommit(draft.trim()); else setDraft(value) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}
