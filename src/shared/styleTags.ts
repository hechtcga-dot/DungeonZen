import { z } from 'zod'

// What a style example picture looks like, in words the image AI understands (owner, 2026-10-12).
// The AI reads them from the picture on request (the DM keeps or edits them); every Draw window
// blends the tags of the ticked pictures into the prompt.

export const STYLE_TAG_FIELDS = [
  { key: 'artist', label: 'Artist or school', example: 'Arthur Rackham; vintage Scandinavian illustrators' },
  { key: 'period', label: 'Period', example: 'golden age of illustration, 1900s' },
  { key: 'medium', label: 'Medium and technique', example: 'fine pen and ink cross-hatching, watercolour wash' },
  { key: 'palette', label: 'Palette', example: 'sepia and olive green, muted earth tones' },
  { key: 'light', label: 'Light', example: 'dramatic light and shadow' },
  { key: 'detail', label: 'Textures and details', example: 'textured bark, gnarled roots' },
  { key: 'composition', label: 'Composition', example: 'asymmetric, rule of thirds, detailed foreground' }
] as const

export type StyleTagKey = (typeof STYLE_TAG_FIELDS)[number]['key']
export type StyleTags = Partial<Record<StyleTagKey, string>>

export const StyleTagsSchema = z.object(
  Object.fromEntries(STYLE_TAG_FIELDS.map((f) => [f.key, z.string().max(300).optional()])) as Record<StyleTagKey, z.ZodOptional<z.ZodString>>
)

export const DEFAULT_COMPOSITION =
  'asymmetric, rule-of-thirds composition: the subject off-centre, crisp specific detail in the foreground, the background pulled back into soft atmospheric depth'

/** Every ticked picture's tags in one set: per field, the different values in order, joined with "; ". */
export function blendTags(list: StyleTags[]): StyleTags {
  const out: StyleTags = {}
  for (const f of STYLE_TAG_FIELDS) {
    const seen = new Map<string, string>()
    for (const t of list) {
      for (const part of (t[f.key] ?? '').split(';')) {
        const v = part.trim()
        if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v)
      }
    }
    if (seen.size) out[f.key] = [...seen.values()].join('; ')
  }
  return out
}

/**
 * Prompt lines for the art: style (artist, period), medium, palette, light, details, composition
 * (`composition: null` leaves it out, e.g. for maps), then the campaign's art style in words.
 * `fallback` is used when nothing at all describes the style.
 */
export function styleLines(tags: StyleTags, artStyle: string, opts: { composition?: string | null; fallback?: string } = {}): string[] {
  const who = [tags.artist && `in the manner of ${tags.artist}`, tags.period].filter(Boolean).join(', ')
  const lines = [
    who && `Style: ${who}.`,
    tags.medium && `Medium: ${tags.medium}.`,
    tags.palette && `Palette: ${tags.palette}.`,
    tags.light && `Light: ${tags.light}.`,
    tags.detail && `Textures and details: ${tags.detail}.`,
    artStyle.trim() && `Art style: ${artStyle.trim()}`
  ].filter((x): x is string => !!x)
  if (lines.length === 0 && opts.fallback) lines.push(opts.fallback)
  if (opts.composition !== null) {
    const c = tags.composition || opts.composition
    if (c) lines.push(`Composition: ${c}.`)
  }
  return lines
}

/** Reads the AI's reply: the known fields as short strings, nothing else. */
export function parseStyleTags(reply: string): StyleTags {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The AI did not answer with style tags')
  const raw = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>
  const out: StyleTags = {}
  for (const f of STYLE_TAG_FIELDS) {
    const v = raw[f.key]
    const s = Array.isArray(v) ? v.map(String).join(', ') : typeof v === 'string' ? v : ''
    if (s.trim()) out[f.key] = s.trim().slice(0, 300)
  }
  return out
}

export const STYLE_TAGS_SYSTEM = [
  'You are an art historian helping an image AI copy the look of a picture.',
  'Look at the picture and describe its art style, not its subject.',
  'Reply with JSON only: {"artist": "...", "period": "...", "medium": "...", "palette": "...", "light": "...", "detail": "...", "composition": "..."}.',
  'artist: the artist the style most resembles, or the school or tradition (e.g. "Arthur Rackham", "vintage Scandinavian fairy-tale illustrators"); name a historical artist only when the resemblance is strong.',
  'period: era and movement. medium: materials and technique (e.g. "fine pen and ink cross-hatching, sepia watercolour wash").',
  'palette: the main colours. light: how light and shadow fall. detail: textures and surface details worth copying.',
  'composition: how the picture is framed (e.g. "asymmetric, rule of thirds, detailed foreground, hazy background").',
  'Short phrases, each under 25 words. Leave a field empty ("") when unsure.'
].join(' ')

// Card picture Draw window › Advanced composition (owner, 2026-10-14): each line of the prompt in its own
// box, prefilled from the card and the ticked examples; edits are for this drawing only. The style lines
// (all but the description) can be saved as a named template.
export const ADVANCED_FIELDS = [
  { key: 'description', label: 'Description (what is it like)', example: 'an orange tabby in a feathered hat and boots' },
  { key: 'style', label: 'Style', example: 'in the manner of Arthur Rackham, 1900s' },
  { key: 'medium', label: 'Medium', example: 'watercolour washes with fine ink line work' },
  { key: 'palette', label: 'Palette', example: 'golden ochre, soft mauve, earthy browns' },
  { key: 'light', label: 'Light', example: 'soft diffused daylight' },
  { key: 'detail', label: 'Textures and details', example: 'stippled foliage, fine linear striations' },
  { key: 'composition', label: 'Composition', example: 'pyramid: the subject forms a stable triangle' },
  { key: 'other', label: 'Other details', example: 'the character is in the left foreground, a tower stands in the centre of the picture, a small flock of birds is in the right top distance' }
] as const

export type AdvancedKey = (typeof ADVANCED_FIELDS)[number]['key']
export type Advanced = Partial<Record<AdvancedKey, string>>
export const TEMPLATE_FIELDS = ADVANCED_FIELDS.filter((f) => f.key !== 'description')

export const PromptTemplateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  fields: z.object(Object.fromEntries(TEMPLATE_FIELDS.map((f) => [f.key, z.string().max(1000).optional()])) as Record<Exclude<AdvancedKey, 'description'>, z.ZodOptional<z.ZodString>>)
})
export type PromptTemplate = z.infer<typeof PromptTemplateSchema> & { status?: string }

/** The boxes' starting values: the ticked pictures' tags, the chosen composition (no description: that comes from the card). */
export function advancedFromTags(tags: StyleTags, composition: string, artStyle: string): Advanced {
  const who = [tags.artist && `in the manner of ${tags.artist}`, tags.period].filter(Boolean).join(', ')
  const any = who || tags.medium || tags.palette || tags.light || tags.detail || artStyle.trim()
  return {
    style: who || (any ? '' : 'classic fantasy book illustration'),
    medium: tags.medium ?? '', palette: tags.palette ?? '', light: tags.light ?? '', detail: tags.detail ?? '', composition, other: ''
  }
}

/** Prompt lines for the style boxes, then the campaign's art style in words. */
export function advancedLines(a: Advanced, artStyle: string): string[] {
  const line = (label: string, v?: string) => (v?.trim() ? `${label}: ${v.trim().replace(/[.\s]+$/, '')}.` : '')
  const comp = [a.composition, a.other].map((v) => v?.trim().replace(/[.\s]+$/, '')).filter(Boolean).join('. ')
  return [
    line('Style', a.style), line('Medium', a.medium), line('Palette', a.palette), line('Light', a.light), line('Textures and details', a.detail),
    artStyle.trim() && `Art style: ${artStyle.trim()}`, line('Composition', comp)
  ].filter((x): x is string => !!x)
}
