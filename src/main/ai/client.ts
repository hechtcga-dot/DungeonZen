import { providerById, type AiChoice, type AiProviderInfo } from '../../shared/aiProviders'
import type { Aspect } from '../../shared/battlemap'

// Talks to the chosen AI service. Main process only. One adapter per protocol;
// every service in shared/aiProviders.ts maps to one of them.

export type Fetch = typeof fetch

export interface TextRequest {
  system: string
  prompt: string
  maxTokens?: number
}

export interface ImageRequest {
  prompt: string
  /** Example images for the style (PNG/JPEG bytes). Ignored by services that cannot take them. */
  references?: Array<{ bytes: Buffer; mime: string }>
  /** Shape of the image (from the grid size); square by default. */
  aspect?: Aspect
}

export interface ImageResult { bytes: Buffer; mime: string }

export interface Resolved {
  info: AiProviderInfo
  model: string
  baseUrl: string
  key: string | null
}

export class AiError extends Error {}

const TEXT_TIMEOUT = 90_000
const IMAGE_TIMEOUT = 240_000

export function resolve(choice: AiChoice, key: string | null): Resolved {
  const info = choice.provider ? providerById(choice.provider) : undefined
  if (!info) throw new AiError('No AI service is chosen. Open Settings › AI services.')
  if (info.needsKey && !key) throw new AiError(`${info.name} needs an API key. Add it in Settings › AI services.`)
  const model = choice.model.trim()
  if (!model && info.protocol !== 'sd-webui') throw new AiError(`Choose a model for ${info.name} in Settings › AI services.`)
  const baseUrl = choice.baseUrl.replace(/\/+$/, '')
  if (!/^https?:\/\/[^/]+/.test(baseUrl)) throw new AiError(`The address for ${info.name} is not a web address.`)
  return { info, model, baseUrl, key }
}

// ---------------------------------------------------------------- text

export async function generateText(r: Resolved, req: TextRequest, f: Fetch = fetch): Promise<string> {
  const max = req.maxTokens ?? 1200
  switch (r.info.protocol) {
    case 'anthropic': {
      const body = await call(r, f, `${r.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: anthropicHeaders(r),
        body: JSON.stringify({ model: r.model, max_tokens: max, system: req.system, messages: [{ role: 'user', content: req.prompt }] })
      }, TEXT_TIMEOUT)
      return textOf((body.content as Array<{ type: string; text?: string }> | undefined)?.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(''), r)
    }
    case 'openai': {
      // OpenAI's newer models take max_completion_tokens; other compatible services take max_tokens.
      const limit = r.info.id === 'openai' ? { max_completion_tokens: Math.max(max, 4000) } : { max_tokens: max }
      const body = await call(r, f, `${r.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: bearer(r, { 'Content-Type': 'application/json', ...(r.info.id === 'openrouter' ? { 'X-Title': 'Dungeon Zen' } : {}) }),
        body: JSON.stringify({ model: r.model, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.prompt }], ...limit })
      }, TEXT_TIMEOUT)
      const choices = body.choices as Array<{ message?: { content?: string | null } }> | undefined
      return textOf(choices?.[0]?.message?.content, r)
    }
    case 'gemini': {
      const body = await call(r, f, `${r.baseUrl}/models/${encodeURIComponent(r.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': r.key ?? '' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.prompt }] }]
        })
      }, TEXT_TIMEOUT)
      return textOf(geminiParts(body).map((p) => p.text ?? '').join(''), r)
    }
    default:
      throw new AiError(`${r.info.name} draws images; choose a writing service for text.`)
  }
}

// ---------------------------------------------------------------- images

export async function generateImage(r: Resolved, req: ImageRequest, f: Fetch = fetch): Promise<ImageResult> {
  const refs = req.references ?? []
  const aspect = req.aspect ?? '1:1'
  switch (r.info.protocol) {
    case 'openai-image': {
      const size = aspect === '1:1' ? '1024x1024' : landscape(aspect) ? '1536x1024' : '1024x1536'
      if (refs.length) {
        const form = new FormData()
        form.append('model', r.model)
        form.append('prompt', req.prompt)
        form.append('size', size)
        refs.forEach((ref, i) => form.append('image[]', new Blob([new Uint8Array(ref.bytes)], { type: ref.mime }), `example-${i + 1}.${ext(ref.mime)}`))
        const body = await call(r, f, `${r.baseUrl}/images/edits`, { method: 'POST', headers: bearer(r, {}), body: form }, IMAGE_TIMEOUT)
        return b64Image((body.data as Array<{ b64_json?: string }> | undefined)?.[0]?.b64_json, r)
      }
      const body = await call(r, f, `${r.baseUrl}/images/generations`, {
        method: 'POST', headers: bearer(r, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ model: r.model, prompt: req.prompt, size, n: 1 })
      }, IMAGE_TIMEOUT)
      return b64Image((body.data as Array<{ b64_json?: string }> | undefined)?.[0]?.b64_json, r)
    }
    case 'gemini-image': {
      const parts: unknown[] = [{ text: `${req.prompt}\nAspect ratio ${aspect}.` }]
      for (const ref of refs) parts.push({ inlineData: { mimeType: ref.mime, data: ref.bytes.toString('base64') } })
      const body = await call(r, f, `${r.baseUrl}/models/${encodeURIComponent(r.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': r.key ?? '' },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['TEXT', 'IMAGE'] } })
      }, IMAGE_TIMEOUT)
      const img = geminiParts(body).find((p) => p.inlineData?.data)
      return b64Image(img?.inlineData?.data, r, img?.inlineData?.mimeType)
    }
    case 'stability': {
      const form = new FormData()
      form.append('prompt', req.prompt)
      form.append('output_format', 'png')
      let path: string
      if (refs.length) {
        // Style guide: copies the look of the first example map.
        path = '/v2beta/stable-image/control/style'
        form.append('image', new Blob([new Uint8Array(refs[0].bytes)], { type: refs[0].mime }), `example.${ext(refs[0].mime)}`)
        form.append('aspect_ratio', aspect)
      } else {
        form.append('aspect_ratio', aspect)
        if (r.model.startsWith('sd3')) { path = '/v2beta/stable-image/generate/sd3'; form.append('model', r.model) }
        else path = `/v2beta/stable-image/generate/${r.model === 'ultra' ? 'ultra' : 'core'}`
      }
      const res = await send(r, f, `${r.baseUrl}${path}`, { method: 'POST', headers: bearer(r, { Accept: 'image/*' }), body: form }, IMAGE_TIMEOUT)
      return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? 'image/png' }
    }
    case 'replicate': {
      const body = await call(r, f, `${r.baseUrl}/models/${r.model}/predictions`, {
        method: 'POST', headers: bearer(r, { 'Content-Type': 'application/json', Prefer: 'wait' }),
        body: JSON.stringify({ input: { prompt: req.prompt, aspect_ratio: aspect, output_format: 'png' } })
      }, IMAGE_TIMEOUT)
      let pred = body
      const deadline = Date.now() + IMAGE_TIMEOUT
      while (pred.status !== 'succeeded') {
        if (pred.status === 'failed' || pred.status === 'canceled') throw new AiError(`${r.info.name} could not make the image: ${String(pred.error ?? pred.status)}`)
        const get = (pred.urls as { get?: string } | undefined)?.get
        if (!get || Date.now() > deadline) throw new AiError(`${r.info.name} took too long to make the image.`)
        await new Promise((ok) => setTimeout(ok, 1500))
        pred = await call(r, f, get, { headers: bearer(r, {}) }, TEXT_TIMEOUT)
      }
      const out = Array.isArray(pred.output) ? pred.output[0] : pred.output
      return download(String(out ?? ''), r, f)
    }
    case 'fal': {
      const body = await call(r, f, `${r.baseUrl}/${r.model}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Key ${r.key ?? ''}` },
        body: JSON.stringify({ prompt: req.prompt, image_size: FAL_SIZES[aspect], num_images: 1 })
      }, IMAGE_TIMEOUT)
      return download((body.images as Array<{ url?: string }> | undefined)?.[0]?.url ?? '', r, f)
    }
    case 'sd-webui': {
      const [w, h] = SD_SIZES[aspect]
      const body = await call(r, f, `${r.baseUrl}/sdapi/v1/txt2img`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: req.prompt, negative_prompt: 'perspective, people, text, watermark, blurry', width: w, height: h, steps: 28,
          ...(r.model ? { override_settings: { sd_model_checkpoint: r.model } } : {})
        })
      }, IMAGE_TIMEOUT)
      return b64Image((body.images as string[] | undefined)?.[0], r)
    }
    default:
      throw new AiError(`${r.info.name} writes text; choose an image service for battle maps.`)
  }
}

// ---------------------------------------------------------------- models and checks

/** The service's own list of models (fetched, so it is never out of date). */
export async function listModels(r: Resolved, f: Fetch = fetch): Promise<string[]> {
  const p = r.info.protocol
  if (p === 'anthropic') {
    const body = await call(r, f, `${r.baseUrl}/v1/models?limit=100`, { headers: anthropicHeaders(r) }, TEXT_TIMEOUT)
    return ids(body.data)
  }
  if (p === 'openai' || p === 'openai-image') {
    const body = await call(r, f, `${r.baseUrl}/models`, { headers: bearer(r, {}) }, TEXT_TIMEOUT)
    const all = ids(body.data)
    if (r.info.id === 'openai') return all.filter((m) => /^(gpt|o\d|chatgpt)/.test(m) && !/image|audio|realtime|tts|transcribe|search|embedding/.test(m))
    if (p === 'openai-image') return all.filter((m) => /image|dall-e/.test(m))
    return all
  }
  if (p === 'gemini' || p === 'gemini-image') {
    const body = await call(r, f, `${r.baseUrl}/models?pageSize=200`, { headers: { 'x-goog-api-key': r.key ?? '' } }, TEXT_TIMEOUT)
    const models = (body.models as Array<{ name: string; supportedGenerationMethods?: string[] }> | undefined) ?? []
    return models
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((m) => (p === 'gemini-image' ? /image/.test(m) : !/image|tts|embedding/.test(m)))
  }
  if (p === 'sd-webui') {
    const res = await send(r, f, `${r.baseUrl}/sdapi/v1/sd-models`, {}, TEXT_TIMEOUT)
    const list = (await res.json()) as Array<{ title?: string; model_name?: string }>
    return list.map((m) => m.title ?? m.model_name ?? '').filter(Boolean)
  }
  return r.info.models // Stability, Replicate and fal have no short list: use the suggestions
}

/**
 * Checks the key and address without spending money: writing services answer one
 * short line; image services are asked for their model list or account instead of an image.
 */
export async function checkConnection(r: Resolved, f: Fetch = fetch): Promise<string> {
  if (r.info.kind === 'text') {
    const reply = await generateText(r, { system: 'You are a terse test endpoint.', prompt: 'Reply with the words: The candle is lit.', maxTokens: 30 }, f)
    return `${r.info.name} answered: “${reply.trim().slice(0, 120)}”`
  }
  switch (r.info.protocol) {
    case 'stability': {
      await call(r, f, `${r.baseUrl}/v1/user/account`, { headers: bearer(r, {}) }, TEXT_TIMEOUT)
      return `${r.info.name} accepted the key.`
    }
    case 'replicate': {
      await call(r, f, `${r.baseUrl}/account`, { headers: bearer(r, {}) }, TEXT_TIMEOUT)
      return `${r.info.name} accepted the key.`
    }
    case 'fal':
      return 'fal.ai has no free check: the key is tried on the first battle map.'
    default: {
      const models = await listModels(r, f)
      return `${r.info.name} is reachable${models.length ? ` (${models.length} model${models.length === 1 ? '' : 's'})` : ''}.`
    }
  }
}

// ---------------------------------------------------------------- helpers

const landscape = (a: Aspect) => a === '3:2' || a === '16:9'
const FAL_SIZES: Record<Aspect, string> = {
  '1:1': 'square_hd', '3:2': 'landscape_4_3', '16:9': 'landscape_16_9', '2:3': 'portrait_4_3', '9:16': 'portrait_16_9'
}
const SD_SIZES: Record<Aspect, [number, number]> = {
  '1:1': [1024, 1024], '3:2': [1216, 832], '2:3': [832, 1216], '16:9': [1344, 768], '9:16': [768, 1344]
}

function anthropicHeaders(r: Resolved): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-api-key': r.key ?? '', 'anthropic-version': '2023-06-01' }
}

function bearer(r: Resolved, extra: Record<string, string>): Record<string, string> {
  return r.key ? { ...extra, Authorization: `Bearer ${r.key}` } : extra
}

function ids(data: unknown): string[] {
  return Array.isArray(data) ? data.map((d) => String((d as { id?: unknown }).id ?? '')).filter(Boolean).sort() : []
}

function ext(mime: string): string {
  return mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png'
}

function geminiParts(body: Record<string, unknown>): Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }> {
  const c = (body.candidates as Array<{ content?: { parts?: unknown[] }; finishReason?: string }> | undefined)?.[0]
  return (c?.content?.parts ?? []) as Array<{ text?: string; inlineData?: { data?: string; mimeType?: string } }>
}

function textOf(text: string | null | undefined, r: Resolved): string {
  if (!text || !text.trim()) throw new AiError(`${r.info.name} sent back an empty answer. Try again or choose another model.`)
  return text.trim()
}

function b64Image(data: string | undefined, r: Resolved, mime = 'image/png'): ImageResult {
  if (!data) throw new AiError(`${r.info.name} did not send back an image. It may have refused the description; try rewording it.`)
  return { bytes: Buffer.from(data, 'base64'), mime }
}

async function download(url: string, r: Resolved, f: Fetch): Promise<ImageResult> {
  if (!/^https:\/\//.test(url)) throw new AiError(`${r.info.name} did not send back an image.`)
  const res = await f(url, { signal: AbortSignal.timeout(TEXT_TIMEOUT) })
  if (!res.ok) throw new AiError(`Could not download the image from ${r.info.name} (${res.status}).`)
  return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get('content-type') ?? 'image/png' }
}

async function send(r: Resolved, f: Fetch, url: string, init: RequestInit, timeout: number): Promise<Response> {
  let res: Response
  try {
    res = await f(url, { ...init, signal: AbortSignal.timeout(timeout) })
  } catch (err) {
    const e = err as Error
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new AiError(`${r.info.name} did not answer in time.`)
    throw new AiError(r.info.local
      ? `Could not reach ${r.info.name} at ${r.baseUrl}. Is it running?`
      : `Could not reach ${r.info.name}. Check the internet connection.`)
  }
  if (!res.ok) {
    let detail = ''
    try { detail = errorText(await res.text()) } catch { /* no body */ }
    throw new AiError(`${statusMessage(res.status, r)}${detail ? ` (${detail})` : ''}`)
  }
  return res
}

async function call(r: Resolved, f: Fetch, url: string, init: RequestInit, timeout: number): Promise<Record<string, unknown>> {
  const res = await send(r, f, url, init, timeout)
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    throw new AiError(`${r.info.name} sent back something the app could not read.`)
  }
}

function statusMessage(status: number, r: Resolved): string {
  if (status === 401 || status === 403) return `${r.info.name} refused the API key`
  if (status === 404) return `${r.info.name} does not know model “${r.model}” or the address is wrong`
  if (status === 402 || status === 429) return `${r.info.name} says the account is out of credit or busy`
  if (status >= 500) return `${r.info.name} had a problem on its side (${status}); try again later`
  return `${r.info.name} turned the request down (${status})`
}

function errorText(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string; errors?: string[] }
    const m = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message ?? j.errors?.join('; ')
    if (m) return m.slice(0, 200)
  } catch { /* not JSON */ }
  return body.replace(/\s+/g, ' ').slice(0, 200)
}
