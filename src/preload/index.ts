import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { DungeonZenApi } from '../shared/ipc'
import { IPC_PREFIX } from '../shared/ipcPrefix'

// The only bridge between the UI and Node. The renderer gets `window.dungeonzen`
// and nothing else (contextIsolation on, no Node APIs).
const api: DungeonZenApi = {
  invoke: (channel, input) => ipcRenderer.invoke(IPC_PREFIX + channel, input),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onImportProgress: (fn) => {
    const listener = (_e: unknown, p: Parameters<typeof fn>[0]) => fn(p)
    ipcRenderer.on(IPC_PREFIX + 'import-progress', listener)
    return () => { ipcRenderer.removeListener(IPC_PREFIX + 'import-progress', listener) }
  }
}

contextBridge.exposeInMainWorld('dungeonzen', api)
