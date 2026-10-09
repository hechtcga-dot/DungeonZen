import { useEffect, useState } from 'react'
import type { IpcOutputs } from '../../shared/ipc'
import { call } from '../api'
import { useBoard } from '../store'
import { ContextMenu } from './ContextMenu'
import { Dialog } from './Dialog'
import { ExportDialog } from './ExportDialog'

type About = { version: string; campaignFolder: string | null; dataFolder: string; installed: boolean }

/** Rail › Setup: campaign files, printing, AI services, About and Uninstall. */
export function SetupMenu({ icon }: { icon: React.ReactNode }) {
  const { openCampaign, closeCampaign, say, setAiSettingsOpen } = useBoard()
  const campaignName = useBoard((s) => s.info?.name ?? 'this campaign')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<'new' | 'export' | 'about' | 'uninstall' | 'delete' | 'backups' | null>(null)
  const [name, setName] = useState('')
  const [about, setAbout] = useState<About | null>(null)

  const attempt = async (fn: () => Promise<void>) => { try { await fn() } catch (err) { say((err as Error).message, true) } }
  const open = (load: () => Promise<Parameters<typeof openCampaign>[0] | null>) => attempt(async () => {
    const info = await load()
    if (info) { setDialog(null); await openCampaign(info) }
  })
  const showAbout = (next: 'about' | 'uninstall') => attempt(async () => { setAbout(await call('app:about', undefined)); setDialog(next) })

  return (
    <>
      <button className="rail-item" aria-haspopup="menu" title="Campaign files, printing, AI services, About and Uninstall"
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right + 4, y: r.top }) }}>
        {icon}<span>Setup</span>
      </button>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: 'New campaign…', onClick: () => { setName(''); setDialog('new') } },
          { label: 'Open campaign…', onClick: () => void open(() => call('campaign:openDialog', undefined)) },
          { label: 'Save', hint: 'Every change is saved the moment you make it', onClick: () => void attempt(async () => {
            const at = await call('campaign:save', undefined)
            say(`All changes saved (${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`)
          }) },
          { label: 'Open campaign folder', hint: 'Everything is in it: back up this one folder', onClick: () => void attempt(() => call('campaign:openFolder', { sub: '' })) },
          { label: 'Backups…', hint: 'Made at the end of every session and once a day', onClick: () => setDialog('backups') },
          { label: 'Save a copy…', hint: 'Copies the whole campaign folder, pictures and notes included', onClick: () => void attempt(async () => {
            const where = await call('campaign:saveCopy', undefined)
            if (where) say(`Copy saved to ${where}`)
          }) },
          'separator',
          { label: 'Print or save cards…', onClick: () => setDialog('export') },
          { label: 'AI services…', onClick: () => setAiSettingsOpen(true) },
          { label: 'Delete this campaign…', danger: true, hint: 'Moves its folder to the Recycle Bin', onClick: () => setDialog('delete') },
          'separator',
          { label: 'About Dungeon Zen', onClick: () => void showAbout('about') },
          { label: 'Uninstall Dungeon Zen…', danger: true, onClick: () => void showAbout('uninstall') }
        ]} />
      )}

      <Dialog title="New campaign" open={dialog === 'new'} onClose={() => setDialog(null)}>
        <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void open(() => call('campaign:create', { name: name.trim() })) }}>
          <div className="field"><label htmlFor="setup-new-name">Campaign name</label>
            <input id="setup-new-name" autoFocus value={name} maxLength={200} placeholder="The Sunless Citadel" onChange={(e) => setName(e.target.value)} /></div>
          <p className="hint">You choose where its folder goes next. This campaign closes; everything in it is already saved.</p>
          <div className="dz-actions">
            <button type="button" onClick={() => setDialog(null)}>Cancel</button>
            <button type="submit" className="primary" disabled={!name.trim()}>Create…</button>
          </div>
        </form>
      </Dialog>

      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}

      <Dialog title="About Dungeon Zen" open={dialog === 'about'} onClose={() => setDialog(null)}>
        <p><strong>Dungeon Zen {about?.version}</strong>: campaign boards, storylines and time for Dungeon Masters.</p>
        <p className="hint">Everything stays on this computer; only AI services you choose and the rules library go online.</p>
        <dl className="about-list">
          <dt>This campaign</dt><dd>{about?.campaignFolder ?? 'None open'}</dd>
          <dt>Settings and AI keys</dt><dd>{about?.dataFolder}</dd>
        </dl>
        <p className="hint">Rules content: System Reference Document 5.2 by Wizards of the Coast, CC-BY-4.0, via the Open5e project.</p>
        <div className="dz-actions"><button className="primary" onClick={() => setDialog(null)}>Close</button></div>
      </Dialog>

      {dialog === 'backups' && <BackupsDialog onClose={() => setDialog(null)} />}

      <Dialog title="Delete this campaign?" open={dialog === 'delete'} onClose={() => setDialog(null)}>
        <p>Are you sure you want to delete <strong>{campaignName}</strong>?</p>
        <p className="hint">The campaign closes and its whole folder (cards, maps, pictures, notes) goes to the Windows Recycle Bin.
          Restore it from there to get it back; Undo cannot.</p>
        <div className="dz-actions">
          <button autoFocus onClick={() => setDialog(null)}>Cancel</button>
          <button className="danger" onClick={() => void attempt(async () => {
            setDialog(null)
            const folder = await call('campaign:delete', undefined).finally(() => void closeCampaign())
            say(`Deleted: ${folder} is in the Recycle Bin`)
          })}>Yes, delete it</button>
        </div>
      </Dialog>

      <Dialog title="Uninstall Dungeon Zen" open={dialog === 'uninstall'} onClose={() => setDialog(null)}>
        {about?.installed ? (
          <>
            <p>Dungeon Zen closes and the Windows uninstaller starts.</p>
            <p className="hint">Your campaign folders, settings and AI keys are kept: install again any time and open them.</p>
          </>
        ) : (
          <p className="hint">This copy was not installed with the Dungeon Zen setup, so there is nothing to uninstall here. Windows Settings › Apps lists installed copies.</p>
        )}
        <div className="dz-actions">
          <button onClick={() => setDialog(null)}>Cancel</button>
          {about?.installed && <button className="danger" onClick={() => void attempt(() => call('app:uninstall', undefined))}>Uninstall</button>}
        </div>
      </Dialog>
    </>
  )
}

/** Setup › Backups: dated copies of the whole campaign folder (end of each session, once a day; the newest 20 kept). */
function BackupsDialog({ onClose }: { onClose(): void }) {
  const { act, say } = useBoard()
  const [v, setV] = useState<IpcOutputs['backups:view'] | null>(null)
  const load = () => void call('backups:view', undefined).then(setV).catch(() => setV(null))
  useEffect(load, [])
  const [busy, setBusy] = useState(false)
  return (
    <Dialog title="Backups" open onClose={onClose}>
      <p>A dated copy of the whole campaign folder is made at the end of every session and once a day you use it. The newest 20 are kept.</p>
      <p className="hint selectable">{v ? `${v.folder}${v.own ? '' : ' (in the campaign folder)'}` : '…'}</p>
      {v && (v.list.length === 0 ? <p className="hint">No backups yet.</p> : (
        <ul className="ink-list">{v.list.slice(0, 6).map((b) => <li key={b.name}>{b.name}</li>)}
          {v.list.length > 6 && <li className="hint">and {v.list.length - 6} older</li>}</ul>
      ))}
      <p className="hint">To restore one, open its folder with Open campaign.</p>
      <div className="row tight wrap">
        <button disabled={busy} onClick={async () => { setBusy(true); const f = await act('backups:now', undefined); setBusy(false); if (f) { say('Backup made'); load() } }}>{busy ? 'Backing up…' : 'Back up now'}</button>
        <button onClick={() => void act('backups:open', undefined)}>Open backups folder</button>
        <button onClick={async () => { if (await act('backups:chooseFolder', undefined)) load() }}>Choose another folder…</button>
        {v?.own && <button onClick={() => void act('backups:resetFolder', undefined).then(load)}>Use the campaign folder</button>}
      </div>
      <div className="dz-actions"><button className="primary" onClick={onClose}>Close</button></div>
    </Dialog>
  )
}
