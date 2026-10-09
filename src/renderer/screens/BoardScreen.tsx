import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
import {
  ConnectionMode, Controls, ReactFlow, ReactFlowProvider, applyEdgeChanges,
  applyNodeChanges, useReactFlow, useStore, type Connection, type EdgeChange, type NodeChange, type OnSelectionChangeParams
} from '@xyflow/react'
import { useBoard, useView } from '../store'
import { CardNode, roman, type CardNodeType } from '../components/CardNode'
import { NoteNode, type NoteNodeType } from '../components/NoteNode'
import { ImageNode, type ImageNodeType } from '../components/ImageNode'
import { StringEdge, type StringEdgeType } from '../components/StringEdge'
import { Inspector } from '../components/Inspector'
import { HistoryPanel } from '../components/HistoryPanel'
import { ConnectionsPanel } from '../components/ConnectionsPanel'
import { StorylinesPanel } from '../components/StorylinesPanel'
import { ContextMenu, type MenuItem } from '../components/ContextMenu'
import { WinnerDialog } from '../components/WinnerDialog'
import { Splitter, useSplit } from '../components/Splitter'
import { ENTITY_COLOURS, ENTITY_LABELS } from '../entityStyle'
import { freeSpot } from '../../shared/layout'
import { TopBar, isTyping } from '../components/TopBar'
import { DeskFrame } from '../components/DeskFrame'
import { Candle } from '../art/props'
import { lightingAt } from '../../shared/sky'
import { useLightingPref } from '../art/TableLighting'
import { StorylineDialog } from '../components/EditDialogs'
import { useBoardPrefs } from '../boardPrefs'
import { ENTITY_TYPES, RELATIONSHIP_TYPES, type EntityType } from '../../shared/schemas'
import type { BoardView, EntityView } from '../../shared/types'
import { useCtrlPan } from '../useCtrlPan'
import { Dialog } from '../components/Dialog'
import { MapViewPanel } from './MapScreen'
import { DEFAULT_LINK, LinkTypeFields, linkInput, linkReady, type LinkChoice } from '../components/LinkTypeFields'

type BoardNode = CardNodeType | NoteNodeType | ImageNodeType

const nodeTypes = { card: CardNode, note: NoteNode, image: ImageNode }
const edgeTypes = { string: StringEdge }
const ASSET = 'dz-asset://campaign/'

export function BoardScreen() {
  return (
    <ReactFlowProvider>
      <BoardLayout />
    </ReactFlowProvider>
  )
}

function matches(e: EntityView, q: string): boolean {
  const hay = [e.name, e.type, ...e.tags, ...Object.values(e.attributes).filter((v) => typeof v === 'string')]
  return hay.some((s) => String(s).toLowerCase().includes(q))
}

/** Storyline colours by storyline id. */
function colours(view: BoardView): Map<string, string> {
  return new Map(view.boards.flatMap((b) => (b.storylineId && b.storyline?.colour ? [[b.storylineId, b.storyline.colour] as [string, string]] : [])))
}

type Menu = { x: number; y: number; items: MenuItem[] }

function BoardLayout() {
  const view = useView()
  const { panel, search, focusEntityId, act, setPanel, select, setSearch, showBoard, openSheet, say } = useBoard()
  const prefs = useBoardPrefs()
  const { screenToFlowPosition, flowToScreenPosition, fitView, setCenter, getViewport, setViewport } = useReactFlow()
  const paneRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<BoardNode[]>([])
  const [edges, setEdges] = useState<StringEdgeType[]>([])
  const [cardMenu, setCardMenu] = useState(false)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [newStoryline, setNewStoryline] = useState<string | null>(null)
  const [editStory, setEditStory] = useState(false)
  const [askLink, setAskLink] = useState(false)
  /** Card menu › New link…: the string follows the mouse from this card until another card is clicked. */
  const [linking, setLinking] = useState<{ itemId: string; entity: EntityView } | null>(null)
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null)
  const [confirmLink, setConfirmLink] = useState<{ a: EntityView; b: EntityView } | null>(null)
  const [linkChoice, setLinkChoice] = useState<LinkChoice>(DEFAULT_LINK)
  const background = prefs.layer === 'background'
  useBoard((s) => s.view) // keeps the rubber-band string in step with the view
  useStore((s) => s.transform) // and with panning and zooming
  useCtrlPan(paneRef, useCallback((dx: number, dy: number) => {
    const v = getViewport()
    void setViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom })
  }, [getViewport, setViewport]))
  const [lighting] = useLightingPref()
  const [sideWidth, setSideWidth] = useSplit('board-side', 360)
  useBoard((s) => s.info?.clockMin) // re-render when the clock moves, for the candle

  const q = search.trim().toLowerCase()
  const linkMode = panel === 'connections'
  const storyColours = useMemo(() => colours(view), [view])
  const typeColours = useMemo(() => new Map(view.settings.stringTypes.map((t) => [t.type, t.colour])), [view.settings.stringTypes])

  // Rebuild nodes and strings whenever the board data changes, keeping what was selected.
  useEffect(() => {
    // While the background moves, the cards stay put and let clicks through.
    const frontLayer = background ? { draggable: false, selectable: false, className: 'is-passive is-faded' } : {}
    setNodes((prev) => {
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id))
      return view.items.flatMap((item): BoardNode[] => {
        const size = item.w && item.h ? { width: item.w, height: item.h } : {}
        const base = { id: item.id, position: { x: item.x, y: item.y }, selected: selected.has(item.id), ...size }
        if (item.kind === 'image') {
          if (!prefs.pictures || (item.hidden && !prefs.showHidden) || !item.content?.image) return []
          const locked = !!item.content.locked
          return [{
            ...base, type: 'image', zIndex: -1, draggable: background && !locked, selectable: background,
            className: background ? undefined : 'is-passive',
            data: { src: ASSET + item.content.image, name: item.content.name ?? 'Picture', opacity: item.content.opacity ?? 0.6, locked, hidden: item.hidden }
          }]
        }
        if (item.kind === 'note') {
          if (item.hidden && !prefs.showHidden) return []
          return [{ ...base, type: 'note', ...frontLayer, data: { text: item.content?.text ?? '', dimmed: q !== '' || (linkMode && prefs.greyNotes), hidden: item.hidden } }]
        }
        const entity = item.entityId ? view.entities[item.entityId] : undefined
        if (!entity || (entity.hidden && !prefs.showHidden)) return []
        const match = q !== '' && matches(entity, q)
        const tints = prefs.tint ? entity.storylineIds.flatMap((id) => (storyColours.has(id) ? [storyColours.get(id)!] : [])) : []
        const marks = prefs.actMarks ? entity.acts.map((m) => ({
          key: m.actId, numeral: roman(m.number), colour: storyColours.get(m.storylineId) ?? '#5a4a32',
          title: `${view.boards.find((b) => b.storylineId === m.storylineId)?.name ?? 'Storyline'}: act ${roman(m.number)}, ${m.title}`
        })) : []
        return [{ ...base, type: 'card', ...frontLayer, data: { entity, dimmed: (q !== '' && !match) || (linkMode && prefs.greyCards), match, tints, marks } }]
      })
    })
  }, [view, q, prefs, storyColours, linkMode, background])

  const itemByEntity = useMemo(
    () => new Map(view.items.filter((i) => i.entityId).map((i) => [i.entityId!, i.id])),
    [view.items]
  )

  useEffect(() => {
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id))
      return view.relationships.flatMap((r): StringEdgeType[] => {
        const source = itemByEntity.get(r.sourceId)
        const target = itemByEntity.get(r.targetId)
        if (!source || !target) return []
        const a = view.entities[r.sourceId]
        const b = view.entities[r.targetId]
        const ends = a.hidden || b.hidden
        if ((r.hidden || ends) && !prefs.showHidden) return []
        const dimmed = q !== '' && !(matches(a, q) || matches(b, q))
        return [{
          id: r.id, source, target, sourceHandle: 'pin', targetHandle: 'pin', type: 'string',
          selected: selected.has(r.id), selectable: !background, className: background ? 'is-passive' : undefined,
          data: {
            type: r.type, isSecret: r.isSecret, resolved: a.status === 'resolved' || b.status === 'resolved', dimmed,
            colour: typeColours.get(r.type) ?? null, hidden: r.hidden || ends, highlight: linkMode
          }
        }]
      })
    })
  }, [view, itemByEntity, q, prefs.showHidden, typeColours, linkMode, background])

  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns))
  }, [])
  const onEdgesChange = useCallback((changes: EdgeChange<StringEdgeType>[]) => {
    setEdges((es) => applyEdgeChanges(changes, es))
  }, [])

  const onSelectionChange = useCallback(({ nodes: ns, edges: es }: OnSelectionChangeParams) => {
    if (ns.length + es.length !== 1) { select(null); return }
    if (es.length === 1) { select({ kind: 'string', id: es[0].id }); return }
    const n = ns[0] as BoardNode
    if (n.type === 'card') select({ kind: 'entity', id: n.data.entity.id })
    else select({ kind: 'note', id: n.id })
  }, [select])

  const onConnect = useCallback((c: Connection) => {
    const source = nodes.find((n) => n.id === c.source)
    const target = nodes.find((n) => n.id === c.target)
    if (source?.type !== 'card' || target?.type !== 'card' || source.id === target.id) return
    void act('relationship:create', {
      sourceId: source.data.entity.id, targetId: target.data.entity.id, type: 'KNOWS', isSecret: false, boardId: view.board.id
    }).then((rel) => { if (rel) select({ kind: 'string', id: rel.id }) })
  }, [nodes, act, select, view.board.id])

  const onNodeDragStop = useCallback((_e: unknown, _n: BoardNode, dragged: BoardNode[]) => {
    const moves = dragged
      .map((n) => ({ itemId: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y) }))
      .filter((m) => {
        const item = view.items.find((i) => i.id === m.itemId)
        return item && (item.x !== m.x || item.y !== m.y)
      })
    if (moves.length > 0) void act('items:move', { moves })
  }, [view.items, act])

  /** A free spot near the middle of the visible board, so new cards don't land on top of others. */
  const centre = useCallback(() => {
    const rect = paneRef.current?.getBoundingClientRect()
    const mid = rect
      ? screenToFlowPosition({ x: rect.left + rect.width / 2 - 110, y: rect.top + rect.height / 2 - 70 })
      : { x: 0, y: 0 }
    return freeSpot({ x: Math.round(mid.x), y: Math.round(mid.y) }, view.items.filter((i) => i.kind !== 'image'))
  }, [screenToFlowPosition, view.items])

  const addCard = useCallback(async (type: EntityType, at?: { x: number; y: number }) => {
    setCardMenu(false)
    const entity = await act('entity:create', {
      boardId: view.board.id, type, name: `New ${ENTITY_LABELS[type]}`, position: at ?? centre()
    })
    if (entity) {
      select({ kind: 'entity', id: entity.id })
      setPanel('inspector')
      setTimeout(() => document.getElementById(`entity-${entity.id}-name`)?.focus(), 50)
    }
  }, [act, view.board.id, centre, select, setPanel])

  const addNote = useCallback(async (at?: { x: number; y: number }) => {
    const item = await act('note:create', { boardId: view.board.id, position: at ?? centre(), text: '' })
    if (item) {
      select({ kind: 'note', id: item.id })
      setPanel('inspector')
      setTimeout(() => document.getElementById(`note-${item.id}`)?.focus(), 50)
    }
  }, [act, view.board.id, centre, select, setPanel])

  const addPicture = useCallback(async (mapId: string | null, at?: { x: number; y: number }) => {
    const item = await act('boardImage:add', { boardId: view.board.id, mapId, position: at ?? centre() })
    if (item) {
      prefs.set({ pictures: true, layer: 'background' })
      say(`Added ${item.content?.name ?? 'the picture'} as a background picture. Now moving the background: drag it, drag a corner to resize, right-click to lock it. Switch back with Move: Cards.`)
    }
  }, [act, view.board.id, centre, prefs, say])

  const [maps, setMaps] = useState<Array<{ id: string; name: string; kind: string; url: string }>>([])
  const [mapView, setMapView] = useState<string | null>(null)
  useEffect(() => { void useBoard.getState().query('desk:view', undefined).then((d) => setMaps(d?.maps ?? [])) }, [view])

  const removeSelected = useCallback(async () => {
    const selNodes = nodes.filter((n) => n.selected)
    const selEdges = edges.filter((e) => e.selected)
    for (const e of selEdges) await act('relationship:setStatus', { id: e.id, status: 'defunct' })
    for (const n of selNodes) {
      if (n.type === 'card') await act('entity:setStatus', { id: n.data.entity.id, status: 'defunct' })
      else await act('note:setStatus', { itemId: n.id, status: 'defunct' })
    }
    if (selNodes.length + selEdges.length > 0) select(null)
  }, [nodes, edges, act, select])

  // Delete moves the selection to History (undo and redo keys live in the top bar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLinking(null)
      if (isTyping(e.target)) return
      // Backspace with nothing selected is left for Back.
      if ((e.key === 'Delete' || e.key === 'Backspace') && (nodes.some((n) => n.selected) || edges.some((x) => x.selected))) { e.preventDefault(); void removeSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeSelected, nodes, edges])

  // Bring a card into view when another screen asked to show it on the board.
  useEffect(() => {
    if (!focusEntityId) return
    const item = view.items.find((i) => i.entityId === focusEntityId)
    useBoard.setState({ focusEntityId: null })
    if (!item) return
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === item.id })))
    setTimeout(() => void setCenter(item.x + 110, item.y + 70, { zoom: 1, duration: 300 }), 0)
  }, [focusEntityId, view.items, setCenter])

  const createStoryline = async (e: FormEvent) => {
    e.preventDefault()
    const title = newStoryline?.trim()
    if (!title) return
    const b = await act('storyline:create', { title })
    setNewStoryline(null)
    if (b) await showBoard(b.id)
  }

  // ---- right-click menus (the same actions as the panels)

  const stringKinds = useMemo(() => [...new Set([...RELATIONSHIP_TYPES.filter((t) => t !== 'BOARD_LINK'), ...view.settings.stringTypes.map((t) => t.type)])], [view.settings.stringTypes])
  const storylineBoards = view.boards.filter((b) => b.storylineId)

  const cardItems = (e: EntityView, itemId: string): MenuItem[] => [
    { label: 'Open sheet', onClick: () => void openSheet(e.id) },
    { label: 'New link…', hint: 'Then click the card to link it to', onClick: () => { setLinking({ itemId, entity: e }); say(`Click the card to link ${e.name} to (Escape to cancel).`) } },
    { label: 'Edit in the panel', onClick: () => { select({ kind: 'entity', id: e.id }); setPanel('inspector') } },
    'separator',
    { label: 'Acts', items: storylineBoards.map((b) => ({
      label: b.name,
      items: view.acts.filter((a) => a.storylineId === b.storylineId).map((a) => ({
        label: `${roman(a.number)}. ${a.title}`, checked: e.acts.some((m) => m.actId === a.id),
        onClick: () => void act('act:mark', { entityId: e.id, actId: a.id, on: !e.acts.some((m) => m.actId === a.id) })
      }))
    })) },
    { label: 'Storylines', items: storylineBoards.map((b) => {
      const on = e.storylineIds.includes(b.storylineId!)
      return {
        label: b.name, checked: on,
        onClick: () => void (on
          ? act('entity:removeFromStoryline', { entityId: e.id, storylineId: b.storylineId! })
          : act('entity:addToStoryline', { entityId: e.id, storylineId: b.storylineId!, position: { x: view.items.find((i) => i.id === itemId)?.x ?? 0, y: view.items.find((i) => i.id === itemId)?.y ?? 0 } }))
      }
    }) },
    e.status === 'resolved'
      ? { label: 'Mark active', onClick: () => void act('entity:setStatus', { id: e.id, status: 'active' }) }
      : { label: 'Mark resolved', onClick: () => void act('entity:setStatus', { id: e.id, status: 'resolved' }) },
    { label: 'Duplicate', onClick: () => void act('entity:duplicate', { id: e.id }) },
    { label: 'Normal size', disabled: !view.items.find((i) => i.id === itemId)?.w, onClick: () => void act('item:resize', { itemId, size: null }) },
    'separator',
    e.hidden
      ? { label: 'Unhide', onClick: () => void act('board:setHidden', { kind: 'entity', id: e.id, hidden: false }) }
      : { label: 'Hide (on every board)', onClick: () => void act('board:setHidden', { kind: 'entity', id: e.id, hidden: true }) },
    { label: 'Delete (to History)', danger: true, onClick: () => { void act('entity:setStatus', { id: e.id, status: 'defunct' }); select(null) } }
  ]

  const noteItems = (itemId: string): MenuItem[] => {
    const item = view.items.find((i) => i.id === itemId)!
    return [
      { label: 'Edit text', onClick: () => { select({ kind: 'note', id: itemId }); setPanel('inspector'); setTimeout(() => document.getElementById(`note-${itemId}`)?.focus(), 50) } },
      { label: 'Normal size', disabled: !item.w, onClick: () => void act('item:resize', { itemId, size: null }) },
      'separator',
      item.hidden
        ? { label: 'Unhide', onClick: () => void act('board:setHidden', { kind: 'item', id: itemId, hidden: false }) }
        : { label: 'Hide', onClick: () => void act('board:setHidden', { kind: 'item', id: itemId, hidden: true }) },
      { label: 'Delete (to History)', danger: true, onClick: () => { void act('note:setStatus', { itemId, status: 'defunct' }); select(null) } }
    ]
  }

  const imageItems = (itemId: string): MenuItem[] => {
    const item = view.items.find((i) => i.id === itemId)!
    const c = item.content ?? {}
    return [
      c.locked
        ? { label: 'Unlock (move and resize)', onClick: () => void act('boardImage:update', { itemId, patch: { locked: false } }) }
        : { label: 'Lock in place', onClick: () => void act('boardImage:update', { itemId, patch: { locked: true } }) },
      { label: 'See-through', items: [0.25, 0.4, 0.6, 0.8, 1].map((o) => ({
        label: o === 1 ? 'Solid' : `${Math.round(o * 100)}%`, checked: Math.abs((c.opacity ?? 0.6) - o) < 0.01,
        onClick: () => void act('boardImage:update', { itemId, patch: { opacity: o } })
      })) },
      { label: 'Edit in the panel', onClick: () => { select({ kind: 'note', id: itemId }); setPanel('inspector') } },
      'separator',
      item.hidden
        ? { label: 'Unhide', onClick: () => void act('board:setHidden', { kind: 'item', id: itemId, hidden: false }) }
        : { label: 'Hide', onClick: () => void act('board:setHidden', { kind: 'item', id: itemId, hidden: true }) },
      { label: 'Remove (to History)', danger: true, onClick: () => { void act('note:setStatus', { itemId, status: 'defunct' }); select(null) } }
    ]
  }

  const stringItems = (id: string): MenuItem[] => {
    const r = view.relationships.find((x) => x.id === id)!
    return [
      { label: 'Edit in the panel', onClick: () => { select({ kind: 'string', id }); setPanel('inspector') } },
      { label: 'Kind', items: stringKinds.map((k) => ({ label: k.replace(/_/g, ' ').toLowerCase(), checked: r.type === k, onClick: () => void act('relationship:update', { id, patch: { type: k } }) })) },
      { label: r.isSecret ? 'Make known (solid)' : 'Make secret (dashed)', onClick: () => void act('relationship:update', { id, patch: { isSecret: !r.isSecret } }) },
      'separator',
      r.hidden
        ? { label: 'Unhide', onClick: () => void act('board:setHidden', { kind: 'string', id, hidden: false }) }
        : { label: 'Hide', onClick: () => void act('board:setHidden', { kind: 'string', id, hidden: true }) },
      { label: 'Delete (to History)', danger: true, onClick: () => { void act('relationship:setStatus', { id, status: 'defunct' }); select(null) } }
    ]
  }

  const paneItems = (at: { x: number; y: number }): MenuItem[] => [
    { label: 'New card', items: ENTITY_TYPES.map((t) => ({ label: ENTITY_LABELS[t], onClick: () => void addCard(t, at) })) },
    { label: 'New note', onClick: () => void addNote(at) },
    { label: 'Add background picture', items: [
      ...maps.map((m) => ({ label: `${m.name}${m.kind === 'battle' ? ' (battle map)' : ''}`, onClick: () => void addPicture(m.id, at) })),
      ...(maps.length ? ['separator' as const] : []),
      { label: 'Choose a picture file…', onClick: () => void addPicture(null, at) }
    ] },
    { label: 'Move the background (cards stay put)', checked: background, onClick: () => prefs.set({ layer: background ? 'cards' : 'background' }) },
    'separator',
    ...displayItems()
  ]

  function displayItems(): MenuItem[] {
    return [
      { label: 'Show hidden things (greyed)', checked: prefs.showHidden, onClick: () => prefs.set({ showHidden: !prefs.showHidden }) },
      { label: 'Background pictures', checked: prefs.pictures, onClick: () => prefs.set({ pictures: !prefs.pictures }) },
      { label: 'Storyline colours on cards', checked: prefs.tint, onClick: () => prefs.set({ tint: !prefs.tint }) },
      { label: 'Act marks on cards', checked: prefs.actMarks, onClick: () => prefs.set({ actMarks: !prefs.actMarks }) },
      { label: 'Moving a card moves it on every board', checked: view.settings.linkPositions,
        onClick: () => (view.settings.linkPositions ? void act('board:linkPositions', { on: false, winner: 'global' }) : setAskLink(true)) }
    ]
  }

  const openMenu = (e: ReactMouseEvent | MouseEvent, items: MenuItem[]) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const matchCount = q ? Object.values(view.entities).filter((e) => matches(e, q)).length : 0
  const hiddenCount = Object.values(view.entities).filter((e) => e.hidden).length + view.items.filter((i) => i.kind !== 'card' && i.hidden).length

  return (
    <DeskFrame>
      <TopBar>
        <div className="search">
          <label htmlFor="board-search" className="visually-hidden">Search the board</label>
          <input id="board-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search names, types, tags, notes" />
          {q && <span className="search-count mono" aria-live="polite">{matchCount} found</span>}
        </div>
      </TopBar>

      <nav className="viewbar" aria-label="Board views">
        <span className="eyebrow">VIEW</span>
        {view.boards.map((b) => (
          <button key={b.id} aria-pressed={b.id === view.board.id} onClick={() => void showBoard(b.id)}
            style={b.storyline?.colour ? { borderBottom: `4px solid ${b.storyline.colour}` } : undefined}>
            {b.storylineId ? b.name : 'Global: all characters and plot points'}
          </button>
        ))}
        {newStoryline === null ? (
          <button className="ghost" onClick={() => setNewStoryline('')}>+ Storyline</button>
        ) : (
          <form className="row tight" onSubmit={createStoryline}>
            <label htmlFor="new-storyline" className="visually-hidden">Storyline title</label>
            <input id="new-storyline" autoFocus value={newStoryline} placeholder="Storyline title"
              onChange={(e) => setNewStoryline(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setNewStoryline(null) }} />
            <button type="submit" className="primary" disabled={!newStoryline.trim()}>Add</button>
            <button type="button" onClick={() => setNewStoryline(null)}>Cancel</button>
          </form>
        )}
        {view.board.storylineId && view.board.storyline && (
          <button className="ghost" onClick={() => setEditStory(true)}>Edit storyline</button>
        )}
        <span className="spacer" />
        <button className="outline" aria-haspopup="menu" onClick={(e) => openMenu(e, displayItems())}>Display ▾</button>
        <button className="outline" onClick={() => void addCard('NPC')}>New NPC</button>
        {editStory && view.board.storylineId && view.board.storyline && (
          <StorylineDialog open onClose={() => setEditStory(false)} storylineId={view.board.storylineId} detail={view.board.storyline} />
        )}
      </nav>

      <div className="workspace">
        <nav className="tools" aria-label="Board tools">
          <div className="tool-wrap">
            <button className="tool" aria-expanded={cardMenu} aria-haspopup="menu" onClick={() => setCardMenu((v) => !v)}>Card</button>
            {cardMenu && (
              <div className="menu" role="menu" aria-label="New card type">
                {ENTITY_TYPES.map((t) => (
                  <button key={t} role="menuitem" onClick={() => void addCard(t)}>
                    <span className="swatch" style={{ background: ENTITY_COLOURS[t] }} aria-hidden="true" />
                    {ENTITY_LABELS[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="tool" onClick={() => void addNote()}>Note</button>
          <button className="tool" aria-pressed={panel === 'connections'} title="Every string: kinds, colours, hide, remove"
            onClick={() => setPanel(panel === 'connections' ? 'inspector' : 'connections')}>Links</button>
          <button className="tool" aria-pressed={panel === 'storylines'} title="Storylines: colours, acts and display"
            onClick={() => setPanel(panel === 'storylines' ? 'inspector' : 'storylines')}>Story</button>
          <button className="tool" title="Add a map or picture behind the cards" onClick={(e) => openMenu(e, [
            ...maps.map((m) => ({ label: `${m.name}${m.kind === 'battle' ? ' (battle map)' : ''}`, onClick: () => void addPicture(m.id) })),
            ...(maps.length ? ['separator' as const] : []),
            { label: 'Choose a picture file…', onClick: () => void addPicture(null) },
            { label: 'Open background pictures folder', onClick: () => void act('campaign:openFolder', { sub: 'board' }) },
            'separator',
            { label: 'Show background pictures', checked: prefs.pictures, onClick: () => prefs.set({ pictures: !prefs.pictures }) }
          ])}>Background</button>
          <button className="tool" aria-pressed={!!mapView} title="Regions, the party token and travel on a map (the board's background map first)" onClick={(e) => {
            if (mapView) return setMapView(null)
            const used = view.items.filter((i) => i.kind === 'image' && i.content && 'image' in i.content).map((i) => String((i.content as { image: string }).image))
            const world = maps.filter((m) => m.kind !== 'battle')
            const onBoard = world.filter((m) => used.some((u) => m.url.endsWith(u)))
            if (onBoard.length === 1) return setMapView(onBoard[0].id)
            const list = onBoard.length ? onBoard : world
            if (!list.length) return say('No map yet: import one on the Map screen or add one as a background picture.', true)
            if (list.length === 1) return setMapView(list[0].id)
            openMenu(e, list.map((m) => ({ label: m.name, onClick: () => setMapView(m.id) })))
          }}>Map view</button>
          <div className="tool-layer" role="group" aria-label="What a drag moves">
            <span className="eyebrow">MOVE</span>
            <button className="tool" aria-pressed={!background} title="Drag cards, notes and strings; the background stays put"
              onClick={() => prefs.set({ layer: 'cards' })}>Cards</button>
            <button className="tool" aria-pressed={background} title="Drag and resize background pictures; the cards stay put"
              onClick={() => prefs.set({ layer: 'background', pictures: true })}>Background</button>
          </div>
          <button className="tool" aria-pressed={prefs.showHidden} title={`Show hidden things greyed (${hiddenCount} hidden)`}
            onClick={() => prefs.set({ showHidden: !prefs.showHidden })}>Hidden{hiddenCount ? ` (${hiddenCount})` : ''}</button>
          <button className="tool" onClick={() => fitView({ padding: 0.2, duration: 300 })}>Fit all</button>
          <span className="spacer" />
          <Candle className="tools-candle" lit={!lighting || lightingAt(useBoard.getState().info?.clockMin ?? 0).candlesLit} />
        </nav>

        {mapView && <main className="canvas"><MapViewPanel mapId={mapView} onClose={() => setMapView(null)} /></main>}
        <main className="canvas" ref={paneRef} aria-label={`${view.board.name} board`} style={mapView ? { display: 'none' } : undefined}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onSelectionChange={onSelectionChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            onNodeDoubleClick={(_e, n: BoardNode) => { if (n.type === 'card') void openSheet(n.data.entity.id) }}
            onNodeClick={(_e, n: BoardNode) => {
              if (!linking) return
              if (n.type === 'card' && n.id !== linking.itemId) { setConfirmLink({ a: linking.entity, b: n.data.entity }); setLinkChoice(DEFAULT_LINK) }
              setLinking(null)
            }}
            onPaneClick={() => setLinking(null)}
            onMouseMove={(e) => { if (linking) setMouse({ x: e.clientX, y: e.clientY }) }}
            onNodeContextMenu={(e, n: BoardNode) => openMenu(e, n.type === 'card' ? cardItems(n.data.entity, n.id) : n.type === 'image' ? imageItems(n.id) : noteItems(n.id))}
            onEdgeContextMenu={(e, edge) => openMenu(e, stringItems(edge.id))}
            onPaneContextMenu={(e) => openMenu(e, paneItems(screenToFlowPosition({ x: e.clientX, y: e.clientY })))}
            connectionMode={ConnectionMode.Loose}
            connectionLineStyle={{ stroke: '#d2453a', strokeWidth: 2 }}
            deleteKeyCode={null}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={['Shift']}
            minZoom={0.1}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
            colorMode="light"
          >
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
          {view.items.length === 0 && (
            <div className="empty-board">
              <p><strong>This board is empty.</strong></p>
              <p>Add a card with <em>New NPC</em> or the <em>Card</em> tool, then drag between the red pins to tie strings. Right-click the board for more.</p>
            </div>
          )}
          {linking && mouse && (() => {
            const item = view.items.find((i) => i.id === linking.itemId)
            const rect = paneRef.current?.getBoundingClientRect()
            if (!item || !rect) return null
            const from = flowToScreenPosition({ x: item.x + (item.w ?? 220) / 2, y: item.y + (item.h ?? 120) / 2 })
            return (
              <svg className="link-rubber" aria-hidden="true">
                <line x1={from.x - rect.left} y1={from.y - rect.top} x2={mouse.x - rect.left} y2={mouse.y - rect.top} />
              </svg>
            )
          })()}
          {background && <div className="layer-banner" role="status">Moving the background: the cards stay put. <button className="link-button" onClick={() => prefs.set({ layer: 'cards' })}>Move cards</button></div>}
          <div className="legend" aria-label="Legend">
            <span><i className="line" />Known link</span>
            <span><i className="line dashed" />Secret link</span>
            <span><i className="line grey" />Resolved</span>
            {view.settings.stringTypes.filter((t) => t.colour).map((t) => (
              <span key={t.type}><i className="line" style={{ borderTopColor: t.colour! }} />{t.type.replace(/_/g, ' ').toLowerCase()}</span>
            ))}
          </div>
        </main>

        <Splitter value={sideWidth} onChange={setSideWidth} side="right" min={260} max={720} initial={360} label="Resize the side panel" />

        <aside className="side" style={mapView ? { display: 'none' } : { flexBasis: sideWidth }}>
          <div className="segmented full" role="tablist" aria-label="Side panel">
            <button role="tab" aria-selected={panel === 'inspector'} aria-pressed={panel === 'inspector'} onClick={() => setPanel('inspector')}>Inspector</button>
            <button role="tab" aria-selected={panel === 'connections'} aria-pressed={panel === 'connections'} onClick={() => setPanel('connections')}>Links</button>
            <button role="tab" aria-selected={panel === 'storylines'} aria-pressed={panel === 'storylines'} onClick={() => setPanel('storylines')}>Story</button>
            <button role="tab" aria-selected={panel === 'history'} aria-pressed={panel === 'history'} onClick={() => setPanel('history')}>History</button>
          </div>
          <div className="side-body">
            {panel === 'inspector' ? <Inspector /> : panel === 'connections' ? <ConnectionsPanel /> : panel === 'storylines' ? <StorylinesPanel /> : <HistoryPanel />}
          </div>
        </aside>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <Dialog title="Link these two?" open={!!confirmLink} onClose={() => setConfirmLink(null)}>
        {confirmLink && (
          <form onSubmit={(e) => {
            e.preventDefault()
            if (!linkReady(linkChoice)) return
            const { a, b } = confirmLink
            setConfirmLink(null)
            void act('relationship:create', { sourceId: a.id, targetId: b.id, boardId: view.board.id, ...linkInput(linkChoice) })
              .then((rel) => { if (rel) select({ kind: 'string', id: rel.id }) })
          }}>
            <p className="link-confirm"><strong>{confirmLink.a.name}</strong> <span aria-hidden="true">→</span> <strong>{confirmLink.b.name}</strong></p>
            <LinkTypeFields id="new-link" value={linkChoice} onChange={setLinkChoice} />
            <div className="dz-actions">
              <button type="button" onClick={() => setConfirmLink(null)}>Cancel</button>
              <button type="submit" className="primary" disabled={!linkReady(linkChoice)}>Yes, link them</button>
            </div>
          </form>
        )}
      </Dialog>
      {askLink && (
        <WinnerDialog title="Move cards on every board"
          text="From now on, moving or resizing a card moves it on every board. The boards may have the card in different places now: which layout should every board take?"
          onChoose={(winner) => { setAskLink(false); void act('board:linkPositions', { on: true, winner }) }} onClose={() => setAskLink(false)} />
      )}
    </DeskFrame>
  )
}
