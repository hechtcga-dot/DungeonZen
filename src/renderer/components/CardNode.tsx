import { memo } from 'react'
import { Handle, NodeResizer, Position, type Node, type NodeProps, type ResizeParams } from '@xyflow/react'
import { ENTITY_COLOURS, ENTITY_LABELS } from '../entityStyle'
import type { EntityView } from '../../shared/types'
import { HAS_STATBLOCK, readStatBlock, statLine } from '../../shared/statblock'
import { useBoard } from '../store'

export type CardNodeData = {
  entity: EntityView; dimmed: boolean; match: boolean
  /** Storyline colours to tint the card with (empty: plain paper). */
  tints: string[]
  /** Act marks to draw: roman numeral and the storyline's colour. */
  marks: Array<{ key: string; numeral: string; colour: string; title: string }>
}
export type CardNodeType = Node<CardNodeData, 'card'>

const ROMAN: Array<[number, string]> = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
export function roman(n: number): string {
  let out = ''
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v }
  return out || '0'
}

/** Very light storyline colours over the paper; several storylines split it diagonally. */
export function tintBackground(colours: string[]): string | undefined {
  if (colours.length === 0) return undefined
  const mix = (c: string) => `color-mix(in srgb, ${c} 17%, transparent)`
  if (colours.length === 1) return `linear-gradient(${mix(colours[0])}, ${mix(colours[0])}), var(--card-paper)`
  const step = 100 / colours.length
  const stops = colours.map((c, i) => `${mix(c)} ${i * step}% ${(i + 1) * step}%`).join(', ')
  return `linear-gradient(135deg, ${stops}), var(--card-paper)`
}

export function onResized(itemId: string) {
  return (_e: unknown, p: ResizeParams) => {
    const { act } = useBoard.getState()
    void act('item:resize', { itemId, size: { w: p.width, h: p.height } }).then(() => act('items:move', { moves: [{ itemId, x: Math.round(p.x), y: Math.round(p.y) }] }))
  }
}

function CardNodeImpl({ id, data, selected, width, height }: NodeProps<CardNodeType>) {
  const { entity, dimmed, match, tints, marks } = data
  const resolved = entity.status === 'resolved'
  const location = typeof entity.attributes.location === 'string' ? entity.attributes.location : ''
  const sb = HAS_STATBLOCK.has(entity.type) ? readStatBlock(entity.attributes.statblock) : null
  const summary = (typeof entity.attributes.summary === 'string' ? entity.attributes.summary : '') || (sb ? statLine(sb) : '')
  // A card made smaller shows less: everything, then badge and name, then just the name.
  const size = height == null ? 'full' : height < 72 ? 'name' : height < 125 ? 'short' : 'full'
  const classes = ['card', `card-${size}`, width != null && 'card-sized', resolved && 'card-resolved', selected && 'is-selected', dimmed && 'is-dimmed', match && 'is-match', entity.hidden && 'is-hidden']
  return (
    <article className={classes.filter(Boolean).join(' ')} aria-label={`${ENTITY_LABELS[entity.type]}: ${entity.name}${entity.hidden ? ' (hidden)' : ''}`}
      title="Double-click to open the sheet; right-click for more" style={resolved ? undefined : { background: tintBackground(tints) }}>
      <NodeResizer isVisible={selected} minWidth={110} minHeight={44} onResizeEnd={onResized(id)} color="#6cb6d9" />
      {/* The pin: drag from one pin to another to tie a string. */}
      <Handle type="source" position={Position.Top} id="pin" className="pin" title="Drag to another card's pin to tie a string" />
      {size !== 'name' && (
        <div className="card-head">
          <span className="badge" style={{ background: resolved ? '#3d434b' : typeof entity.attributes.colour === 'string' ? entity.attributes.colour : ENTITY_COLOURS[entity.type] }}>
            {ENTITY_LABELS[entity.type].toUpperCase()}
          </span>
          {resolved && <span className="card-state">Resolved</span>}
          {entity.hidden && <span className="card-state">Hidden</span>}
        </div>
      )}
      {size === 'full' && typeof entity.attributes.picture === 'string' && (
        <img className="card-pic" src={`dz-asset://campaign/${entity.attributes.picture}`} alt="" draggable={false} />
      )}
      <div className="card-name">{entity.name}</div>
      {size === 'full' && summary && <div className="card-sub">{summary}</div>}
      {size === 'full' && location && <div className="card-line">Location: {location}</div>}
      {size === 'full' && entity.tags.length > 0 && <div className="card-tags">{entity.tags.map((t) => `#${t}`).join(' ')}</div>}
      {marks.length > 0 && (
        <div className="act-marks" aria-label={marks.map((m) => m.title).join(', ')}>
          {marks.map((m) => <span key={m.key} className="act-mark" style={{ borderColor: m.colour, color: m.colour }} title={m.title}>{m.numeral}</span>)}
        </div>
      )}
    </article>
  )
}

export const CardNode = memo(CardNodeImpl)
