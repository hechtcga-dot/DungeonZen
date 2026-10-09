// Board layout helpers with no React or DOM dependencies (unit tested).

const SLOT = { w: 250, h: 170 } // a card (220 wide, about 140 tall) plus a gap

/** The nearest position to `start`, searching outwards ring by ring, that overlaps no item. */
export function freeSpot(start: { x: number; y: number }, items: Array<{ x: number; y: number }>) {
  const clear = (p: { x: number; y: number }) =>
    items.every((i) => Math.abs(i.x - p.x) >= SLOT.w || Math.abs(i.y - p.y) >= SLOT.h)
  for (let ring = 0; ring < 12; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
        const p = { x: start.x + dx * SLOT.w, y: start.y + dy * SLOT.h }
        if (clear(p)) return p
      }
    }
  }
  return start
}

export interface Rect { x: number; y: number; w: number; h: number }

/** A card's six string points: top middle, bottom middle (first, so they win ties), then the four corners. */
export function stringPoints(r: Rect): Array<{ x: number; y: number }> {
  return [
    { x: r.x + r.w / 2, y: r.y }, { x: r.x + r.w / 2, y: r.y + r.h },
    { x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x, y: r.y + r.h }, { x: r.x + r.w, y: r.y + r.h }
  ]
}

/** Where a string between two cards attaches: the closest pair of their six points. */
export function stringEnds(a: Rect, b: Rect): { sx: number; sy: number; tx: number; ty: number } {
  let best = { sx: 0, sy: 0, tx: 0, ty: 0 }
  let bestD = Infinity
  for (const p of stringPoints(a)) for (const q of stringPoints(b)) {
    const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2
    if (d < bestD) { bestD = d; best = { sx: p.x, sy: p.y, tx: q.x, ty: q.y } }
  }
  return best
}
