import { memo } from 'react'
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react'
import { onResized } from './CardNode'
import { MapOverlay } from './MapOverlay'
import type { MapScreenView } from '../../shared/types'

export type ImageNodeData = {
  src: string; name: string; opacity: number; locked: boolean; hidden: boolean
  /** A campaign map: its regions, names always drawn over the picture, shapes per Display › Region boundaries. */
  map?: MapScreenView
  /** Region outlines (Display › Region boundaries); names always show. */
  outlines?: boolean
}
export type ImageNodeType = Node<ImageNodeData, 'image'>

/** A picture under the cards (a map or any image). Locked pictures stay put. */
function ImageNodeImpl({ id, data, selected, width }: NodeProps<ImageNodeType>) {
  const m = data.map?.map
  return (
    <div className={`board-image${selected ? ' is-selected' : ''}${data.hidden ? ' is-hidden' : ''}${data.locked ? ' is-locked' : ''}`}
      title={`${data.name}${data.locked ? ' (locked)' : ''}: right-click for more`}>
      <NodeResizer isVisible={selected && !data.locked} minWidth={80} minHeight={60} keepAspectRatio onResizeEnd={onResized(id)} color="#6cb6d9" />
      <img src={data.src} alt={data.name} draggable={false} style={{ opacity: data.opacity }} />
      {data.map && m?.width && m.height && (
        <svg className="board-image-regions" viewBox={`0 0 ${m.width} ${m.height}`} preserveAspectRatio="none" aria-hidden="true">
          <MapOverlay view={data.map} ctx={{ scale: (width ?? 1200) / m.width, toImage: () => [0, 0] }} hideParty outlines={data.outlines} />
        </svg>
      )}
      {data.locked && selected && <span className="board-image-lock" aria-hidden="true">🔒</span>}
    </div>
  )
}

export const ImageNode = memo(ImageNodeImpl)
