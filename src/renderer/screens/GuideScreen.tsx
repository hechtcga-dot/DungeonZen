import { DrawExtras, withArtStyle } from '../components/Pictures'
import { useEffect, useMemo, useState } from 'react'
import { useBoard, useUnits } from '../store'
import { kmToShown, shownToKm } from '../../shared/units'
import { call } from '../api'
import { DeskFrame } from '../components/DeskFrame'
import { Candle } from '../art/props'
import { useLightingPref } from '../art/TableLighting'
import { lightingAt } from '../../shared/sky'
import { providerById } from '../../shared/aiProviders'
import { placeLabels } from '../../shared/labels'
import {
  BIOMES, PLACE_KINDS, PLACE_KIND_LABELS, WORLD_CLIMATES, placeColour, worldMapPrompt, type Biome, type PlaceKind, type PlaceShape, type WorldSettings
} from '../../shared/places'
import type { MapView, PendingImageView } from '../../shared/types'

type Step = 'map' | 'regions' | 'notes'
type Way = null | 'import' | 'make' | 'draw'

/**
 * A new campaign starts here (and the Desk can open it again): first a map of the world,
 * imported, made here or drawn by an AI; then its regions; then your notes. Everything it
 * makes can be changed later on the Map and the cards.
 */
export function GuideScreen() {
  const info = useBoard((s) => s.info)
  const desk = useBoard((s) => s.desk)
  const { goTo, act } = useBoard()
  const [lighting] = useLightingPref()
  const [step, setStep] = useState<Step>('map')
  const [map, setMap] = useState<MapView | null>(null)
  const [madeRegions, setMadeRegions] = useState(0)
  // Coming back to the guide with a map already on the desk: offer to go on from it.
  const existing = desk?.map ?? null

  const finish = async (to: 'import' | 'board' | 'desk' | 'map') => {
    if (info?.gettingStarted) await act('guide:finish', undefined)
    useBoard.setState({ info: useBoard.getState().info ? { ...useBoard.getState().info!, gettingStarted: false } : null })
    goTo(to)
  }

  return (
    <DeskFrame>
      <main className="desk guide-screen" aria-label="Getting started">
        <header className="desk-head">
          <Candle className="desk-candle" lit={!lighting || lightingAt(info?.clockMin ?? 0).candlesLit} />
          <div className="desk-title">
            <span className="desk-eyebrow">Getting started · {info?.name}</span>
            <h1>{step === 'map' ? 'First, a map of your world' : step === 'regions' ? 'The lands of your world' : 'Then, your notes'}</h1>
          </div>
          <div className="desk-head-actions">
            <button className="brass" onClick={() => void finish('desk')} title="You can open this guide again from the Desk">Skip the guide</button>
          </div>
        </header>
        <ol className="guide-steps" aria-label="Steps">
          {(['map', 'regions', 'notes'] as Step[]).map((s, i) => (
            <li key={s} className={s === step ? 'is-current' : undefined}>
              <button className="link-button" onClick={() => setStep(s)}>{i + 1}. {s === 'map' ? 'World map' : s === 'regions' ? 'Regions' : 'Your notes'}</button>
            </li>
          ))}
        </ol>
        {step === 'map' && (
          <MapStep existing={existing} onKept={(m, n) => { setMap(m); setMadeRegions(n); setStep('regions') }}
            onUseExisting={() => { setMap(existing); setMadeRegions(0); setStep('regions') }} onSkip={() => setStep('notes')} />
        )}
        {step === 'regions' && (
          <RegionsStep map={map ?? existing} made={madeRegions} onNext={() => setStep('notes')} onDraw={() => void finish('map')} onBack={() => setStep('map')} />
        )}
        {step === 'notes' && <NotesStep onChoose={(to) => void finish(to)} />}
      </main>
    </DeskFrame>
  )
}

// ---------------------------------------------------------------- step 1: the world map

function MapStep({ existing, onKept, onUseExisting, onSkip }: {
  existing: MapView | null; onKept(m: MapView, regions: number): void; onUseExisting(): void; onSkip(): void
}) {
  const { say, act } = useBoard()
  const [way, setWay] = useState<Way>(null)
  const importMap = async () => {
    setWay('import')
    try {
      const m = await act('map:importDialog', undefined)
      if (m) onKept(m, 0)
    } catch (e) { say((e as Error).message, true) }
    setWay(null)
  }
  if (way === 'make') return <MakeMap onKept={onKept} onBack={() => setWay(null)} />
  if (way === 'draw') return <DrawMap onKept={onKept} onBack={() => setWay(null)} />
  return (
    <div className="guide-body">
      <p className="guide-lead">A map anchors the world: every place, person and story can be tied to somewhere on it.
        Start with a rough one; you can rename, redraw and fill in everything later.</p>
      <div className="guide-choices">
        <section className="parchment-sheet guide-choice">
          <h2 className="panel-title">I have a map</h2>
          <p>Use a picture of your own world map: a drawing, a scan or a map from a published setting (PNG, JPEG, WebP or GIF).</p>
          <p className="ink-muted">Next, an AI can find its lands and towns, or you outline them yourself.</p>
          <button className="ink-button primary-ink" disabled={way === 'import'} onClick={() => void importMap()}>Import a map picture…</button>
        </section>
        <section className="parchment-sheet guide-choice">
          <h2 className="panel-title">Make one here</h2>
          <p>Dungeon Zen draws a world for you: seas, forests, mountains, deserts, farmland, cities, towns and villages, each already outlined and named.</p>
          <p className="ink-muted">Free and offline. Roll again until you like it.</p>
          <button className="ink-button primary-ink" onClick={() => setWay('make')}>Make a world map</button>
        </section>
        <section className="parchment-sheet guide-choice">
          <h2 className="panel-title">Have an AI draw one</h2>
          <p>Describe your world and your image service paints the map. An AI can then find its regions.</p>
          <p className="ink-muted">Uses the battle map service in Settings › AI services; online services charge per picture.</p>
          <button className="ink-button primary-ink" onClick={() => setWay('draw')}>Describe and draw…</button>
        </section>
      </div>
      <div className="row tight wrap guide-foot">
        {existing && <button onClick={onUseExisting}>Use the desk map, {existing.name}</button>}
        <button className="link-button" onClick={onSkip}>No map for now</button>
      </div>
    </div>
  )
}

const SIZE_KM: Record<WorldSettings['size'], number> = { small: 1000, medium: 2400, large: 4800 }
const newSeed = () => Math.floor(Math.random() * 2147483647)

function MakeMap({ onKept, onBack }: { onKept(m: MapView, regions: number): void; onBack(): void }) {
  const { say, act } = useBoard()
  const [o, setO] = useState<WorldSettings>({ seed: newSeed(), size: 'medium', land: 0.5, climate: 'temperate', settlements: 10 })
  const [made, setMade] = useState<(PendingImageView & { regions: PlaceShape[] }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('The Known World')
  const units = useUnits()
  const [across, setAcross] = useState(kmToShown(SIZE_KM.medium, units))
  const make = async (settings: WorldSettings) => {
    setO(settings); setBusy(true)
    try {
      if (made) await call('battlemap:discard', { pendingId: made.pendingId })
      setMade(await call('world:generate', settings))
    } catch (e) { say((e as Error).message, true) }
    setBusy(false)
  }
  useEffect(() => { void make(o) }, []) // a first map straight away
  const keep = async () => {
    if (!made) return
    setBusy(true)
    const m = await act('world:keep', { pendingId: made.pendingId, name: name.trim() || 'The Known World', widthKm: across ? shownToKm(across, units) : null })
    setBusy(false)
    if (m) onKept(m, made.regions.length)
  }
  const back = async () => { if (made) await call('battlemap:discard', { pendingId: made.pendingId }); onBack() }
  const counts = useMemo(() => countKinds(made?.regions ?? []), [made])
  return (
    <div className="guide-make">
      <section className="parchment-sheet guide-preview">
        {made ? <PlacePreview url={made.url} width={made.width ?? 2048} height={made.height ?? 1366} regions={made.regions} /> : <div className="guide-wait">Drawing…</div>}
        {made && <p className="ink-muted">{counts}</p>}
      </section>
      <aside className="parchment-note guide-options">
        <h2 className="panel-title">Your world</h2>
        <div className="field"><label htmlFor="w-size">Size</label>
          <select id="w-size" value={o.size} onChange={(e) => { const size = e.target.value as WorldSettings['size']; setAcross(kmToShown(SIZE_KM[size], units)); void make({ ...o, size }) }}>
            <option value="small">Small: one land, fewer places</option><option value="medium">Medium</option><option value="large">Large: many lands</option>
          </select></div>
        <div className="field"><label htmlFor="w-land">Land and sea ({Math.round(o.land * 100)}% land)</label>
          <input id="w-land" type="range" min={0.3} max={0.75} step={0.05} value={o.land} onChange={(e) => setO({ ...o, land: Number(e.target.value) })}
            onMouseUp={() => void make(o)} onKeyUp={() => void make(o)} /></div>
        <div className="field"><label htmlFor="w-climate">Climate</label>
          <select id="w-climate" value={o.climate} onChange={(e) => void make({ ...o, climate: e.target.value as WorldSettings['climate'] })}>
            {WORLD_CLIMATES.map((c) => <option key={c} value={c}>{c === 'cold' ? 'Cold: tundra and ice' : c === 'warm' ? 'Warm: deserts and jungle' : 'Temperate'}</option>)}
          </select></div>
        <div className="field"><label htmlFor="w-towns">Cities, towns and villages</label>
          <input id="w-towns" type="number" min={0} max={30} value={o.settlements} onChange={(e) => setO({ ...o, settlements: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
            onBlur={() => void make(o)} /></div>
        <div className="row tight wrap">
          <button className="ink-button" disabled={busy} onClick={() => void make({ ...o, seed: newSeed() })}>{busy ? 'Drawing…' : 'Roll a new world'}</button>
        </div>
        <hr className="ink-rule" />
        <div className="field"><label htmlFor="w-name">Map name</label><input id="w-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></div>
        <div className="field"><label htmlFor="w-miles">{units === 'imperial' ? 'Miles' : 'Kilometres'} across (for travel times)</label>
          <input id="w-miles" type="number" min={1} max={100000} value={across} onChange={(e) => setAcross(Math.max(0, Number(e.target.value) || 0))} /></div>
        <div className="row tight wrap">
          <button className="primary" disabled={!made || busy} onClick={() => void keep()}>Keep this map</button>
          <button onClick={() => void back()}>Back</button>
        </div>
        <p className="ink-muted">Keeping it adds the map to the desk and a Location card for every region (one undo step).</p>
      </aside>
    </div>
  )
}

function DrawMap({ onKept, onBack }: { onKept(m: MapView, regions: number): void; onBack(): void }) {
  const { say, act, setAiSettingsOpen, aiSettingsOpen } = useBoard()
  const [description, setDescription] = useState('')
  const [climate, setClimate] = useState<WorldSettings['climate']>('temperate')
  const [style, setStyle] = useState<'painted' | 'parchment'>('painted')
  const [prompt, setPrompt] = useState<string | null>(null)
  const [drawn, setDrawn] = useState<(PendingImageView & { source: string }) | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('The Known World')
  const [service, setService] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (aiSettingsOpen) return
    call('ai:settings', undefined).then((st) => {
      const p = st.image.provider ? providerById(st.image.provider) : undefined
      setService(p ? `${p.name}${st.image.model ? ` (${st.image.model})` : ''}` : null)
    }).catch(() => setService(null))
  }, [aiSettingsOpen])
  const artStyle = useBoard((st) => st.info?.artStyle ?? '')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const told = prompt ?? withArtStyle(worldMapPrompt({ description, climate, style }), artStyle)
  const draw = async () => {
    setBusy(true); setError(null)
    try {
      if (drawn) await call('battlemap:discard', { pendingId: drawn.pendingId })
      setDrawn(await call('world:draw', { prompt: told, styleIds: [...picked] }))
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const keep = async () => {
    if (!drawn) return
    try {
      const m = await act('world:keep', { pendingId: drawn.pendingId, name: name.trim() || 'The Known World', widthKm: null })
      if (m) onKept(m, 0)
    } catch (e) { say((e as Error).message, true) }
  }
  const back = async () => { if (drawn) await call('battlemap:discard', { pendingId: drawn.pendingId }); onBack() }
  return (
    <div className="guide-make">
      <section className="parchment-sheet guide-preview">
        {drawn ? (
          <>
            <img className="guide-picture" src={drawn.url} alt="The world map the AI drew" />
            <p className="ai-tag">Drawn by {drawn.source}</p>
          </>
        ) : <div className="guide-wait">{busy ? 'Drawing… (this can take a minute)' : 'The map appears here.'}</div>}
      </section>
      <aside className="parchment-note guide-options">
        <h2 className="panel-title">Describe your world</h2>
        <div className="field"><label htmlFor="d-desc">What is it like?</label>
          <textarea id="d-desc" rows={4} value={description} maxLength={1500} placeholder="A long northern coast with a mountain spine, a great inland forest, a desert empire in the south…"
            onChange={(e) => { setDescription(e.target.value); setPrompt(null) }} /></div>
        <div className="row tight wrap">
          <div className="field"><label htmlFor="d-climate">Climate</label>
            <select id="d-climate" value={climate} onChange={(e) => { setClimate(e.target.value as WorldSettings['climate']); setPrompt(null) }}>
              {WORLD_CLIMATES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
            </select></div>
          <div className="field"><label htmlFor="d-style">Style</label>
            <select id="d-style" value={style} onChange={(e) => { setStyle(e.target.value as 'painted' | 'parchment'); setPrompt(null) }}>
              <option value="painted">Painted</option><option value="parchment">Inked parchment</option>
            </select></div>
        </div>
        <DrawExtras use="maps" prompt={told} onPrompt={setPrompt} onReset={() => setPrompt(null)} picked={picked} onPicked={setPicked} />
        {service === null ? (
          <p>Drawing needs an image service. <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose an AI service…</button></p>
        ) : (
          <p className="ink-muted">{service ?? '…'} draws it.</p>
        )}
        <div className="row tight wrap">
          <button className="ink-button" disabled={busy || !service} onClick={() => void draw()}>{busy ? 'Drawing…' : drawn ? 'Try again' : 'Draw the map'}</button>
        </div>
        {error && <p className="field-error" role="alert">{error}</p>}
        <hr className="ink-rule" />
        <div className="field"><label htmlFor="d-name">Map name</label><input id="d-name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} /></div>
        <div className="row tight wrap">
          <button className="primary" disabled={!drawn || busy} onClick={() => void keep()}>Keep this map</button>
          <button onClick={() => void back()}>Back</button>
        </div>
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------- step 2: regions

function RegionsStep({ map, made, onNext, onDraw, onBack }: { map: MapView | null; made: number; onNext(): void; onDraw(): void; onBack(): void }) {
  if (!map) {
    return (
      <div className="guide-body">
        <p className="guide-lead">There is no map yet. Regions are drawn on a map.</p>
        <div className="row tight wrap"><button className="primary" onClick={onBack}>Choose a map</button><button onClick={onNext}>Go on without one</button></div>
      </div>
    )
  }
  if (made > 0) {
    return (
      <div className="guide-body">
        <section className="parchment-sheet guide-done">
          <h2 className="panel-title">{map.name} is on the desk</h2>
          <p>It came with {made} regions: seas, lands by terrain and settlements, each with its own Location card on the board.
            On the Map, click a region to rename it, change its kind or land, write notes, or redraw its edges.</p>
          <div className="row tight wrap"><button className="primary" onClick={onNext}>Next: your notes</button><button onClick={onDraw}>Open the map now</button></div>
        </section>
      </div>
    )
  }
  return <FindRegions map={map} onNext={onNext} onDraw={onDraw} />
}

function FindRegions({ map, onNext, onDraw }: { map: MapView; onNext(): void; onDraw(): void }) {
  const { act, say, setAiSettingsOpen, aiSettingsOpen } = useBoard()
  const [ask, setAsk] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<{ regions: PlaceShape[]; dropped: number; source: string } | null>(null)
  const [picked, setPicked] = useState<boolean[]>([])
  const [added, setAdded] = useState(0)
  const [service, setService] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (aiSettingsOpen) return
    call('ai:settings', undefined).then((st) => {
      const p = st.text.provider ? providerById(st.text.provider) : undefined
      setService(p ? `${p.name}${st.text.model ? ` (${st.text.model})` : ''}` : null)
    }).catch(() => setService(null))
  }, [aiSettingsOpen])
  const find = async () => {
    setBusy(true); setError(null)
    try {
      const f = await call('world:findRegions', { mapId: map.id, ask })
      setFound(f); setPicked(f.regions.map(() => true))
      if (!f.regions.length) setError('The AI found no regions it could outline. Try again, add a hint, or draw them yourself.')
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const edit = (i: number, patch: Partial<PlaceShape>) => setFound((f) => f && { ...f, regions: f.regions.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const addSelected = async () => {
    if (!found) return
    // Renumber parents among the ticked ones; a parent left out leaves its child on its own.
    const index = new Map<number, number>()
    const chosen: PlaceShape[] = []
    found.regions.forEach((r, i) => {
      if (!picked[i] || !r.name.trim()) return
      index.set(i, chosen.length)
      chosen.push({ ...r, parent: r.parent != null ? index.get(r.parent) ?? null : null })
    })
    if (!chosen.length) return
    try {
      await act('world:addRegions', { mapId: map.id, regions: chosen, source: found.source })
      setAdded(chosen.length); setFound(null)
    } catch (e) { say((e as Error).message, true) }
  }
  const shown = found ? found.regions.filter((_, i) => picked[i]) : []
  return (
    <div className="guide-make">
      <section className="parchment-sheet guide-preview">
        <PlacePreview url={map.url} width={map.width ?? 1000} height={map.height ?? 700} regions={shown} ai />
        {found && <p className="ai-tag">Found by {found.source}{found.dropped ? ` · ${found.dropped} outline${found.dropped === 1 ? '' : 's'} could not be read` : ''}</p>}
      </section>
      <aside className="parchment-note guide-options">
        <h2 className="panel-title">Mark out the lands</h2>
        {added > 0 && <p role="status">Added {added} regions to {map.name}, each with a Location card. Undo takes them all back.</p>}
        {!found && (
          <>
            <p>An AI can look at the map and outline its seas, lands (forest, mountains, desert…) and towns. You choose which to keep.</p>
            <div className="field"><label htmlFor="r-ask">Anything it should know? (optional)</label>
              <input id="r-ask" value={ask} maxLength={600} placeholder="The red dots are cities; the big forest is the Elderwood" onChange={(e) => setAsk(e.target.value)} /></div>
            {service === null ? (
              <p>This needs a writing AI that can see pictures. <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose an AI service…</button></p>
            ) : <p className="ink-muted">{service ?? '…'} looks at the map once. It must be a model that can see images.</p>}
            <div className="row tight wrap">
              <button className="ink-button primary-ink" disabled={busy || !service} onClick={() => void find()}>{busy ? 'Looking at the map…' : 'Find regions with AI'}</button>
            </div>
          </>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
        {found && found.regions.length > 0 && (
          <>
            <p className="ink-muted">AI suggestions: tick the ones to keep. You can rename them now or later.</p>
            <ul className="guide-proposals">
              {found.regions.map((r, i) => (
                <li key={i} className={picked[i] ? undefined : 'is-off'}>
                  <input type="checkbox" checked={!!picked[i]} aria-label={`Keep ${r.name}`} onChange={(e) => setPicked((p) => p.map((x, j) => (j === i ? e.target.checked : x)))} />
                  <span className="swatch" style={{ background: placeColour({ colour: null, kind: r.kind, biome: r.biome }) ?? 'transparent' }} />
                  <input value={r.name} maxLength={200} aria-label="Name" onChange={(e) => edit(i, { name: e.target.value })} />
                  <select value={r.kind} aria-label="Kind of place" onChange={(e) => edit(i, { kind: e.target.value as PlaceKind })}>
                    {PLACE_KINDS.map((k) => <option key={k} value={k}>{PLACE_KIND_LABELS[k]}</option>)}
                  </select>
                  <select value={r.biome ?? ''} aria-label="Land" onChange={(e) => edit(i, { biome: (e.target.value || null) as Biome | null })}>
                    <option value="">Land: not set</option>
                    {BIOMES.map((b) => <option key={b} value={b}>{b[0].toUpperCase() + b.slice(1)}</option>)}
                  </select>
                </li>
              ))}
            </ul>
            <div className="row tight wrap">
              <button className="primary" disabled={!picked.some(Boolean)} onClick={() => void addSelected()}>Add {picked.filter(Boolean).length} selected</button>
              <button onClick={() => setPicked(found.regions.map(() => true))}>Tick all</button>
              <button onClick={() => { setFound(null); setError(null) }}>Discard</button>
            </div>
          </>
        )}
        <hr className="ink-rule" />
        <div className="row tight wrap">
          <button onClick={onDraw}>Draw them myself on the Map</button>
          <button className={added ? 'primary' : undefined} onClick={onNext}>Next: your notes</button>
        </div>
      </aside>
    </div>
  )
}

// ---------------------------------------------------------------- step 3: notes

function NotesStep({ onChoose }: { onChoose(to: 'import' | 'board' | 'desk'): void }) {
  return (
    <div className="guide-body">
      <p className="guide-lead">Now bring in what you already have, or start fresh.</p>
      <div className="guide-choices">
        <section className="parchment-sheet guide-choice">
          <h2 className="panel-title">Import my notes</h2>
          <p>Drop Word files, PDFs, text, or photos of handwritten notes. An AI reads them and proposes cards: people, places, factions, quests,
            storylines and how they connect. Places it finds can be matched to your regions. You decide what to keep.</p>
          <button className="ink-button primary-ink" onClick={() => onChoose('import')}>Import notes…</button>
        </section>
        <section className="parchment-sheet guide-choice">
          <h2 className="panel-title">Start on the board</h2>
          <p>An empty detective board (with your places already pinned up). Add people, places and clues by hand, and string them together.</p>
          <button className="ink-button primary-ink" onClick={() => onChoose('board')}>Open the board</button>
        </section>
        <section className="parchment-sheet guide-choice">
          <h2 className="panel-title">Go to the desk</h2>
          <p>The DM desk: the clock, the map, the party and your storylines. The guide stays on the desk under "Getting started".</p>
          <button className="ink-button primary-ink" onClick={() => onChoose('desk')}>Go to the desk</button>
        </section>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- shared

function countKinds(regions: PlaceShape[]): string {
  const n = (k: PlaceKind) => regions.filter((r) => r.kind === k).length
  const towns = n('city') + n('town') + n('village')
  return `${n('region')} lands, ${n('sea')} seas and lakes, ${towns} settlement${towns === 1 ? '' : 's'}. Names and borders can be changed later.`
}

/** A map picture with proposed places drawn over it (not saved yet). */
function PlacePreview({ url, width, height, regions, ai }: { url: string; width: number; height: number; regions: PlaceShape[]; ai?: boolean }) {
  const scale = width / 1000
  const isSpot = (r: PlaceShape) => ['city', 'town', 'village', 'landmark', 'dungeon'].includes(r.kind)
  const at = placeLabels(regions.map((r) => ({ polygon: r.polygon, name: r.name, spot: isSpot(r) })), scale, 17, 15)
  return (
    <div className="place-preview">
      <img src={url} alt="World map" />
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {regions.map((r, i) => {
          const spot = isSpot(r)
          const colour = placeColour({ colour: null, kind: r.kind, biome: r.biome }) ?? '#6b5a3a'
          const [cx, cy] = at[i]
          return (
            <g key={i}>
              <polygon points={r.polygon.map((p) => p.join(',')).join(' ')} fill={colour} fillOpacity={spot ? 0.5 : 0.12}
                stroke={ai ? '#2f5f9a' : '#3a2a18'} strokeOpacity={0.7} strokeWidth={1.6 * scale} strokeDasharray={ai ? `${6 * scale} ${4 * scale}` : undefined} />
              {spot && <circle cx={cx} cy={cy} r={(r.kind === 'city' ? 9 : r.kind === 'town' ? 7 : 5) * scale} fill={colour} stroke="#f4ead2" strokeWidth={2 * scale} />}
              <text x={cx} y={spot ? cy + 26 * scale : cy + 6 * scale} textAnchor="middle" fontSize={(spot ? 15 : r.kind === 'sea' ? 20 : 17) * scale}
                fontStyle={spot ? 'normal' : 'italic'} fill="#2a1f12" stroke="#f4ead2" strokeWidth={4 * scale} paintOrder="stroke">{r.name}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
