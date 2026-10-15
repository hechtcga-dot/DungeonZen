import type { ReactNode } from 'react'
import { SCREEN_NAMES, useBoard } from '../store'
import { DeskRail, Icon, useRailKeys } from './DeskRail'
import { ArtDefs } from '../art/ArtDefs'
import { TableLighting } from '../art/TableLighting'

/** Every campaign screen sits on the same wooden table: rail, lighting and shared SVG filters. */
export function DeskFrame({ children }: { children: ReactNode }) {
  const minutes = useBoard((s) => s.info?.clockMin ?? 0)
  const popped = useBoard((s) => s.windowScreen !== null)
  return (
    <div className="desk-screen desk-theme">
      <TableLighting minutes={minutes} />
      <ArtDefs />
      {popped ? <PopRail /> : <DeskRail />}
      <div className="frame-col">{children}</div>
    </div>
  )
}

/** A popped-out screen's rail: Back, and Close (the screen goes back to the main window). */
function PopRail() {
  const goBack = useBoard((s) => s.goBack)
  const prev = useBoard((s) => s.backStack.at(-1))
  useRailKeys()
  return (
    <nav className="rail pop-rail" aria-label="Window">
      <div className="rail-mark" aria-hidden="true">DZ</div>
      <button className="rail-item pop-close" onClick={() => window.close()} title="Close this window; the screen goes back into the main window">
        <Icon name="dock" /><span>Close window</span>
      </button>
      {prev && (
        <button className="rail-item" onClick={() => void goBack()} title={`Back to ${SCREEN_NAMES[prev.screen]} (Backspace)`}>
          <Icon name="back" /><span>Back</span>
        </button>
      )}
    </nav>
  )
}
