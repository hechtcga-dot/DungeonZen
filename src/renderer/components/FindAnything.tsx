import { useEffect, useMemo, useState } from 'react'
import { useBoard, SCREEN_NAMES, type Screen } from '../store'
import { call } from '../api'
import { Dialog } from './Dialog'
import { ENTITY_LABELS, useTypeColour } from '../entityStyle'
import { TypeIcon } from '../art/typeIcons'
import { freshCard } from '../fresh'
import { ENTITY_TYPES } from '../../shared/schemas'
import { readSkin, useArrange, useSkin } from '../skin'
import { useLightingPref } from '../art/TableLighting'
import { parseTimeStep, timeStepLabel as stepLabel } from '../../shared/time'
import type { IpcOutputs } from '../../shared/ipc'

type Found = IpcOutputs['find:index'][number]
type Action = { kind: 'action'; id: string; name: string; detail: string; run(): void | Promise<unknown> }
type Item = Found | { kind: 'screen'; id: Screen; name: string; detail: string } | Action
const SCREENS: Screen[] = ['desk', 'prep', 'encounters', 'board', 'timeline', 'map', 'library', 'import', 'live', 'players', 'generators']
const screenItem = (s: Screen): Item => ({ kind: 'screen', id: s, name: s === 'import' ? 'Notes' : SCREEN_NAMES[s].replace(/^the /, '').replace(/^./, (c) => c.toUpperCase()), detail: 'Go to' })

// Recently opened cards, notes and sessions (this computer), newest first.
const RECENT = 'dz.recent'
const readRecent = (): Found[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? '[]') as Found[] } catch { return [] } }
const keepRecent = (x: Found) => { try { localStorage.setItem(RECENT, JSON.stringify([x, ...readRecent().filter((r) => r.kind !== x.kind || r.id !== x.id)].slice(0, 5))) } catch { /* not kept */ } }

/**
 * Ctrl+K, also Ctrl+F (3.1): find and go to anything — cards (sheet, or Encounters for an encounter; places also on
 * the map), notes, session prep sheets and screens — or do something (Actions). Empty: recent and suggested.
 * `>` actions only, `@` cards only, `#` tags. Every action goes through the store, so it can be undone.
 */
export function FindAnything() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [at, setAt] = useState(0)
  const typeColour = useTypeColour()
  const [skin, setSkin] = useSkin()
  const [arrange, setArrange] = useArrange()
  const [lighting, setLighting] = useLightingPref()
  const screen = useBoard((s) => s.screen)
  useEffect(() => {
    const show = () => {
      // Never in Players mode: it would show secret cards on the players' screen.
      if (document.querySelector('dialog[open]') || useBoard.getState().mode === 'players') return
      setQ(''); setAt(0); setOpen(true)
      void call('find:index', undefined).then((list) => setItems([...list, ...SCREENS.map(screenItem)])).catch(() => setItems(SCREENS.map(screenItem)))
    }
    // Ctrl+K and Ctrl+F; the header's Find button sends dz-find.
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && ['f', 'k'].includes(e.key.toLowerCase())) { e.preventDefault(); show() }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('dz-find', show)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('dz-find', show) }
  }, [])

  const actions = useMemo((): Action[] => {
    const s = () => useBoard.getState()
    const a = (id: string, name: string, detail: string, run: Action['run']): Action => ({ kind: 'action', id, name, detail, run })
    const newCard = (t: (typeof ENTITY_TYPES)[number]) => async () => {
      const info = s().info
      if (!info) return
      const e = await s().act('entity:create', { boardId: info.globalBoardId, type: t, name: `New ${ENTITY_LABELS[t]}` })
      if (e) { await s().openSheet(e.id); freshCard(e.id) }
    }
    const live = s().live
    return [
      ...ENTITY_TYPES.map((t) => a(`new-${t}`, `New ${ENTITY_LABELS[t]}`, 'Adds a card and opens its sheet', newCard(t))),
      a('new-encounter', 'New encounter', 'Encounters', async () => {
        const id = await s().act('encounter:create', { name: 'New encounter' })
        if (id) { s().goTo('encounters'); s().openEncounter(id) }
      }),
      a('new-storyline', 'New storyline', 'Desk and Timeline; rename it on its board', () => s().act('storyline:create', { title: 'New storyline' })),
      a('new-note', 'New note', 'Notes', async () => {
        const id = await s().act('notedoc:create', { title: 'New note' })
        if (id) { useBoard.setState({ notesTab: 'notes', notesOpenId: id, notesOpenHeading: null }); s().goTo('import') }
      }),
      a('import-notes', 'Import notes', 'The AI reads them, you decide', () => { useBoard.setState({ notesTab: 'import' }); s().goTo('import') }),
      a('new-map', 'New map', 'Import a picture, make a world map, or have an AI draw one', () => s().goTo('guide')),
      live?.session ? a('end-session', `End session ${live.session.number}`, 'Live desk', () => s().goTo('live'))
        : a('start-session', 'Start the next session', 'Live desk', async () => { await s().act('session:start', undefined); s().goTo('live') }),
      a('time-10m', 'Advance time 10 min', 'Clock', () => s().act('clock:shift', { minutes: 10 })),
      a('time-1h', 'Advance time 1 h', 'Clock', () => s().act('clock:shift', { minutes: 60 })),
      a('rest-short', 'Short rest', 'Party', () => s().act('party:rest', { kind: 'short' })),
      a('rest-long', 'Long rest', 'Party', () => s().act('party:rest', { kind: 'long' })),
      a('undo', 'Undo', s().view?.undo.undoLabel ?? 'Nothing to undo', () => s().undo()),
      a('redo', 'Redo', s().view?.undo.redoLabel ?? 'Nothing to redo', () => s().redo()),
      a('look', skin === 'adventure' ? 'Look: Desk UI' : 'Look: Adventure UI', 'How the app looks on this computer', () => setSkin(readSkin() === 'adventure' ? 'desk' : 'adventure')),
      a('lighting', lighting ? 'Lighting: always bright' : 'Lighting: day and night', 'Follows the campaign clock; candles burn at night', () => setLighting(!lighting)),
      a('arrange', arrange ? 'Hide box controls until pointed at' : 'Arrange boxes (always show − ↑ ↓)', 'Fold and move boxes', () => setArrange(!arrange)),
      a('ai', 'AI services', 'Writing and battle map services', () => s().setAiSettingsOpen(true))
    ]
  }, [skin, lighting, arrange, setSkin, setLighting, setArrange, open])

  const suggested = (): string[] => screen === 'live' ? ['start-session', 'end-session', 'time-10m', 'rest-short'] : screen === 'board' ? ['new-NPC', 'new-note', 'new-storyline'] :
    screen === 'encounters' ? ['new-encounter', 'new-MONSTER'] : screen === 'import' ? ['new-note', 'import-notes'] : screen === 'map' ? ['new-map', 'new-LOCATION'] :
      ['start-session', 'new-NPC', 'time-1h', 'new-PC']

  const shown = useMemo((): Array<{ group: string; x: Item }> => {
    let t = q.trim().toLowerCase()
    if (!t) {
      const rec = readRecent().map((x) => ({ group: 'Recent', x: x as Item }))
      const sug = suggested().map((id) => actions.find((x) => x.id === id)).filter(Boolean).map((x) => ({ group: 'Suggested here', x: x as Item }))
      return [...rec, ...sug, ...items.filter((x) => x.kind === 'screen').map((x) => ({ group: 'Go to', x }))]
    }
    const step = parseTimeStep(t)
    const only = t[0] === '>' ? 'action' : t[0] === '@' ? 'card' : t[0] === '#' ? 'tag' : null
    if (only) t = t.slice(1).trim()
    const pool: Item[] = only === 'action' ? actions : only ? items.filter((x) => x.kind === 'card') : [...items, ...actions]
    const score = (x: Item) => {
      if (only === 'tag') return x.detail.toLowerCase().includes(t) ? 0 : 9
      const n = x.name.toLowerCase()
      return n.startsWith(t) ? 0 : n.split(/\s+/).some((w) => w.startsWith(t)) ? 1 : n.includes(t) ? 2 : x.detail.toLowerCase().includes(t) ? 3 : 9
    }
    const found = pool.map((x) => ({ x, s: score(x) })).filter((r) => r.s < 9).sort((a, b) => a.s - b.s || a.x.name.localeCompare(b.x.name)).slice(0, 40).map((r) => r.x)
    const timeStep: Action[] = step === null ? [] : [{ kind: 'action', id: 'time-step', name: stepLabel(step), detail: 'Clock · Ctrl+Z undoes it', run: () => {
      // Moving the clock more than a day asks first.
      if (Math.abs(step) > 1440 && !window.confirm(`${stepLabel(step)}?`)) return
      return useBoard.getState().act('clock:shift', { minutes: step })
    } }]
    const groupOf = (x: Item) => x.kind === 'screen' ? 'Go to' : x.kind === 'action' ? 'Actions' : x.kind === 'note' ? 'Notes' : x.kind === 'session' ? 'Sessions' : x.encounter ? 'Encounters' : 'Cards'
    // Groups in the order of their best match; the best match's group first.
    const rows = [...timeStep, ...found].map((x) => ({ group: groupOf(x), x }))
    const rank = [...new Set(rows.map((r) => r.group))]
    return rows.sort((a, b) => rank.indexOf(a.group) - rank.indexOf(b.group))
  }, [q, items, actions, screen])

  if (!open) return null
  const close = () => setOpen(false)
  const go = (x: Item, where?: 'board' | 'map') => {
    close()
    const s = useBoard.getState()
    if (x.kind === 'action') { void Promise.resolve(x.run()).catch((err: Error) => s.say(err.message, true)); return }
    if (x.kind === 'screen') { s.goTo(x.id as Parameters<typeof s.goTo>[0]); return }
    keepRecent(x)
    if (x.kind === 'note') { useBoard.setState({ notesTab: 'notes', notesOpenId: x.id, notesOpenHeading: null }); s.goTo('import') }
    else if (x.kind === 'session') { s.setPrepNumber(Number(x.id)); s.goTo('prep') }
    else if (where === 'board') void s.showOnBoard(x.id)
    else if (where === 'map') { useBoard.setState({ mapFocusId: x.id }); s.goTo('map') }
    else if (x.encounter) s.openEncounter(x.id)
    else void s.openSheet(x.id)
  }
  const label = (x: Item) => x.kind === 'card' ? (x.encounter ? 'Encounter' : x.type ? ENTITY_LABELS[x.type] : 'Card') : x.kind === 'note' ? 'Note' : x.kind === 'session' ? 'Session' : x.kind === 'screen' ? 'Screen' : 'Action'
  return (
    <Dialog title="Find or do" open onClose={close}>
      <div className="find-anything">
        <input autoFocus type="search" value={q} placeholder="A card, note, screen, or what to do (new NPC, +2h)…" aria-label="Find"
          onChange={(e) => { setQ(e.target.value); setAt(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(at + 1, shown.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(at - 1, 0)) }
            else if (e.key === 'Enter' && shown[at]) { e.preventDefault(); go(shown[at].x) }
            else if (e.key === 'Tab' && shown[at]?.x.kind === 'card' && !e.shiftKey) {
              // Tab: a card's second choice (its place on the board).
              e.preventDefault(); go(shown[at].x, 'board')
            }
          }} />
        <ul className="find-list" role="listbox" aria-label="Results">
          {shown.length === 0 && <li className="hint">Nothing called that. Try a card name, a screen, or “new NPC”, “+2h”.</li>}
          {shown.map(({ group, x }, i) => (
            <li key={`${group}:${x.kind}:${x.id}`} role="option" aria-selected={i === at} className={i === at ? 'is-at' : undefined} onMouseEnter={() => setAt(i)}
              data-group={i === 0 || shown[i - 1].group !== group ? group : undefined}>
              <button className="find-main" onClick={() => go(x)}>
                {x.kind === 'card' && x.type
                  ? <span className="find-icon" style={{ color: typeColour(x.type) }}><TypeIcon type={x.type} encounter={x.encounter} /></span>
                  : <span className="find-icon" aria-hidden="true">{x.kind === 'note' ? '¶' : x.kind === 'session' ? '§' : x.kind === 'action' ? '+' : '→'}</span>}
                <span className="find-name">{x.name}</span>
                <span className="find-kind">{label(x)}{x.detail && x.kind !== 'screen' ? ` · ${x.detail.slice(0, 60)}` : ''}</span>
              </button>
              {x.kind === 'card' && !x.encounter && <button className="link-button" onClick={() => go(x, 'board')}>Board</button>}
              {x.kind === 'card' && (x.type === 'LOCATION' || x.type === 'BUILDING') && <button className="link-button" onClick={() => go(x, 'map')}>Map</button>}
            </li>
          ))}
        </ul>
        <p className="hint">↑ ↓ choose · Enter opens or does it · Tab on a card: show it on the board · <b>&gt;</b> actions only · <b>@</b> cards only · <b>#</b> tags · Esc closes.</p>
      </div>
    </Dialog>
  )
}
