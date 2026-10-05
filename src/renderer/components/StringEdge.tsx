import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getStraightPath, type Edge, type EdgeProps } from '@xyflow/react'

export type StringEdgeData = { type: string; isSecret: boolean; resolved: boolean; dimmed: boolean }
export type StringEdgeType = Edge<StringEdgeData, 'string'>

const RED = '#d2453a'
const GREY = '#6b727c'
const SELECTED = '#6cb6d9'

// Known link: solid red. Secret link: dashed red. Touching a resolved card: grey.
function StringEdgeImpl({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<StringEdgeType>) {
  const [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY })
  const colour = selected ? SELECTED : data?.resolved ? GREY : RED
  const label = (data?.type ?? '').replace(/_/g, ' ')
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={16}
        style={{
          stroke: colour,
          strokeWidth: selected ? 3 : 2,
          strokeDasharray: data?.isSecret ? '8 6' : undefined,
          opacity: data?.dimmed ? 0.25 : 1
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`string-label${data?.isSecret ? ' is-secret' : ''}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            borderColor: colour,
            opacity: data?.dimmed ? 0.25 : 1
          }}
        >
          {data?.isSecret ? `SECRET · ${label}` : label}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export const StringEdge = memo(StringEdgeImpl)
