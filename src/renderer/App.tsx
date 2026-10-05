import { useEffect } from 'react'
import { useBoard } from './store'
import { StartScreen } from './screens/StartScreen'
import { BoardScreen } from './screens/BoardScreen'

export function App() {
  const info = useBoard((s) => s.info)
  const view = useBoard((s) => s.view)
  const message = useBoard((s) => s.message)

  // Messages fade after a few seconds; errors stay a little longer.
  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => useBoard.setState({ message: null }), message.isError ? 8000 : 3000)
    return () => clearTimeout(t)
  }, [message])

  return (
    <>
      {info && view ? <BoardScreen /> : <StartScreen />}
      {message && (
        <div className={`toast${message.isError ? ' toast-error' : ''}`} role={message.isError ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}
    </>
  )
}
