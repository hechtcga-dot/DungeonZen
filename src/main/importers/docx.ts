import { crc32, deflateRawSync } from 'node:zlib'
import { readZipEntry } from './zip'
import type { Block, Run } from '../../shared/noteDoc'

// Word files for the Notes screen: read a .docx into blocks (headings, bold/italic/underline,
// lists, tables), and write blocks back as a .docx that Word opens.

const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** `<w:b/>` or `<w:b w:val="true"/>` is on; `w:val="0"`, "false" or "none" is off. */
const on = (props: string, tag: string) => {
  const m = new RegExp(`<w:${tag}(?:\\s+w:val="([^"]*)")?\\s*/>`).exec(props)
  return !!m && !['0', 'false', 'none'].includes(m[1] ?? '')
}

function runsOf(para: string): Run[] {
  const runs: Run[] = []
  for (const m of para.matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
    const r = m[0]
    const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r)?.[1] ?? ''
    const text = (r.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br[^>]*\/>/g) ?? [])
      .map((t) => (t.startsWith('<w:tab') ? '\t' : t.startsWith('<w:br') ? '\n' : unxml(t.replace(/<[^>]+>/g, '')))).join('')
    if (!text) continue
    const run: Run = { text }
    if (on(props, 'b')) run.b = true
    if (on(props, 'i')) run.i = true
    if (on(props, 'u')) run.u = true
    const last = runs.at(-1)
    if (last && !!last.b === !!run.b && !!last.i === !!run.i && !!last.u === !!run.u) last.text += text
    else runs.push(run)
  }
  return runs
}

/** Reads a Word document's body in order. Pictures and page layout are not kept. */
export function readDocxBlocks(file: Buffer): Block[] {
  const doc = readZipEntry(file, 'word/document.xml')
  if (!doc) throw new Error('This Word file has no document text')
  // Which lists are numbered (the rest are bullets).
  const numbering = readZipEntry(file, 'word/numbering.xml')?.toString('utf8') ?? ''
  const numberedAbstract = new Set<string>()
  for (const a of numbering.matchAll(/<w:abstractNum [^>]*w:abstractNumId="(\d+)"[\s\S]*?<\/w:abstractNum>/g)) {
    const lvl0 = /<w:lvl [^>]*w:ilvl="0"[\s\S]*?<w:numFmt w:val="([^"]+)"/.exec(a[0])
    if (lvl0 && lvl0[1] !== 'bullet' && lvl0[1] !== 'none') numberedAbstract.add(a[1])
  }
  const numbered = new Set<string>()
  for (const n of numbering.matchAll(/<w:num [^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g)) if (numberedAbstract.has(n[2])) numbered.add(n[1])

  const body = doc.toString('utf8')
  const blocks: Block[] = []
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const part = m[0]
    if (part.startsWith('<w:tbl>')) {
      const rows = [...part.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((tr) =>
        [...tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((tc) => {
          const paras = [...tc[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => runsOf(p[0]))
          return paras.flatMap((runs, i) => (i ? [{ text: '\n' }, ...runs] : runs))
        }))
      if (rows.length) blocks.push({ kind: 'table', rows })
      continue
    }
    const runs = runsOf(part)
    if (!runs.some((r) => r.text.trim())) continue
    const style = /<w:pStyle w:val="([^"]+)"/.exec(part)?.[1] ?? ''
    const numId = /<w:numPr>[\s\S]*?<w:numId w:val="(\d+)"/.exec(part)?.[1]
    const kind = /^(Heading1|Title)$/i.test(style) ? 'h1' : /^(Heading2|Subtitle)$/i.test(style) ? 'h2' : /^Heading[3-9]$/i.test(style) ? 'h3'
      : numId && numId !== '0' ? (numbered.has(numId) ? 'number' : 'bullet') : 'p'
    blocks.push({ kind, runs })
  }
  return blocks
}

function runXml(r: Run): string {
  const props = `${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.u ? '<w:u w:val="single"/>' : ''}`
  const parts = r.text.split(/(\n|\t)/).map((t) => (t === '\n' ? '<w:br/>' : t === '\t' ? '<w:tab/>' : t ? `<w:t xml:space="preserve">${xml(t)}</w:t>` : '')).join('')
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${parts}</w:r>`
}

function paraXml(kind: string, runs: Run[]): string {
  const ppr = kind === 'h1' ? '<w:pStyle w:val="Heading1"/>' : kind === 'h2' ? '<w:pStyle w:val="Heading2"/>' : kind === 'h3' ? '<w:pStyle w:val="Heading3"/>'
    : kind === 'bullet' ? '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    : kind === 'number' ? '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>' : ''
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs.map(runXml).join('')}</w:p>`
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`
const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`

/** A Word document (.docx) of these blocks. */
export function writeDocx(blocks: Block[]): Buffer {
  const body = blocks.map((b) => (b.kind === 'table'
    ? `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${b.rows.map((row) =>
      `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paraXml('p', cell)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
    : paraXml(b.kind, b.runs))).join('')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body || '<w:p/>'}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`
  return writeZip([
    ['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', RELS], ['word/_rels/document.xml.rels', DOC_RELS],
    ['word/document.xml', document], ['word/styles.xml', STYLES], ['word/numbering.xml', NUMBERING]
  ])
}

/** A zip archive of text files (deflated). */
export function writeZip(entries: Array<[string, string]>): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const [name, text] of entries) {
    const raw = Buffer.from(text, 'utf8')
    const data = deflateRawSync(raw)
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8)
    local.writeUInt32LE(0x00210000, 10) // 1980-01-01 00:00
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10)
    dir.writeUInt32LE(0x00210000, 12)
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(data.length, 20); dir.writeUInt32LE(raw.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    central.push(dir, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const dirSize = central.reduce((n, b) => n + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dirSize, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...central, end])
}
