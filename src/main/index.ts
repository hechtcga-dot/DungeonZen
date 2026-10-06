import { join } from 'node:path'
import { app, BrowserWindow, protocol, safeStorage, shell } from 'electron'
import { registerIpc } from './ipcHandlers'
import { ProfileStore } from './profile'
import { KeyStore } from './ai/keys'

let mainWindow: BrowserWindow | null = null

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
    backgroundColor: '#171a1f',
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
  mainWindow.on('closed', () => { mainWindow = null })

  // Links open in the system browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  registerIpc(() => mainWindow, new ProfileStore(app.getPath('userData')), new KeyStore(app.getPath('userData'), safeStorage))
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
