import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { Dialog } from './Dialog'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { OpenFolder } from './OpenFolder'
import { ENTITY_LABELS } from '../entityStyle'
import { canvasPng, drawToken, loadTokenPicture, type TokenPicture } from '../token'
import {
  DEFAULT_TOKEN_SETTINGS, TOKEN_BORDERS, TOKEN_BORDER_LABELS, TOKEN_SIZE_MAX, TOKEN_SIZE_MIN, TOKEN_TYPES, TOKEN_WIDTH_MAX, TOKEN_WIDTH_MIN,
  type TokenBorder, type TokenSettings, type TokenSpec
} from '../../shared/token'
import type { EntityType } from '../../shared/schemas'
import type { TokenView } from '../../shared/types'

// ---- drawing token files in the background ------------------------------------------------------------------

const drawnListeners = new Set<() => void>()
/** Runs `fn` whenever new token files were drawn (Library › Tokens, sheets and Roll20 show them then). */
export function useTokensDrawn(fn: () => void) {
  useEffect(() => { drawnListeners.add(fn); return () => { drawnListeners.delete(fn) } }, [fn])
}

let syncing = false
let again = false
/** Draws the token of every card that has none for its current picture and look (one at a time). */
export async function syncTokens(): Promise<void> {
  if (syncing) { again = true; return }
  syncing = true
  try {
    do {
      again = false
      const missing = (await call('token:list', undefined)).filter((t) => !t.exists)
      let drew = false
      for (const t of missing) {
        try {
          const pic = await loadTokenPicture(await call('token:source', { entityId: t.entityId }))
          const c = document.createElement('canvas')
          drawToken(c, pic, t.spec)
          await call('token:write', { entityId: t.entityId, key: t.key, png: canvasPng(c) })
          drew = true
        } catch { /* a picture that cannot be read: no token, the next change tries again */ }
      }
      if (drew) drawnListeners.forEach((f) => f())
    } while (again)
  } catch { /* no campaign open: nothing to draw */ } finally { syncing = false }
}

/** Keeps token files up to date after every change (mounted once, in the main window). */
export function useTokenSync() {
  const view = useBoard((s) => s.view)
  useEffect(() => {
    if (!view) return
    const t = setTimeout(() => void syncTokens(), 400)
    return () => clearTimeout(t)
  }, [view])
}

/** The token list, refreshed after changes and when new files are drawn. */
export function useTokens(): TokenView[] | null {
  const view = useBoard((s) => s.view)
  const [list, setList] = useState<TokenView[] | null>(null)
  const [tick, setTick] = useState(0)
  useTokensDrawn(useRef(() => setTick((n) => n + 1)).current)
  useEffect(() => { void call('token:list', undefined).then(setList).catch(() => setList([])) }, [view, tick])
  return list
}

// ---- right-click menu ---------------------------------------------------------------------------------------

/** Edit, Copy, Save as, Open folder, Delete (to History) for one token. */
export function tokenMenu(t: TokenView, onEdit: () => void): MenuItem[] {
  const { act, say } = useBoard.getState()
  const ready = t.exists
  const hint = ready ? undefined : 'Still being drawn'
  return [
    { label: 'Edit token…', onClick: onEdit },
    { label: 'Copy', disabled: !ready, hint, onClick: () => void call('token:copy', { entityId: t.entityId }).then(() => say(`Copied the token of ${t.name}`)).catch((e: Error) => say(e.message, true)) },
    { label: 'Save as…', disabled: !ready, hint, onClick: () => void call('token:saveAs', { entityId: t.entityId }).then((f) => { if (f) say(`Saved ${f}`) }).catch((e: Error) => say(e.message, true)) },
    { label: 'Open tokens folder', onClick: () => void act('campaign:openFolder', { sub: 'tokens' }) },
    'separator',
    { label: 'Delete token', danger: true, hint: 'Goes to History; Ctrl+Z brings it back', onClick: () => void act('token:setRemoved', { entityId: t.entityId, removed: true }).then(() => say(`The token of ${t.name} is in History`)) }
  ]
}

/** A token picture: click edits, right-click shows the menu, drags out to Roll20 as its file. */
export function TokenImage({ token, size = 96 }: { token: TokenView; size?: number }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const onMenu = (e: ReactMouseEvent) => { e.preventDefault(); e.stopPropagation(); setMenu({ x: e.clientX, y: e.clientY }) }
  return (
    <>
      <button type="button" className="token-image" style={{ width: size, height: size }} title={`Token of ${token.name}: click to edit, right-click for more, drag to Roll20`}
        onClick={() => setEditing(true)} onContextMenu={onMenu}>
        {token.exists ? <img src={token.url} alt={`Token of ${token.name}`} draggable /> : <span className="token-drawing">Drawing…</span>}
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={tokenMenu(token, () => setEditing(true))} onClose={() => setMenu(null)} />}
      {editing && <TokenEditor token={token} onClose={() => setEditing(false)} />}
    </>
  )
}

// ---- the token window ---------------------------------------------------------------------------------------

/** Edit one card's token: border, tint, background, framing, size. Saves for this card only. */
export function TokenEditor({ token, onClose }: { token: TokenView; onClose(): void }) {
  const { act, say } = useBoard()
  const [pic, setPic] = useState<TokenPicture | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [spec, setSpec] = useState<TokenSpec>(token.spec)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null)
  useEffect(() => {
    call('token:source', { entityId: token.entityId }).then(loadTokenPicture).then(setPic).catch((e: Error) => setError(e.message))
  }, [token.entityId])
  useEffect(() => {
    if (!pic || !canvas.current) return
    const f = requestAnimationFrame(() => canvas.current && drawToken(canvas.current, pic, spec))
    return () => cancelAnimationFrame(f)
  }, [pic, spec])
  const set = (patch: Partial<TokenSpec>) => setSpec((s) => ({ ...s, ...patch }))
  const PREVIEW = 320
  const save = async () => { await act('token:set', { entityId: token.entityId, spec }); say(`Saved the token of ${token.name} (this card only)`); onClose() }

  return (
    <Dialog title={`Token of ${token.name}`} open onClose={onClose} wide>
      {error ? <p className="field-error">{error}</p> : (
        <div className="token-editor">
          <div className="token-preview">
            <canvas ref={canvas} style={{ width: PREVIEW, height: PREVIEW }} aria-label="Token preview: drag to move the picture, scroll to zoom"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, dx: spec.dx, dy: spec.dy } }}
              onPointerMove={(e) => { const d = drag.current; if (d) set({ dx: clamp(d.dx + (e.clientX - d.x) / PREVIEW, -2, 2), dy: clamp(d.dy + (e.clientY - d.y) / PREVIEW, -2, 2) }) }}
              onPointerUp={() => { drag.current = null }}
              onWheel={(e) => set({ zoom: clamp(Math.round(spec.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08) * 100) / 100, 0.2, 5) })} />
            {!pic && <p className="hint">Loading the picture…</p>}
            <p className="hint">Drag the picture to move it, scroll to zoom.</p>
          </div>
          <div className="token-controls">
            <span className="field-label">Border</span>
            <div className="token-borders" role="radiogroup" aria-label="Border">
              {TOKEN_BORDERS.map((b) => <BorderChoice key={b} border={b} pic={pic} spec={spec} on={spec.border === b} onPick={() => set({ border: b })} />)}
            </div>
            <label className="field">
              <span className="field-label">Border thickness {spec.width}%</span>
              <input type="range" min={TOKEN_WIDTH_MIN} max={TOKEN_WIDTH_MAX} step={0.5} value={spec.width} disabled={spec.border === 'none'}
                onChange={(e) => set({ width: Number(e.target.value) })} />
            </label>
            <div className="row tight wrap">
              <label className="field checkbox"><input type="checkbox" checked={spec.tint !== null} disabled={spec.border === 'none'}
                onChange={(e) => set({ tint: e.target.checked ? '#3b6fd8' : null })} /> Border tint</label>
              {spec.tint !== null && <input type="color" aria-label="Border tint colour" value={spec.tint} onChange={(e) => set({ tint: e.target.value })} />}
            </div>
            <span className="field-label">Background</span>
            <div className="row tight wrap" role="radiogroup" aria-label="Background">
              <label className="field checkbox"><input type="radio" name="tk-bg" checked={spec.bg === null} onChange={() => set({ bg: null })} />
                Matched to the picture <span className="token-swatch" style={{ background: pic?.fit.bg }} aria-hidden="true" /></label>
              <label className="field checkbox"><input type="radio" name="tk-bg" checked={spec.bg !== null} onChange={() => set({ bg: pic?.fit.bg ?? '#d8c8a8' })} /> My colour</label>
              {spec.bg !== null && <input type="color" aria-label="Background colour" value={spec.bg} onChange={(e) => set({ bg: e.target.value })} />}
            </div>
            <span className="field-label">Fit in the circle</span>
            <div className="segmented" role="radiogroup" aria-label="Fit in the circle">
              <button type="button" aria-pressed={spec.fit === 'body'} onClick={() => set({ fit: 'body', zoom: 1, dx: 0, dy: 0 })}>Whole body</button>
              <button type="button" aria-pressed={spec.fit === 'head'} onClick={() => set({ fit: 'head', zoom: 1, dx: 0, dy: 0 })}>Head and body</button>
            </div>
            <label className="field">
              <span className="field-label">Zoom {Math.round(spec.zoom * 100)}%</span>
              <input type="range" min={0.3} max={3} step={0.01} value={spec.zoom} onChange={(e) => set({ zoom: Number(e.target.value) })} />
            </label>
            <button type="button" className="link-button" disabled={spec.zoom === 1 && spec.dx === 0 && spec.dy === 0} onClick={() => set({ zoom: 1, dx: 0, dy: 0 })}>Fit again (automatic)</button>
            <label className="field">
              <span className="field-label">Size {spec.size} × {spec.size} px</span>
              <input type="range" min={TOKEN_SIZE_MIN} max={TOKEN_SIZE_MAX} step={64} value={spec.size} onChange={(e) => set({ size: Number(e.target.value) })} />
            </label>
            <p className="hint">Roll20 shows a token 70 px per square; 512 stays sharp on large creatures and when zoomed in.</p>
          </div>
          <div className="dz-actions">
            {token.own && <button type="button" title={`Back to the ${ENTITY_LABELS[token.type as EntityType]} default from Token settings`}
              onClick={() => void act('token:set', { entityId: token.entityId, spec: null }).then(onClose)}>Use the {ENTITY_LABELS[token.type as EntityType]} default</button>}
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="button" className="primary" disabled={!pic} onClick={() => void save()} title="Saves for this card only">Save token</button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** One border in the picker: a small token of this card with that border. */
function BorderChoice({ border, pic, spec, on, onPick }: { border: TokenBorder; pic: TokenPicture | null; spec: TokenSpec; on: boolean; onPick(): void }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => { if (pic && ref.current) drawToken(ref.current, pic, { ...spec, border, tint: border === 'none' ? null : spec.tint, size: 128 }) },
    [pic, border, spec.tint, spec.bg, spec.fit, spec.zoom, spec.dx, spec.dy]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button type="button" role="radio" aria-checked={on} className={`token-border${on ? ' is-on' : ''}`} title={TOKEN_BORDER_LABELS[border]} onClick={onPick}>
      <canvas ref={ref} style={{ width: 56, height: 56 }} aria-hidden="true" />
      <span>{TOKEN_BORDER_LABELS[border]}</span>
    </button>
  )
}

// ---- token settings -----------------------------------------------------------------------------------------

/** Token settings: what dragging a portrait gives, default size, border and tint per card type. */
export function TokenSettingsDialog({ onClose }: { onClose(): void }) {
  const { act, info, say } = useBoard()
  const [s, setS] = useState<TokenSettings>(info?.tokens ?? DEFAULT_TOKEN_SETTINGS)
  const type = (t: (typeof TOKEN_TYPES)[number], patch: Partial<TokenSettings['types'][typeof t]>) => setS({ ...s, types: { ...s.types, [t]: { ...s.types[t], ...patch } } })
  return (
    <Dialog title="Token settings" open onClose={onClose}>
      <fieldset className="field">
        <legend className="field-label">Dragging a PC, NPC or monster picture out of Dungeon Zen (to Roll20) gives</legend>
        <label className="field checkbox"><input type="radio" name="tk-drag" checked={s.drag === 'token'} onChange={() => setS({ ...s, drag: 'token' })} /> Its token</label>
        <label className="field checkbox"><input type="radio" name="tk-drag" checked={s.drag === 'picture'} onChange={() => setS({ ...s, drag: 'picture' })} /> The picture itself</label>
      </fieldset>
      <label className="field">
        <span className="field-label">Size of new tokens: {s.size} × {s.size} px</span>
        <input type="range" min={TOKEN_SIZE_MIN} max={TOKEN_SIZE_MAX} step={64} value={s.size} onChange={(e) => setS({ ...s, size: Number(e.target.value) })} />
      </label>
      <label className="field">
        <span className="field-label">Border thickness of new tokens: {s.width}%</span>
        <input type="range" min={TOKEN_WIDTH_MIN} max={TOKEN_WIDTH_MAX} step={0.5} value={s.width} onChange={(e) => setS({ ...s, width: Number(e.target.value) })} />
      </label>
      <span className="field-label">Border by card type (a card whose token you edited keeps its own)</span>
      <table className="token-type-table">
        <tbody>
          {TOKEN_TYPES.map((t) => (
            <tr key={t}>
              <th scope="row">{ENTITY_LABELS[t]}</th>
              <td><select aria-label={`${ENTITY_LABELS[t]} border`} value={s.types[t].border} onChange={(e) => type(t, { border: e.target.value as TokenBorder })}>
                {TOKEN_BORDERS.map((b) => <option key={b} value={b}>{TOKEN_BORDER_LABELS[b]}</option>)}
              </select></td>
              <td><label className="field checkbox"><input type="checkbox" checked={s.types[t].tint !== null} onChange={(e) => type(t, { tint: e.target.checked ? '#3b6fd8' : null })} /> Tint</label></td>
              <td>{s.types[t].tint !== null && <input type="color" aria-label={`${ENTITY_LABELS[t]} tint`} value={s.types[t].tint!} onChange={(e) => type(t, { tint: e.target.value })} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="dz-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="primary" onClick={() => void act('campaign:update', { tokens: s }).then(() => { say('Token settings saved'); onClose() })}>Save</button>
      </div>
    </Dialog>
  )
}

// ---- Library › Tokens ---------------------------------------------------------------------------------------

/** Library › Tokens: every PC, NPC and monster token. Click to edit, right-click for more, drag to Roll20. */
export function TokensTab() {
  const { say } = useBoard()
  const list = useTokens()
  const [settings, setSettings] = useState(false)
  if (!list) return <p className="hint">Loading…</p>
  return (
    <div className="panel tokens-tab">
      <div className="row tight wrap">
        <button className="primary" disabled={!list.some((t) => t.exists)}
          onClick={() => void call('token:saveAll', { entityIds: list.map((t) => t.entityId) }).then((d) => say(`Saved the tokens in ${d}`)).catch((e: Error) => say(e.message, true))}>Save all for Roll20</button>
        <button onClick={() => setSettings(true)}>Token settings…</button>
        <OpenFolder sub="tokens" label="Open tokens folder" />
      </div>
      <p className="hint">Every player character, NPC and monster with a picture gets a token. Click one to change it (that card only), right-click to copy, save or delete it, drag it into Roll20.</p>
      {list.length === 0 && <p className="hint">No tokens yet: give a PC, NPC or monster card a picture.</p>}
      <div className="token-grid">
        {list.map((t) => (
          <figure key={t.entityId} className="token-tile">
            <TokenImage token={t} size={128} />
            <figcaption><strong>{t.name}</strong><span className="muted">{ENTITY_LABELS[t.type as EntityType]}{t.own ? ' · own look' : ''}</span></figcaption>
          </figure>
        ))}
      </div>
      {settings && <TokenSettingsDialog onClose={() => setSettings(false)} />}
    </div>
  )
}

/** Card sheets (PC, NPC, monster): the card's token beside its picture. */
export function SheetToken({ entityId }: { entityId: string }) {
  const list = useTokens()
  const t = list?.find((x) => x.entityId === entityId)
  if (!t) return null
  return (
    <div className="sheet-token">
      <TokenImage token={t} size={72} />
      <span className="hint">Token for Roll20: click to edit, right-click for more.</span>
    </div>
  )
}
