import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { readZipEntry } from './zip'

// Notes import, step 1: read the DM's files on this computer (nothing leaves it yet).
// Text comes out in chunks with a locator ("paragraphs 4–18", "page 3") so every
// proposal can say where it came from. Pictures go to the AI as images.

export const NOTE_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx', '.pdf', '.png', '.jpg', '.jpeg', '.webp']
export const CHUNK_CHARS = 9000

export interface Chunk { locator: string; text: string }
export interface NotesFile {
  name: string
  kind: 'text' | 'word' | 'pdf' | 'picture'
  chunks: Chunk[]
  image: { bytes: Buffer; mime: string } | null
  warnings: string[]
}

/** Groups numbered blocks (paragraphs or pages) into chunks of about CHUNK_CHARS. */
export function chunkBlocks(blocks: string[], unit: 'paragraph' | 'page'): Chunk[] {
  const chunks: Chunk[] = []
  let cur: string[] = []
  let first = 1
  let size = 0
  const flush = (last: number) => {
    if (!cur.length) return
    const label = unit === 'page' ? (first === last ? `page ${first}` : `pages ${first}–${last}`) : (first === last ? `paragraph ${first}` : `paragraphs ${first}–${last}`)
    chunks.push({ locator: label, text: cur.join('\n\n') })
    cur = []; size = 0
  }
  blocks.forEach((b, i) => {
    const t = b.trim()
    if (size > 0 && size + t.length > CHUNK_CHARS) { flush(i); first = i + 1 }
    if (!cur.length) first = i + 1
    // A block longer than a chunk is split; the locator stays the block's number.
    if (t.length > CHUNK_CHARS) {
      for (let k = 0; k < t.length; k += CHUNK_CHARS) { cur.push(t.slice(k, k + CHUNK_CHARS)); size += CHUNK_CHARS; flush(i + 1); first = i + 1 }
      return
    }
    cur.push(`[${unit === 'page' ? 'p' : '¶'}${i + 1}] ${t}`)
    size += t.length
  })
  flush(blocks.length)
  return chunks
}

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

/** Paragraphs of a Word document, headings and table cells included, in order. */
export function docxParagraphs(file: Buffer): string[] {
  const xml = readZipEntry(file, 'word/document.xml')
  if (!xml) throw new Error('This Word file has no document text')
  const body = xml.toString('utf8')
  const out: string[] = []
  for (const m of body.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0]
      .replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n')
      .match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|\t|\n/g)?.map((t) => (t.startsWith('<') ? unxml(t.replace(/<[^>]+>/g, '')) : t)).join('') ?? ''
    if (p.trim()) out.push(p.trim())
  }
  return out
}

/** Text of each PDF page (empty for scanned pages). */
export async function pdfPages(file: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(file), disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise
  const pages: string[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const content = await page.getTextContent()
    let text = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      text += item.str + (item.hasEOL ? '\n' : '')
    }
    pages.push(text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
  }
  await doc.destroy()
  return pages
}

export async function readNotesFile(path: string): Promise<NotesFile> {
  const name = basename(path)
  const ext = extname(path).toLowerCase()
  if (!NOTE_EXTENSIONS.includes(ext)) throw new Error(`${name}: notes must be text, Markdown, Word (.docx), PDF or a picture (PNG, JPEG, WebP)`)
  const bytes = readFileSync(path)
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    if (bytes.length > 15 * 1024 * 1024) throw new Error(`${name}: the picture is over 15 MB; save a smaller copy`)
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    return { name, kind: 'picture', chunks: [{ locator: 'the picture', text: '' }], image: { bytes, mime }, warnings: [] }
  }
  if (ext === '.docx') {
    return { name, kind: 'word', chunks: chunkBlocks(docxParagraphs(bytes), 'paragraph'), image: null, warnings: [] }
  }
  if (ext === '.pdf') {
    const pages = await pdfPages(bytes)
    const warnings: string[] = []
    const empty = pages.filter((p) => p.length < 20).length
    if (pages.length && empty === pages.length) {
      throw new Error(`${name}: this PDF has no text (it looks scanned). Save its pages as pictures and import those.`)
    }
    if (empty) warnings.push(`${empty} of ${pages.length} pages have no text (scanned?) and were skipped.`)
    return { name, kind: 'pdf', chunks: chunkBlocks(pages.map((p) => p || ''), 'page').filter((c) => c.text.replace(/\[p\d+\]/g, '').trim()), image: null, warnings }
  }
  const text = bytes.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  return { name, kind: 'text', chunks: chunkBlocks(text.split(/\n\s*\n/).filter((p) => p.trim()), 'paragraph'), image: null, warnings: [] }
}
