# Plan for 3.0 (draft, 2026-10-19)

Built in milestones. Each milestone with UI changes gets a mockup the owner approves first; no point releases between milestones except fixes.
Release: Dungeon Zen 3.0 (no rename). Owner, 2026-10-19: name stays Dungeon Zen; no paid code signing; auto-linking as recommended (filters + per-card tick, on by default for NPC/PC/Location/Faction).

## M0 Safety net (first; no visible change) — built 2026-10-19
- Before any schema upgrade the app copies `campaign.db` to `campaign.<old version>.bak` in the campaign folder, and runs all pending upgrade steps in one transaction (today: one per step), so a failure leaves the old file untouched. Already in place: `PRAGMA user_version`, and an older app refuses a newer campaign with a message (`db/open.ts`); M0 adds a test for both.
- CI on every push: typecheck + vitest (Ubuntu), separate from the release workflow.
- Screenshot smoke test checked in (`tests/e2e/`): playwright `_electron`, demo campaign seed, visit every screen, save screenshots; runs in CI (Windows job too).
- Old-campaign fixtures: small campaign.db files from 1.x/2.x; test opens each, migrations run, data intact.
- Errors visible: replace silent `catch(() => …)` in `store.refresh` and elsewhere with a message; main writes a log file in userData (Setup › Open log folder) for bug reports.

## M1 Code structure (no visible change)
- Split `src/main/campaign/campaign.ts` (4,926 lines) by area: boards, cards, links, maps, encounters, combat, notes, prep, pictures, import/review. Same `db` + `CommandLog`.
- Lean refresh: each screen loads only its own view; `board:view` / `links:view` only when shown or needed.
- Zod schema per card type for `entity.attributes` (now `record<string, unknown>`), checked on write; migration fixes bad old values.
- Glossary in `docs/DATA_MODEL.md` (screen word = code word for new code; link, not string/relationship/connection).
- CLAUDE.md trimmed to rules, decisions, where things live; release history moved to `docs/CHANGELOG.md`.
- CSS tokens for spacing, sizes, radii in `theme.css`; inline styles moved out.
- One source for card type colour + icon (`entityStyle.ts`), used by board, sheet, panels, maps.
- Asset cleanup: Setup › Tidy campaign folder lists files in `assets/` that nothing uses (not cards, maps, notes, History, nor any undo step), with size; DM ticks and sends to the Recycle Bin (rule 3: nothing removed without the DM). Also listed after the M2 migration.

## M2 One link model (biggest change; data migration)
- Link, Secret, Clue = one record kind (`link`: from, to, kind/type, text, known/secret, clue flag). Secrets' "connections" and board strings become the same rows.
- One editor component used everywhere a link is made or edited: board drag, card sheet Links/Secrets tab, prep "Links, secrets, clues", note Mentions. Four creation paths → one dialog, opened from four places.
- One auto-link matcher (today two: `LinkField.tsx` and `shared/noteLinks.ts`, with different rules) with filters:
  minimum length 4, common-word blocklist (inn, rat, guard, the docks…), single-word names match only with their capital letter, per-card "Link this name by itself" tick (on by default for NPC/PC/Location/Faction, off for Item/Other).
- Matching never runs on every keystroke: results cached per text and card list, re-run after typing pauses (about 300 ms). Measured on a 5,000-word note with 500 cards; moved to a Web Worker only if still slow.
- Migration: every existing string/secret/clue/word link converted; old ids kept.
- Undo and Undo session: the change log stores before/after copies of rows, so old steps would write old-shape link rows back. The migration rewrites those copies to the new shape; any step it cannot rewrite is marked "from before 3.0, cannot be undone" (shown in History, never half-applied). Tests: undo a pre-3.0 link step and a whole pre-3.0 session on a fixture campaign.

## M3 Progressive disclosure in AI windows
- One Draw window component for card picture, battle map and world map (today three separate dialogs).
- Simple by default: description, service, Draw. Everything else in an Advanced fold.
- Advanced shows only what the chosen service can do: capability flags per service in `shared/aiProviders.ts` (references, update/change, marks, outline/blueprint, follow a picture, sizes). Unsupported options hidden, not greyed.
- Same for Fill with AI / Build with AI: one button first, options folded.

## M4 Everyday use
- Backspace no longer goes back (Alt+← and the Back button stay).
- Ctrl+K: find and go to anything (card, note, encounter, session, screen, map region).
- Empty new card/row removed on click-away shows "Removed – Undo" for a few seconds.
- Roll20 export pass: one shared macro format for attacks, spells, checks; tests pin the exact text of each macro and the API script so schema changes in 3.0 cannot alter what a DM pastes in.
- Right-click actions also listed in hover text or a ⋯ button (discoverability).
- Fewer places to go: review the 15 screens + 3 modes with the owner (mockup) — merge or hide what overlaps.
- Large-campaign speed check: demo campaign with 1,000 cards, 200 notes; time board, prep, notes.

## M5 Distribution
Windows only, installer stays unsigned (owner, 2026-10-19).
- Auto-update from GitHub Releases over HTTPS (`electron-updater`): "A new version is ready – Restart". Works with the unsigned per-user installer; Windows may show the SmartScreen prompt once per update, as with a manual download.
- App name, appId and userData folder unchanged (saved API keys, recent campaigns, settings carry over).
- Release notes keep the "More info › Run anyway" line.

## After 3.0
- Code signing, if wanted later.
- macOS and Linux builds (Apple developer account, notarization, Mac file-dialog and path testing; Linux packaging). Never holds up M5.

## Order
M0 → M1 → M2 → M3 → M4 → M5 → release 3.0.0. M0 and M1 change nothing on screen; M2–M4 each start with a mockup.

## Risks
| Risk | Where | Handling |
|---|---|---|
| Schema upgrade fails part-way | M2 | .bak copy first, all steps in one transaction, old-campaign fixture tests (M0) |
| Older app opens a 3.0 campaign | M2 | Already refused with a message; test added |
| API keys unreadable | M5 | No rename, userData folder unchanged; failed read already asks for keys again |
| SmartScreen warning (unsigned) | M5 | Release notes explain "Run anyway"; auto-update keeps prompts to updates only |
| Undo / Undo session over old link steps | M2 | Change log copies rewritten in the migration; unrewritable steps marked not undoable; tests |
| Auto-link slows typing | M2 | Cached, run after a pause, measured |
| Roll20 macros change | M2–M4 | Exact-text tests on every macro |
