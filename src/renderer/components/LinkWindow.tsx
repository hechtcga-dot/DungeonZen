import { useEffect, useState } from 'react'
import { useBoard } from '../store'
import { call } from '../api'
import { Dialog } from './Dialog'
import { SecretEditor, SECRET_LABEL, type Conn } from './SecretEditor'
import type { IpcOutputs } from '../../shared/ipc'
import type { SecretKind } from '../../shared/types'

/** What opens the Link window: a board line, a record, or new links (from a board drag, a sheet, the card menu). */
export interface LinkRequest {
  relationshipId?: string
  secretId?: string
  start?: Conn[]
  kind?: SecretKind
  /** New lines go on this board when links are kept per board. */
  boardId?: string
  /** On a card's sheet: one link must be this card. */
  mustInclude?: { id: string; name: string }
}

const TEXT_LABEL: Record<SecretKind, string> = { connection: 'Description', secret: 'The secret', clue: 'The clue (what the players can find)' }

/**
 * The one Link window (3.0, owner's mockup A): a link, a secret or a clue is two or more cards, a link type per pair
 * and one text. Opens from the board (drag, click a line, card menu › New link), card sheets and prep. Save is one undo step.
 */
export function LinkWindow() {
  const req = useBoard((s) => s.linkWindow)
  const act = useBoard((s) => s.act)
  const close = () => useBoard.setState({ linkWindow: null })
  const [data, setData] = useState<IpcOutputs['link:get'] | null>(null)
  const [kind, setKind] = useState<SecretKind>('connection')
  const [text, setText] = useState('')
  const [known, setKnown] = useState(false)
  const [conns, setConns] = useState<Conn[]>([])
  useEffect(() => {
    setData(null)
    if (!req) return
    void call('link:get', { relationshipId: req.relationshipId, secretId: req.secretId }).then((d) => {
      setData(d)
      setKind(d.record?.kind ?? req.kind ?? 'connection')
      setText(d.record?.text ?? '')
      setKnown(d.known)
      setConns(d.record?.connections ?? req.start ?? [{ sourceId: req.mustInclude?.id ?? '', targetId: '', type: 'KNOWS' }])
    }, (err: Error) => { useBoard.getState().say(err.message, true); close() })
  }, [req])
  if (!req || !data) return null
  const record = data.record
  const problems = [
    ...(conns.length === 0 ? ['Add at least one pair of cards.'] : []),
    ...(conns.some((c) => !c.sourceId || !c.targetId) ? ['Pick both cards of every link.'] : []),
    ...(conns.some((c) => c.sourceId && c.sourceId === c.targetId) ? ['A link needs two different cards.'] : []),
    ...(req.mustInclude && !conns.some((c) => c.sourceId === req.mustInclude!.id || c.targetId === req.mustInclude!.id) ? [`One link must include ${req.mustInclude.name}.`] : [])
  ]
  const save = async () => {
    const id = await act('link:save', { id: record?.id ?? null, kind, text, known, boardId: req.boardId,
      connections: conns.map((c) => ({ ...(c.id ? { id: c.id } : {}), sourceId: c.sourceId, targetId: c.targetId, type: c.type })) })
    if (id) close()
  }
  const remove = async () => {
    if (record?.id) await act('secret:remove', { id: record.id })
    else for (const c of record?.connections ?? []) await act('relationship:setStatus', { id: c.id, status: 'defunct' })
    close()
  }
  return (
    <Dialog title={SECRET_LABEL[kind]} open onClose={close}>
      <div className="link-window">
        <div className="row tight" role="group" aria-label="Link, secret or clue">
          {(['connection', 'secret', 'clue'] as const).map((k) => (
            <button key={k} type="button" className={`toggle-chip${k !== 'connection' ? ' secret-chip' : ''}`} aria-pressed={kind === k} onClick={() => setKind(k)}>{SECRET_LABEL[k]}</button>
          ))}
        </div>
        <SecretEditor key={record?.id ?? record?.connections[0]?.id ?? 'new'} secret={null} kind={kind} cards={data.cards} start={conns}
          mustInclude={req.mustInclude} manual={setConns} />
        <div className="field">
          <label htmlFor="link-window-text">{TEXT_LABEL[kind]}</label>
          <textarea id="link-window-text" rows={4} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={kind === 'connection' ? 'Anything about this link (optional)' : 'What is true, and who knows it'} />
        </div>
        <div className="field checkbox">
          <input id="link-window-known" type="checkbox" checked={known} onChange={(e) => setKnown(e.target.checked)} />
          <label htmlFor="link-window-known">The players know this</label>
        </div>
        <p className="hint">Secret and Clue: dashed on the board. Link: a plain line; its text is the description.</p>
        {problems.length > 0 && <p className="secret-problem" role="alert">{problems.join(' ')}</p>}
      </div>
      <div className="dz-actions">
        {record && <button className="danger" onClick={() => void remove()}>Move to History</button>}
        <span className="spacer" />
        <button onClick={close}>Cancel</button>
        <button className="primary" disabled={problems.length > 0} onClick={() => void save()}>Save</button>
      </div>
    </Dialog>
  )
}
