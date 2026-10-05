import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Background, BackgroundVariant, ConnectionMode, Controls, ReactFlow, ReactFlowProvider, applyEdgeChanges,
  applyNodeChanges, useReactFlow, type Connection, type EdgeChange, type NodeChange, type OnSelectionChangeParams
} from '@xyflow/react'
import { useBoard, useView } from '../store'
import { CardNode, type CardNodeType } from '../components/CardNode'
import { NoteNode, type NoteNodeType } from '../components/NoteNode'
import { StringEdge, type StringEdgeType } from '../components/StringEdge'
import { Inspector } from '../components/Inspector'
import { HistoryPanel } from '../components/HistoryPanel'
import { ENTITY_COLOURS, ENTITY_LABELS } from '../entityStyle'
import { freeSpot } from '../../shared/layout'
import { TopBar, isTyping } from '../components/TopBar'
import { StorylineDialog } from '../components/EditDialogs'
import { ENTITY_TYPES, type EntityType } from '../../shared/schemas'
import type { EntityView } from '../../shared/types'

type BoardNode = CardNodeType | NoteNodeType

const nodeTypes = { card: CardNode, note: NoteNode }
const edgeTypes = { string: StringEdge }

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

function BoardLayout() {
  const view = useView()
  const { panel, search, focusEntityId, act, setPanel, select, setSearch, showBoard, openSheet } = useBoard()
  const { screenToFlowPosition, fitView, setCenter } = useReactFlow()
  const paneRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<BoardNode[]>([])
  const [edges, setEdges] = useState<StringEdgeType[]>([])
  const [cardMenu, setCardMenu] = useState(false)
  const [newStoryline, setNewStoryline] = useState<string | null>(null)
  const [editStory, setEditStory] = useState(false)

  const q = search.trim().toLowerCase()

  // Rebuild nodes and strings whenever the board data changes, keeping what was selected.
  useEffect(() => {
    setNodes((prev) => {
      const selected = new Set(prev.filter((n) => n.selected).map((n) => n.id))
      return view.items.flatMap((item): BoardNode[] => {
        const base = { id: item.id, position: { x: item.x, y: item.y }, selected: selected.has(item.id) }
        if (item.kind === 'note') {
          return [{ ...base, type: 'note', data: { text: item.content?.text ?? '', dimmed: q !== '' } }]
        }
        const entity = item.entityId ? view.entities[item.entityId] : undefined
        if (!entity) return []
        const match = q !== '' && matches(entity, q)
        return [{ ...base, type: 'card', data: { entity, dimmed: q !== '' && !match, match } }]
      })
    })
  }, [view, q])

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
        const dimmed = q !== '' && !(matches(a, q) || matches(b, q))
        return [{
          id: r.id, source, target, sourceHandle: 'pin', targetHandle: 'pin', type: 'string',
          selected: selected.has(r.id),
          data: { type: r.type, isSecret: r.isSecret, resolved: a.status === 'resolved' || b.status === 'resolved', dimmed }
        }]
      })
    })
  }, [view, itemByEntity, q])

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
    if (n.type === 'note') select({ kind: 'note', id: n.id })
    else select({ kind: 'entity', id: n.data.entity.id })
  }, [select])

  const onConnect = useCallback((c: Connection) => {
    const source = nodes.find((n) => n.id === c.source)
    const target = nodes.find((n) => n.id === c.target)
    if (source?.type !== 'card' || target?.type !== 'card' || source.id === target.id) return
    void act('relationship:create', {
      sourceId: source.data.entity.id, targetId: target.data.entity.id, type: 'KNOWS', isSecret: false
    }).then((rel) => { if (rel) select({ kind: 'string', id: rel.id }) })
  }, [nodes, act, select])

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
    return freeSpot({ x: Math.round(mid.x), y: Math.round(mid.y) }, view.items)
  }, [screenToFlowPosition, view.items])

  const addCard = useCallback(async (type: EntityType) => {
    setCardMenu(false)
    const entity = await act('entity:create', {
      boardId: view.board.id, type, name: `New ${ENTITY_LABELS[type]}`, position: centre()
    })
    if (entity) {
      select({ kind: 'entity', id: entity.id })
      setPanel('inspector')
      setTimeout(() => document.getElementById(`entity-${entity.id}-name`)?.focus(), 50)
    }
  }, [act, view.board.id, centre, select, setPanel])

  const addNote = useCallback(async () => {
    const item = await act('note:create', { boardId: view.board.id, position: centre(), text: '' })
    if (item) {
      select({ kind: 'note', id: item.id })
      setPanel('inspector')
      setTimeout(() => document.getElementById(`note-${item.id}`)?.focus(), 50)
    }
  }, [act, view.board.id, centre, select, setPanel])

  const removeSelected = useCallback(async () => {
    const selNodes = nodes.filter((n) => n.selected)
    const selEdges = edges.filter((e) => e.selected)
    for (const e of selEdges) await act('relationship:setStatus', { id: e.id, status: 'defunct' })
    for (const n of selNodes) {
      if (n.type === 'note') await act('note:setStatus', { itemId: n.id, status: 'defunct' })
      else await act('entity:setStatus', { id: n.data.entity.id, status: 'defunct' })
    }
    if (selNodes.length + selEdges.length > 0) select(null)
  }, [nodes, edges, act, select])

  // Delete moves the selection to History (undo and redo keys live in the top bar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); void removeSelected() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [removeSelected])

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

  const matchCount = q ? Object.values(view.entities).filter((e) => matches(e, q)).length : 0

  return (
    <div className="board-screen">
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
          <button key={b.id} aria-pressed={b.id === view.board.id} onClick={() => void showBoard(b.id)}>
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
          <button className="tool" onClick={() => fitView({ padding: 0.2, duration: 300 })}>Fit all</button>
        </nav>

        <main className="canvas" ref={paneRef} aria-label={`${view.board.name} board`}>
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
            connectionMode={ConnectionMode.Loose}
            connectionLineStyle={{ stroke: '#d2453a', strokeWidth: 2 }}
            deleteKeyCode={null}
            selectionKeyCode="Shift"
            multiSelectionKeyCode={['Control', 'Meta']}
            minZoom={0.2}
            maxZoom={2}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            proOptions={{ hideAttribution: true }}
            colorMode="dark"
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#363c46" bgColor="#23272e" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
          {view.items.length === 0 && (
            <div className="empty-board">
              <p><strong>This board is empty.</strong></p>
              <p>Add a card with <em>New NPC</em> or the <em>Card</em> tool, then drag between the red pins to tie strings.</p>
            </div>
          )}
          <div className="legend" aria-label="Legend">
            <span><i className="line" />Known link</span>
            <span><i className="line dashed" />Secret link</span>
            <span><i className="line grey" />Resolved</span>
          </div>
        </main>

        <aside className="side">
          <div className="segmented full" role="tablist" aria-label="Side panel">
            <button role="tab" aria-selected={panel === 'inspector'} aria-pressed={panel === 'inspector'} onClick={() => setPanel('inspector')}>Inspector</button>
            <button role="tab" aria-selected={panel === 'history'} aria-pressed={panel === 'history'} onClick={() => setPanel('history')}>History</button>
          </div>
          <div className="side-body">{panel === 'inspector' ? <Inspector /> : <HistoryPanel />}</div>
        </aside>
      </div>
    </div>
  )
}
