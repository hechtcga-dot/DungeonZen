import { contextBridge, ipcRenderer } from 'electron'
import type { ChronosApi } from '../shared/ipc'
import { IPC_PREFIX } from '../shared/ipcPrefix'

// The only bridge between the UI and Node. The renderer gets `window.chronos`
// and nothing else (contextIsolation on, no Node APIs).
const api: ChronosApi = {
  invoke: (channel, input) => ipcRenderer.invoke(IPC_PREFIX + channel, input)
}

contextBridge.exposeInMainWorld('chronos', api)
