import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dialog, ipcMain, net, protocol, safeStorage, type BrowserWindow } from 'electron'
import { Campaign, MAP_EXTENSIONS } from './campaign/campaign'
import { ProfileStore } from './profile'
import type { KeyStore } from './ai/keys'
import { checkConnection, generateImage, generateText, listModels, resolve } from './ai/client'
import { SCENE_SYSTEM, scenePrompt } from './ai/scene'
import { ASK_SYSTEM, askPrompt } from './ai/ask'
import { AI_PROVIDERS, providerById, type AiChoice } from '../shared/aiProviders'
import { timeOfDayFor } from '../shared/battlemap'
import { searchSrd, srdCopy, srdMonsterIndex, SRD_SOURCE } from './srd'
import { fillTavern, rollCharacter, rollNames, seededRng, suggestEncounter } from './generators'
import { ipcInputs, IPC_PREFIX, type IpcChannel, type IpcOutputs, type IpcResult } from '../shared/ipc'
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
  handle('battlemap:discard', ({ pendingId }) => current().discardPending(pendingId))
  handle('map:setGrid', ({ mapId, cols }) => current().setMapGrid(mapId, cols))
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
  handle('map:setScale', ({ mapId, widthMiles, travelMph }) => current().setMapScale(mapId, widthMiles, travelMph))
  handle('party:estimate', ({ mapId, x, y }) => current().travelEstimate(mapId, [x, y]))
  handle('party:move', (i) => current().moveParty(i))
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
