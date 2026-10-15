/** Card names for the spelling menu: their words are never flagged, and a near miss offers the card's spelling. */
let names: string[] = []
const known = new Set<string>()
let addWord: (w: string) => void = () => {}

export function onCardWord(add: (w: string) => void): void { addWord = add }

export function setCardWords(list: string[]): void {
  names = list
  for (const w of list.flatMap((n) => n.match(/[\p{L}'’-]{3,}/gu) ?? [])) {
    if (!known.has(w)) { known.add(w); addWord(w) }
  }
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = keep
    }
  }
  return row[b.length]
}

/** Card spellings close to a misspelt word (any case), closest first. */
export function cardSpellings(word: string): string[] {
  const w = word.toLowerCase()
  const words = [...new Set([...names, ...names.flatMap((n) => n.match(/[\p{L}'’-]{3,}/gu) ?? [])])]
  return words.map((c) => ({ c, d: distance(w, c.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(1, Math.floor(w.length / 4)) && x.d < w.length)
    .sort((a, b) => a.d - b.d).slice(0, 3).map((x) => x.c)
}
