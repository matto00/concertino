## Why

The CON-44 local-ticket-provider slice deliberately imported `deriveEpics` and
`OPEN_STATE_TYPES` from `lib/ui/linear.js` so the two providers could never
disagree. Three places escaped that discipline (found by CON-44's own
whole-branch review, PR #78 finding M-1 and friends): a genuinely-duplicated
function whose comment claims it is reused, a state vocabulary duplicated
across a JS file and a shell script with nothing coupling them, and a script
argument that quietly contradicts a documented design decision. Left alone,
any one of these can drift silently and the local provider disagrees with
itself or with Linear about what a ticket's state means.

## What Changes

- `lib/ui/tickets/local.js`'s `stateTypesFromConfig` stops being a verbatim
  copy of `lib/ui/linear.js`'s implementation and becomes a genuine
  re-export/forward of it (`linear.js` already exports the function — nothing
  there needs to change). The misleading "reused rather than reimplemented"
  comment becomes true.
- A new drift test couples `lib/ui/tickets/local.js`'s `STATES` array and
  `core/scripts/set-ticket-state.sh`'s `STATES` shell string, following the
  precedent `test/scripts/ticket-pattern.test.sh` already set for the
  canonical ticket-id pattern: extract both, byte-compare (after normalising
  the JS array literal and the space-separated shell string to the same
  comparable form), fail loudly on any divergence.
- Design Decision 3 in
  `docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md`
  ("the path is fixed, not configurable") is amended to explicitly document
  the one deliberate exception: `set-ticket-state.sh` accepts a
  `<tickets-dir>` argument purely so its own shell test suite
  (`test/scripts/set-ticket-state.test.sh`) can exercise it against a
  `mktemp -d` scratch directory in isolation, never to let a *caller* choose
  a different tickets directory in production. A new regression test asserts
  the only production call site (`lib/cli/render.js`'s rendered orchestrator
  prose) always passes the literal string `tickets`, so the configurable
  surface Decision 3 excludes can never actually be exercised outside tests.
- `core/scripts/README.md`'s Scripts table gains rows for
  `set-ticket-state.sh`, `check-merge-readiness.sh`, and
  `next-report-number.sh` — three scripts that already ship but were never
  added to the table that documents the Contract every script here follows.

## Capabilities

### New Capabilities

- `local-provider-drift-guard`: couples the local ticket provider's
  duplicated constants/logic (state-type filtering, the five-state
  vocabulary) to their Linear-side or shell-side counterparts with tests
  that fail on divergence, and pins `set-ticket-state.sh`'s tickets-directory
  argument to a documented, test-only exception rather than a silently
  reintroduced config surface.

### Modified Capabilities

(none — no existing capability's requirements change; `local-ticket-state-durability`
and `launchpad-local-parity` are unaffected, since neither the commit/push
behavior nor the state-label mapping changes)

## Impact

- `lib/ui/tickets/local.js` — `stateTypesFromConfig` becomes a forward to
  `lib/ui/linear.js`'s export; the misleading comment is corrected.
- `core/scripts/set-ticket-state.sh` — no behavioral change; only its header
  comment/usage note gains a pointer to the now-documented test-only
  exception.
- `docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md` —
  Decision 3 amended with the documented exception.
- `core/scripts/README.md` — Scripts table gains three rows.
- New test files: a `STATES` drift test (following
  `test/scripts/ticket-pattern.test.sh`'s shape) and a regression test
  asserting `render.js`'s rendered orchestrator prose always passes the
  literal `tickets` argument.
- No runtime behavior changes for an end user — this is entirely
  test-coupling and documentation hygiene, matching the ticket's own framing
  ("no drift test") and its Low priority.
