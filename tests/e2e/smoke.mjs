// Screenshot smoke test: opens a campaign in the built app and visits every screen.
// Fails on a window error, a console error or an error message on screen. Screenshots in tests/e2e/shots/.
// Needs `npm run build` and better-sqlite3 built for Electron (`npx electron-builder install-app-deps`;
// `npm rebuild better-sqlite3` brings back the Node build for `npm test`). On Linux run it under xvfb-run.
import { _electron } from 'playwright-core'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = join(import.meta.dirname, '..', '..')
const shots = join(import.meta.dirname, 'shots')
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
db.close()

const problems = []
const app = await _electron.launch({
  // Linux CI runners block Chromium's sandbox helper.
  args: [join(root, 'out', 'main', 'index.js'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
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
  let n = 0
  const shot = async (name) => {
    await page.waitForTimeout(800)
    const alert = page.locator('.toast-error')
    if (await alert.count()) problems.push(`${name}: error on screen: ${await alert.first().innerText()}`)
    await page.screenshot({ path: join(shots, `${String(++n).padStart(2, '0')}-${name}.png`) })
  }
  const click = (text) => page.getByRole('button', { name: text, exact: true }).first().click()

  await shot('start')
  await page.getByRole('button', { name: /Old campaign/ }).first().click()
  await page.locator('.rail').waitFor()
  await shot('desk')
  for (const [label, name] of [['Session prep', 'prep'], ['Encounters', 'encounters'], ['Board', 'board']]) { await click(label); await shot(name) }
  await page.getByText('Barliman Butterbur').first().dblclick()
  await shot('sheet')
  await page.getByRole('tab', { name: /Links & secrets/ }).click(); await shot('sheet-links')
  await page.locator('.link-row-main').first().click(); await page.locator('.link-window').waitFor(); await shot('link-window')
  await click('Cancel')
  await click('Board'); await click('Map'); await shot('map')
  await click('Board'); await click('Timeline'); await shot('timeline')
  for (const [label, name] of [['Library', 'library'], ['Notes', 'notes']]) { await click(label); await shot(name) }
  await click('Live'); await shot('live')
  await click('Players'); await shot('players')
  await click('Prep'); await shot('back-to-prep')
  await click('Setup'); await page.getByText('Tidy campaign folder…').click(); await shot('tidy')
  await click('Close')
  await click('Setup'); await page.getByText('Linking names…').click(); await shot('linking-names')
  await click('Close')
} catch (err) {
  problems.push(`step failed: ${err.message}`)
} finally {
  await app.close().catch(() => undefined)
  rmSync(work, { recursive: true, force: true })
}
if (problems.length) {
  console.error(`Smoke test found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log(`Smoke test passed: screenshots in ${shots}`)
