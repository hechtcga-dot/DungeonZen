import { expect, it } from 'vitest'
import { allSrdMonsters } from '../src/main/srd'

it('lists every SRD monster with what the browser filters on', () => {
  const all = allSrdMonsters()
  expect(all.length).toBeGreaterThan(300)
  const captain = all.find((m) => m.name === 'Bandit Captain')!
  expect(captain).toMatchObject({ type: 'humanoid', crNum: 2, legendary: false })
  expect(captain.hp).toBeGreaterThan(0)
  expect(all.find((m) => m.name === 'Aboleth')).toMatchObject({ moves: ['swim'], legendary: true })
})
