import { useEffect, useMemo, useState } from 'react'
import { useBoard, SCREEN_NAMES, type Screen } from '../store'
import { call } from '../api'
import { Dialog } from './Dialog'
import { ENTITY_LABELS, useTypeColour } from '../entityStyle'
import { TypeIcon } from '../art/typeIcons'
import type { IpcOutputs } from '../../shared/ipc'

type Item = IpcOutputs['find:index'][number] | { kind: 'screen'; id: Screen; name: string; detail: string }
const SCREENS: Screen[] = ['desk', 'board', 'prep', 'encounters', 'library', 'import', 'map', 'timeline', 'live', 'players', 'generators']
const screenItem = (s: Screen): Item => ({ kind: 'screen', id: s, name: s === 'import' ? 'Notes' : SCREEN_NAMES[s].replace(/^the /, '').replace(/^./, (c) => c.toUpperCase()), detail: 'Screen' })

/**
 * Ctrl+F (3.0, owner; not Ctrl+K): find and go to anything — cards (sheet, or Encounters for an encounter;
 * places also on the map), notes, session prep sheets and screens. Enter opens the first; ↑ ↓ choose.
 */
export function FindAnything() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [at, setAt] = useState(0)
  const typeColour = useTypeColour()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never in Players mode: it would show secret cards on the players' screen.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f' && !document.querySelector('dialog[open]') && useBoard.getState().mode !== 'players') {
        e.preventDefault()
        setQ(''); setAt(0); setOpen(true)
        void call('find:index', undefined).then((list) => setItems([...list, ...SCREENS.map(screenItem)])).catch(() => setItems(SCREENS.map(screenItem)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return items.filter((x) => x.kind === 'screen')
    const score = (x: Item) => { const n = x.name.toLowerCase(); return n.startsWith(t) ? 0 : n.split(/\s+/).some((w) => w.startsWith(t)) ? 1 : n.includes(t) ? 2 : x.detail.toLowerCase().includes(t) ? 3 : 9 }
    return items.map((x) => ({ x, s: score(x) })).filter((r) => r.s < 9).sort((a, b) => a.s - b.s || a.x.name.localeCompare(b.x.name)).slice(0, 40).map((r) => r.x)
  }, [q, items])
  if (!open) return null
  const close = () => setOpen(false)
  const go = (x: Item, where?: 'board' | 'map') => {
    close()
    const s = useBoard.getState()
    if (x.kind === 'screen') s.goTo(x.id as Parameters<typeof s.goTo>[0])
    else if (x.kind === 'note') { useBoard.setState({ notesTab: 'notes', notesOpenId: x.id, notesOpenHeading: null }); s.goTo('import') }
    else if (x.kind === 'session') { s.setPrepNumber(Number(x.id)); s.goTo('prep') }
    else if (where === 'board') void s.showOnBoard(x.id)
    else if (where === 'map') { useBoard.setState({ mapFocusId: x.id }); s.goTo('map') }
    else if (x.encounter) s.openEncounter(x.id)
    else void s.openSheet(x.id)
  }
  const label = (x: Item) => x.kind === 'card' ? (x.encounter ? 'Encounter' : x.type ? ENTITY_LABELS[x.type] : 'Card') : x.kind === 'note' ? 'Note' : x.kind === 'session' ? 'Session' : 'Screen'
  return (
    <Dialog title="Find" open onClose={close}>
      <div className="find-anything">
        <input autoFocus type="search" value={q} placeholder="A card, note, session or screen…" aria-label="Find"
          onChange={(e) => { setQ(e.target.value); setAt(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(at + 1, shown.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(at - 1, 0)) }
            else if (e.key === 'Enter' && shown[at]) { e.preventDefault(); go(shown[at]) }
          }} />
        <ul className="find-list" role="listbox" aria-label="Results">
          {shown.length === 0 && <li className="hint">Nothing found.</li>}
          {shown.map((x, i) => (
            <li key={`${x.kind}:${x.id}`} role="option" aria-selected={i === at} className={i === at ? 'is-at' : undefined} onMouseEnter={() => setAt(i)}>
              <button className="find-main" onClick={() => go(x)}>
                {x.kind === 'card' && x.type
                  ? <span className="find-icon" style={{ color: typeColour(x.type) }}><TypeIcon type={x.type} encounter={x.encounter} /></span>
                  : <span className="find-icon" aria-hidden="true">{x.kind === 'note' ? '¶' : x.kind === 'session' ? '§' : '→'}</span>}
                <span className="find-name">{x.name}</span>
                <span className="find-kind">{label(x)}{x.detail && x.kind !== 'screen' ? ` · ${x.detail.slice(0, 60)}` : ''}</span>
              </button>
              {x.kind === 'card' && !x.encounter && <button className="link-button" onClick={() => go(x, 'board')}>Board</button>}
              {x.kind === 'card' && (x.type === 'LOCATION' || x.type === 'BUILDING') && <button className="link-button" onClick={() => go(x, 'map')}>Map</button>}
            </li>
          ))}
        </ul>
        <p className="hint">Enter opens the highlighted one (a card's sheet; an encounter on Encounters). ↑ ↓ to choose, Esc to close.</p>
      </div>
    </Dialog>
  )
}
