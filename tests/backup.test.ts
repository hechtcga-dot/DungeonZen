import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

let dir: string
let c: Campaign
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dungeonzen-'))
  c = Campaign.create(join(dir, 'Test campaign'), 'Test campaign')
})
afterEach(() => { c.close(); rmSync(dir, { recursive: true, force: true }) })

describe('backups', () => {
  it('copies the campaign into backups/ without copying the backups', () => {
    const first = c.backup()
    expect(existsSync(join(first, 'campaign.db'))).toBe(true)
    const second = c.backup()
    expect(second).not.toBe(first)
    expect(existsSync(join(second, 'backups'))).toBe(false)
    expect(c.backups()).toHaveLength(2)
  })
  it('copies the pictures in the background', async () => {
    mkdirSync(join(c.folder, 'assets', 'styles'), { recursive: true })
    writeFileSync(join(c.folder, 'assets', 'styles', 'a.png'), 'png')
    const b = c.backup()
    await c.backupDone
    expect(existsSync(join(b, 'assets', 'styles', 'a.png'))).toBe(true)
  })
  it('keeps the newest ones and makes one a day', async () => {
    for (let i = 0; i < 4; i++) { c.backup(3); await c.backupDone }
    expect(c.backups()).toHaveLength(3)
    expect(c.backupIfDue()).toBeNull()
  })
  it('goes to a folder the DM chose', () => {
    c.setSetting('backup_folder', join(dir, 'elsewhere'), 'test')
    expect(c.backup()).toContain(join(dir, 'elsewhere'))
  })
})
