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
