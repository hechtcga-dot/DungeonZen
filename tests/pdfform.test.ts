import { describe, expect, it } from 'vitest'
import { pdfPages } from '../src/main/importers/read'

/** A one-page PDF with two filled form fields (like a fillable character sheet), xref built by offset. */
function formPdf(): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R 5 0 R] >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [4 0 R 5 0 R] >>',
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (CharacterName) /V (Flor Nightingale) /Rect [50 700 300 720] /P 3 0 R >>',
    '<< /Type /Annot /Subtype /Widget /FT /Tx /T (ClassLevel) /V (Bard 5) /Rect [50 660 300 680] /P 3 0 R >>'
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

describe('fillable PDFs', () => {
  it('reads the values typed into form fields', async () => {
    const [page] = await pdfPages(formPdf())
    expect(page).toContain('CharacterName: Flor Nightingale')
    expect(page).toContain('ClassLevel: Bard 5')
  })
})
