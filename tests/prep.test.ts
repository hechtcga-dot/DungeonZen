import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { emptyStatBlock } from '../src/shared/statblock'
import { askPrompt } from '../src/main/ai/ask'
import type { Point } from '../src/shared/geometry'

let dir: string
let c: Campaign
let g: string
const at = { x: 0, y: 0 }
const sq = (x: number, y: number, s: number): Point[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dz-prep-'))
  c = Campaign.create(join(dir, 'Camp'), 'The Mistreach')
  g = c.info().globalBoardId
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('session prep sheet', () => {
  it('is made for the next session and holds every part of the template', () => {
    expect(c.prepScreen()).toMatchObject({ sheets: [], openNumber: null, nextNumber: 1 })
    expect(c.prepFor()).toBeNull()
    const id = c.createPrep(1)
    expect(c.createPrep(1)).toBe(id) // one sheet per session
    c.updatePrep(id, { title: 'The Drowned Bell', premise: 'The bell rings at night and people vanish.', pacingMinutes: 240 })
    const d1 = c.addPrepItem(id, 'discovery', { title: 'The ringer', body: 'The priest rings it to call the drowned.' })
    c.addPrepItem(id, 'discovery', { title: 'The cult' })
    const s1 = c.addPrepItem(id, 'scene', { title: 'Arrival' })
    c.addPrepItem(id, 'scene', { title: 'Bell tower', sceneType: 'combat' })
    c.addPrepItem(id, 'clue', { body: 'Wet footprints up the tower stairs', discoveryId: d1 })
    const p = c.prepFor()!
    expect(p).toMatchObject({ number: 1, title: 'The Drowned Bell', pacingMinutes: 240 })
    expect(p.items.filter((i) => i.kind === 'discovery').map((i) => i.title)).toEqual(['The ringer', 'The cult'])
    expect(p.items.find((i) => i.id === s1)).toMatchObject({ sceneType: 'exploration', done: false })
    // Spread the scenes over the pacing target, reorder, tick, remove and restore.
    c.spreadSceneTimes(id)
    expect(c.prepView(id).items.filter((i) => i.kind === 'scene').map((i) => [i.targetStart, i.targetEnd])).toEqual([[0, 120], [120, 240]])
    c.movePrepItem(s1, 1)
    expect(c.prepView(id).items.filter((i) => i.kind === 'scene').map((i) => i.title)).toEqual(['Bell tower', 'Arrival'])
    c.setClock(600)
    c.setPrepDone(d1, true)
    expect(c.prepView(id).items.find((i) => i.id === d1)).toMatchObject({ done: true, doneAtMin: 600 })
    c.setPrepItemStatus(s1, 'defunct')
    expect(c.history().removedPrep).toEqual([{ id: s1, name: 'Arrival', what: 'scene' }])
    c.undo()
    expect(c.prepView(id).items.some((i) => i.id === s1)).toBe(true)
  })

  it('fills key NPCs and threats from their cards, and the DM can change it', () => {
    const id = c.createPrep(1)
    const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: at })
    c.updateEntity(npc.id, { attributes: { occupation: 'harbourmaster', faction: 'The Tide Guild', quirk: 'hums sea shanties' } })
    const ghoul = c.createEntity({ boardId: g, type: 'MONSTER', name: 'Ghoul', position: at })
    c.updateEntity(ghoul.id, { attributes: { statblock: { ...emptyStatBlock(), ac: '12', hp: '22', cr: '1' } } })
    const n = c.addPrepItem(id, 'npc', { entityId: npc.id })
    const t = c.addPrepItem(id, 'threat', { entityId: ghoul.id })
    const items = c.prepView(id).items
    expect(items.find((i) => i.id === n)).toMatchObject({ title: 'Ciaf Crol', role: 'harbourmaster, The Tide Guild', body: 'hums sea shanties', entityName: 'Ciaf Crol' })
    expect(items.find((i) => i.id === t)?.stats).toBe('CR 1 · HP 22 · AC 12')
    c.updatePrepItem(n, { role: 'secret cultist' })
    expect(c.prepView(id).items.find((i) => i.id === n)?.role).toBe('secret cultist')
  })

  it('moves a sheet to another session, but never onto one that has a sheet', () => {
    const a = c.createPrep(1)
    c.createPrep(2)
    expect(() => c.updatePrep(a, { number: 2 })).toThrow(/already has a prep sheet/)
    c.updatePrep(a, { number: 3 })
    expect(c.prepScreen().sheets.map((x) => x.number)).toEqual([2, 3])
    c.startSession() // session 1 now running: no sheet for it
    expect(c.prepFor()).toBeNull()
    expect(c.prepScreen()).toMatchObject({ openNumber: 1, nextNumber: 2 })
  })
})

describe('live: where they are, and the player preview', () => {
  function world() {
    const png = Buffer.alloc(24); png.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); png.writeUInt32BE(1000, 16); png.writeUInt32BE(800, 20)
    writeFileSync(join(dir, 'm.png'), png)
    const mapId = c.importMap(join(dir, 'm.png')).id
    c.setMapScale(mapId, 10, 3)
    const ford = c.createRegion({ mapId, polygon: sq(0, 0, 200), newName: "Miller's Ford" })
    const harbour = c.createRegion({ mapId, polygon: sq(600, 0, 200), newName: 'Old Harbour' })
    const tower = c.createRegion({ mapId, polygon: sq(600, 500, 200), newName: 'Bell Tower' })
    const regions = c.mapScreen(mapId).regions
    const loc = (id: string) => regions.find((r) => r.id === id)!.locationId
    const ciaf = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: at })
    const tom = c.createEntity({ boardId: g, type: 'NPC', name: 'Old Tom', position: at })
    const priest = c.createEntity({ boardId: g, type: 'NPC', name: 'Father Brine', position: at })
    for (const p of [ciaf, tom]) c.createRelationship({ sourceId: p.id, targetId: loc(harbour), type: 'LOCATED_AT', isSecret: false })
    const secret = c.createRelationship({ sourceId: ciaf.id, targetId: priest.id, type: 'ALLY', isSecret: true })
    c.updateEntity(loc(harbour), { attributes: { notes: 'DM: the cult meets under pier 3', player_notes: 'Fog-wet piers and a fish market' } })
    c.updateEntity(ciaf.id, { attributes: { motivation: 'Hide the cult', location: 'The harbour office' } })
    c.setClock(9 * 60)
    c.moveParty({ mapId, x: 100, y: 100, minutes: 0 })
    c.startSession()
    c.moveParty({ mapId, x: 700, y: 100, minutes: 120 })
    c.addLog({ kind: 'meeting', text: '', entityId: ciaf.id })
    c.setPartyKnows(ciaf.id, 'name', true)
    c.setPartyKnows(ciaf.id, 'location', true)
    const prep = c.prepFor()!.id
    const disc = c.addPrepItem(prep, 'discovery', { title: 'The bell is a summons', body: 'The drowned answer it.' })
    c.addPrepItem(prep, 'discovery', { title: 'Brine leads the cult' })
    c.addPrepItem(prep, 'clue', { body: 'A wet hymn book on the pier', locationId: loc(harbour), discoveryId: disc })
    c.addPrepItem(prep, 'scene', { title: 'Dockside ambush', locationId: loc(harbour), sceneType: 'combat' })
    c.addPrepItem(prep, 'npc', { entityId: tom.id })
    return { mapId, loc, harbour, tower, ciaf, tom, secret, disc, ford }
  }

  // createPrep happens through prepFor in world(): make sure there is a sheet for the running session.
  beforeEach(() => { c.createPrep(1) })

  it('tells the DM where they came from, who is here, what could come out and what is planned', () => {
    const w = world()
    c.setHeading(w.loc(w.tower))
    const where = c.liveWhere()
    expect(where.place).toMatchObject({ name: 'Old Harbour', regionId: w.harbour })
    expect(where.cameFrom?.name).toBe("Miller's Ford")
    expect(where.headingTo).toMatchObject({ name: 'Bell Tower', travel: 'about 1 h 40 min' })
    expect(where.people.map((p) => [p.name, p.met, p.keyNpc])).toEqual([['Old Tom', false, true], ['Ciaf Crol', true, false]])
    expect(where.secrets.map((x) => x.source)).toEqual(['string', 'clue'])
    expect(where.secrets[0].text).toBe('Ciaf Crol ally Father Brine')
    expect(where.secrets[1].text).toContain('leads to: The bell is a summons')
    expect(where.tips.join(' ')).toMatch(/came from Miller's Ford.*heading to Bell Tower.*met Ciaf Crol.*Not met yet: Old Tom.*2 secrets.*Planned here: Dockside ambush/)
    // Once the party knows the secret string, it is no longer a secret here.
    c.setStringKnown(w.secret.id, true)
    expect(c.liveWhere().secrets.map((x) => x.source)).toEqual(['clue'])
  })

  it('shows players only what they know', () => {
    const w = world()
    c.setHeading(w.loc(w.tower))
    let p = c.playersView()
    expect(p.place).toEqual({ name: 'Old Harbour', inside: null, notes: 'Fog-wet piers and a fish market' })
    expect(JSON.stringify(p)).not.toContain('cult meets') // DM notes stay hidden
    expect(JSON.stringify(p)).not.toContain('Hide the cult') // motivation not known
    expect(JSON.stringify(p)).not.toContain('Father Brine') // secret string not known
    expect(JSON.stringify(p)).not.toContain('Brine leads') // discovery not revealed
    expect(p.people).toEqual([{ id: w.ciaf.id, name: 'Ciaf Crol', type: 'NPC', facts: [{ label: 'Where', value: 'The harbour office' }] }])
    expect(p.headingTo).toBe('Bell Tower')
    expect(p.map?.view.regions.map((r) => r.name).sort()).toEqual(["Miller's Ford", 'Old Harbour']) // not the tower: never been
    expect(p.map?.notes[w.harbour]).toBe('Fog-wet piers and a fish market')
    c.setPrepDone(w.disc, true)
    c.setStringKnown(w.secret.id, true)
    p = c.playersView()
    expect(p.discoveries).toEqual([{ id: w.disc, title: 'The bell is a summons', text: 'The drowned answer it.', session: 1 }])
    expect(p.connections).toEqual(['Ciaf Crol ally Father Brine'])
  })

  it('builds the Ask AI request from the place, the route, the prep and the secrets', () => {
    const w = world()
    const where = c.liveWhere()
    const p = askPrompt(c.sceneContext(), {
      cameFrom: where.cameFrom?.name ?? null, headingTo: 'Bell Tower', secrets: where.secrets.map((x) => x.text), scenes: ['Dockside ambush']
    }, 'rumours', 'about the bell')
    expect(p).toContain('Where the party is: Old Harbour.')
    expect(p).toContain("They came from: Miller's Ford.")
    expect(p).toContain('They are heading to: Bell Tower.')
    expect(p).toContain('DM-only secrets here: Ciaf Crol ally Father Brine')
    expect(p).toMatch(/Request: Give four rumours.*The DM adds: about the bell/)
    expect(p).not.toContain('Describe the scene')
    expect(w.ford).toBeTruthy()
  })
})
