import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getStraightPath, useInternalNode, type Edge, type EdgeProps, type InternalNode } from '@xyflow/react'
import { stringEnds } from '../../shared/layout'

export type StringEdgeData = {
  type: string; isSecret: boolean; resolved: boolean; dimmed: boolean
  /** The kind's own colour (Connections), else red. */
  colour: string | null
  hidden: boolean
  /** Connections panel open: strings stand out. */
  highlight: boolean
}
export type StringEdgeType = Edge<StringEdgeData, 'string'>

const RED = '#d2453a'
const GREY = '#6b727c'
const SELECTED = '#6cb6d9'

// Known link: solid. Secret link: dashed. Touching a resolved card: grey. Hidden: faint.
const rect = (n: InternalNode) => ({
  x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w: n.measured.width ?? 0, h: n.measured.height ?? 0
})

// The string attaches to whichever of each card's six points (corners, top and bottom middle) are closest.
function StringEdgeImpl({ id, source, target, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<StringEdgeType>) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  const ends = a?.measured.width && b?.measured.width ? stringEnds(rect(a), rect(b)) : { sx: sourceX, sy: sourceY, tx: targetX, ty: targetY }
  const [path, labelX, labelY] = getStraightPath({ sourceX: ends.sx, sourceY: ends.sy, targetX: ends.tx, targetY: ends.ty })
  const colour = selected ? SELECTED : data?.resolved ? GREY : data?.colour ?? RED
  const label = (data?.type ?? '').replace(/_/g, ' ')
  const opacity = data?.dimmed ? 0.25 : data?.hidden ? 0.35 : 1
  const width = (selected ? 3 : 2) + (data?.highlight ? 1.5 : 0)
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={16}
        style={{ stroke: colour, strokeWidth: width, strokeDasharray: data?.isSecret ? '8 6' : undefined, opacity }}
      />
      <EdgeLabelRenderer>
        <div
          className={`string-label${data?.isSecret ? ' is-secret' : ''}${data?.highlight ? ' is-highlight' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, borderColor: colour, opacity }}
        >
          {data?.isSecret ? `SECRET · ${label}` : label}{data?.hidden ? ' (hidden)' : ''}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const StringEdge = memo(StringEdgeImpl)
