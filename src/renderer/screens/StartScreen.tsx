import { useEffect, useState, type FormEvent } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { Candle } from '../art/props'
import type { CampaignInfo, RecentCampaign } from '../../shared/types'

export function StartScreen() {
  const openCampaign = useBoard((s) => s.openCampaign)
  const say = useBoard((s) => s.say)
  const [recent, setRecent] = useState<RecentCampaign[]>([])
  const [name, setName] = useState('')

  useEffect(() => {
    call('profile:recent', undefined).then(setRecent, (err: Error) => say(err.message, true))
  }, [say])

  async function attempt(load: () => Promise<CampaignInfo | null>) {
    try {
      const info = await load()
      if (info) await openCampaign(info)
    } catch (err) {
      say((err as Error).message, true)
    }
  }

  function create(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    void attempt(() => call('campaign:create', { name: name.trim() }))
  }

  return (
    <div className="desk-screen desk-theme start-screen">
    <Candle className="start-candle" />
    <main className="start">
      <h1 className="start-title">Dungeon Zen</h1>
      <p className="muted">Campaign boards, storylines and time for Dungeon Masters. Everything stays on this computer.</p>

      <section className="start-panel" aria-labelledby="new-heading">
        <h2 id="new-heading">New campaign</h2>
        <form onSubmit={create} className="row">
          <label htmlFor="campaign-name" className="visually-hidden">Campaign name</label>
          <input
            id="campaign-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Campaign name, for example The Sunless Citadel"
            maxLength={200}
          />
          <button type="submit" className="primary" disabled={!name.trim()}>Create…</button>
        </form>
        <p className="hint">You choose where the campaign folder goes. It holds the campaign file and its images.</p>
      </section>

      <section className="start-panel" aria-labelledby="open-heading">
        <h2 id="open-heading">Open a campaign</h2>
        {recent.length > 0 ? (
          <ul className="recent">
            {recent.map((r) => (
              <li key={r.folder}>
                <button onClick={() => void attempt(() => call('campaign:openRecent', { folder: r.folder }))}>
                  <span className="recent-name">{r.name}</span>
                  <span className="recent-path">{r.folder}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No recent campaigns yet.</p>
        )}
        <button onClick={() => void attempt(() => call('campaign:openDialog', undefined))}>Open a campaign folder…</button>
      </section>

      <section className="start-panel" aria-labelledby="ai-heading">
        <h2 id="ai-heading">AI services</h2>
        <p className="hint">Optional. Choose which service writes scene text and which draws battle maps: Claude, ChatGPT, Gemini, free ones on this computer and more.</p>
        <button onClick={() => useBoard.getState().setAiSettingsOpen(true)}>Choose AI services…</button>
      </section>
    </main>
    </div>
  )
}
