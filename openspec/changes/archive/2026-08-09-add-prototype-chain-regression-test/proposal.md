## Why

CON-95 hardened `lib/ui/ticket-provider.js`'s `ALIASES`/`MODULES` lookup
tables against prototype-chain access via `Object.create(null)`, so a
hand-written `ticketProvider.kind` of `constructor`/`toString`/
`hasOwnProperty`/`__proto__` misses the table and falls through to the loud
"unknown kind" throw instead of silently resolving to an inherited
`Object.prototype` member. That behavior was verified manually during CON-95's
review (both the evaluator and the final-gate skeptic live-probed it) but was
left out of CON-95's own acceptance criteria, so no automated test asserts it.
Without a regression test, a future refactor of these lookup tables (e.g.
someone "simplifying" `Object.create(null)` back to `{}`) would silently
reopen the hazard with nothing to catch it.

## What Changes

- Add a regression test to `test/ticket-provider.test.js` that probes
  `kindFor`/`moduleFor` (the two functions that index `ALIASES`/`MODULES`)
  with `kind` values of `constructor`, `toString`, `hasOwnProperty`, and
  `__proto__`, asserting each is treated as an unknown kind (falls through to
  the loud throw / is returned unresolved by `kindFor`, never resolves to an
  inherited `Object.prototype` member or function).
- No production code changes — this is test-only, closing a coverage gap
  CON-95 explicitly deferred.

## Capabilities

### New Capabilities

- `ticket-provider-kind-resolution`: documents the already-shipped
  prototype-chain-safe `kind` resolution behavior in
  `lib/ui/ticket-provider.js` (`kindFor`/`moduleFor`), so it is captured as a
  spec-level requirement with automated scenario coverage rather than only
  living as an implementation comment. No behavior changes as a result of
  this change — the spec documents existing behavior and this change adds
  the automated test that proves it.

### Modified Capabilities

(none)

## Impact

- `test/ticket-provider.test.js` — new test cases only.
- No changes to `lib/ui/ticket-provider.js` or any other production file.
