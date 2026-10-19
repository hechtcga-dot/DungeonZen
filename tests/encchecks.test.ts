import { expect, it } from 'vitest'
import { parseDraft } from '../src/main/ai/encounter'

it('AI checks: always three, different skills, short lists topped up', () => {
  const reply = JSON.stringify({ name: 'Marsh ambush', checks: [
    { skill: 'Survival', tiers: [{ dc: '10', text: 'Tracks' }] },
    { skill: 'Survival', tiers: [{ dc: '12', text: 'Again' }] }
  ] })
  const d = parseDraft(reply, [], [], [])
  expect(d.story.checks.map((c) => c.skill)).toEqual(['Survival', 'Perception', 'Insight'])
  const many = JSON.stringify({ name: 'x', checks: ['Nature', 'Religion', 'History', 'Athletics'].map((skill) => ({ skill, tiers: [] })) })
  expect(parseDraft(many, [], [], []).story.checks.map((c) => c.skill)).toEqual(['Nature', 'Religion', 'History'])
})
