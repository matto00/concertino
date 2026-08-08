# CON-94: The local provider duplicates constants and logic with no drift test

## Description

Found by the whole-branch review of the CON-44 first slice (PR #78, finding M-1 and friends).

The slice deliberately imports `deriveEpics` and `OPEN_STATE_TYPES` from `lib/ui/linear.js` so the two providers cannot disagree. Three things escaped that discipline:

### 1. `stateTypesFromConfig` is reimplemented, and its comment says otherwise

`lib/ui/tickets/local.js` carries a verbatim copy of `lib/ui/linear.js:421-426`, under a comment claiming "this is linear.js's logic reused rather than reimplemented". It is not reused. Two copies, no drift test — and the comment actively misleads the next reader.

### 2. `STATES` exists twice

`lib/ui/tickets/local.js` defines the five-state vocabulary as a JS array; `core/scripts/set-ticket-state.sh` defines it again as a space-separated shell string. They must agree or the script will accept a state the store treats as malformed. No test couples them.

Precedent for the fix already exists in the repo: `test/scripts/ticket-pattern.test.sh` keeps the canonical ticket-id regex byte-identical across five files, and the first slice extended it to cover `set-ticket-state.sh`'s copy. The same shape would work here.

### 3. `set-ticket-state.sh` takes the tickets directory as an argument

Design Decision 3 said the path is "fixed, not configurable"; Decision 6 specified `set-ticket-state.sh <TICKET_ID> <state>`. It shipped as `<tickets-dir> <TICKET_ID> <state>` — done for testability against a temp directory, and the rendered orchestrator prose passes the literal `tickets`, so it works. But it reintroduces the configurable surface Decision 3 excluded and makes correctness depend on the orchestrator's cwd.

## Also worth folding in

`core/scripts/README.md`'s Contract and Scripts table does not list `set-ticket-state.sh`. That README ships into consuming projects. (`check-merge-readiness.sh` and `next-report-number.sh` are missing too — a pre-existing habit, not a new one.)

## Acceptance Criteria

- `lib/ui/tickets/local.js`'s `stateTypesFromConfig` genuinely reuses `lib/ui/linear.js`'s logic (imported, not copied) — or, if reuse is truly impossible, the misleading comment is corrected and a drift test couples the two implementations byte-for-byte / behaviorally.
- The `STATES` vocabulary in `lib/ui/tickets/local.js` and `core/scripts/set-ticket-state.sh` is coupled by a test (following the `test/scripts/ticket-pattern.test.sh` precedent) so the two cannot silently diverge.
- `set-ticket-state.sh`'s tickets-directory argument is reconciled with Design Decision 3 ("fixed, not configurable") — either the argument is removed and the path is fixed internally, or Decision 3 is explicitly and deliberately revised in the design doc with reasoning for why the configurable surface is being kept (e.g. testability), not silently left inconsistent.
- `core/scripts/README.md`'s Contract and Scripts table is updated to list `set-ticket-state.sh`, `check-merge-readiness.sh`, and `next-report-number.sh`.
