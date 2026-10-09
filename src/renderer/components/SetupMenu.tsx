import { useState } from 'react'
import { call } from '../api'
import { useBoard } from '../store'
import { ContextMenu } from './ContextMenu'
import { Dialog } from './Dialog'
import { ExportDialog } from './ExportDialog'

type About = { version: string; campaignFolder: string | null; dataFolder: string; installed: boolean }

/** Rail › Setup: campaign files, printing, AI services, About and Uninstall. */
export function SetupMenu({ icon }: { icon: React.ReactNode }) {
  const { openCampaign, say, setAiSettingsOpen } = useBoard()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<'new' | 'export' | 'about' | 'uninstall' | null>(null)
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
          { label: 'Save a copy…', hint: 'Copies the whole campaign folder, pictures and notes included', onClick: () => void attempt(async () => {
            const where = await call('campaign:saveCopy', undefined)
            if (where) say(`Copy saved to ${where}`)
          }) },
          'separator',
          { label: 'Print or save cards…', onClick: () => setDialog('export') },
          { label: 'AI services…', onClick: () => setAiSettingsOpen(true) },
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
