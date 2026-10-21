// Playtest: a DM's evening with the built app (or the installed one, DZ_EXE), from an empty computer:
// new campaign, world map, cards, a storyline with an act, a prep sheet, an encounter, a live session
// (log, hit points, clock), review, what the players know, the action round-trip, then closing and
// opening the campaign again. Each step is timed and checked; screenshots after each.
// Out: tests/e2e/playtest/ (CI download `playtest`): report.html (what was tested, pass/fail, screenshots,
// What to improve) and the played campaign folder (open it with "Open a campaign folder…" as a demo).
// Fails (exit 1) when a step fails; look-check findings and slow steps only go to What to improve.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { layoutProblems, uiProblems } from './uiChecks.mjs'
import { launch, scale } from './app.mjs'
import { roundTrip } from './roundtrip.mjs'

const out = join(import.meta.dirname, 'playtest')
const work = mkdtempSync(join(tmpdir(), 'dz-playtest-'))
const userData = join(work, 'userData')
const NAME = 'The Drowned Bell'
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'shots'), { recursive: true })
mkdirSync(userData)

/** Slower than this (ms) goes to What to improve. */
const SLOW = 4000
const steps = []
const errors = [] // window and console errors, all steps
const notes = [] // things a step noticed for What to improve (they do not fail it)
let app, page, screenshot

/** One step: `fn(expect)` drives the app; `expect(what, ok)` records a check. A thrown error fails the step. Over `slow` ms: What to improve. */
async function step(title, what, fn, slow = SLOW) {
  const s = { title, what, checks: [], findings: [], error: null, ms: 0, shot: null, slow }
  const before = errors.length
  const t0 = Date.now()
  try {
    await fn((check, ok) => { s.checks.push({ check, ok: !!ok }) })
  } catch (err) {
    s.error = err.message.split('\n')[0]
  }
  s.ms = Date.now() - t0
  try {
    await page.waitForTimeout(400)
    const toast = page.locator('.toast-error')
    if (await toast.count()) s.error ??= `error on screen: ${await toast.first().innerText()}`
    s.findings.push(...await page.evaluate(uiProblems), ...await page.evaluate(layoutProblems), ...await page.evaluate(cutSelects))
    s.shot = `shots/${String(steps.length + 1).padStart(2, '0')}.png`
    await screenshot(join(out, s.shot))
  } catch { /* the window is closed (the reopen step) */ }
  s.errors = errors.slice(before)
  s.ok = !s.error && s.errors.length === 0 && s.checks.every((c) => c.ok)
  steps.push(s)
  console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${title} (${(s.ms / 1000).toFixed(1)} s)${s.error ? `: ${s.error}` : ''}`)
}

/** Drop-downs too narrow for the choice they show (the look checks leave inputs out). */
function cutSelects() {
  const ctx = document.createElement('canvas').getContext('2d')
  return [...document.querySelectorAll('select')].filter((el) => el.offsetParent && el.selectedOptions[0]).flatMap((el) => {
    const css = getComputedStyle(el)
    ctx.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`
    const room = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - 16 // the arrow
    const shown = el.selectedOptions[0].text
    return ctx.measureText(shown).width > room ? [`drop-down too narrow, its choice is cut off: "${shown}"`] : []
  })
}

const click = (name) => page.getByRole('button', { name, exact: true }).first().click()
const text = (locator) => locator.innerText().catch(() => '')
const start = async () => {
  ({ app, page, screenshot } = await launch(userData, errors))
  // The folder window answered by the test: campaigns go in the work folder.
  await app.evaluate(({ dialog }, dir) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] }) }, work)
}

try {
  await start()

  await step('New campaign', `On the Start screen, type "${NAME}" and press Create…, choosing a folder.`, async (expect) => {
    await page.getByRole('textbox').first().fill(NAME)
    await click('Create…')
    await page.getByText('Getting started', { exact: false }).first().waitFor()
    expect('the getting started guide opens', true)
  })

  await step('World map', 'Guide step 1: Make a world map (drawn on this computer, no AI), keep it.', async (expect) => {
    await click('Make a world map')
    await page.getByRole('button', { name: 'Keep this map' }).waitFor()
    await click('Keep this map')
    await page.getByText(/is on the desk/).waitFor()
    expect('the guide says the map is on the desk', true)
  })

  await step('Guide to the end', 'Guide: Next: your notes, then Start on the board › Open the board.', async (expect) => {
    await click('Next: your notes')
    await click('Open the board')
    await page.locator('.react-flow').waitFor()
    expect('the board opens', true)
    expect('the world map made Location cards for its regions', await page.locator('.react-flow__node').count() > 0)
  })

  await step('Player characters', 'Desk: Add a player character (the card on the table), twice; on each sheet a name and, on its Character sheet tab, 24 maximum hit points.', async (expect) => {
    for (const name of ['Isolde Varn', 'Tobin Ash']) {
      await click('Desk')
      await page.locator('.tarot-new.tarot-pc').click()
      const title = page.getByRole('textbox', { name: 'PC name' })
      await title.waitFor()
      await title.fill(name); await title.press('Enter')
      await page.getByRole('tab', { name: 'Character sheet' }).click()
      const max = page.getByRole('textbox', { name: 'Max', exact: true })
      await max.fill('24'); await max.press('Control+Enter')
      await page.waitForTimeout(300)
    }
    await click('Desk')
    const party = await text(page.getByRole('region', { name: 'Campaign table' }))
    expect('both are in the party on the desk', party.includes('Isolde Varn') && party.includes('Tobin Ash'))
  })

  await step('An NPC with a secret', 'Desk: New NPC, named "Sister Maren" on her sheet; on the board side panel, DM notes "She rang the bell herself."', async (expect) => {
    await click('Desk'); await click('New NPC')
    const title = page.getByRole('textbox', { name: 'NPC name' })
    await title.waitFor(); await title.fill('Sister Maren'); await title.press('Enter')
    await page.waitForTimeout(300)
    await click('Board'); await click('Fit View')
    const card = page.locator('.react-flow__node', { hasText: 'Sister Maren' })
    expect('she is on the board', await card.count() > 0)
    await card.first().click()
    const notes = page.getByRole('textbox', { name: 'DM notes' })
    await notes.fill('She rang the bell herself.'); await notes.press('Control+Enter')
    await page.waitForTimeout(300)
  })

  await step('Storyline', `Desk: New storyline "${NAME}".`, async (expect) => {
    await click('Desk'); await click('New storyline')
    await page.locator('#desk-new-story').fill(NAME); await click('Add')
    await page.getByRole('button', { name: `Open storyline ${NAME} on the board` }).waitFor()
    expect('it lies on the desk', true)
    await click('Board')
    expect('the board has a view for it', await page.getByRole('button', { name: NAME, exact: true }).count() > 0)
  })

  await step('Act on the Timeline', 'Timeline: + Act on the storyline, titled "The bell rings at midnight".', async (expect) => {
    await click('Timeline')
    await page.getByRole('button', { name: `Add an act to ${NAME}` }).click()
    await page.locator('#na-title').fill('The bell rings at midnight')
    await click('Add act')
    await page.locator('.tl-act').first().waitFor()
    expect('the act shows on the Timeline', (await text(page.locator('.tl-act').first())).includes('The bell rings at midnight'))
  })

  await step('Place the party', 'Map: Place party token › Place the party (in the middle of the map).', async (expect) => {
    await click('Map')
    await click('Place party token')
    await click('Place the party')
    await page.waitForTimeout(500)
    expect('the party has a token (no more Place party token)', await page.getByRole('button', { name: 'Place party token' }).count() === 0)
  })

  // The board is used on the world map (owner, 2026-10-21): the map behind the cards, its regions as places,
  // NPCs, monsters and encounters dropped and moved on it to see where everything is.
  const regionNames = () => page.locator('.react-flow__node-region').evaluateAll((els) => els.map((e) => e.querySelector('.board-region-name, strong, span')?.textContent?.trim() ?? e.textContent?.trim() ?? ''))
  const regionOf = (name) => page.locator('.react-flow__node-region').filter({ has: page.locator('.board-region-here', { hasText: name }) })
  /** Drags a card by its middle onto the middle of a region's name on the board; returns the message shown. */
  const dropOn = async (card, region) => {
    await click('Fit View'); await page.waitForTimeout(300)
    const from = await page.locator('.react-flow__node-card', { hasText: card }).first().boundingBox()
    const to = await page.locator('.react-flow__node-region').nth(region).boundingBox()
    if (!from || !to) throw new Error(`${card}: card or region not on screen`)
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2 + 4, { steps: 12 })
    await page.mouse.up()
    const toast = page.locator('.toast', { hasText: `${card} is now at` })
    await toast.first().waitFor({ timeout: 4000 }).catch(() => undefined)
    return (await toast.count()) ? await text(toast.first()) : ''
  }
  let placed = [] // [card, region index, region name]
  /** Region name tags whose middle is not covered by another tag or a card (where a DM can drop a card). */
  const clearTags = async () => { await click('Fit View'); await page.waitForTimeout(300); return page.locator('.react-flow__node-region').evaluateAll((els) => els.flatMap((e, i) => {
    const r = e.getBoundingClientRect()
    return e.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2 + 4)) ? [i] : []
  })) }

  await step('World map on the board', 'Board: Background › Use a map › the world map, so the cards sit on it and its regions are the places.', async (expect) => {
    await click('Board'); await click('Fit View')
    if (!await page.locator('.react-flow__node-image').count()) {
      notes.push('Board: a new campaign\'s board does not start on its world map: the regions are laid out as a grid of Location cards and the DM has to put the map behind them (Background › Use a map).')
      await click('Background')
      await page.getByRole('menuitem', { name: /^Use a map/ }).hover()
      await page.getByRole('menuitem').filter({ hasNotText: /Use a map|Add a picture|Region boundaries|background pictures/i }).first().click()
      await page.waitForTimeout(800)
    }
    // Adding a map switches dragging to the background (to place the map); cards are moved again with Move cards.
    if (await page.getByRole('button', { name: 'Move cards', exact: true }).count()) {
      notes.push('Board: after Use a map the board stays on "Moving the background" (cards faded, not draggable) until the DM clicks Move cards or Drag moves › Cards.')
      await click('Move cards')
    }
    await click('Fit View'); await page.waitForTimeout(300)
    expect('the world map lies on the board', await page.locator('.react-flow__node-image').count() === 1)
    expect('cards can be dragged again (not the background)', await page.getByRole('group', { name: 'What a drag moves' }).getByRole('button', { name: 'Cards', exact: true }).getAttribute('aria-pressed') === 'true')
    const names = await regionNames()
    expect(`its regions show by name on the map (${names.length})`, names.length >= 3)
    // A place shown as a region name is not also a loose Location card on the same board.
    const cards = await page.locator('.react-flow__node-card').allInnerTexts()
    const twice = names.filter((n) => cards.some((c) => c.trim().startsWith(n)))
    expect(`no place is both a region and a loose card${twice.length ? ` (${twice.slice(0, 3).join(', ')})` : ''}`, twice.length === 0)
  })

  await step('NPC, monster and encounter on the map', 'Board: Card › Monster "Drowned Ghoul", Card › Encounter "Shrine ambush"; drag Sister Maren, the ghoul and the ambush each onto a different region.', async (expect) => {
    for (const [type, name] of [['Monster', 'Drowned Ghoul'], ['Encounter', 'Shrine ambush']]) {
      await click('Card'); await page.getByRole('menuitem', { name: type, exact: true }).click()
      await page.waitForFunction(() => document.activeElement?.id.endsWith('-name'))
      const field = page.locator(`[id="${await page.evaluate(() => document.activeElement.id)}"]`)
      await field.fill(name); await field.press('Control+Enter'); await page.waitForTimeout(400)
    }
    const names = await regionNames()
    const clear = await clearTags()
    if (clear.length < 4) throw new Error(`only ${clear.length} region names are not covered by others`)
    const picks = [clear[0], clear[Math.floor(clear.length / 2)], clear[clear.length - 1]]
    placed = ['Sister Maren', 'Drowned Ghoul', 'Shrine ambush'].map((card, i) => [card, picks[i], names[picks[i]]])
    for (const [card, at, region] of placed) {
      const said = await dropOn(card, at)
      expect(`${card} dropped on ${region}: "${said || 'no message'}"`, said.includes(region))
    }
    await page.waitForTimeout(400)
    // People and monsters show on their place's name; an encounter's place is its Location (next step).
    for (const [card, , region] of placed.slice(0, 2)) expect(`${region} shows ${card} is there`, await regionOf(card).count() > 0 && (await text(regionOf(card).first())).includes(region))
  })

  await step('Move on the map', 'Board: drag the Drowned Ghoul from its region to another one.', async (expect) => {
    const names = await regionNames()
    const [, from, oldRegion] = placed[1]
    const clear = await clearTags()
    const to = clear.find((i) => i !== from && !placed.some((p) => p[1] === i))
    const said = await dropOn('Drowned Ghoul', to)
    expect(`the message says it is now at ${names[to]}`, said.includes(names[to]))
    await page.waitForTimeout(400)
    const now = await regionOf('Drowned Ghoul').allInnerTexts()
    expect(`only ${names[to]} lists it now (not ${oldRegion})`, now.length === 1 && now[0].includes(names[to]))
    placed[1] = ['Drowned Ghoul', to, names[to]]
  })

  await step('The map knows where they are', 'Map: click the region the ghoul went to; its side panel lists who is here. Sister Maren\'s and the Shrine ambush\'s Location in the board side panel say where they were dropped.', async (expect) => {
    const [, , region] = placed[1]
    await click('Map')
    // The map takes clicks itself (it pans): click where the name is written.
    const label = await page.locator('svg text').filter({ hasText: new RegExp(`^${region}$`) }).locator('visible=true').first().boundingBox()
    if (!label) throw new Error(`${region}: name not on the map`)
    // A town's name sits under its marker: the name, else the marker just above it.
    for (const dy of [0, -14]) {
      if ((await text(page.locator('.region-name').first())) !== region) { await page.mouse.click(label.x + label.width / 2, label.y + label.height / 2 + dy); await page.waitForTimeout(300) }
    }
    expect(`clicking the name ${region} opens ${region} in the side panel`, (await text(page.locator('.region-name').first())) === region)
    const here = page.locator('h3', { hasText: 'Here now' }).locator('xpath=..')
    await here.waitFor()
    expect(`Map › ${region} › Here now lists the Drowned Ghoul`, (await text(here)).includes('Drowned Ghoul'))
    await click('Board'); await click('Fit View')
    // Each card's Location (board side panel) is the place it was dropped on.
    for (const [card, , region] of [placed[0], placed[2]]) {
      await page.locator('.react-flow__node-card', { hasText: card }).first().click()
      const where = page.locator('select[id$="-location"]').first()
      await where.waitFor({ state: 'attached' })
      expect(`${card}: Location in the side panel says ${region}`, (await where.inputValue()) === region)
    }
  })

  await step('Session prep', 'Session prep: Start the prep sheet for session 1.', async (expect) => {
    await click('Session prep')
    await click('Start the prep sheet')
    await page.getByRole('region', { name: 'Session', exact: true }).waitFor()
    expect('the one-page prep sheet opens', true)
  })

  await step('Encounter', 'Encounters: New encounter, named "Ambush at the drowned shrine"; Suggest from the SRD (no AI), Add these.', async (expect) => {
    await click('Encounters')
    await click('New encounter')
    const name = page.getByRole('textbox', { name: 'Name' }).first()
    await name.fill('Ambush at the drowned shrine'); await name.press('Tab')
    // The builder's own Suggest (the side panel has one too).
    await page.getByRole('button', { name: 'Suggest', exact: true }).last().click()
    const offer = page.getByRole('button', { name: 'Add these' })
    await offer.waitFor()
    // What it offered: a crowd is hard to run at the table for a party this small.
    const offered = await text(offer.locator('xpath=..'))
    const crowd = Math.max(0, ...[...offered.matchAll(/(\d+) ×/g)].map((m) => Number(m[1])))
    if (crowd >= 8) notes.push(`Encounters: Suggest (SRD, Moderate) offered "${offered.replace(/\s*Add these\s*$/, '').trim()}" for 2 characters of level 1: ${crowd} creatures is a lot to run; consider fewer, stronger monsters for small parties.`)
    await offer.click()
    await page.waitForTimeout(800)
    const plan = await text(page.locator('main'))
    expect('it is planned under its name', (await text(page.getByRole('navigation', { name: 'Planned encounters' }))).includes('Ambush at the drowned shrine'))
    expect('monsters were suggested (Who fights is no longer empty)', !plan.includes('Nobody yet. Add cards'))
  })

  await step('Live session', 'Live desk: Start session 1; log "The party reached Hartby at dusk."; Isolde takes 5 damage; they meet Sister Maren; clock +1 h.', async (expect) => {
    await click('Live desk')
    await page.getByRole('button', { name: /^Start session/ }).click()
    await page.getByText('Now playing').waitFor()
    const clock = await text(page.locator('.clock, [class*="clock"]').first())
    await page.locator('#ql-text').fill('The party reached Hartby at dusk.')
    await click('Log it')
    await page.getByText('The party reached Hartby at dusk.').last().waitFor()
    expect('the log entry shows', true)
    const hp = page.getByRole('img', { name: /^Isolde Varn: / })
    const before = await hp.getAttribute('aria-label')
    await page.getByRole('button', { name: 'Damage Isolde Varn by 5' }).click().catch(() => page.getByRole('button', { name: /^Damage Isolde Varn/ }).first().click())
    await page.waitForTimeout(400)
    expect(`Isolde's hit points went down (${before} → ${await hp.getAttribute('aria-label')})`, before !== await hp.getAttribute('aria-label'))
    await page.locator('#ql-person').selectOption({ label: 'Sister Maren' })
    await click('Log meeting')
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'Clock forward one hour' }).click()
    await page.waitForTimeout(400)
    expect('the clock moved', clock !== await text(page.locator('.clock, [class*="clock"]').first()))
  })

  await step('End and review', 'Live desk: End session › End session and review; Approve all unflagged (the meeting with Sister Maren).', async (expect) => {
    await click('End session')
    await click('End session and review')
    await page.getByText('Session 1 review').waitFor()
    expect('the review opens', true)
    expect('it proposes the meeting with Sister Maren', (await text(page.locator('body'))).includes('Sister Maren'))
    await page.getByRole('button', { name: /^Approve all unflagged/ }).click()
    await page.waitForTimeout(500)
  })

  await step('What they know', 'What they know (the players\' view).', async (expect) => {
    await click('What they know')
    const view = page.getByRole('main', { name: 'Player preview' })
    await view.waitFor()
    await page.waitForTimeout(400)
    const shown = await text(view)
    expect('they are placed on the map (not "Uncharted")', !shown.includes('Uncharted'))
    expect('Sister Maren, whom they met, is shown', shown.includes('Sister Maren'))
    expect('her DM notes (her secret) are not shown', !shown.includes('rang the bell'))
  })

  await step('Leave the players\' view', 'Esc leaves What they know.', async (expect) => {
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Desk', exact: true }).waitFor()
    expect('the full rail is back', true)
  })

  await step('New cards in sight', 'Board: Card › NPC three times without moving the board; each new card should appear where the DM is looking.', async (expect) => {
    await click('Board'); await click('Fit View')
    for (const name of ['Watchman Pell', 'Old Gerta', 'The Bell-ringer']) {
      await click('Card'); await page.getByRole('menuitem', { name: 'NPC', exact: true }).click()
      await page.waitForFunction(() => document.activeElement?.id.endsWith('-name'))
      const field = page.locator(`[id="${await page.evaluate(() => document.activeElement.id)}"]`)
      await field.fill(name); await field.press('Control+Enter'); await page.waitForTimeout(400)
      // In sight: drawn (the board draws only what is in view) and inside the board's frame.
      const inSight = await page.evaluate((n) => {
        const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
        const card = [...document.querySelectorAll('.react-flow__node')].find((e) => e.textContent?.includes(n))?.getBoundingClientRect()
        return !!pane && !!card && card.left >= pane.left && card.right <= pane.right && card.top >= pane.top && card.bottom <= pane.bottom
      }, name)
      if (!inSight) notes.push(`Board: the new card "${name}" landed out of sight (Card › NPC with the board as it was); the DM has to look for it.`)
    }
    expect('the three cards were made', true)
  })

  await step('Action round-trip', 'Two cards made, edited, undone, redone, moved to History and revived; Board, sheet, Live desk, Map, Timeline and Encounters checked after each.', async (expect) => {
    const found = await roundTrip(page)
    expect('every screen showed every change', found.length === 0)
    for (const f of found) expect(f, false)
  }, 90000)

  await step('Close and open again', 'Close Dungeon Zen, start it again, open the campaign from the Start screen.', async (expect) => {
    await app.close()
    await start()
    await page.getByRole('button', { name: new RegExp(NAME) }).first().click()
    await page.locator('.rail').waitFor()
    await click('Desk')
    const desk = await text(page.getByRole('region', { name: 'Campaign table' }))
    expect('the party is still there', desk.includes('Isolde Varn') && desk.includes('Tobin Ash'))
    await click('Board'); await click('Fit View')
    expect('the world map is still on the board', await page.locator('.react-flow__node-image').count() === 1)
    for (const [card, , region] of placed.slice(0, 2)) expect(`${card} is still at ${region}`, await regionOf(card).count() > 0 && (await text(regionOf(card).first())).includes(region))
    expect('the Shrine ambush card is still on the map', await page.locator('.react-flow__node-card', { hasText: 'Shrine ambush' }).count() > 0)
    await click('Timeline')
    expect('the act is still there', (await text(page.locator('.tl-act').first())).includes('The bell rings at midnight'))
    await click('Live desk')
    await click('Review')
    await page.getByText('Session 1 review').waitFor()
    expect('session 1 and both its log entries are still there', (await text(page.locator('body'))).includes('2 log entries'))
  })
} catch (err) {
  steps.push({ title: 'Playtest stopped', what: '', checks: [], findings: [], errors: [], error: err.message.split('\n')[0], ms: 0, ok: false })
} finally {
  await app?.close().catch(() => undefined)
}

// ---- the report
const failed = steps.filter((s) => !s.ok)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const improve = [
  ...notes,
  ...failed.map((s) => `Fix: "${s.title}" failed (${s.error ?? s.errors[0] ?? s.checks.find((c) => !c.ok)?.check}).`),
  ...steps.filter((s) => s.ms > s.slow).map((s) => `Speed: "${s.title}" took ${(s.ms / 1000).toFixed(1)} s (over ${s.slow / 1000} s).`),
  // Board cards cut by the edge of the view are where the DM put them (the board pans), not a fault.
  ...steps.flatMap((s) => [...new Set(s.findings.filter((f) => !f.includes('div.toast') && !f.includes('by div.react-flow')))].map((f) => `Look (${s.title}): ${f}`))
]
// A message (toast) covering text: one line with what it covered, not one per word.
const toasted = steps.filter((s) => s.findings.some((f) => f.includes('div.toast')))
if (toasted.length) improve.push(`Look: the message after an action (toast) covers text for a few seconds: ${toasted.map((s) => `${s.title} (${s.findings.filter((f) => f.includes('div.toast')).map((f) => f.replace(/^.*?: \w+ /, '')).join(', ')})`).join('; ')}.`)
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Dungeon Zen playtest</title><style>
body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:16px;background:#f6f1e6;color:#2b2118}
h1,h2{font-family:Georgia,serif}.ok{color:#2e6b34}.fail{color:#a12a1f}section{background:#fff;border:1px solid #d9cdb4;border-radius:8px;padding:12px 16px;margin:12px 0}
img{max-width:100%;border:1px solid #d9cdb4;border-radius:4px}li{margin:2px 0}code{background:#efe6d3;padding:0 3px}
</style></head><body>
<h1>Dungeon Zen playtest</h1>
<p>${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${process.env.DZ_EXE ? 'installed app' : 'built app'} · ${process.platform}${scale ? ` · display scaling ${scale * 100} %` : ''}
· <strong class="${failed.length ? 'fail' : 'ok'}">${steps.length - failed.length} of ${steps.length} steps passed</strong></p>
<p>The campaign this playtest made is in the folder <code>${esc(NAME)}</code> next to this page: in Dungeon Zen, Open a campaign folder… and choose it.</p>
<h2>What to improve</h2>
${improve.length ? `<ul>${improve.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>Nothing found this run.</p>'}
<h2>What was tested</h2>
<p>Not in this playtest: AI services (writing, pictures, reading notes, Build with AI), importing notes or character sheets,
exports (Word, PDF, Roll20, Foundry, Owlbear), battle maps, running a fight and casting spells, links drawn between cards, the Library and Notes screens.
The smoke test visits those screens; <code>tests/undoall.test.ts</code> checks undo for every write behind them.</p>
${steps.map((s, i) => `<section><h3 class="${s.ok ? 'ok' : 'fail'}">${i + 1}. ${esc(s.title)}: ${s.ok ? 'passed' : 'FAILED'} <small>(${(s.ms / 1000).toFixed(1)} s)</small></h3>
<p>${esc(s.what)}</p>
<ul>${s.checks.map((c) => `<li class="${c.ok ? 'ok' : 'fail'}">${c.ok ? '✓' : '✗'} ${esc(c.check)}</li>`).join('')}
${s.error ? `<li class="fail">✗ ${esc(s.error)}</li>` : ''}${(s.errors ?? []).map((e) => `<li class="fail">✗ ${esc(e)}</li>`).join('')}</ul>
${s.shot ? `<img src="${s.shot}" alt="Screen after ${esc(s.title)}" loading="lazy">` : ''}</section>`).join('\n')}
</body></html>`
writeFileSync(join(out, 'report.html'), html)
// The demo campaign: the played folder without its backups.
if (existsSync(join(work, NAME))) cpSync(join(work, NAME), join(out, NAME), { recursive: true, filter: (f) => !f.includes(`${NAME}/backups`) && !f.includes(`${NAME}\\backups`) })
rmSync(work, { recursive: true, force: true })
console.log(`Playtest: ${steps.length - failed.length} of ${steps.length} steps passed. Report: ${join(out, 'report.html')}`)
if (failed.length) process.exit(1)
