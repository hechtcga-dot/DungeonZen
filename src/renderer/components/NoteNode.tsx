import { memo } from 'react'
import type { Node, NodeProps } from '@xyflow/react'

export type NoteNodeData = { text: string; dimmed: boolean }
export type NoteNodeType = Node<NoteNodeData, 'note'>

function NoteNodeImpl({ data, selected }: NodeProps<NoteNodeType>) {
  const classes = ['note', selected && 'is-selected', data.dimmed && 'is-dimmed']
  return (
    <div className={classes.filter(Boolean).join(' ')}>
      {data.text || <span className="note-empty">Empty note: type in the panel on the right</span>}
    </div>
  )
}

export const NoteNode = memo(NoteNodeImpl)
