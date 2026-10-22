import { describe, expect, it } from 'vitest'
import { wakeCursorArgs } from '../src/main/cursor'

describe('wakeCursor', () => {
  it('moves the real pointer right and back through user32', () => {
    const args = wakeCursorArgs()
    expect(args.slice(0, 4)).toEqual(['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden'])
    const script = Buffer.from(args[5], 'base64').toString('utf16le')
    expect(script).toContain('mouse_event(1, 1, 0, 0, 0)')
    expect(script).toContain('mouse_event(1, -1, 0, 0, 0)')
  })
})
