import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { EntityView } from '../../shared/types'

export type RegionNodeData = { entity: EntityView; dimmed: boolean }
export type RegionNodeType = Node<RegionNodeData, 'region'>

/** A map region's name on a board picture: acts as its Location card (pin for strings, double-click for the sheet). */
function RegionNodeImpl({ data, selected }: NodeProps<RegionNodeType>) {
  return (
    <div className={`board-region${selected ? ' is-selected' : ''}${data.dimmed ? ' is-dimmed' : ''}`}
      title={`${data.entity.name}: double-click to open the sheet, drag from the pin to tie a string, right-click for more`}>
      <Handle type="source" position={Position.Top} id="pin" className="pin" title="Drag to another card's pin to tie a string" />
    </div>
  )
}

export const RegionNode = memo(RegionNodeImpl)
