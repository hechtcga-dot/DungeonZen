// Structural sharing: the new value, but every part equal to the old one is the old object.
// A refresh then hands React the same objects for everything that did not change, so memoised
// cards, rows and panels skip their redraw (speed). Plain data only (JSON from IPC).

export function share<T>(prev: unknown, next: T): T {
  if (prev === next || typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null) return next
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next
    let same = prev.length === next.length
    const out = next.map((v, i) => { const s = share(prev[i], v); if (s !== prev[i]) same = false; return s })
    return (same ? prev : out) as T
  }
  if (Array.isArray(prev) || Object.getPrototypeOf(next) !== Object.prototype) return next
  const p = prev as Record<string, unknown>
  const n = next as Record<string, unknown>
  const keys = Object.keys(n)
  let same = keys.length === Object.keys(p).length
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const s = share(p[k], n[k])
    if (s !== p[k] || !(k in p)) same = false
    out[k] = s
  }
  return (same ? prev : out) as T
}
