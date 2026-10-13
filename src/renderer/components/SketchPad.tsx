import { useEffect, useRef, useState } from 'react'
import { CELL, cellAt, emptySketch, paint, resize, roomCells, SKETCH_MAX, SKETCH_MIN, type Sketch } from '../../shared/sketch'
import { useBoard } from '../store'

const C = 20 // drawing units per square

/**
 * A pencil-look layout sketch on a 5 ft grid. Each stroke is saved when the mouse is let go
 * (one undo step); Undo is the app's undo. Used for building floors and encounter battle maps.
 */
export function SketchPad({ sketch, tools, onCommit, highlight, size = [20, 12], label }: {
  sketch: Sketch | null
  tools: readonly string[]
  onCommit(s: Sketch): void
  /** Room number or name: labels starting with it are drawn highlighted. */
  highlight?: string
  size?: [number, number]
  label: string
}) {
  const undo = useBoard((s) => s.undo)
  const base = sketch ?? emptySketch(size[0], size[1])
  const [draft, setDraftState] = useState<Sketch | null>(null)
  // The stroke so far, kept in a ref too: pointer moves come faster than renders.
  const live = useRef<Sketch | null>(null)
  const last = useRef<[number, number] | null>(null)
  const setDraft = (d: Sketch | null) => { live.current = d; setDraftState(d) }
  const [tool, setTool] = useState<string>(tools[0])
  const [text, setText] = useState('')
  const start = useRef<[number, number] | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  useEffect(() => setDraft(null), [sketch])
  const s = draft ?? base

  const cellOf = (e: React.PointerEvent): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    return [Math.floor(((e.clientX - r.left) / r.width) * s.cols), Math.floor(((e.clientY - r.top) / r.height) * s.rows)]
  }
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const [x, y] = cellOf(e)
    last.current = [x, y]
    if (tool === 'label') {
      if (text.trim()) onCommit({ ...base, labels: [...base.labels.filter((l) => l.x !== x || l.y !== y), { x, y, t: text.trim() }] })
      return
    }
    svg.current?.setPointerCapture?.(e.pointerId)
    start.current = [x, y]
    if (tool === ' ') setDraft({ ...paint(base, [[x, y, ' ']]), labels: base.labels.filter((l) => l.x !== x || l.y !== y) })
    else if (tool === 'room') setDraft(paint(base, roomCells(x, y, x, y)))
    else setDraft(paint(base, [[x, y, tool]]))
  }
  const move = (e: React.PointerEvent) => {
    const cur = live.current
    if (!start.current || !cur || !last.current) return
    const [x, y] = cellOf(e)
    if (x === last.current[0] && y === last.current[1]) return
    if (tool === 'room') setDraft(paint(base, roomCells(start.current[0], start.current[1], x, y)))
    else {
      // Every square between the last one and this one, so a quick stroke leaves no gaps.
      const line = between(last.current, [x, y])
      if (tool === ' ') setDraft({ ...paint(cur, line.map(([a, b]) => [a, b, ' '])), labels: cur.labels.filter((l) => !line.some(([a, b]) => a === l.x && b === l.y)) })
      else setDraft(paint(cur, line.map(([a, b]) => [a, b, tool])))
    }
    last.current = [x, y]
  }
  const up = () => {
    const d = live.current
    if (start.current && d && (d.cells !== base.cells || d.labels.length !== base.labels.length)) onCommit(d)
    start.current = null
    last.current = null
  }
  const name = (t: string) => (t === 'room' ? 'Room' : t === 'label' ? 'Label' : t === ' ' ? 'Eraser' : CELL[t]?.label ?? t)
  const icon = (t: string) => (t === 'room' ? '▭' : t === 'label' ? 'T' : t === ' ' ? '⌫' : CELL[t]?.icon ?? '?')

  return (
    <div className="sketch">
      <div className="sketch-tools" role="toolbar" aria-label={`${label} tools`}>
        {tools.map((t) => (
          <button key={t} type="button" className="sketch-tool" aria-pressed={tool === t} onClick={() => setTool(t)} title={t === 'room' ? 'Drag a rectangle: walls round, floor inside' : undefined}>
            <span aria-hidden="true">{icon(t)}</span> {name(t)}
          </button>
        ))}
        <button type="button" className="sketch-tool" onClick={() => void undo()} title="Undo the last change (Ctrl+Z)">↶ Undo</button>
        {tool === 'label' && <input className="sketch-label-input" value={text} maxLength={40} placeholder="Label text, then click a square" aria-label="Label text" onChange={(e) => setText(e.target.value)} />}
        <span className="sketch-size">
          <input type="number" min={SKETCH_MIN} max={SKETCH_MAX} value={s.cols} aria-label="Squares across" onChange={(e) => onCommit(resize(base, Number(e.target.value), base.rows))} />
          ×
          <input type="number" min={SKETCH_MIN} max={SKETCH_MAX} value={s.rows} aria-label="Squares deep" onChange={(e) => onCommit(resize(base, base.cols, Number(e.target.value)))} />
          <span className="hint">squares of 5 ft</span>
        </span>
        <button type="button" className="sketch-tool" disabled={!base.cells.trim() && !base.labels.length} onClick={() => onCommit(emptySketch(base.cols, base.rows))}>Clear</button>
      </div>
      <svg ref={svg} className="sketch-paper" viewBox={`0 0 ${s.cols * C} ${s.rows * C}`} role="img" aria-label={label}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <SketchDrawing s={s} highlight={highlight} />
      </svg>
    </div>
  )
}

/** The squares on a straight line from a to b (both ends included). */
function between([x0, y0]: [number, number], [x1, y1]: [number, number]): Array<[number, number]> {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  return Array.from({ length: n + 1 }, (_, i) => [Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n)] as [number, number])
}

/** The sketch drawn in pencil: walls joined into lines, symbols per square, italic labels. */
export function SketchDrawing({ s, highlight }: { s: Sketch; highlight?: string }) {
  const walls: string[] = []
  const marks: React.ReactNode[] = []
  for (let y = 0; y < s.rows; y++) {
    for (let x = 0; x < s.cols; x++) {
      const c = cellAt(s, x, y)
      if (c === ' ') continue
      const cx = x * C + C / 2, cy = y * C + C / 2, k = `${x}-${y}`
      const wall = (cc: string) => cc === '#' || cc === 'D' || cc === 'W'
      if (c === '#') {
        if (wall(cellAt(s, x + 1, y))) walls.push(`M${cx} ${cy}H${cx + C}`)
        if (wall(cellAt(s, x, y + 1))) walls.push(`M${cx} ${cy}V${cy + C}`)
        // Diagonal neighbours join only when no straight wall already links them.
        for (const dx of [-1, 1]) {
          if (cellAt(s, x + dx, y + 1) === '#' && !wall(cellAt(s, x + dx, y)) && !wall(cellAt(s, x, y + 1))) walls.push(`M${cx} ${cy}L${cx + dx * C} ${cy + C}`)
        }
        walls.push(`M${cx - 1} ${cy}h2`)
      } else if (c === '.') {
        marks.push(<rect key={k} x={x * C} y={y * C} width={C} height={C} fill="#e9dfc4" opacity=".55" />)
      } else if (c === '~') {
        marks.push(<g key={k}><rect x={x * C} y={y * C} width={C} height={C} fill="#9fc3df" opacity=".55" /><path d={`M${x * C + 2} ${cy}q4 -4 8 0t8 0`} stroke="#3a5a7a" fill="none" /></g>)
      } else if (c === ':') {
        marks.push(<g key={k} fill="#6b5a2a"><circle cx={cx - 4} cy={cy - 3} r="1.2" /><circle cx={cx + 4} cy={cy + 2} r="1.2" /><circle cx={cx - 2} cy={cy + 5} r="1" /><circle cx={cx + 5} cy={cy - 5} r="1" /></g>)
      } else if (c === 'D' || c === 'W') {
        const horiz = wall(cellAt(s, x - 1, y)) || wall(cellAt(s, x + 1, y))
        marks.push(c === 'D'
          ? <path key={k} d={horiz ? `M${x * C + 3} ${cy}a7 7 0 0 1 14 0` : `M${cx} ${y * C + 3}a7 7 0 0 1 0 14`} stroke="#7a3a1e" strokeWidth="1.6" fill="none" />
          : <path key={k} d={horiz ? `M${x * C} ${cy - 2}H${x * C + C}M${x * C} ${cy + 2}H${x * C + C}` : `M${cx - 2} ${y * C}V${y * C + C}M${cx + 2} ${y * C}V${y * C + C}`} stroke="#2e6a9a" strokeWidth="1.4" />)
      } else {
        const t = CELL[c]
        if (t) marks.push(<text key={k} x={cx} y={cy + 5} textAnchor="middle" fontSize="14" fill={t.colour === '#000000' ? '#333' : t.colour}>{t.icon}</text>)
      }
    }
  }
  const hl = highlight?.trim().toLowerCase()
  return (
    <>
      <defs>
        <pattern id="sketch-grid" width={C} height={C} patternUnits="userSpaceOnUse"><path d={`M${C} 0H0V${C}`} fill="none" stroke="#9fb6c9" strokeWidth=".5" opacity=".7" /></pattern>
        <filter id="sketch-pencil"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n" /><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" /></filter>
      </defs>
      <rect width={s.cols * C} height={s.rows * C} fill="#f4ecd6" />
      <rect width={s.cols * C} height={s.rows * C} fill="url(#sketch-grid)" />
      <g filter="url(#sketch-pencil)">
        {marks}
        <path d={walls.join('')} stroke="#2b2b2b" strokeWidth="4" strokeLinecap="round" fill="none" />
      </g>
      {s.labels.map((l, i) => {
        const on = !!hl && (l.t.toLowerCase() === hl || l.t.toLowerCase().startsWith(`${hl} `) || l.t.toLowerCase().startsWith(`${hl}·`))
        return <text key={i} x={l.x * C + 2} y={l.y * C + C * 0.75} fontSize="13" fontStyle="italic" fontFamily="'IM Fell English', Georgia, serif"
          fill={on ? '#1f5f9a' : '#222'} fontWeight={on ? 700 : 400} stroke="#f4ecd6" strokeWidth="3" paintOrder="stroke">{l.t}</text>
      })}
    </>
  )
}

/** The sketch as a clean, flat-coloured plan picture (PNG, base64) for the image AI's blueprint. */
export function sketchPng(s: Sketch, cell = 24): string {
  const canvas = document.createElement('canvas')
  canvas.width = s.cols * cell
  canvas.height = s.rows * cell
  const g = canvas.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < s.rows; y++) {
    for (let x = 0; x < s.cols; x++) {
      const c = cellAt(s, x, y)
      if (c === ' ' || !CELL[c]) continue
      g.fillStyle = CELL[c].colour
      g.fillRect(x * cell, y * cell, cell, cell)
    }
  }
  g.fillStyle = '#000000'
  g.font = `${Math.round(cell * 0.6)}px sans-serif`
  for (const l of s.labels) g.fillText(l.t, l.x * cell + 2, l.y * cell + cell * 0.75)
  return canvas.toDataURL('image/png').split(',')[1]
}
