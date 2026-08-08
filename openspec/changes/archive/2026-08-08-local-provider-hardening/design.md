## Context

CON-95 collects small deferred-minor fixes from the CON-44 (PR #78) review cycle:
three test-coverage/quality fixes and three hardening fixes, all confined to
`lib/ui/watch.js`, `lib/ui/tickets/local.js`, `lib/ui/ticket-provider.js`, and
their corresponding test files.

## Goals / Non-Goals

**Goals:**
- Close each of the six items enumerated in the ticket (three coverage gaps,
  three hardening items) with minimal, behavior-preserving diffs.

**Non-Goals:**
- No change to the five "Accepted as-is" items — explicitly out of scope per
  the ticket.
- No new external dependencies, no architectural change, no data model change.
- This is not a cross-cutting change: each fix is local to a single file/test
  pair. A full design document is not really warranted by the schema's own
  criteria, but is included briefly for traceability since the ticket bundles
  six independent fixes together.

## Decisions

- **`teamNotFoundMessage` guard test**: add a test in the same file/style as
  the sibling `launchPadStatus` guard's six tests, seeding a persisted
  `teamFound: false` cache row together with an unresolvable
  `ticketProvider.kind`.
- **Duplicated test removal**: delete the `launchPadStatus`-calling test from
  `test/launchpad.test.js` outright rather than relocating it — the identical
  assertion already exists in `test/ticket-provider.test.js`.
- **Magic threshold fix**: replace the hardcoded `74` with a reference to the
  real budget (`cols - 4` in `lib/ui/screens/launchpad.js`), computed in the
  test rather than duplicated as a second magic number, and add a case with a
  kind longer than ~11 characters to actually exercise truncation.
- **`parseTicket` try/catch**: move the call inside `readTickets`'s existing
  per-file `try/catch` — a structural fix, not a behavior change (no test
  changes required beyond confirming existing tests still pass).
- **Dead export removal**: remove `TICKETS_DIR` and `STATES` from
  `lib/ui/tickets/local.js`'s exports; keep `parseFrontmatter` exported as a
  testing seam.
- **Prototype-chain hardening**: convert `ALIASES` and the object backing
  `MODULES[kind]` lookups in `lib/ui/ticket-provider.js` to
  `Object.create(null)`-based objects (or add an explicit
  `Object.prototype.hasOwnProperty.call(...)` guard at each lookup site),
  whichever is the smaller diff against the existing code shape.

## Risks / Trade-offs

- [Risk] Removing `TICKETS_DIR`/`STATES` exports could break an external
  consumer outside this repo's `lib/`/`test/` tree → Mitigation: ticket
  explicitly confirms zero references in `lib/` or `test/`; this is a
  monorepo-internal module with no published package boundary.
- [Risk] Changing `ALIASES`/`MODULES` to `Object.create(null)` could break
  code relying on `Object.prototype` methods (e.g. `.toString()`,
  `.hasOwnProperty()`) being called *on* these objects elsewhere → Mitigation:
  grep all read sites before changing; prefer the `hasOwnProperty` guard
  approach if any such usage is found.
