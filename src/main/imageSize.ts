// Reads width and height from PNG, JPEG, GIF and WebP headers, so map imports
// need no image library. Returns null for anything it does not recognise.

export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
  }
  if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buf.toString('ascii', 12, 16)
    if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) }
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21)
      return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
    }
    return null
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      const len = buf.readUInt16BE(i + 2)
      // Start-of-frame markers (baseline, progressive, …) carry the size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
      }
      i += 2 + len
    }
  }
  return null
}
