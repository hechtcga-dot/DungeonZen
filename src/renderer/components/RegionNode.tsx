import { memo, type CSSProperties } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { EntityView } from '../../shared/types'

export type RegionNodeData = { entity: EntityView; occupants: string[]; colour: string; dimmed: boolean }
export type RegionNodeType = Node<RegionNodeData, 'region'>

/** A map region's name on a board picture: acts as its Location card (pin for strings, double-click for the sheet). */
function RegionNodeImpl({ data, selected }: NodeProps<RegionNodeType>) {
  return (
    <div className={`board-region${selected ? ' is-selected' : ''}${data.dimmed ? ' is-dimmed' : ''}`} style={{ '--type': data.colour } as CSSProperties}
      title={`${data.entity.name}: double-click to open the sheet, drag from the pin to tie a string, right-click for more`}>
      <Handle type="source" position={Position.Top} id="pin" className="pin" title="Drag to another card's pin to tie a link" />
      <span className="board-region-name">{data.entity.name}</span>
      {data.occupants.length > 0 && (
        <span className="board-region-here" title={`Here now: ${data.occupants.join(', ')}`}>
          {data.occupants.slice(0, 3).join(' · ')}{data.occupants.length > 3 ? ` +${data.occupants.length - 3}` : ''}
        </span>
      )}
    </div>
  )
}

export const RegionNode = memo(RegionNodeImpl)
