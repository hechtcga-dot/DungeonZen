import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { srdCopy, srdMonsterIndex } from '../src/main/srd'
import { adaptation, rateEncounter } from '../src/shared/encounter'
import { emptyStatBlock } from '../src/shared/statblock'
import { DUNGEON_ZEN_SCRIPT, IMPORT_HANDOUT, macroFor, roll20Character, roll20Data } from '../src/main/exporters/roll20'
import { boardDocument, esc, letterDocument, sheetPage } from '../src/main/exporters/pages'
import { ratePrompt } from '../src/main/ai/encounter'

let dir: string
let c: Campaign
let g: string
const at = { x: 0, y: 0 }
const keyOf = (name: string) => srdMonsterIndex().find((m) => m.name === name)!.key

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dz-enc-'))
  c = Campaign.create(join(dir, 'Camp'), 'Camp')
  g = c.info().globalBoardId
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('difficulty with the 2024 rules', () => {
  it('rates by XP against the budgets', () => {
    // Level 3, four characters: Low 600, Moderate 900, High 1600.
    expect(rateEncounter([{ cr: '1', count: 2 }], 3, 4)).toMatchObject({ totalXp: 400, rating: 'low', budgets: { low: 600, moderate: 900, high: 1600 } })
    expect(rateEncounter([{ cr: '1', count: 4 }], 3, 4).rating).toBe('moderate')
    expect(rateEncounter([{ cr: '3', count: 3 }], 3, 4).rating).toBe('over_high')
    expect(rateEncounter([{ cr: '1/8', count: 2 }], 3, 4).rating).toBe('trivial')
    expect(rateEncounter([{ cr: '1', count: 4 }], 3, 4, 1.2).budgets.moderate).toBe(1080)
  })

  it('adapts the budgets to how the party found its fights', () => {
    expect(adaptation([])).toMatchObject({ factor: 1, fights: 0 })
    expect(adaptation(['too_easy', 'too_easy', 'about_right', 'too_easy'])).toMatchObject({ factor: 1.15, fights: 4 })
    expect(adaptation(['nearly_deadly', 'hard'])).toMatchObject({ factor: 0.83 })
    expect(adaptation(Array(20).fill('too_easy')).factor).toBe(1.2) // only the last 10 count, capped
    expect(adaptation(['hard']).explain).toMatch(/1 hard\): budgets lowered 10%/)
  })
})

describe('encounter planner', () => {
  it('plans an encounter at a place with cards and SRD monsters, one copy per SRD monster', () => {
    const harbour = c.createEntity({ boardId: g, type: 'LOCATION', name: 'Old Harbour', position: at })
    const id = c.createEncounter({ name: 'Dockside ambush', locationId: harbour.id })
    const bandit = c.createEntity({ boardId: g, type: 'NPC', name: 'Smuggler', position: at })
    c.updateEntity(bandit.id, { attributes: { statblock: { ...emptyStatBlock(), cr: '1/2' } } })
    c.addEncounterCreature(id, bandit.id, 2)
    c.addEncounterCreature(id, bandit.id, 1) // same card: count goes up
    c.addSrdToEncounter(id, [{ key: keyOf('Ghoul'), count: 2 }], srdCopy)
    c.addSrdToEncounter(id, [{ key: keyOf('Ghoul'), count: 1 }], srdCopy) // reuses the copied card
    let e = c.encounterView(id)
    expect(e).toMatchObject({ name: 'Dockside ambush', locationName: 'Old Harbour', target: 'moderate' })
    expect(e.creatures.map((x) => [x.name, x.count, x.xpEach])).toEqual([['Smuggler', 3, 100], ['Ghoul', 3, 200]])
    expect(e.difficulty.totalXp).toBe(900)
    expect(c.search({ query: 'Ghoul' }).results).toHaveLength(1)
    // Edit everything; count 0 takes it out; undo puts it back.
    c.updateEncounter(id, { target: 'high', tactics: 'Ghouls come out of the water', battleMapId: null })
    c.updateEncounterCreature(e.creatures[0].rowId!, { count: 0 })
    e = c.encounterView(id)
    expect(e.creatures.map((x) => x.name)).toEqual(['Ghoul'])
    expect(e).toMatchObject({ target: 'high', tactics: 'Ghouls come out of the water' })
    c.undo()
    expect(c.encounterView(id).creatures).toHaveLength(2)
    // It is a SCENE card: the region panel and History see it.
    expect(c.encountersView().encounters.map((x) => x.name)).toEqual(['Dockside ambush'])
    c.setEntityStatus(id, 'defunct')
    expect(c.encountersView().encounters).toEqual([])
  })

  it('takes over encounters made by "Suggest an encounter" before the planner', () => {
    const ids = c.keepGenerated('encounter', { summary: 's', groups: [{ key: keyOf('Ghoul'), name: 'Ghoul', count: 3 }] }, srdCopy, () => null, false)
    const enc = ids[0]
    expect(c.encounterView(enc).creatures.map((x) => [x.name, x.count, x.rowId])).toEqual([['Ghoul', 3, null]])
    c.removeEncounterCreature(enc, ids[1])
    expect(c.encounterView(enc).creatures).toEqual([])
    c.undo()
    expect(c.encounterView(enc).creatures.map((x) => x.count)).toEqual([3])
  })

  it('runs an encounter as a logged fight, and its rating feeds the budgets', () => {
    const id = c.createEncounter({ name: 'Bridge trolls' })
    c.startSession()
    const fight = c.runEncounter(id)
    expect(fight).toMatchObject({ kind: 'fight', text: 'Bridge trolls' })
    c.setFeedback(fight.id, 'too_easy')
    const v = c.encountersView()
    expect(v.adaptation.factor).toBe(1.2)
    expect(v.sessionRunning).toBe(true)
    expect(c.encounterView(id).runs).toEqual([{ atMin: 9 * 60, session: 1, feedback: 'too_easy' }])
    expect(c.encounterView(id).difficulty.factor).toBe(1.2)
  })

  it('shows encounters planned where the party is on the live desk', () => {
    const png = Buffer.alloc(24); png.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); png.writeUInt32BE(1000, 16); png.writeUInt32BE(800, 20)
    writeFileSync(join(dir, 'm.png'), png)
    const mapId = c.importMap(join(dir, 'm.png')).id
    const r = c.createRegion({ mapId, polygon: [[0, 0], [200, 0], [200, 200], [0, 200]], newName: 'Old Harbour' })
    const loc = c.mapScreen(mapId).regions.find((x) => x.id === r)!.locationId
    const id = c.createEncounter({ name: 'Dockside ambush', locationId: loc })
    c.moveParty({ mapId, x: 100, y: 100, minutes: 0 })
    expect(c.regionDetail(r).encounters.map((e) => e.id)).toEqual([id])
    const w = c.liveWhere()
    expect(w.encounters).toEqual([{ id, name: 'Dockside ambush', rating: 'Below Low', totalXp: 0, runs: 0 }])
    expect(w.tips).toContain('Encounter planned here: Dockside ambush (Below Low).')
  })

  it('asks the AI to rate with the party, the numbers, past fights and the house rules', () => {
    const id = c.createEncounter({ name: 'Ghoul pit' })
    c.addSrdToEncounter(id, [{ key: keyOf('Ghoul'), count: 4 }], srdCopy)
    c.setSetting('house_rules', 'Minions die in one hit.', 'rules')
    const v = c.encountersView()
    const p = ratePrompt(v.encounters[0], v, null)
    expect(p).toContain('Party: 4 characters of level 1.')
    expect(p).toContain('- 4 × Ghoul (CR 1;')
    expect(p).toContain('800 XP against budgets Low 200, Moderate 300, High 400: Above High')
    expect(p).toContain('House rules:\nMinions die in one hit.')
  })
})

describe('Roll20 export', () => {
  it('keeps written macros and builds the rest from the description', () => {
    expect(macroFor({ name: 'Bite', description: '', macroText: '/roll 1d6' })).toBe('/roll 1d6')
    const m = macroFor({ name: 'Scimitar', macroText: '', description: 'Melee Attack Roll: +5, reach 5 ft. 6 (1d6 + 3) Slashing damage plus 3 (1d6) Fire damage.' })
    expect(m).toContain('{{attack=[[1d20+5]]}}')
    expect(m).toContain('{{damage=[[1d6+3]] slashing}}')
    expect(m).toContain('{{damage 2=[[1d6]] fire}}')
    expect(macroFor({ name: 'Old style', macroText: '', description: '+4 to hit. Each creature must make a DC 13 Dexterity saving throw.' }))
      .toMatch(/\{\{attack=\[\[1d20\+4\]\]\}\}.*\{\{save=DC 13 Dex\}\}/)
    expect(macroFor({ name: 'Claw {x}', macroText: '', description: 'Constitution Saving Throw: DC 10.' })).toMatch(/name=Claw x.*save=DC 10 Con/)
  })

  it('builds characters with sheet attributes and token actions, and the import script', () => {
    const ghoul = c.createEntity({ boardId: g, ...srdCopy(keyOf('Ghoul')), position: at })
    const s = c.sheet(ghoul.id)
    const ch = roll20Character(s.entity, s.abilities)
    expect(ch.attributes).toMatchObject({ npc: 1, npc_name: 'Ghoul', npc_challenge: '1', npc_xp: 200, hp: { current: 22, max: 22 }, strength: 13, dexterity_mod: 2 })
    expect(ch.abilities.find((a) => a.name === 'Bite')).toMatchObject({ istokenaction: true, action: expect.stringContaining('[[1d20+4]]') })
    expect(JSON.parse(roll20Data([ch]))).toMatchObject({ dungeonZen: 1, characters: [{ name: 'Ghoul' }] })
    expect(DUNGEON_ZEN_SCRIPT).toContain(JSON.stringify(IMPORT_HANDOUT))
    expect(DUNGEON_ZEN_SCRIPT).toContain("'!dz-import'")
    expect(DUNGEON_ZEN_SCRIPT).toContain("playerIsGM(msg.playerid)")
    expect(() => new Function('on', 'findObjs', 'createObj', 'sendChat', 'playerIsGM', DUNGEON_ZEN_SCRIPT)).not.toThrow()
  })

  it('the script really creates characters from the handout (run against a stand-in Roll20)', () => {
    const ghoul = c.createEntity({ boardId: g, ...srdCopy(keyOf('Ghoul')), position: at })
    const s = c.sheet(ghoul.id)
    const data = roll20Data([roll20Character(s.entity, s.abilities)])
    const objs: Array<Record<string, unknown> & { type: string }> = []
    const handlers: Record<string, (msg: unknown) => void> = {}
    const whispers: string[] = []
    const make = (type: string, props: Record<string, unknown>) => {
      const o: Record<string, unknown> & { type: string } = { type, id: `id${objs.length}`, ...props }
      Object.assign(o, { get: (k: string, cb?: (v: unknown) => void) => (cb ? cb(o[k]) : o[k]), set: (p: Record<string, unknown>) => Object.assign(o, p), remove: () => objs.splice(objs.indexOf(o), 1) })
      objs.push(o)
      return o
    }
    // GM notes come back as HTML, as Roll20 stores them.
    make('handout', { name: IMPORT_HANDOUT, gmnotes: `<p>${esc(data)}</p>` })
    const api = {
      on: (ev: string, fn: (m?: unknown) => void) => { handlers[ev] = fn },
      findObjs: (q: Record<string, unknown>) => objs.filter((o) => Object.entries(q).every(([k, v]) => o[k] === v)),
      createObj: make,
      sendChat: (_who: string, text: string) => whispers.push(text),
      playerIsGM: () => true
    }
    new Function(...Object.keys(api), DUNGEON_ZEN_SCRIPT)(...Object.values(api))
    handlers.ready?.(undefined)
    handlers['chat:message']({ type: 'api', content: '!dz-import', playerid: 'gm' })
    const ch = objs.find((o) => o.type === 'character')!
    expect(ch.name).toBe('Ghoul')
    const attr = (n: string) => objs.find((o) => o.type === 'attribute' && o.characterid === ch.id && o.name === n)
    expect(attr('hp')).toMatchObject({ current: '22', max: '22' })
    expect(attr('npc_challenge')).toMatchObject({ current: '1' })
    expect(objs.filter((o) => o.type === 'ability' && o.characterid === ch.id).map((o) => o.name)).toContain('Bite')
    expect(whispers.at(-1)).toContain('1 created')
    handlers['chat:message']({ type: 'api', content: '!dz-import', playerid: 'gm' })
    expect(whispers.at(-1)).toContain('1 skipped')
    handlers['chat:message']({ type: 'api', content: '!dz-import --replace', playerid: 'gm' })
    expect(whispers.at(-1)).toContain('1 updated')
    expect(objs.filter((o) => o.type === 'ability' && o.name === 'Bite')).toHaveLength(1)
  })
})

describe('printable pages', () => {
  it('escapes campaign text and keeps player copies to what the party knows', () => {
    const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf <b>Crol</b>', position: at })
    c.updateEntity(npc.id, { attributes: { statblock: { ...emptyStatBlock(), ac: '15', hp: '33', cr: '2' }, motivation: 'Hide the cult', bio: 'Harbourmaster.', notes: 'Secret cultist' } })
    const s = c.sheet(npc.id)
    const dm = sheetPage(s.entity, s.abilities, { playerSafe: false, includeNotes: true })
    expect(dm).toContain('Ciaf &lt;b&gt;Crol&lt;/b&gt;')
    expect(dm).toContain('Armor Class</b> 15')
    expect(dm).toContain('Secret cultist')
    const player = sheetPage(s.entity, s.abilities, { playerSafe: true, knows: { name: true, bio: true }, includeNotes: true })
    expect(player).toContain('Harbourmaster.')
    expect(player).not.toContain('Hide the cult')
    expect(player).not.toContain('Armor Class')
    expect(player).not.toContain('Secret cultist')
    expect(sheetPage(s.entity, s.abilities, { playerSafe: true, knows: {}, includeNotes: true })).toContain('<h1>Unknown</h1>')
  })

  it('makes letters and a bulletin board', () => {
    const h = c.createEntity({ boardId: g, type: 'HANDOUT', name: 'A warning', position: at })
    c.updateEntity(h.id, { attributes: { text: 'Leave the bell alone.\n\nOr else.', from: 'A friend' } })
    const q = c.createEntity({ boardId: g, type: 'QUEST', name: 'Rats in the cellar', position: at })
    c.updateEntity(q.id, { attributes: { summary: 'The inn needs help', reward: '10 gp' } })
    const letter = letterDocument([c.sheet(h.id).entity], { hand: 'handwritten', seal: true })
    expect(letter).toContain('<p>Leave the bell alone.</p><p>Or else.</p>')
    expect(letter).toContain('class="seal">A</div>')
    const board = boardDocument('Notices & news', [c.sheet(q.id).entity, c.sheet(h.id).entity])
    expect(board).toContain('Notices &amp; news')
    expect(board).toContain('Reward: 10 gp')
  })
})
