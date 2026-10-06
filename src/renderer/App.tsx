import { useEffect } from 'react'
import { useBoard } from './store'
import { StartScreen } from './screens/StartScreen'
import { BoardScreen } from './screens/BoardScreen'
import { SheetScreen } from './screens/SheetScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { DeskScreen } from './screens/DeskScreen'
import { MapScreen } from './screens/MapScreen'
import { TimelineScreen } from './screens/TimelineScreen'
import { LiveScreen } from './screens/LiveScreen'

export function App() {
  const info = useBoard((s) => s.info)
  const view = useBoard((s) => s.view)
  const screen = useBoard((s) => s.screen)
  const message = useBoard((s) => s.message)

  // Messages fade after a few seconds; errors stay a little longer.
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => useBoard.setState({ message: null }), message.isError ? 8000 : 3000)
    return () => clearTimeout(t)
  }, [message])

  return (
    <>
      {!info || !view ? <StartScreen />
        : screen === 'sheet' ? <SheetScreen />
          : screen === 'library' ? <LibraryScreen />
            : screen === 'desk' ? <DeskScreen />
              : screen === 'map' ? <MapScreen />
                : screen === 'timeline' ? <TimelineScreen />
                : screen === 'live' ? <LiveScreen />
                : <BoardScreen />}
      {message && (
        <div className={`toast${message.isError ? ' toast-error' : ''}`} role={message.isError ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}
    </>
  )
}
