import { z } from 'zod'

/** Cards that get a token (Roll20): player characters, NPCs and monsters. */
export const TOKEN_TYPES = ['PC', 'NPC', 'MONSTER'] as const
export type TokenType = (typeof TOKEN_TYPES)[number]
export const isTokenType = (t: string): t is TokenType => (TOKEN_TYPES as readonly string[]).includes(t)

/** Borders, drawn in code (`src/renderer/token.ts`). Ember: the gold to fire red textured ring. */
export const TOKEN_BORDERS = ['ember', 'gold', 'silver', 'bronze', 'blood', 'iron', 'plain', 'none'] as const
export const TokenBorder = z.enum(TOKEN_BORDERS)
export type TokenBorder = z.infer<typeof TokenBorder>
export const TOKEN_BORDER_LABELS: Record<TokenBorder, string> = {
  ember: 'Ember (gold to red)', gold: 'Gold', silver: 'Silver', bronze: 'Bronze', blood: 'Blood red', iron: 'Iron', plain: 'Plain white', none: 'No border'
}

export const TOKEN_SIZE_MIN = 128
export const TOKEN_SIZE_MAX = 1024
export const TOKEN_WIDTH_MIN = 2
export const TOKEN_WIDTH_MAX = 15
const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/** One card's token: border, tint, background (null = matched to the picture), framing, size in pixels. */
export const TokenSpec = z.object({
  border: TokenBorder,
  tint: Hex.nullable(),
  bg: Hex.nullable(),
  fit: z.enum(['body', 'head']),
  /** Framing on top of the automatic fit: 1 and 0, 0 = as fitted; dx, dy in token widths. */
  zoom: z.number().min(0.2).max(5),
  dx: z.number().min(-2).max(2),
  dy: z.number().min(-2).max(2),
  size: z.number().int().min(TOKEN_SIZE_MIN).max(TOKEN_SIZE_MAX),
  /** Border thickness, % of the token's width. */
  width: z.number().min(TOKEN_WIDTH_MIN).max(TOKEN_WIDTH_MAX)
})
export type TokenSpec = z.infer<typeof TokenSpec>

/** `attributes.token` on a card: its own token (edited for this card only), or removed (in History). */
export const CardToken = TokenSpec.partial().extend({ removed: z.boolean().optional() })
export type CardToken = z.infer<typeof CardToken>

const TypeLook = z.object({ border: TokenBorder, tint: Hex.nullable() })
export const TokenSettings = z.object({
  /** What dragging a portrait out of the app gives (Roll20). */
  drag: z.enum(['token', 'picture']),
  size: z.number().int().min(TOKEN_SIZE_MIN).max(TOKEN_SIZE_MAX),
  width: z.number().min(TOKEN_WIDTH_MIN).max(TOKEN_WIDTH_MAX),
  types: z.object(Object.fromEntries(TOKEN_TYPES.map((t) => [t, TypeLook])) as Record<TokenType, typeof TypeLook>)
})
export type TokenSettings = z.infer<typeof TokenSettings>

export const DEFAULT_TOKEN_SETTINGS: TokenSettings = {
  drag: 'token',
  size: 512,
  width: 6,
  types: { PC: { border: 'ember', tint: null }, NPC: { border: 'silver', tint: null }, MONSTER: { border: 'blood', tint: null } }
}

/** Campaign setting as stored (anything missing or wrong falls back to the defaults). */
export function readTokenSettings(v: unknown): TokenSettings {
  const r = TokenSettings.partial().safeParse(v)
  const s = r.success ? r.data : {}
  return { ...DEFAULT_TOKEN_SETTINGS, ...s, types: { ...DEFAULT_TOKEN_SETTINGS.types, ...s.types } }
}

/** The token a card gets now: its own, else its type's default; null when it has none (other types, removed). */
export function tokenSpecFor(type: string, own: unknown, settings: TokenSettings): TokenSpec | null {
  if (!isTokenType(type)) return null
  const r = CardToken.safeParse(own ?? {})
  const mine = r.success ? r.data : {}
  if (mine.removed) return null
  const { removed: _, ...rest } = mine
  return { ...settings.types[type], bg: null, fit: 'body', zoom: 1, dx: 0, dy: 0, size: settings.size, width: settings.width, ...rest }
}

/** Raise when the drawing changes: every token file is made again. */
const RENDER_VERSION = 3

/** Short name of one token picture (picture + spec): files are `tokens/<card id>-<key>.png`. */
export function tokenKey(picture: string, spec: TokenSpec): string {
  const s = JSON.stringify([RENDER_VERSION, picture, spec.border, spec.tint, spec.bg, spec.fit, spec.zoom, spec.dx, spec.dy, spec.size, spec.width])
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
export const tokenPath = (entityId: string, key: string) => `tokens/${entityId}-${key}.png`
