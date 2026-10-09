import { useCallback, useEffect, useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import type { IpcOutputs } from '../../shared/ipc'

/**
 * An encounter's pictures and maps: a folder on the computer (in the campaign, or one the DM chose).
 * Files put there in Windows show up here; Open folder shows it in Explorer.
 */
export function EncounterPictures({ id, compact }: { id: string; compact?: boolean }) {
  const { act, say, view } = useBoard()
  const [data, setData] = useState<IpcOutputs['encounter:pictures'] | null>(null)
  const load = useCallback(() => { void call('encounter:pictures', { id }).then(setData).catch(() => setData(null)) }, [id])
  useEffect(load, [load, view?.undo])
  // Back from Explorer: look for new files.
  useEffect(() => { window.addEventListener('focus', load); return () => window.removeEventListener('focus', load) }, [load])
  if (!data) return null
  const open = (file?: string) => void act('encounter:openFolder', { id, file })
  return (
    <div className="enc-pictures">
      <div className="row tight wrap">
        <h3 className="side-h">Pictures and maps{data.files.length ? ` (${data.files.length})` : ''}</h3>
        <span className="spacer" />
        <button className="ink-button" onClick={() => open()}>Open folder</button>
        {!compact && <>
          <button className="ink-button" onClick={async () => { const n = await act('encounter:addPictures', { id }); if (n) { load(); say(`Added ${n} file${n === 1 ? '' : 's'} to the folder.`) } }}>Add pictures…</button>
          <button className="ink-button" title="Keep this encounter's pictures in a folder of your own" onClick={async () => { if (await act('encounter:chooseFolder', { id })) load() }}>Use another folder…</button>
          {data.own && <button className="ink-button" onClick={() => void act('encounter:resetFolder', { id }).then(load)}>Use a folder in the campaign</button>}
        </>}
      </div>
      {!compact && <p className="ink-muted selectable enc-folder" title={data.folder}>{data.folder}{data.own ? '' : ' (in the campaign folder)'}. Put files there in Windows and they show up here.</p>}
      {data.files.length === 0 ? <p className="ink-muted">No pictures yet.</p> : (
        <ul className="enc-thumbs">
          {data.files.map((f) => (
            <li key={f.name}>
              <button className="enc-thumb" title={`Open ${f.name}`} onClick={() => open(f.name)}>
                {f.picture ? <img src={f.url} alt={f.name} loading="lazy" /> : <span className="enc-pdf">PDF</span>}
                <span className="enc-thumb-name">{f.name}</span>
              </button>
              {!compact && <button className="link-button danger-ink" aria-label={`Remove ${f.name}`} onClick={() => void act('encounter:removePicture', { id, name: f.name }).then(load)}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {!compact && data.removed > 0 && <p className="ink-muted">{data.removed} removed file{data.removed === 1 ? ' is' : 's are'} in the Removed folder inside it; move one back to bring it back.</p>}
    </div>
  )
}
