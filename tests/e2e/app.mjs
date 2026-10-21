// What the smoke test and the playtest share: start the app (built, or installed with DZ_EXE), size its window
// (with DZ_SCALE also the display scaling), collect window and console errors, make a plain PNG.
import { _electron } from 'playwright-core'
import { crc32, deflateSync } from 'node:zlib'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
export const scale = process.env.DZ_SCALE ?? ''

/** Starts Dungeon Zen with its settings in `userData`. `problems` collects window and console errors. */
export async function launch(userData, problems) {
  const app = await _electron.launch({
    executablePath: process.env.DZ_EXE || undefined,
    // Linux CI runners block Chromium's sandbox helper.
    args: [...(process.env.DZ_EXE ? [] : [join(root, 'out', 'main', 'index.js')]), ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
      ...(scale ? [`--force-device-scale-factor=${scale}`] : [])],
    env: { ...process.env, DZ_USER_DATA: userData },
    timeout: 60000
  })
  // The app's own output (a failed start shows here).
  app.process().stdout?.on('data', (d) => process.stdout.write(d))
  app.process().stderr?.on('data', (d) => process.stderr.write(d))
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (e) => problems.push(`window error: ${e.message}`))
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
  // Window size; with DZ_SCALE also the display scaling (Playwright's own size setting resets it to 100 %).
  const cdp = scale ? await page.context().newCDPSession(page) : null
  const setSize = async (size) => {
    await page.setViewportSize(size)
    await cdp?.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: Number(scale), mobile: false })
  }
  await setSize({ width: 1440, height: 900 })
  // At 150 % a 1920×1080 laptop screen is 1280×720 of page space: the smoke test's smaller-window check covers that.
  if (scale && String(await page.evaluate(() => devicePixelRatio)) !== scale) problems.push(`display scaling not applied: ${await page.evaluate(() => devicePixelRatio)}`)
  /** A screenshot; scaled, the real device pixels (Playwright's own screenshot is at 100 %), where blurry art shows. */
  const screenshot = async (path) => {
    if (cdp) (await import('node:fs')).writeFileSync(path, Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
    else await page.screenshot({ path })
  }
  return { app, page, setSize, screenshot }
}

/** A plain PNG: an oval of land in the sea. */
export function png(w, h) {
  const chunk = (type, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(type, 4); data.copy(b, 8); b.writeUInt32BE(crc32(b.subarray(4, 8 + data.length)), 8 + data.length); return b }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  const rows = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; const land = (x - w / 2) ** 2 / (w * w / 9) + (y - h / 2) ** 2 / (h * h / 9) < 1; rows[i] = land ? 190 : 90; rows[i + 1] = land ? 170 : 130; rows[i + 2] = land ? 110 : 170 }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))])
}
