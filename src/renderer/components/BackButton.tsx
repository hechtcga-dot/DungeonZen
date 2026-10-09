import { SCREEN_NAMES, useBoard } from '../store'

/** Back to the screen the DM came from (the board when there is none). Backspace and Alt+Left do the same (DeskRail). */
export function BackButton() {
  const prev = useBoard((s) => s.backStack.at(-1))
  const goBack = useBoard((s) => s.goBack)
  return <button className="link" onClick={() => void goBack()} title="Backspace">← Back to {prev ? SCREEN_NAMES[prev.screen] : 'the board'}</button>
}
