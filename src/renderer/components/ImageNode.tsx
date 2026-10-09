import { memo } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { onResized } from './CardNode'

export type ImageNodeData = { src: string; name: string; opacity: number; locked: boolean; hidden: boolean }
export type ImageNodeType = Node<ImageNodeData, 'image'>

/** A picture under the cards (a map or any image). Locked pictures stay put. */
function ImageNodeImpl({ id, data, selected }: NodeProps<ImageNodeType>) {
  return (
    <div className={`board-image${selected ? ' is-selected' : ''}${data.hidden ? ' is-hidden' : ''}${data.locked ? ' is-locked' : ''}`}
      title={`${data.name}${data.locked ? ' (locked)' : ''}: right-click for more`}>
      <NodeResizer isVisible={selected && !data.locked} minWidth={80} minHeight={60} keepAspectRatio onResizeEnd={onResized(id)} color="#6cb6d9" />
      <img src={data.src} alt={data.name} draggable={false} style={{ opacity: data.opacity }} />
      {data.locked && selected && <span className="board-image-lock" aria-hidden="true">🔒</span>}
    </div>
  )
}

export const ImageNode = memo(ImageNodeImpl)
