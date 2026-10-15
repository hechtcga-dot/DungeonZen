import { ADVANCED_FIELDS, STYLE_TAG_FIELDS, TEMPLATE_FIELDS, advancedFromTags, advancedLines, blendTags, styleLines, type Advanced, type AdvancedKey, type PromptTemplate, type StyleTags, type TemplateUse } from '../../shared/styleTags'
import { COMPOSITIONS, DEFAULT_COMPOSITION_FOR, compositionById } from '../../shared/compositions'
import { CompositionSketch } from '../art/compositions'
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import type { IpcOutputs } from '../../shared/ipc'
import { OpenFolder } from './OpenFolder'
import { ChangePicture, OutlinePanel, outlineSend } from './OutlinePad'
import { outlineBlank, outlineText, readOutline } from '../../shared/outline'
import type { LibraryPictureView, SheetView, StyleExampleView, StyleUse } from '../../shared/types'

const ASSET = 'dz-asset://campaign/'
export const STYLE_USE_LABELS: Record<StyleUse, string> = { portraits: 'Portraits', maps: 'Maps', battle: 'Battle maps' }

/** The art style line every drawing starts with (Setup in each Draw window; campaign setting). */
/** A map prompt plus the ticked pictures' style tags and the campaign's art style (no composition: maps have their own). */
export const withArtStyle = (prompt: string, artStyle: string, tags: StyleTags[] = []) =>
  [prompt, ...styleLines(blendTags(tags), artStyle, { composition: null })].join('\n')

/**
 * In every Draw window: "Prompt being sent" (open it to read or change every word), and the Library
 * pictures ticked as style examples for this kind of drawing (all on; untick any for this drawing only).
 */
/** Draw windows: send the ticked examples as smaller copies (off unless the DM ticks it; the files stay as they are). */
export function SmallerExamples({ value, onChange }: { value: boolean; onChange(v: boolean): void }) {
  return (
    <label className="field checkbox" title="Big pictures take the service longer to read; very large ones can make it time out.">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> Send smaller copies of the examples (at most 1024 px; faster, fewer time-outs)
    </label>
  )
}

/**
 * Draw windows, under the style examples: send the ticked examples themselves (off by default). Ticking an example
 * always puts its style words in the prompt; the picture goes only with this tick (owner, 2026-10-14).
 */
export function SendExamples({ value, onChange }: { value: boolean; onChange(v: boolean): void }) {
  return (
    <label className="field checkbox send-examples" title="The ticked examples' style words are in the prompt either way. Sent pictures make the AI follow them closely.">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> Send the ticked pictures for reference
    </label>
  )
}

/** Style examples ticked or added most recently, newest first (this computer; ids are unique across campaigns). */
const RECENT_KEY = 'dz-recent-styles'
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[] } catch { return [] } }
const markRecent = (ids: string[]) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([...ids, ...readRecent().filter((x) => !ids.includes(x))].slice(0, 200))) } catch { /* private window */ } }

export function DrawExtras({ use, prompt, onPrompt, onReset, picked, onPicked, onTags, smaller, onSmaller, send, onSend, only }: {
  use: StyleUse
  /** Just one part (the card picture window puts them in different columns); the 'styles' part owns the ticks. */
  only?: 'prompt' | 'styles'
  /** The ticked pictures go with the drawing (SendExamples under the examples). */
  send: boolean
  onSend(v: boolean): void
  prompt: string
  onPrompt(next: string): void
  onReset(): void
  picked: Set<string>
  onPicked(next: Set<string>): void
  /** The ticked pictures' style tags, for the prompt. */
  onTags?(tags: StyleTags[]): void
  smaller: boolean
  onSmaller(v: boolean): void
}) {
  const { act, info } = useBoard()
  const [styles, setStyles] = useState<StyleExampleView[] | null>(null)
  const [service, setService] = useState<IpcOutputs['ai:imageInfo'] | null>(null)
  const [artStyle, setArtStyle] = useState(info?.artStyle ?? '')
  const [fresh, setFresh] = useState<string[]>([])
  const loadStyles = () => call('style:list', { use }).then(setStyles).catch(() => setStyles([]))
  // + : pictures from the computer go into the Library (Art) and are ticked for this drawing.
  const addPictures = async () => {
    const added = await act('style:addDialog', undefined)
    if (!added?.length) return
    await loadStyles()
    onPicked(new Set([...picked, ...added.map((x) => x.id)]))
    markRecent(added.map((x) => x.id))
    setFresh(added.map((x) => x.id))
  }
  useEffect(() => {
    void call('ai:imageInfo', undefined).then(setService).catch(() => setService(null))
    if (only === 'prompt') return
    // None ticked until the DM picks (owner, 2026-10-12).
    setFresh([])
    void call('style:list', { use }).then((s) => { setStyles(s); onPicked(new Set()) }).catch(() => setStyles([]))
  }, [use])
  useEffect(() => { if (styles) onTags?.(styles.filter((s) => picked.has(s.id)).map((s) => s.tags)) }, [styles, picked]) // eslint-disable-line react-hooks/exhaustive-deps
  const max = service?.maxReferences ?? 0
  const sending = Math.min(max, picked.size)
  // The 8 most recently ticked or added next to +; the rest (and ticked ones) behind All examples.
  const [all, setAll] = useState(false)
  const recent = readRecent()
  const rank = (id: string) => { const r = recent.indexOf(id); return r < 0 ? Infinity : r }
  const ordered = [...(styles ?? [])].sort((a, b) => rank(a.id) - rank(b.id))
  const shown = all ? ordered : ordered.filter((x, k) => k < 8 || picked.has(x.id))
  return (
    <>
      {only !== 'styles' && <details className="draw-prompt">
        <summary>Prompt being sent to the AI <span className="muted">(open to read and change it)</span></summary>
        <textarea aria-label="Prompt being sent to the AI" rows={11} value={prompt} maxLength={4000} onChange={(e) => onPrompt(e.target.value)} />
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
      </details>}
      {only !== 'prompt' && <fieldset className="draw-styles">
        <legend>Style examples ({STYLE_USE_LABELS[use].toLowerCase()})</legend>
        {styles === null ? <p className="hint">Loading…</p> : (
          <>
            {styles.length === 0 && <p className="hint">No Library pictures are ticked for {STYLE_USE_LABELS[use].toLowerCase()}. Add one with + or in Library › Pictures.</p>}
            <div className="draw-thumbs">
              <button type="button" className="draw-thumb draw-add" title="Add pictures from your computer to the Library" aria-label="Add pictures to the Library" onClick={() => void addPictures()}>+</button>
              {shown.map((s) => (
                <label key={s.id} className={`draw-thumb${picked.has(s.id) ? ' is-on' : ''}`} title={s.name}>
                  <input type="checkbox" checked={picked.has(s.id)} onChange={(e) => {
                    const next = new Set(picked)
                    if (e.target.checked) { next.add(s.id); markRecent([s.id]) } else next.delete(s.id)
                    onPicked(next)
                  }} />
                  <img src={`${s.url}?w=400`} alt={s.name} />
                </label>
              ))}
              {ordered.length > 8 && <button type="button" className="draw-all" onClick={() => setAll(!all)}>{all ? 'Show the 8 most recent' : `All examples… (${ordered.length})`}</button>}
            </div>
            <SendExamples value={send} onChange={onSend} />
            {fresh.length > 0 && <NewPictures ids={fresh} onChanged={() => void loadStyles()} onDone={() => setFresh([])} />}
            <p className="hint">
              Ticked examples put their style tags (Library › Pictures) into the prompt.{' '}
              {!send
                ? 'The pictures themselves go only with "Send the ticked pictures for reference".'
                : !service?.name
                ? 'No image service is chosen yet (AI services).'
                : max === 0
                ? `${service.name} can't see pictures; the style goes in words only.`
                : `${service.name} takes ${max === 1 ? 'one picture' : `up to ${max} pictures`}: ${sending ? `the first ${sending} ticked go with this drawing` : 'none ticked'}.`}
            </p>
            {send && max > 0 && <SmallerExamples value={smaller} onChange={onSmaller} />}
          </>
        )}
      </fieldset>}
    </>
  )
}

/** Pictures just added with +: what they are style examples for, and their style tags (AI reads them on a click). */
function NewPictures({ ids, onChanged, onDone }: { ids: string[]; onChanged(): void; onDone(): void }) {
  const { act } = useBoard()
  const [pics, setPics] = useState<LibraryPictureView[]>([])
  const load = () => void call('pictures:view', undefined).then((v) => setPics(v.pictures.filter((p) => ids.includes(p.key.slice(4)) && p.key.startsWith('lib:'))))
  useEffect(load, [ids.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const update = (p: LibraryPictureView, patch: { styleFor?: StyleUse[]; tags?: StyleTags }) => void act('pictures:update', { key: p.key, patch }).then(() => { load(); onChanged() })
  return (
    <div className="draw-new-pics">
      {pics.map((p) => (
        <div key={p.key} className="draw-new-pic">
          <img src={`${p.url}?w=400`} alt="" />
          <div>
            <strong>{p.name}</strong> <span className="hint">added to Library › Pictures › {p.folder}</span>
            <div className="pic-uses" role="group" aria-label={`Style example for (${p.name})`}>
              <span className="field-label">Style example for</span>
              {(Object.keys(STYLE_USE_LABELS) as StyleUse[]).map((u) => (
                <label key={u} className="field checkbox">
                  <input type="checkbox" checked={p.styleFor.includes(u)}
                    onChange={(e) => update(p, { styleFor: e.target.checked ? [...p.styleFor, u] : p.styleFor.filter((x) => x !== u) })} /> {STYLE_USE_LABELS[u]}
                </label>
              ))}
            </div>
            <StyleTagsEditor picture={p} open onSave={(tags) => update(p, { tags })} />
          </div>
        </div>
      ))}
      <button type="button" className="link-button" onClick={onDone}>Done</button>
    </div>
  )
}

/** Draw a card's picture with AI (owner's option A, 2026-10-14): wishes, examples, style, composition and outline on the left; the picture and prompt on the right. */
export function DrawPictureDialog({ entity, onClose }: { entity: SheetView['entity']; onClose(): void }) {
  const { act, setAiSettingsOpen, info } = useBoard()
  const [ask, setAsk] = useState('')
  const [base, setBase] = useState<IpcOutputs['entity:picturePrompt'] | null>(null)
  const [ownPrompt, setOwnPrompt] = useState<string | null>(null)
  // Advanced composition boxes the DM changed (the rest follow the card, examples and composition).
  const [over, setOver] = useState<Advanced>({})
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [send, setSend] = useState(false)
  const [smaller, setSmaller] = useState(false)
  const [tags, setTags] = useState<StyleTags[]>([])
  // The card type picks the composition; 'examples' = the ticked pictures' own composition tag.
  const [comp, setComp] = useState<string>(DEFAULT_COMPOSITION_FOR[entity.type])
  const blended = blendTags(tags)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [drawn, setDrawn] = useState<IpcOutputs['entity:drawPicture'] | null>(null)
  const use: StyleUse = 'portraits'
  // The outline is kept on the card (undoable); "Use" is for this drawing only.
  const outline = readOutline(entity.attributes.outline)
  const [useOutline, setUseOutline] = useState(true)
  const outlineOn = useOutline && !outlineBlank(outline)
  useEffect(() => { void call('entity:picturePrompt', { entityId: entity.id }).then(setBase).catch(() => undefined) }, [entity.id])
  const artStyle = info?.artStyle ?? ''
  const auto: Advanced = {
    description: base?.description ?? '',
    ...advancedFromTags(blended, comp === 'examples' ? blended.composition ?? '' : compositionById(comp).prompt, artStyle)
  }
  const adv: Advanced = { ...auto, ...over }
  // The prompt follows the wishes, boxes and ticked pictures until the DM edits it by hand.
  const built = base ? [
    base.subject,
    adv.description?.trim() && `Description: ${adv.description.trim()}`,
    ask.trim() && `Include in the picture: ${ask.trim().replace(/[.\s]+$/, '')}.`,
    base.figure,
    ...advancedLines(adv, artStyle),
    outlineOn ? outlineText(outline) : '',
    outlineOn && outline.writeLabels ? 'No frame.' : 'No text, no frame.'
  ].filter(Boolean).join('\n') : ''
  const prompt = ownPrompt ?? built
  const draw = async () => {
    setBusy(true); setError('')
    try {
      if (drawn) await call('battlemap:discard', { pendingId: drawn.pendingId })
      setDrawn(await call('entity:drawPicture', { entityId: entity.id, prompt, styleIds: send ? [...picked] : [], smaller, outline: outlineSend(outline, outlineOn, 1) }))
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const close = () => { if (drawn) void call('battlemap:discard', { pendingId: drawn.pendingId }); onClose() }
  const rows = (keys: AdvancedKey[]) => <AdvancedRows keys={keys} value={adv} changed={over} onChange={setOver} />
  return (
    <Dialog title={`Draw ${entity.name}`} open onClose={close} wide busy={busy}>
      <div className="dz-form">
        <div className="draw-two">
          <div className="draw-left">
            {rows(['description'])}
            <div className="field">
              <label htmlFor="pic-ask">Include in the picture (optional)</label>
              <input id="pic-ask" value={ask} maxLength={2000} placeholder="ducks, a boat, a fisherman in the boat" onChange={(ev) => setAsk(ev.target.value)} />
              <div className="hint">Things to show, separated by commas. Uses the image service chosen in AI services.</div>
            </div>
            <DrawExtras only="styles" use={use} prompt={prompt} onPrompt={setOwnPrompt} send={send} onSend={setSend}
              onReset={() => undefined} picked={picked} onPicked={setPicked} onTags={setTags} smaller={smaller} onSmaller={setSmaller} />
            <section className="draw-box">
              <div className="row tight wrap"><strong>Style</strong><TemplateBar value={adv} changed={over} onChange={setOver} /></div>
              {rows(['style', 'medium', 'palette', 'light', 'detail'])}
            </section>
            <section className="draw-box">
              <CompositionPicker value={comp} onChange={(id) => { setComp(id); setOver(({ composition: _, ...rest }) => rest) }} fromExamples={blended.composition} />
              {rows(['composition', 'other'])}
            </section>
            <OutlinePanel outline={outline} on={useOutline} onOn={setUseOutline} ratio={1}
              onSave={(next) => void act('entity:update', { id: entity.id, patch: { attributes: { outline: next } } })} />
          </div>
          <div className="draw-right">
            {drawn ? (
              <div className="ai-suggestion"><span className="ai-badge">AI suggestion · {drawn.source}</span><img className="pic-preview" src={drawn.url} alt="The AI's drawing" /></div>
            ) : <div className="draw-placeholder">{busy ? 'Drawing… (this can take a minute)' : 'The drawing appears here'}</div>}
            {drawn && <ChangePicture drawn={drawn} ratio={1} disabled={busy} onChanged={setDrawn} />}
            {error && (
              <div className="field-error battle-error" role="alert"><span>{error}</span>
                <span className="row tight"><button disabled={busy} onClick={() => void draw()}>Try again</button><button onClick={() => setAiSettingsOpen(true)}>AI services…</button></span></div>
            )}
            <DrawExtras only="prompt" use={use} prompt={prompt} onPrompt={setOwnPrompt} send={send} onSend={setSend}
              onReset={() => { setOwnPrompt(null); setOver({}) }} picked={picked} onPicked={() => undefined} smaller={smaller} onSmaller={setSmaller} />
          </div>
        </div>
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

/** Prompt lines as boxes, label on the left (this drawing only; "back" puts a changed box back to its default). */
export function AdvancedRows({ keys, value, changed, onChange }: { keys: AdvancedKey[]; value: Advanced; changed: Advanced; onChange(next: Advanced): void }) {
  return (
    <div className="draw-rows">
      {ADVANCED_FIELDS.filter((f) => keys.includes(f.key)).map((f) => (
        <label key={f.key} className={f.key === 'description' ? 'draw-row stacked' : 'draw-row'}>
          <span className="field-label">{f.label}{changed[f.key] !== undefined && <button type="button" className="link-button" title="Back to the default" onClick={(e) => {
            e.preventDefault()
            const { [f.key]: _, ...rest } = changed
            onChange(rest)
          }}> ↺</button>}</span>
          <textarea className={f.key === 'description' || f.key === 'other' || f.key === 'composition' ? 'grow' : 'grow line'} style={{ '--rows': f.key === 'description' || f.key === 'other' || f.key === 'composition' ? 2 : 1 } as CSSProperties} rows={1} value={value[f.key] ?? ''} maxLength={1000} placeholder={`e.g. ${f.example}`}
            onChange={(e) => onChange({ ...changed, [f.key]: e.target.value })} />
        </label>
      ))}
    </div>
  )
}

/** Named templates of the style lines (campaign setting; the same name replaces; Remove is undoable). */
export function TemplateBar({ value, changed, onChange, use = 'portraits' }: { value: Advanced; changed: Advanced; onChange(next: Advanced): void; use?: TemplateUse }) {
  const { act } = useBoard()
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [chosen, setChosen] = useState('')
  const [saving, setSaving] = useState<string | null>(null)
  const [managing, setManaging] = useState(false)
  const load = () => void call('promptTemplates:list', use).then(setTemplates).catch(() => setTemplates([]))
  useEffect(load, [])
  const save = async (name: string) => {
    const fields = Object.fromEntries(TEMPLATE_FIELDS.map((f) => [f.key, value[f.key] ?? '']))
    await act('promptTemplates:save', { name, fields, use })
    setSaving(null); setChosen(name); load()
  }
  if (saving !== null) return (
    <form className="row tight wrap template-bar" onSubmit={(e) => { e.preventDefault(); if (saving.trim()) void save(saving.trim()) }}>
      <input autoFocus value={saving} maxLength={80} placeholder="Template name" aria-label="Template name" title="Saves Style to Other details (not the description). The same name replaces that template."
        onChange={(e) => setSaving(e.target.value)} />
      <button type="submit" disabled={!saving.trim()}>Save</button>
      <button type="button" onClick={() => setSaving(null)}>Cancel</button>
    </form>
  )
  return (
    <span className="row tight wrap template-bar">
      <label className="hint" htmlFor="adv-template">Template</label>
      <select id="adv-template" value={chosen} onChange={(e) => {
        setChosen(e.target.value)
        const t = templates.find((x) => x.name === e.target.value)
        if (t) onChange({ ...changed, ...t.fields })
      }}>
        <option value="">{templates.length ? 'Choose a template…' : 'No templates yet'}</option>
        {templates.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
      </select>
      <button type="button" className="link-button" onClick={() => setSaving(chosen)}>Save as template…</button>
      {templates.length > 0 && <button type="button" className="link-button" aria-expanded={managing} onClick={() => setManaging(!managing)}>Rename or remove…</button>}
      {managing && (
        <span className="template-manage">
          {templates.map((t) => (
            <span key={t.name} className="row tight">
              <CommitName value={t.name} label={`Name of the template ${t.name}`} onCommit={(next) => void act('promptTemplates:rename', { name: t.name, next, use }).then(() => { if (chosen === t.name) setChosen(next); load() })} />
              <button type="button" className="link-button danger-link" title="Ctrl+Z brings it back"
                onClick={() => void act('promptTemplates:remove', { name: t.name, use }).then(() => { if (chosen === t.name) setChosen(''); load() })}>Remove</button>
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

/**
 * Add to picture: the card's picture goes to the image AI with the DM's words and sketch; only the
 * new things are added. The result waits as an AI suggestion until kept (Ctrl+Z puts the old one back).
 */
function AddToPictureDialog({ entity, picture, onClose }: { entity: SheetView['entity']; picture: string; onClose(): void }) {
  const { act } = useBoard()
  const [base, setBase] = useState<IpcOutputs['image:pendingCopy'] | null>(null)
  const [drawn, setDrawn] = useState<IpcOutputs['image:update'] | null>(null)
  const [error, setError] = useState('')
  const waiting = useRef<string | null>(null)
  useEffect(() => {
    void call('image:pendingCopy', { path: picture }).then((b) => { waiting.current = b.pendingId; setBase(b) }).catch((err) => setError((err as Error).message))
  }, [picture])
  const shown = drawn ?? base
  const ratio = shown?.width && shown.height ? shown.width / shown.height : 1
  const close = () => { if (waiting.current) void call('battlemap:discard', { pendingId: waiting.current }); onClose() }
  return (
    <Dialog title={`Add to the picture of ${entity.name}`} open onClose={close} wide>
      <div className="dz-form">
        {error && <p className="field-error" role="alert">{error}</p>}
        {!shown ? !error && <p className="hint">Loading…</p> : (
          <>
            <div className={drawn ? 'ai-suggestion' : undefined}>
              {drawn && <span className="ai-badge">AI suggestion · {drawn.source} · add more, or keep it</span>}
              <ChangePicture key={shown.pendingId} add drawn={shown} ratio={ratio}
                onChanged={(next) => { waiting.current = next.pendingId; setDrawn(next) }} />
            </div>
          </>
        )}
        <div className="dz-actions">
          <button type="button" onClick={close}>Cancel</button>
          {drawn && <button className="primary" onClick={async () => {
            waiting.current = null
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
                <img src={`${p.url}?w=400`} alt="" loading="lazy" />
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
  const [mode, setMode] = useState<'pick' | 'draw' | 'add' | null>(null)
  const picture = typeof e.attributes.picture === 'string' ? e.attributes.picture : null
  const folder = useMemo(() => pictureFolderFor(e.type), [e.type])
  return (
    <section className="panel card-picture">
      {picture ? <img src={ASSET + picture} alt={`Picture of ${e.name}`} /> : <div className="fight-nopic">No picture yet</div>}
      <div className="row tight wrap pic-tools">
        <button className="ink-button" onClick={() => setMode('draw')}>Draw with AI…</button>
        {picture && <button className="ink-button icon" title="Add to picture: add things with AI, everything else stays the same" aria-label="Add to picture" onClick={() => setMode('add')}>✚</button>}
        <button className="ink-button icon" title="Choose from Library" aria-label="Choose from Library" onClick={() => setMode('pick')}>🖼</button>
        <button className="ink-button icon" title={`Upload (saved in Library › Pictures › ${folder})`} aria-label="Upload" onClick={() => void act('entity:pictureDialog', { entityId: e.id })}>⬆</button>
        <OpenFolder sub="pictures" label="📁" className="ink-button icon" />
        {picture && <button className="ink-button icon danger-ink" title="Remove picture (Ctrl+Z puts it back)" aria-label="Remove picture" onClick={() => void act('entity:removePicture', { entityId: e.id })}>🗑</button>}
      </div>
      {mode === 'draw' && <DrawPictureDialog entity={e} onClose={() => setMode(null)} />}
      {mode === 'add' && picture && <AddToPictureDialog entity={e} picture={picture} onClose={() => setMode(null)} />}
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
  // The picture drags out as a file (main.tsx), so dragend never comes: a drop anywhere or the next click ends the folder drag.
  useEffect(() => {
    if (!dragKey) return
    const end = () => setDragKey(null)
    window.addEventListener('pointerdown', end)
    window.addEventListener('drop', end)
    return () => { window.removeEventListener('pointerdown', end); window.removeEventListener('drop', end) }
  }, [dragKey])
  const update = (p: LibraryPictureView, patch: { name?: string; folder?: string; styleFor?: StyleUse[]; tags?: StyleTags }) => void act('pictures:update', { key: p.key, patch }).then(load)
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
              <img src={`${p.url}?w=400`} alt="" loading="lazy" />
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
              <StyleTagsEditor picture={p} onSave={(tags) => update(p, { tags })} />
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

/** Composition for a card picture: the chosen one with its sketch, and every other to pick from. */
function CompositionPicker({ value, onChange, fromExamples }: { value: string; onChange(id: string): void; fromExamples?: string }) {
  const own = value === 'examples' && fromExamples
  const c = compositionById(value)
  return (
    <div className="field">
      <span className="field-label">Composition</span>
      <div className="cmp-chosen">
        {own ? <span className="hint">As in the style examples: {fromExamples}</span> : <><CompositionSketch id={c.id} /><span><strong>{c.name}</strong><br /><span className="hint">{c.blurb}</span></span></>}
      </div>
      <details className="draw-composition">
        <summary>Choose another composition</summary>
        <div className="cmp-grid" role="radiogroup" aria-label="Composition">
          {COMPOSITIONS.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={!own && x.id === c.id} className={`cmp-tile${!own && x.id === c.id ? ' is-on' : ''}`} title={x.blurb} onClick={() => onChange(x.id)}>
              <CompositionSketch id={x.id} />{x.name}
            </button>
          ))}
          {fromExamples && (
            <button type="button" role="radio" aria-checked={!!own} className={`cmp-tile${own ? ' is-on' : ''}`} title={fromExamples} onClick={() => onChange('examples')}>
              <span className="hint">{fromExamples}</span>As in the style examples
            </button>
          )}
        </div>
      </details>
    </div>
  )
}

/** A picture's art style in words: typed by the DM, or read by AI as a suggestion to keep (rule 2). */
export function StyleTagsEditor({ picture, onSave, open }: { picture: Pick<LibraryPictureView, 'key' | 'name' | 'tags'>; onSave(tags: StyleTags): void; open?: boolean }) {
  const { setAiSettingsOpen } = useBoard()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [found, setFound] = useState<IpcOutputs['pictures:readStyle'] | null>(null)
  const tagged = STYLE_TAG_FIELDS.filter((f) => picture.tags[f.key]).length
  const read = async () => {
    setBusy(true); setError('')
    try { setFound(await call('pictures:readStyle', { key: picture.key })) } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <details className="pic-tags" open={open}>
      <summary>Style tags <span className="muted">({tagged ? `${tagged} of ${STYLE_TAG_FIELDS.length}` : 'none yet'})</span></summary>
      {STYLE_TAG_FIELDS.map((f) => (
        <label key={f.key} className="field">
          <span className="field-label">{f.label}</span>
          <CommitName value={picture.tags[f.key] ?? ''} label={`${f.label} of ${picture.name}`} placeholder={`e.g. ${f.example}`} allowEmpty
            onCommit={(v) => onSave({ ...picture.tags, [f.key]: v || undefined })} />
        </label>
      ))}
      <div className="row tight wrap">
        <button type="button" disabled={busy} onClick={() => void read()}>{busy ? 'Reading…' : 'Read style with AI'}</button>
        <span className="hint">Uses the writing service; it needs to see pictures.</span>
      </div>
      {error && <div className="field-error" role="alert"><span>{error}</span> <button className="link-button" onClick={() => setAiSettingsOpen(true)}>AI services…</button></div>}
      {found && (
        <div className="ai-suggestion">
          <span className="ai-badge">AI suggestion · {found.source}</span>
          <dl className="pic-tags-found">
            {STYLE_TAG_FIELDS.filter((f) => found.tags[f.key]).map((f) => <div key={f.key}><dt>{f.label}</dt><dd>{found.tags[f.key]}</dd></div>)}
          </dl>
          <div className="row tight">
            <button className="primary" onClick={() => { onSave({ ...picture.tags, ...found.tags }); setFound(null) }}>Keep</button>
            <button onClick={() => setFound(null)}>Discard</button>
          </div>
        </div>
      )}
    </details>
  )
}

function CommitName({ value, label, onCommit, placeholder, allowEmpty }: { value: string; label: string; onCommit(v: string): void; placeholder?: string; allowEmpty?: boolean }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <input className={allowEmpty ? undefined : 'pic-name'} aria-label={label} value={draft} maxLength={allowEmpty ? 300 : 200} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if ((draft.trim() || allowEmpty) && draft.trim() !== value) onCommit(draft.trim()); else setDraft(value) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}
