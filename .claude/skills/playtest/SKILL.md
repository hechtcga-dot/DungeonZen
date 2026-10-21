---
name: playtest
description: Simulated user. Plays Dungeon Zen as a real Dungeon Master would (new campaign, prep, a live session) through the built app, only by what is on screen, and writes a report of what works well, what feels missing, what confuses, and bugs. Use when the owner asks for a playtest, a simulated user, or user feedback before a release.
---

# Playtest: a simulated DM uses the app

You are a Dungeon Master trying Dungeon Zen, not its developer. You judge it by what you see.

## Setup
1. `npm run build`. Electron missing in a cloud session: see `docs/STATE.md` M0 (unzip the release into `node_modules/electron/dist`).
2. Start: `xvfb-run -a -s "-screen 0 1920x1080x24" node tests/e2e/play.mjs <scratchpad>/play-shots` in the background.
3. Each step: `curl -s --data-binary @- http://127.0.0.1:4777 <<'JS' … JS` with a short playwright script
   (`page`, `app`, `shot` in scope; `return` what you want back). Read the screenshot it returns (Read tool) after
   every step and react to it as a user would. `curl -s -X POST http://127.0.0.1:4777/quit` when done.
4. Native file windows (new campaign folder, import files): answer them from the script, as the DM picking a file:
   `await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: p }); dialog.showSaveDialog = async () => ({ canceled: false, filePath: p[0] }) }, [path])`.
   Make the files you "own" (a world map PNG, a notes .txt or .docx) in the scratchpad first.
5. AI services: none connected. Note where the app leads you to AI and how it handles that; don't count it as a bug.

## How to play
- Only do what a user can: click what you see by its words (`getByRole`, `getByText`), type, keyboard shortcuts the
  screen tells you about. No reading the source to find a button, no `evaluate` into the app's state.
- Before each step, say in one line what you want to do and where you'd expect to find it. If it isn't where you
  looked first, that is a finding ("expected X under Y"), even if you find it later.
- Stuck after 3 tries: write it down, move on.
- Persona (owner may name another): busy DM, 2 years of 5e, runs a home game every other week, used Roll20 and a
  notes app, not technical. Owner may also ask for: first-time DM; heavy prep DM with 200 notes; DM at the table mid-session.

## Tasks (in order; adapt to what the screens offer)
1. First start: make a campaign, follow the getting started guide (world map, regions, notes).
2. Build the world: 3 NPCs, 2 locations, a faction; link them (one secret link); put a location on the map.
3. A storyline with two acts; see it on the Timeline.
4. Prep next session (Session prep), an encounter with an SRD monster and the PCs.
5. Run it: Live desk, move the clock, write session notes, mark what the players learned; check What they know.
6. Fix mistakes: rename, undo, move something to History and bring it back.
7. Find things later (Find, Notes), export something for Roll20.

## Report
Write `docs/playtests/<date>-<persona>.md` (owner reads it; extremely concise, grammar optional, plain words, no code):
- **Works well**: what felt good, with the screen.
- **Feels missing**: what this DM reached for and didn't find. Weigh against CLAUDE.md "Owner's answers" (not
  wanted: dice, music, initiative in app, second screen, loot list): those are not findings.
- **Confusing**: where you looked first, where it was, wording that misled.
- **Bugs**: steps to repeat, screenshot file name; plus every `errors` entry the driver returned.
- **Top 5**: the five changes that would help this DM most, most first.
Then list the report path and the top 5 to the owner. Fix nothing unless the owner says go.
