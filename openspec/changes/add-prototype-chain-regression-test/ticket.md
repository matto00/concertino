# CON-97: Add regression test for prototype-chain lookup hardening in ticket-provider.js

## Description

Follow-up from CON-95.

CON-95 hardened `ALIASES`/`MODULES` lookups in `lib/ui/ticket-provider.js` against prototype-chain access (e.g. a hand-written `kind` of `constructor`/`toString`/`hasOwnProperty` resolving to an inherited `Object.prototype` member instead of failing as an unknown kind) via `Object.create(null)`.

Both the evaluator and the final-gate skeptic independently verified this behavior manually during CON-95's review — live-probing `kind` values of `constructor`/`toString`/`hasOwnProperty`/`__proto__` and confirming each correctly throws the gate error rather than resolving to an inherited member — but no automated test asserts this. Not required by CON-95's acceptance criteria (the hazard was already unreachable in practice, since both the schema and `concertino validate` reject such a `kind` before it would ever reach this code), so it was left out of that ticket's scope.

Add a small regression test to `test/ticket-provider.test.js` covering this directly.

## Acceptance Criteria

- `test/ticket-provider.test.js` contains an automated regression test that probes `kind` values of `constructor`, `toString`, `hasOwnProperty`, and `__proto__` against the `ALIASES`/`MODULES` lookups in `lib/ui/ticket-provider.js` and asserts each correctly throws the "unknown kind" gate error rather than resolving to an inherited `Object.prototype` member.
- The test suite passes.
