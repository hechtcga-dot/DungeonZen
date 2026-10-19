// Makes tests/fixtures/campaign-<version>.db with an old release's own code. From the repo root:
//   git worktree add /tmp/dz-<version> <version> && ln -s "$PWD/node_modules" /tmp/dz-<version>/node_modules
//   cp tests/fixtures/makefixture.ts /tmp/dz-<version>/tests/makefixture.test.ts
//   (cd /tmp/dz-<version> && FIXTURE_OUT="$OLDPWD/tests/fixtures/campaign-<version>.db" npx vitest run tests/makefixture.test.ts)
//   git worktree remove --force /tmp/dz-<version>
// Then add <version> to VERSIONS in tests/oldcampaigns.test.ts.
import { copyFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'vitest'
import { Campaign } from '../src/main/campaign/campaign'

it('makes the fixture', () => {
  const folder = join(mkdtempSync(join(tmpdir(), 'dzfx-')), 'Old campaign')
  const c: any = Campaign.create(folder, 'Old campaign')
  const boardId = c.info().globalBoardId
  const inn = c.createEntity({ boardId, type: 'LOCATION', name: 'Prancing Pony', position: { x: 0, y: 0 }, attributes: { summary: 'An inn' } })
  const npc = c.createEntity({ boardId, type: 'NPC', name: 'Barliman Butterbur', position: { x: 300, y: 0 }, attributes: { summary: 'Innkeeper', motivation: 'Keep the peace', current_hp: 9 }, tags: ['bree'],
    abilities: [{ name: 'Club', kind: 'ACTION', description: 'Melee: 1d4' }] })
  const pub = c.createRelationship({ sourceId: npc.id, targetId: inn.id, type: 'works at', isSecret: false })
  c.createRelationship({ sourceId: npc.id, targetId: inn.id, type: 'hides a letter in', isSecret: true })
  c.setStringKnown(pub.id, true)
  c.setPartyKnows(npc.id, 'name', true)
  c.addNote({ boardId, position: { x: 0, y: 300 }, text: 'Rain all week' })
  c.updateEntity(npc.id, { name: 'Barliman Butterbur', attributes: { summary: 'Forgetful innkeeper', motivation: 'Keep the peace', current_hp: 9 } })
  const st = c.createStoryline('The letter')
  const storylineId = st.storylineId ?? st.id
  c.createAct({ storylineId, title: 'Letter found', startMin: 600, endMin: 1200 })
  const s = c.startSession()
  c.addLog({ kind: 'meeting', text: 'Party met Barliman', entityId: npc.id, minutesTaken: 30 })
  c.endSession(s.id)
  c.save?.()
  c.close()
  copyFileSync(join(folder, 'campaign.db'), process.env.FIXTURE_OUT!)
})
