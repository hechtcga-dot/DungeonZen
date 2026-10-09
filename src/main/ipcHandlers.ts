import { copyFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dialog, ipcMain, nativeImage, net, protocol, safeStorage, type BrowserWindow } from 'electron'
import { Campaign, MAP_EXTENSIONS } from './campaign/campaign'
import { ProfileStore } from './profile'
import type { KeyStore } from './ai/keys'
import { checkConnection, generateImage, generateText, listModels, resolve } from './ai/client'
import { SCENE_SYSTEM, scenePrompt } from './ai/scene'
import { ASK_SYSTEM, askPrompt } from './ai/ask'
import { RATE_SYSTEM, ratePrompt } from './ai/encounter'
import { FILL_SYSTEM, fillPrompt, parseFill } from './ai/fill'
import { STATBLOCK_SYSTEM, parseStatBlock, statBlockPrompt } from './ai/statblock'
import { parseRegions, REGIONS_SYSTEM, regionsPrompt } from './ai/regions'
import { generateWorld } from './worldgen'
import type { PlaceShape } from '../shared/places'
import { fillableFields } from '../shared/cardFields'
import { readStatBlock } from '../shared/statblock'
import { DUNGEON_ZEN_SCRIPT, IMPORT_HANDOUT, roll20Character, roll20Data } from './exporters/roll20'
import { boardDocument, letterDocument, sheetPage, sheetsDocument } from './exporters/pages'
import { renderJpg, renderPdf } from './exporters/render'
import { NOTE_EXTENSIONS, readNotesFile, type NotesFile } from './importers/read'
import { buildDraft, NOTES_SYSTEM, notesPrompt, parseChunkReply, type ChunkAnswer } from './importers/notes'
import type { ImportDraft } from '../shared/notesImport'
import { AI_PROVIDERS, providerById, type AiChoice } from '../shared/aiProviders'
import { timeOfDayFor } from '../shared/battlemap'
import { allSrdMonsters, searchSrd, srdCopy, srdMonsterIndex, SRD_SOURCE } from './srd'
import { fillTavern, rollCharacter, rollNames, seededRng, suggestEncounter } from './generators'
import { ipcInputs, IPC_PREFIX, type ImportProgress, type IpcChannel, type IpcOutputs, type IpcResult } from '../shared/ipc'
import type { CampaignInfo } from '../shared/types'
import type { z } from 'zod'

type Handler<C extends IpcChannel> = (input: z.output<(typeof ipcInputs)[C]>) => IpcOutputs[C] | Promise<IpcOutputs[C]>

export function registerIpc(getWindow: () => BrowserWindow | null, profile: ProfileStore, keys: KeyStore): void {
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
  handle('stringTypes:set', ({ types }) => current().setStringTypes(types))
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
  handle('map:setActive', ({ mapId }) => current().setSetting('active_map_id', mapId, 'Changed the desk map'))
  handle('notes:set', ({ text }) => current().setSetting('dm_notes', text, 'Edited DM notes'))
  handle('clock:shift', ({ minutes }) => current().shiftClock(minutes))
  handle('clock:set', ({ minutes }) => current().setClock(minutes))
  handle('campaign:update', ({ name, rulesEdition, moonOffsetDays, units }) => {
    const c = current()
    c.setSettings({ name, rules_edition: rulesEdition, moon_offset_days: moonOffsetDays, units }, 'Changed campaign settings')
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
  handle('entity:drawPicture', async ({ entityId, ask }) => {
    const choice = profile.aiChoice('image')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const c = current()
    const e = c.sheet(entityId).entity
    const sb = readStatBlock(e.attributes.statblock)
    const looks = ['summary', 'bio', 'description'].map((k) => e.attributes[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined
    const prompt = [
      `A fantasy illustration of ${e.name}${sb ? `, a ${[sb.size, sb.creatureType].filter(Boolean).join(' ')}` : ''}, for a tabletop role-playing game.`,
      looks ? `What it is like: ${looks.trim().slice(0, 600)}` : '',
      ask.trim() ? `The DM asks: ${ask.trim()}` : '',
      'Full figure on a plain, softly lit background, painted in a classic fantasy book style. No text, no frame.'
    ].filter(Boolean).join('\n')
    const image = await generateImage(r, { prompt, references: [], aspect: '1:1' })
    return { ...c.savePendingImage(image.bytes, image.mime), source: `${r.info.name} · ${r.model || 'default model'}`, prompt }
  })
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
  handle('import:read', async ({ paths, title }) => {
    const c = current()
    const choice = profile.aiChoice('text')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    importCancel = false
    const existing = c.importTargets()
    const answers: ChunkAnswer[] = []
    const files: ImportDraft['files'] = []
    for (const path of paths) {
      let f: NotesFile
      try { f = await readNotesFile(path) } catch (e) {
        files.push({ name: basename(path), kind: 'text', parts: 0, warnings: [], error: (e as Error).message })
        continue
      }
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
  })
  handle('import:drafts', () => current().importDrafts())
  handle('import:draft', ({ id }) => current().importDraft(id))
  handle('import:save', ({ draft }) => current().saveImportDraft(draft))
  handle('import:commit', ({ id }) => current().commitImport(id))
  handle('import:setStatus', ({ id, status }) => current().setImportStatus(id, status))

  // ---- exports: Roll20, files
  const saveAs = async (title: string, defaultPath: string, filters: Array<{ name: string; extensions: string[] }>) => {
    const win = getWindow()
    const options = { title, defaultPath, filters }
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
    const options = { title: 'Choose a folder for the images', buttonLabel: 'Save images here', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> }
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
  handle('prep:rollNames', ({ count }) => rollNames(seededRng(Date.now() % 2147483647), count))
  handle('prepItem:add', ({ prepId, kind, fields }) => current().addPrepItem(prepId, kind, fields))
  handle('prepItem:update', ({ id, patch }) => current().updatePrepItem(id, patch))
  handle('prepItem:done', ({ id, done }) => current().setPrepDone(id, done))
  handle('prepItem:setStatus', ({ id, status }) => current().setPrepItemStatus(id, status))
  handle('prepItem:move', ({ id, direction }) => current().movePrepItem(id, direction))

  // ---- battle maps
  handle('style:list', () => current().styleExamples())
  handle('style:addDialog', async () => {
    const win = getWindow()
    const options = {
      title: 'Choose example maps for the battle map style',
      buttonLabel: 'Add examples',
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
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
  handle('battlemap:draw', async ({ prompt, styleIds, aspect }) => {
    const choice = profile.aiChoice('image')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const c = current()
    const references = r.info.references ? c.styleImages(styleIds) : []
    const image = await generateImage(r, { prompt, references, aspect })
    return { ...c.savePendingImage(image.bytes, image.mime), source: `${r.info.name} · ${r.model || 'default model'}` }
  })
  handle('battlemap:keep', (input) => current().keepBattleMap(input))
  handle('battlemap:importDialog', async ({ cols }) => {
    const win = getWindow()
    const options = {
      title: 'Import a battle map', buttonLabel: 'Import battle map', properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Images', extensions: MAP_EXTENSIONS.map((e) => e.slice(1)) }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return current().importMap(result.filePaths[0], undefined, { gridCols: cols })
  })
  handle('battlemap:discard', ({ pendingId }) => { pendingWorlds.delete(pendingId); current().discardPending(pendingId) })
  handle('map:setGrid', ({ mapId, cols }) => current().setMapGrid(mapId, cols))

  // ---- world map (getting started guide): made here or drawn by an AI, waiting until kept
  const pendingWorlds = new Map<string, { source: string; prompt: string | null; regions: PlaceShape[] }>()
  handle('world:generate', (o) => {
    const world = generateWorld(o)
    const pending = current().savePendingImage(world.png, 'image/png')
    const source = `Dungeon Zen map maker (seed ${o.seed})`
    pendingWorlds.set(pending.pendingId, { source, prompt: null, regions: world.regions })
    return { ...pending, regions: world.regions, source }
  })
  handle('world:draw', async ({ prompt }) => {
    const choice = profile.aiChoice('image')
    const r = resolve(choice, choice.provider ? keys.get(choice.provider) : null)
    const image = await generateImage(r, { prompt, aspect: '3:2' })
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
  handle('review:draftPlayerRecap', ({ sessionId }) => current().draftPlayerRecap(sessionId))
  handle('review:undoSession', ({ sessionId }) => current().undoSession(sessionId))
  handle('session:start', () => current().startSession())
  handle('session:end', ({ id }) => current().endSession(id))
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
    const e = suggestEncounter(Math.random, srdMonsterIndex(), live.partyLevel, Math.max(1, live.party.length || 4), difficulty, creatureType)
    if (!e) return null
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
