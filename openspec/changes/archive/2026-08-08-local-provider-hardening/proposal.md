## Why

CON-44's first slice (PR #78) landed with several deferred minors flagged by reviewers: an untested error-handling guard, a duplicated/misplaced test, a test with a wrongly-derived magic number, a structural inconsistency in error handling, dead exports, and two prototype-chain lookup hazards. None blocked the original merge, but leaving them unaddressed erodes test-suite trustworthiness (a wrong "length of the message this replaced" comment actively misleads future readers) and leaves a latent hardening gap (prototype-chain lookups) that costs almost nothing to close now.

## What Changes

- Add a test seeding a persisted `teamFound: false` cache row with an unresolvable `ticketProvider.kind`, covering the untested `teamNotFoundMessage` guard in `lib/ui/watch.js`.
- Remove the duplicated `launchPadStatus` test from `test/launchpad.test.js` (it exercises `ticket-provider.js`, not `lib/ui/screens/launchpad.js`, and duplicates existing coverage in `test/ticket-provider.test.js`).
- Fix the gate-message length test's magic threshold: reference the real budget (`cols - 4` in `lib/ui/screens/launchpad.js`) instead of the wrongly-derived hardcoded `74`, and add a case exercising a kind over ~11 characters to actually catch truncation regressions. Correct the misleading code comment.
- Move the `parseTicket` call inside `readTickets`'s existing per-file `try/catch` in `lib/ui/tickets/local.js` (no behavior change — closes a structural gap, not a live bug).
- Remove dead exports `TICKETS_DIR` and `STATES` from `lib/ui/tickets/local.js` (zero references anywhere in `lib/` or `test/`). Retain `parseFrontmatter` as a testing seam.
- Harden `ALIASES[raw] || raw` and `MODULES[kind]` lookups in `lib/ui/ticket-provider.js` against prototype-chain lookups (e.g. `constructor`, `toString`, `hasOwnProperty`) using `Object.create(null)` or an explicit `hasOwnProperty` guard.
- No change to the five "Accepted as-is" items recorded in the ticket — explicitly out of scope.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none — these are test-coverage additions, an internal test-file/test-quality fix, and defensive hardening with no change to documented, user-observable spec requirements. The prototype-chain lookup hardening closes a hazard that was already unreachable in practice, per the ticket's own analysis: both the schema and `concertino validate` already reject such a `kind`, so no spec-level behavior changes as a result.)

## Impact

- `lib/ui/watch.js` — no code change; new test coverage only.
- `test/watch.test.js` (or equivalent) — new test for the `teamNotFoundMessage` guard.
- `test/launchpad.test.js` — remove duplicated test.
- `test/ticket-provider.test.js` — retains existing coverage (unchanged).
- The gate-message length test file (`test/screens/launchpad.test.js` or equivalent, wherever the length-74 test lives) — corrected threshold/derivation, added long-kind case.
- `lib/ui/tickets/local.js` — `parseTicket` moved inside existing `try/catch`; `TICKETS_DIR`/`STATES` exports removed.
- `lib/ui/ticket-provider.js` — `ALIASES`/`MODULES` lookups hardened against prototype-chain access.
- No dependency, API, or schema changes. No user-facing behavior change.
