import { memo } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { onResized } from './CardNode'

export type NoteNodeData = { text: string; dimmed: boolean; hidden: boolean }
export type NoteNodeType = Node<NoteNodeData, 'note'>

function NoteNodeImpl({ id, data, selected, width }: NodeProps<NoteNodeType>) {
  const classes = ['note', width != null && 'note-sized', selected && 'is-selected', data.dimmed && 'is-dimmed', data.hidden && 'is-hidden']
  return (
    <div className={classes.filter(Boolean).join(' ')} title="Right-click for more">
      <NodeResizer isVisible={selected} minWidth={90} minHeight={40} onResizeEnd={onResized(id)} color="#6cb6d9" />
      {data.text || <span className="note-empty">Empty note: type in the panel on the right</span>}
    </div>
  )
}

export const NoteNode = memo(NoteNodeImpl)
