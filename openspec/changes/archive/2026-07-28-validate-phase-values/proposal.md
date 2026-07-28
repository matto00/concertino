## Why

The `phase` vocabulary (`Setup | Planning | Execution | Evaluation | Delivery | Cleanup`) is
duplicated by prose across three places — `core/workflow-state.template.md`, the
`emit-event.sh phase.enter phase=<Phase>` instruction in `core/roles/orchestrator.md`, and the
`PHASE_ORDER` array in `lib/ui/screens/fleet.js` — with nothing enforcing agreement. The
orchestrator doc's own headings (`## Phase 2: Execution`) give a model a plausible reason to
emit `phase=Phase 2`; `PHASE_ORDER.indexOf('Phase 2')` then returns `-1`, silently zeroing the
progress bar while `telemetry: full` still reports the run as fully understood. Absent data
rendering as healthy data is exactly what the tier system exists to prevent.

## What Changes

- Move the canonical phase list into `lib/ui/reducer.js` (the pure fold that already owns the
  `TIER2_KINDS`/`TIER3_KINDS` telemetry vocabularies) as `PHASE_ORDER`, and have `fleet.js` /
  `drilldown.js` import it rather than each keeping (or borrowing) their own copy.
- `reducer.js` validates `phase.enter`'s `ev.phase` against `PHASE_ORDER`: a recognised value
  updates `run.phase` as before; an unrecognised value leaves `run.phase` untouched and counts
  toward `run.malformed` (the existing fleet-wide "N malformed events" indicator), so an
  unrecognised phase is visible rather than silently swallowed.
- `fleet.js`'s `phaseFraction`/`statusLine` already show "phase unknown" for `run.phase == null`
  with 0 progress — no screen change needed once the reducer stops writing invalid values
  through; this proposal keeps that guarantee explicit with a regression test.
- Cross-reference the phase enum at its three prose sites: `workflow-state.template.md`'s
  comment points at `lib/ui/reducer.js`'s `PHASE_ORDER` as the enforced source of truth, and
  `reducer.js`'s `PHASE_ORDER` comment points back at the template. `core/roles/orchestrator.md`
  states the exact permitted values inline in the `phase.enter` instruction instead of the
  placeholder `<Phase>`.
- Add a reducer test (and a fleet-render test) covering an unrecognised `phase.enter` value.

## Capabilities

### New Capabilities
- `phase-telemetry`: Defines the `phase.enter` event contract — the canonical `PHASE_ORDER`
  enum, how the reducer validates an incoming `phase` value, and the guarantee that an
  unrecognised value is surfaced as a malformed event rather than silently producing a
  zero-progress bar under a `telemetry: full` run.

### Modified Capabilities
(none — `gate-telemetry` is unaffected)

## Impact

- `lib/ui/reducer.js` — add/own `PHASE_ORDER`, validate `phase.enter`.
- `lib/ui/screens/fleet.js` — import `PHASE_ORDER` from the reducer instead of defining it.
- `lib/ui/screens/drilldown.js` — same import change (currently imports it from `fleet.js`).
- `core/workflow-state.template.md` — cross-reference comment.
- `core/roles/orchestrator.md` — spell out the permitted `phase=` values inline.
- `test/reducer.test.js`, `test/fleet.test.js` — new coverage for an unrecognised phase value.
- No API/behavioral change for any already-valid run; existing `phase.enter` events with valid
  values behave identically.
