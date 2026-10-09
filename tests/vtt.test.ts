import { describe, expect, it } from 'vitest'
import { foundryActor, foundryScene, owlbearMapName } from '../src/main/exporters/vtt'
import type { EntityView, MapView } from '../src/shared/types'

const map = { id: 'm', name: 'Marsh', url: '', width: 2000, height: 1400, widthKm: null, travelKmh: 4.8, kind: 'battle', gridCols: 20, gridRows: 14, gridShown: false, source: null, prompt: null } as MapView

describe('virtual tabletop exports', () => {
  it('a Foundry scene keeps the battle grid', () => {
    expect(foundryScene(map, 'dungeonzen/pictures/Marsh.png')).toMatchObject({ width: 2000, grid: { type: 1, size: 100, distance: 5 }, background: { src: 'dungeonzen/pictures/Marsh.png' } })
  })
  it('a Foundry actor carries scores, AC, HP and CR', () => {
    const e = { id: 'e', type: 'MONSTER', name: 'Fog Beast', attributes: { statblock: { ac: '15 (natural armor)', hp: '68 (8d10 + 24)', speed: '40 ft.', str: 18, cr: '1/2', size: 'Large', traits: [{ name: 'Mist', desc: 'Hides in fog.' }] } } } as unknown as EntityView
    const a = foundryActor(e, [{ id: 'x', name: 'Bite', kind: 'ACTION', description: 'Melee Attack Roll: +6', macroText: '', showTokenAction: true, showMacroBar: false }], null) as { type: string; system: { abilities: { str: { value: number } }; attributes: { ac: { flat: number }; hp: { max: number } }; details: { cr: number }; traits: { size: string } }; items: Array<{ type: string }> }
    expect(a.type).toBe('npc')
    expect(a.system.abilities.str.value).toBe(18)
    expect(a.system.attributes.ac.flat).toBe(15)
    expect(a.system.attributes.hp.max).toBe(68)
    expect(a.system.details.cr).toBe(0.5)
    expect(a.system.traits.size).toBe('lg')
    expect(a.items.map((i) => i.type)).toEqual(['feat', 'weapon'])
  })
  it('Owlbear map files say their grid', () => {
    expect(owlbearMapName(map, '.png')).toBe('Marsh (20x14 grid).png')
  })
})
