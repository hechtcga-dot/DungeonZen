import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { RecentCampaign } from '../shared/types'

// The DM profile lives outside campaign folders (docs/ARCHITECTURE.md §2).
// The API key will be stored separately with safeStorage, never in this file.

const Profile = z.object({
  recent: z.array(z.object({ folder: z.string(), name: z.string(), openedAt: z.string() })).default([])
})
type Profile = z.infer<typeof Profile>

const MAX_RECENT = 10

export class ProfileStore {
  private readonly file: string

  constructor(userDataDir: string) {
    this.file = join(userDataDir, 'profile.json')
  }

  private read(): Profile {
    try {
      return Profile.parse(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      return { recent: [] }
    }
  }

  private write(profile: Profile): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(profile, null, 2))
  }

  /** Recent campaigns whose folders still exist, newest first. */
  recent(): RecentCampaign[] {
    return this.read().recent.filter((r) => existsSync(join(r.folder, 'campaign.db')))
  }

  remember(folder: string, name: string): void {
    const profile = this.read()
    const rest = profile.recent.filter((r) => r.folder !== folder)
    profile.recent = [{ folder, name, openedAt: new Date().toISOString() }, ...rest].slice(0, MAX_RECENT)
    this.write(profile)
  }
}
