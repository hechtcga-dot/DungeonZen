# Plan for 3.9: Calendar (draft, 2026-10-22)

Owner request 2026-10-22, answers same day. Built in groups; each group with UI changes gets owner approval of its
mockup first (as in `PLAN-3.0.md`). Mockups: https://claude.ai/artifact/Mrg9TcDLFYkjhLYJKhXsjE Time stays integer minutes from campaign start (rule 5); the calendar only turns
minutes into dates and back. Days stay 24 hours. Reference look: Fantasy Calendar month grid (owner screenshot).

## Owner decisions (2026-10-22)
- Desk "Set…" sets the time of day only (hour, minute; past midnight = next day). The date is set on the Calendar
  screen. Campaign settings move to the gear menu (name, rules, measurements, prices).
- Desk map button: "Full Map / Party Travel Options".
- The party box leaves the Desk (party shown on Live, board, sheets); its place = Calendar box, same width as the
  other DM-screen boxes: the date (day, month, year, weekday, season) and "Open calendar". Events only in the calendar.
- Calendar dates replace "Day 12" on every screen (Timeline, Live, log, Players' view); day number on hover.
- More than one moon now. The moon box gets a "Set…" button like the clock (moon dates and cycles); also in calendar
  settings. Per moon: "From the calendar" or "Manual Lunar Dates" (full-moon date + cycle; today's "moon is full on
  day" setting becomes Manual Lunar Dates).
- Calendar settings (preset, builder, Day 1 date, seasons, weather) open from the Calendar screen.
- Builder: months numbered 1–N; festival days indented under their month: on day X (or after the last day = extra
  days outside the month and its weeks), lasting Y days, optional leap-years-only. Owner, 2026-10-22.
- Seasons: named, with start dates, shown on the calendar.
- Weather: rolled per day from the season (climate odds table), kept; DM can change any day (manual override).
- Built-in calendars: Gregorian, Harptos (Forgotten Realms), Greyhawk Common Year, Eberron Galifar, Exandria,
  Barovia, plain 12 × 30. Custom calendar builder, easy to use.
- Events repeat: yearly, monthly, weekly.
- Timeline beats show on the calendar automatically; click opens the beat.
- Live: "Today" and "Coming up"; moving the clock past an event flags it ("passed: …"), changes nothing (rule 2).
- Cards: a "Dates" box, any number of dates per card.
- What they know: the date, plus events the DM marks as known to the party (per-field knowledge, rule 9).
- New rail entry "Calendar": Day, Week, Month, Year views.
- AI never adds dates. Date recognition: underline + DM confirms in a popup; never added by itself; past wording skipped.

## Defaults picked (owner can change)
- Calendar stored per campaign (campaign settings JSON, Zod): months (name, days, festival flag), weekdays, "weeks
  restart each month" (Harptos tendays), leap rules ("every N years, +D days in month X"), year label (DR, CY, YK…),
  Day 1 = a chosen date, moons (name, cycle days, a full-moon date, colour). Switching calendars keeps every event on
  the same day (events store minutes, not dates).
- The current single moon (full-moon day, 29.5 days) becomes moon 1 of the campaign's calendar.
- Events may sit before Day 1 (history, anniversaries): event minutes may be negative; the clock may not.
- Event = title, start, optional end, all-day or time, colour, notes, repeat, links (cards, secrets, storylines),
  "party knows". Kept in History when removed (rule 3); every write through `CommandLog.run` (rule 4).
- Event colour: DM picks from a short palette; card-linked events default to the card type's colour.
- Date words ("in 10 days", "on the 15th", "by the end of the month", "has 10 days to", "next week", "at the new
  moon") are read from the current clock. Skipped: "ago", "has been … for", "since", "last", History sections.
  Any selected text also gets "Add to calendar…".

## Groups
- C0 Quick fixes: clock window for Desk Set…; "Campaign settings…" first in the gear menu; map button rename;
  party box removed from the Desk.
- C1 Calendar engine (`src/shared/calendar.ts`, pure, unit-tested): minutes ↔ date, weekdays, leap years, festival
  days, moon phases per moon, presets. `formatClock` and every "Day N" label go through it. Moon Set… window.
- C2 Events: table + IPC + undo + History; repeat expansion; Timeline beats mirrored; card "Dates" box.
- C3 Calendar screen (rail): month grid (weekday heads, moon phase icons per day, coloured events), week, day, year;
  side panel with current date ± year / month / day and time ± 1 h / 30 m; add/edit event window.
  Desk calendar summary (date, small month, next events) replaces the party box.
- C4 Calendar settings: preset picker, custom builder (month table with add/remove/reorder rows, days per month,
  weekdays, leap rule, year label, moons), live preview of one month.
- C5 Date recognition (underline + confirm popup) in card text and notes; Live Today / Coming up / passed flags;
  What they know shows the date and party-known events.

## Mockups to make (next stage)
Desk (summary panel, clock window, moon window, renamed button, gear menu); Calendar screen month / week / day /
year; event window; calendar settings + builder; card Dates box; date underline + popup; Live Today / Coming up;
What they know date line.

## Open questions
- None; awaiting owner review of the mockups.
