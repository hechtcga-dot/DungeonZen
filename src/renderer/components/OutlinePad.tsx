import { useEffect, useRef, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { OpenFolder } from './OpenFolder'
import { OUTLINE_COLOURS, changePrompt, emptyOutline, outlineBlank, type Outline, type OutlineStroke } from '../../shared/outline'
import type { IpcOutputs } from '../../shared/ipc'

const ASSET = 'dz-asset://campaign/'
type Marks = Pick<Outline, 'strokes' | 'labels'>

/**
 * Freehand pencil on a frame of the drawing's shape (points 0..1000 across and down), in six
 * colours, with labels. A picture can lie underneath (outline picture, or the AI's picture to mark).
 * Each stroke or label is handed over when done (one undo step where the caller saves it).
 */
export function OutlinePad({ value, onChange, ratio, background, labels = true, label }: {
  value: Marks
  onChange(next: Marks): void
  /** Width ÷ height of the drawing. */
  ratio: number
  background?: string | null
  labels?: boolean
  label: string
}) {
  const [colour, setColour] = useState<string>(OUTLINE_COLOURS[5].colour)
  const [tool, setTool] = useState<'pen' | 'label' | 'eraser'>('pen')
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<number[] | null>(null)
  const live = useRef<number[] | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const H = Math.round(1000 / ratio)
  const at = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    const clamp = (n: number) => Math.max(0, Math.min(1000, Math.round(n)))
    return [clamp(((e.clientX - r.left) / r.width) * 1000), clamp(((e.clientY - r.top) / r.height) * 1000)]
  }
  // Labels and strokes near a point (eraser): within 3% of the frame.
  const near = (x: number, y: number, px: number, py: number) => Math.abs(px - x) < 30 && Math.abs(py - y) < 30
  const erase = (x: number, y: number) => {
    const strokes = value.strokes.filter((s) => !s.p.some((v, i) => i % 2 === 0 && near(x, y, v, s.p[i + 1])))
    const kept = value.labels.filter((l) => !near(x, y, l.x, l.y))
    if (strokes.length !== value.strokes.length || kept.length !== value.labels.length) onChange({ strokes, labels: kept })
  }
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const [x, y] = at(e)
    if (tool === 'label') { if (text.trim()) { onChange({ ...value, labels: [...value.labels, { x, y, t: text.trim() }] }); setText('') } return }
    if (tool === 'eraser') { erase(x, y); return }
    svg.current?.setPointerCapture?.(e.pointerId)
    live.current = [x, y]
    setDraft([x, y])
  }
  const move = (e: React.PointerEvent) => {
    if (!live.current) return
    const [x, y] = at(e)
    const n = live.current.length
    if (Math.abs(live.current[n - 2] - x) + Math.abs(live.current[n - 1] - y) < 4) return
    live.current = [...live.current, x, y]
    setDraft(live.current)
  }
  const up = () => {
    const p = live.current
    live.current = null
    setDraft(null)
    if (p && p.length >= 2) onChange({ ...value, strokes: [...value.strokes, { c: colour, p: p.length === 2 ? [...p, p[0] + 1, p[1]] : p }] })
  }
  const shown = draft ? [...value.strokes, { c: colour, p: draft }] : value.strokes
  return (
    <div className="sketch">
      <div className="sketch-tools" role="toolbar" aria-label={`${label} tools`}>
        <button type="button" className="sketch-tool" aria-pressed={tool === 'pen'} onClick={() => setTool('pen')}>✎ Pen</button>
        {OUTLINE_COLOURS.map((c) => (
          <button key={c.colour} type="button" className="outline-swatch" style={{ background: c.colour }} aria-pressed={colour === c.colour && tool === 'pen'}
            aria-label={`Pen colour ${c.name}`} title={c.name} onClick={() => { setColour(c.colour); setTool('pen') }} />
        ))}
        {labels && <button type="button" className="sketch-tool" aria-pressed={tool === 'label'} onClick={() => setTool('label')}>T Label</button>}
        <button type="button" className="sketch-tool" aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')} title="Click a line or label to take it away">⌫ Eraser</button>
        <button type="button" className="sketch-tool" disabled={!value.strokes.length} onClick={() => onChange({ ...value, strokes: value.strokes.slice(0, -1) })}>↶ Last line</button>
        <button type="button" className="sketch-tool" disabled={!value.strokes.length && !value.labels.length} onClick={() => onChange({ strokes: [], labels: [] })}>Clear</button>
        {tool === 'label' && <input className="sketch-label-input" value={text} maxLength={60} placeholder="Label, then click the spot" aria-label="Label text" onChange={(e) => setText(e.target.value)} />}
      </div>
      <svg ref={svg} className="sketch-paper outline-paper" viewBox={`0 0 1000 ${H}`} role="img" aria-label={label} preserveAspectRatio="none"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {background ? <image href={background} width="1000" height={H} preserveAspectRatio="none" /> : <rect width="1000" height={H} fill="#f4ecd6" />}
        <Strokes strokes={shown} h={H} />
        {value.labels.map((l, i) => (
          <text key={i} x={l.x} y={(l.y * H) / 1000} fontSize="48" fontStyle="italic" fontFamily="'IM Fell English', Georgia, serif" textAnchor="middle"
            fill="#1f2a44" stroke="#f4ecd6" strokeWidth="9" paintOrder="stroke">{l.t}</text>
        ))}
      </svg>
    </div>
  )
}

function Strokes({ strokes, h }: { strokes: OutlineStroke[]; h: number }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="7">
      {strokes.map((s, i) => <polyline key={i} stroke={s.c} points={s.p.map((v, j) => (j % 2 ? (v * h) / 1000 : v)).join(' ')} />)}
    </g>
  )
}

/** Strokes as a PNG (base64): on white for an outline, on clear for marks. Labels are never drawn in (they go as words). */
export function strokesPng(strokes: OutlineStroke[], ratio: number, clear = false): string {
  const w = 1024, h = Math.round(1024 / ratio)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')!
  if (!clear) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h) }
  g.lineCap = 'round'
  g.lineJoin = 'round'
  g.lineWidth = clear ? 10 : 6
  for (const s of strokes) {
    // White pencil would vanish on the white outline paper: draw it grey there.
    g.strokeStyle = !clear && s.c === '#ffffff' ? '#999999' : s.c
    g.beginPath()
    for (let i = 0; i < s.p.length; i += 2) g[i ? 'lineTo' : 'moveTo']((s.p[i] * w) / 1000, (s.p[i + 1] * h) / 1000)
    g.stroke()
  }
  return canvas.toDataURL('image/png').split(',')[1]
}

/** What goes to the draw call for an outline in use, or undefined when there is none. */
export function outlineSend(o: Outline, on: boolean, ratio: number): { png?: string; path?: string } | undefined {
  if (!on || outlineBlank(o)) return undefined
  return o.use === 'picture' && o.picture ? { path: o.picture } : o.strokes.length ? { png: strokesPng(o.strokes, ratio) } : undefined
}

/**
 * Draw windows: "Outline (sketch or picture)". A sketch, or one uploaded picture used for the
 * layout only (never the style), with labels. Saved by the caller (card or campaign, undoable).
 */
export function OutlinePanel({ outline, onSave, on, onOn, ratio }: {
  outline: Outline
  onSave(next: Outline): void
  on: boolean
  onOn(v: boolean): void
  ratio: number
}) {
  const [service, setService] = useState<IpcOutputs['ai:imageInfo'] | null>(null)
  useEffect(() => { void call('ai:imageInfo', undefined).then(setService).catch(() => setService(null)) }, [])
  const say = useBoard((s) => s.say)
  const upload = async () => {
    try {
      const path = await call('outline:upload', undefined)
      if (path) onSave({ ...outline, picture: path, use: 'picture' })
    } catch (e) { say((e as Error).message, true) }
  }
  const blank = outlineBlank(outline)
  return (
    <details className="draw-outline" open={!blank}>
      <summary>Outline: sketch the layout or use a picture <span className="muted">(optional)</span></summary>
      <div className="row tight wrap">
        <label className="field checkbox"><input type="checkbox" checked={on && !blank} disabled={blank} onChange={(e) => onOn(e.target.checked)} /> Use the outline for this drawing</label>
        <span role="group" aria-label="Outline from" className="row tight">
          <button type="button" className="sketch-tool" aria-pressed={outline.use === 'sketch'} onClick={() => onSave({ ...outline, use: 'sketch' })}>Sketch</button>
          <button type="button" className="sketch-tool" aria-pressed={outline.use === 'picture'} onClick={() => outline.picture ? onSave({ ...outline, use: 'picture' }) : void upload()}>Picture</button>
        </span>
        {outline.use === 'picture' && (
          <>
            <button type="button" onClick={() => void upload()}>{outline.picture ? 'Replace picture…' : 'Upload outline picture…'}</button>
            {outline.picture && <button type="button" onClick={() => onSave({ ...outline, picture: null, use: 'sketch' })} title="Undo brings it back">Remove picture</button>}
            <OpenFolder sub="outlines" />
          </>
        )}
      </div>
      <OutlinePad label="Outline" ratio={ratio} value={outline} onChange={(m) => onSave({ ...outline, ...m })}
        background={outline.use === 'picture' && outline.picture ? `${ASSET}${outline.picture}` : null} />
      <label className="field checkbox"><input type="checkbox" checked={outline.writeLabels} onChange={(e) => onSave({ ...outline, writeLabels: e.target.checked })} /> Write the labels on the picture</label>
      <p className="hint">
        {outline.use === 'picture' ? 'The picture is used for the layout and shapes only, never for the art style (that comes from the style examples). ' : 'Draw rough shapes: a river, hills, a town. '}
        Labels tell the AI what each part is; they go as words with where they are{outline.writeLabels ? ' and are written on the picture.' : ', not written on the picture.'}
        {service && service.maxReferences === 0 ? ` ${service.name ?? 'This service'} cannot see pictures: it gets the labels as words only.` : ''}
      </p>
    </details>
  )
}

/**
 * Under an AI picture: "Change this picture". The DM's words (and coloured marks drawn on the
 * picture, each colour with its own meaning) go back to the service with the picture; the
 * answer replaces the suggestion. The box starts empty each time; the original prompt stays as it was.
 */
export function ChangePicture({ drawn, ratio, onChanged, disabled, add }: {
  drawn: { pendingId: string; url: string }
  ratio: number
  onChanged(next: IpcOutputs['image:update']): void
  disabled?: boolean
  /** Add to picture: only new things, the sketch always open. */
  add?: boolean
}) {
  const [change, setChange] = useState('')
  const [marking, setMarking] = useState(!!add)
  const [marks, setMarks] = useState<Marks>(emptyOutline())
  const [meaning, setMeaning] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [service, setService] = useState<IpcOutputs['ai:imageInfo'] | null>(null)
  useEffect(() => { void call('ai:imageInfo', undefined).then(setService).catch(() => setService(null)) }, [])
  const max = service?.maxReferences ?? 0
  const used = OUTLINE_COLOURS.filter((c) => marks.strokes.some((s) => s.c === c.colour))
  const labels = used.map((c) => ({ colour: c.colour, label: meaning[c.colour] ?? '' }))
  const withMarks = marking && marks.strokes.length > 0 && max > 1
  const update = async () => {
    setBusy(true); setError('')
    try {
      const next = await call('image:update', { pendingId: drawn.pendingId, change, add, marks: withMarks ? { png: strokesPng(marks.strokes, ratio, true), labels } : undefined })
      await call('battlemap:discard', { pendingId: drawn.pendingId })
      onChanged(next)
      setChange(''); setMarks(emptyOutline()); setMeaning({}); setMarking(!!add)
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <fieldset className="change-picture">
      <legend>{add ? 'Add to this picture' : 'Change this picture'}</legend>
      {max === 0 ? (
        <p className="hint">{service?.name ?? 'This image service'} cannot change a picture it drew. Use Draw again, or choose OpenAI images, Google Gemini images or Stability AI in AI services.</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="change-what">{add ? 'What to add' : 'What to change'}</label>
            <textarea id="change-what" rows={2} value={change} maxLength={2000} placeholder={add ? 'e.g. a windmill on the hill, sheep in the field' : 'e.g. remove the mountains, replace them with a forest'} onChange={(e) => setChange(e.target.value)} />
          </div>
          {add
            ? <p className="hint">Sketch where each new thing goes (optional). One colour per thing, then say what it is.</p>
            : <label className="field checkbox"><input type="checkbox" checked={marking} onChange={(e) => setMarking(e.target.checked)} /> Mark on the picture where to change it</label>}
          {marking && (
            <>
              <OutlinePad label={add ? 'Sketch on the picture' : 'Marks on the picture'} ratio={ratio} value={marks} onChange={setMarks} background={drawn.url} labels={false} />
              {used.map((c) => (
                <div key={c.colour} className="row tight change-colour">
                  <span className="outline-swatch" style={{ background: c.colour }} aria-hidden="true" />
                  <input aria-label={`What the ${c.name} marks mean`} value={meaning[c.colour] ?? ''} maxLength={200} placeholder={`${c.name} marks: e.g. ${add ? 'a windmill' : 'forest here'}`}
                    onChange={(e) => setMeaning({ ...meaning, [c.colour]: e.target.value })} />
                </div>
              ))}
              {max === 1 && <p className="hint">{service?.name} takes one picture only: the marks cannot go, so say where in words.</p>}
            </>
          )}
          <details className="draw-prompt">
            <summary>Words being sent <span className="muted">(with the picture{withMarks ? ' and the marked copy' : ''})</span></summary>
            <pre className="blueprint-text">{changePrompt(change || '…', withMarks ? labels : null, add)}</pre>
          </details>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="row tight">
            <button type="button" className="primary" disabled={busy || disabled || change.trim().length < 3} onClick={() => void update()}>{busy ? (add ? 'Adding…' : 'Updating…') : add ? 'Add to picture' : 'Update picture'}</button>
          </div>
        </>
      )}
    </fieldset>
  )
}
