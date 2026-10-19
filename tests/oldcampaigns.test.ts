import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { MIGRATIONS } from '../src/main/db/open'

// Campaigns made by the old releases' own code (tests/fixtures/campaign-<version>.db): an NPC and an inn,
// a known link and a secret link, a board note, a storyline with an act, a played session with one log line.
const VERSIONS = ['v1.0.0', 'v1.6.0', 'v2.0.0', 'v2.6.1', 'v2.10.1']

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dz-old-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function folderFrom(version: string): string {
  const folder = join(dir, version)
  mkdirSync(join(folder, 'assets'), { recursive: true })
  copyFileSync(join(__dirname, 'fixtures', `campaign-${version}.db`), join(folder, 'campaign.db'))
  return folder
}
const versionOf = (file: string) => {
  const db = new Database(file, { readonly: true })
  try { return db.pragma('user_version', { simple: true }) as number } finally { db.close() }
}

describe.each(VERSIONS)('a campaign from %s', (version) => {
  it('opens, upgrades and keeps its data', () => {
    const folder = folderFrom(version)
    const old = versionOf(join(folder, 'campaign.db'))
    const c = Campaign.open(folder)
    try {
      const info = c.info()
      expect(info.name).toBe('Old campaign')
      const view = c.boardView(info.globalBoardId)
      const names = Object.values(view.entities).map((e) => e.name).sort()
      expect(names).toEqual(['Barliman Butterbur', 'Prancing Pony'])
      const npc = Object.values(view.entities).find((e) => e.name === 'Barliman Butterbur')!
      expect(npc.attributes.summary).toBe('Forgetful innkeeper')
      expect(npc.tags).toEqual(['bree'])
      expect(c.sheet(npc.id).abilities.map((a) => a.name)).toEqual(['Club'])
      expect(view.relationships.map((s) => [s.type, s.isSecret]).sort()).toEqual([['hides a letter in', true], ['works at', false]])
      expect(view.items.some((i) => i.kind === 'note')).toBe(true)
      expect(c.timeline().storylines.map((s) => s.title)).toContain('The letter')
      // Still undoable after the upgrade: a new change, then undo.
      c.updateEntity(npc.id, { name: 'Barley' })
      c.log.undo()
      expect(c.boardView(info.globalBoardId).entities[npc.id].name).toBe('Barliman Butterbur')
    } finally { c.close() }
    expect(versionOf(join(folder, 'campaign.db'))).toBe(MIGRATIONS.length)
    // The copy made before an upgrade is the old campaign, untouched (a campaign already up to date gets none).
    if (old < MIGRATIONS.length) expect(versionOf(join(folder, `campaign.before-upgrade-${old}.bak`))).toBe(old)
  })
})

describe('upgrades', () => {
  it('a step that fails leaves the old campaign as it was', () => {
    const folder = folderFrom('v2.0.0')
    const file = join(folder, 'campaign.db')
    const db = new Database(file)
    // The last step adds this column; adding it first makes that step fail after the earlier ones ran.
    db.exec('ALTER TABLE session_prep ADD COLUMN play_date TEXT')
    db.close()
    expect(() => Campaign.open(folder)).toThrow(/play_date/)
    expect(versionOf(file)).toBe(21)
    const after = new Database(file, { readonly: true })
    const mapColumns = (after.pragma('table_info(map)') as Array<{ name: string }>).map((c) => c.name)
    after.close()
    expect(mapColumns).not.toContain('scale_key') // an earlier step of the same upgrade was rolled back too
  })

  it('a campaign from a newer version is refused, not changed', () => {
    const folder = folderFrom('v2.6.1')
    const file = join(folder, 'campaign.db')
    const db = new Database(file)
    db.pragma(`user_version = ${MIGRATIONS.length + 1}`)
    db.close()
    expect(() => Campaign.open(folder)).toThrow(/newer version of Dungeon Zen/)
    expect(versionOf(file)).toBe(MIGRATIONS.length + 1)
  })

  it('a new campaign and an up-to-date one get no copy', () => {
    const folder = join(dir, 'New')
    Campaign.create(folder, 'New').close()
    Campaign.open(folder).close()
    expect(readdirSync(folder).filter((f) => f.endsWith('.bak'))).toEqual([])
  })
})
