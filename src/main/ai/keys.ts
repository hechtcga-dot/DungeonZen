import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Encryption from the operating system (Electron safeStorage); swapped for a fake in tests. */
export interface Encryptor {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(encrypted: Buffer): string
}

/**
 * API keys, one per AI service, encrypted with the operating system's key store
 * (Windows: DPAPI) in the DM profile folder. Never in a campaign folder or database (rule 7).
 */
export class KeyStore {
  private readonly file: string

  constructor(userDataDir: string, private readonly crypto: Encryptor) {
    this.file = join(userDataDir, 'ai-keys.json')
  }

  private read(): Record<string, string> {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {}
    } catch {
      return {}
    }
  }

  private write(all: Record<string, string>): void {
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(this.file, JSON.stringify(all, null, 2))
  }

  has(provider: string): boolean {
    return provider in this.read()
  }

  /** Providers that have a key saved. */
  saved(): string[] {
    return Object.keys(this.read())
  }

  get(provider: string): string | null {
    const enc = this.read()[provider]
    if (!enc) return null
    try {
      return this.crypto.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return null // saved on another computer or Windows account: the DM enters it again
    }
  }

  set(provider: string, key: string): void {
    if (!this.crypto.isEncryptionAvailable()) {
      throw new Error('This computer cannot encrypt the key, so it was not saved.')
    }
    const all = this.read()
    all[provider] = this.crypto.encryptString(key.trim()).toString('base64')
    this.write(all)
  }

  remove(provider: string): void {
    const all = this.read()
    delete all[provider]
    this.write(all)
  }
}
