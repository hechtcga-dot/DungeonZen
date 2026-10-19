# Plan for 3.0 (draft, 2026-10-19)

Built in milestones. Each milestone with UI changes gets a mockup the owner approves first; no point releases between milestones except fixes.
Release name: pending owner (Dungeon Zen 3.0 vs AuctionZen 3.0).

## M0 Safety net (first; no visible change)
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

## M2 One link model (biggest change; data migration)
- Link, Secret, Clue = one record kind (`link`: from, to, kind/type, text, known/secret, clue flag). Secrets' "connections" and board strings become the same rows.
- One editor component used everywhere a link is made or edited: board drag, card sheet Links/Secrets tab, prep "Links, secrets, clues", note Mentions. Four creation paths → one dialog, opened from four places.
- One auto-link matcher (today two: `LinkField.tsx` and `shared/noteLinks.ts`, with different rules) with filters:
  minimum length 4, common-word blocklist (inn, rat, guard, the docks…), single-word names match only with their capital letter, per-card "Link this name by itself" tick (on by default for NPC/PC/Location/Faction, off for Item/Other).
- Migration: every existing string/secret/clue/word link converted; old ids kept; undo history before the migration not carried over (backup made first).

## M3 Progressive disclosure in AI windows
- One Draw window component for card picture, battle map and world map (today three separate dialogs).
- Simple by default: description, service, Draw. Everything else in an Advanced fold.
- Advanced shows only what the chosen service can do: capability flags per service in `shared/aiProviders.ts` (references, update/change, marks, outline/blueprint, follow a picture, sizes). Unsupported options hidden, not greyed.
- Same for Fill with AI / Build with AI: one button first, options folded.

## M4 Everyday use
- Backspace no longer goes back (Alt+← and the Back button stay).
- Ctrl+K: find and go to anything (card, note, encounter, session, screen, map region).
- Empty new card/row removed on click-away shows "Removed – Undo" for a few seconds.
- Right-click actions also listed in hover text or a ⋯ button (discoverability).
- Fewer places to go: review the 15 screens + 3 modes with the owner (mockup) — merge or hide what overlaps.
- Large-campaign speed check: demo campaign with 1,000 cards, 200 notes; time board, prep, notes.

## M5 Distribution
- Code signing for the Windows installer (removes SmartScreen warning; needs a paid signing service, owner decides).
- Auto-update from GitHub Releases (`electron-updater`): "A new version is ready – Restart".
- Rename (if AuctionZen): new name on screen and installer only; appId and userData folder kept, or migrated, so API keys, recent campaigns and settings survive.
- Optional: macOS / Linux builds (Windows-only parts: Recycle Bin, paths, installer; Mac needs Apple developer account for signing).

## Order
M0 → M1 → M2 → M3 → M4 → M5 → release 3.0.0. M0 and M1 change nothing on screen; M2–M4 each start with a mockup.
