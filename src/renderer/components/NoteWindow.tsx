import { useCallback, useEffect, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { GlobalLinks } from './LinkField'
import { NoteReader } from './NoteReader'
import { useNotesTheme } from './NotesLibrary'
import type { NotesScreenView } from '../../shared/types'

/** One notes file in a window of its own (Notes tab ⧉, owner 2.8.0). Card sheets open in the main window. */
export function NoteWindow({ id }: { id: string }) {
  const info = useBoard((s) => s.info)
  const message = useBoard((s) => s.message)
  const [theme, setTheme] = useNotesTheme()
  const [data, setData] = useState<NotesScreenView | null>(null)
  const [docId, setDocId] = useState(id)
  const [none, setNone] = useState(false)
  const load = useCallback(() => void call('notes:screen', undefined).then(setData).catch(() => setData(null)), [])
  useEffect(() => {
    useBoard.setState({ windowScreen: 'import', openSheet: async (entityId: string) => { await call('main:openSheet', { entityId }) } })
    void (async () => {
      const info = await call('campaign:info', undefined).catch(() => null)
      if (!info) { setNone(true); return }
      useBoard.setState({ info, boardId: info.globalBoardId, screen: 'import', mode: 'prep' })
      await useBoard.getState().refresh()
      load()
    })()
    return window.dungeonzen.onChanged(() => { void useBoard.getState().refresh(); load() })
  }, [load])
  useEffect(() => { if (!message) return; const t = setTimeout(() => useBoard.setState({ message: null }), message.isError ? 8000 : 3000); return () => clearTimeout(t) }, [message])
  if (none) return <main className="journal-window"><p>Open a campaign in Dungeon Zen first.</p></main>
  if (!info || !data) return null
  const doc = data.docs.find((d) => d.id === docId)
  if (doc) document.title = `Dungeon Zen · ${doc.title}`
  return (
    <GlobalLinks>
      <div className="nb no-left" data-nb-theme={theme} style={{ height: '100vh' }}>
        <div className="nb-top">
          <div className="nb-topr" style={{ marginLeft: 'auto' }}>
            <span>Page</span>
            <div className="nb-seg" role="group" aria-label="Page colours">
              <button aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>Light</button>
              <button aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>Dark</button>
            </div>
          </div>
        </div>
        <span />
        {doc ? <NoteReader doc={doc} docs={data.docs} jump={null} folder={doc.folder} standalone onChanged={load} onOpenDoc={(x) => setDocId(x)} />
          : <section className="nb-mid"><p className="nb-muted" style={{ padding: 20 }}>That note is gone (moved to History or undone).</p></section>}
      </div>
      {message && <div className={`toast${message.isError ? ' toast-error' : ''}`} role={message.isError ? 'alert' : 'status'}>{message.text}</div>}
    </GlobalLinks>
  )
}
