## Why

The drill-down (`lib/ui/screens/drilldown.js`) shows TICKET/TIMELINE/GATES/EVIDENCE for a run, but
nothing shows what an agent has actually changed in its worktree while a run is in flight. Today
the only options are `tmux attach` or waiting for the eventual PR — a real observability gap given
how EVIDENCE-driven the rest of the drill-down already is.

## What Changes

- Add a fifth drill-down panel, **CHANGES**, alongside TICKET/TIMELINE/GATES/EVIDENCE. `1`-`5` jump
  directly to a panel; `Tab` cycles through all five (was four).
- CHANGES shows `git diff --stat` against the run's worktree (`run.worktree`, already tracked by
  `reducer.js`'s `run.start` handling), recomputed on **every poll tick** (same ~1s cadence as the
  rest of the dashboard) while the drill-down is open and CHANGES is the ticket currently being
  viewed — not for every run in the fleet on every tick, and not only on focus/keypress (Planning
  ESCALATION, answered: `every-poll`).
- A selected file in the stat list can be expanded into its full unified diff (`git diff -- <file>`)
  via the existing `docview` reader — the same reuse `evidence-reader` already established for
  EVIDENCE entries, not a second doc-rendering implementation.
- Once the run's worktree is gone (`cleanup.sh --phase4` already removed it, or a fresh dashboard
  start observes a run whose worktree path no longer resolves), CHANGES degrades honestly: it shows
  an explicit "worktree removed" message, not a stale diff and not a silently empty panel. No
  durable diff snapshot is persisted (Planning ESCALATION, answered:
  `worktree-removed-message` — this differs from EVIDENCE's `ticket.md` persistence convention,
  deliberately: the diff is a live, in-flight-only view).
- A binary or very large diff is **truncated**, with an explicit "truncated" marker, rather than
  refused outright (Planning ESCALATION, answered: `truncate`).
- Documented in `docs/dashboard.md`'s drill-down section; the new keys are advertised in the
  drill-down's own footer only when they currently do something (mirrors `sections.js`'s existing
  "only advertise a key that currently does something" discipline, applied here to the drill-down's
  own footer rather than the fleet view's).

## Capabilities

### New Capabilities
- `drilldown-changes-panel`: the CHANGES panel itself — `git diff --stat` polling, file selection,
  full-diff expansion via the shared doc reader, and the worktree-gone/binary/large-diff degradation
  behaviors described above.

### Modified Capabilities
- (none — `drilldown-ticket-context` and `evidence-reader` describe the other four panels' existing
  requirements and are unaffected; this change only adds a new panel alongside them and widens the
  panel-count/footer-hint invariants those specs already state as "four panels" — see design.md for
  how the new panel avoids contradicting rather than modifying those existing requirements)

## Impact

- `lib/ui/screens/drilldown.js` — `DRILL_PANELS`, panel layout math, footer hints, `handleKey`.
- `lib/ui/controllers/drilldown.js` — a new action to expand a selected file into `docview`.
- `lib/ui/watch.js` — a new per-poll, gated (only while drill-down is open) `git diff --stat` /
  `git diff -- <file>` shell-out, following the exact pattern `drillTicketText`'s per-poll
  `ticketText.resolve()` call already establishes (never inside a pure render path).
- `lib/ui/icons.js` — one new icon glyph for the CHANGES panel.
- `docs/dashboard.md` — drill-down section and key table.
- No backend/API changes; no new dependencies (uses the `git` binary already required by every
  worktree this dashboard manages).
