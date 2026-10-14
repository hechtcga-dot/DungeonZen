import { join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { app, BrowserWindow, Menu, protocol, safeStorage, shell } from 'electron'
import { Campaign } from './campaign/campaign'
import { registerIpc } from './ipcHandlers'
import { ProfileStore } from './profile'
import { KeyStore } from './ai/keys'

let mainWindow: BrowserWindow | null = null

// One copy at a time: a second launch brings the open window forward instead of
// opening the same campaign database twice.
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})
// Taskbar grouping and pinning on Windows use the installer's app id.
if (process.platform === 'win32') app.setAppUserModelId('com.dungeonzen.app')

// Campaign images (maps, handouts) are served to the window through this scheme.
protocol.registerSchemesAsPrivileged([
  { scheme: 'dz-asset', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#2e1c0e',
    title: 'Dungeon Zen',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null; journalWindow?.close(); for (const w of prepWindows.values()) w.close() })

  // Links open in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

let journalWindow: BrowserWindow | null = null

/** DM notes in a window of their own (drag it to another screen); one at a time. */
function openJournal(): void {
  if (journalWindow) { journalWindow.focus(); return }
  journalWindow = new BrowserWindow({
    width: 520, height: 680, minWidth: 320, minHeight: 300, backgroundColor: '#2e1c0e', title: 'Dungeon Zen · DM notes',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  journalWindow.on('closed', () => { journalWindow = null })
  journalWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  if (process.env.ELECTRON_RENDERER_URL) void journalWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#journal`)
  else void journalWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'journal' })
}

const prepWindows = new Map<string, BrowserWindow>()
const boundsFile = () => join(app.getPath('userData'), 'prep-windows.json')
const readBounds = (): Record<string, Electron.Rectangle> => { try { return JSON.parse(readFileSync(boundsFile(), 'utf8')) } catch { return {} } }

/**
 * A session prep section (or one NPC) in a window of its own (owner, 2026-10-14): drag it to another screen; it stays
 * until closed, whatever the main window shows. One per section; size and place remembered per kind on this computer.
 */
function openPrepWindow(number: number, part: string): void {
  const key = `${number}/${part}`
  const open = prepWindows.get(key)
  if (open) { open.focus(); return }
  const kind = part.split(':')[0]
  const w = new BrowserWindow({
    ...(readBounds()[kind] ?? { width: 560, height: 680 }), minWidth: 320, minHeight: 240, backgroundColor: '#2e1c0e', title: 'Dungeon Zen · Session prep',
    autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  prepWindows.set(key, w)
  w.on('close', () => { try { writeFileSync(boundsFile(), JSON.stringify({ ...readBounds(), [kind]: w.getBounds() })) } catch { /* not saved */ } })
  w.on('closed', () => prepWindows.delete(key))
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const hash = `prep/${number}/${encodeURIComponent(part)}`
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else void w.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

app.whenReady().then(() => {
  registerIpc(() => mainWindow, new ProfileStore(app.getPath('userData')), new KeyStore(app.getPath('userData'), safeStorage), openJournal, openPrepWindow)
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

// Right-click in a text box: spelling suggestions, Add to dictionary, Cut / Copy / Paste (owner, 2026-10-14).
// Boxes with their own menu (linked words) cancel the event in the page, so this never shows over them.
app.on('web-contents-created', (_e, wc) => {
  wc.on('context-menu', (_ev, p) => {
    if (!p.isEditable && !p.selectionText) return
    const items: Electron.MenuItemConstructorOptions[] = p.dictionarySuggestions.map((w) => ({ label: w, click: () => wc.replaceMisspelling(w) }))
    if (p.misspelledWord) {
      if (!items.length) items.push({ label: 'No suggestions', enabled: false })
      items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: 'separator' })
    }
    if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' })
    else items.push({ role: 'copy' })
    Menu.buildFromTemplate(items).popup()
  })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
// A backup still copying its pictures finishes first.
app.on('before-quit', (e) => {
  if (Campaign.copying.size === 0) return
  e.preventDefault()
  void Promise.allSettled([...Campaign.copying]).then(() => app.quit())
})
