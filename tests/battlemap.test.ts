import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'
import { aspectFor, battleMapPrompt, defaultFeatures, guessTerrain, rowsFor, settingFor, timeOfDayFor, type BattleMapSpec } from '../src/shared/battlemap'
import { generateImage, resolve, type Fetch } from '../src/main/ai/client'

let dir: string
let c: Campaign
const png = (w: number, h: number) => {
  const b = Buffer.alloc(24); b.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
  return b
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dz-bm-'))
  c = Campaign.create(join(dir, 'Camp'), 'Camp')
})
afterEach(() => {
  c.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('battle map rules', () => {
  it('picks the image shape nearest the grid', () => {
    expect(aspectFor(20, 20)).toBe('1:1')
    expect(aspectFor(30, 20)).toBe('3:2')
    expect(aspectFor(20, 30)).toBe('2:3')
    expect(aspectFor(40, 20)).toBe('16:9')
    expect(aspectFor(10, 30)).toBe('9:16')
    expect(rowsFor(20, 1536, 1024)).toBe(13)
  })

  const base: BattleMapSpec = {
    description: 'A ruined chapel,\n crypt stair.', setting: 'indoors', terrain: 'temple', cols: 24, rows: 16, timeOfDay: 'night',
    weather: 'rain', season: 'autumn', mood: 'eerie', style: 'painted', features: ['cover', 'secret'], extra: 'A broken statue', withExamples: false
  }

  it('always asks for top-down, the size in squares, and no grid, text or tokens', () => {
    const p = battleMapPrompt(base)
    expect(p).toContain('game: indoors, temple.')
    expect(p).toContain('directly above')
    expect(p).toContain('24 squares wide and 16 squares deep, each square 5 feet')
    expect(p).toContain('What is there: A ruined chapel, crypt stair.')
    expect(p).toContain('Include: scattered cover (crates, rubble, low walls, barrels); a subtle hidden passage or secret door.')
    expect(p).toContain('Also: A broken statue')
    expect(p).toContain('Mood: eerie.')
    expect(p).toMatch(/Lighting: night/)
    expect(p).not.toContain('Weather') // indoors: no sky
    expect(p).toMatch(/No grid lines.*no text.*no people, creatures or tokens/)
    expect(p).not.toContain('example maps')
    const outside = battleMapPrompt({ ...base, setting: 'outdoors', terrain: 'any', features: [], mood: 'neutral', extra: '', withExamples: true })
    expect(outside).toContain('game: outdoors.')
    expect(outside).toContain('Weather: rain. Season: autumn.')
    expect(outside).not.toContain('Include:')
    expect(outside).not.toContain('Mood')
    expect(outside).toContain('art style, colours')
  })

  it('fills in first guesses the DM can change', () => {
    expect(guessTerrain('Old Harbour: rotting piers')).toBe('coast')
    expect(guessTerrain('The crypt beneath the chapel')).toBe('crypt')
    expect(guessTerrain('A quiet field')).toBe('any')
    expect(settingFor('crypt')).toBe('underground')
    expect(settingFor('tavern')).toBe('indoors')
    expect(settingFor('forest')).toBe('outdoors')
    expect(defaultFeatures('indoors')).toContain('doors')
    expect(timeOfDayFor('daylight')).toBe('day')
  })

  it('asks image services for the right shape', async () => {
    const sent: Array<{ url: string; body: unknown }> = []
    const f = (async (url: string, init?: RequestInit) => {
      sent.push({ url, body: init?.body })
      return new Response(JSON.stringify({ data: [{ b64_json: 'AA==' }], images: [{ url: 'https://fal.media/x.png' }] }), { status: 200 })
    }) as unknown as Fetch
    await generateImage(resolve({ provider: 'openai-image', model: 'gpt-image-1', baseUrl: 'https://api.openai.com/v1' }, 'k'), { prompt: 'p', aspect: '2:3' }, f)
    expect(JSON.parse(String(sent[0].body)).size).toBe('1024x1536')
    await generateImage(resolve({ provider: 'fal', model: 'fal-ai/flux/schnell', baseUrl: 'https://fal.run' }, 'k'), { prompt: 'p', aspect: '16:9' }, f).catch(() => undefined)
    expect(JSON.parse(String(sent[1].body)).image_size).toBe('landscape_16_9')
  })
})

describe('style examples and kept battle maps', () => {
  it('adds, renames, removes to History and restores example maps', () => {
    const files = ['chapel.png', 'cave.jpg', 'docks.webp', 'tower.png', 'swamp.png'].map((n) => {
      const f = join(dir, n); writeFileSync(f, png(512, 512)); return f
    })
    const added = files.map((f) => c.addStyleExample(f))
    expect(added[1]).toMatchObject({ name: 'cave', url: expect.stringMatching(/^dz-asset:\/\/campaign\/styles\/.+\.jpg$/) })
    c.renameStyleExample(added[0].id, 'Painted chapel')
    expect(c.styleExamples()[0].name).toBe('Painted chapel')
    c.setStyleExampleStatus(added[2].id, 'defunct')
    expect(c.styleExamples().map((s) => s.name)).toEqual(['Painted chapel', 'cave', 'tower', 'swamp'])
    expect(c.history().removedStyles).toEqual([{ id: added[2].id, name: 'docks' }])
    // Only active examples are sent, at most four, with their image type.
    const imgs = c.styleImages(added.map((a) => a.id))
    expect(imgs).toHaveLength(4)
    expect(imgs[1].mime).toBe('image/jpeg')
    c.setStyleExampleStatus(added[2].id, 'active')
    expect(c.styleExamples()).toHaveLength(5)
    c.undo()
    expect(c.styleExamples()).toHaveLength(4)
    expect(() => c.addStyleExample(join(dir, 'notes.txt'))).toThrow(/PNG, JPEG or WebP/)
  })

  it('keeps a drawn map only when the DM says so, as a battle map with a grid', () => {
    const p = c.savePendingImage(png(1536, 1024), 'image/png')
    expect(p).toMatchObject({ width: 1536, height: 1024, url: expect.stringMatching(/^dz-asset:\/\/campaign\/pending\//) })
    expect(c.maps()).toEqual([]) // waiting images are not campaign data
    const m = c.keepBattleMap({ pendingId: p.pendingId, name: 'Chapel fight', cols: 24, source: 'OpenAI images · gpt-image-1', prompt: 'A chapel' })
    expect(m).toMatchObject({ name: 'Chapel fight', kind: 'battle', gridCols: 24, gridRows: 16, source: 'OpenAI images · gpt-image-1', prompt: 'A chapel' })
    expect(c.assetFile(m.url.replace('dz-asset://campaign/', ''))).not.toBeNull()
    c.setMapGrid(m.id, 30)
    expect(c.maps()[0]).toMatchObject({ gridCols: 30, gridRows: 20 })
    c.setMapGrid(m.id, null)
    expect(c.maps()[0].gridRows).toBeNull()
    c.undo(); c.undo(); c.undo()
    expect(c.maps()).toEqual([])
  })

  it('throws away images the DM did not keep, and refuses odd file names', () => {
    const a = c.savePendingImage(png(64, 64), 'image/png')
    const b = c.savePendingImage(png(64, 64), 'image/jpeg')
    expect(b.pendingId).toMatch(/\.jpg$/)
    c.discardPending(a.pendingId)
    const pending = join(dir, 'Camp', 'assets', 'pending')
    expect(readdirSync(pending)).toEqual([b.pendingId])
    expect(() => c.keepBattleMap({ pendingId: '../campaign.db', name: 'x', cols: 10, source: 's', prompt: 'p' })).toThrow(/Not a waiting image/)
    expect(() => c.keepBattleMap({ pendingId: a.pendingId, name: 'x', cols: 10, source: 's', prompt: 'p' })).toThrow(/gone/)
    // Reopening the campaign clears images left waiting when the app closed.
    c.close()
    c = Campaign.open(join(dir, 'Camp'))
    expect(existsSync(pending)).toBe(false)
  })
})
