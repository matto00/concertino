## Why

There's no way to see why one run took 3x longer than a similar one, or how
two runs' gate results/verdicts diverged, without opening each drill-down
separately and holding the comparison in your head. CON-113 (run archive)
already lets a user find any two DONE runs regardless of the fleet view's
5-row DONE cap; this change adds the missing next step: comparing two of
them side by side.

## What Changes

- Add a capped, ticket-keyed selection mechanism (max 2) to the run-archive
  screen's list, and a new one to fleet's DONE section, so a user can mark
  exactly two DONE runs for comparison.
- Once two runs are marked, a new key opens a new `compare` screen rendering
  both runs' TIMELINE and GATES side by side, plus total duration and the
  delta between them.
- The compare screen uses its own narrower TIMELINE/GATES rendering (not
  the drill-down's panels verbatim) so two columns fit on a normal-width
  terminal — this is a deliberate design decision, self-approved during
  Planning after the ticket's own escalation went unanswered (see
  workflow-state.md / the run's escalation log): a new narrower rendering,
  not a truncated reuse of the drill-down panels.
- `esc` from the compare screen returns to wherever it was opened from
  (archive or fleet), not unconditionally to fleet — the compare screen
  tracks its own origin, following the `ticketviewReturnMode` precedent
  rather than the drill-down's unconditional generic `back`.
- Document the new screen, its keybindings, and the selection mechanism in
  `docs/dashboard.md`.

## Capabilities

### New Capabilities
- `run-comparison`: selecting exactly two DONE runs (from the run-archive
  screen or fleet's DONE section) and viewing them side by side — narrower
  TIMELINE/GATES panels, total duration and delta, origin-aware `esc`.

### Modified Capabilities
- `run-archive`: the archive screen's list zone gains a "mark for compare"
  affordance (capped at 2) and a trigger to open the compare screen once two
  are marked, alongside its existing single-row `open-drilldown` behavior.

## Impact

- `lib/ui/screens/compare.js`, `lib/ui/controllers/compare.js` (new)
- `lib/ui/router.js` (register `compare` screen)
- `lib/ui/app-state.js` (new `compare*` / selection state fields, added to
  both `initialState()` and `currentState()`)
- `lib/ui/screens/archive.js`, `lib/ui/controllers/archive.js` (selection
  affordance + open-compare trigger)
- `lib/ui/screens/fleet/keys.js`, `lib/ui/screens/fleet/rows.js`,
  `lib/ui/controllers/fleet.js` (DONE-section selection affordance)
- `docs/dashboard.md` (new "Side-by-side run comparison" section)
- New tests: `test/compare.test.js`, `test/controllers-compare.test.js`;
  touches to `test/archive.test.js`, `test/controllers-archive.test.js`,
  `test/fleet.test.js`, `test/controllers-fleet.test.js`
- No backend/event-log changes — reads the same `state.runs` every other
  screen already reads; no new event kinds.
