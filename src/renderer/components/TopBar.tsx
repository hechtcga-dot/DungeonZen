import { useState, type ReactNode } from 'react'
import { useBoard } from '../store'
import { formatClock } from '../../shared/time'
import { useLightingPref } from '../art/TableLighting'
import { CampaignSettingsDialog } from './EditDialogs'
import { Candle } from '../art/props'
import { lightingAt } from '../../shared/sky'

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/**
 * The wooden bar across the top of the board, sheet and library. `children` go in
 * the middle (the board puts its search there). Undo shortcuts live in DeskRail.
 */
export function TopBar({ children }: { children?: ReactNode }) {
  const { info, view, undo, redo } = useBoard()
  const [settings, setSettings] = useState(false)
  const [lighting, setLighting] = useLightingPref()
  const undoState = view?.undo ?? { undoLabel: null, redoLabel: null }
  return (
    <header className="topbar">
      <Candle className="topbar-candle" lit={!lighting || lightingAt(info?.clockMin ?? 0).candlesLit} />
      <button className="topbar-title" onClick={() => setSettings(true)} title="Campaign settings">{info?.name}</button>
      <div className="topbar-middle">{children}</div>
      <div className="row tight">
        <button className="brass icon" aria-label="Undo" title={undoState.undoLabel ? `Undo: ${undoState.undoLabel} (Ctrl+Z)` : 'Nothing to undo'}
          disabled={!undoState.undoLabel} onClick={() => void undo()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
        </button>
        <button className="brass icon" aria-label="Redo" title={undoState.redoLabel ? `Redo: ${undoState.redoLabel} (Ctrl+Y)` : 'Nothing to redo'}
          disabled={!undoState.redoLabel} onClick={() => void redo()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
        </button>
        <button className="brass icon" aria-pressed={lighting} aria-label={lighting ? 'Lighting follows the clock' : 'Lighting always bright'}
          title={lighting ? 'Lighting follows the clock (click for always bright)' : 'Always bright (click to follow the clock)'}
          onClick={() => setLighting(!lighting)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            {lighting ? <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>}
          </svg>
        </button>
      </div>
      <button className="clock mono" title="Set the campaign time" onClick={() => setSettings(true)}>{info ? formatClock(info.clockMin) : ''}</button>
      <CampaignSettingsDialog open={settings} onClose={() => setSettings(false)} />
    </header>
  )
}
