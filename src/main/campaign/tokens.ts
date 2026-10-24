import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { entity } from '../db/schema'
import type { TokenView } from '../../shared/types'
import { CardToken, isTokenType, type TokenSpec, readTokenSettings, tokenKey, tokenPath, tokenSpecFor, type TokenSettings } from '../../shared/token'
import { part } from './part'
import { ASSETS_DIR, ASSET_URL_PREFIX } from './common'

/**
 * Tokens for Roll20 (PC, NPC and monster cards with a picture). A token is its card's picture plus a look
 * (`attributes.token`, else the card type's default from the token settings); the PNG is drawn in the window
 * (`src/renderer/token.ts`) and kept in assets/tokens, named by picture and look, so any change makes a new file.
 */
export const tokensPart = part({
  tokenSettings(): TokenSettings {
    return readTokenSettings(this.setting('token_settings'))
  },

  /** Every card that has a token now, by name; removed ones (in History) are left out. */
  tokens(): TokenView[] {
    const settings = this.tokenSettings()
    return this.db.select().from(entity).all()
      .filter((e) => e.status !== 'defunct' && isTokenType(e.type) && typeof e.attributes.picture === 'string')
      .flatMap((e) => {
        const spec = tokenSpecFor(e.type, e.attributes.token, settings)
        if (!spec) return []
        const picture = e.attributes.picture as string
        const path = tokenPath(e.id, tokenKey(picture, spec))
        const own = CardToken.safeParse(e.attributes.token)
        return [{
          entityId: e.id, name: e.name, type: e.type, picture, spec, key: tokenKey(picture, spec),
          own: own.success && Object.keys(own.data).some((k) => k !== 'removed'),
          url: ASSET_URL_PREFIX + path, exists: existsSync(join(this.folder, ASSETS_DIR, path))
        }]
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  /** The token file of a card, when it has one drawn for its current picture and look. */
  tokenFile(entityId: string): string | null {
    const t = this.tokens().find((x) => x.entityId === entityId)
    return t?.exists ? join(this.folder, ASSETS_DIR, ...tokenPath(t.entityId, t.key).split('/')) : null
  },

  /** Keeps a drawn token (a file, not a change: the look is on the card). Only the card's current one. */
  writeToken(entityId: string, key: string, pngBase64: string): void {
    const t = this.tokens().find((x) => x.entityId === entityId)
    if (!t || t.key !== key) return // the card changed meanwhile: the next drawing brings the right one
    const file = join(this.folder, ASSETS_DIR, ...tokenPath(entityId, key).split('/'))
    if (existsSync(file)) return
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, Buffer.from(pngBase64, 'base64'))
  },

  /** A card's own token look, for this card only (null = back to its type's default). One undo step. */
  setToken(entityId: string, spec: TokenSpec | null): void {
    const e = this.entityRow(entityId)
    const { token: _, ...rest } = e.attributes
    this.log.run(spec ? `Changed the token of ${e.name}` : `Reset the token of ${e.name}`, (w) => {
      w.update('entity', entityId, { attributes: spec ? { ...rest, token: spec } : rest })
    })
  },

  /** Removes a card's token to History (its look is kept) or brings it back. One undo step. */
  setTokenRemoved(entityId: string, removed: boolean): void {
    const e = this.entityRow(entityId)
    const own = CardToken.safeParse(e.attributes.token).data ?? {}
    const { removed: _, ...look } = own
    const { token: __, ...rest } = e.attributes
    const token = removed ? { ...look, removed: true } : look
    this.log.run(`${removed ? 'Removed' : 'Restored'} the token of ${e.name}`, (w) => {
      w.update('entity', entityId, { attributes: Object.keys(token).length ? { ...rest, token } : rest })
    })
  },

  /** Cards whose token is in History. */
  removedTokens(): Array<{ id: string; name: string }> {
    return this.db.select().from(entity).all()
      .filter((e) => e.status !== 'defunct' && CardToken.safeParse(e.attributes.token).data?.removed)
      .map((e) => ({ id: e.id, name: e.name }))
  }
})
