# Architecture

## 1. Runtime
| Layer | Choice | Notes |
|---|---|---|
| Shell | Electron | Windows target; installer roughly 100 MB or more |
| UI | React + Vite | Replaces the original Next.js plan |
| State | Zustand | Timeline position, open panels, mode, quick-log drafts |
| Board | `@xyflow/react` | Custom card nodes, string edges |
| DB | SQLite, better-sqlite3, Drizzle | Replaces Prisma (packaging issues) |
| Validation | Zod | Shared between main and renderer |
| AI | Provider adapters over HTTPS (`src/main/ai/client.ts`), DM picks the service | Main process only |
| Content | Open5e API | SRD only; cached as local copies |

## 2. Storage
- One campaign = one folder: `campaign.db` plus `assets/` (maps, images,
  handouts, imported source files).
- Export and backup produce a single bundle file (zip of the folder).
- DM profile lives outside campaign folders: preferences and the encrypted
  API key (`safeStorage`).
- Session history allows rewinding the campaign to any past session.

## 3. Temporal engine

### 3.1 Time
Integer minutes from campaign start. The engine suggests durations (for
example travel A to B = 4 h); the DM confirms or overrides (3 h).

### 3.2 Deltas
Every change is a patch on one entity or one relationship:
- `at_minute`, `seq` (order within the same minute)
- `ops`: list of `set`, `unset`, `list_add`, `list_remove`
- `origin`: `autonomous`, `player`, `manual`, `import`
- links to the act, outcome, trigger, session, or log entry that caused it

### 3.3 Merge rules
World state at time T = base attributes + every non-superseded canon delta
with `at_minute <= T`, applied in `(at_minute, seq)` order.
- Same field, later delta wins.
- Same minute: DM-approved (`player`, `manual`) beats `autonomous`.
- List fields use add and remove ops, never whole replacement.
- Deltas are never deleted; they are marked `superseded_by`.
- Cache computed state per session boundary; recompute forward from the
  earliest changed minute.

### 3.4 Storylines, acts, outcomes
- A storyline has ordered acts with start and end minutes.
- An act has several named outcomes, one flagged as the default applied if
  the players ignore it. Outcomes carry deltas.
- Storyline status: `inactive`, `autonomous`, `player_active`, `concluded`.
- Ignored storylines progress on their own by applying default outcomes.

### 3.5 Cross-storyline triggers
Structured, not free text: "when Act X ends with outcome Y, apply effect Z
to storyline W". Effect types: `shift_act`, `force_outcome`,
`set_status`, `apply_deltas`. Each trigger fires once. Effects only apply
forward in time, which prevents loops. AI may propose triggers but they are
stored in this form.

### 3.6 What-if, undo, rewind
- What-if = a scenario layer of draft deltas over canon. Promote to make
  it canon (superseding what it replaces) or discard.
- Undo = command log; each command records the deltas and rows it created
  or superseded. A whole session or a whole import can be undone as one
  step.
- Rewind = view state at a past session boundary; defunct characters and
  storylines can be revived from History.

### 3.7 Conflicts
When a log entry contradicts planned state (an NPC logged in two places),
create a conflict record. The DM can resolve it, explain, or leave it
flagged until after the session. Unresolved conflicts are highlighted.

## 4. AI pipeline
All AI features follow: gather context, call model with a Zod schema,
produce proposals, show diff, DM approves, commit as deltas or rows.

| Feature | Input | Output |
|---|---|---|
| Notes import | docx, pdf, images, text | Proposed NPCs, factions, towns, storylines, acts, links, questions |
| Sketch ingestion | photo of hand-drawn module | Proposed cards and structure |
| Fill blanks | partial entity | Suggested fields |
| Quick-log interpreter | DM note + world state | Proposed deltas, clarifying questions |
| Cascade resolver | approved outcome | Ripple deltas across storylines |
| Scene description | DM prompt + time, weather, region atmosphere | Read-aloud text |
| On-the-fly generators | region, time, party state | NPC, tavern with patrons, encounter |
| Battle map | scene description | Map image (needs image provider) |
| Session recap | quick-log + approved changes | Editable recap, player-safe option |
| Adaptive difficulty | encounter feedback, uploaded rules | Difficulty ratings |

Rules:
- Every proposal records provenance: source file, locator, quoted text,
  and whether a field was `stated` or `inferred`.
- Possible duplicates of existing entities are flagged with a merge option.
- Ambiguities become questions the DM can answer or defer.
- Offline: quick-log saves notes locally; AI questions appear on reconnect.

## 5. Integrations
- Open5e: monsters, spells, items. Search, then copy into the campaign.
  SRD only, so homebrew entry must be first-class.
- Roll20: target format is sheet fields plus abilities as macros and token
  actions. Delivery mechanism is unverified (see FEATURES.md).
- Exports: PDF and JPG for sheets, letters, bulletin boards; map images.

## 6. Risks
- Roll20 has no confirmed official import path.
- Handwriting recognition accuracy on photos.
- AI cost and latency during live play.
- Engine correctness: merge and trigger logic needs heavy unit testing.
