import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { ENTITY_COLOURS, ENTITY_LABELS } from '../entityStyle'
import type { EntityView } from '../../shared/types'
import { HAS_STATBLOCK, readStatBlock, statLine } from '../../shared/statblock'

export type CardNodeData = { entity: EntityView; dimmed: boolean; match: boolean }
export type CardNodeType = Node<CardNodeData, 'card'>

function CardNodeImpl({ data, selected }: NodeProps<CardNodeType>) {
  const { entity, dimmed, match } = data
  const resolved = entity.status === 'resolved'
  const location = typeof entity.attributes.location === 'string' ? entity.attributes.location : ''
  const sb = HAS_STATBLOCK.has(entity.type) ? readStatBlock(entity.attributes.statblock) : null
  const summary = (typeof entity.attributes.summary === 'string' ? entity.attributes.summary : '') || (sb ? statLine(sb) : '')
  const classes = ['card', resolved && 'card-resolved', selected && 'is-selected', dimmed && 'is-dimmed', match && 'is-match']
  return (
    <article className={classes.filter(Boolean).join(' ')} aria-label={`${ENTITY_LABELS[entity.type]}: ${entity.name}`}
      title="Double-click to open the sheet">
      {/* The pin: drag from one pin to another to tie a string. */}
      <Handle type="source" position={Position.Top} id="pin" className="pin" title="Drag to another card's pin to tie a string" />
      <div className="card-head">
        <span className="badge" style={{ background: resolved ? '#3d434b' : ENTITY_COLOURS[entity.type] }}>
          {ENTITY_LABELS[entity.type].toUpperCase()}
        </span>
        {resolved && <span className="card-state">Resolved</span>}
      </div>
      <div className="card-name">{entity.name}</div>
      {summary && <div className="card-sub">{summary}</div>}
      {location && <div className="card-line">Location: {location}</div>}
      {entity.tags.length > 0 && <div className="card-tags">{entity.tags.map((t) => `#${t}`).join(' ')}</div>}
    </article>
  )
}

export const CardNode = memo(CardNodeImpl)
