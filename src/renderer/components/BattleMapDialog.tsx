import { useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import { CommitField } from './fields'
import { GridLines } from './MapOverlay'
import { call } from '../api'
import { useBoard, useUnits } from '../store'
import { maxReferences, providerById, type AiProviderInfo } from '../../shared/aiProviders'
import { withArtStyle } from './Pictures'
import {
  ART_STYLES, aspectFor, BATTLE_FEATURES, BATTLE_SETTINGS, battleMapPrompt, defaultFeatures, FEATURE_KEYS, GRID_MAX, GRID_MIN, guessTerrain, MOODS,
  rowsFor, SEASONS, settingFor, TERRAINS, TIMES_OF_DAY, WEATHERS, type BattleMapSpec, type BattleSetting
} from '../../shared/battlemap'
import type { PendingImageView, StyleExampleView } from '../../shared/types'
import { fmtSquares } from '../../shared/units'

type Drawn = PendingImageView & { source: string; prompt: string; cols: number }
type Spec = Omit<BattleMapSpec, 'withExamples'>

const START: Spec = {
  description: '', setting: 'outdoors', terrain: 'any', cols: 20, rows: 20, timeOfDay: 'day', weather: 'clear',
  season: 'any', mood: 'neutral', style: 'painted', features: defaultFeatures('outdoors'), extra: ''
}
const cap = (x: string) => x[0].toUpperCase() + x.slice(1)

/** A drop-down for one of the spec's word lists. */
function Choice<K extends keyof Spec>({ id, label, k, options, spec, set, auto }: {
  id: string; label: string; k: K; options: readonly string[]; spec: Spec; set(patch: Partial<Spec>): void; auto?: { value: Spec[K]; from: string }
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={String(spec[k])} onChange={(e) => set({ [k]: e.target.value } as Partial<Spec>)}>
        {options.map((x) => <option key={x} value={x}>{cap(x)}</option>)}
      </select>
      {auto && (auto.value === spec[k]
        ? <span className="hint auto-hint">From {auto.from}</span>
        : <button type="button" className="link-button auto-hint" onClick={() => set({ [k]: auto.value } as Partial<Spec>)}>Back to {String(auto.value)} ({auto.from})</button>)}
    </div>
  )
}

/**
 * Draw a battle map with the chosen image service. The request is built from fixed
 * rules (top-down, square grid, size) plus the scene; the DM sees and can edit it.
 * The picture stays a preview until the DM keeps it (rule 2).
 */
export function BattleMapDialog() {
  const units = useUnits()
  const open = useBoard((s) => s.battleMapOpen)
  const setOpen = useBoard((s) => s.setBattleMapOpen)
  const setAiSettingsOpen = useBoard((s) => s.setAiSettingsOpen)
  const aiOpen = useBoard((s) => s.aiSettingsOpen)
  const { act, say, goTo } = useBoard()
  const artStyle = useBoard((s) => s.info?.artStyle ?? '')

  const [service, setService] = useState<{ info: AiProviderInfo; model: string } | null | undefined>(undefined)
  const [styles, setStyles] = useState<StyleExampleView[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [name, setName] = useState('Battle map')
  const [spec, setSpec] = useState<Spec>(START)
  // What the app filled in, so the DM can see it and go back to it after a change.
  const [auto, setAuto] = useState<Pick<Spec, 'description' | 'timeOfDay' | 'terrain' | 'setting'>>(START)
  const [ownPrompt, setOwnPrompt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drawn, setDrawn] = useState<Drawn | null>(null)

  const set = (patch: Partial<Spec>) => { setSpec((cur) => ({ ...cur, ...patch })); setOwnPrompt(null) }
  const { cols, rows } = spec
  const loadStyles = async () => {
    const list = await call('style:list', { use: 'battle' })
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
        const terrain = guessTerrain(`${ctx.placeName ?? ''} ${ctx.description}`)
        const setting = settingFor(terrain)
        const filled = { description: ctx.description, timeOfDay: ctx.timeOfDay, terrain, setting }
        setAuto(filled)
        setSpec((cur) => ({
          ...cur, ...filled, features: defaultFeatures(setting),
          weather: setting === 'indoors' || setting === 'underground' ? 'indoors (none)' : cur.weather === 'indoors (none)' ? 'clear' : cur.weather
        }))
        setName(ctx.placeName ? `${ctx.placeName} battle map` : 'Battle map')
        setPicked(new Set(list.map((x) => x.id)))
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

  const maxRefs = maxReferences(service?.info)
  const withExamples = maxRefs > 0 && picked.size > 0
  const generated = withArtStyle(battleMapPrompt({ ...spec, withExamples }), artStyle)
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
      const ids = withExamples ? [...picked].slice(0, maxRefs) : []
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
  const importOwn = async () => {
    const m = await act('battlemap:importDialog', { cols: sizeOk ? cols : 20 })
    if (!m) return
    close()
    await act('map:setActive', { mapId: m.id })
    say(`Imported ${m.name} with a ${m.gridCols}-square grid: change it under Scale and grid. Undo removes it.`)
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
            <button onClick={() => void importOwn()}>Import a battle map…</button>
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
          <p className="hint">Drawn by <strong>{service.info.name}</strong> ({service.model || 'default model'}). <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Change…</button>
            {' · '}Already have one? <button className="link-button" onClick={() => void importOwn()}>Import a battle map…</button></p>
          <div className="battle-cols">
            <div className="dz-form">
              <div className="field">
                <label htmlFor="bm-name">Name</label>
                <input id="bm-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="bm-desc">Description of the setting</label>
                <textarea id="bm-desc" rows={4} value={spec.description} maxLength={2000}
                  placeholder="A ruined chapel: collapsed roof at the north end, pews in rows, a crypt stair in the south-east corner…"
                  onChange={(e) => set({ description: e.target.value })} />
                {auto.description && spec.description !== auto.description
                  ? <button type="button" className="link-button auto-hint" onClick={() => set({ description: auto.description })}>Back to the scene text</button>
                  : <span className="hint">{auto.description ? 'From the scene text or the place\'s notes. ' : ''}Walls, doors, cover, water, stairs: say where.</span>}
              </div>
              <div className="battle-grid-fields">
                <Choice id="bm-setting" label="Setting" k="setting" options={BATTLE_SETTINGS} spec={spec} auto={{ value: auto.setting, from: 'the place' }}
                  set={(p) => set({ ...p, features: defaultFeatures(p.setting as BattleSetting) })} />
                <Choice id="bm-terrain" label="Terrain" k="terrain" options={TERRAINS} spec={spec} set={set} auto={{ value: auto.terrain, from: 'the description' }} />
                <Choice id="bm-time" label="Time of day" k="timeOfDay" options={TIMES_OF_DAY} spec={spec} set={set} auto={{ value: auto.timeOfDay, from: 'the clock' }} />
                <Choice id="bm-weather" label="Weather" k="weather" options={WEATHERS} spec={spec} set={set} />
                <Choice id="bm-season" label="Season" k="season" options={SEASONS} spec={spec} set={set} />
                <Choice id="bm-mood" label="Mood" k="mood" options={MOODS} spec={spec} set={set} />
                <Choice id="bm-style" label="Art style" k="style" options={ART_STYLES} spec={spec} set={set} />
                <div className="field">
                  <label htmlFor="bm-cols">Size in squares</label>
                  <div className="row tight">
                    <input id="bm-cols" className="short" type="number" min={GRID_MIN} max={GRID_MAX} value={cols} aria-label="Squares across"
                      onChange={(e) => set({ cols: Number(e.target.value) })} />
                    <span aria-hidden="true">×</span>
                    <input id="bm-rows" className="short" type="number" min={GRID_MIN} max={GRID_MAX} value={rows} aria-label="Squares deep"
                      onChange={(e) => set({ rows: Number(e.target.value) })} />
                  </div>
                  <span className="hint">{fmtSquares(cols, units)} × {fmtSquares(rows, units)}</span>
                </div>
              </div>
              <fieldset className="field battle-features">
                <legend>Include <button type="button" className="link-button" onClick={() => set({ features: defaultFeatures(spec.setting) })}>usual for {spec.setting}</button>
                  {' · '}<button type="button" className="link-button" onClick={() => set({ features: [] })}>none</button></legend>
                <div className="toggle-chips">
                  {FEATURE_KEYS.map((f) => {
                    const on = spec.features.includes(f)
                    return (
                      <button key={f} type="button" className="toggle-chip" aria-pressed={on}
                        onClick={() => set({ features: on ? spec.features.filter((x) => x !== f) : [...spec.features, f] })}>
                        {BATTLE_FEATURES[f].label}
                      </button>
                    )
                  })}
                </div>
              </fieldset>
              <div className="field">
                <label htmlFor="bm-extra">Anything else</label>
                <input id="bm-extra" value={spec.extra} maxLength={600} placeholder="A broken statue in the middle, the north wall half collapsed…"
                  onChange={(e) => set({ extra: e.target.value })} />
              </div>
            </div>
            <div className="dz-form">
              <div className="field">
                <span className="field-label">Style examples for battle maps (Library pictures) {maxRefs ? `(${service.info.name} takes up to ${maxRefs}; ${picked.size} ticked)` : `(${service.info.name} can't see examples: the style goes in words only)`}</span>
                {!service.info.references && <span className="hint">{service.info.name} cannot take example maps; it goes by the words only. OpenAI images, Gemini images and Stability can.</span>}
                {styles.length === 0 ? <span className="hint">No Library pictures are ticked for battle maps. Add battle maps whose look you like.</span> : (
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
                <button onClick={() => void addExamples()}>Add pictures to the Library…</button>
              </div>
            </div>
          </div>
          <details className="battle-prompt" open={ownPrompt !== null}>
            <summary>Prompt being sent to the AI{ownPrompt !== null ? ' (edited)' : ' (open to read and change it)'}</summary>
            <textarea rows={8} value={prompt} maxLength={4000} aria-label="Prompt being sent to the AI" onChange={(e) => setOwnPrompt(e.target.value)} />
            {ownPrompt !== null && <button className="link-button" onClick={() => setOwnPrompt(null)}>Go back to the generated text</button>}
          </details>
          {error && (
            <div className="field-error battle-error" role="alert">
              <span>{error}</span>
              <span className="row tight">
                <button disabled={busy || !sizeOk} onClick={() => void draw()}>{busy ? 'Drawing…' : 'Try again'}</button>
                <button onClick={() => setAiSettingsOpen(true)}>AI services…</button>
              </span>
            </div>
          )}
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
