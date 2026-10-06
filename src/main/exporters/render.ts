import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { PAGE_WIDTH, type PageSize } from './pages'

// Renders our own HTML pages (no remote content, all text escaped) in a hidden window.

async function withPage<T>(html: string, width: number, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'dz-export-'))
  const file = join(dir, 'page.html')
  writeFileSync(file, html, 'utf8')
  const win = new BrowserWindow({
    show: false, width, height: 1123, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await win.loadFile(file)
    return await fn(win)
  } finally {
    win.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
}

export function renderPdf(html: string, size: PageSize): Promise<Buffer> {
  return withPage(html, PAGE_WIDTH[size], (win) => win.webContents.printToPDF({
    pageSize: size, printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 }, preferCSSPageSize: false
  }))
}

/** One image of the whole page (as tall as its content). */
export function renderJpg(html: string, size: PageSize): Promise<Buffer> {
  const width = PAGE_WIDTH[size]
  return withPage(html, width, async (win) => {
    const height = Number(await win.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)')) || 1123
    win.setContentSize(width, Math.min(height, 12000))
    await new Promise((ok) => setTimeout(ok, 120))
    const img = await win.webContents.capturePage({ x: 0, y: 0, width, height: Math.min(height, 12000) })
    return img.toJPEG(90)
  })
}
