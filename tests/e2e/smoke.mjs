// Screenshot smoke test: opens a campaign in the built app and visits every screen.
// Fails on a window error, a console error or an error message on screen. Screenshots in tests/e2e/shots/.
// Needs `npm run build` and better-sqlite3 built for Electron (`npx electron-builder install-app-deps`;
// `npm rebuild better-sqlite3` brings back the Node build for `npm test`). On Linux run it under xvfb-run.
import { _electron } from 'playwright-core'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { buttonSamples, layoutProblems, mapCentred, uiProblems } from './uiChecks.mjs'

const root = join(import.meta.dirname, '..', '..')
// DZ_SKIN=adventure runs the same screens in the Adventure UI skin (3.1), screenshots in shots-adventure/.
const skin = process.env.DZ_SKIN ?? ''
// DZ_SCALE=1.5 runs it as Windows display scaling 150% (most laptops), screenshots in shots-scale-1.5/.
const scale = process.env.DZ_SCALE ?? ''
const shots = join(import.meta.dirname, ['shots', skin, scale && `scale-${scale}`].filter(Boolean).join('-'))
const work = mkdtempSync(join(tmpdir(), 'dz-smoke-'))
const folder = join(work, 'Smoke campaign')
const userData = join(work, 'userData')
rmSync(shots, { recursive: true, force: true })
mkdirSync(shots, { recursive: true })
mkdirSync(join(folder, 'assets'), { recursive: true })
mkdirSync(userData, { recursive: true })

// The campaign: the newest fixture, past the getting started guide; the app lists it as a recent campaign.
copyFileSync(join(root, 'tests', 'fixtures', 'campaign-v2.10.1.db'), join(folder, 'campaign.db'))
writeFileSync(join(userData, 'profile.json'), JSON.stringify({ recent: [{ folder, name: 'Old campaign', openedAt: new Date().toISOString() }] }))
// node:sqlite, not better-sqlite3: that one is built for Electron while this runs.
const db = new DatabaseSync(join(folder, 'campaign.db'))
db.exec(`UPDATE campaign_settings SET value = '"done"' WHERE key = 'getting_started'`)
// A wide world map (a plain PNG made here), so Map, Desk and Live show one.
const png = (w, h) => {
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  const rows = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; const land = (x - w / 2) ** 2 / (w * w / 9) + (y - h / 2) ** 2 / (h * h / 9) < 1; rows[i] = land ? 190 : 90; rows[i + 1] = land ? 170 : 130; rows[i + 2] = land ? 110 : 170 }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
mkdirSync(join(folder, 'assets', 'maps'), { recursive: true })
writeFileSync(join(folder, 'assets', 'maps', 'smoke-map.png'), png(1600, 500))
// Long names, as real campaigns have them: the look checks must hold for those too.
db.exec(`INSERT INTO map (id, name, image_path, width, height, status) VALUES ('5e0c3a1b-6d2f-4c8e-9a7b-1f2e3d4c5b6a', 'The Long Coast of the Sunken Kingdoms', 'maps/smoke-map.png', 1600, 500, 'active')`)
db.exec(`INSERT INTO campaign_settings (key, value) VALUES ('active_map_id', '"5e0c3a1b-6d2f-4c8e-9a7b-1f2e3d4c5b6a"')`)
// A card moved to History, so the board's History list shows its sort and select buttons.
db.exec(`INSERT INTO entity (id, type, name, attributes, tags, status, created_at) VALUES ('7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e', 'NPC', 'Old Tom the Ferryman of the Misty Crossing', '{}', '[]', 'defunct', '2026-10-19T15:00:00.000Z')`)
db.exec(`UPDATE storyline SET title = 'Countdown to the Reign of Misule the Undying Queen'`)
db.close()

const problems = []
// Pictures that failed to load and fonts that failed (runs in the window).
const missingFiles = () => [
  ...[...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src).map((i) => `picture did not load: ${i.src.slice(0, 120)}`),
  ...[...document.fonts].filter((f) => f.status === 'error').map((f) => `font did not load: ${f.family} ${f.weight}`)
]
const app = await _electron.launch({
  // Linux CI runners block Chromium's sandbox helper.
  // DZ_APP: an installed DungeonZen.exe instead of the build in out/ (the release workflow tests the real installer).
  ...(process.env.DZ_APP ? { executablePath: process.env.DZ_APP } : {}),
  args: [...(process.env.DZ_APP ? [] : [join(root, 'out', 'main', 'index.js')]), ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(scale ? [`--force-device-scale-factor=${scale}`] : [])],
  env: { ...process.env, DZ_USER_DATA: userData },
  timeout: 60000
})
// The app's own output (a failed start shows here).
app.process().stdout?.on('data', (d) => process.stdout.write(d))
app.process().stderr?.on('data', (d) => process.stderr.write(d))
try {
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (e) => problems.push(`window error: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
  await page.setViewportSize({ width: 1440, height: 900 })
  if (skin) { await page.evaluate((s) => localStorage.setItem('dz.skin', s), skin); await page.reload(); await page.waitForLoadState() }
  let n = 0
  const shot = async (name) => {
    await page.waitForTimeout(800)
    const alert = page.locator('.toast-error')
    if (await alert.count()) problems.push(`${name}: error on screen: ${await alert.first().innerText()}`)
    for (const p of await page.evaluate(uiProblems)) problems.push(`${name}: ${p}`)
    for (const p of await page.evaluate(layoutProblems)) problems.push(`${name}: ${p}`)
    for (const p of await faintButtons()) problems.push(`${name}: ${p}`)
    for (const p of await page.evaluate(missingFiles)) problems.push(`${name}: ${p}`)
    // A smaller window too (a laptop): checked, no screenshot.
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.waitForTimeout(400)
    for (const p of [...await page.evaluate(uiProblems), ...await page.evaluate(layoutProblems)]) problems.push(`${name} (1280×720): ${p}`)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(shots, `${String(++n).padStart(2, '0')}-${name}.png`) })
  }
  // Button words readable on the button's real background (pixels of the window: painted parchment, wood…).
  const faintButtons = async () => {
    const { list, width } = await page.evaluate(buttonSamples)
    return app.evaluate(async ({ BrowserWindow }, { list, width }) => {
      const img = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
      const { width: w, height: h } = img.getSize()
      const px = img.toBitmap() // BGRA
      const k = w / width
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) }
      const out = []
      for (const b of list) {
        const samples = b.points.map(([x, y]) => {
          const i = (Math.min(h - 1, Math.round(y * k)) * w + Math.min(w - 1, Math.round(x * k))) * 4
          return { r: px[i + 2], g: px[i + 1], b: px[i] }
        }).sort((p, q) => lum(p) - lum(q))
        const bg = samples[Math.floor(samples.length / 2)]
        const a = b.fg.a
        const fg = { r: b.fg.r * a + bg.r * (1 - a), g: b.fg.g * a + bg.g * (1 - a), b: b.fg.b * a + bg.b * (1 - a) }
        const [hi, lo] = [lum(fg), lum(bg)].sort((p, q) => q - p)
        const ratio = (hi + 0.05) / (lo + 0.05)
        if (ratio < 3) out.push(`button words hard to see on its background (contrast ${ratio.toFixed(1)}:1${b.off ? ', unavailable' : ''}): ${b.what}`)
      }
      return out
    }, { list, width })
  }
  const click = (text) => page.getByRole('button', { name: text, exact: true }).first().click()
  // A change shows on every screen it touches (owner, 2026-10-06), and undo, redo, History and Revive bring it back.
  // Catches cards that vanish after a refresh, clicks that don't select, a screen that kept the old name.
  // Esc first clears a filled field, then closes.
  const closeDialogs = async () => { for (let i = 0; i < 3 && await page.locator('dialog[open]').count(); i++) await page.keyboard.press('Escape') }
  const shows = async (step, name, want) => {
    const where = {
      board: async () => { await click('Board'); return page.locator('.react-flow__node', { hasText: name }).count() },
      // Find lists it; Enter opens its sheet (the sheet shows the name).
      find: async () => {
        await page.keyboard.press('Control+f'); await page.getByRole('searchbox', { name: 'Find', exact: true }).fill(name); await page.waitForTimeout(300)
        const n = await page.locator('.find-list .find-name').filter({ hasText: new RegExp(`^${name}$`) }).count()
        if (!n) { await closeDialogs(); return 0 }
        await page.keyboard.press('Enter'); await page.getByRole('tab', { name: /Links & secrets/ }).waitFor()
        const onSheet = await page.locator(`input[value="${name}"], :text-is("${name}")`).count()
        if (!onSheet) problems.push(`after ${step}: the sheet does not show "${name}"`)
        return n
      }
    }
    for (const [screen, count] of Object.entries(where)) {
      const n = await count()
      if ((n > 0) !== want) problems.push(`after ${step}: ${screen} ${want ? 'does not show' : 'still shows'} "${name}"`)
    }
  }
  const roundTrip = async () => {
    const [before, after] = ['Barliman Butterbur', 'Barliman the Smoke Tester']
    await click('Board'); await page.locator('.react-flow__node', { hasText: before }).first().click()
    const field = page.locator('.inspector').getByLabel('Name', { exact: true })
    await field.fill(after); await field.press('Enter'); await page.waitForTimeout(400)
    await shows('rename', after, true); await shows('rename', before, false)
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await page.waitForTimeout(400)
    await shows('undo', before, true); await shows('undo', after, false)
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); await page.waitForTimeout(400)
    await shows('redo', after, true)
    await click('Board'); await page.locator('.react-flow__node', { hasText: after }).first().click()
    await page.locator('.inspector-more summary').click(); await click('Move to History'); await page.waitForTimeout(400)
    if (await page.locator('.react-flow__node', { hasText: after }).count()) problems.push('after Move to History: card still on the board')
    await page.getByRole('tab', { name: 'History', exact: true }).click()
    await page.locator('li, .history-row, div').filter({ hasText: after }).getByRole('button', { name: 'Revive', exact: true }).first().click()
    await page.waitForTimeout(400)
    await shows('Revive', after, true)
    await shot('round-trip')
  }

  await shot('start')
  await page.getByRole('button', { name: /Old campaign/ }).first().click()
  await page.locator('.rail').waitFor()
  await shot('desk')
  for (const [label, name] of [['Session prep', 'prep'], ['Encounters', 'encounters'], ['Board', 'board']]) { await click(label); await shot(name) }
  await page.getByText('Barliman Butterbur').first().dblclick()
  await shot('sheet')
  await click('Draw with AI…'); await page.locator('.draw-advanced').waitFor(); await shot('draw-window')
  await click('Cancel')
  await page.getByRole('tab', { name: /Links & secrets/ }).click(); await shot('sheet-links')
  await page.locator('.link-row-main').first().click(); await page.locator('.link-window').waitFor(); await shot('link-window')
  await click('Cancel')
  await click('Board'); await click('Map'); await shot('map')
  // The map opens centred in what you can see of its frame (also in a smaller window).
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size); await page.waitForTimeout(400)
    const off = await page.evaluate(mapCentred)
    if (off) problems.push(`map (${size.width}×${size.height}): ${off}`)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await click('Board'); await click('Timeline'); await shot('timeline')
  // Board side panel: a card selected (Inspector), then History.
  await click('Board'); await page.locator('.react-flow__node', { hasText: 'Barliman Butterbur' }).first().click(); await shot('board-inspector')
  await page.getByRole('tab', { name: 'History', exact: true }).click(); await shot('board-history')
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click()
  for (const [label, name] of [['Library', 'library'], ['Notes', 'notes']]) { await click(label); await shot(name) }
  // Character sheets with long file names (the file window answered by the test): Make a character card, then Import notes.
  const sheetText = 'Raph, Tortle Sorcerer, Level 9\nArmor Class 18, Proficiency Bonus +4\nStrength 11, Dexterity 12, Constitution 16, Intelligence 10, Wisdom 10, Charisma 18\n'
    + 'Acrobatics +1, Animal Handling +0, Arcana +0, Athletics +0, Deception +8, History +0, Insight +0, Intimidation +4, Investigation +0, Medicine +0, Nature +0, Perception +4, Stealth +5\n'
  const sheets = ['DR8_002_Warforged_Cleric_Fighter_Character_Sheet.txt', 'Raph_Character_Sheet.txt', 'Campaign plot points.txt', 'Factions.txt', 'Session One - One Page.txt', 'ONe Page DM Tool.txt', 'Random Encounters.txt'].map((f) => { const p = join(work, f); writeFileSync(p, sheetText); return p })
  await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, sheets)
  await click('Import a character sheet…'); await page.getByRole('button', { name: 'Read with AI' }).waitFor(); await shot('charsheet-window')
  // A small window too (the file names in three columns get tight).
  await page.setViewportSize({ width: 900, height: 700 }); await page.waitForTimeout(400)
  for (const p of [...await page.evaluate(uiProblems), ...await page.evaluate(layoutProblems)]) problems.push(`charsheet-window (900×700): ${p}`)
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300)
  await click('Cancel')
  await click('Import notes…'); await click('Choose files…'); await page.getByRole('button', { name: 'Make a character card…' }).first().waitFor(); await shot('import-sheets')
  await click('Live desk'); await shot('live')
  await click('What they know'); await shot('players')
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Session prep', exact: true }).waitFor(); await click('Session prep'); await shot('back-to-prep')
  await page.keyboard.press('Control+f'); await page.getByRole('searchbox', { name: 'Find' }).fill('Barl'); await shot('find')
  await page.keyboard.press('Enter'); await page.getByRole('tab', { name: /Links & secrets/ }).waitFor(); await shot('find-opened-sheet')
  await click('Setup'); await page.getByText('Tidy campaign folder…').click(); await shot('tidy')
  await click('Close')
  await click('Setup'); await page.getByText('Linking names…').click(); await shot('linking-names')
  await click('Close')
  await roundTrip()
} catch (err) {
  problems.push(`step failed: ${err.message}`)
  // What was on screen when it stopped.
  await app.windows()[0]?.screenshot({ path: join(shots, 'failed.png') }).catch(() => undefined)
} finally {
  await app.close().catch(() => undefined)
  rmSync(work, { recursive: true, force: true })
}
if (problems.length) {
  console.error(`Smoke test found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`Smoke test passed: screenshots in ${shots}`)
