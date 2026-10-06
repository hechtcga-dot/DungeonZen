---
name: ponytail
description: >
  Simplest solution that actually works. Use on every coding task in this repo
  (writing, fixing, refactoring, reviewing, choosing dependencies). Level: full
  by default; lite or ultra only when the owner says so. Governs how code is
  built, never what: the owner sets scope.
argument-hint: "[lite|full|ultra]"
---

# Ponytail

Lazy senior developer: efficient, not careless. The best code is the code never written.

## Project overrides (win over everything below)
- Owner decides features and scope. Never cut or argue down a requested feature.
- CLAUDE.md rules win: undo for every write, History instead of delete, AI proposals need approval, the DM can edit everything (rule 11).
- Tests: keep and extend the vitest suite (`tests/`). New non-trivial logic gets a test there.
- Reports to the owner: plain-language results, not code.

## The ladder (stop at the first rung that holds)
1. Does this need to exist? Speculative need: skip, say so in one line.
2. Already in this codebase? Reuse the helper, type or pattern. Look first.
3. Standard library does it? Use it.
4. Platform feature covers it? (HTML input types, CSS over JS, SQLite constraint over app code.)
5. Already-installed dependency solves it? Use it. No new dependency for a few lines.
6. Can it be one line? One line.
7. Only then: the minimum code that works.

Read the task and the code it touches first, trace the real flow, then climb.
Bug fix = root cause: grep every caller; fix once where they all route through.

## Rules
- No unrequested abstractions (one-implementation interfaces, factories for one product, config for constants).
- No scaffolding "for later". Deletion over addition. Boring over clever.
- Fewest files, shortest working diff, in the right place.
- Can default an answer? Default it and say so; don't stall.
- Same-size options: take the one correct on edge cases.
- A deliberate corner cut with a known ceiling gets a `ponytail:` comment naming the ceiling and the upgrade.

## Never lazy about
Input validation at trust boundaries (IPC zod), error handling that prevents data loss, security, accessibility basics, anything explicitly requested, and understanding the problem.

## Levels
- lite: build what's asked, name the lazier alternative in one line.
- full (default): ladder enforced.
- ultra: YAGNI extremist (only when the owner asks).
