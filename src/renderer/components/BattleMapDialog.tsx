import { useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import { CommitField } from './fields'
import { GridLines } from './MapOverlay'
import { call } from '../api'
import { useBoard } from '../store'
import { providerById, type AiProviderInfo } from '../../shared/aiProviders'
import { aspectFor, battleMapPrompt, BATTLE_SETTINGS, GRID_MAX, GRID_MIN, rowsFor, type BattleSetting } from '../../shared/battlemap'
import type { PendingImageView, StyleExampleView } from '../../shared/types'

type Drawn = PendingImageView & { source: string; prompt: string; cols: number }

/**
 * Draw a battle map with the chosen image service. The request is built from fixed
 * rules (top-down, square grid, size) plus the scene; the DM sees and can edit it.
 * The picture stays a preview until the DM keeps it (rule 2).
 */
export function BattleMapDialog() {
  const open = useBoard((s) => s.battleMapOpen)
  const setOpen = useBoard((s) => s.setBattleMapOpen)
  const setAiSettingsOpen = useBoard((s) => s.setAiSettingsOpen)
  const aiOpen = useBoard((s) => s.aiSettingsOpen)
  const { act, say, goTo } = useBoard()

  const [service, setService] = useState<{ info: AiProviderInfo; model: string } | null | undefined>(undefined)
  const [styles, setStyles] = useState<StyleExampleView[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [name, setName] = useState('Battle map')
  const [description, setDescription] = useState('')
  const [setting, setSetting] = useState<BattleSetting>('outdoors')
  const [cols, setCols] = useState(20)
  const [rows, setRows] = useState(20)
  const [light, setLight] = useState('daylight')
  const [ownPrompt, setOwnPrompt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drawn, setDrawn] = useState<Drawn | null>(null)

  const loadStyles = async () => {
    const list = await call('style:list', undefined)
    setStyles(list)
    return list
  }

  // Start from the scene: what is written for it, where the party is and the light now.
  useEffect(() => {
    if (!open) return
    setError(null); setDrawn(null); setOwnPrompt(null)
    void (async () => {
      try {
        const [ctx, list] = await Promise.all([call('battlemap:context', undefined), loadStyles()])
        setDescription(ctx.description)
        setLight(ctx.light)
        setName(ctx.placeName ? `${ctx.placeName} battle map` : 'Battle map')
        setPicked(new Set(list.slice(0, 4).map((x) => x.id)))
      } catch (e) { setError((e as Error).message) }
    })()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Which image service is chosen (read again when the AI settings close).
  useEffect(() => {
    if (!open || aiOpen) return
    call('ai:settings', undefined).then((st) => {
      const info = st.image.provider ? providerById(st.image.provider) : undefined
      setService(info ? { info, model: st.image.model } : null)
    }).catch(() => setService(null))
  }, [open, aiOpen])

  const withExamples = !!service?.info.references && picked.size > 0
  const generated = battleMapPrompt({ description, setting, cols, rows, light, withExamples })
  const prompt = ownPrompt ?? generated
  const sizeOk = [cols, rows].every((n) => Number.isInteger(n) && n >= GRID_MIN && n <= GRID_MAX)

  const close = () => {
    if (drawn) void call('battlemap:discard', { pendingId: drawn.pendingId }).catch(() => undefined)
    setDrawn(null)
    setOpen(false)
  }
  const draw = async () => {
    setBusy(true); setError(null)
    try {
      if (drawn) void call('battlemap:discard', { pendingId: drawn.pendingId }).catch(() => undefined)
      const ids = withExamples ? [...picked].slice(0, 4) : []
      const r = await call('battlemap:draw', { prompt, styleIds: ids, aspect: aspectFor(cols, rows) })
      setDrawn({ ...r, prompt, cols })
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const keep = async () => {
    if (!drawn) return
    const m = await act('battlemap:keep', { pendingId: drawn.pendingId, name: name.trim() || 'Battle map', cols: drawn.cols, prompt: drawn.prompt, source: drawn.source })
    if (!m) return
    setDrawn(null)
    setOpen(false)
    await act('map:setActive', { mapId: m.id })
    say(`Kept ${m.name}: it is on the Map screen. Undo removes it.`)
    goTo('map')
  }
  const addExamples = async () => {
    const added = await act('style:addDialog', undefined)
    if (added?.length) {
      await loadStyles()
      setPicked((p) => new Set([...p, ...added.map((x) => x.id)].slice(0, 4)))
    }
  }
  const togglePick = (id: string) => setPicked((p) => {
    const next = new Set(p)
    if (next.has(id)) next.delete(id)
    else if (next.size < 4) next.add(id)
    return next
  })

  return (
    <Dialog title="Draw a battle map" open={open} onClose={close} wide>
      {service === undefined ? <p className="hint">Loading…</p> : service === null ? (
        <div className="dz-form">
          <p>Battle maps are drawn by an AI image service. None is chosen yet.</p>
          <div className="dz-actions">
            <button onClick={close}>Close</button>
            <button className="primary" onClick={() => setAiSettingsOpen(true)}>Choose an image service…</button>
          </div>
        </div>
      ) : drawn ? (
        <div className="battle-preview">
          <span className="ai-badge">AI drawing · {drawn.source}</span>
          <div className="battle-preview-frame">
            <img src={drawn.url} alt="The battle map the AI drew" />
            {drawn.width && drawn.height && (
              <svg viewBox={`0 0 ${drawn.width} ${drawn.height}`} preserveAspectRatio="none" aria-hidden="true">
                <GridLines cols={drawn.cols} width={drawn.width} height={drawn.height} scale={0.4} />
              </svg>
            )}
          </div>
          <p className="hint">
            {drawn.width && drawn.height ? `${drawn.cols} × ${rowsFor(drawn.cols, drawn.width, drawn.height)} squares. ` : ''}
            The grid is drawn by the app on top; you can change it later under Scale and grid.
          </p>
          <div className="field">
            <label htmlFor="bm-keep-name">Name</label>
            <input id="bm-keep-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="dz-actions">
            <button onClick={() => { void call('battlemap:discard', { pendingId: drawn.pendingId }).catch(() => undefined); setDrawn(null) }}>Discard</button>
            <button disabled={busy} onClick={() => void draw()}>{busy ? 'Drawing…' : 'Try again'}</button>
            <button className="primary" disabled={busy || !name.trim()} onClick={() => void keep()}>Keep as battle map</button>
          </div>
        </div>
      ) : (
        <div className="dz-form battle-form">
          <p className="hint">Drawn by <strong>{service.info.name}</strong> ({service.model || 'default model'}). <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Change…</button></p>
          <div className="battle-cols">
            <div className="dz-form">
              <div className="field">
                <label htmlFor="bm-name">Name</label>
                <input id="bm-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="bm-desc">What is there</label>
                <textarea id="bm-desc" rows={5} value={description} maxLength={2000}
                  placeholder="A ruined chapel: collapsed roof at the north end, pews in rows, a crypt stair in the south-east corner…"
                  onChange={(e) => { setDescription(e.target.value); setOwnPrompt(null) }} />
                <span className="hint">Started from the scene text or the place's notes. Walls, doors, cover, water, stairs: say where.</span>
              </div>
              <div className="row tight wrap">
                <div className="field">
                  <label htmlFor="bm-setting">Setting</label>
                  <select id="bm-setting" value={setting} onChange={(e) => { setSetting(e.target.value as BattleSetting); setOwnPrompt(null) }}>
                    {BATTLE_SETTINGS.map((x) => <option key={x} value={x}>{x[0].toUpperCase() + x.slice(1)}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="bm-cols">Squares across</label>
                  <input id="bm-cols" className="short" type="number" min={GRID_MIN} max={GRID_MAX} value={cols}
                    onChange={(e) => { setCols(Number(e.target.value)); setOwnPrompt(null) }} />
                </div>
                <div className="field">
                  <label htmlFor="bm-rows">Squares deep</label>
                  <input id="bm-rows" className="short" type="number" min={GRID_MIN} max={GRID_MAX} value={rows}
                    onChange={(e) => { setRows(Number(e.target.value)); setOwnPrompt(null) }} />
                </div>
                <div className="field">
                  <label htmlFor="bm-light">Light</label>
                  <input id="bm-light" value={light} maxLength={120} onChange={(e) => { setLight(e.target.value); setOwnPrompt(null) }} />
                </div>
              </div>
              <span className="hint">{cols * 5} × {rows * 5} feet. Each square is 5 feet.</span>
            </div>
            <div className="dz-form">
              <div className="field">
                <span className="field-label">Style: your example maps {service.info.references ? `(up to 4, ${picked.size} chosen)` : ''}</span>
                {!service.info.references && <span className="hint">{service.info.name} cannot take example maps; it goes by the words only. OpenAI images, Gemini images and Stability can.</span>}
                {styles.length === 0 ? <span className="hint">No example maps yet. Add battle maps whose look you like.</span> : (
                  <ul className="style-list">
                    {styles.map((st) => (
                      <li key={st.id} className={service.info.references && picked.has(st.id) ? 'is-picked' : undefined}>
                        <label className="style-thumb">
                          <input type="checkbox" checked={!!service.info.references && picked.has(st.id)} disabled={!service.info.references || (!picked.has(st.id) && picked.size >= 4)}
                            onChange={() => togglePick(st.id)} aria-label={`Use ${st.name} as a style example`} />
                          <img src={st.url} alt="" />
                        </label>
                        <CommitField id={`style-${st.id}`} label="Name" value={st.name} required className="style-name"
                          onCommit={(v) => void act('style:rename', { id: st.id, name: v }).then(loadStyles)} />
                        <button className="link-button" onClick={() => void act('style:setStatus', { id: st.id, status: 'defunct' }).then(loadStyles)}>Remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                <button onClick={() => void addExamples()}>Add example maps…</button>
              </div>
            </div>
          </div>
          <details className="battle-prompt" open={ownPrompt !== null}>
            <summary>What the AI is told{ownPrompt !== null ? ' (edited)' : ''}</summary>
            <textarea rows={8} value={prompt} maxLength={4000} aria-label="What the AI is told" onChange={(e) => setOwnPrompt(e.target.value)} />
            {ownPrompt !== null && <button className="link-button" onClick={() => setOwnPrompt(null)}>Go back to the generated text</button>}
          </details>
          {error && <p className="field-error" role="alert">{error}</p>}
          <div className="dz-actions">
            <span className="hint">Drawing can take up to a minute. Online services charge per image.</span>
            <button onClick={close}>Cancel</button>
            <button className="primary" disabled={busy || !sizeOk || prompt.trim().length < 10} onClick={() => void draw()}>{busy ? 'Drawing…' : 'Draw it'}</button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
