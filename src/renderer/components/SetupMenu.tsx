import { useEffect, useState } from 'react'
import type { IpcOutputs } from '../../shared/ipc'
import { call } from '../api'
import { useBoard } from '../store'
import { useOrderScope } from '../fold'
import { ContextMenu } from './ContextMenu'
import { Dialog } from './Dialog'
import { ExportDialog } from './ExportDialog'
import { DEFAULT_LINK_RULES } from '../../shared/noteLinks'

type About = { version: string; campaignFolder: string | null; dataFolder: string; installed: boolean }

/** Rail › Setup: campaign files, printing, AI services, About and Uninstall. */
export function SetupMenu({ icon }: { icon: React.ReactNode }) {
  const { openCampaign, closeCampaign, say, setAiSettingsOpen } = useBoard()
  const { scope, set: setScope } = useOrderScope()
  const campaignName = useBoard((s) => s.info?.name ?? 'this campaign')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [dialog, setDialog] = useState<'new' | 'export' | 'about' | 'uninstall' | 'delete' | 'backups' | 'vtt' | 'tidy' | 'linking' | null>(null)
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
          { label: 'Tidy campaign folder…', hint: 'Pictures and maps nothing uses any more', onClick: () => setDialog('tidy') },
          { label: 'Save a copy…', hint: 'Copies the whole campaign folder, pictures and notes included', onClick: () => void attempt(async () => {
            const where = await call('campaign:saveCopy', undefined)
            if (where) say(`Copy saved to ${where}`)
          }) },
          'separator',
          { label: 'Print or save cards…', onClick: () => setDialog('export') },
          { label: 'Export to Foundry VTT or Owlbear Rodeo…', hint: 'Battle maps with their grid, character and monster sheets, handouts', onClick: () => setDialog('vtt') },
          { label: 'AI services…', onClick: () => setAiSettingsOpen(true) },
          { label: 'Linking names…', hint: 'Which card names link by themselves in notes and text boxes', onClick: () => setDialog('linking') },
          { label: 'Box order on card sheets', hint: 'What ↑ / ↓ on a card sheet changes (this computer)', items: [
            { label: 'Ask each time', checked: scope === null, onClick: () => setScope(null) },
            { label: 'This card only', checked: scope === 'card', onClick: () => setScope('card') },
            { label: 'Every card of its type', checked: scope === 'type', onClick: () => setScope('type') }
          ] },
          { label: 'Delete this campaign…', danger: true, hint: 'Moves its folder to the Recycle Bin', onClick: () => setDialog('delete') },
          'separator',
          { label: 'About Dungeon Zen', onClick: () => void showAbout('about') },
          { label: 'Open log folder', hint: 'Errors are written there: send the file with a bug report', onClick: () => void attempt(() => call('app:openLog', undefined)) },
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
        <p><strong>Dungeon Zen {about?.version}</strong></p>
        <p className="about-welcome">Welcome, Dungeon Master. Dungeon Zen was crafted with love to make your job easier: before the session starts, and on the fly when the players go somewhere you never planned.</p>
        <dl className="about-list">
          <dt>This campaign</dt><dd>{about?.campaignFolder ?? 'None open'}</dd>
          <dt>Settings and AI keys</dt><dd>{about?.dataFolder}</dd>
        </dl>
        <details className="about-fold">
          <summary>Terms of use</summary>
          <p>By using Dungeon Zen you agree to these terms.</p>
          <ul>
            <li>Dungeon Zen is provided "as is", without warranty of any kind. Use it at your own risk; keep backups of campaigns you care about (Setup › Backups).</li>
            <li>Your campaigns, notes, maps and pictures are yours. Dungeon Zen claims no rights over anything you make with it.</li>
            <li>You are responsible for what you import and for following the terms of any AI service you connect, including what you may do with the text and pictures it makes.</li>
            <li>To the extent the law allows, the makers of Dungeon Zen are not liable for any loss of data, profit or play time arising from its use.</li>
            <li>These terms may change with a new version; the version you use shows its own terms here.</li>
          </ul>
        </details>
        <details className="about-fold">
          <summary>Licensing</summary>
          <p>Dungeon Zen © 2026. All rights reserved. You may install and use it on your own computers for your own games; you may not sell or redistribute it.</p>
          <p>This work includes material from the System Reference Document 5.2 ("SRD 5.2") by Wizards of the Coast LLC, available at https://www.dndbeyond.com/srd. The SRD 5.2 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode. Rules content is copied in through the Open5e project.</p>
          <p>Dungeon Zen is not affiliated with, endorsed by or sponsored by Wizards of the Coast. Dungeons &amp; Dragons is a trademark of Wizards of the Coast LLC.</p>
          <p>Dungeon Zen is built with open-source software, including Electron, React, SQLite, Drizzle, Zustand, React Flow and Zod, each under its own licence (mostly MIT); their licence texts ship with the program.</p>
        </details>
        <details className="about-fold">
          <summary>Privacy</summary>
          <ul>
            <li>No account, no tracking, no analytics. Dungeon Zen does not collect or send any information about you or how you use it.</li>
            <li>Everything you make stays in your campaign folder on this computer.</li>
            <li>Only two things go online, and only when you ask: AI services you choose (the text, notes or pictures you send them, under that service's own privacy policy) and the Open5e rules library (searches for rules content).</li>
            <li>AI keys are kept encrypted by Windows on this computer, never in a campaign folder, and are sent only to the service they belong to.</li>
          </ul>
        </details>
        <div className="dz-actions"><button className="primary" onClick={() => setDialog(null)}>Close</button></div>
      </Dialog>

      {dialog === 'backups' && <BackupsDialog onClose={() => setDialog(null)} />}
      {dialog === 'vtt' && <VttDialog onClose={() => setDialog(null)} />}
      {dialog === 'tidy' && <TidyDialog onClose={() => setDialog(null)} />}
      {dialog === 'linking' && <LinkingDialog onClose={() => setDialog(null)} />}

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

/** Setup › Linking names (3.0, owner): the never-link words, the shortest name and the capital-letter rule, per campaign. */
function LinkingDialog({ onClose }: { onClose(): void }) {
  const act = useBoard((s) => s.act)
  const rules = useBoard((s) => s.wordLinks?.rules) ?? DEFAULT_LINK_RULES
  const [word, setWord] = useState('')
  const set = (patch: Partial<typeof rules>) => void act('links:rules', { ...rules, ...patch })
  const addWord = () => { const w = word.trim().toLowerCase(); if (w && !rules.never.includes(w)) set({ never: [...rules.never, w] }); setWord('') }
  return (
    <Dialog title="Linking names" open onClose={onClose}>
      <p>Card names link by themselves in notes and text boxes. These rules say which ones; each card also has its own
        "Link this name by itself" tick. Linking words yourself (select them › Link to a card) always works.</p>
      <div className="field">
        <span className="field-label">Words that never link by themselves</span>
        <div className="row tight wrap">
          {rules.never.map((w) => (
            <span key={w} className="chip">{w}<button aria-label={`Let “${w}” link`} title="Remove from the list" onClick={() => set({ never: rules.never.filter((x) => x !== w) })}>×</button></span>
          ))}
        </div>
        <form className="row tight" onSubmit={(e) => { e.preventDefault(); addWord() }}>
          <input aria-label="Add a word" placeholder="Add a word…" value={word} maxLength={100} onChange={(e) => setWord(e.target.value)} />
          <button disabled={!word.trim()}>Add</button>
        </form>
      </div>
      <div className="field row tight">
        <label htmlFor="link-min">Shortest name that links</label>
        <input id="link-min" type="number" min={1} max={30} value={rules.minLength} style={{ width: 64 }}
          onChange={(e) => { const n = Math.round(Number(e.target.value)); if (n >= 1 && n <= 30) set({ minLength: n }) }} /> letters
      </div>
      <div className="field checkbox">
        <input id="link-capital" type="checkbox" checked={rules.capitalOnly} onChange={(e) => set({ capitalOnly: e.target.checked })} />
        <label htmlFor="link-capital">One-word names link only with their capital letter</label>
      </div>
      <div className="dz-actions">
        <button onClick={() => set({ ...DEFAULT_LINK_RULES })}>Back to the standard rules</button>
        <button className="primary" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  )
}

/** Setup › Tidy campaign folder: files in assets/ nothing uses (not even History or Undo); ticked ones go to the Recycle Bin. */
function TidyDialog({ onClose }: { onClose(): void }) {
  const { say } = useBoard()
  const [files, setFiles] = useState<IpcOutputs['assets:unused'] | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const load = () => void call('assets:unused', undefined).then(setFiles, (err: Error) => say(err.message, true))
  useEffect(load, [])
  const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`
  const toggle = (p: string) => { const next = new Set(ticked); if (next.has(p)) next.delete(p); else next.add(p); setTicked(next) }
  const size = (files ?? []).filter((f) => ticked.has(f.path)).reduce((n, f) => n + f.size, 0)
  return (
    <Dialog title="Tidy campaign folder" open onClose={onClose}>
      <p>Pictures and maps in the campaign folder that nothing uses: no card, map, picture, note, History entry or undo step names them.</p>
      {!files ? <p className="hint">Looking…</p> : files.length === 0 ? <p className="hint">Nothing to tidy: every file is in use.</p> : (
        <>
          <div className="row tight"><button onClick={() => setTicked(new Set(files.map((f) => f.path)))}>Tick all</button>
            <button onClick={() => setTicked(new Set())}>Untick all</button></div>
          <ul className="ink-list tidy-list">{files.map((f) => (
            <li key={f.path}><label><input type="checkbox" checked={ticked.has(f.path)} onChange={() => toggle(f.path)} /> {f.path} <span className="hint">{mb(f.size)}</span></label></li>
          ))}</ul>
          <p className="hint">The ticked files go to the Windows Recycle Bin (restore them from there; Undo cannot).</p>
        </>
      )}
      <div className="dz-actions">
        <button onClick={() => void call('campaign:openFolder', { sub: 'assets' }).catch((err: Error) => say(err.message, true))}>Open folder</button>
        <button onClick={onClose}>Close</button>
        <button className="danger" disabled={ticked.size === 0} onClick={() => void call('assets:trash', { paths: [...ticked] }).then((n) => {
          say(`${n} file${n === 1 ? '' : 's'} (${mb(size)}) moved to the Recycle Bin`); setTicked(new Set()); load()
        }, (err: Error) => say(err.message, true))}>Move {ticked.size || ''} to the Recycle Bin</button>
      </div>
    </Dialog>
  )
}

/** Setup › Export to Foundry VTT or Owlbear Rodeo: a folder in exports, opened when done (README inside). */
function VttDialog({ onClose }: { onClose(): void }) {
  const { act, say } = useBoard()
  const [target, setTarget] = useState<'foundry' | 'owlbear'>('foundry')
  const [pick, setPick] = useState({ maps: true, sheets: true, handouts: true })
  const [busy, setBusy] = useState(false)
  const tick = (k: keyof typeof pick, label: string) => (
    <label className="field checkbox"><input type="checkbox" checked={pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} /> {label}</label>
  )
  return (
    <Dialog title="Export to a virtual tabletop" open onClose={onClose}>
      <div className="dz-form">
        <div className="segmented" role="radiogroup" aria-label="Tabletop">
          <button role="radio" aria-checked={target === 'foundry'} aria-pressed={target === 'foundry'} onClick={() => setTarget('foundry')}>Foundry VTT</button>
          <button role="radio" aria-checked={target === 'owlbear'} aria-pressed={target === 'owlbear'} onClick={() => setTarget('owlbear')}>Owlbear Rodeo</button>
        </div>
        <p className="hint">{target === 'foundry'
          ? 'Files for Foundry\'s Import Data: scenes with the battle grid, actors for the dnd5e system (scores, AC, HP, features, attacks and spells), journal entries for handouts, and the pictures.'
          : 'Owlbear Rodeo has no import file: you get the maps named with their grid, token pictures, all sheets in one PDF and handouts as pictures, ready to upload.'}</p>
        {tick('maps', 'Maps and battle maps')}
        {tick('sheets', 'Characters, NPCs and monsters')}
        {tick('handouts', 'Handouts and letters')}
        <p className="hint">Saved in the campaign's exports folder; it opens when done. A README inside says how to bring it in.</p>
        <div className="dz-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !(pick.maps || pick.sheets || pick.handouts)} onClick={async () => {
            setBusy(true)
            const r = await act('export:vtt', { target, ...pick })
            setBusy(false)
            if (r) { say(`Exported ${r.count} thing${r.count === 1 ? '' : 's'} to ${r.folder}`); onClose() }
          }}>{busy ? 'Exporting…' : 'Export'}</button>
        </div>
      </div>
    </Dialog>
  )
}
