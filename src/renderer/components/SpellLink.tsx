import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { call } from '../api'
import { Dialog } from './Dialog'
import type { SrdAttacks, SrdSpell } from '../../shared/attacks'

// Spell names in tips and lists are links that open the description: the character's own
// version (with its numbers) when there is one, and the SRD 5.2 entry.

let srd: Promise<SrdAttacks> | null = null
function useSrdSpells(): Map<string, SrdSpell> {
  const [map, setMap] = useState<Map<string, SrdSpell>>(new Map())
  useEffect(() => {
    srd ??= call('srd:attacks', undefined)
    void srd.then((d) => setMap(new Map(d.spells.map((s) => [s.name, s])))).catch(() => { srd = null })
  }, [])
  return map
}

/** SRD spell names that are also everyday words: linked only when a character has the spell. */
const COMMON = new Set(['Light', 'Shield', 'Message', 'Mending', 'Command', 'Darkness', 'Silence', 'Resistance', 'Sanctuary', 'Friends', 'Teleport', 'Guidance',
  'Confusion', 'Alarm', 'Fly', 'Heal', 'Slow', 'Sleep', 'Fear', 'Wish', 'Haste', 'Bless', 'Bane', 'Knock', 'Jump', 'Gate', 'Web', 'Etherealness', 'Invisibility', 'Regenerate', 'Sending', 'Commune'])

/** Text with spell names as links; `glossary` = the character's spells (name → description). */
export function SpellText({ text, glossary = {} }: { text: string; glossary?: Record<string, string> }) {
  const spells = useSrdSpells()
  const [open, setOpen] = useState<string | null>(null)
  const pattern = useMemo(() => {
    const names = [...new Set([...Object.keys(glossary), ...[...spells.keys()].filter((n) => !COMMON.has(n))])].filter((n) => n.length > 2)
      .sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return names.length ? new RegExp(`\\b(${names.join('|')})\\b`, 'g') : null
  }, [glossary, spells])
  const parts: ReactNode[] = []
  if (pattern) {
    let last = 0
    for (const m of text.matchAll(pattern)) {
      parts.push(text.slice(last, m.index))
      parts.push(<button key={m.index} type="button" className="spell-link" onClick={() => setOpen(m[1])}>{m[1]}</button>)
      last = m.index! + m[1].length
    }
    parts.push(text.slice(last))
  } else parts.push(text)
  return (
    <>
      {parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}
      {open && <SpellDialog name={open} own={glossary[open]} srd={spells.get(open)} onClose={() => setOpen(null)} />}
    </>
  )
}

/** A name that opens its description. */
export function SpellName({ name, text }: { name: string; text?: string }) {
  const spells = useSrdSpells()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="spell-link" onClick={() => setOpen(true)}>{name}</button>
      {open && <SpellDialog name={name} own={text} srd={spells.get(name)} onClose={() => setOpen(false)} />}
    </>
  )
}

function SpellDialog({ name, own, srd: s, onClose }: { name: string; own?: string; srd?: SrdSpell; onClose(): void }) {
  return (
    <Dialog title={name} open onClose={onClose}>
      {own && (
        <section className="spell-own">
          <h3 className="side-h">On the character's sheet</h3>
          <p className="selectable">{own}</p>
        </section>
      )}
      {s && (
        <section>
          <h3 className="side-h">SRD 5.2</h3>
          <p className="ink-muted">{[s.level ? `Level ${s.level} ${s.school}` : `${s.school} cantrip`, `Casting time: ${s.time}`, `Range: ${s.range}`,
            `Duration: ${s.concentration ? 'Concentration, ' : ''}${s.duration}`, s.ritual ? 'Ritual' : '', s.classes.length ? `Classes: ${s.classes.join(', ')}` : ''].filter(Boolean).join(' · ')}</p>
          <p className="selectable">{s.desc}</p>
          {s.higher && <p className="selectable"><strong>{s.level ? 'Using a higher-level spell slot.' : 'Cantrip upgrade.'}</strong> {s.higher}</p>}
        </section>
      )}
      {!own && !s && <p className="ink-muted">No description found.</p>}
      <div className="dz-actions"><button onClick={onClose}>Close</button></div>
    </Dialog>
  )
}
