# Plan: Dungeon Zen on the web (draft, 2026-10-23)

Owner, 2026-10-23: web app anyone can sign up for; the subscription is the AI (hosted, no keys); free users get a limited amount of AI to try; selling from Canada.
Built in milestones like `PLAN-3.0.md`; each milestone with UI changes gets a mockup the owner approves first.

## What changes from the desktop rules
- Rule 1 (local-first): for the web edition, campaigns live on our server. Still only AI and Open5e calls leave the server.
- Rule 7 (keys in safeStorage): the web edition holds our own AI keys as server secrets; DMs never enter keys.
- "One computer only": a web account works from any browser.
- Rules 2–6 and 8–11 stay as they are (approve before change, nothing hard-deleted, undo everywhere, time in minutes, Zod, copy SRD in, party knowledge, AI look, DM edits everything).
- Local services (Ollama, SD web UI) are desktop only.

## Defaults picked (owner can change)
- Payments: Paddle as merchant of record. It sells in its own name, so it charges and files GST/HST, US sales tax and EU VAT; we get payouts. Fee about 5% + US$0.50 per sale. (Stripe is cheaper, but then we register for GST/HST once over C$30,000 a year and handle foreign taxes ourselves.)
- Prices: Free C$0; Subscription C$10 a month or C$100 a year (two months free). Shown in local currency by Paddle.
- Free: the whole app, unlimited campaigns, 500 MB of pictures and files, a one-time trial of AI credits (about 50 Fill/Build actions or 5 pictures).
- Subscription: monthly AI credits (about 40% of the price spent on AI cost), 10 GB of files, top-up packs when credits run out. Unused credits roll over one month.
- AI credits are counted from what each call really costs us (tokens, images) times a fixed factor, so a picture costs more credits than a text fill. The DM sees the credit cost before each AI action and the balance in Setup.
- The DM still picks writing and map service from drop-downs, from the services we host.
- Hosting: one Node server (no Electron) on a rented server with a disk; one folder per user holding the same campaign folders as today (`campaign.db` + `assets/`); pictures served from there. Nightly off-site backup. Move pictures to object storage (Cloudflare R2) only when the disk gets tight.
- Sign-in: email + password, email check, password reset by email (sent through an email service, e.g. Postmark). Google sign-in later.

## W0 Split the app from Electron (no visible change)
- `src/main` becomes a server that can run without Electron: the 4 files that import `electron` go behind one small platform interface (files, dialogs, open folder, Recycle Bin, keys, asset protocol). Desktop keeps its Electron version of it.
- Renderer: `invoke(channel, input)` (`src/preload/index.ts`) gets a web version that POSTs to `/api/<channel>`; same zod inputs, same `IpcOutputs`. Import progress over a server event stream.
- `dz-asset://campaign/<path>` becomes `/assets/<campaign>/<path>` on the web.
- Checks: vitest and smoke run against both; smoke gets a browser mode (playwright Chromium).

## W1 Accounts and safety
- Sign up, sign in, sign out, email check, reset password, change email/password, delete account (kept 30 days, revivable, then removed: the one place data is removed for good, for privacy law).
- Every request scoped to the signed-in user's folder; tests that one user can never read or write another's campaign (ids, paths, `..`).
- Rate limits on sign-in and AI; one server process per user's campaign at a time (SQLite file locks).

## W2 Files in the browser
- File dialogs become upload / download. Imports (notes, PDFs, pictures, maps) uploaded into the campaign folder as today.
- "Open folder" links become "Download" (file) and "Download campaign" (whole folder as a .zip: the one-folder backup).
- Upload campaign: a desktop campaign folder (.zip) opens on the web, so desktop DMs can move over.
- Delete campaign: to a Deleted campaigns list for 30 days (revivable) instead of the Recycle Bin.
- Storage use shown in Setup, against the plan's limit.

## W3 Hosted AI and credits
- Server holds our keys for the hosted services (secrets in the host's settings, never in campaigns or the DB).
- Credit ledger per user (every grant, spend, top-up, refund; nothing overwritten). Each AI call: check balance, run, charge the real cost; failed calls are free.
- Price list per service and model in `shared/aiProviders.ts` (cost per 1M tokens, per image).
- Out of credits: the AI button says so and offers Subscribe or Top up; the rest of the app keeps working.
- Our own limit per user per day, and an overall monthly spending cap, so a bug or abuse cannot run up the bill.

## W4 Subscription
- Paddle checkout from Setup › Plan; webhooks set the plan and grant monthly credits; Paddle's own page for card changes, invoices and cancel.
- Cancel: keeps the subscription to the end of the paid month, then back to Free; campaigns and files stay (over the free storage limit: read-only uploads until under it, nothing removed).
- Plan, credits, storage and invoices in Setup › Plan.

## W5 Launch
- Domain, HTTPS, landing page (what it is, pictures, prices, sign up).
- Terms of service, privacy policy (Canadian PIPEDA, plus GDPR for EU users), refund policy (Paddle requires them).
- SRD 5.2 credit line (CC-BY-4.0) in the app and site; check each Open5e source's licence and leave out any that bar selling.
- Trademark search on "Dungeon Zen" (Canada and US).
- Error reports and server monitoring; admin page for us: users, plans, credits (grant, refund).
- Beta first: invite-only sign-up for a few DMs, then open.

## Open questions for the owner
- Does the Windows desktop app stay (free, own keys) next to the web app, or does the web app replace it?
- Do the prices and free limits above suit you?
- What domain name do you want, and do you already own one?
