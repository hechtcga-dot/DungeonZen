import { useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import { call } from '../api'
import { useBoard } from '../store'
import { AI_PROVIDERS, providerById, type AiKind } from '../../shared/aiProviders'
import type { AiSettingsView } from '../../shared/types'

/** Settings › AI services: pick a writing service and a battle-map service from a list, with key, model and a test. */
export function AiSettingsDialog() {
  const open = useBoard((s) => s.aiSettingsOpen)
  const setOpen = useBoard((s) => s.setAiSettingsOpen)
  const say = useBoard((s) => s.say)
  const [view, setView] = useState<AiSettingsView | null>(null)

  const reload = async () => {
    try { setView(await call('ai:settings', undefined)) } catch (e) { say((e as Error).message, true) }
  }
  useEffect(() => { if (open) void reload() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog title="AI services" open={open} onClose={() => setOpen(false)} wide>
      {!view ? <p className="hint">Loading…</p> : (
        <div className="ai-settings">
          <p className="hint">
            Choose which service writes text and which draws battle maps. You can switch at any time; each service
            remembers its own key and model. Keys are encrypted by Windows and kept on this computer only, never in a
            campaign folder. Anything an AI writes is shown as a suggestion until you use it.
          </p>
          {!view.encryption && <p className="field-error">This computer cannot encrypt keys, so online services cannot be used. Services on this computer still work.</p>}
          <ServiceSection kind="text" title="Writing" what="scene text now; notes import and recaps later" view={view} reload={reload} />
          <ServiceSection kind="image" title="Battle maps" what="top-down maps on a square grid, styled after your example maps" view={view} reload={reload} />
          <div className="dz-actions"><button className="primary" onClick={() => setOpen(false)}>Done</button></div>
        </div>
      )}
    </Dialog>
  )
}

function ServiceSection({ kind, title, what, view, reload }: {
  kind: AiKind; title: string; what: string; view: AiSettingsView; reload(): Promise<void>
}) {
  const say = useBoard((s) => s.say)
  const choice = view[kind]
  const info = choice.provider ? providerById(choice.provider) : undefined
  const setting = view.providers.find((p) => p.id === choice.provider)
  const [model, setModel] = useState(choice.model)
  const [baseUrl, setBaseUrl] = useState(choice.baseUrl)
  const [key, setKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [fetched, setFetched] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<'test' | 'models' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  // A different service was picked: show its own model and address.
  useEffect(() => {
    setModel(choice.model); setBaseUrl(choice.baseUrl); setKey(''); setReplacing(false); setFetched(null); setResult(null)
  }, [choice.provider]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await reload() } catch (e) { say((e as Error).message, true) }
  }
  const choose = (provider: string | null) => run(() => call('ai:choose', { kind, provider }))
  const saveModel = (m: string) => { if (info && m.trim() !== choice.model) void run(() => call('ai:choose', { kind, provider: info.id, model: m.trim() })) }
  const saveUrl = (u: string) => { if (info && u.trim() !== choice.baseUrl) void run(() => call('ai:choose', { kind, provider: info.id, baseUrl: u.trim() })) }
  const saveKey = async () => {
    if (!info || !key.trim()) return
    await run(() => call('ai:setKey', { provider: info.id, key: key.trim() }))
    setKey(''); setReplacing(false)
  }
  const test = async () => {
    if (!info) return
    setBusy('test'); setResult(null)
    try { setResult({ ok: true, text: await call('ai:test', { provider: info.id, model, baseUrl }) }) }
    catch (e) { setResult({ ok: false, text: (e as Error).message }) }
    setBusy(null)
  }
  const fetchModels = async () => {
    if (!info) return
    setBusy('models'); setResult(null)
    try {
      const list = await call('ai:models', { provider: info.id, baseUrl })
      setFetched(list)
      setResult({ ok: true, text: list.length ? `${list.length} model${list.length === 1 ? '' : 's'} found: pick one from the Model list.` : 'The service listed no models.' })
    } catch (e) { setResult({ ok: false, text: (e as Error).message }) }
    setBusy(null)
  }

  const online = AI_PROVIDERS.filter((p) => p.kind === kind && !p.local)
  const local = AI_PROVIDERS.filter((p) => p.kind === kind && p.local)
  const models = Array.from(new Set([...(fetched ?? []), ...(info?.models ?? [])]))
  const id = `ai-${kind}`
  const needsKeyInput = info?.needsKey && (!setting?.hasKey || replacing)

  return (
    <section className="ai-section" aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="ai-section-h">{title} <span className="hint">({what})</span></h3>
      <div className="field">
        <label htmlFor={`${id}-service`}>Service</label>
        <select id={`${id}-service`} value={choice.provider ?? ''} onChange={(e) => void choose(e.target.value || null)}>
          <option value="">None: AI off</option>
          <optgroup label="Online">
            {online.map((p) => <option key={p.id} value={p.id}>{p.name}{view.providers.find((s) => s.id === p.id)?.hasKey ? ' ✓' : ''}</option>)}
          </optgroup>
          <optgroup label="On this computer (free, offline)">
            {local.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        </select>
        {info ? (
          <span className="hint">{info.blurb}{info.references ? ' Takes your example maps as a style guide.' : kind === 'image' ? ' Uses the description only (no example maps).' : ''}{' '}
            {info.keyUrl && <a href={info.keyUrl} target="_blank" rel="noreferrer">{info.needsKey ? 'Get a key' : 'Download'}</a>}
          </span>
        ) : <span className="hint">The app works fully without AI; these features are just hidden.</span>}
      </div>

      {info && (
        <div className="ai-grid">
          {info.needsKey && (
            <div className="field">
              <label htmlFor={`${id}-key`}>API key</label>
              {needsKeyInput ? (
                <div className="row tight">
                  <input id={`${id}-key`} type="password" autoComplete="off" spellCheck={false} value={key}
                    placeholder="Paste the key here" onChange={(e) => setKey(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void saveKey() }} />
                  <button className="primary" disabled={key.trim().length < 8 || !view.encryption} onClick={() => void saveKey()}>Save key</button>
                  {replacing && <button onClick={() => { setReplacing(false); setKey('') }}>Cancel</button>}
                </div>
              ) : (
                <div className="row tight">
                  <span className="ai-key-saved">Key saved (encrypted)</span>
                  <button onClick={() => setReplacing(true)}>Replace</button>
                  <button onClick={() => void run(() => call('ai:removeKey', { provider: info.id }))}>Remove</button>
                </div>
              )}
            </div>
          )}
          {info.editableUrl && (
            <div className="field">
              <label htmlFor={`${id}-url`}>Address</label>
              <input id={`${id}-url`} value={baseUrl} spellCheck={false} onChange={(e) => setBaseUrl(e.target.value)} onBlur={(e) => saveUrl(e.target.value)} />
            </div>
          )}
          <div className="field">
            <label htmlFor={`${id}-model`}>Model</label>
            <div className="row tight">
              <input id={`${id}-model`} list={`${id}-models`} value={model} spellCheck={false}
                placeholder={info.protocol === 'sd-webui' ? 'The model loaded in the web UI' : 'Model name'}
                onChange={(e) => setModel(e.target.value)} onBlur={(e) => saveModel(e.target.value)} />
              <datalist id={`${id}-models`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
              <button disabled={busy !== null || (info.needsKey && !setting?.hasKey)} onClick={() => void fetchModels()}>
                {busy === 'models' ? 'Asking…' : 'Fetch list'}
              </button>
            </div>
            <span className="hint">Type any model the service offers, or fetch its current list.</span>
          </div>
          <div className="row tight wrap">
            <button disabled={busy !== null || (info.needsKey && !setting?.hasKey)} onClick={() => void test()}>
              {busy === 'test' ? 'Testing…' : 'Test'}
            </button>
            {result && <span className={result.ok ? 'ai-ok' : 'field-error'} role="status">{result.text}</span>}
          </div>
        </div>
      )}
    </section>
  )
}
