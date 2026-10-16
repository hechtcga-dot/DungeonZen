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

/** Same formatting and link: one run. */
const same = (a: Run, b: Run) => !!a.b === !!b.b && !!a.i === !!b.i && !!a.u === !!b.u && a.link === b.link

/** A paragraph's runs; runs inside a Dungeon Zen hyperlink (`dz-card:`, `dz-note:`, `dz-nolink:`) carry its link. */
function runsOf(para: string, rels: Map<string, string> = new Map()): Run[] {
  const runs: Run[] = []
  for (const m of para.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r[ >][\s\S]*?<\/w:r>/g)) {
    const target = m[1] !== undefined ? rels.get(/r:id="([^"]+)"/.exec(m[1])?.[1] ?? '') ?? '' : ''
    const link = target.startsWith('dz-card:') ? target.slice(8) : target.startsWith('dz-note:') ? `note:${target.slice(8)}` : target.startsWith('dz-nolink:') ? '' : undefined
    for (const rm of (m[2] ?? m[0]).matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)) {
      const r = rm[0]
      const props = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(r)?.[1] ?? ''
      if (on(props, 'vanish')) continue
      const text = (r.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br[^>]*\/>/g) ?? [])
        .map((t) => (t.startsWith('<w:tab') ? '\t' : t.startsWith('<w:br') ? '\n' : unxml(t.replace(/<[^>]+>/g, '')))).join('')
      if (!text) continue
      const run: Run = { text }
      if (on(props, 'b')) run.b = true
      if (on(props, 'i')) run.i = true
      if (on(props, 'u')) run.u = true
      if (link !== undefined) run.link = link
      const last = runs.at(-1)
      if (last && same(last, run)) last.text += text
      else runs.push(run)
    }
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

  const rels = new Map([...(readZipEntry(file, 'word/_rels/document.xml.rels')?.toString('utf8') ?? '')
    .matchAll(/<Relationship\b[^>]*>/g)].map((r) => [/Id="([^"]+)"/.exec(r[0])?.[1] ?? '', unxml(/Target="([^"]*)"/.exec(r[0])?.[1] ?? '')]))
  const body = doc.toString('utf8')
  const blocks: Block[] = []
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const part = m[0]
    if (part.startsWith('<w:tbl>')) {
      const rows = [...part.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((tr) =>
        [...tr[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((tc) => {
          const paras = [...tc[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => runsOf(p[0], rels))
          return paras.flatMap((runs, i) => (i ? [{ text: '\n' }, ...runs] : runs))
        }))
      if (rows.length) blocks.push({ kind: 'table', rows })
      continue
    }
    const style = /<w:pStyle w:val="([^"]+)"/.exec(part)?.[1] ?? ''
    if (style === 'DzPicture') {
      // The picture's details ride in hidden text: dz:{"card":…,"file":…,"side":…}
      const hidden = /<w:t(?:\s[^>]*)?>dz:([^<]*)<\/w:t>/.exec(part)?.[1]
      try {
        const v = JSON.parse(unxml(hidden ?? '')) as { card?: unknown; file?: unknown; side?: unknown }
        blocks.push({ kind: 'pic', ...(typeof v.card === 'string' ? { card: v.card } : {}), ...(typeof v.file === 'string' ? { file: v.file } : {}), side: v.side === 'left' ? 'left' : 'right' })
      } catch { /* a picture line someone typed over: dropped */ }
      continue
    }
    const runs = runsOf(part, rels)
    if (!runs.some((r) => r.text.trim())) continue
    const numId = /<w:numPr>[\s\S]*?<w:numId w:val="(\d+)"/.exec(part)?.[1]
    const kind = style === 'ReadAloud' ? 'read' : style === 'Sidebar' ? 'side' : /^(Heading1|Title)$/i.test(style) ? 'h1' : /^(Heading2|Subtitle)$/i.test(style) ? 'h2' : /^Heading[3-9]$/i.test(style) ? 'h3'
      : numId && numId !== '0' ? (numbered.has(numId) ? 'number' : 'bullet') : 'p'
    blocks.push({ kind, runs })
  }
  return blocks
}

/** The document's hyperlink targets (Dungeon Zen links), numbered from rId10. */
type Links = Map<string, string>
const linkTarget = (link: string) => (link === '' ? 'dz-nolink:' : link.startsWith('note:') ? `dz-note:${link.slice(5)}` : `dz-card:${link}`)

function runXml(r: Run, links: Links): string {
  const props = `${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${r.u ? '<w:u w:val="single"/>' : ''}`
  const parts = r.text.split(/(\n|\t)/).map((t) => (t === '\n' ? '<w:br/>' : t === '\t' ? '<w:tab/>' : t ? `<w:t xml:space="preserve">${xml(t)}</w:t>` : '')).join('')
  const run = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${parts}</w:r>`
  if (r.link === undefined) return run
  const target = linkTarget(r.link)
  if (!links.has(target)) links.set(target, `rId${10 + links.size}`)
  return `<w:hyperlink r:id="${links.get(target)}">${run}</w:hyperlink>`
}

function paraXml(kind: string, runs: Run[], links: Links): string {
  const ppr = kind === 'read' ? '<w:pStyle w:val="ReadAloud"/>' : kind === 'side' ? '<w:pStyle w:val="Sidebar"/>' : kind === 'h1' ? '<w:pStyle w:val="Heading1"/>' : kind === 'h2' ? '<w:pStyle w:val="Heading2"/>' : kind === 'h3' ? '<w:pStyle w:val="Heading3"/>'
    : kind === 'bullet' ? '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
    : kind === 'number' ? '<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>' : ''
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs.map((r) => runXml(r, links)).join('')}</w:p>`
}

/** A picture line: "[Picture: …]" for Word readers, the details in hidden text for Dungeon Zen. */
function picXml(b: Extract<Block, { kind: 'pic' }>, label: string): string {
  const data = JSON.stringify({ ...(b.card ? { card: b.card } : {}), ...(b.file ? { file: b.file } : {}), side: b.side })
  return `<w:p><w:pPr><w:pStyle w:val="DzPicture"/></w:pPr><w:r><w:t xml:space="preserve">${xml(`[Picture: ${label}]`)}</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t xml:space="preserve">dz:${xml(data)}</w:t></w:r></w:p>`
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ReadAloud"><w:name w:val="Read aloud"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="24" w:space="8" w:color="7A5A3A"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="EFE6D2"/><w:ind w:left="284" w:right="284"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Sidebar"><w:name w:val="Sidebar"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:top w:val="single" w:sz="12" w:space="4" w:color="55703A"/><w:bottom w:val="single" w:sz="12" w:space="4" w:color="55703A"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="E8EEDB"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="DzPicture"><w:name w:val="Dungeon Zen picture"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="7A6650"/></w:rPr></w:style>
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

/** A Word document (.docx) of these blocks. `names` gives picture lines their card names (Word readers only). */
export function writeDocx(blocks: Block[], names: Record<string, string> = {}): Buffer {
  const links: Links = new Map()
  const body = blocks.map((b) => (b.kind === 'pic' ? picXml(b, (b.card && names[b.card]) || (b.file ? b.file.split('/').pop() ?? 'picture' : 'picture'))
    : b.kind === 'table'
    ? `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${b.rows.map((row) =>
      `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paraXml('p', cell, links)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`
    : paraXml(b.kind, b.runs, links))).join('')
  const docRels = DOC_RELS.replace('</Relationships>', `${[...links].map(([target, id]) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(target)}" TargetMode="External"/>`).join('')}</Relationships>`)
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W} ${R}><w:body>${body || '<w:p/>'}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`
  return writeZip([
    ['[Content_Types].xml', CONTENT_TYPES], ['_rels/.rels', RELS], ['word/_rels/document.xml.rels', docRels],
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
