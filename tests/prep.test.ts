import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
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

  it('fills NPCs from their cards (what they want, how to play them), and the DM can change it', () => {
    const id = c.createPrep(1)
    const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: at })
    c.updateEntity(npc.id, { attributes: { motivation: 'the party gone', quirk: 'hums sea shanties' } })
    const n = c.addPrepItem(id, 'npc', { entityId: npc.id })
    expect(c.prepView(id).items.find((i) => i.id === n)).toMatchObject({ title: 'Ciaf Crol', role: 'the party gone', body: 'hums sea shanties', entityName: 'Ciaf Crol' })
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
    c.addPrepItem(prep, 'discovery', { body: 'A wet hymn book on the pier', locationId: loc(harbour) })
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
    expect(where.secrets[1].text).toBe('A wet hymn book on the pier')
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

describe('one-page DM tool (1.7.0)', () => {
  it('merges old clues into the secrets and moves old threats into the sheet notes', async () => {
    const Database = (await import('better-sqlite3')).default
    const { MIGRATIONS, migrate } = await import('../src/main/db/open')
    const db = new Database(':memory:')
    // Up to just before the 1.7.0 migration (the one that moves clues and threats).
    const at = MIGRATIONS.findIndex((m) => m.includes("WHERE kind = 'threat'"))
    for (const m of MIGRATIONS.slice(0, at)) db.exec(m)
    db.pragma(`user_version = ${at}`)
    db.prepare("INSERT INTO session_prep (id, number, title, premise, pacing_minutes, backup_names, notes, status) VALUES ('p', 1, '', '', 180, '', 'Bring rope', 'active')").run()
    const item = db.prepare("INSERT INTO prep_item (id, prep_id, kind, sort, title, body, stats, tactics, status) VALUES (?, 'p', ?, ?, ?, ?, ?, ?, 'active')")
    item.run('d', 'discovery', 1, 'The ringer', '', '', '')
    item.run('c', 'clue', 1, '', 'Wet footprints', '', '')
    item.run('t', 'threat', 1, 'Ghoul', 'Claws', 'CR 1', 'Flees at half HP')
    migrate(db)
    const rows = db.prepare('SELECT id, kind, status FROM prep_item ORDER BY sort').all()
    expect(rows).toEqual([{ id: 'd', kind: 'discovery', status: 'active' }, { id: 't', kind: 'threat', status: 'defunct' }, { id: 'c', kind: 'discovery', status: 'active' }])
    expect((db.prepare('SELECT notes FROM session_prep').get() as { notes: string }).notes)
      .toBe('Bring rope\n\nThreats (from the old sheet):\nGhoul (CR 1): Claws. Tactics: Flees at half HP')
    db.close()
  })

  it('brings loose threads from last session, makes cards from world bible lines, and saves the sheet as a notes file', async () => {
    const one = c.createPrep(1)
    c.updatePrep(one, { wantNext: 'Track the smuggler\nFind who hired him' })
    c.addPrepItem(one, 'thread', { body: 'The abandoned mine' })
    const done = c.addPrepItem(one, 'thread', { body: 'The letter' })
    c.setPrepDone(done, true)
    const two = c.createPrep(2)
    expect(c.bringThreads(two)).toBe(3)
    expect(c.prepView(two).items.filter((i) => i.kind === 'thread').map((i) => i.body)).toEqual(['Track the smuggler', 'Find who hired him', 'The abandoned mine'])
    expect(c.bringThreads(two)).toBe(0) // nothing twice
    c.undo()
    expect(c.prepView(two).items.filter((i) => i.kind === 'thread')).toHaveLength(0)

    const line = c.addPrepItem(two, 'bible', { body: 'Pell — the dockworker, 20 years at the harbour' })
    const card = c.cardFromPrepLine(line, 'NPC')
    expect(c.entityView(card)).toMatchObject({ name: 'Pell', type: 'NPC', attributes: { bio: 'Pell — the dockworker, 20 years at the harbour' } })
    expect(c.prepView(two).items.find((i) => i.id === line)?.entityId).toBe(card)
    c.undo() // one step: card and link
    expect(c.prepView(two).items.find((i) => i.id === line)?.entityId).toBeNull()

    const { prepBlocks } = await import('../src/shared/prepDoc')
    const { writeDocx } = await import('../src/main/importers/docx')
    c.updatePrep(two, { title: 'Smugglers', premise: 'A trusted ally is bleeding in the street.' })
    const blocks = prepBlocks(c.prepView(two))
    expect(blocks.filter((b) => b.kind === 'h2').map((b) => b.kind !== 'table' && b.runs[0].text).slice(0, 7))
      .toEqual(['1. Session opening', '2. Likely scenes', '3. Secrets & clues', '4. NPCs', '5. Loose threads', '6. Session recap', '7. World bible updates'])
    const doc = c.savePrepNote(two, 'Session 2 - Smugglers', writeDocx(blocks))
    expect(c.prepView(two).noteDocId).toBe(doc)
    expect(c.savePrepNote(two, 'Session 2 - The Smugglers', writeDocx(blocks))).toBe(doc) // same file, a new version
    expect(c.notesScreen().docs).toMatchObject([{ id: doc, title: 'Session 2 - The Smugglers', versions: [{}] }])
  })

  it('"What happened" is the session recap', () => {
    const p = c.createPrep(1)
    expect(c.prepView(p).session).toBeNull()
    const s = c.startSession()
    c.updateSession(s.id, { recap: 'They let the smuggler escape.' })
    expect(c.prepView(p).session).toEqual({ id: s.id, recap: 'They let the smuggler escape.' })
  })
})

describe('prep secrets tied to the board', () => {
  it('a secret is one text and its connections, shared by prep sheet, strings and Links', () => {
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'Golden Chantrelle', position: at })
    const b = c.createEntity({ boardId: g, type: 'FACTION', name: 'VanGuard', position: at })
    const m = c.createEntity({ boardId: g, type: 'MONSTER', name: 'Oceanus', position: at })
    const p = c.createPrep(1)
    const d = c.addPrepSecret(p, 'secret')
    const sid = c.prepView(p).items[0].secretId!
    c.saveSecret({ id: sid, kind: 'secret', text: 'She sold them the gate codes.', connections: [
      { sourceId: a.id, targetId: b.id, type: 'KNOWS' }, { sourceId: b.id, targetId: m.id, type: 'KNOWS' }] })
    const rels = c.boardView(g).relationships
    expect(rels).toHaveLength(2)
    expect(rels.every((r) => r.isSecret && r.secretKind === 'secret' && r.description === 'She sold them the gate codes.')).toBe(true)
    expect(c.prepView(p).items[0].body).toBe('She sold them the gate codes.')
    // Edit on a string (Links): the secret and the prep line follow.
    c.updateRelationship(rels[0].id, { description: 'She sold them the keys.' })
    expect(c.prepView(p).items[0].body).toBe('She sold them the keys.')
    expect(c.boardView(g).relationships.map((r) => r.description)).toEqual(['She sold them the keys.', 'She sold them the keys.'])
    // Edit on the prep line: the secret follows.
    c.updatePrepItem(d, { body: 'Only the west gate key.' })
    expect(c.secretViews()[0].text).toBe('Only the west gate key.')
    c.undo()
    expect(c.secretViews()[0].text).toBe('She sold them the keys.')
    // Dropping a connection sends its string to History.
    const v = c.secretViews()[0]
    c.saveSecret({ id: v.id, kind: 'clue', text: v.text, connections: [v.connections[0]] })
    expect(c.boardView(g).relationships).toHaveLength(1)
    expect(c.boardView(g).relationships[0].secretKind).toBe('clue')
  })

  it('a secret string tied on the board is a secret too', () => {
    const a = c.createEntity({ boardId: g, type: 'NPC', name: 'Hodge', position: at })
    const b = c.createEntity({ boardId: g, type: 'NPC', name: 'Luna', position: at })
    c.createRelationship({ sourceId: a.id, targetId: b.id, type: 'KNOWS', isSecret: true })
    expect(c.secretViews()).toMatchObject([{ kind: 'secret', label: 'Hodge knows Luna' }])
  })

  it('shares one text with a Clue card description, and keeps words linked to cards', () => {
    const clue = c.createEntity({ boardId: g, type: 'CLUE', name: 'Torn ledger', position: at })
    c.updateEntity(clue.id, { attributes: { description: 'Pages about the tithe are missing.' } })
    const p = c.createPrep(1)
    const d = c.addPrepItem(p, 'discovery', {})
    c.updatePrepItem(d, { entityId: clue.id }) // the board has text: the secret takes it
    expect(c.prepView(p).items[0].body).toBe('Pages about the tithe are missing.')
    c.updatePrepItem(d, { body: 'Two pages are missing.' })
    expect(c.boardView(g).entities[clue.id].attributes.description).toBe('Two pages are missing.')
    c.updatePrep(p, { links: [{ text: 'ledger', entityId: clue.id }] })
    expect(c.prepView(p).links).toEqual([{ text: 'ledger', entityId: clue.id }])
  })
})

describe('prep NPCs tied to cards', () => {
  it('makes a card from the NPC and shares name, description and motivation both ways', () => {
    const p = c.createPrep(1)
    const n = c.addPrepItem(p, 'npc', { title: 'Sherman', role: 'to sell the map twice' })
    c.updatePrepItem(n, { description: 'Nervous cartographer', body: 'Stammers' })
    const id = c.cardFromPrepLine(n, 'NPC')
    expect(c.boardView(g).entities[id]).toMatchObject({ name: 'Sherman', attributes: { summary: 'Nervous cartographer', motivation: 'to sell the map twice' } })
    c.updatePrepItem(n, { role: 'to leave town', title: 'Sherman Vole' })
    expect(c.boardView(g).entities[id]).toMatchObject({ name: 'Sherman Vole', attributes: { motivation: 'to leave town' } })
    c.updateEntity(id, { attributes: { summary: 'Retired cartographer' } })
    expect(c.prepView(p).items[0]).toMatchObject({ description: 'Retired cartographer', title: 'Sherman Vole', entityId: id })
    c.undo()
    expect(c.prepView(p).items[0].description).toBe('Nervous cartographer')
  })

  it('picking a card takes its text, keeping the NPC text where the card has none', () => {
    const card = c.createEntity({ boardId: g, type: 'NPC', name: 'Mara Venn', position: at })
    c.updateEntity(card.id, { attributes: { summary: 'Harbour clerk' } })
    const p = c.createPrep(1)
    const n = c.addPrepItem(p, 'npc', { title: 'Mara', role: 'quiet life' })
    c.updatePrepItem(n, { entityId: card.id })
    expect(c.prepView(p).items[0]).toMatchObject({ title: 'Mara Venn', description: 'Harbour clerk', role: 'quiet life' })
    c.updatePrepItem(n, { role: 'quiet life' }) // no change: nothing written
    c.updatePrepItem(n, { role: 'a quiet life' })
    expect(c.boardView(g).entities[card.id].attributes.motivation).toBe('a quiet life')
  })
})
