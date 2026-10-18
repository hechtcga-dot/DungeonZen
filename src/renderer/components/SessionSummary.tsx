import { useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'

/**
 * Session summary tools (owner, 2026-10-18): Fill from the session (plain sentences from what the table did,
 * no AI) and Write with AI (the same facts, told as a story). Either is a proposal until the DM uses it.
 */
export function SummaryTools({ sessionId, value, onSave }: { sessionId: string; value: string; onSave(text: string): void }) {
  const { say, setAiSettingsOpen } = useBoard()
  const [draft, setDraft] = useState<{ text: string; source: string | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const plain = async () => {
    setError('')
    const text = await call('session:summaryDraft', { sessionId }).catch((e: Error) => { setError(e.message); return null })
    if (text === null) return
    if (!text) say('Nothing logged or ticked in this session yet: tick Played, Met and Revealed on the prep sheet, or log moments on Live.')
    else setDraft({ text, source: null })
  }
  const ai = async () => {
    setBusy(true); setError('')
    try { setDraft(await call('ai:recap', { sessionId, playerSafe: false })) } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }
  const use = (text: string) => { onSave(text); setDraft(null) }
  return (
    <div className="summary-tools">
      <div className="row tight wrap">
        <button type="button" className="ink-button" title="Short sentences from the session: where the party went, who they met, clues revealed, scenes played, fights and your Live notes. No AI." onClick={() => void plain()}>Fill from the session</button>
        <button type="button" className="ink-button" disabled={busy} title="The AI tells the same facts as a story; you keep or edit it" onClick={() => void ai()}>{busy ? 'Writing…' : 'Write with AI'}</button>
      </div>
      {error && <p className="field-error" role="alert">{error} {/service/i.test(error) && <button className="link-button" onClick={() => setAiSettingsOpen(true)}>Choose one…</button>}</p>}
      {draft && (
        <div className={draft.source ? 'ai-suggestion' : 'summary-draft'} role="region" aria-label="Summary draft">
          <span className={draft.source ? 'ai-badge' : 'ink-muted'}>{draft.source ? `AI suggestion · ${draft.source}` : 'Draft from the session: edit it after'}</span>
          <p className="selectable" style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{draft.text}</p>
          <div className="row tight wrap">
            <button type="button" className="ink-button primary-ink" onClick={() => use(draft.text)}>{value.trim() ? 'Replace mine' : 'Use this'}</button>
            {value.trim() && <button type="button" className="ink-button" onClick={() => use(`${value.trim()}\n\n${draft.text}`)}>Add below mine</button>}
            <button type="button" className="ink-button" onClick={() => setDraft(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}
