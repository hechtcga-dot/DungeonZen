import { useEffect } from 'react'
import { SCREEN_NAMES, useBoard } from '../store'

/** Back to the screen the DM came from (the board when there is none). Alt+Left does the same. */
export function BackButton() {
  const prev = useBoard((s) => s.backStack.at(-1))
  const goBack = useBoard((s) => s.goBack)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); void goBack() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack])
  return <button className="link" onClick={() => void goBack()} title="Alt+Left">← Back to {prev ? SCREEN_NAMES[prev.screen] : 'the board'}</button>
}
