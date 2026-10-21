import { lazy, Suspense, useEffect, useState } from 'react'
import { SCREEN_NAMES, useBoard, type Screen } from './store'
import { call } from './api'
import { DeskFrame } from './components/DeskFrame'
import { Icon } from './components/DeskRail'
import { useFolding } from './fold'
import { OrderScopeDialog } from './components/OrderScopeDialog'
import { StartScreen } from './screens/StartScreen'
import { AiSettingsDialog } from './components/AiSettingsDialog'
import { LinkWindow } from './components/LinkWindow'
import { FindAnything } from './components/FindAnything'
import { BattleMapDialog } from './components/BattleMapDialog'
import { GlobalLinks, LinkedCardNote } from './components/LinkField'
import { Toast } from './components/TopBar'

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
const PrepWindow = lazy(() => import('./screens/PrepScreen').then((m) => ({ default: m.PrepWindow })))
const NoteWindow = lazy(() => import('./components/NoteWindow').then((m) => ({ default: m.NoteWindow })))
const JournalWindow = lazy(() => import('./screens/JournalWindow').then((m) => ({ default: m.JournalWindow })))

export function App() {
  useFolding()
  const hash = window.location.hash
  const prep = /^#prep\/(\d+)\/(.+)$/.exec(hash)
  const pop = /^#screen\/(\w+)$/.exec(hash)
  if (pop) return <ScreenWindow screen={pop[1] as Screen} />
  const note = /^#note\/([\w-]+)$/.exec(hash)
  if (note) return <Suspense fallback={null}><NoteWindow id={note[1]} /></Suspense>
  if (prep) return <Suspense fallback={null}><PrepWindow number={Number(prep[1])} part={decodeURIComponent(prep[2])} /></Suspense>
  return hash === '#journal' ? <Suspense fallback={null}><JournalWindow /></Suspense> : <MainApp />
}

function MainApp() {
  const info = useBoard((s) => s.info)
  const view = useBoard((s) => s.view)
  const screen = useBoard((s) => s.screen)
  const message = useBoard((s) => s.message)
  const popped = useBoard((s) => s.popped)

  // A new version downloaded in the background (3.0): it installs when the app closes, or now on Restart now.
  useEffect(() => window.dungeonzen.onUpdateReady((version) => useBoard.getState().say(
    `Dungeon Zen ${version} is ready: it installs when you close the app.`, false, { label: 'Restart now', run: () => void call('app:restartToUpdate', undefined) })), [])

  // Screens open in windows of their own show here as "open in another window".
  useEffect(() => {
    void call('window:popped', undefined).then((p) => useBoard.setState({ popped: p })).catch(() => undefined)
    return window.dungeonzen.onPopped((p) => useBoard.setState({ popped: p }))
  }, [])
  // The popped-out DM notes changed something: show it here too.
  useEffect(() => window.dungeonzen.onChanged(() => void useBoard.getState().refresh()), [])
  // A pop-out prep window asked for a card's sheet.
  useEffect(() => window.dungeonzen.onOpenSheet((id) => void useBoard.getState().openSheet(id)), [])

  // Messages fade after a few seconds; errors stay a little longer.
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => useBoard.setState({ message: null }), message.isError ? 8000 : message.action ? 7000 : 3000)
    return () => clearTimeout(t)
  }, [message])

  return (
    <>
      <OrderScopeDialog />
      <GlobalLinks>
      <Suspense fallback={null}>
      {!info || !view ? <StartScreen />
        : popped.includes(screen) ? <PoppedOut screen={screen} />
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
      </GlobalLinks>
      {info && view && <LinkedCardNote />}
      {info && view && <LinkWindow />}
      {info && view && <FindAnything />}
      <AiSettingsDialog />
      <Toast />
    </>
  )
}

const POP_ICON: Partial<Record<Screen, 'board' | 'encounters' | 'prep' | 'library' | 'notes'>> = { board: 'board', encounters: 'encounters', prep: 'prep', library: 'library', import: 'notes' }

/** Main window: this screen is open in a window of its own; a click brings that window forward. */
function PoppedOut({ screen }: { screen: Screen }) {
  const name = SCREEN_NAMES[screen].replace(/^the /, '')
  return (
    <DeskFrame>
      <button className="popped-out" onClick={() => void call('window:focusScreen', { screen: screen as 'board' })}
        title="Bring that window forward. Close it there to have the screen back here.">
        <span className="popped-icon"><Icon name={POP_ICON[screen] ?? 'board'} /></span>
        <span className="popped-text">{name[0].toUpperCase() + name.slice(1)} is open in another window</span>
      </button>
    </DeskFrame>
  )
}

/** A whole screen in a window of its own (rail right-click, owner 2026-10-15). Card sheets open in the main window. */
function ScreenWindow({ screen }: { screen: Screen }) {
  const info = useBoard((s) => s.info)
  const view = useBoard((s) => s.view)
  const current = useBoard((s) => s.screen)
  const message = useBoard((s) => s.message)
  const [none, setNone] = useState(false)
  useEffect(() => {
    useBoard.setState({ windowScreen: screen, openSheet: async (entityId: string) => { await call('main:openSheet', { entityId }) } })
    void (async () => {
      const info = await call('campaign:info', undefined).catch(() => null)
      if (!info) { setNone(true); return }
      useBoard.setState({ info, boardId: info.globalBoardId, screen, mode: 'prep' })
      await useBoard.getState().refresh()
    })()
    return window.dungeonzen.onChanged(() => void useBoard.getState().refresh())
  }, [screen])
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => useBoard.setState({ message: null }), message.isError ? 8000 : message.action ? 7000 : 3000)
    return () => clearTimeout(t)
  }, [message])
  if (none) return <main className="journal-window"><p>Open a campaign in Dungeon Zen first.</p></main>
  if (!info || !view) return null
  return (
    <>
      <OrderScopeDialog />
      <GlobalLinks>
      <Suspense fallback={null}>
        {current === 'encounters' ? <EncountersScreen />
          : current === 'prep' ? <PrepScreen />
          : current === 'library' ? <LibraryScreen />
          : current === 'import' ? <ImportScreen />
          : current === 'map' ? <MapScreen />
          : current === 'timeline' ? <TimelineScreen />
          : current === 'combat' ? <CombatScreen />
          : current === 'generators' ? <GeneratorsScreen />
          : current === 'guide' ? <GuideScreen />
          : current === 'review' ? <ReviewScreen />
          : <BoardScreen />}
      </Suspense>
      <BattleMapDialog />
      </GlobalLinks>
      <LinkedCardNote />
      <LinkWindow />
      <AiSettingsDialog />
      {message && <div className={`toast${message.isError ? ' toast-error' : ''}`} role={message.isError ? 'alert' : 'status'}>{message.text}
        {message.action && <button className="toast-action" onClick={() => { message.action!.run(); useBoard.setState({ message: null }) }}>{message.action.label}</button>}</div>}
    </>
  )
}
