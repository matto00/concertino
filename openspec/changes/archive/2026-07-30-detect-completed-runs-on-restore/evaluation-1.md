## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- Ticket's proposed change (cross-check pending ids' run status against the
  startup fleet snapshot's `endedAt`/`writtenAt`, drop+report ids that
  finished during downtime rather than re-offering them identically to
  never-started ids) is implemented exactly as specced, with the notice
  surfaced independently of `queueState` per design.md Decision 4.
- All tasks.md items (1.1–5.2) marked `[x]` and verified to match the
  actual diff — no task marked done without corresponding code (checked
  `lib/ui/queue.js`, `lib/ui/watch.js`, `lib/ui/screens/fleet.js` diffs
  line-by-line against tasks 1.1–3.2).
- Task 4.7's "N/A" claim (test/watch.test.js does not cover
  `createRestoredQueue`/`startupRuns`) verified independently:
  `grep -n "createRestoredQueue\|startupRuns" test/watch.test.js` returns no
  matches, confirming the claim rather than trusting it.
- Design Decision 1 (reconcile exactly once) is honored: `watch.js` calls
  `queue.reconcileRestored` once and passes the result into
  `createRestoredQueue(record, runs, reconciled)`, which uses the
  pre-computed result instead of re-deriving it — `pending`/`inFlight` and
  `completedDuringDowntime` cannot diverge.
- Design Decision 2/3/4 (not nested under `restoredFrom`; `writtenAt`
  strict-greater-than comparison; independent sticky `restoreNotice`
  variable) all implemented verbatim, including the "no `endedAt`" edge
  case (dead window via `deriveStatus`'s `run.window && !run.window.alive`
  path, confirmed against `lib/ui/reducer.js:170` that this path never sets
  `endedAt`) staying in `pending` rather than guessing.
- No scope creep: `git diff main...HEAD --name-only` outside
  `openspec/changes/...` touches only `lib/ui/queue.js`,
  `lib/ui/screens/fleet.js`, `lib/ui/watch.js`, `test/fleet.test.js`,
  `test/queue.test.js` — exactly the Impact section's file list.
- No regressions: existing "reconciliation leaving both pending and
  inFlight empty restores nothing" test (queue.test.js:361) is present and
  unmodified in the diff; `inFlight` reconciliation logic is untouched
  (Non-Goal honored).
- Spec delta (`specs/fleet-queue-visibility/spec.md`) matches implemented
  behavior; `openspec validate detect-completed-runs-on-restore` passes.

### Phase 2: Code Review — PASS
Issues: none.

Gates (freshly re-run in `WORKTREE_PATH`, not trusted from executor
report): `npm test` — exit code 0, all suites reporting `0 failed`
including the new CON-37 tests (`queue.test.js`: "a pending id terminal
with endedAt after writtenAt is dropped from pending and reported as
completed during downtime", etc.; `fleet.test.js`: the five new
`restoreNotice` rendering tests). No lint script is configured in this
project (`package.json` has no `lint` entry, no `.eslintrc`/`eslint.config`
found) — `npm test` is the only gate, per the task's "Always: npm test"
instruction.

- **DRY**: no duplication — the single-reconciliation-pass refactor
  (`createRestoredQueue`'s new optional `reconciled` third arg) actively
  removes a would-be duplication rather than introducing one.
- **Readable**: clear naming (`completedDuringDowntime`, `restoreNotice`,
  `finishedDuringDowntime`), no magic values — the `writtenAt` comparison
  and `>` (not `>=`) boundary choice are both explained in comments/design.
- **Modular**: `reconcileRestored` stays a pure, filesystem-free function
  per its existing contract; the new notice lives in its own variable
  parallel to `queueNotice` rather than overloading an existing one.
- **Type safety**: N/A (plain JS, no type-escape hatches introduced).
- **Security**: N/A — no new external input boundary; ids/timestamps come
  from the same trusted on-disk snapshot the rest of the module already
  reads.
- **Error handling**: the "terminal status but no `endedAt`" case is
  handled explicitly (left in `pending`, not guessed at) rather than
  silently mishandled; `record` null/missing fields guarded (`writtenAt`
  defaults to `null`, comparison short-circuits via `writtenAt != null`).
- **Tests meaningful**: new tests cover the dropped case, the
  at-or-before-writtenAt survive case, the no-run-object survive case, the
  terminal-no-endedAt survive case, the `createRestoredQueue` null-return
  invariant under the new code path, and UI rendering independent of
  `queueState` (null, present-without-notice, both-together, truncation) —
  each would catch a real regression in the corresponding branch.
- **No dead code**: no unused imports, no leftover TODO/FIXME introduced.
- **No over-engineering**: no new abstraction beyond what the design calls
  for; the optional `reconciled` parameter is the minimal shape needed to
  satisfy the single-pass constraint.
- **Behavior-preserving where expected**: `inFlight` reconciliation
  literally unchanged (line-for-line identical in the diff); pre-existing
  `pending` filter behavior for the "already live" case unchanged (still
  the first check, `continue`s before the new terminal check).

### Phase 3: UI Review — N/A
Per task instructions, this project has no UI review configured for this
change; Phase 3 dev-server steps skipped as directed.

### Overall: PASS

### Change Requests
(none — Overall is PASS)

### Non-blocking Suggestions
- None beyond what's already well-documented in the code's own comments.
