// Undo everywhere (CLAUDE.md rule 4), checked on every campaign any test opens: when a test closes it, every
// change the test made is undone (the campaign must be exactly as it was opened) and redone (exactly as it was
// at the close). A write that skips CommandLog.run, or one undo or redo restores wrongly, fails that test.
import { Campaign } from '../src/main/campaign/campaign'
import { tracked } from '../src/main/db/schema'

type Snap = { rows: string; done: string[] }
const opened = new WeakMap<Campaign, Snap>()

function snap(c: Campaign): Snap {
  const s = c.opened.sqlite
  const rows = Object.keys(tracked).map((t) => `${t}: ${s.prepare(`SELECT * FROM "${t}"`).all().map((r) => JSON.stringify(r)).sort().join('\n')}`).join('\n')
  const done = s.prepare(`SELECT id FROM command WHERE state = 'done'`).all().map((r) => (r as { id: string }).id)
  return { rows, done }
}

const { create, open } = Campaign
Campaign.create = (folder, name) => { const c = create.call(Campaign, folder, name); opened.set(c, snap(c)); return c }
Campaign.open = (folder) => { const c = open.call(Campaign, folder); opened.set(c, snap(c)); return c }

const close = Campaign.prototype.close
Campaign.prototype.close = function (this: Campaign) {
  const start = opened.get(this)
  opened.delete(this)
  if (start && this.opened.sqlite.open) {
    const end = snap(this)
    // A test that undid changes made before it opened the campaign: the start can't be reached by undo alone.
    if (start.done.every((id) => end.done.includes(id))) {
      let n = 0
      while (end.done.length - n > start.done.length) { this.log.undo(); n++ }
      const undone = snap(this).rows
      for (let i = 0; i < n; i++) this.log.redo()
      const redone = snap(this).rows
      if (undone !== start.rows) { close.call(this); throw new Error(`Undoing every change did not bring the campaign back:\n${diff(start.rows, undone)}`) }
      if (redone !== end.rows) { close.call(this); throw new Error(`Redoing every change did not bring the campaign back:\n${diff(end.rows, redone)}`) }
    }
  }
  close.call(this)
}

/** The rows only one side has (first 10). */
function diff(want: string, got: string): string {
  const a = new Set(want.split('\n')), b = new Set(got.split('\n'))
  return [...[...a].filter((l) => !b.has(l)).map((l) => `- ${l}`), ...[...b].filter((l) => !a.has(l)).map((l) => `+ ${l}`)].slice(0, 10).join('\n')
}
