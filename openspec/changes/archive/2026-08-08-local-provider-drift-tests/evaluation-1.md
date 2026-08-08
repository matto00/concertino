## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

Issues: none.

Verified each ticket AC against the diff of commit `0090406` (isolated via
`git diff 6160ba3..0090406`, since `main` in this clone is behind an
already-landed CON-93 commit that also appears in `main...HEAD`):

- AC1 (`stateTypesFromConfig` genuinely reused): `lib/ui/tickets/local.js:20`
  now destructures `stateTypesFromConfig` alongside `deriveEpics`/
  `OPEN_STATE_TYPES` from `../linear`; the old verbatim reimplementation
  (previously lines 245-251) and its misleading comment are deleted.
  `module.exports` (line 300) still exports `stateTypesFromConfig` under the
  same name, so the sole call site (`watch.js:390`, via `linear.js` directly)
  is unaffected. Confirmed `lib/ui/linear.js:420` is now the only definition.
- AC2 (`STATES` coupled by a test): `test/scripts/ticket-state-vocabulary.test.sh`
  added, modelled directly on `test/scripts/ticket-pattern.test.sh`'s shape
  (extract-both/byte-compare/self-verify-the-comparison-catches-drift). Wired
  into `package.json`'s `test` script next to `ticket-pattern.test.sh`. Ran
  standalone — 6/6 pass, including the two self-verifying mismatch/reorder
  fixtures.
- AC3 (`<tickets-dir>` argument reconciled with Decision 3): design doc gains
  the documented "Exception" paragraph; `set-ticket-state.sh`'s header
  comment gains a pointer to the same exception; a new assertion in
  `test/scripts/local-provider-render.test.sh` pins the rendered orchestrator
  prose to the literal `set-ticket-state.sh tickets "$TICKET_ID"` (verified
  against `lib/cli/render.js:143`, unchanged and already literal). This is
  the documented-exception branch of the AC's either/or, with reasoning
  given, matching the AC's explicit acceptance of that path.
- AC4 (README rows): `core/scripts/README.md`'s Scripts table gains exactly
  the three named rows (`set-ticket-state.sh`, `check-merge-readiness.sh`,
  `next-report-number.sh`); each `Args` column text verified against the
  named script's own usage comment — matches exactly.

No AC was partially addressed or silently reinterpreted. All 13 `tasks.md`
items are checked and match what's actually in the diff. `openspec validate
local-provider-drift-tests --strict` passes cleanly. No scope creep — `git
show --stat 0090406` touches only the files `files-modified.md` names plus
this change's own openspec artifacts. No regressions apparent to
`local-ticket-state-durability` or `launchpad-local-parity` (proposal
correctly scopes these as unaffected, and the full test suite, including
`set-ticket-state.test.sh`'s ~54 cases, still passes). No API/schema surface
changes.

### Phase 2: Code Review — PASS

Issues: none.

Gates (run fresh in `WORKTREE_PATH`, no `CLEAN_WORKTREE` requested at this
speed):

- `npm test` — full run: **1681/1681** `node --test` cases pass, and every
  bash suite in the chain reports `N passed, 0 failed` (30 suites total,
  including the two new/changed ones: `ticket-state-vocabulary.test.sh`
  6/6, `local-provider-render.test.sh` 11/11). Exit code 0.
  - Note: the first attempt at this run hung for ~16 minutes inside
    `test/scripts/agent-merge-permission-render.test.sh`, on `lib/cli/doctor.js`'s
    unguarded `npx playwright --version` call — this machine had never run
    `npx playwright` before, so npm's non-interactive install-confirmation
    prompt blocked on stdin forever. This is pre-existing behavior on code
    `doctor.js`, which this change does not touch, and reproduces the same
    way outside this diff (confirmed `npx -y playwright --version` succeeds
    and populates npm's local package cache). Once cached, a clean re-run of
    the full `npm test` completed normally in well under two minutes with no
    intervention needed. Not attributed to this change; flagged here for
    visibility only, not as a change request.

No canonical code-quality standard is configured for this project (per the
evaluator's brief — "(none configured)").

- DRY: `stateTypesFromConfig` is now single-sourced; no new duplication
  introduced. The new drift test correctly avoids requiring a JS-in-shell
  bridge (Decision 2's stated rationale) by shelling `node -e` for the JS
  side and `grep`/`sed` for the shell side — consistent with how
  `ticket-pattern.test.sh` already does per-file extraction.
- Readable: new test file's `ok`/`bad` helpers, comments, and self-verifying
  fixtures follow the existing `test/scripts/` house style closely; no magic
  values (`EXPECTED` is named and commented as "Linear's own state.type
  order").
- Modular / no over-engineering: change is minimal and surgical — one-line
  destructure extension, one new focused test file, doc/comment additions,
  three README rows. No new abstraction introduced beyond what the design
  called for.
- Type safety / security: not applicable to this diff's surface (no new
  input-handling code; the new test's `node -e` and `grep`/`sed` extraction
  operate only on this repo's own trusted source files, not external input).
- Error handling: unchanged; `set-ticket-state.sh`'s only change is an
  additive comment block, no behavior touched (confirmed via diff — no lines
  outside the comment block changed).
- Tests meaningful: the new drift test includes two self-verifying fixture
  cases (a removed value, a reordered value) proving the comparison logic
  itself would catch real drift, not just asserting today's state — this
  is exactly the "would catch a real regression" bar. The new
  `local-provider-render.test.sh` assertion pins the one production call
  site's literal argument, which would fail if a future edit ever
  parameterized it.
- No dead code: no leftover TODO/FIXME/commented-out code found in the diff;
  the deleted `stateTypesFromConfig` reimplementation is fully removed, not
  left commented out.
- Behavior-preserving where expected: `set-ticket-state.sh` has zero
  behavioral diff (comment-only); `local.js`'s `stateTypesFromConfig` change
  is a pure re-source with an identical exported name/signature/behavior
  (verified both implementations were already byte-identical per the
  skeptic's design-gate report, and the new export is literally the same
  function object linear.js already defined).

### Phase 3: UI Review — N/A

No UI review configured for this project (per evaluator's brief); dev-server
steps skipped as instructed.

### Overall: PASS

### Non-blocking Suggestions

- `lib/ui/tickets/local.js:14-16`'s top-of-file comment ("deriveEpics and
  OPEN_STATE_TYPES are reused from it so the two providers can never
  disagree...") still names only the two pre-existing reused symbols, not
  the newly-added `stateTypesFromConfig`. The skeptic's design-gate report
  already flagged this as optional; folding `stateTypesFromConfig` into that
  list would help a reader who never scrolls down to the `require` line, but
  it is not required by any AC and was correctly treated as out of scope by
  the executor.
- Consider whether `lib/cli/doctor.js`'s `npx playwright --version` call
  (unrelated to this change) should pass `-y`/`CI=1` or otherwise avoid
  blocking on a first-run install prompt in non-interactive environments —
  worth a follow-up ticket, not a blocker here.
