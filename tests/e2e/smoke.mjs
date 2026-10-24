// Screenshot smoke test: opens a campaign in the built app and visits every screen, then the action round-trip.
// Fails on a window error, a console error or an error message on screen. Screenshots in tests/e2e/shots/.
// Needs `npm run build` and better-sqlite3 built for Electron (`npx electron-builder install-app-deps`;
// `npm rebuild better-sqlite3` brings back the Node build for `npm test`). On Linux run it under xvfb-run.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { buttonSamples, layoutProblems, mapCentred, uiProblems } from './uiChecks.mjs'
import { launch, png, scale } from './app.mjs'
import { roundTrip } from './roundtrip.mjs'

const root = join(import.meta.dirname, '..', '..')
// The app starts in the Adventure UI (default since 3.8.0); DZ_SKIN=desk runs the same screens in the Desk UI, screenshots in shots-desk/.
// DZ_SCALE=1.5 runs them at Windows display scaling 150 % (most laptops: 125–150 %), screenshots in shots-scale150/.
// DZ_EXE=<path to DungeonZen.exe> runs the installed app instead of the built one (Windows installer workflow).
const skin = process.env.DZ_SKIN ?? ''
const shots = join(import.meta.dirname, ['shots', skin, scale && `scale${Math.round(scale * 100)}`].filter(Boolean).join('-'))
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
let app
try {
  const started = await launch(userData, problems)
  app = started.app
  const { page, setSize, screenshot } = started
  if (skin) { await page.evaluate((s) => localStorage.setItem('dz.skin', s), skin); await page.reload(); await page.waitForLoadState() }
  let n = 0
  const shot = async (name) => {
    await page.waitForTimeout(800)
    const alert = page.locator('.toast-error')
    if (await alert.count()) problems.push(`${name}: error on screen: ${await alert.first().innerText()}`)
    for (const p of await page.evaluate(uiProblems)) problems.push(`${name}: ${p}`)
    for (const p of await page.evaluate(layoutProblems)) problems.push(`${name}: ${p}`)
    for (const p of await faintButtons()) problems.push(`${name}: ${p}`)
    // A smaller window too (a laptop): checked, no screenshot.
    await setSize({ width: 1280, height: 720 })
    await page.waitForTimeout(400)
    for (const p of [...await page.evaluate(uiProblems), ...await page.evaluate(layoutProblems)]) problems.push(`${name} (1280×720): ${p}`)
    await setSize({ width: 1440, height: 900 })
    await page.waitForTimeout(300)
    await screenshot(join(shots, `${String(++n).padStart(2, '0')}-${name}.png`))
  }
  // Button words readable on the button's real background (pixels of the window: painted parchment, wood…).
  const faintButtons = async () => {
    const { list, width } = await page.evaluate(buttonSamples)
    return app.evaluate(async ({ BrowserWindow }, { list, width }) => {
      // Right after start the compositor can refuse the first capture (UnknownVizError on CI): one retry.
      const capture = () => BrowserWindow.getAllWindows()[0].webContents.capturePage()
      const img = await capture().catch(() => new Promise((r) => setTimeout(r, 1000)).then(capture))
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
    await setSize(size); await page.waitForTimeout(400)
    const off = await page.evaluate(mapCentred)
    if (off) problems.push(`map (${size.width}×${size.height}): ${off}`)
  }
  await setSize({ width: 1440, height: 900 })
  await click('Board'); await click('Timeline'); await shot('timeline')
  // Calendar (3.9): month, the side panel, week, day, year; the event window and Calendar settings.
  await click('Calendar'); await shot('calendar-month')
  await click('Settings ›'); await shot('calendar-panel')
  await click('Calendar settings…'); await page.locator('.cal-settings').waitFor(); await shot('calendar-settings'); await click('Cancel')
  await click('‹ Settings')
  for (const v of ['Week', 'Day', 'Year']) { await click(v); await shot(`calendar-${v.toLowerCase()}`) }
  await click('Month'); await click('+ Add event'); await page.locator('#ev-title').waitFor(); await shot('event-window'); await click('Cancel')
  // Board side panel: a card selected (Inspector), then History.
  await click('Board'); await page.locator('.react-flow__node', { hasText: 'Barliman Butterbur' }).first().click(); await shot('board-inspector')
  await page.getByRole('tab', { name: 'History', exact: true }).click(); await shot('board-history')
  await page.getByRole('tab', { name: 'Inspector', exact: true }).click()
  await click('Library'); await shot('library')
  await page.getByRole('tab', { name: 'Tokens' }).click(); await shot('library-tokens')
  await page.getByRole('tab', { name: 'Cards and rules' }).click()
  await click('Notes'); await shot('notes')
  // Character sheets with long file names (the file window answered by the test): Make a character card, then Import notes.
  const sheetText = 'Raph, Tortle Sorcerer, Level 9\nArmor Class 18, Proficiency Bonus +4\nStrength 11, Dexterity 12, Constitution 16, Intelligence 10, Wisdom 10, Charisma 18\n'
    + 'Acrobatics +1, Animal Handling +0, Arcana +0, Athletics +0, Deception +8, History +0, Insight +0, Intimidation +4, Investigation +0, Medicine +0, Nature +0, Perception +4, Stealth +5\n'
  const sheets = ['DR8_002_Warforged_Cleric_Fighter_Character_Sheet.txt', 'Raph_Character_Sheet.txt', 'Campaign plot points.txt', 'Factions.txt', 'Session One - One Page.txt', 'ONe Page DM Tool.txt', 'Random Encounters.txt'].map((f) => { const p = join(work, f); writeFileSync(p, sheetText); return p })
  await app.evaluate(({ dialog }, paths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths }) }, sheets)
  await click('Import a character sheet…'); await page.getByRole('button', { name: 'Read with AI' }).waitFor(); await shot('charsheet-window')
  // A small window too (the file names in three columns get tight).
  await setSize({ width: 900, height: 700 }); await page.waitForTimeout(400)
  for (const p of [...await page.evaluate(uiProblems), ...await page.evaluate(layoutProblems)]) problems.push(`charsheet-window (900×700): ${p}`)
  await setSize({ width: 1440, height: 900 }); await page.waitForTimeout(300)
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
  // Action round-trip (tests/e2e/roundtrip.mjs): two cards made, edited, undone, redone, to History and back, every screen checked.
  problems.push(...await roundTrip(page))
} catch (err) {
  problems.push(`step failed: ${err.message}`)
} finally {
  await app?.close().catch(() => undefined)
  rmSync(work, { recursive: true, force: true })
}
if (problems.length) {
  console.error(`Smoke test found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`Smoke test passed: screenshots in ${shots}`)
