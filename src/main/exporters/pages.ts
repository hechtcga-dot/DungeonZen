// Printable pages for PDF and JPG export (FEATURES.md: character sheets, letters,
// bulletin boards). Pure: each returns a complete HTML document. Every piece of
// campaign text is escaped. Art is drawn with CSS (no images).

import { ABILITY_KEYS, abilityModifier, formatModifier, readStatBlock } from '../../shared/statblock'
import type { AbilityView, EntityView } from '../../shared/types'
import type { KnowledgeField } from '../../shared/schemas'

export type PageSize = 'A4' | 'Letter'
/** Page width in CSS pixels (96 dpi), for JPG snapshots. */
export const PAGE_WIDTH: Record<PageSize, number> = { A4: 794, Letter: 816 }

export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
const para = (s: string) => esc(s.trim()).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
const text = (e: EntityView, k: string) => (typeof e.attributes[k] === 'string' ? (e.attributes[k] as string).trim() : '')

const BASE_CSS = `
*{box-sizing:border-box} html,body{margin:0;padding:0}
body{font-family:Georgia,'Times New Roman',serif;color:#2a1f12;background:#efe3c4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{position:relative;padding:44px 52px;min-height:var(--page-h);background:
 radial-gradient(ellipse at 20% 10%,rgba(255,250,232,.9),transparent 60%),
 radial-gradient(ellipse at 85% 90%,rgba(160,120,60,.25),transparent 55%),
 radial-gradient(ellipse at 50% 50%,#f3e7c7,#e6d3a6 120%);page-break-after:always;overflow:hidden}
.page:last-child{page-break-after:auto}
h1{font-family:'IM Fell English',Georgia,serif;font-weight:400;font-size:34px;margin:0;line-height:1.1}
h2{font-family:'IM Fell English',Georgia,serif;font-weight:400;font-size:20px;margin:18px 0 6px;color:#7a1e16;border-bottom:1px solid #7a1e16}
p{margin:0 0 8px;line-height:1.45;font-size:14px}
.sub{font-style:italic;margin:2px 0 10px;font-size:14px}
.rule{height:4px;margin:8px 0;background:linear-gradient(90deg,#7a1e16,#c0392b 60%,transparent)}
.line{font-size:14px;margin:2px 0}.line b{color:#7a1e16}
table.scores{width:100%;border-collapse:collapse;margin:8px 0;text-align:center;font-size:14px}
table.scores th{color:#7a1e16;font-size:12px;letter-spacing:.08em}
.ab{margin:0 0 8px;font-size:14px;line-height:1.45}.ab b{font-style:italic}
.foot{position:absolute;bottom:18px;left:52px;right:52px;font-size:10px;color:#7d6b4f;text-align:right}
`

const PAGE_HEIGHT: Record<PageSize, string> = { A4: 'calc(297mm - 2px)', Letter: 'calc(11in - 2px)' }

function doc(title: string, css: string, body: string, size: PageSize): string {
  const page = `@page{size:${size};margin:0}:root{--page-h:${PAGE_HEIGHT[size]}}`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${page}${BASE_CSS}${css}</style></head><body>${body}</body></html>`
}

const KIND_TITLES: Array<[AbilityView['kind'], string]> = [
  ['ACTION', 'Actions'], ['BONUS_ACTION', 'Bonus actions'], ['REACTION', 'Reactions'], ['LEGENDARY_ACTION', 'Legendary actions'], ['SPELL', 'Spells'], ['OTHER', 'Other']
]

export interface SheetOptions {
  /** Only what the party knows (to hand to players). */
  playerSafe: boolean
  knows?: Partial<Record<KnowledgeField, boolean>>
  includeNotes: boolean
}

/** One character or monster sheet page: stat block, abilities, and bio. */
export function sheetPage(e: EntityView, abilities: AbilityView[], o: SheetOptions): string {
  const k = (f: KnowledgeField) => !o.playerSafe || !!o.knows?.[f]
  const sb = readStatBlock(e.attributes.statblock)
  const name = k('name') ? e.name : 'Unknown'
  const parts: string[] = [`<h1>${esc(name)}</h1>`]
  if (sb && k('statblock')) {
    const kind = [sb.size, sb.creatureType].filter(Boolean).join(' ') + (sb.alignment ? `, ${sb.alignment}` : '')
    if (kind.trim()) parts.push(`<div class="sub">${esc(kind)}</div>`)
    parts.push('<div class="rule"></div>')
    const line = (label: string, value: string) => (value.trim() ? `<div class="line"><b>${label}</b> ${esc(value)}</div>` : '')
    parts.push(line('Armor Class', [sb.ac, sb.acDetail && `(${sb.acDetail})`].filter(Boolean).join(' ')), line('Hit Points', [sb.hp, sb.hitDice && `(${sb.hitDice})`].filter(Boolean).join(' ')), line('Speed', sb.speed))
    parts.push(`<table class="scores"><tr>${ABILITY_KEYS.map((a) => `<th>${a.toUpperCase()}</th>`).join('')}</tr><tr>${ABILITY_KEYS.map((a) => `<td>${sb[a]} (${formatModifier(abilityModifier(sb[a]))})</td>`).join('')}</tr></table>`)
    parts.push('<div class="rule"></div>')
    parts.push(line('Saving Throws', sb.saves), line('Skills', sb.skills), line('Vulnerabilities', sb.vulnerabilities), line('Resistances', sb.resistances),
      line('Immunities', sb.immunities), line('Condition Immunities', sb.conditionImmunities), line('Senses', sb.senses), line('Languages', sb.languages), line('Challenge', sb.cr))
    if (sb.traits.length) parts.push('<h2>Traits</h2>', ...sb.traits.map((t) => `<div class="ab"><b>${esc(t.name)}.</b> ${esc(t.desc)}</div>`))
    for (const [kind, title] of KIND_TITLES) {
      const list = abilities.filter((a) => a.kind === kind)
      if (list.length) parts.push(`<h2>${title}</h2>`, ...list.map((a) => `<div class="ab"><b>${esc(a.name)}.</b> ${esc(a.description)}</div>`))
    }
  } else if (text(e, 'summary')) {
    parts.push(`<div class="sub">${esc(text(e, 'summary'))}</div><div class="rule"></div>`)
  }
  if (k('location') && text(e, 'location')) parts.push(`<div class="line"><b>Where</b> ${esc(text(e, 'location'))}</div>`)
  if (k('motivation') && text(e, 'motivation')) parts.push(`<div class="line"><b>Wants</b> ${esc(text(e, 'motivation'))}</div>`)
  if (k('bio') && text(e, 'bio')) parts.push('<h2>About</h2>', para(text(e, 'bio')))
  if (!o.playerSafe && o.includeNotes && text(e, 'notes')) parts.push('<h2>DM notes</h2>', para(text(e, 'notes')))
  parts.push(`<div class="foot">${o.playerSafe ? 'Player copy' : 'DM copy'} · Dungeon Zen</div>`)
  return `<section class="page">${parts.join('')}</section>`
}

export function sheetsDocument(title: string, pages: string[], size: PageSize = 'A4'): string {
  return doc(title, '', pages.join(''), size)
}

export interface LetterOptions { hand: 'handwritten' | 'printed'; seal: boolean }

const LETTER_CSS = (o: LetterOptions) => `
.letter{padding:90px 96px;min-height:var(--page-h)}
.letter h1{text-align:center;margin-bottom:28px;font-size:30px}
.letter .body p{font-size:${o.hand === 'handwritten' ? 19 : 16}px;line-height:1.7;${o.hand === 'handwritten' ? "font-family:'Segoe Script','Bradley Hand','Brush Script MT',cursive;" : ''}}
.letter .from{margin-top:28px;text-align:right;font-style:italic;font-size:17px}
.seal{position:absolute;right:90px;bottom:90px;width:96px;height:96px;border-radius:50%;
 background:radial-gradient(circle at 38% 34%,#d2523f,#8f2a21 55%,#5e1812);box-shadow:0 3px 6px rgba(60,10,5,.5),inset 0 0 0 7px rgba(0,0,0,.12);
 display:flex;align-items:center;justify-content:center;color:#f3c9a5;font-family:'IM Fell English',Georgia,serif;font-size:40px}`

/** Handouts as letters or notices on aged paper, one page each, with an optional wax seal. */
export function letterDocument(letters: EntityView[], o: LetterOptions, size: PageSize = 'A4'): string {
  const pages = letters.map((e) => {
    const body = text(e, 'text') || text(e, 'bio') || text(e, 'description') || text(e, 'summary')
    const from = text(e, 'from')
    return `<section class="page letter"><h1>${esc(e.name)}</h1><div class="body">${para(body || ' ')}</div>${from ? `<div class="from">${esc(from)}</div>` : ''}${o.seal ? `<div class="seal">${esc((from || e.name).trim().charAt(0).toUpperCase())}</div>` : ''}</section>`
  })
  return doc(letters.map((l) => l.name).join(', '), LETTER_CSS(o), pages.join(''), size)
}

/** A bulletin board: notices (quests, handouts…) pinned to cork. */
export function boardDocument(title: string, notes: EntityView[], size: PageSize = 'A4'): string {
  const css = `
.board{min-height:var(--page-h);padding:40px 36px;background:
 radial-gradient(circle at 20% 30%,rgba(255,255,255,.08) 0 2px,transparent 3px) 0 0/22px 22px,
 radial-gradient(circle at 70% 60%,rgba(0,0,0,.12) 0 2px,transparent 3px) 0 0/17px 17px,
 linear-gradient(135deg,#b8865a,#a0703f 50%,#b98a5c);border:22px solid #5b3a1e;box-shadow:inset 0 0 30px rgba(0,0,0,.45)}
.board h1{color:#fbeed2;text-align:center;text-shadow:0 2px 0 #3b220e;margin-bottom:26px}
.notes{display:grid;grid-template-columns:1fr 1fr;gap:26px}
.note{position:relative;padding:26px 20px 18px;background:linear-gradient(180deg,#fbf3dc,#efe0b8);box-shadow:0 6px 10px rgba(40,20,5,.45)}
.note:nth-child(3n+1){transform:rotate(-1.6deg)}.note:nth-child(3n+2){transform:rotate(1.2deg)}.note:nth-child(3n){transform:rotate(-.6deg)}
.note::before{content:'';position:absolute;top:8px;left:50%;width:16px;height:16px;margin-left:-8px;border-radius:50%;
 background:radial-gradient(circle at 35% 35%,#e66,#8f2a21);box-shadow:0 2px 3px rgba(0,0,0,.5)}
.note h2{border:0;margin:0 0 6px;color:#2a1f12;font-size:21px;text-align:center}
.note .reward{margin-top:8px;font-weight:bold;text-align:center;color:#7a1e16}`
  const cards = notes.map((n) => {
    const body = text(n, 'text') || text(n, 'description') || text(n, 'summary') || text(n, 'bio')
    const reward = text(n, 'reward')
    return `<div class="note"><h2>${esc(n.name)}</h2>${para(body)}${reward ? `<div class="reward">Reward: ${esc(reward)}</div>` : ''}</div>`
  }).join('')
  return doc(title, css, `<section class="page board"><h1>${esc(title)}</h1><div class="notes">${cards}</div></section>`, size)
}
