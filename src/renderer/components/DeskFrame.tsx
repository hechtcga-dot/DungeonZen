import type { ReactNode } from 'react'
import { useBoard } from '../store'
import { DeskRail } from './DeskRail'
import { ArtDefs } from '../art/ArtDefs'
import { TableLighting } from '../art/TableLighting'

/** Every campaign screen sits on the same wooden table: rail, lighting and shared SVG filters. */
export function DeskFrame({ children }: { children: ReactNode }) {
  const minutes = useBoard((s) => s.info?.clockMin ?? 0)
  return (
    <div className="desk-screen desk-theme">
      <TableLighting minutes={minutes} />
      <ArtDefs />
      <DeskRail />
      <div className="frame-col">{children}</div>
    </div>
  )
}
