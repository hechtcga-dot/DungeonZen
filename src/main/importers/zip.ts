import { inflateRawSync } from 'node:zlib'

/**
 * Reads one file out of a zip archive (a .docx is a zip). Enough for Office files:
 * stored or deflated entries, no encryption, no zip64.
 */
export function readZipEntry(zip: Buffer, name: string): Buffer | null {
  // End of central directory: the last 22+ bytes, signature 0x06054b50.
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('This file is not a zip archive (or it is damaged)')
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('The archive directory is damaged')
    const method = zip.readUInt16LE(p + 10)
    const size = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const entry = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    if (entry === name) {
      const lNameLen = zip.readUInt16LE(local + 26)
      const lExtraLen = zip.readUInt16LE(local + 28)
      const start = local + 30 + lNameLen + lExtraLen
      const data = zip.subarray(start, start + size)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      throw new Error(`Unsupported compression in ${name}`)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}
