import { contextBridge, ipcRenderer } from 'electron'
import type { DungeonZenApi } from '../shared/ipc'
import { IPC_PREFIX } from '../shared/ipcPrefix'

// The only bridge between the UI and Node. The renderer gets `window.dungeonzen`
// and nothing else (contextIsolation on, no Node APIs).
const api: DungeonZenApi = {
  invoke: (channel, input) => ipcRenderer.invoke(IPC_PREFIX + channel, input)
}

contextBridge.exposeInMainWorld('dungeonzen', api)
