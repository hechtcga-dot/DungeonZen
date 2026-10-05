import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dialog, ipcMain, net, protocol, type BrowserWindow } from 'electron'
import { Campaign, MAP_EXTENSIONS } from './campaign/campaign'
import { ProfileStore } from './profile'
import { searchSrd, srdCopy, SRD_SOURCE } from './srd'
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

  // dz-asset://campaign/<path> serves files from the open campaign's assets folder only.
  protocol.handle('dz-asset', (request) => {
    const url = new URL(request.url)
    const file = url.hostname === 'campaign' && campaign ? campaign.assetFile(decodeURIComponent(url.pathname.slice(1))) : null
    if (!file) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })

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
  handle('entity:create', ({ position, ...rest }) =>
    current().createEntity({ ...rest, position: position ?? current().freeGlobalSpot() }))
  handle('entity:duplicate', ({ id }) => current().duplicateEntity(id))
  handle('sheet:view', ({ entityId }) => current().sheet(entityId))
  handle('ability:add', ({ entityId, ability }) => current().addAbility(entityId, ability))
  handle('ability:update', ({ id, patch }) => current().updateAbility(id, patch))
  handle('ability:setStatus', ({ id, status }) => current().setAbilityStatus(id, status))
  handle('knowledge:set', ({ entityId, field, known }) => current().setPartyKnows(entityId, field, known))
  handle('knowledge:setString', ({ relationshipId, known }) => current().setStringKnown(relationshipId, known))
  handle('library:search', (filters) => current().search(filters))
  handle('srd:search', (filters) => searchSrd(filters))
  handle('srd:addCopy', ({ key, boardId }) => {
    const copy = srdCopy(key)
    const c = current()
    return c.createEntity({
      ...copy, boardId, position: c.freeGlobalSpot(), label: `Added ${copy.name} from the ${SRD_SOURCE}`
    })
  })
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
  handle('desk:view', () => current().desk())
  handle('map:importDialog', async () => {
    const win = getWindow()
    const options = {
      title: 'Import a map image',
      buttonLabel: 'Import map',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Images', extensions: MAP_EXTENSIONS.map((e) => e.slice(1)) }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return current().importMap(result.filePaths[0])
  })
  handle('map:setActive', ({ mapId }) => current().setSetting('active_map_id', mapId, 'Changed the desk map'))
  handle('notes:set', ({ text }) => current().setSetting('dm_notes', text, 'Edited DM notes'))
  handle('clock:shift', ({ minutes }) => current().shiftClock(minutes))
  handle('clock:set', ({ minutes }) => current().setClock(minutes))
  handle('campaign:update', ({ name, rulesEdition, moonOffsetDays }) => {
    const c = current()
    c.setSettings({ name, rules_edition: rulesEdition, moon_offset_days: moonOffsetDays }, 'Changed campaign settings')
    if (name) profile.remember(c.folder, name)
  })
  handle('storyline:update', ({ storylineId, patch }) => current().updateStoryline(storylineId, patch))
  handle('storyline:setRemoved', ({ storylineId, removed }) => current().setStorylineRemoved(storylineId, removed))
  handle('map:rename', ({ mapId, name }) => current().renameMap(mapId, name))
  handle('map:setStatus', ({ mapId, status }) => current().setMapStatus(mapId, status))
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
