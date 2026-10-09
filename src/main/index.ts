import { join } from 'node:path'
import { app, BrowserWindow, protocol, safeStorage, shell } from 'electron'
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
  mainWindow.on('closed', () => { mainWindow = null; journalWindow?.close() })

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

app.whenReady().then(() => {
  registerIpc(() => mainWindow, new ProfileStore(app.getPath('userData')), new KeyStore(app.getPath('userData'), safeStorage), openJournal)
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
