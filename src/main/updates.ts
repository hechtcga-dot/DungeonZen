import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { logError } from './log'
import { IPC_PREFIX } from '../shared/ipcPrefix'

// Auto-update (3.0, owner): new versions come from the GitHub Releases page (electron-builder.yml › publish:
// latest.yml next to the installer). Downloaded in the background; installed on Restart now or when the app closes.
// The installer is not code-signed (owner), so Windows may ask once per update, as with a download by hand.

export function startUpdates(): void {
  // DZ_USER_DATA = a test run of the installed app (Windows installer workflow): never download or install an update.
  if (!app.isPackaged || process.env.DZ_USER_DATA) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-downloaded', (info) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC_PREFIX + 'update-ready', info.version)
  })
  autoUpdater.on('error', (err) => logError('update', err))
  void autoUpdater.checkForUpdates().catch((err) => logError('update', err))
}

/** Setup › About › Check for updates: the newer version (it downloads on its own), or null when this is the newest. */
export async function checkUpdates(): Promise<string | null> {
  if (!app.isPackaged) throw new Error('Updates work in the installed Dungeon Zen only.')
  const r = await autoUpdater.checkForUpdates()
  return r?.isUpdateAvailable ? r.updateInfo.version : null
}

export function restartToUpdate(): void {
  autoUpdater.quitAndInstall()
}
