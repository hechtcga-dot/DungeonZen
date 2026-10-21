// Action round-trip (every change on every screen, owner 2026-10-06): make two cards, edit one, undo, redo,
// move both to History, bring them back. After each step every screen that shows them is checked:
// a player character on Board, its sheet, Live desk and Map (tokens); an encounter tied to act I on Board,
// Timeline (the act's encounters) and Encounters. Returns the problems found (also used by the playtest).
export async function roundTrip(page) {
  const problems = []
  let doing = 'start'
  const click = (name) => page.getByRole('button', { name, exact: true }).first().click()
  const pause = () => page.waitForTimeout(500)
  // Fit View: the board draws only the cards in sight, and a new card can land outside it.
  const board = async () => { await click('Board'); await pause(); await click('Fit View'); await pause() }
  const node = (name) => page.locator('.react-flow__node', { hasText: name })

  /** What each screen shows of the two cards; `pc`/`enc` null = must show nowhere. */
  async function check(step, pc, enc) {
    doing = `checking the screens (${step})`
    const want = (where, name, text) => {
      const shown = text.includes(name)
      if (!shown) problems.push(`round-trip, ${step}: ${where} does not show ${name}`)
    }
    const gone = (where, name, text) => { if (text.includes(name)) problems.push(`round-trip, ${step}: ${where} still shows ${name}`) }
    const on = (where, name, text) => name.startsWith('!') ? gone(where, name.slice(1), text) : want(where, name, text)
    await board()
    const cards = (await page.locator('.react-flow__node').allInnerTexts()).join('\n')
    on('Board', pc, cards); on('Board', enc, cards)
    await click('Live desk'); await pause()
    on('Live desk (party)', pc, (await page.locator('.pc-live-name').allInnerTexts()).join('\n'))
    await click('Map'); await pause()
    on('Map', pc, await page.locator('.pc-tokens').innerText())
    await click('Timeline'); await pause()
    await page.locator('.tl-act').first().click(); await pause()
    on('Timeline (act I)', enc, await page.locator('.tl-encounters').innerText())
    await click('Encounters'); await pause()
    on('Encounters (planned)', enc, await page.getByRole('navigation', { name: 'Planned encounters' }).innerText())
    if (!pc.startsWith('!')) {
      await board(); await node(pc).first().dblclick(); await pause()
      on('the sheet', pc, await page.getByRole('textbox', { name: 'PC name' }).inputValue())
    }
  }
  const newCard = async (type, name) => {
    doing = `making ${name}`
    await board(); await click('Card'); await page.getByRole('menuitem', { name: type, exact: true }).click()
    // The new card's name field, selected for typing (by id: the test window may not have the system focus).
    await page.waitForFunction(() => document.activeElement?.id.endsWith('-name'))
    const field = page.locator(`[id="${await page.evaluate(() => document.activeElement.id)}"]`)
    await field.fill(name); await field.press('Control+Enter'); await pause()
    await click('Fit View'); await node(name).first().waitFor()
  }
  const remove = async (name) => {
    doing = `moving ${name} to History`
    await board(); await node(name).first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete (to History)' }).click(); await pause()
  }

  try {
    await newCard('PC', 'Brannoc the Bold')
    await newCard('Encounter', 'Ambush at the Ford')
    // The encounter tied to act I (board side panel › Story).
    await page.getByRole('tab', { name: 'Story', exact: true }).click()
    await page.locator('.story-card .act-tick input').first().check(); await pause()
    await page.getByRole('tab', { name: 'Inspector', exact: true }).click()
    await check('made', 'Brannoc the Bold', 'Ambush at the Ford')

    // Edit: rename on the board side panel.
    await board(); await node('Brannoc the Bold').first().click(); await pause()
    await page.locator('textarea[id$="-name"]').first().fill('Brannoc Stonehand'); await page.locator('textarea[id$="-name"]').first().press('Control+Enter')
    await node('Brannoc Stonehand').first().waitFor()
    await check('renamed', 'Brannoc Stonehand', 'Ambush at the Ford')
    await click('Undo'); await pause()
    await check('undone', 'Brannoc the Bold', 'Ambush at the Ford')
    await click('Redo'); await pause()
    await check('redone', 'Brannoc Stonehand', 'Ambush at the Ford')

    await remove('Brannoc Stonehand'); await remove('Ambush at the Ford')
    await check('moved to History', '!Brannoc Stonehand', '!Ambush at the Ford')
    await board(); await page.getByRole('tab', { name: 'History', exact: true }).click(); await pause()
    for (const name of ['Brannoc Stonehand', 'Ambush at the Ford']) {
      // Its own row: the row holds its Select tick and its Revive button.
      await page.getByRole('checkbox', { name: `Select ${name}`, exact: true }).locator('xpath=..').getByRole('button', { name: 'Revive' }).click(); await pause()
    }
    await page.getByRole('tab', { name: 'Inspector', exact: true }).click()
    await check('revived', 'Brannoc Stonehand', 'Ambush at the Ford')
  } catch (err) {
    problems.push(`round-trip failed while ${doing}: ${err.message.split('\n')[0]}`)
  }
  return problems
}
