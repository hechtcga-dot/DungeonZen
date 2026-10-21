// Undo for every write (rule 4): every IPC channel runs once against a copy of the newest fixture campaign,
// its input made from its Zod schema (ids taken from the campaign). A channel that changes the campaign
// must have recorded it with CommandLog.run: undo brings back the exact rows from before, redo the rows after.
// The snapshot at the end lists which channels wrote, which only read, and which could not run with a made-up
// input: a new channel moves it, so the test asks for a look (`npx vitest -u` once checked). DZ_WHY=1 prints why each
// listed-as-failed channel failed (`DZ_WHY=1 npx vitest run tests/undoall.test.ts --disableConsoleIntercept`).
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, expect, it, vi } from 'vitest'
import type { z } from 'zod'

const handlers = new Map<string, (event: unknown, raw: unknown) => Promise<{ ok: boolean; value?: unknown; error?: string }>>()
const work = mkdtempSync(join(tmpdir(), 'dz-undoall-'))

vi.mock('electron', () => {
  const noop = () => undefined
  const image = { isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }), resize: () => image, toPNG: () => Buffer.alloc(0), toJPEG: () => Buffer.alloc(0), toBitmap: () => Buffer.alloc(0) }
  return {
    app: { getPath: () => work, getVersion: () => '0.0.0', isPackaged: false, relaunch: noop, quit: noop, exit: noop },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null, getFocusedWindow: () => null },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }), showMessageBox: async () => ({ response: 1 }) },
    ipcMain: { handle: (ch: string, fn: never) => handlers.set(ch, fn), on: noop },
    nativeImage: { createFromPath: () => image, createFromBuffer: () => image, createFromBitmap: () => image },
    net: { fetch: async () => { throw new Error('offline in tests') } },
    protocol: { handle: noop },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
    screen: { getCursorScreenPoint: () => ({ x: 0, y: 0 }) },
    shell: { openPath: async () => '', openExternal: async () => undefined, showItemInFolder: noop, trashItem: async () => undefined }
  }
})
vi.mock('electron-updater', () => ({ autoUpdater: { on: () => undefined, checkForUpdates: async () => null, quitAndInstall: () => undefined } }))
// No AI in tests: AI channels fail with this (and are listed as such).
vi.mock('../src/main/ai/client', async (orig) => {
  const off = async () => { throw new Error('No AI in tests') }
  return { ...(await orig<object>()), checkConnection: off, generateImage: off, generateText: off, listModels: off }
})

const { registerIpc } = await import('../src/main/ipcHandlers')
const { ProfileStore } = await import('../src/main/profile')
const { KeyStore } = await import('../src/main/ai/keys')
const { ipcInputs } = await import('../src/shared/ipc')
const { IPC_PREFIX } = await import('../src/shared/ipcPrefix')
const { srdMonsterIndex } = await import('../src/main/srd')

// Never run here: they close, swap or delete the open campaign, or restart the app; undo/redo are the check itself.
const NOT_RUN = new Set(['campaign:create', 'campaign:openDialog', 'campaign:openRecent', 'campaign:close', 'campaign:delete',
  'app:uninstall', 'app:restartToUpdate', 'history:undo', 'history:redo', 'history:undoTo', 'review:undoSession'])

// Which table an id comes from, by the input's key (or the channel's first word for a plain `id`).
// (The longest name the key ends with wins: sourceActId → act, parentLocationId → location.)
const TABLE: Record<string, string> = {
  building: 'entity', entity: 'entity', card: 'entity', encounter: 'entity', location: 'entity', pc: 'entity', patron: 'entity', discovery: 'entity', parent: 'entity',
  from: 'entity', to: 'entity', source: 'entity', target: 'entity', place: 'entity', npc: 'entity', item: 'board_item', boardImage: 'board_item',
  act: 'act', outcome: 'act_outcome', trigger: 'story_trigger', storyline: 'storyline', board: 'board', map: 'map', region: 'region_shape',
  session: 'session', log: 'log_entry', notedoc: 'note_doc', doc: 'note_doc', note: 'note_doc', prep: 'session_prep', prepItem: 'prep_item',
  secret: 'secret', relationship: 'relationship', ability: 'ability', style: 'style_example', picture: 'style_example', combat: 'combat',
  creature: 'encounter_creature', row: 'encounter_creature', command: 'command', knowledge: 'knowledge'
}

// A plain `id` that is not what the channel's first word says.
const ID_OF: Record<string, string> = { 'board:many': 'entity', 'board:setHidden': 'entity', 'link:save': 'secret', 'secret:save': 'secret', 'combat:end': 'combat' }
const SRD_KEY = srdMonsterIndex()[0].key

const folder = join(work, 'Undo campaign')
mkdirSync(folder)
copyFileSync(join(import.meta.dirname, 'fixtures', 'campaign-v2.10.1.db'), join(folder, 'campaign.db'))
// A map (the fixture has none): a 400×300 PNG in assets/maps.
const png = (w: number, h: number) => {
  const chunk = (type: string, data: Buffer) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.alloc((w * 3 + 1) * h, 120))), chunk('IEND', Buffer.alloc(0))])
}
mkdirSync(join(folder, 'assets', 'maps'), { recursive: true })
writeFileSync(join(folder, 'assets', 'maps', 'undo-map.png'), png(400, 300))
{
  const db = new Database(join(folder, 'campaign.db'))
  db.exec(`INSERT INTO map (id, name, image_path, width, height, status) VALUES ('5e0c3a1b-6d2f-4c8e-9a7b-1f2e3d4c5b6a', 'Undo map', 'maps/undo-map.png', 400, 300, 'active')`)
  db.close()
}
const peek = () => new Database(join(folder, 'campaign.db'), { readonly: true })

// Pairs (source/target, a list of ids) get different rows; the newest rows first, so a channel finds what one before it made.
function idFor(key: string, channel: string, n: number): string {
  const name = (key === 'id' || key === 'ids' ? ID_OF[channel] ?? channel.split(':')[0].replace(/s$/, '') : key.replace(/Ids?$/, '')).toLowerCase()
  const base = Object.keys(TABLE).filter((k) => name.endsWith(k.toLowerCase())).sort((p, q) => q.length - p.length)[0]
  const table = TABLE[base] ?? 'entity'
  const db = peek()
  try {
    const offset = n + (/^(target|to)/.test(key) ? 1 : 0)
    // An encounter or building id is a card of that type.
    const type = base === 'encounter' ? 'Encounter' : base === 'building' ? 'Building' : null
    const row = (type ? db.prepare(`SELECT id FROM entity WHERE type = ? ORDER BY rowid DESC LIMIT 1 OFFSET ?`).get(type, offset) : undefined)
      ?? db.prepare(`SELECT id FROM ${table} ORDER BY rowid DESC LIMIT 1 OFFSET ?`).get(offset)
    return (row as { id: string } | undefined)?.id ?? '00000000-0000-4000-8000-000000000000'
  } finally { db.close() }
}

/** A plain valid value for a Zod schema (zod 4 internals: `_zod.def`); `n` = place in a list. */
function sample(s: z.ZodType, key: string, channel: string, n = 0): unknown {
  const def = (s as unknown as { _zod: { def: Record<string, unknown> } })._zod.def
  const limits = s as unknown as { minValue: number | null; maxValue: number | null; minLength: number | null }
  const check = (k: string) => (def.checks as Array<{ _zod: { def: Record<string, number> } }> | undefined)?.map((c) => c._zod.def[k]).find((v) => v !== undefined) ?? 0
  if (key === 'polygon') return [[10, 10], [200, 10], [10, 200]]
  const inner = (x: unknown, i = n) => sample(x as z.ZodType, key, channel, i)
  switch (def.type) {
    case 'optional': case 'nullable': case 'default': case 'readonly': case 'catch': case 'nonoptional': return inner(def.innerType)
    case 'pipe': return inner(def.in)
    case 'lazy': return inner((def.getter as () => unknown)())
    case 'void': case 'undefined': return undefined
    case 'null': return null
    case 'boolean': return true
    case 'literal': return (def.values as unknown[])[0]
    case 'enum': return Object.values(def.entries as object)[0]
    case 'union': return inner((def.options as unknown[])[0])
    case 'tuple': return (def.items as unknown[]).map((x) => inner(x))
    case 'array': return Array.from({ length: Math.max(1, check('minimum'), check('length')) }, (_, i) => inner(def.element, i))
    case 'record': return {}
    case 'object': return Object.fromEntries(Object.entries(def.shape as object).map(([k, v]) => [k, sample(v, k, channel, n)]))
    case 'number': case 'int': {
      const want = /end/i.test(key) ? 60 : 1
      return Math.min(limits.maxValue ?? want, Math.max(limits.minValue ?? want, want))
    }
    case 'string': {
      if ((s as unknown as { format: string | null }).format === 'uuid' || /Ids?$|^ids?$/.test(key)) return idFor(key, channel, n)
      if (key === 'srdKey' || (key === 'key' && /^(srd|encounter):/.test(channel))) return SRD_KEY
      return ['Undo test', '#336699', '2026-10-21', 'npc', '1'].map((v) => v.padEnd(limits.minLength ?? 0, '.')).find((v) => s.safeParse(v).success) ?? 'Undo test'
    }
    default: return undefined
  }
}

/** Every row of every table but the command log, in a fixed order. */
function snapshot(): string {
  const db = peek()
  try {
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('command', '__drizzle_migrations') ORDER BY name`).all() as Array<{ name: string }>).map((t) => t.name)
    return JSON.stringify(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}" ORDER BY 1`).all()]))
  } finally { db.close() }
}
const doneCommands = () => { const db = peek(); try { return (db.prepare(`SELECT count(*) AS n FROM command WHERE state = 'done'`).get() as { n: number }).n } finally { db.close() } }

afterAll(() => rmSync(work, { recursive: true, force: true }))

it('every write can be undone and redone exactly', { timeout: 120000 }, async () => {
  registerIpc(() => null, new ProfileStore(work), new KeyStore(work, { isEncryptionAvailable: () => false, encryptString: (t: string) => Buffer.from(t), decryptString: (b: Buffer) => b.toString() } as never), () => undefined, () => undefined,
    { pop: () => undefined, focus: () => undefined, popped: () => [], closeAll: () => undefined, popNote: () => undefined })
  const call = (channel: string, input?: unknown) => handlers.get(IPC_PREFIX + channel)!({ sender: null }, input)
  expect((await call('campaign:openRecent', { folder })).ok).toBe(true)
  // Things the fixture lacks, so the channels that need them have one: a session under way, a link, a region, a note, a prep sheet with a line.
  const [a, b] = (() => { const db = peek(); try { return (db.prepare(`SELECT id FROM entity ORDER BY rowid LIMIT 2`).all() as Array<{ id: string }>).map((r) => r.id) } finally { db.close() } })()
  for (const [channel, input] of [
    ['session:start', undefined],
    ['relationship:create', { sourceId: a, targetId: b, type: 'ally', isSecret: false }],
    ['region:create', { mapId: '5e0c3a1b-6d2f-4c8e-9a7b-1f2e3d4c5b6a', polygon: [[10, 10], [200, 10], [10, 200]], newName: 'Undo hills' }],
    ['prep:create', { number: 1 }],
    ['notedoc:create', { title: 'Undo note' }]
  ] as const) { const r = await call(channel, input); expect(r.error ?? channel).toBe(channel) }
  expect((await call('prepItem:add', { prepId: idFor('prepId', '', 0), kind: 'scene' })).ok).toBe(true)

  const wrote: string[] = [], read: string[] = [], failed: string[] = [], problems: string[] = []
  for (const channel of Object.keys(ipcInputs).sort()) {
    if (NOT_RUN.has(channel)) continue
    const input = sample(ipcInputs[channel as keyof typeof ipcInputs] as z.ZodType, '', channel)
    const before = snapshot(), commandsBefore = doneCommands()
    const r = await call(channel, input)
    const after = snapshot(), steps = doneCommands() - commandsBefore
    if (!r.ok && after === before) { failed.push(channel); if (process.env.DZ_WHY) console.log(channel, String(JSON.stringify(input)).slice(0, 160), '=>', r.error?.slice(0, 200)); continue }
    if (after === before) { read.push(channel); continue }
    wrote.push(channel)
    if (steps === 0) { problems.push(`${channel}: changed the campaign without CommandLog.run (nothing to undo)`); continue }
    for (let i = 0; i < steps; i++) await call('history:undo')
    if (snapshot() !== before) problems.push(`${channel}: undo did not bring back the rows from before`)
    for (let i = 0; i < steps; i++) await call('history:redo')
    if (snapshot() !== after) problems.push(`${channel}: redo did not bring back the rows after`)
  }
  await call('campaign:close')
  expect(problems).toEqual([])
  expect({ wrote, read, failed }).toMatchSnapshot()
})
