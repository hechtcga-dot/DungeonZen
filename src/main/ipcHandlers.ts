import { join } from 'node:path'
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { Campaign } from './campaign/campaign'
import { ProfileStore } from './profile'
import { ipcInputs, IPC_PREFIX, type IpcChannel, type IpcOutputs, type IpcResult } from '../shared/ipc'
import type { CampaignInfo } from '../shared/types'
import type { z } from 'zod'

type Handler<C extends IpcChannel> = (input: z.output<(typeof ipcInputs)[C]>) => IpcOutputs[C] | Promise<IpcOutputs[C]>

export function registerIpc(getWindow: () => BrowserWindow | null, profile: ProfileStore): void {
  let campaign: Campaign | null = null

  const current = (): Campaign => {
    if (!campaign) throw new Error('No campaign is open')
    return campaign
  }

  const openFolder = (folder: string): CampaignInfo => {
    const next = Campaign.open(folder)
    campaign?.close()
    campaign = next
    const info = next.info()
    profile.remember(folder, info.name)
    return info
  }

  function handle<C extends IpcChannel>(channel: C, fn: Handler<C>): void {
    ipcMain.handle(IPC_PREFIX + channel, async (_event, raw): Promise<IpcResult<IpcOutputs[C]>> => {
      const parsed = ipcInputs[channel].safeParse(raw)
      if (!parsed.success) return { ok: false, error: `Invalid request for ${channel}: ${parsed.error.message}` }
      try {
        return { ok: true, value: await fn(parsed.data as never) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }

  handle('profile:recent', () => profile.recent())

  handle('campaign:create', async ({ name }) => {
    const win = getWindow()
    const options = {
      title: 'Choose where to keep the campaign folder',
      buttonLabel: 'Create campaign here',
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    const folder = join(result.filePaths[0], safeFolderName(name))
    Campaign.create(folder, name).close()
    return openFolder(folder)
  })

  handle('campaign:openDialog', async () => {
    const win = getWindow()
    const options = {
      title: 'Open a campaign folder',
      buttonLabel: 'Open campaign',
      properties: ['openDirectory'] as Array<'openDirectory'>
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return openFolder(result.filePaths[0])
  })

  handle('campaign:openRecent', ({ folder }) => openFolder(folder))
  handle('campaign:close', () => { campaign?.close(); campaign = null })
  handle('campaign:info', () => campaign?.info() ?? null)

  handle('board:view', ({ boardId }) => current().boardView(boardId))
  handle('entity:create', (i) => current().createEntity(i))
  handle('entity:update', ({ id, patch }) => current().updateEntity(id, patch))
  handle('entity:setStatus', ({ id, status }) => current().setEntityStatus(id, status))
  handle('entity:addToStoryline', ({ entityId, storylineId, position }) =>
    current().addToStoryline(entityId, storylineId, position))
  handle('entity:removeFromStoryline', ({ entityId, storylineId }) =>
    current().removeFromStoryline(entityId, storylineId))
  handle('relationship:create', (i) => current().createRelationship(i))
  handle('relationship:update', ({ id, patch }) => current().updateRelationship(id, patch))
  handle('relationship:setStatus', ({ id, status }) => current().setRelationshipStatus(id, status))
  handle('note:create', (i) => current().addNote(i))
  handle('note:update', ({ itemId, text }) => current().updateNote(itemId, text))
  handle('note:setStatus', ({ itemId, status }) => current().setNoteStatus(itemId, status))
  handle('items:move', ({ moves }) => current().moveItems(moves))
  handle('storyline:create', ({ title }) => current().createStoryline(title))
  handle('history:view', () => current().history())
  handle('history:undo', () => current().undo())
  handle('history:redo', () => current().redo())
  handle('history:undoTo', ({ commandId }) => current().undoTo(commandId))
}

/** A folder name that is safe on Windows. */
export function safeFolderName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i
  return !cleaned || reserved.test(cleaned) ? 'Campaign' : cleaned.slice(0, 80)
}
