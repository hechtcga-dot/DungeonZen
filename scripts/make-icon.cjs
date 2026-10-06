// Renders build/icon.svg to build/icon.png (1024) and build/icon.ico (16 to 256),
// using Electron's own Chromium. Run: npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8')
const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function render(win, size) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`))
  win.setContentSize(size, size)
  await new Promise((ok) => setTimeout(ok, 150))
  return (await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })).toPNG()
}

/** An .ico whose images are PNGs (Windows Vista and later read these). */
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4)
  let offset = 6 + 16 * pngs.length
  const entries = pngs.map(({ size, png }) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12)
    offset += png.length
    return e
  })
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } })
  writeFileSync(join(root, 'build', 'icon.png'), await render(win, 1024))
  const pngs = []
  for (const size of SIZES) pngs.push({ size, png: await render(win, size) })
  writeFileSync(join(root, 'build', 'icon.ico'), ico(pngs))
  console.log('icon.png and icon.ico written')
  app.quit()
})
