import { STYLE_TAGS_SYSTEM, parseStyleTags } from '../shared/styleTags'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, safeStorage, shell } from 'electron'
import { ASSETS_DIR, Campaign, MAP_EXTENSIONS, storedExt } from './campaign/campaign'
import { ProfileStore } from './profile'
import type { KeyStore } from './ai/keys'
import { checkConnection, generateImage, generateText, listModels, resolve } from './ai/client'
import { SCENE_SYSTEM, scenePrompt } from './ai/scene'
import { ASK_SYSTEM, askPrompt } from './ai/ask'
import { RECAP_SYSTEM, recapPrompt } from './ai/recap'
import { BUILD_SYSTEM, buildPrompt, COMBAT_SYSTEM, combatPrompt, parseBuild, RATE_SYSTEM, ratePrompt } from './ai/encounter'
import { FILL_SYSTEM, fillPrompt, parseFill } from './ai/fill'
import { BUILDING_SYSTEM, buildingPrompt, parseBuilding } from './ai/building'
import { readBuilding } from '../shared/building'
import { STATBLOCK_SYSTEM, parseStatBlock, statBlockPrompt } from './ai/statblock'
import srdAttacksData from '../../resources/srd/srd-2024-attacks.json'
import type { SrdAttacks } from '../shared/attacks'
import { CHARSHEET_SYSTEM, charSheetPrompt, parseCharSheet } from './ai/charsheet'
import { parseRegions, REGIONS_SYSTEM, regionsPrompt } from './ai/regions'
import { generateWorld } from './worldgen'
import type { PlaceShape } from '../shared/places'
import { fillableFields } from '../shared/cardFields'
import { combatHints } from '../shared/combat'
import { readStatBlock } from '../shared/statblock'
import { DUNGEON_ZEN_SCRIPT, IMPORT_HANDOUT, roll20Character, roll20Data } from './exporters/roll20'
import { boardDocument, letterDocument, sheetPage, sheetsDocument } from './exporters/pages'
import { FOUNDRY_README, foundryActor, foundryJournal, foundryScene, handoutHtml, OWLBEAR_README, owlbearMapName } from './exporters/vtt'
import { renderJpg, renderPdf } from './exporters/render'
import { chunkBlocks, NOTE_EXTENSIONS, noteBlocks, readNotesFile, type NotesFile } from './importers/read'
import { writeDocx } from './importers/docx'
import { blockLines, changedLines, headingsOf, textToBlocks, type Block } from '../shared/noteDoc'
import { prepBlocks } from '../shared/prepDoc'
import { buildDraft, NOTES_SYSTEM, notesPrompt, parseChunkReply, type ChunkAnswer } from './importers/notes'
import type { ImportDraft } from '../shared/notesImport'
import { AI_PROVIDERS, maxReferences, providerById, type AiChoice } from '../shared/aiProviders'
import { aspectFor, timeOfDayFor } from '../shared/battlemap'
import { blendMarks, changePrompt } from '../shared/outline'
import { imageSize } from './imageSize'
import { allSrdMonsters, searchSrd, srdCopy, srdMonsterIndex, SRD_SOURCE } from './srd'
import { fillTavern, rollCharacter, rollNames, seededRng, suggestEncounter } from './generators'
import { ipcInputs, IPC_PREFIX, type ImportProgress, type IpcChannel, type IpcOutputs, type IpcResult } from '../shared/ipc'
import type { CampaignInfo } from '../shared/types'
import type { z } from 'zod'

/** What a card is, in the picture prompt ("An illustration of a character named …"). */
const PICTURE_KIND: Record<string, string> = { NPC: 'character', PC: 'character' }

const srdAttacks = srdAttacksData as SrdAttacks

type Handler<C extends IpcChannel> = (input: z.output<(typeof ipcInputs)[C]>) => IpcOutputs[C] | Promise<IpcOutputs[C]>

// Writes the popped-out DM notes window and the main window share: the other one refreshes.
const SHARED_WRITES = new Set<IpcChannel>(['notes:set', 'notes:append', 'session:notes', 'history:undo', 'history:redo'])


/** "Send smaller copies" in a Draw window: examples wider or taller than 1024 px go as 1024 px JPEG copies (the files stay as they are). */
// Pictures going to an image service, made once per file: at most 1536 px (the services shrink
// bigger ones on arrival, so nothing is lost and the upload is far smaller), or 1024 px when the
// DM ticks "Send smaller copies".
const prepared = new Map<string, { bytes: Buffer; mime: string }>()
/** The chosen part of a map or picture, enlarged to 1536 px on its long side (smoothly) so the AI sees its shapes clearly. */
function cropSource(c: Campaign, f: { mapId?: string; path?: string; crop: { x: number; y: number; w: number; h: number } }): { bytes: Buffer; mime: string } {
  const file = f.mapId ? c.mapImage(f.mapId).file : f.path ? c.assetFile(f.path) : null
  if (!file) throw new Error('The picture to follow is missing from the campaign folder. Choose it again.')
  const img = nativeImage.createFromPath(file)
  if (img.isEmpty()) throw new Error('This picture could not be read for cutting out a part. Use a PNG or JPEG picture.')
  const { width, height } = img.getSize()
  const x = Math.min(width - 1, Math.round(f.crop.x * width)), y = Math.min(height - 1, Math.round(f.crop.y * height))
  const part = img.crop({ x, y, width: Math.max(1, Math.min(width - x, Math.round(f.crop.w * width))), height: Math.max(1, Math.min(height - y, Math.round(f.crop.h * height))) })
  const s = part.getSize()
  const big = s.width >= s.height ? part.resize({ width: 1536, quality: 'best' }) : part.resize({ height: 1536, quality: 'best' })
  return { bytes: big.toPNG(), mime: 'image/png' }
}

function shrink(refs: Array<{ bytes: Buffer; mime: string; key?: string }>, smaller?: boolean): Array<{ bytes: Buffer; mime: string }> {
  const max = smaller ? 1024 : 1536
  return refs.map((ref) => {
    const key = ref.key ? `${ref.key}|${max}` : null
    const hit = key ? prepared.get(key) : undefined
    if (hit) return hit
    const img = nativeImage.createFromBuffer(ref.bytes)
    const { width, height } = img.getSize()
    let out = { bytes: ref.bytes, mime: ref.mime }
    if (!img.isEmpty() && Math.max(width, height) > max) {
      const small = width >= height ? img.resize({ width: max, quality: 'best' }) : img.resize({ height: max, quality: 'best' })
      // Pictures with see-through parts stay PNG (JPEG would turn them black); the rest JPEG 95, which looks the same.
      out = !smaller && ref.mime === 'image/png' && seeThrough(small.toBitmap()) ? { bytes: small.toPNG(), mime: 'image/png' } : { bytes: small.toJPEG(smaller ? 90 : 95), mime: 'image/jpeg' }
    }
    if (key) prepared.set(key, out)
    return out
  })
}

function seeThrough(bitmap: Buffer): boolean {
  for (let i = 3; i < bitmap.length; i += 4) if (bitmap[i] < 255) return true
  return false
}

/** The picture with the DM's marks laid over it (marks: transparent PNG, any size; stretched to the picture). */
function markedCopy(bytes: Buffer, marksPng: Buffer): { bytes: Buffer; mime: string } {
  const base = nativeImage.createFromBuffer(bytes)
  const size = base.getSize()
  const marks = nativeImage.createFromBuffer(marksPng).resize({ width: size.width, height: size.height, quality: 'best' })
  const out = blendMarks(base.toBitmap(), marks.toBitmap())
  return { bytes: nativeImage.createFromBitmap(Buffer.from(out), size).toPNG(), mime: 'image/png' }
}

export function registerIpc(getWindow: () => BrowserWindow | null, profile: ProfileStore, keys: KeyStore, openJournal: () => void, openPrepWindow: (number: number, part: string) => void,
  screens: { pop(screen: string): void; focus(screen: string): void; popped(): string[]; closeAll(): void }): void {
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
    try { next.backupIfDue() } catch { /* a backup that fails never stops the campaign opening */ }
    return info
  }

  function handle<C extends IpcChannel>(channel: C, fn: Handler<C>): void {
    ipcMain.handle(IPC_PREFIX + channel, async (event, raw): Promise<IpcResult<IpcOutputs[C]>> => {
      const parsed = ipcInputs[channel].safeParse(raw)
      if (!parsed.success) return { ok: false, error: `Invalid request for ${channel}: ${parsed.error.message}` }
      try {
        const before = campaign?.log.writes
        const value = await fn(parsed.data as never)
        // Any undoable change (or a notes write) shows in the other windows too (pop-out prep windows, DM notes).
        if (SHARED_WRITES.has(channel) || (campaign && campaign.log.writes !== before)) {
          for (const w of BrowserWindow.getAllWindows()) if (w.webContents !== event.sender) w.webContents.send(IPC_PREFIX + 'changed')
        }
        return { ok: true, value }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  }

  // dz-asset://campaign/<path> serves files from the open campaign's assets folder only;
  // dz-asset://encounter/<id>/<file> a file in that encounter's pictures folder.
  protocol.handle('dz-asset', (request) => {
    const url = new URL(request.url)
    const path = decodeURIComponent(url.pathname.slice(1))
    const [encId, ...rest] = path.split('/')
    const file = !campaign ? null : url.hostname === 'campaign' ? campaign.assetFile(path)
      : url.hostname === 'encounter' && rest.length === 1 ? (() => { try { return campaign.encounterFile(encId, rest[0]) } catch { return null } })() : null
    if (!file) return new Response('Not found', { status: 404 })
    const w = Number(url.searchParams.get('w'))
    if (w > 0) {
      const small = thumbnail(file, Math.min(1024, Math.round(w)))
      if (small) return net.fetch(pathToFileURL(small).toString())
    }
    return net.fetch(pathToFileURL(file).toString())
  })
  // ?w=<px>: a small copy for pictures shown small (cards, thumbnails), made once and kept in the
  // app's cache folder (not the campaign). The original is never changed; big views use it.
  const thumbnail = (file: string, w: number): string | null => {
    try {
      const st = statSync(file)
      const out = join(app.getPath('userData'), 'thumbs', `${createHash('sha1').update(`${file}|${st.size}|${st.mtimeMs}|${w}`).digest('hex')}${extname(file).toLowerCase() === '.png' ? '.png' : '.jpg'}`)
      if (existsSync(out)) return out
      const img = nativeImage.createFromPath(file)
      if (img.isEmpty()) return null
      const { width, height } = img.getSize()
      if (Math.max(width, height) <= w) return null
      const small = width >= height ? img.resize({ width: w, quality: 'best' }) : img.resize({ height: w, quality: 'best' })
      mkdirSync(dirname(out), { recursive: true })
      writeFileSync(out, out.endsWith('.png') ? small.toPNG() : small.toJPEG(90))
      return out
    } catch { return null }
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
  handle('campaign:close', () => { screens.closeAll(); campaign?.close(); campaign = null })
  // Delete = the whole campaign folder to the Recycle Bin (restorable there), never erased.
  handle('campaign:delete', async () => {
    const c = current()
    const folder = c.folder
    c.close(); campaign = null
    await shell.trashItem(folder)
    return folder
  })
  // Everything the DM saves lands in the campaign folder by default (one folder to back up).
  const exportsDir = () => { const d = join(current().folder, 'exports'); mkdirSync(d, { recursive: true }); return d }
  handle('campaign:openFolder', async ({ sub }) => {
    const c = current()
    const target = sub === '' ? c.folder : sub === 'assets' ? join(c.folder, ASSETS_DIR) : sub === 'exports' ? exportsDir() : join(c.folder, ASSETS_DIR, sub)
    mkdirSync(target, { recursive: true })
    const err = await shell.openPath(target)
    if (err) throw new Error(`Windows could not open it: ${err}`)
  })
  handle('backups:view', () => { const c = current(); return { ...c.backupFolder(), list: c.backups() } })
  handle('backups:now', () => current().backup())
  handle('backups:open', async () => {
    const { folder } = current().backupFolder()
    mkdirSync(folder, { recursive: true })
    const err = await shell.openPath(folder)
    if (err) throw new Error(`Windows could not open it: ${err}`)
  })
  handle('backups:chooseFolder', async () => {
    const win = getWindow()
    const options = { title: 'Choose where backups go', buttonLabel: 'Keep backups here', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (r.canceled || !r.filePaths[0]) return null
    current().setSetting('backup_folder', r.filePaths[0], 'Backups go to another folder')
    return r.filePaths[0]
  })
  handle('backups:resetFolder', () => current().setSetting('backup_folder', '', 'Backups go to the campaign folder'))
  handle('tables:view', () => current().ownTables())
  handle('tables:save', (t) => current().saveOwnTable(t))
  handle('tables:setStatus', ({ id, status }) => current().setOwnTableStatus(id, status))
  // A generator result as a card on the global board (one undo step), its text as the summary.
  handle('generator:toBoard', ({ type, name, text }) => {
    const c = current()
    return c.createEntity({ boardId: c.info().globalBoardId, type, name, position: c.freeGlobalSpot(), attributes: { summary: text }, label: `Put ${name} on the board` }).id
  })
  handle('campaign:info', () => campaign?.info() ?? null)
  handle('campaign:save', () => { current().save(); return new Date().toISOString() })
  handle('campaign:saveCopy', async () => {
    const c = current()
    const win = getWindow()
    const options = { title: 'Save a copy of the campaign', defaultPath: `${c.folder} copy`, buttonLabel: 'Save copy' }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    c.saveCopy(result.filePath)
    return result.filePath
  })
  handle('app:about', () => ({
    version: app.getVersion(), campaignFolder: campaign?.folder ?? null, dataFolder: app.getPath('userData'), installed: existsSync(uninstallerPath())
  }))
  handle('app:uninstall', () => {
    const file = uninstallerPath()
    if (!existsSync(file)) throw new Error('No uninstaller here: only the installed Dungeon Zen can uninstall itself (Windows Settings › Apps works too).')
    campaign?.save()
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
  })

  handle('board:view', ({ boardId }) => current().boardView(boardId))
  handle('entity:create', ({ position, ...rest }) =>
    current().createEntity({ ...rest, position: position ?? current().freeGlobalSpot() }))
  handle('entity:duplicate', ({ id }) => current().duplicateEntity(id))
  handle('sheet:view', ({ entityId }) => current().sheet(entityId))
  handle('ability:add', ({ entityId, ability }) => current().addAbility(entityId, ability))
  handle('ability:update', ({ id, patch }) => current().updateAbility(id, patch))
  handle('ability:addMany', ({ entityId, abilities }) => current().addAbilities(entityId, abilities))
  handle('srd:attacks', () => srdAttacks)
  handle('ability:setStatus', ({ id, status }) => current().setAbilityStatus(id, status))
  handle('knowledge:set', ({ entityId, field, known }) => current().setPartyKnows(entityId, field, known))
  handle('knowledge:setString', ({ relationshipId, known }) => current().setStringKnown(relationshipId, known))
  handle('library:search', (filters) => current().search(filters))
  handle('srd:search', (filters) => searchSrd(filters))
  handle('srd:monsters', () => allSrdMonsters())
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
  handle('item:resize', ({ itemId, size }) => current().resizeItem(itemId, size))
  handle('board:setHidden', ({ kind, id, hidden }) => current().setHidden(kind, id, hidden))
  handle('act:mark', ({ entityId, actId, on }) => current().setActMark(entityId, actId, on))
  handle('board:many', ({ label, ops }) => current().many(label, ops))
  handle('stringTypes:set', ({ types }) => current().setStringTypes(types))
  handle('entityType:setColour', ({ type, colour, clearOwn }) => current().setTypeColour(type, colour, clearOwn))
  handle('stringTypes:rename', ({ from, to }) => current().renameStringType(from, to))
  handle('board:linkPositions', ({ on, winner }) => current().setLinkPositions(on, winner))
  handle('board:sharedStrings', ({ on, winner }) => current().setSharedStrings(on, winner))
  handle('boardImage:add', async ({ boardId, mapId, position }) => {
    if (mapId) return current().addBoardImage(boardId, { mapId }, position)
    const win = getWindow()
    const options = {
      title: 'Choose a picture to put under the cards', buttonLabel: 'Put on board', properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Images', extensions: MAP_EXTENSIONS.map((e) => e.slice(1)) }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return current().addBoardImage(boardId, { file: result.filePaths[0] }, position)
  })
  handle('boardImage:update', ({ itemId, patch }) => current().updateBoardImage(itemId, patch))
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
  handle('map:reimport', async ({ mapId }) => {
    const win = getWindow()
    const options = { title: 'A new picture for this map', buttonLabel: 'Use this picture', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'Images', extensions: MAP_EXTENSIONS.map((e) => e.slice(1)) }] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (r.canceled || !r.filePaths[0]) return null
    return current().replaceMapImage(mapId, r.filePaths[0])
  })
  handle('map:setActive', ({ mapId }) => current().setSetting('active_map_id', mapId, 'Changed the desk map'))
  handle('notes:set', ({ text }) => current().setDmNotes(text))
  handle('clock:shift', ({ minutes }) => current().shiftClock(minutes))
  handle('clock:set', ({ minutes }) => current().setClock(minutes))
  handle('campaign:update', ({ name, rulesEdition, moonOffsetDays, units, artStyle, priceScale, worldOutline }) => {
    const c = current()
    c.setSettings({ name, rules_edition: rulesEdition, moon_offset_days: moonOffsetDays, units, art_style: artStyle, price_scale: priceScale, world_outline: worldOutline },
      artStyle !== undefined ? 'Changed the art style' : worldOutline ? 'Changed the world map outline' : 'Changed campaign settings')
    if (name) profile.remember(c.folder, name)
  })
  handle('storyline:update', ({ storylineId, patch }) => current().updateStoryline(storylineId, patch))
  handle('storyline:setRemoved', ({ storylineId, removed }) => current().setStorylineRemoved(storylineId, removed))
  handle('map:rename', ({ mapId, name }) => current().renameMap(mapId, name))
  handle('timeline:view', () => current().timeline())
  handle('act:create', (i) => current().createAct(i))
  handle('act:update', ({ id, patch }) => current().updateAct(id, patch))
  handle('act:setStatus', ({ id, status }) => current().setActStatus(id, status))
  handle('act:chooseOutcome', ({ actId, outcomeId }) => current().chooseOutcome(actId, outcomeId))
  handle('outcome:add', ({ actId, label }) => current().addOutcome(actId, label))
  handle('outcome:update', ({ id, patch }) => current().updateOutcome(id, patch))
  handle('outcome:setStatus', ({ id, status }) => current().setOutcomeStatus(id, status))
  handle('trigger:add', (i) => current().addTrigger(i))
  handle('trigger:update', ({ id, patch }) => current().updateTrigger(id, patch))
  handle('trigger:setStatus', ({ id, status }) => current().setTriggerStatus(id, status))
  handle('timeline:whatIf', ({ actId, outcomeId }) => current().whatIf(actId, outcomeId))
  handle('live:view', () => current().live())
  handle('review:view', ({ sessionId }) => current().review(sessionId))
  handle('mapscreen:view', ({ mapId }) => current().mapScreen(mapId))

  // ---- AI services (Settings › AI services). App-wide, kept in the DM profile, not the campaign.
  const known = (id: string) => {
    const info = providerById(id)
    if (!info) throw new Error(`Unknown AI service ${id}`)
    return info
  }
  /** A service with the DM's saved model and address, or the values being tried in the dialog. */
  const choiceFor = (id: string, over: { model?: string; baseUrl?: string } = {}): AiChoice => {
    const info = known(id)
    const prefs = profile.providerPrefs(id)
    return {
      provider: id,
      model: over.model ?? prefs.model ?? info.defaultModel,
      baseUrl: info.editableUrl ? (over.baseUrl || prefs.baseUrl || info.baseUrl) : info.baseUrl
    }
  }
  handle('ai:settings', () => ({
    encryption: safeStorage.isEncryptionAvailable(),
    text: profile.aiChoice('text'),
    image: profile.aiChoice('image'),
    providers: AI_PROVIDERS.map((p) => {
      const c = choiceFor(p.id)
      return { id: p.id, hasKey: keys.has(p.id), model: c.model, baseUrl: c.baseUrl }
    })
  }))
  handle('ai:choose', ({ kind, provider, model, baseUrl }) => {
    if (provider && known(provider).kind !== kind) throw new Error(`${known(provider).name} cannot be used for ${kind === 'text' ? 'writing' : 'battle maps'}`)
    profile.setAiChoice(kind, provider, provider ? { ...(model !== undefined ? { model } : {}), ...(baseUrl !== undefined ? { baseUrl } : {}) } : undefined)
  })
  handle('ai:setKey', ({ provider, key }) => { known(provider); keys.set(provider, key) })
  handle('ai:removeKey', ({ provider }) => { known(provider); keys.remove(provider) })
  handle('ai:models', async ({ provider, baseUrl }) => {
    const r = resolve({ ...choiceFor(provider, { baseUrl }), model: 'list' }, keys.get(provider))
    return listModels(r)
  })
  handle('ai:test', async ({ provider, model, baseUrl }) => checkConnection(resolve(choiceFor(provider, { model, baseUrl }), keys.get(provider))))
  // ---- fill blanks with AI
  handle('ai:building', async ({ buildingId, ask }) => {
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const c = current()
    const sheet = c.sheet(buildingId)
    const e = sheet.entity
    const kind = readBuilding(e.attributes).kind
    const knownText = ['summary', 'description', 'history', 'notes', 'secret']
      .flatMap((k) => (typeof e.attributes[k] === 'string' && (e.attributes[k] as string).trim() ? [`${k}: ${(e.attributes[k] as string).trim().slice(0, 800)}`] : []))
    const cards = c.search({ query: '' }).results
      .filter((x) => ['NPC', 'MONSTER', 'FACTION', 'CLUE', 'LOCATION', 'QUEST', 'ITEM', 'BUILDING'].includes(x.entity.type) && x.entity.id !== buildingId && x.entity.status !== 'defunct')
      .slice(0, 80).map((x) => `${x.entity.name} (${x.entity.type.toLowerCase()}): ${x.line || String(x.entity.attributes.summary ?? '')}`.slice(0, 200))
    const prompt = buildingPrompt({ campaignName: c.info().name, name: e.name, kind, where: typeof e.attributes.location === 'string' ? e.attributes.location : '', known: knownText, cards }, ask)
    const reply = await generateText(r, { system: BUILDING_SYSTEM, prompt, json: true, maxTokens: 6000 })
    return { proposal: parseBuilding(reply, kind), source: `${r.info.name} · ${r.model || 'default model'}` }
  })
  handle('ai:fill', async ({ entityId, keys: asked, ask, statblock }) => {
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const c = current()
    const sheet = c.sheet(entityId)
    const fields = fillableFields(sheet.entity.type).filter((f) => asked.includes(f.key))
    const index = srdMonsterIndex()
    const wantBase = statblock && ['NPC', 'MONSTER'].includes(sheet.entity.type) && !readStatBlock(sheet.entity.attributes.statblock)
    if (!fields.length && !wantBase) throw new Error('Choose at least one field to fill')
    const prompt = fillPrompt({ campaignName: c.info().name, sheet, storylines: c.storylinesOf(entityId), srdNames: wantBase ? index.map((m) => `${m.name} (CR ${m.cr})`) : null }, fields, ask)
    const reply = await generateText(r, { system: FILL_SYSTEM, prompt, json: true, maxTokens: 2000 })
    const answer = parseFill(reply, fields.map((f) => f.key))
    const base = wantBase && answer.srdBase ? index.find((m) => m.name.toLowerCase() === answer.srdBase!.replace(/\s*\(CR[^)]*\)\s*$/i, '').trim().toLowerCase()) : undefined
    return { fields: answer.fields, srd: base ? { key: base.key, name: base.name, cr: base.cr } : null, source: `${r.info.name} · ${r.model || 'default model'}` }
  })
  // ---- monster/NPC sheet: CR up or down, AI stat block, picture
  handle('entity:scaleCr', ({ entityId, cr }) => current().scaleCr(entityId, cr))
  handle('ai:statblock', async ({ entityId, ...ask }) => {
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const reply = await generateText(r, { system: STATBLOCK_SYSTEM, prompt: statBlockPrompt(current().sheet(entityId), ask), json: true, maxTokens: 4000 })
    return { ...parseStatBlock(reply), source: `${r.info.name} · ${r.model || 'default model'}` }
  })
  handle('entity:applyStatBlock', ({ entityId, statblock, actions, source }) => current().applyStatBlock(entityId, statblock, actions, source))
  handle('ai:charsheet', async ({ docIds }) => {
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const c = current()
    const docs = c.notesScreen().docs
    const files = await Promise.all(docIds.map(async (id) => {
      const doc = docs.find((d) => d.id === id)
      if (!doc) throw new Error('One of those notes is gone')
      // A picture of a sheet goes to the AI as an image (a model that can see pictures).
      if (doc.kind === 'picture') {
        const file = c.noteFile(id)
        const ext = extname(file).toLowerCase()
        return { title: doc.title, lines: ['(A picture of this file is attached: read the character sheet from it.)'], image: { bytes: readFileSync(file), mime: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg' } }
      }
      return { title: doc.title, lines: blockLines(await noteBlocks(c.noteFile(id), doc.kind)), image: null }
    }))
    const images = files.flatMap((f) => (f.image ? [f.image] : []))
    const reply = await generateText(r, { system: CHARSHEET_SYSTEM, prompt: charSheetPrompt(files), json: true, maxTokens: 12000, ...(images.length ? { images } : {}) })
    const answer = parseCharSheet(reply)
    const targets = c.importTargets().filter((t) => t.type === 'PC' || t.type === 'NPC')
    const words = (n: string) => n.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !['character', 'sheet', 'notes', 'background'].includes(w))
    const want = new Set(words(answer.name || files[0].title))
    const scored = targets.map((t) => ({ id: t.id, n: words(t.name).filter((w) => want.has(w)).length + (t.type === 'PC' ? 0.5 : 0) }))
      .filter((t) => t.n >= 1).sort((a, b) => b.n - a.n)
    return { ...answer, source: `${r.info.name} · ${r.model || 'default model'}`, targets, match: scored[0]?.id ?? null }
  })
  // Character sheet files (PDF, pictures, Word, text): copied into the campaign's notes, then read by the AI.
  handle('charsheet:importDialog', async () => {
    const win = getWindow()
    const options = {
      title: 'Import character sheets', buttonLabel: 'Import', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Character sheets (PDF, pictures, Word, text)', extensions: NOTE_EXTENSIONS.map((e) => e.slice(1)) }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    for (const p of result.filePaths) await readNotesFile(p) // the same checks as notes (size, scanned PDF)
    return result.filePaths.map((p) => current().addNoteDoc(p))
  })
  handle('entity:applyCharSheet', (input) => current().applyCharSheet(input))
  handle('entity:pictureDialog', async ({ entityId }) => {
    const win = getWindow()
    const options = {
      title: 'Choose a picture', buttonLabel: 'Use this picture', properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Images', extensions: MAP_EXTENSIONS.map((e) => e.slice(1)) }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return false
    current().setPicture(entityId, { file: result.filePaths[0] })
    return true
  })
  const imageService = () => {
    const choice = profile.aiChoice('image')
    return resolve(choice, choice.provider ? keys.get(choice.provider) : null)
  }
  handle('ai:imageInfo', () => {
    const choice = profile.aiChoice('image')
    const info = choice.provider ? providerById(choice.provider) : null
    return { name: info?.name ?? null, maxReferences: maxReferences(info) }
  })
  // The Draw window's starting lines; it adds the wishes, style boxes, composition and "No text, no frame."
  handle('entity:picturePrompt', ({ entityId }) => {
    const e = current().sheet(entityId).entity
    const looks = ['appearance', 'summary', 'description', 'bio'].map((k) => e.attributes[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined
    const kind = PICTURE_KIND[e.type] ?? e.type.toLowerCase()
    return {
      subject: `An illustration of ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} named ${e.name}.`,
      description: looks?.trim().slice(0, 600) ?? '',
      figure: ['NPC', 'PC', 'MONSTER'].includes(e.type) ? 'Full figure, set in a fitting place.' : ''
    }
  })
  // The outline goes in the blueprint spot: one picture fewer for style examples.
  const outlineOf = (o: { png?: string; path?: string } | undefined, smaller?: boolean) => {
    const pic = o?.path ? current().outlinePicture(o.path) : o?.png ? { bytes: Buffer.from(o.png, 'base64'), mime: 'image/png' } : null
    return pic ? shrink([pic], smaller)[0] : undefined
  }
  handle('entity:drawPicture', async ({ entityId, prompt, styleIds, smaller, outline }) => {
    const r = imageService()
    const c = current()
    c.sheet(entityId)
    const plan = outlineOf(outline, smaller)
    const references = shrink(c.styleImages(styleIds, Math.max(0, maxReferences(r.info) - (plan ? 1 : 0))), smaller)
    const image = await generateImage(r, { prompt, references, aspect: '1:1', outline: plan })
    return { ...c.savePendingImage(image.bytes, image.mime), source: `${r.info.name} · ${r.model || 'default model'}`, prompt }
  })
  handle('image:update', async ({ pendingId, change, marks, add }) => {
    const r = imageService()
    const c = current()
    const pic = c.pendingImage(pendingId)
    const size = imageSize(pic.bytes)
    const two = !!marks && maxReferences(r.info) > 1
    const prompt = changePrompt(change, two ? marks.labels : null, add)
    const image = await generateImage(r, {
      prompt, aspect: size ? aspectFor(size.width, size.height) : '1:1',
      edit: shrink([pic])[0], marked: two ? shrink([markedCopy(pic.bytes, Buffer.from(marks.png, 'base64'))])[0] : undefined
    })
    const next = c.savePendingImage(image.bytes, image.mime)
    // A world map keeps its waiting details under the new picture.
    const world = pendingWorlds.get(pendingId)
    if (world) pendingWorlds.set(next.pendingId, world)
    return { ...next, source: `${r.info.name} · ${r.model || 'default model'}`, prompt }
  })
  handle('image:pendingCopy', ({ path }) => current().pendingCopy(path))
  handle('outline:upload', async (purpose) => {
    const win = getWindow()
    const options = {
      ...(purpose === 'follow' ? { title: 'Choose a picture to turn into a battle map', buttonLabel: 'Use this picture' } : { title: 'Choose a picture to use as the outline', buttonLabel: 'Use as outline' }), properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'jfif', 'webp'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return current().addOutlinePicture(result.filePaths[0])
  })
  handle('entity:usePicture', ({ entityId, path }) => current().setPicture(entityId, { path }))
  handle('pictures:view', () => current().pictures())
  handle('places:list', () => current().placeOptions())
  handle('pictures:upload', async ({ folder }) => {
    const win = getWindow()
    const options = {
      title: 'Add pictures to the Library', buttonLabel: 'Add pictures',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'jfif', 'webp'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    for (const f of result.filePaths) current().addStyleExample(f, undefined, folder)
    return result.filePaths.length
  })
  handle('pictures:update', ({ key, patch }) => current().updatePicture(key, patch))
  // The AI reads a picture's art style; a suggestion only, the DM keeps or edits it (rule 2).
  handle('pictures:readStyle', async ({ key }) => {
    const c = current()
    const p = c.pictures().pictures.find((x) => x.key === key)
    if (!p) throw new Error('That picture is gone')
    let pic = nativeImage.createFromPath(c.assetFile(p.path) ?? '')
    if (pic.isEmpty()) throw new Error('Could not read this picture')
    if (pic.getSize().width > 1024) pic = pic.resize({ width: 1024, quality: 'good' })
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const reply = await generateText(r, {
      system: STYLE_TAGS_SYSTEM, prompt: `Describe the art style of this picture ("${p.name}").`, images: [{ bytes: pic.toJPEG(85), mime: 'image/jpeg' }], json: true, maxTokens: 800
    })
    return { tags: parseStyleTags(reply), source: `${r.info.name} · ${r.model || 'default model'}` }
  })
  handle('pictures:addFolder', ({ name }) => current().addPictureFolder(name))
  handle('promptTemplates:list', (use) => current().promptTemplates(use))
  handle('promptTemplates:save', (t) => current().savePromptTemplate(t))
  handle('promptTemplates:remove', ({ name, use }) => current().removePromptTemplate(name, use))
  handle('promptTemplates:rename', ({ name, next, use }) => current().renamePromptTemplate(name, next, use))
  handle('entity:keepPicture', ({ entityId, pendingId, source }) => current().setPicture(entityId, { pendingId, source }))
  handle('entity:removePicture', ({ entityId }) => current().setPicture(entityId, null))
  handle('card:applyFill', ({ entityId, fields, source, srdKey }) => current().applyFill(entityId, fields, source, srdKey ? srdCopy(srdKey) : null))

  // ---- notes import (Phase 5)
  let importCancel = false
  const progress = (p: ImportProgress) => getWindow()?.webContents.send(IPC_PREFIX + 'import-progress', p)
  handle('import:chooseFiles', async () => {
    const win = getWindow()
    const options = {
      title: 'Choose notes to import', buttonLabel: 'Read these',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Notes', extensions: NOTE_EXTENSIONS.map((e) => e.slice(1)) }]
    }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return r.canceled ? [] : r.filePaths
  })
  handle('import:preview', async ({ paths }) => Promise.all(paths.map(async (path) => {
    try {
      const f = await readNotesFile(path)
      return { path, name: f.name, kind: f.kind, parts: f.chunks.length, chars: f.chunks.reduce((n, c) => n + c.text.length, 0), warnings: f.warnings, error: null }
    } catch (e) {
      return { path, name: basename(path), kind: 'unknown', parts: 0, chars: 0, warnings: [], error: (e as Error).message }
    }
  })))
  handle('import:cancel', () => { importCancel = true })
  /** Sends each part of the notes to the writing AI and puts the proposals together as a draft (rule 2). */
  const proposeFrom = async (read: Array<{ name: string; file: NotesFile | null; error?: string }>, title: string | undefined) => {
    const c = current()
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    importCancel = false
    const existing = c.importTargets()
    const answers: ChunkAnswer[] = []
    const files: ImportDraft['files'] = []
    for (const { name: fileName, file: f, error } of read) {
      if (!f) { files.push({ name: fileName, kind: 'text', parts: 0, warnings: [], error: error ?? 'Could not read it' }); continue }
      const entry = { name: f.name, kind: f.kind, parts: f.chunks.length, warnings: [...f.warnings], error: null as string | null }
      files.push(entry)
      for (let i = 0; i < f.chunks.length; i++) {
        if (importCancel) { entry.warnings.push('Stopped before the end.'); break }
        const chunk = f.chunks[i]
        progress({ file: f.name, part: i + 1, parts: f.chunks.length, message: `Reading ${f.name}, part ${i + 1} of ${f.chunks.length}…` })
        try {
          const reply = await generateText(r, {
            system: NOTES_SYSTEM, json: true, maxTokens: 8000,
            prompt: notesPrompt({ file: f.name, locator: chunk.locator, text: chunk.text, image: f.image }, existing, c.info().name),
            images: f.image ? [f.image] : undefined
          })
          answers.push({ file: f.name, locator: chunk.locator, result: parseChunkReply(reply) })
        } catch (e) {
          entry.warnings.push(`${chunk.locator}: ${(e as Error).message}`)
          if (f.chunks.length === 1 || /key|credit|reach|address|model/i.test((e as Error).message)) { entry.error = (e as Error).message; break }
        }
      }
    }
    progress({ file: '', part: 0, parts: 0, message: 'Putting it together…' })
    const name = title?.trim() || (files.length === 1 ? files[0].name : `${files.length} files`)
    const draft = buildDraft(answers, existing, { title: name, source: `${r.info.name} · ${r.model || 'default model'}`, files })
    c.saveImportDraft(draft)
    return draft
  }
  handle('import:read', async ({ paths, title, replace }) => {
    const read: Array<{ name: string; file: NotesFile | null; error?: string }> = []
    for (const path of paths) {
      try {
        read.push({ name: basename(path), file: await readNotesFile(path) })
        // The Notes screen keeps every file it read (or replaces the note the DM chose).
        current().addNoteDoc(path, replace?.[path])
      } catch (e) { read.push({ name: basename(path), file: null, error: (e as Error).message }) }
    }
    return proposeFrom(read, title)
  })
  // ---- an encounter's pictures and maps folder
  handle('encounter:pictures', ({ id }) => current().encounterPictures(id))
  handle('encounter:plan', ({ id }) => current().battlePlan(id))
  handle('encounter:addPictures', async ({ id }) => {
    const win = getWindow()
    const options = {
      title: 'Add pictures and maps to this encounter', buttonLabel: 'Add', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Pictures, maps and PDFs', extensions: [...MAP_EXTENSIONS.map((e) => e.slice(1)), 'pdf'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled ? 0 : current().addEncounterPictures(id, result.filePaths)
  })
  handle('encounter:openFolder', async ({ id, file }) => {
    const c = current()
    const target = file ? c.encounterFile(id, file) : c.encounterFolder(id, true)
    if (!target) throw new Error('That file is not in the folder any more')
    const err = await shell.openPath(target)
    if (err) throw new Error(`Windows could not open it: ${err}`)
  })
  // A folder elsewhere: its pictures, maps and PDFs are copied into the encounter's folder in the campaign.
  handle('encounter:chooseFolder', async ({ id }) => {
    const win = getWindow()
    const options = { title: 'Copy pictures and maps from a folder', buttonLabel: 'Copy from this folder', properties: ['openDirectory'] as Array<'openDirectory'> }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths.length) return null
    return current().copyFolderIntoEncounter(id, result.filePaths[0])
  })
  handle('encounter:resetFolder', ({ id }) => current().bringEncounterFolderIn(id))
  // Re-import one picture: the new file takes its name; the old one goes to Removed.
  handle('encounter:replacePicture', async ({ id, name }) => {
    const win = getWindow()
    const options = { title: `A new copy of ${name}`, buttonLabel: 'Replace', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'Pictures, maps and PDFs', extensions: [...MAP_EXTENSIONS.map((e) => e.slice(1)), 'pdf'] }] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (r.canceled || !r.filePaths[0]) return false
    const c = current()
    c.removeEncounterPicture(id, name)
    copyFileSync(r.filePaths[0], join(c.encounterFolder(id, true), `${basename(name, extname(name))}${storedExt(extname(r.filePaths[0]))}`))
    return true
  })
  handle('encounter:removePicture', ({ id, name }) => current().removeEncounterPicture(id, name))
  handle('notes:screen', () => current().notesScreen())
  handle('notes:popout', () => openJournal())
  handle('prep:popout', ({ number, part }) => openPrepWindow(number, part))
  handle('window:popScreen', ({ screen }) => screens.pop(screen))
  handle('window:focusScreen', ({ screen }) => screens.focus(screen))
  handle('window:popped', () => screens.popped())
  // A pop-out window asks the main window to open a card's sheet.
  handle('main:openSheet', ({ entityId }) => { const w = getWindow(); if (w) { w.webContents.send(IPC_PREFIX + 'open-sheet', entityId); w.focus() } })
  handle('session:notes', ({ id, text }) => current().setSessionNotes(id, text))
  handle('notedoc:content', async ({ id }) => {
    const c = current()
    const doc = c.notesScreen().docs.find((d) => d.id === id)
    if (!doc) throw new Error('That note is gone')
    const file = c.noteFile(id)
    const rel = file.slice(join(c.folder, 'assets').length + 1).replace(/\\/g, '/')
    return { blocks: await noteBlocks(file, doc.kind), url: doc.kind === 'picture' ? `dz-asset://campaign/${rel}` : null }
  })
  handle('notedoc:create', ({ title }) => current().createNoteDoc(title, writeDocx([])))
  handle('notedoc:save', async ({ id, blocks }) => {
    const c = current()
    const doc = c.notesScreen().docs.find((d) => d.id === id)
    const before = doc ? await noteBlocks(c.noteFile(id), doc.kind).catch(() => []) : []
    c.saveNoteVersion(id, writeDocx(blocks))
    return { changed: changedLines(before, blocks) }
  })
  handle('notedoc:rename', ({ id, title }) => current().renameNoteDoc(id, title))
  handle('notedoc:setStatus', ({ id, status }) => current().setNoteDocStatus(id, status))
  handle('notedoc:restore', ({ id, file }) => current().restoreNoteVersion(id, file))
  handle('notedoc:openInWord', async ({ id }) => {
    const c = current()
    const doc = c.notesScreen().docs.find((d) => d.id === id)
    const target = doc?.kind === 'word' ? c.editCopy(id) : c.noteFile(id)
    const err = await shell.openPath(target)
    if (err) throw new Error(`Windows could not open it: ${err}`)
  })
  handle('notedoc:saveCopy', async ({ id }) => {
    const c = current()
    const doc = c.notesScreen().docs.find((d) => d.id === id)
    if (!doc) throw new Error('That note is gone')
    const win = getWindow()
    const options = { title: 'Save a copy as a Word file', defaultPath: join(exportsDir(), `${safeFolderName(doc.title)}.docx`), filters: [{ name: 'Word document', extensions: ['docx'] }] }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    if (doc.kind === 'word') copyFileSync(c.noteFile(id), result.filePath)
    else writeFileSync(result.filePath, writeDocx(await noteBlocks(c.noteFile(id), doc.kind)))
    return result.filePath
  })
  handle('notedoc:edited', () => current().editedInWord())
  handle('notedoc:takeEdit', async ({ id }) => {
    const c = current()
    const doc = c.notesScreen().docs.find((d) => d.id === id)
    const before = doc ? await noteBlocks(c.noteFile(id), doc.kind).catch(() => []) : []
    c.takeWordEdit(id)
    return { changed: changedLines(before, await noteBlocks(c.noteFile(id), 'word')) }
  })
  handle('notedoc:updateCards', async ({ id, lines }) => {
    const doc = current().notesScreen().docs.find((d) => d.id === id)
    const name = `${doc?.title ?? 'Note'} (changes)`
    return proposeFrom([{ name, file: { name, kind: 'text', chunks: chunkBlocks(lines, 'paragraph'), image: null, warnings: [] } }], name)
  })
  // Re-import: a new copy of the file for this note (the old one stays as an earlier version).
  handle('notedoc:reimport', async ({ id }) => {
    const c = current()
    const doc = c.notesScreen().docs.find((d) => d.id === id)
    if (!doc) throw new Error('That note is gone')
    const win = getWindow()
    const options = { title: `New copy of ${doc.title}`, buttonLabel: 'Re-import', properties: ['openFile'] as Array<'openFile'>, filters: [{ name: 'Notes', extensions: NOTE_EXTENSIONS.map((e) => e.slice(1)) }] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (r.canceled || !r.filePaths[0]) return null
    await readNotesFile(r.filePaths[0])
    const before = doc.kind === 'picture' ? [] : await noteBlocks(c.noteFile(id), doc.kind).catch(() => [])
    c.addNoteDoc(r.filePaths[0], id)
    const now = c.notesScreen().docs.find((d) => d.id === id)!
    return { changed: now.kind === 'picture' ? [] : changedLines(before, await noteBlocks(c.noteFile(id), now.kind)) }
  })
  // Read again with AI: every line of the note, for "propose card changes".
  handle('notedoc:allLines', async ({ id }) => {
    const c = current()
    const doc = c.notesScreen().docs.find((d) => d.id === id)
    if (!doc || doc.kind === 'picture') return []
    return blockLines(await noteBlocks(c.noteFile(id), doc.kind)).filter((l) => l.trim())
  })
  // Master notes (owner, 1.6.0): every note as one document. A section linked to its note is the
  // note itself (edits save to the note); unticked, the master keeps its own copy.
  const masterSections = async () => {
    const c = current()
    const screen = c.notesScreen()
    const copies = c.masterCopies()
    const out: IpcOutputs['notes:master'] = []
    const add = (id: string, title: string, kind: 'dm' | 'session' | 'doc', blocks: Block[], picture: string | null = null) =>
      out.push({ id, title, kind, blocks: (copies[id] as Block[] | undefined) ?? blocks, linked: !copies[id], picture })
    add('dm', 'DM notes between sessions', 'dm', textToBlocks(screen.dmNotes))
    for (const s of [...screen.sessions].sort((a, b) => a.number - b.number)) add(`session:${s.id}`, `Session ${s.number}`, 'session', textToBlocks(s.dmNotes))
    for (const d of [...screen.docs].sort((a, b) => a.title.localeCompare(b.title))) {
      const file = c.noteFile(d.id)
      const rel = file.slice(join(c.folder, ASSETS_DIR).length + 1).replace(/\\/g, '/')
      add(`doc:${d.id}`, d.title, 'doc', d.kind === 'picture' ? [] : await noteBlocks(file, d.kind).catch(() => []), d.kind === 'picture' ? `dz-asset://campaign/${rel}` : null)
    }
    return out
  }
  handle('notes:master', () => masterSections())
  handle('notes:masterLink', async ({ section, linked }) => {
    const s = (await masterSections()).find((x) => x.id === section)
    if (!s) throw new Error('That note is gone')
    current().setMasterCopy(section, linked ? null : s.blocks, linked ? `${s.title}: master follows the note again` : `${s.title}: master keeps its own copy`)
  })
  handle('notes:masterSave', ({ section, blocks }) => current().setMasterCopy(section, blocks, 'Edited the master notes'))
  handle('notes:masterDocx', async () => {
    const blocks = (await masterSections()).flatMap((s) => [{ kind: 'h1' as const, runs: [{ text: s.title }] }, ...s.blocks.map((b) => (b.kind === 'h1' ? { ...b, kind: 'h2' as const } : b.kind === 'h2' ? { ...b, kind: 'h3' as const } : b))])
    const file = await saveAs('Save the master notes as Word', 'Master notes.docx', [{ name: 'Word document', extensions: ['docx'] }])
    if (!file) return null
    writeFileSync(file, writeDocx(blocks))
    return file
  })
  handle('notedoc:named', ({ names }) => current().noteDocsNamed(names))
  // The Notes list: every note's headings (opened out under the note, click to jump).
  handle('notes:outline', async () => {
    const c = current()
    const screen = c.notesScreen()
    const out: IpcOutputs['notes:outline'] = { dm: headingsOf(textToBlocks(screen.dmNotes)) }
    for (const x of screen.sessions) out[`session:${x.id}`] = headingsOf(textToBlocks(x.dmNotes))
    for (const d of screen.docs) out[`doc:${d.id}`] = d.kind === 'picture' ? [] : headingsOf(await noteBlocks(c.noteFile(d.id), d.kind).catch(() => []))
    return out
  })
  handle('notedoc:setFolder', ({ ids, folder }) => current().setNoteFolder(ids, folder))
  handle('notedoc:showInFolder', ({ id }) => shell.showItemInFolder(current().noteFile(id)))
  handle('notedoc:duplicate', ({ id }) => current().duplicateNoteDoc(id))
  // Combine (owner, 1.7.0): each note under its title (its own headings one level down), in the order chosen.
  handle('notedoc:combine', async ({ ids, title, removeOriginals }) => {
    const c = current()
    const docs = c.notesScreen().docs
    const blocks: Block[] = []
    for (const id of ids) {
      const d = docs.find((x) => x.id === id)
      if (!d) throw new Error('One of those notes is gone')
      if (d.kind === 'picture') continue
      blocks.push({ kind: 'h1', runs: [{ text: d.title }] })
      for (const b of await noteBlocks(c.noteFile(id), d.kind)) blocks.push(b.kind === 'h1' ? { ...b, kind: 'h2' } : b.kind === 'h2' ? { ...b, kind: 'h3' } : b)
    }
    return c.combineNoteDocs(title, writeDocx(blocks), ids, removeOriginals)
  })
  // History › Delete file for good: every version of the file to the Recycle Bin (not undoable; the DM confirmed).
  handle('notedoc:forget', async ({ id }) => {
    for (const f of current().forgetNoteDoc(id)) if (existsSync(f)) await shell.trashItem(f)
  })
  handle('file:saveDocx', async ({ name, text }) => {
    const win = getWindow()
    const options = { title: 'Save as a Word file', defaultPath: join(exportsDir(), `${safeFolderName(name)}.docx`), filters: [{ name: 'Word document', extensions: ['docx'] }] }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, writeDocx(textToBlocks(text)))
    return result.filePath
  })
  handle('import:drafts', () => current().importDrafts())
  handle('import:draft', ({ id }) => current().importDraft(id))
  handle('import:save', ({ draft }) => current().saveImportDraft(draft))
  handle('import:commit', ({ id }) => current().commitImport(id))
  handle('import:setStatus', ({ id, status }) => current().setImportStatus(id, status))

  // ---- exports: Roll20, files
  const saveAs = async (title: string, defaultPath: string, filters: Array<{ name: string; extensions: string[] }>) => {
    const win = getWindow()
    const options = { title, defaultPath: join(exportsDir(), defaultPath), filters }
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    return r.canceled || !r.filePath ? null : r.filePath
  }
  handle('roll20:export', ({ entityIds }) => {
    const c = current()
    const sheets = [...new Set(entityIds)].map((id) => c.sheet(id))
    const chars = sheets.map((s) => roll20Character(s.entity, s.abilities))
    return {
      characters: sheets.map((s, i) => ({
        entityId: s.entity.id, name: s.entity.name,
        abilities: chars[i].abilities.map((a) => ({ name: a.name, macro: a.action, tokenAction: a.istokenaction }))
      })),
      data: roll20Data(chars), script: DUNGEON_ZEN_SCRIPT, handout: IMPORT_HANDOUT
    }
  })
  handle('export:pages', async (o) => {
    const c = current()
    const sheets = [...new Set(o.entityIds)].map((id) => c.sheet(id))
    const name = o.title?.trim() || (sheets.length === 1 ? sheets[0].entity.name : o.kind === 'board' ? 'Notices' : `${sheets.length} ${o.kind}`)
    // One document per file: a PDF holds every page; JPGs are one image each (or one board).
    const docs: Array<{ name: string; html: string }> = []
    if (o.kind === 'board') docs.push({ name, html: boardDocument(name, sheets.map((s) => s.entity), o.size) })
    else if (o.kind === 'letters') {
      const style = { hand: o.hand ?? 'handwritten', seal: o.seal ?? true } as const
      if (o.format === 'pdf') docs.push({ name, html: letterDocument(sheets.map((s) => s.entity), style, o.size) })
      else for (const s of sheets) docs.push({ name: s.entity.name, html: letterDocument([s.entity], style, o.size) })
    } else {
      const page = (s: (typeof sheets)[number]) => sheetPage(s.entity, s.abilities, { playerSafe: !!o.playerSafe, knows: s.partyKnows, includeNotes: o.includeNotes ?? true })
      if (o.format === 'pdf') docs.push({ name, html: sheetsDocument(name, sheets.map(page), o.size) })
      else for (const s of sheets) docs.push({ name: s.entity.name, html: sheetsDocument(s.entity.name, [page(s)], o.size) })
    }
    if (docs.length === 1) {
      const ext = o.format
      const file = await saveAs(`Save ${ext.toUpperCase()}`, `${safeFolderName(docs[0].name)}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }])
      if (!file) return null
      writeFileSync(file, ext === 'pdf' ? await renderPdf(docs[0].html, o.size) : await renderJpg(docs[0].html, o.size))
      return file
    }
    const win = getWindow()
    const options = { title: 'Choose a folder for the images', defaultPath: exportsDir(), buttonLabel: 'Save images here', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (r.canceled || !r.filePaths[0]) return null
    const used = new Set<string>()
    for (const d of docs) {
      let base = safeFolderName(d.name)
      for (let n = 2; used.has(base); n++) base = `${safeFolderName(d.name)} ${n}`
      used.add(base)
      writeFileSync(join(r.filePaths[0], `${base}.jpg`), await renderJpg(d.html, o.size))
    }
    return r.filePaths[0]
  })
  // Foundry VTT / Owlbear Rodeo: a dated folder in exports with maps, sheets and handouts.
  handle('export:vtt', async ({ target, maps, sheets, handouts }) => {
    const c = current()
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    let dir = join(exportsDir(), `${target === 'foundry' ? 'Foundry' : 'Owlbear'} ${safeFolderName(c.info().name)} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
    for (let n = 2; existsSync(dir); n++) dir = `${dir.replace(/ \(\d+\)$/, '')} (${n})`
    const sub = (name: string) => { const x = join(dir, name); mkdirSync(x, { recursive: true }); return x }
    const used = new Set<string>()
    const unique = (base: string) => { let b = safeFolderName(base); for (let n = 2; used.has(b); n++) b = `${safeFolderName(base)} ${n}`; used.add(b); return b }
    // Pictures: copied once; Foundry files point at dungeonzen/pictures/<file>.
    const picture = (rel: string, base: string): string | null => {
      const src = c.assetFile(rel)
      if (!src) return null
      const file = `${unique(base)}${extname(src)}`
      copyFileSync(src, join(sub(target === 'foundry' ? 'pictures' : 'tokens'), file))
      return target === 'foundry' ? `dungeonzen/pictures/${file}` : file
    }
    let count = 0
    if (maps) for (const m of c.maps()) {
      const src = c.assetFile(m.url.replace('dz-asset://campaign/', ''))
      if (!src) continue
      if (target === 'foundry') {
        const file = `${unique(m.name)}${extname(src)}`
        copyFileSync(src, join(sub('pictures'), file))
        writeFileSync(join(sub('scenes'), `${safeFolderName(m.name)}.json`), JSON.stringify(foundryScene(m, `dungeonzen/pictures/${file}`), null, 2))
      } else copyFileSync(src, join(sub('maps'), owlbearMapName({ ...m, name: safeFolderName(m.name) }, extname(src))))
      count++
    }
    const cards = c.importTargets().filter((t) => t.status !== 'stashed').map((t) => c.sheet(t.id))
    if (sheets) {
      const people = cards.filter((s) => ['PC', 'NPC', 'MONSTER'].includes(s.entity.type))
      for (const s of people) {
        const pic = typeof s.entity.attributes.picture === 'string' ? picture(s.entity.attributes.picture, s.entity.name) : null
        if (target === 'foundry') writeFileSync(join(sub('actors'), `${unique(`${s.entity.name} actor`)}.json`), JSON.stringify(foundryActor(s.entity, s.abilities, pic), null, 2))
        count++
      }
      if (target === 'owlbear' && people.length) {
        const html = sheetsDocument('Sheets', people.map((s) => sheetPage(s.entity, s.abilities, { playerSafe: false, knows: s.partyKnows, includeNotes: true })), 'A4')
        writeFileSync(join(sub('sheets'), 'Sheets.pdf'), await renderPdf(html, 'A4'))
      }
    }
    if (handouts) {
      const list = cards.filter((s) => s.entity.type === 'HANDOUT')
      for (const s of list) {
        if (target === 'foundry') writeFileSync(join(sub('journal'), `${unique(`${s.entity.name} journal`)}.json`), JSON.stringify(foundryJournal(s.entity.name, handoutHtml(s.entity)), null, 2))
        else writeFileSync(join(sub('handouts'), `${unique(s.entity.name)}.jpg`), await renderJpg(letterDocument([s.entity], { hand: 'handwritten', seal: true }, 'A4'), 'A4'))
        count++
      }
    }
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'README.txt'), target === 'foundry' ? FOUNDRY_README : OWLBEAR_README)
    await shell.openPath(dir)
    return { folder: dir, count }
  })
  handle('file:saveText', async ({ name, content, ext }) => {
    const label = { json: 'Data', js: 'Script', txt: 'Text' }[ext]
    const file = await saveAs(`Save ${label.toLowerCase()}`, `${safeFolderName(name)}.${ext}`, [{ name: label, extensions: [ext] }])
    if (!file) return null
    writeFileSync(file, content, 'utf8')
    return file
  })
  handle('map:saveImage', async ({ mapId }) => {
    const c = current()
    const m = c.maps().find((x) => x.id === mapId)
    if (!m) throw new Error('That map is not in the campaign')
    const src = c.assetFile(m.url.replace('dz-asset://campaign/', ''))
    if (!src) throw new Error('The map image is missing from the campaign folder')
    const ext = extname(src).slice(1)
    const file = await saveAs('Save the map image', `${safeFolderName(m.name)}.${ext}`, [{ name: 'Image', extensions: [ext] }])
    if (!file) return null
    copyFileSync(src, file)
    return file
  })

  // ---- encounter planner
  handle('encounters:view', () => current().encountersView())
  handle('encounter:create', ({ name, locationId }) => current().createEncounter({ name, locationId }))
  handle('encounter:update', ({ id, patch }) => current().updateEncounter(id, patch))
  handle('encounter:addCreature', ({ encounterId, entityId, count }) => current().addEncounterCreature(encounterId, entityId, count))
  handle('encounter:addSrd', ({ encounterId, groups }) => current().addSrdToEncounter(encounterId, groups, srdCopy))
  handle('encounter:creature', ({ rowId, patch }) => current().updateEncounterCreature(rowId, patch))
  handle('encounter:removeCreature', ({ encounterId, entityId }) => current().removeEncounterCreature(encounterId, entityId))
  handle('encounter:suggest', ({ difficulty, creatureType }) => {
    const v = current().encountersView()
    return suggestEncounter(Math.random, srdMonsterIndex(), v.party.level, v.party.size, difficulty, creatureType, v.adaptation.factor)
  })
  handle('encounter:run', ({ encounterId }) => current().runEncounter(encounterId))
  handle('encounter:houseRules', ({ text }) => current().setSetting('house_rules', text, 'Edited the house rules'))
  handle('ai:rateEncounter', async ({ encounterId }) => {
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const c = current()
    const v = c.encountersView()
    const e = v.encounters.find((x) => x.id === encounterId) ?? c.encounterView(encounterId)
    const text = await generateText(r, { system: RATE_SYSTEM, prompt: ratePrompt(e, v, e.locationName), maxTokens: 600 })
    return { text, source: `${r.info.name} · ${r.model || 'default model'}` }
  })

  handle('ai:buildEncounter', async ({ encounterId, ask }) => {
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const c = current()
    const v = c.encountersView()
    const e = v.encounters.find((x) => x.id === encounterId) ?? c.encounterView(encounterId)
    const index = srdMonsterIndex()
    const reply = await generateText(r, { system: BUILD_SYSTEM, prompt: buildPrompt(e, v, index.map((m) => `${m.name} (${m.cr})`), ask), json: true, maxTokens: 6000 })
    return { ...parseBuild(reply, index), source: `${r.info.name} · ${r.model || 'default model'}` }
  })
  handle('encounter:addProposals', ({ encounterId, items, tactics, source }) => current().addEncounterProposals(encounterId, items, tactics, source, srdCopy))

  handle('combat:start', ({ encounterId }) => current().startCombat(encounterId))
  handle('combat:view', ({ id }) => current().combatView(id))
  handle('combat:update', ({ id, state, label }) => current().updateCombat(id, state, label))
  handle('combat:end', ({ id, resolveIds, summary, xp }) => current().endCombat(id, { resolveIds, summary, xp }))
  handle('ai:combatAdvice', async ({ id, ask, focusId }) => {
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const c = current()
    const v = c.combatView(id)
    const hints = combatHints(v.state, v.info).map((h) => h.text)
    const text = await generateText(r, { system: COMBAT_SYSTEM, prompt: combatPrompt(v, hints, c.encountersView().houseRules, ask, focusId), maxTokens: 500 })
    return { text, source: `${r.info.name} · ${r.model || 'default model'}` }
  })

  // ---- live: where the party is, and Ask AI
  handle('live:where', () => current().liveWhere())
  handle('players:view', () => current().playersView())
  handle('live:setHeading', ({ locationId }) => current().setHeading(locationId))
  handle('notes:append', ({ text }) => current().appendDmNotes(text))
  handle('ai:ask', async ({ preset, ask }) => {
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const c = current()
    const where = c.liveWhere()
    const extras = {
      cameFrom: where.cameFrom?.name ?? null,
      headingTo: where.headingTo?.name ?? null,
      secrets: where.secrets.filter((x) => !x.done).map((x) => x.text),
      scenes: (where.prep?.items ?? []).filter((i) => i.kind === 'scene' && !i.done).map((i) => [i.title, i.locationName && `at ${i.locationName}`, i.body].filter(Boolean).join(' '))
    }
    const text = await generateText(r, { system: ASK_SYSTEM, prompt: askPrompt(c.sceneContext(), extras, preset, ask), maxTokens: 700 })
    return { text, source: `${r.info.name} · ${r.model || 'default model'}` }
  })

  // ---- session prep
  handle('prep:screen', () => current().prepScreen())
  handle('prep:view', ({ number }) => current().prepFor(number))
  handle('prep:create', ({ number }) => current().createPrep(number))
  handle('prep:update', ({ id, patch }) => current().updatePrep(id, patch))
  handle('prep:setStatus', ({ id, status }) => current().setPrepStatus(id, status))
  handle('prep:spread', ({ prepId }) => current().spreadSceneTimes(prepId))
  handle('prep:bringThreads', ({ prepId }) => current().bringThreads(prepId))
  handle('prep:makeCard', ({ itemId, type }) => current().cardFromPrepLine(itemId, type))
  handle('prep:saveNote', ({ id }) => {
    const c = current()
    const p = c.prepView(id)
    return c.savePrepNote(id, `Session ${p.number}${p.title.trim() ? ` - ${p.title.trim()}` : ''}`, writeDocx(prepBlocks(p)))
  })
  handle('prep:rollNames', ({ count }) => rollNames(seededRng(Date.now() % 2147483647), count))
  handle('prepItem:add', ({ prepId, kind, fields }) => current().addPrepItem(prepId, kind, fields))
  handle('prepItem:update', ({ id, patch }) => current().updatePrepItem(id, patch))
  handle('prepItem:addSecret', ({ prepId, kind }) => current().addPrepSecret(prepId, kind))
  handle('secret:save', (i) => current().saveSecret(i))
  handle('secret:setText', ({ id, text }) => current().setSecretText(id, text))
  handle('secret:remove', ({ id }) => current().removeSecret(id))
  handle('secret:revive', ({ id }) => current().reviveSecret(id))
  handle('prepItem:done', ({ id, done }) => current().setPrepDone(id, done))
  handle('prepItem:setStatus', ({ id, status }) => current().setPrepItemStatus(id, status))
  handle('prepItem:move', ({ id, direction }) => current().movePrepItem(id, direction))

  // ---- battle maps
  handle('style:list', ({ use }) => current().styleExamples(use))
  handle('style:addDialog', async () => {
    const win = getWindow()
    const options = {
      title: 'Add pictures to the Library',
      buttonLabel: 'Add examples',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'jfif', 'webp'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths.map((f) => current().addStyleExample(f))
  })
  handle('style:rename', ({ id, name }) => current().renameStyleExample(id, name))
  handle('style:setStatus', ({ id, status }) => current().setStyleExampleStatus(id, status))
  handle('battlemap:context', () => {
    const s = current().sceneContext()
    // The scene text, else how the place looks to the players, else the DM's notes on it.
    const description = s.current.trim() || (s.place ? [s.place.name, s.place.looks || s.place.notes].filter(Boolean).join(': ') : '')
    return { description, placeName: s.place?.name ?? null, timeOfDay: timeOfDayFor(s.light) }
  })
  handle('battlemap:draw', async ({ prompt, styleIds, aspect, blueprint, smaller, follow }) => {
    const choice = profile.aiChoice('image')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const c = current()
    // A followed picture takes the plan's place (the sketch is not sent with it).
    const source = follow ? cropSource(c, follow) : undefined
    if (source) blueprint = undefined
    const references = shrink(c.styleImages(styleIds, Math.max(0, maxReferences(r.info) - (blueprint || source ? 1 : 0))), smaller)
    const plan = blueprint ? { bytes: Buffer.from(blueprint.png, 'base64'), mime: 'image/png' } : undefined
    const image = await generateImage(r, { prompt: blueprint ? `${prompt}\n\n${blueprint.text}` : prompt, references, aspect, blueprint: plan, follow: source })
    return { ...c.savePendingImage(image.bytes, image.mime), source: `${r.info.name} · ${r.model || 'default model'}` }
  })
  handle('battlemap:keep', (input) => current().keepBattleMap(input))
  handle('building:patronCard', ({ buildingId, patronId, type }) => current().buildingPatronCard(buildingId, patronId, type))
  handle('building:secretPool', ({ buildingId }) => current().secretPool(buildingId))
  handle('building:moveSecret', (input) => current().moveSecret(input))
  handle('building:setCampaignSecrets', ({ list, label }) => current().setCampaignSecrets(list, label))
  handle('battlemap:importDialog', async ({ cols, gridShown }) => {
    const win = getWindow()
    const options = {
      title: 'Import a battle map', buttonLabel: 'Import battle map', properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Images', extensions: MAP_EXTENSIONS.map((e) => e.slice(1)) }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return current().importMap(result.filePaths[0], undefined, { gridCols: cols, gridShown })
  })
  handle('battlemap:discard', ({ pendingId }) => { pendingWorlds.delete(pendingId); current().discardPending(pendingId) })
  handle('map:setGrid', ({ mapId, cols }) => current().setMapGrid(mapId, cols))
  handle('map:setGridShown', ({ mapId, shown }) => current().setMapGridShown(mapId, shown))

  // ---- world map (getting started guide): made here or drawn by an AI, waiting until kept
  const pendingWorlds = new Map<string, { source: string; prompt: string | null; regions: PlaceShape[] }>()
  handle('world:generate', (o) => {
    const world = generateWorld(o)
    const pending = current().savePendingImage(world.png, 'image/png')
    const source = `Dungeon Zen map maker (seed ${o.seed})`
    pendingWorlds.set(pending.pendingId, { source, prompt: null, regions: world.regions })
    return { ...pending, regions: world.regions, source }
  })
  handle('world:draw', async ({ prompt, styleIds, smaller, outline }) => {
    const r = imageService()
    const plan = outlineOf(outline, smaller)
    const references = shrink(current().styleImages(styleIds ?? [], Math.max(0, maxReferences(r.info) - (plan ? 1 : 0))), smaller)
    const image = await generateImage(r, { prompt, references, aspect: '3:2', outline: plan })
    const pending = current().savePendingImage(image.bytes, image.mime)
    const source = `${r.info.name} · ${r.model || 'default model'}`
    pendingWorlds.set(pending.pendingId, { source, prompt, regions: [] })
    return { ...pending, source }
  })
  handle('world:keep', ({ pendingId, name, widthKm }) => {
    const p = pendingWorlds.get(pendingId)
    if (!p) throw new Error('That map is gone; make it again')
    const map = current().keepWorldMap({ pendingId, name, widthKm, source: p.source, prompt: p.prompt, regions: p.regions })
    pendingWorlds.delete(pendingId)
    return map
  })
  handle('world:findRegions', async ({ mapId, ask }) => {
    const c = current()
    const img = c.mapImage(mapId)
    // Sent smaller: enough to see the lands, far fewer tokens.
    let pic = nativeImage.createFromPath(img.file)
    if (pic.isEmpty()) throw new Error('Could not read this map picture')
    if (pic.getSize().width > 1568) pic = pic.resize({ width: 1568, quality: 'good' })
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const reply = await generateText(r, {
      system: REGIONS_SYSTEM, prompt: regionsPrompt(c.info().name, ask), images: [{ bytes: pic.toJPEG(85), mime: 'image/jpeg' }], json: true, maxTokens: 8000
    })
    return { ...parseRegions(reply, img.width, img.height), source: `${r.info.name} · ${r.model || 'default model'}` }
  })
  handle('world:addRegions', ({ mapId, regions, source }) =>
    current().addRegions(mapId, regions.map((x) => ({ ...x, source })), `Added ${regions.length} region${regions.length === 1 ? '' : 's'} found by AI`))
  handle('guide:finish', () => current().setSetting('getting_started', 'done', 'Finished the getting started guide'))
  handle('ai:sceneText', async ({ ask }) => {
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const text = await generateText(r, { system: SCENE_SYSTEM, prompt: scenePrompt(current().sceneContext(), ask), maxTokens: 600 })
    return { text, source: `${r.info.name} · ${r.model || 'default model'}` }
  })
  handle('region:detail', ({ regionId }) => current().regionDetail(regionId))
  handle('region:create', (i) => current().createRegion(i))
  handle('region:update', ({ id, patch }) => current().updateRegion(id, patch))
  handle('region:setStatus', ({ id, status }) => current().setRegionStatus(id, status))
  handle('map:setScale', ({ mapId, widthKm, travelKmh }) => current().setMapScale(mapId, widthKm, travelKmh))
  handle('party:estimate', ({ mapId, x, y }) => current().travelEstimate(mapId, [x, y]))
  handle('party:move', (i) => current().moveParty(i))
  handle('pc:move', (i) => current().movePc(i))
  handle('review:decide', ({ sessionId, ...input }) => current().decide(sessionId, input))
  handle('review:approveAll', ({ sessionId }) => current().approveAllUnflagged(sessionId))
  handle('review:feedback', ({ logId, feedback }) => current().setFeedback(logId, feedback))
  handle('ai:recap', async ({ sessionId, playerSafe }) => {
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const text = await generateText(r, { system: RECAP_SYSTEM, prompt: recapPrompt({ ...current().recapSources(sessionId, playerSafe), playerSafe }), maxTokens: 2000 })
    return { text: text.trim(), source: `${r.info.name} · ${r.model || 'default model'}` }
  })
  handle('review:draftPlayerRecap', ({ sessionId }) => current().draftPlayerRecap(sessionId))
  handle('review:undoSession', ({ sessionId }) => current().undoSession(sessionId))
  handle('session:start', () => current().startSession())
  handle('session:end', ({ id }) => {
    current().endSession(id)
    try { current().backup() } catch { /* shown in Setup › Backups; the session still ends */ }
  })
  handle('session:update', ({ id, patch }) => current().updateSession(id, patch))
  handle('session:setStatus', ({ id, status }) => current().setSessionStatus(id, status))
  handle('log:add', (i) => current().addLog(i))
  handle('log:update', ({ id, patch }) => current().updateLog(id, patch))
  handle('log:setStatus', ({ id, status }) => current().setLogStatus(id, status))
  handle('party:setHp', ({ entityId, hp }) => current().setHp(entityId, hp))
  handle('party:rest', ({ kind }) => current().rest(kind))
  handle('party:setLevel', ({ level }) => current().setSetting('party_level', level, `Set the party level to ${level}`))
  handle('generate:character', () => {
    const c = rollCharacter(Math.random)
    return {
      kind: 'character', title: c.name, summary: c.summary, payload: c,
      lines: [`Wants ${c.wants}.`, `Quirk: ${c.quirk}.`, `Stat block: ${c.statblockName} (SRD 5.2)`]
    }
  })
  handle('generate:tavern', () => {
    const t = fillTavern(Math.random)
    return {
      kind: 'tavern', title: t.name, summary: t.summary, payload: t,
      lines: [`Keeper: ${t.keeper.name}, ${t.keeper.summary}`, ...t.patrons.map((p) => `${p.name}: ${p.summary}`), `Rumour: ${t.rumour}`]
    }
  })
  handle('generate:encounter', ({ difficulty, creatureType }) => {
    const live = current().live()
    // The Live drop-down is an exact creature type, not search words.
    const monsters = srdMonsterIndex().filter((m) => !creatureType || m.creatureType === creatureType)
    const e = suggestEncounter(Math.random, monsters, live.partyLevel, Math.max(1, live.party.length || 4), difficulty)
    if (!e || !e.groups.length) return null
    return {
      kind: 'encounter', title: `${e.difficulty[0].toUpperCase()}${e.difficulty.slice(1)} encounter: ${e.creatureType}`, summary: e.summary,
      payload: e,
      lines: [...e.groups.map((g) => `${g.count} × ${g.name} (CR ${g.cr}, ${g.xp} XP)`),
        `Budget for ${live.party.length || 4} characters of level ${live.partyLevel}: ${e.budget} XP`]
    }
  })
  handle('generate:keep', ({ kind, payload, stash }) => {
    const byName = new Map(srdMonsterIndex().map((m) => [m.name, m.key]))
    return current().keepGenerated(kind, payload, srdCopy, (n) => byName.get(n) ?? null, stash)
  })
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

/** The NSIS uninstaller electron-builder puts next to DungeonZen.exe (absent when run from source). */
function uninstallerPath(): string {
  return join(dirname(process.execPath), 'Uninstall Dungeon Zen.exe')
}
