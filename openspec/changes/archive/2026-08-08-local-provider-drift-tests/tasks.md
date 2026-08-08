## 1. `stateTypesFromConfig` becomes a genuine re-export

- [x] 1.1 In `lib/ui/tickets/local.js`, add `stateTypesFromConfig` to the
      existing `require('../linear')` destructure (alongside `deriveEpics`,
      `OPEN_STATE_TYPES`).
- [x] 1.2 Delete the local reimplementation (the function body and its
      "reused rather than reimplemented" comment) — the import now supplies
      the name that `module.exports` at the bottom of the file already
      exports.
- [x] 1.3 Run `test/tickets-local.test.js` and `test/watch.test.js` to
      confirm no call site (`watch.js:334`) regresses.

## 2. Drift test coupling `STATES`

- [x] 2.1 Create `test/scripts/ticket-state-vocabulary.test.sh`: extract
      `lib/ui/tickets/local.js`'s `STATES` via a `node -e` one-liner,
      extract `core/scripts/set-ticket-state.sh`'s `STATES="..."` line via
      shell text processing, and byte-compare the two as ordered
      space-separated lists.
- [x] 2.2 Add a case proving the test actually catches drift (e.g. assert
      the comparison logic fails on a deliberately mismatched fixture pair,
      inline in the test file — mirroring how other suites in
      `test/scripts/` self-verify their own comparison logic).
- [x] 2.3 Append the new suite to `package.json`'s `test` script, next to
      `ticket-pattern.test.sh`.

## 3. Reconcile `set-ticket-state.sh`'s tickets-dir argument with Decision 3

- [x] 3.1 Add the "Exception" paragraph to Decision 3 in
      `docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md`
      (see design.md Decision 3 for the exact text).
- [x] 3.2 Add a one-line pointer to the same exception in
      `core/scripts/set-ticket-state.sh`'s header comment, near its existing
      `Usage:` line.
- [x] 3.3 Add an assertion to `test/scripts/local-provider-render.test.sh`
      pinning the rendered orchestrator prose's `set-ticket-state.sh`
      invocation to the literal `tickets` argument.

## 4. `core/scripts/README.md` documentation

- [x] 4.1 Add rows for `set-ticket-state.sh`, `check-merge-readiness.sh`,
      and `next-report-number.sh` to the Scripts table (see design.md
      Decision 4 for the exact row text).

## 5. New capability spec

- [x] 5.1 Add `specs/local-provider-drift-guard/spec.md` (ADDED
      Requirements) capturing the three requirements this change
      introduces — already drafted; verify it validates cleanly with
      `openspec validate`.

## 6. Verification

- [x] 6.1 Run the full test suite (`npm test` or equivalent) and confirm all
      new and existing suites pass, including the new
      `ticket-state-vocabulary.test.sh` and the updated
      `local-provider-render.test.sh`.
- [x] 6.2 `openspec validate --change local-provider-drift-tests` clean.
