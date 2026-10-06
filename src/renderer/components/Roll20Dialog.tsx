import { useEffect, useState } from 'react'
import { Dialog } from './Dialog'
import { call } from '../api'
import { useBoard } from '../store'
import type { MapView, Roll20Export } from '../../shared/types'

/**
 * Export cards to Roll20: paste-in macro text (any account) or the API script with
 * an import handout (Roll20 Pro). A battle map can be saved with its page size.
 */
export function Roll20Dialog({ entityIds, title, mapId, onClose }: { entityIds: string[]; title: string; mapId?: string | null; onClose(): void }) {
  const say = useBoard((s) => s.say)
  const [data, setData] = useState<Roll20Export | null>(null)
  const [tab, setTab] = useState<'macros' | 'api'>('macros')
  const [error, setError] = useState<string | null>(null)
  const [map, setMap] = useState<MapView | null>(null)
  useEffect(() => {
    call('roll20:export', { entityIds }).then(setData).catch((e) => setError((e as Error).message))
    if (mapId) call('desk:view', undefined).then((d) => setMap(d.maps.find((m) => m.id === mapId) ?? null)).catch(() => setMap(null))
  }, [entityIds.join(','), mapId]) // eslint-disable-line react-hooks/exhaustive-deps
  const copy = (text: string, what: string) => { void navigator.clipboard.writeText(text); say(`Copied ${what}`) }
  const save = async (name: string, content: string, ext: 'json' | 'js' | 'txt') => {
    const file = await call('file:saveText', { name, content, ext }).catch((e) => { say((e as Error).message, true); return null })
    if (file) say(`Saved ${file}`)
  }
  const allMacros = data?.characters.map((c) => [`== ${c.name} ==`, ...c.abilities.map((a) => `-- ${a.name}${a.tokenAction ? ' (token action)' : ''}\n${a.macro}`)].join('\n\n')).join('\n\n\n') ?? ''

  return (
    <Dialog title={title} open onClose={onClose} wide>
      {error ? <p className="field-error">{error}</p> : !data ? <p className="hint">Preparing…</p> : (
        <div className="roll20">
          <div className="tabs-row" role="tablist">
            <button role="tab" aria-selected={tab === 'macros'} aria-pressed={tab === 'macros'} onClick={() => setTab('macros')}>Paste macros (any account)</button>
            <button role="tab" aria-selected={tab === 'api'} aria-pressed={tab === 'api'} onClick={() => setTab('api')}>API script (Roll20 Pro)</button>
          </div>
          {tab === 'macros' ? (
            <>
              <p className="hint">In Roll20, open the character, go to Attributes &amp; Abilities, add an ability per line below and paste its macro.
                Tick “Show as token action” for the ones marked so. Macros you wrote on a card's sheet are used as written.</p>
              <div className="row tight"><button className="primary" onClick={() => copy(allMacros, 'every macro')}>Copy all</button>
                <button onClick={() => void save(title.replace(/^Roll20:\s*/, ''), allMacros, 'txt')}>Save as text…</button></div>
              <div className="roll20-list">
                {data.characters.map((c) => (
                  <section key={c.entityId}>
                    <h3 className="side-h">{c.name}</h3>
                    {c.abilities.length === 0 ? <p className="hint">No abilities on this card.</p> : c.abilities.map((a) => (
                      <div key={a.name} className="macro-row">
                        <div className="macro-head"><strong>{a.name}</strong>{a.tokenAction && <span className="badge token-badge">TOKEN ACTION</span>}
                          <button className="link-button" onClick={() => copy(a.macro, a.name)}>Copy</button></div>
                        <code className="macro-text">{a.macro}</code>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            </>
          ) : (
            <ol className="roll20-steps">
              <li>
                <strong>Once per game:</strong> in the game's Settings › API Scripts (Mod scripts), add a new script and paste the Dungeon Zen script.
                <div className="row tight"><button onClick={() => copy(data.script, 'the script')}>Copy the script</button>
                  <button onClick={() => void save('dungeon-zen-import', data.script, 'js')}>Save as .js…</button></div>
              </li>
              <li>
                Make a handout named <code>{data.handout}</code> and paste this data into its <strong>GM Notes</strong> ({data.characters.length} character{data.characters.length === 1 ? '' : 's'}).
                <div className="row tight"><button className="primary" onClick={() => copy(data.data, 'the data')}>Copy the data</button>
                  <button onClick={() => void save(title.replace(/^Roll20:\s*/, ''), data.data, 'json')}>Save as .json…</button></div>
              </li>
              <li>In the chat, type <code>!dz-import</code>. Characters that already exist are skipped; <code>!dz-import --replace</code> refreshes them.
                It creates the characters with AC, HP, ability scores, CR and the rest of the stat block, and every ability as a token action macro.</li>
            </ol>
          )}
          {map && (
            <section className="roll20-map">
              <h3 className="side-h">Battle map: {map.name}</h3>
              <p className="hint">
                {map.gridCols && map.gridRows
                  ? <>Make a Roll20 page <strong>{map.gridCols} × {map.gridRows}</strong> units (70 px squares), put the image on the Map layer and stretch it to the page.</>
                  : 'This map has no grid set; set one under Scale and grid first.'}
              </p>
              <button onClick={async () => { const f = await call('map:saveImage', { mapId: map.id }).catch(() => null); if (f) say(`Saved ${f}`) }}>Save the map image…</button>
            </section>
          )}
          <div className="dz-actions"><button onClick={onClose}>Close</button></div>
        </div>
      )}
    </Dialog>
  )
}
