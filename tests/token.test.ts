import { describe, expect, it } from 'vitest'
import { analysePortrait } from '../src/shared/tokenFit'
import { DEFAULT_TOKEN_SETTINGS, readTokenSettings, tokenKey, tokenSpecFor } from '../src/shared/token'

/** A w×h picture in `bg` with a `fg` box (a standing figure) from (x0, y0) to (x1, y1). */
function picture(w: number, h: number, bg: number[], fg: number[], x0: number, y0: number, x1: number, y1: number) {
  const px = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = x >= x0 && x < x1 && y >= y0 && y < y1 ? fg : bg
    px.set([c[0], c[1], c[2], 255], (y * w + x) * 4)
  }
  return px
}

describe('token auto-fit', () => {
  it('takes the background colour from the edges and fits the whole figure', () => {
    const f = analysePortrait(picture(100, 100, [240, 230, 200], [60, 40, 30], 40, 10, 60, 90), 100, 100)
    expect(f.bg).toBe('#f0e6c8')
    expect(f.body.x).toBeCloseTo(0.5)
    expect(f.body.y).toBeCloseTo(0.5)
    // Every corner of the figure is inside the circle (head and feet not cut off).
    expect(f.body.r).toBeGreaterThanOrEqual(Math.hypot(10, 40) / 100 - 0.01)
    // Head and body: the top of the tall figure, a smaller circle higher up.
    expect(f.head.y).toBeLessThan(f.body.y)
    expect(f.head.r).toBeLessThan(f.body.r)
  })

  it('fills the circle with the middle of a busy picture', () => {
    const f = analysePortrait(picture(100, 50, [10, 10, 10], [200, 50, 50], 2, 2, 98, 48), 100, 50)
    expect(f.body).toEqual({ x: 0.5, y: 0.25, r: 0.25 })
  })
})

describe('token specs', () => {
  it('uses the card type default unless the card has its own; removed gives none', () => {
    const s = readTokenSettings({ size: 256 })
    expect(s.types.PC.border).toBe('ember')
    expect(tokenSpecFor('PC', undefined, s)).toMatchObject({ border: 'ember', size: 256, fit: 'body', bg: null })
    expect(tokenSpecFor('NPC', { border: 'gold', fit: 'head' }, s)).toMatchObject({ border: 'gold', fit: 'head' })
    expect(tokenSpecFor('NPC', { removed: true }, s)).toBeNull()
    expect(tokenSpecFor('LOCATION', undefined, s)).toBeNull()
  })

  it('names a token by its picture and look', () => {
    const a = tokenSpecFor('PC', undefined, DEFAULT_TOKEN_SETTINGS)!
    expect(tokenKey('pictures/a.png', a)).toBe(tokenKey('pictures/a.png', { ...a }))
    expect(tokenKey('pictures/a.png', a)).not.toBe(tokenKey('pictures/b.png', a))
    expect(tokenKey('pictures/a.png', a)).not.toBe(tokenKey('pictures/a.png', { ...a, zoom: 1.1 }))
  })
})

describe('tokens in a campaign', async () => {
  const { mkdtempSync, rmSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { Campaign } = await import('../src/main/campaign/campaign')

  it('lists PC, NPC and monster tokens, keeps drawn files, edits one card only, removes to History', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dz-token-'))
    const c = Campaign.create(join(dir, 'T'), 'T')
    try {
      const g = c.info().globalBoardId
      const npc = c.createEntity({ boardId: g, type: 'NPC', name: 'Hobbes', position: { x: 0, y: 0 } })
      const pc = c.createEntity({ boardId: g, type: 'PC', name: 'Raph', position: { x: 0, y: 0 } })
      c.createEntity({ boardId: g, type: 'LOCATION', name: 'Docks', position: { x: 0, y: 0 } })
      c.updateEntity(npc.id, { attributes: { picture: 'pictures/a.png' } })
      c.updateEntity(pc.id, { attributes: { picture: 'pictures/a.png' } })
      let list = c.tokens()
      expect(list.map((t) => [t.name, t.spec.border, t.exists])).toEqual([['Hobbes', 'silver', false], ['Raph', 'ember', false]])
      c.writeToken(npc.id, list[0].key, Buffer.from('png').toString('base64'))
      c.writeToken(npc.id, '00000000', 'eA==') // not its current drawing: ignored
      expect(c.tokens()[0].exists).toBe(true)
      expect(existsSync(c.tokenFile(npc.id)!)).toBe(true)
      // Edited for this card only; the type default for the rest.
      c.setToken(npc.id, { ...list[0].spec, border: 'gold' })
      list = c.tokens()
      expect(list.map((t) => [t.spec.border, t.own, t.exists])).toEqual([['gold', true, false], ['ember', false, false]])
      c.setSettings({ token_settings: { ...c.tokenSettings(), types: { ...c.tokenSettings().types, PC: { border: 'iron', tint: null } } } }, 'test')
      expect(c.tokens().map((t) => t.spec.border)).toEqual(['gold', 'iron'])
      // Delete to History keeps the look; restore brings it back; undo works.
      c.setTokenRemoved(npc.id, true)
      expect(c.tokens().map((t) => t.name)).toEqual(['Raph'])
      expect(c.history().removedTokens).toEqual([{ id: npc.id, name: 'Hobbes' }])
      c.setTokenRemoved(npc.id, false)
      expect(c.tokens()[0].spec.border).toBe('gold')
      c.undo(); c.undo()
      expect(c.tokens().map((t) => t.name)).toEqual(['Hobbes', 'Raph'])
    } finally { c.close(); rmSync(dir, { recursive: true, force: true }) }
  })
})
