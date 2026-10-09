import { useEffect } from 'react'
import { SCREEN_NAMES, useBoard, type Mode } from '../store'
import { isTyping } from './TopBar'
import { SetupMenu } from './SetupMenu'

const ICONS = {
  desk: <path d="M4 10h16M6 10v9M18 10v9M8 6h8l2 4H6z" />,
  board: <><rect x="3" y="4" width="18" height="15" rx="1" /><path d="M7 9l5 3 5-4M7 9v0M12 12v0" /><circle cx="7" cy="9" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="17" cy="8" r="1.4" /></>,
  map: <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14" />,
  library: <path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 3 15-3.5 1z" />,
  timeline: <><path d="M3 6h10M7 12h12M3 18h8" /><path d="M16 3v18" strokeDasharray="2 2" /></>,
  live: <><circle cx="12" cy="12" r="3" /><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17" /></>,
  ai: <><path d="M12 3l1.8 4.6L18.5 9.5l-4.7 1.9L12 16l-1.8-4.6L5.5 9.5l4.7-1.9z" /><path d="M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></>,
  encounters: <><path d="M5 19L17 7M17 7V3h4v4h-4" /><path d="M19 19L7 7M7 7V3H3v4h4" /><path d="M8 16l-3 3M16 16l3 3" /></>,
  import: <><path d="M12 3v11M7 9l5 5 5-5" /><path d="M4 15v5h16v-5" /></>,
  prep: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 9h6M9 13h6M9 17h4" /></>,
  players: <><circle cx="8" cy="9" r="3" /><circle cx="16" cy="9" r="3" /><path d="M2.5 19q0-5 5.5-5t5.5 5M10.5 19q0-5 5.5-5t5.5 5" /></>,
  notes: <><path d="M6 3h11a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z" /><path d="M6 3v18M9 8h6M9 12h6M9 16h4" /><path d="M4 6h2M4 10h2M4 14h2M4 18h2" /></>,
  setup: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
  back: <path d="M10 6l-6 6 6 6M4 12h16" />,
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
  const { screen, goTo, closeCampaign, undo, redo, setAiSettingsOpen, mode, setMode, goBack } = useBoard()
  const prev = useBoard((s) => s.backStack.at(-1))

  // Same undo shortcuts as the top bar on the other screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); void undo() }
      else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); void redo() }
      else if ((e.key === 'Backspace' && !mod && !e.altKey) || (e.altKey && e.key === 'ArrowLeft')) {
        // Back, unless a pop-up is open or the screen used the key (the board's Backspace removes a selection).
        if (document.querySelector('dialog[open]') || !useBoard.getState().backStack.length) return
        setTimeout(() => { if (!e.defaultPrevented) void goBack() })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, goBack])

  const item = (id: 'desk' | 'board' | 'map' | 'timeline' | 'live' | 'library' | 'prep' | 'players' | 'encounters' | 'import', label: string, icon: keyof typeof ICONS = id) => (
    <button className="rail-item" aria-current={screen === id ? 'page' : undefined} onClick={() => goTo(id)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )
  const modeButton = (m: Mode, label: string, title: string) => (
    <button className="rail-mode" aria-pressed={mode === m} title={title} onClick={() => setMode(m)}>{label}</button>
  )
  return (
    <nav className="rail" aria-label="Screens">
      <div className="rail-mark" aria-hidden="true">DZ</div>
      {prev && (
        <button className="rail-item" onClick={() => void goBack()} title={`Back to ${SCREEN_NAMES[prev.screen]} (Backspace)`}>
          <Icon name="back" /><span>Back</span>
        </button>
      )}
      <div className="rail-modes" role="group" aria-label="Mode">
        {modeButton('prep', 'Prep', 'DM prep: every screen and option')}
        {modeButton('live', 'Live', 'Live session: what you need at the table, for where the party is')}
        {modeButton('players', 'Players', 'Player preview: only what the players know, safe to show them')}
      </div>
      {mode === 'prep' && (
        <>
          {item('desk', 'Desk')}
          {item('prep', 'Session prep', 'prep')}
          {item('encounters', 'Encounters', 'encounters')}
          {item('board', 'Board')}
          {item('map', 'Map')}
          {item('timeline', 'Timeline')}
          {item('library', 'Library')}
          {item('import', 'Notes', 'notes')}
        </>
      )}
      {mode === 'live' && (
        <>
          {item('live', 'Live desk', 'live')}
          {item('map', 'Map')}
        </>
      )}
      {mode === 'players' && item('players', 'What they know', 'players')}
      <span className="spacer" />
      <SetupMenu icon={<Icon name="setup" />} />
      <button className="rail-item" onClick={() => setAiSettingsOpen(true)} title="Choose AI services for writing and battle maps">
        <Icon name="ai" /><span>AI</span>
      </button>
      <button className="rail-item" onClick={() => void closeCampaign()} title="Close this campaign">
        <Icon name="close" /><span>Close</span>
      </button>
    </nav>
  )
}
