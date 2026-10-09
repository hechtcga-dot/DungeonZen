// Foundry VTT and Owlbear Rodeo (owner, 1.6.0). Foundry: JSON files for its "Import Data"
// (actors in the dnd5e system, scenes with the battle grid, journal entries) next to the pictures.
// Owlbear Rodeo has no import format: it gets the pictures (maps named with their grid, tokens),
// and sheets and handouts as PDF or JPG. Pure builders; the handler writes the files.

import type { AbilityView, EntityView, MapView } from '../../shared/types'
import { readStatBlock, type StatBlock } from '../../shared/statblock'
import { esc } from './pages'

const num = (s: string) => Number(/\d+/.exec(String(s))?.[0] ?? 0)
const crValue = (cr: string) => (cr.includes('/') ? Number(cr.split('/')[0]) / Number(cr.split('/')[1]) : Number(cr) || 0)
const para = (t: string) => t.trim() ? t.trim().split(/\n\s*\n/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('') : ''

/** A dnd5e actor ("character" for PCs, "npc" otherwise): scores, AC, HP, speed, CR, features and attacks as items. */
export function foundryActor(e: EntityView, abilities: AbilityView[], img: string | null): object {
  const sb: StatBlock | null = readStatBlock(e.attributes.statblock)
  const a = e.attributes as Record<string, unknown>
  const str = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '')
  const abilitiesData = Object.fromEntries((['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => [k, { value: sb ? sb[k] : 10 }]))
  const hp = sb ? num(sb.hp) : 0
  const bio = [para(str('summary')), para(str('bio')), para(str('background')), sb?.traits.map((t) => `<p><strong>${esc(t.name)}.</strong> ${esc(t.desc)}</p>`).join('') ?? ''].join('')
  const items = [
    ...(sb?.traits ?? []).map((t) => ({ name: t.name, type: 'feat', system: { description: { value: para(t.desc) } } })),
    ...abilities.map((x) => ({
      name: x.name, type: x.kind === 'SPELL' ? 'spell' : /attack roll/i.test(x.description) ? 'weapon' : 'feat',
      system: { description: { value: para(x.description) } }
    }))
  ]
  return {
    name: e.name, type: e.type === 'PC' ? 'character' : 'npc', img: img ?? undefined,
    system: {
      abilities: abilitiesData,
      attributes: { ac: { calc: 'flat', flat: sb ? num(sb.ac) || 10 : 10 }, hp: { value: typeof a.current_hp === 'number' ? a.current_hp : hp, max: hp }, movement: { walk: sb ? num(sb.speed) || 30 : 30, units: 'ft' } },
      details: { cr: sb ? crValue(sb.cr) : undefined, alignment: sb?.alignment ?? '', biography: { value: bio }, type: { value: sb?.creatureType ?? '' } },
      traits: { languages: { custom: sb?.languages ?? '' }, size: ({ Tiny: 'tiny', Small: 'sm', Medium: 'med', Large: 'lg', Huge: 'huge', Gargantuan: 'grg' } as Record<string, string>)[sb?.size ?? ''] ?? 'med' }
    },
    items,
    prototypeToken: { name: e.name, actorLink: e.type === 'PC', texture: img ? { src: img } : undefined }
  }
}

/** A scene with the map as background and the battle grid (5 ft squares) when the map has one. */
export function foundryScene(m: MapView, img: string): object {
  const width = m.width ?? 2000
  const height = m.height ?? 2000
  const size = m.gridCols ? Math.max(50, Math.round(width / m.gridCols)) : 100
  return {
    name: m.name, width, height, padding: 0, background: { src: img },
    grid: { type: m.gridCols ? 1 : 0, size, distance: 5, units: 'ft' }, tokenVision: false, fog: { exploration: false }
  }
}

/** A journal entry with one text page (handouts, letters, notes). */
export function foundryJournal(name: string, html: string): object {
  return { name, pages: [{ name, type: 'text', text: { format: 1, content: html } }] }
}

export function handoutHtml(e: EntityView): string {
  const t = (k: string) => (typeof e.attributes[k] === 'string' ? (e.attributes[k] as string) : '')
  return [t('from') && `<p><em>From ${esc(t('from'))}</em></p>`, para(t('text') || t('summary'))].filter(Boolean).join('')
}

/** "Battle map (20x14 grid).png": Owlbear asks for the grid size when a map is added. */
export function owlbearMapName(m: MapView, ext: string): string {
  return `${m.name}${m.gridCols && m.gridRows ? ` (${m.gridCols}x${m.gridRows} grid)` : ''}${ext}`
}

export const FOUNDRY_README = `Foundry VTT import (Dungeon Zen)

1. Copy the "pictures" folder into your Foundry Data folder (for example Data/dungeonzen/).
2. Actors: create an actor (any name), right-click it in the sidebar > Import Data, choose a file from "actors".
3. Scenes: create a scene, right-click > Import Data, choose a file from "scenes". If the background is missing,
   set it to the picture with the same name in the folder from step 1.
4. Journal: create a journal entry, right-click > Import Data, choose a file from "journal".
Actors use the dnd5e system. Check them after import: Foundry fills in what Dungeon Zen does not know.
`

export const OWLBEAR_README = `Owlbear Rodeo (Dungeon Zen)

Owlbear Rodeo has no import file, so this folder has what you upload by hand:
- maps: add each as a map; the file name says its grid (for example 20x14): set the grid to that in the map settings.
- tokens: upload as characters or props.
- sheets and handouts: PDF and JPG files to keep open or share with the players.
`
