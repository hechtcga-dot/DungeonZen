import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { RecentCampaign } from '../shared/types'
import { providerById, type AiChoice, type AiKind } from '../shared/aiProviders'

// The DM profile lives outside campaign folders (docs/ARCHITECTURE.md §2).
// API keys are stored separately with safeStorage (ai/keys.ts), never in this file.

const ProviderPrefs = z.object({ model: z.string().optional(), baseUrl: z.string().optional() })
const Profile = z.object({
  recent: z.array(z.object({ folder: z.string(), name: z.string(), openedAt: z.string() })).default([]),
  ai: z.object({
    text: z.string().nullable().default(null),
    image: z.string().nullable().default(null),
    /** Model and address per service, so switching back keeps what the DM chose. */
    providers: z.record(z.string(), ProviderPrefs).default({})
  }).default({ text: null, image: null, providers: {} })
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
      return Profile.parse({})
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

  /** The service chosen for a kind of work, with its model and address. */
  aiChoice(kind: AiKind): AiChoice {
    const ai = this.read().ai
    const id = ai[kind]
    const info = id ? providerById(id) : undefined
    if (!id || !info) return { provider: null, model: '', baseUrl: '' }
    const prefs = ai.providers[id] ?? {}
    return { provider: id, model: prefs.model || info.defaultModel, baseUrl: (info.editableUrl && prefs.baseUrl) || info.baseUrl }
  }

  providerPrefs(id: string): { model?: string; baseUrl?: string } {
    return this.read().ai.providers[id] ?? {}
  }

  setAiChoice(kind: AiKind, provider: string | null, prefs?: { model?: string; baseUrl?: string }): void {
    const profile = this.read()
    profile.ai[kind] = provider
    if (provider && prefs) profile.ai.providers[provider] = { ...profile.ai.providers[provider], ...prefs }
    this.write(profile)
  }

  remember(folder: string, name: string): void {
    const profile = this.read()
    const rest = profile.recent.filter((r) => r.folder !== folder)
    profile.recent = [{ folder, name, openedAt: new Date().toISOString() }, ...rest].slice(0, MAX_RECENT)
    this.write(profile)
  }
}
