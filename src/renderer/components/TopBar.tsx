import { useEffect, type ReactNode } from 'react'
import { useBoard } from '../store'
import { formatClock } from '../../shared/time'

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/** The bar across the top of every campaign screen. `children` go in the middle (the board puts its search there). */
export function TopBar({ children }: { children?: ReactNode }) {
  const { info, view, screen, undo, redo, goTo, closeCampaign } = useBoard()

  // Ctrl+Z undo, Ctrl+Y or Ctrl+Shift+Z redo, on every screen (text fields keep their own undo).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); void undo() }
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); void redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const undoState = view?.undo ?? { undoLabel: null, redoLabel: null }
  return (
    <header className="topbar">
      <div className="brand">Dungeon Zen</div>
      <button onClick={() => void closeCampaign()} title="Close this campaign and go back to the campaign list">
        {info?.name}
      </button>
      <nav className="row tight" aria-label="Screens">
        <button aria-pressed={screen === 'desk'} onClick={() => goTo('desk')}>Desk</button>
        <button aria-pressed={screen === 'board'} onClick={() => goTo('board')}>Board</button>
        <button aria-pressed={screen === 'map'} onClick={() => goTo('map')}>Map</button>
        <button aria-pressed={screen === 'library'} onClick={() => goTo('library')}>Library</button>
      </nav>
      <div className="topbar-middle">{children}</div>
      <div className="row tight">
        <button aria-label="Undo" title={undoState.undoLabel ? `Undo: ${undoState.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
          disabled={!undoState.undoLabel} onClick={() => void undo()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
        </button>
        <button aria-label="Redo" title={undoState.redoLabel ? `Redo: ${undoState.redoLabel} (Ctrl+Y)` : 'Nothing to redo'}
          disabled={!undoState.redoLabel} onClick={() => void redo()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
        </button>
      </div>
      <div className="clock mono" title="Campaign time">{info ? formatClock(info.clockMin) : ''}</div>
    </header>
  )
}
