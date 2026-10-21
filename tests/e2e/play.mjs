// Play the app by hand from scripts: the simulated user (skill `playtest`) drives the built app through this.
// Starts the built app with an empty userData folder (a brand-new DM: start screen, no campaigns) and listens on
// http://127.0.0.1:4777. POST a script body: it runs as `async ({ page, app, shot }) => { <body> }`, then a
// screenshot is saved; the reply is JSON { result, shot, errors } (errors: window/console errors since the last step).
// `node tests/e2e/play.mjs [folder for screenshots]`; on Linux under xvfb-run -s "-screen 0 1920x1080x24".
// POST /quit closes the app.
import { _electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const shots = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'dz-play-shots-'))
const userData = mkdtempSync(join(tmpdir(), 'dz-play-'))
mkdirSync(shots, { recursive: true })
const app = await _electron.launch({
  args: [join(root, 'out', 'main', 'index.js'), ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  env: { ...process.env, DZ_USER_DATA: userData }
})
const page = await app.firstWindow()
await page.setViewportSize({ width: 1440, height: 900 })
page.setDefaultTimeout(5000)
let errors = []
page.on('pageerror', (e) => errors.push(`window error: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
let n = 0
const shot = async (name = 'step') => { const p = join(shots, `${String(++n).padStart(3, '0')}-${name}.png`); await page.screenshot({ path: p }); return p }

createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  if (req.url === '/quit') { res.end('bye'); await app.close(); process.exit(0) }
  let result
  try { result = await new Function('return async ({ page, app, shot }) => {\n' + body + '\n}')()({ page, app, shot }) } catch (e) { result = `failed: ${e.message.split('\n')[0]}` }
  await page.waitForTimeout(300)
  const out = { result, shot: await shot(), errors }
  errors = []
  res.end(JSON.stringify(out, null, 1))
}).listen(4777, '127.0.0.1', () => console.log(`Playing: http://127.0.0.1:4777, screenshots in ${shots}, campaigns in ${userData}`))
