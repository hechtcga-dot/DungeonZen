import { useEffect } from 'react'
import { useBoard } from '../store'
import { isTyping } from './TopBar'

const ICONS = {
  desk: <path d="M4 10h16M6 10v9M18 10v9M8 6h8l2 4H6z" />,
  board: <><rect x="3" y="4" width="18" height="15" rx="1" /><path d="M7 9l5 3 5-4M7 9v0M12 12v0" /><circle cx="7" cy="9" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="17" cy="8" r="1.4" /></>,
  map: <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />,
  library: <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 3 15-3.5 1z" />,
  timeline: <><path d="M3 6h10M7 12h12M3 18h8" /><path d="M16 3v18" strokeDasharray="2 2" /></>,
  close: <path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
}

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>
  )
}

/** The dark iron-and-wood rail down the left of the desk style screens. */
export function DeskRail() {
  const { screen, goTo, closeCampaign, undo, redo } = useBoard()

  // Same undo shortcuts as the top bar on the other screens.
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

  const item = (id: 'desk' | 'board' | 'map' | 'timeline' | 'library', label: string) => (
    <button className="rail-item" aria-current={screen === id ? 'page' : undefined} onClick={() => goTo(id)}>
      <Icon name={id} /><span>{label}</span>
    </button>
  )
  return (
    <nav className="rail" aria-label="Screens">
      <div className="rail-mark" aria-hidden="true">DZ</div>
      {item('desk', 'Desk')}
      {item('board', 'Board')}
      {item('map', 'Map')}
      {item('timeline', 'Timeline')}
      {item('library', 'Library')}
      <span className="spacer" />
      <button className="rail-item" onClick={() => void closeCampaign()} title="Close this campaign">
        <Icon name="close" /><span>Close</span>
      </button>
    </nav>
  )
}
