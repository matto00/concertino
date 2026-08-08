## 1. `cmdWatch` normalisation

- [x] 1.1 In `lib/cli/watch.js`, import `withDefaults` from `../config`.
- [x] 1.2 Restructure `cmdWatch`'s config loading per design.md Decision 1: on a successful `JSON.parse`, attempt `withDefaults` on a deep clone of the parsed object; on a `withDefaults` throw, fall back to the raw parsed object; on a missing file or `JSON.parse` failure, keep `config = {}` exactly as today.
- [x] 1.3 Add a comment at the `cmdWatch` call site documenting the fallback path (design.md Decision 1's alternatives-considered reasoning), satisfying this ticket's first acceptance criterion for the fallback branch.

## 2. Downstream comment updates (no behavior change)

- [x] 2.1 Update `lib/ui/watch.js`'s `ensureLaunchPad` comment (currently: "config here is whatever lib/cli/watch.js's cmdWatch parsed straight off disk — it never runs through lib/config.js's loadConfig/withDefaults") to reflect that normalisation is now the common path, with the fallback as the documented exception.
- [x] 2.2 Update `lib/ui/watch.js`'s `openLaunchPad` comment (the "cmdWatch hands this config straight off disk" note near the `kindFor(config) === 'local'` check) the same way.
- [x] 2.3 Update `lib/ui/ticket-provider.js`'s comment above `ALIASES`/the "manual" test description if it asserts `cmdWatch` never calls `withDefaults` as flat fact.
- [x] 2.4 Update the corresponding comments in `test/watch.test.js` (around the `LAUNCHPAD_CONFIG`/"manual" test block) and `test/ticket-provider.test.js` (the "raw, un-normalised manual config" test) to match — the tests themselves stay as-is (they exercise `watch()`/`ticket-provider.js` directly with raw configs, which remains a valid and necessary scenario regardless of `cmdWatch`'s own behavior).

## 3. Tests

- [x] 3.1 Add a test (in `test/watch.test.js` or a new `test/cli-watch.test.js`, matching this repo's existing test-placement convention for `lib/cli/*` behavior) covering: a config file with `ticketProvider.kind: "manual"` and the `project` object `withDefaults` requires results in `watch()` receiving `ticketProvider.kind === "local"` and other `withDefaults` defaults applied — spec.md's first requirement.
- [x] 3.2 Add tests covering spec.md's second requirement's three scenarios: no config file, malformed JSON, and a well-formed-JSON config missing `project`/`ticketProvider` — in each case `concertino watch` must still start (not throw), landing on `config: {}` for the first two and the raw parsed object for the third.
- [x] 3.3 Run the full test suite and confirm no existing test (especially `test/watch.test.js`'s and `test/ticket-provider.test.js`'s existing "manual"/typo'd-kind/`"github"`-kind tests, which call `watch()`/`ticket-provider.js` directly rather than through `cmdWatch`) regresses.

## 4. Verification

- [x] 4.1 Run the project's standard verification gates (lint/tests, per this repo's own contributing docs) and confirm they pass.
- [x] 4.2 Manually sanity-check (or via test) that `concertino watch` still starts cleanly against a project with no `concertino.config.json` at all.
