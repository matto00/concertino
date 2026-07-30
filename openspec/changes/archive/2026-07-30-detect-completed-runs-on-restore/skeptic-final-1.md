## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket/AC trace**: Read CON-37's Linear ticket and `ticket.md`. The core
  requirement — cross-check each persisted pending id against its run's
  terminal status/`endedAt` at restore time, drop it from `pending` and
  report it separately rather than re-offering it identically to a
  never-started ticket — is implemented in `lib/ui/queue.js`'s
  `reconcileRestored` (git diff `main...HEAD -- lib/ui/queue.js`): the new
  loop computes `finishedDuringDowntime = terminal && typeof r.endedAt ===
  'number' && writtenAt != null && r.endedAt > writtenAt` and diverts
  matching ids into `completedDuringDowntime` instead of `pending`. Traced
  through to `lib/ui/watch.js` (single `queue.reconcileRestored` call,
  result passed into `createRestoredQueue(record, runs, reconciled)`, and
  `restoreNotice` set independently of whether `createRestoredQueue` returns
  non-null) and `lib/ui/screens/fleet.js` (`buildHeadTail` renders
  `restoreNotice` gated only on the notice itself, not on `queueState`).

- **Design decisions honored**: Read `design.md` in full and compared each
  Decision (1-4) against the actual diff:
  - Decision 1 (single reconciliation pass): confirmed — `watch.js` calls
    `reconcileRestored` once and threads the result into
    `createRestoredQueue`'s new optional third arg; no second independent
    pass exists.
  - Decision 2/Decision 2's revision (not nested under `restoredFrom`):
    confirmed — `createRestoredQueue`'s return value is untouched;
    `completedDuringDowntime` only ever flows through the separate
    `reconciled` object.
  - Decision 3 (`> writtenAt`, not `status` alone; no-`endedAt` case left in
    `pending`): confirmed in code and independently verified against
    `lib/ui/reducer.js:168-175` (`deriveStatus`) — the `run.window &&
    !run.window.alive` path returns `'failed'` without ever touching
    `endedAt` (only the `run.end` event handler at reducer.js:95 sets it),
    so a dead-window terminal run genuinely has no `endedAt` and correctly
    stays in `pending` via the `typeof r.endedAt === 'number'` guard.
  - Decision 4 (independent sticky `restoreNotice`, not gated on
    `queueState`): confirmed in both `watch.js` (set unconditionally when
    `reconciled.completedDuringDowntime.length`, regardless of `restored`
    being null) and `fleet.js` (`if (restoreNotice) { ... }`, no `queueState`
    check).

- **Spec delta**: read `specs/fleet-queue-visibility/spec.md` in full — the
  new/modified requirements and their scenarios match the implemented
  behavior line for line (terminal-during-downtime drop+report, stale
  terminal run predating `writtenAt` left alone, notice independent of
  `queueState`). Ran `npx openspec validate detect-completed-runs-on-restore`
  myself: `Change 'detect-completed-runs-on-restore' is valid`.

- **Tests — re-ran myself, did not trust the evaluator's paste**: `npm test`
  in the worktree, exit code 0, 0 `not ok` lines across the full run (I
  captured full output to a log and grepped for `not ok`/failure counts to
  confirm — zero). Ran the three directly-relevant files in isolation too:
  `node --test test/fleet.test.js test/queue.test.js test/watch.test.js` →
  `163 pass, 0 fail`. Read the new test bodies in
  `test/queue.test.js`/`test/fleet.test.js` directly (not just their names):
  they assert on `completedDuringDowntime` contents and `pending` contents
  by value (`assert.deepEqual`), and the `fleet.test.js` additions assert on
  actual rendered output text (`assert.match(out, /completed while you were
  away/)`, `assert.doesNotMatch`) for all four combinations of
  `queueState`/`restoreNotice` presence — these are behavior-locking, not
  vacuous.

- **No lint gate exists**: confirmed `package.json`'s `scripts.test` has no
  lint step and no `.eslintrc*`/`eslint.config*` file exists in the repo
  root, matching the evaluator's claim that `npm test` is the only gate.

- **Scope discipline**: `git diff main...HEAD --name-only` touches exactly
  `lib/ui/queue.js`, `lib/ui/screens/fleet.js`, `lib/ui/watch.js`,
  `test/fleet.test.js`, `test/queue.test.js`, plus the change directory's
  own artifacts — matching proposal.md's Impact section exactly. `inFlight`
  reconciliation logic in `queue.js` is byte-for-byte unchanged (only the
  `pending` loop and the surrounding comment changed), matching the
  design's Non-Goal.

- **UI review**: N/A per task instructions (no design standard configured
  for this project) — this is a terminal dashboard UI (not a web UI with
  screenshots/theming), and the design.md/tasks.md already specify the
  exact rendering pattern (`f.yellow`/`f.truncate`, matching the existing
  `queueNotice` convention) which I confirmed by reading the actual
  `fleet.js` diff: it reuses `f.yellow(f.truncate(...))` identically to the
  adjacent existing line.

### Verdict: CONFIRM

### Non-blocking notes
- None beyond what's already well-documented in the code's own comments;
  agree with the evaluator's assessment that this is a clean, tightly-scoped
  fix with meaningful regression coverage for every edge case the design
  called out (dead window with no `endedAt`, stale terminal run predating
  `writtenAt`, absent run object, all-pending-completed null-return
  invariant).
