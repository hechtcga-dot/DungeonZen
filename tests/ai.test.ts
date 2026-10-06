import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KeyStore, type Encryptor } from '../src/main/ai/keys'
import { ProfileStore } from '../src/main/profile'
import { checkConnection, generateImage, generateText, listModels, resolve, type Fetch } from '../src/main/ai/client'
import { scenePrompt, type SceneContext } from '../src/main/ai/scene'
import { AI_PROVIDERS, providerById } from '../src/shared/aiProviders'
import { Campaign } from '../src/main/campaign/campaign'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dz-ai-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// Stands in for Windows encryption: reversible but not plain text.
const fakeCrypto = (available = true): Encryptor => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`enc:${[...s].reverse().join('')}`),
  decryptString: (b) => [...b.toString().slice(4)].reverse().join('')
})

interface Sent { url: string; init: RequestInit }
/** A fake network: answers each request with the next reply in the list. */
function fakeFetch(...replies: Array<Response | Error>): { f: Fetch; sent: Sent[] } {
  const sent: Sent[] = []
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} })
    const next = replies.shift()
    if (!next) throw new Error('no more replies')
    if (next instanceof Error) throw next
    return next
  }) as Fetch
  return { f, sent }
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const bodyOf = (s: Sent) => JSON.parse(String(s.init.body)) as Record<string, any>
const headersOf = (s: Sent) => (s.init.headers ?? {}) as Record<string, string>
const pick = (id: string, key: string | null = 'sk-test-key', model?: string) => {
  const info = providerById(id)!
  return resolve({ provider: id, model: model ?? info.defaultModel, baseUrl: info.baseUrl }, key)
}

describe('AI service list', () => {
  it('has unique ids, writing and map services, and a default model for each online service', () => {
    const ids = AI_PROVIDERS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(AI_PROVIDERS.filter((p) => p.kind === 'text').length).toBeGreaterThanOrEqual(8)
    expect(AI_PROVIDERS.filter((p) => p.kind === 'image').length).toBeGreaterThanOrEqual(5)
    for (const p of AI_PROVIDERS) {
      if (!p.editableUrl) expect(p.baseUrl).toMatch(/^https:\/\//)
      if (!p.local && p.id !== 'custom-text') expect(p.defaultModel).not.toBe('')
    }
  })
})

describe('API keys', () => {
  it('stores keys encrypted, per service, and removes them', () => {
    const keys = new KeyStore(dir, fakeCrypto())
    keys.set('anthropic', '  sk-ant-secret  ')
    keys.set('openai', 'sk-openai')
    expect(keys.get('anthropic')).toBe('sk-ant-secret')
    expect(keys.saved().sort()).toEqual(['anthropic', 'openai'])
    const onDisk = readFileSync(join(dir, 'ai-keys.json'), 'utf8')
    expect(onDisk).not.toContain('sk-ant-secret')
    keys.remove('anthropic')
    expect(keys.has('anthropic')).toBe(false)
    expect(keys.get('openai')).toBe('sk-openai')
  })

  it('refuses to save a key when the computer cannot encrypt it', () => {
    expect(() => new KeyStore(dir, fakeCrypto(false)).set('openai', 'sk-x')).toThrow(/cannot encrypt/)
  })

  it('treats a key it cannot decrypt (another computer) as missing', () => {
    writeFileSync(join(dir, 'ai-keys.json'), JSON.stringify({ openai: 'garbage' }))
    const keys = new KeyStore(dir, { ...fakeCrypto(), decryptString: () => { throw new Error('bad') } })
    expect(keys.get('openai')).toBeNull()
  })
})

describe('choosing services', () => {
  it('switches services and remembers each one\'s model and address', () => {
    const p = new ProfileStore(dir)
    expect(p.aiChoice('text')).toEqual({ provider: null, model: '', baseUrl: '' })
    p.setAiChoice('text', 'anthropic', { model: 'claude-haiku-4-5-20251001' })
    p.setAiChoice('text', 'ollama', { baseUrl: 'http://192.168.1.20:11434/v1' })
    expect(p.aiChoice('text')).toEqual({ provider: 'ollama', model: 'llama3.1', baseUrl: 'http://192.168.1.20:11434/v1' })
    p.setAiChoice('text', 'anthropic')
    expect(p.aiChoice('text').model).toBe('claude-haiku-4-5-20251001')
    p.setAiChoice('image', 'replicate')
    expect(p.aiChoice('image')).toMatchObject({ provider: 'replicate', model: 'black-forest-labs/flux-schnell' })
    // Fixed addresses cannot be overridden.
    p.setAiChoice('text', 'openai', { baseUrl: 'https://evil.example' })
    expect(p.aiChoice('text').baseUrl).toBe('https://api.openai.com/v1')
    p.remember('/tmp/x', 'X') // recent campaigns still work beside the AI settings
    expect(new ProfileStore(dir).aiChoice('text').provider).toBe('openai')
  })

  it('explains what is missing before calling anything', () => {
    expect(() => resolve({ provider: null, model: '', baseUrl: '' }, null)).toThrow(/No AI service/)
    expect(() => pick('anthropic', null)).toThrow(/needs an API key/)
    expect(() => resolve({ provider: 'custom-text', model: '', baseUrl: 'https://x.example/v1' }, null)).toThrow(/Choose a model/)
    expect(() => resolve({ provider: 'custom-text', model: 'm', baseUrl: 'https://' }, null)).toThrow(/not a web address/)
    expect(pick('ollama', null).key).toBeNull()
  })
})

describe('writing services', () => {
  const req = { system: 'Be brief.', prompt: 'Describe the docks.', maxTokens: 200 }

  it('Anthropic: Messages API with the key header', async () => {
    const { f, sent } = fakeFetch(json({ content: [{ type: 'text', text: 'You smell tar.' }] }))
    expect(await generateText(pick('anthropic'), req, f)).toBe('You smell tar.')
    expect(sent[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(headersOf(sent[0])['x-api-key']).toBe('sk-test-key')
    expect(bodyOf(sent[0])).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 200, system: 'Be brief.', messages: [{ role: 'user', content: 'Describe the docks.' }] })
  })

  it('OpenAI-compatible services: chat completions, the right token limit, no key for local ones', async () => {
    const reply = () => json({ choices: [{ message: { content: 'Gulls cry.' } }] })
    const { f, sent } = fakeFetch(reply(), reply(), reply())
    await generateText(pick('openai'), req, f)
    await generateText(pick('groq'), req, f)
    await generateText(pick('ollama', null), req, f)
    expect(sent.map((s) => s.url)).toEqual([
      'https://api.openai.com/v1/chat/completions', 'https://api.groq.com/openai/v1/chat/completions', 'http://localhost:11434/v1/chat/completions'
    ])
    expect(bodyOf(sent[0]).max_completion_tokens).toBeGreaterThanOrEqual(200)
    expect(bodyOf(sent[1]).max_tokens).toBe(200)
    expect(bodyOf(sent[1]).messages[0]).toEqual({ role: 'system', content: 'Be brief.' })
    expect(headersOf(sent[0]).Authorization).toBe('Bearer sk-test-key')
    expect(headersOf(sent[2]).Authorization).toBeUndefined()
  })

  it('Gemini: generateContent with the system instruction', async () => {
    const { f, sent } = fakeFetch(json({ candidates: [{ content: { parts: [{ text: 'Rain ' }, { text: 'falls.' }] } }] }))
    expect(await generateText(pick('gemini'), req, f)).toBe('Rain falls.')
    expect(sent[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect(headersOf(sent[0])['x-goog-api-key']).toBe('sk-test-key')
    expect(bodyOf(sent[0]).systemInstruction.parts[0].text).toBe('Be brief.')
  })

  it('turns failures into plain messages', async () => {
    const { f } = fakeFetch(
      json({ error: { message: 'invalid x-api-key' } }, 401),
      json({ error: { message: 'model not found' } }, 404),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      json({ choices: [{ message: { content: '' } }] })
    )
    await expect(generateText(pick('anthropic'), req, f)).rejects.toThrow('Anthropic Claude refused the API key (invalid x-api-key)')
    await expect(generateText(pick('anthropic', 'k-123456789', 'nope'), req, f)).rejects.toThrow(/does not know model “nope”/)
    await expect(generateText(pick('ollama', null), req, f)).rejects.toThrow('Could not reach Ollama (on this computer) at http://localhost:11434/v1. Is it running?')
    await expect(generateText(pick('openai'), req, f)).rejects.toThrow(/Check the internet connection/)
    await expect(generateText(pick('openai'), req, f)).rejects.toThrow(/empty answer/)
  })

  it('fetches model lists and tests the connection with one short line', async () => {
    const { f, sent } = fakeFetch(
      json({ data: [{ id: 'gpt-5' }, { id: 'gpt-image-1' }, { id: 'text-embedding-3-small' }, { id: 'gpt-5-mini' }] }),
      json({ models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] }
      ] }),
      json({ content: [{ type: 'text', text: 'The candle is lit.' }] })
    )
    expect(await listModels(pick('openai'), f)).toEqual(['gpt-5', 'gpt-5-mini'])
    expect(await listModels(pick('gemini'), f)).toEqual(['gemini-2.5-flash'])
    expect(await checkConnection(pick('anthropic'), f)).toBe('Anthropic Claude answered: “The candle is lit.”')
    expect(sent[0].url).toBe('https://api.openai.com/v1/models')
  })
})

describe('battle map services', () => {
  const png = Buffer.from('fake-png-bytes')
  const prompt = 'Top-down battle map, 20 by 20 squares, a ruined chapel.'

  it('OpenAI images: generations without examples, edits with them', async () => {
    const { f, sent } = fakeFetch(json({ data: [{ b64_json: png.toString('base64') }] }), json({ data: [{ b64_json: png.toString('base64') }] }))
    expect((await generateImage(pick('openai-image'), { prompt }, f)).bytes.equals(png)).toBe(true)
    expect(sent[0].url).toBe('https://api.openai.com/v1/images/generations')
    expect(bodyOf(sent[0])).toMatchObject({ model: 'gpt-image-1', size: '1024x1024' })
    await generateImage(pick('openai-image'), { prompt, references: [{ bytes: png, mime: 'image/png' }] }, f)
    expect(sent[1].url).toBe('https://api.openai.com/v1/images/edits')
    const form = sent[1].init.body as FormData
    expect(form.get('prompt')).toBe(prompt)
    expect(form.getAll('image[]')).toHaveLength(1)
  })

  it('Gemini images: example maps go in as inline images', async () => {
    const { f, sent } = fakeFetch(json({ candidates: [{ content: { parts: [{ text: 'Here' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] }))
    const out = await generateImage(pick('gemini-image'), { prompt, references: [{ bytes: png, mime: 'image/png' }, { bytes: png, mime: 'image/jpeg' }] }, f)
    expect(out.bytes.equals(png)).toBe(true)
    const parts = bodyOf(sent[0]).contents[0].parts
    expect(parts).toHaveLength(3)
    expect(parts[2].inlineData.mimeType).toBe('image/jpeg')
  })

  it('Gemini images: asks once more after a words-only answer, then explains', async () => {
    const words = json({ candidates: [{ content: { parts: [{ text: 'I will create that map for you.' }] }, finishReason: 'STOP' }] })
    const pic = json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] })
    const a = fakeFetch(words, pic)
    expect((await generateImage(pick('gemini-image'), { prompt }, a.f)).bytes.equals(png)).toBe(true)
    expect(a.sent).toHaveLength(2)
    const b = fakeFetch(json({ candidates: [{ content: { parts: [{ text: 'Sure.' }] } }] }), json({ candidates: [{ content: { parts: [{ text: 'Sure!' }] } }] }))
    await expect(generateImage(pick('gemini-image'), { prompt }, b.f)).rejects.toThrow(/answered in words.*Sure!.*billing/)
    // Blocked by the safety filter: no second try, and says what to change.
    const c = fakeFetch(json({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }))
    await expect(generateImage(pick('gemini-image'), { prompt }, c.f)).rejects.toThrow(/refused this picture \(IMAGE_SAFETY\).*What the AI is told/)
    expect(c.sent).toHaveLength(1)
    // A text-only model chosen for maps.
    const d = fakeFetch(json({ candidates: [{ content: { parts: [{ text: 'A map.' }] } }] }), json({ candidates: [{ content: { parts: [{ text: 'A map.' }] } }] }))
    await expect(generateImage({ ...pick('gemini-image'), model: 'gemini-2.5-flash' }, { prompt }, d.f)).rejects.toThrow(/only writes text/)
    // Free keys have no image allowance.
    const e = fakeFetch(new Response('{"error":{"message":"Quota exceeded"}}', { status: 429 }))
    await expect(generateImage(pick('gemini-image'), { prompt }, e.f)).rejects.toThrow(/billing/)
  })

  it('Stability: image bytes back; the style endpoint when there is an example', async () => {
    const img = () => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
    const { f, sent } = fakeFetch(img(), img())
    expect((await generateImage(pick('stability'), { prompt }, f)).bytes.equals(png)).toBe(true)
    await generateImage(pick('stability'), { prompt, references: [{ bytes: png, mime: 'image/png' }] }, f)
    expect(sent.map((s) => s.url)).toEqual([
      'https://api.stability.ai/v2beta/stable-image/generate/core', 'https://api.stability.ai/v2beta/stable-image/control/style'
    ])
  })

  it('Replicate: waits for the prediction, then downloads the image', async () => {
    const { f, sent } = fakeFetch(
      json({ status: 'processing', urls: { get: 'https://api.replicate.com/v1/predictions/abc' } }),
      json({ status: 'succeeded', output: ['https://replicate.delivery/abc.png'] }),
      new Response(png, { status: 200, headers: { 'content-type': 'image/png' } })
    )
    expect((await generateImage(pick('replicate'), { prompt }, f)).bytes.equals(png)).toBe(true)
    expect(sent[0].url).toBe('https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions')
    expect(sent[2].url).toBe('https://replicate.delivery/abc.png')
  }, 10_000)

  it('fal.ai and Stable Diffusion on this computer', async () => {
    const { f, sent } = fakeFetch(
      json({ images: [{ url: 'https://fal.media/x.png' }] }),
      new Response(png, { status: 200 }),
      json({ images: [png.toString('base64')] })
    )
    await generateImage(pick('fal'), { prompt }, f)
    expect(headersOf(sent[0]).Authorization).toBe('Key sk-test-key')
    expect(sent[0].url).toBe('https://fal.run/fal-ai/flux/schnell')
    const local = resolve({ provider: 'sd-webui', model: '', baseUrl: 'http://127.0.0.1:7860/' }, null)
    expect((await generateImage(local, { prompt }, f)).bytes.equals(png)).toBe(true)
    expect(sent[2].url).toBe('http://127.0.0.1:7860/sdapi/v1/txt2img')
  })

  it('checks image services without paying for an image', async () => {
    const { f, sent } = fakeFetch(json({ id: 'acct' }), json([{ title: 'dreamshaper.safetensors' }]))
    expect(await checkConnection(pick('stability'), f)).toMatch(/accepted the key/)
    const local = resolve({ provider: 'sd-webui', model: '', baseUrl: 'http://127.0.0.1:7860' }, null)
    expect(await checkConnection(local, f)).toMatch(/reachable \(1 model\)/)
    expect(sent.map((s) => s.url)).toEqual(['https://api.stability.ai/v1/user/account', 'http://127.0.0.1:7860/sdapi/v1/sd-models'])
  })
})

describe('scene text', () => {
  const ctx: SceneContext = {
    campaignName: 'The Mistreach', when: 'Day 2 · 21:30', light: 'night', moon: 'Waxing gibbous',
    place: { name: 'Old Harbour', notes: 'Fish market, rotting piers.', inside: 'The Mistreach' },
    present: [{ name: 'Ciaf Crol', type: 'NPC' }], recent: ['fight: Ambush at the bridge'], current: ''
  }

  it('tells the AI the time, place, who is there and what just happened', () => {
    const p = scenePrompt(ctx, 'the fog rolling in')
    expect(p).toContain('Day 2 · 21:30 (night)')
    expect(p).toContain('Old Harbour, in The Mistreach')
    expect(p).toContain('Fish market, rotting piers.')
    expect(p).toContain('Ciaf Crol (npc)')
    expect(p).toContain('Ambush at the bridge')
    expect(p).toContain('The DM asks for: the fog rolling in')
    expect(scenePrompt({ ...ctx, place: null, present: [] }, '')).toContain('not placed on a map')
  })

  it('gathers the context from the campaign', () => {
    const c = Campaign.create(join(dir, 'Scene'), 'The Mistreach')
    try {
      const g = c.info().globalBoardId
      const bytes = Buffer.alloc(24); bytes.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); bytes.writeUInt32BE(1000, 16); bytes.writeUInt32BE(800, 20)
      writeFileSync(join(dir, 'm.png'), bytes)
      const mapId = c.importMap(join(dir, 'm.png')).id
      c.setClock(21 * 60)
      const region = c.createRegion({ mapId, polygon: [[0, 0], [200, 0], [200, 200], [0, 200]], newName: 'Old Harbour' })
      const loc = c.mapScreen(mapId).regions.find((r) => r.id === region)!.locationId
      const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Ciaf Crol', position: { x: 0, y: 0 } })
      c.createRelationship({ sourceId: npc.id, targetId: loc, type: 'LOCATED_AT', isSecret: false })
      c.moveParty({ mapId, x: 100, y: 100, minutes: 0 })
      c.startSession()
      c.addLog({ kind: 'note', text: 'They bought rope' })
      const s = c.sceneContext()
      expect(s).toMatchObject({ campaignName: 'The Mistreach', when: 'Day 1 · 21:00', light: 'night', place: { name: 'Old Harbour', inside: null } })
      expect(s.present).toEqual([{ name: 'Ciaf Crol', type: 'NPC' }])
      expect(s.recent.at(-1)).toContain('They bought rope')
    } finally {
      c.close()
    }
  })
})
