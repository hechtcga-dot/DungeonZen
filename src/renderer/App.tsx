import { lazy, Suspense, useEffect } from 'react'
import { useBoard } from './store'
import { StartScreen } from './screens/StartScreen'
import { AiSettingsDialog } from './components/AiSettingsDialog'
import { BattleMapDialog } from './components/BattleMapDialog'

// Each screen loads the first time it opens (faster start).
const BoardScreen = lazy(() => import('./screens/BoardScreen').then((m) => ({ default: m.BoardScreen })))
const SheetScreen = lazy(() => import('./screens/SheetScreen').then((m) => ({ default: m.SheetScreen })))
const LibraryScreen = lazy(() => import('./screens/LibraryScreen').then((m) => ({ default: m.LibraryScreen })))
const DeskScreen = lazy(() => import('./screens/DeskScreen').then((m) => ({ default: m.DeskScreen })))
const MapScreen = lazy(() => import('./screens/MapScreen').then((m) => ({ default: m.MapScreen })))
const TimelineScreen = lazy(() => import('./screens/TimelineScreen').then((m) => ({ default: m.TimelineScreen })))
const LiveScreen = lazy(() => import('./screens/LiveScreen').then((m) => ({ default: m.LiveScreen })))
const ReviewScreen = lazy(() => import('./screens/ReviewScreen').then((m) => ({ default: m.ReviewScreen })))
const PrepScreen = lazy(() => import('./screens/PrepScreen').then((m) => ({ default: m.PrepScreen })))
const PlayersScreen = lazy(() => import('./screens/PlayersScreen').then((m) => ({ default: m.PlayersScreen })))
const EncountersScreen = lazy(() => import('./screens/EncountersScreen').then((m) => ({ default: m.EncountersScreen })))
const ImportScreen = lazy(() => import('./screens/ImportScreen').then((m) => ({ default: m.ImportScreen })))
const CombatScreen = lazy(() => import('./screens/CombatScreen').then((m) => ({ default: m.CombatScreen })))
const GuideScreen = lazy(() => import('./screens/GuideScreen').then((m) => ({ default: m.GuideScreen })))
const GeneratorsScreen = lazy(() => import('./screens/GeneratorsScreen').then((m) => ({ default: m.GeneratorsScreen })))
const JournalWindow = lazy(() => import('./screens/JournalWindow').then((m) => ({ default: m.JournalWindow })))

export function App() {
  return window.location.hash === '#journal' ? <Suspense fallback={null}><JournalWindow /></Suspense> : <MainApp />
}

function MainApp() {
  const info = useBoard((s) => s.info)
  const view = useBoard((s) => s.view)
  const screen = useBoard((s) => s.screen)
  const message = useBoard((s) => s.message)

  // The popped-out DM notes changed something: show it here too.
  useEffect(() => window.dungeonzen.onChanged(() => void useBoard.getState().refresh()), [])

  // Messages fade after a few seconds; errors stay a little longer.
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => useBoard.setState({ message: null }), message.isError ? 8000 : 3000)
    return () => clearTimeout(t)
  }, [message])

  return (
    <>
      <Suspense fallback={null}>
      {!info || !view ? <StartScreen />
        : screen === 'sheet' ? <SheetScreen />
          : screen === 'library' ? <LibraryScreen />
            : screen === 'desk' ? <DeskScreen />
              : screen === 'map' ? <MapScreen />
                : screen === 'timeline' ? <TimelineScreen />
                : screen === 'live' ? <LiveScreen />
                : screen === 'review' ? <ReviewScreen />
                : screen === 'prep' ? <PrepScreen />
                : screen === 'players' ? <PlayersScreen />
                : screen === 'encounters' ? <EncountersScreen />
                : screen === 'import' ? <ImportScreen />
                : screen === 'guide' ? <GuideScreen />
                : screen === 'combat' ? <CombatScreen />
                : screen === 'generators' ? <GeneratorsScreen />
                : <BoardScreen />}
      </Suspense>
      {info && view && <BattleMapDialog />}
      <AiSettingsDialog />
      {message && (
        <div className={`toast${message.isError ? ' toast-error' : ''}`} role={message.isError ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}
    </>
  )
}
