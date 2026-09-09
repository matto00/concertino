## Evaluation Report — Cycle 3 (evaluation-3.md)

Commit under review: `f73c847` (delta over cycle 2's `0aefd49`). Gates re-run
independently: full `npm test` (rc=0, no suite reports a non-zero failure
count), `test/scripts/squash-branch.test.sh` (83/83, 2.36s real — my own
measurement, corroborating the orchestrator's 2.4s independently), and
`test/scripts/rendered-scripts-drift.test.sh` (18/18). `concertino sync` was
NOT run; `scripts/concertino/pricing-table.json` and
`scripts/concertino/report-cost.sh` do not appear in the diff and were not
touched.

Both cycle-2 change requests are fixed. The cycle-3 delta touches only the test
file and `files-modified.md` — `core/scripts/squash-branch.sh` and
`scripts/concertino/squash-branch.sh` are byte-for-byte unchanged since
`0aefd49` (`git diff 0aefd49..HEAD -- core/scripts scripts/concertino` is
empty), so cycle 2's verified script behaviour carries forward untouched.

### Phase 1: Spec Review — PASS

All seven acceptance criteria are met, and the artifacts now agree with the
implementation:

- AC1 / AC6: every commit-failure path restores, with mutation-proven coverage
  for the hook-rejection path (Scenario 8), the empty-staged-set path
  (Scenario 9), the signal path (Scenario 12) and the restore-itself-fails path
  (Scenario 13).
- AC2 / AC3: design.md D1 and D4 decide `commit-tree` and CON-164 D6 explicitly
  and from evidence; unchanged this cycle.
- AC4: verified again mechanically — the first 305 lines of
  `core/scripts/squash-branch.sh` are byte-identical to `main`.
- AC5: `DRY_RUN=1` behaviour unchanged (Scenario 11 green).
- AC7: core and rendered copies byte-identical; drift gate green.
- `files-modified.md` no longer asserts anything false (CR2 below).

### Phase 2: Code Review — PASS

Each of the six requested confirmations, verified by my own measurement rather
than inherited from the executor's or the orchestrator's report:

**1. The marker-file poll actually matches and exits early — CONFIRMED,
measured.** Built the fixture from scratch and instrumented the poll:

```
waited_iters=1 (100 == timed out)   marker=present
```

One iteration — ~100ms, against a 100-iteration (10s) bound. In the suite
itself both arms report `waited 100ms, well under the 10s bound`. The 2.36s
total runtime (against cycle 2's 26.6s) is consistent: the two dead 10s waits
are genuinely gone, not relabelled.

**2. The kill still lands in the correct window — CONFIRMED, and it is
structurally guaranteed, not merely observed.** The concern is exactly right:
a marker touched *before* the reset would make the test pass vacuously from the
other direction. It cannot happen here, for two independent reasons.

*Structurally*: the marker is touched by the `pre-commit` hook, and the hook
only runs from inside `git_wt commit`, which the script executes strictly
*after* `git_wt reset --soft "$MERGE_BASE"`. Marker exists ⟹ the commit has
started ⟹ the reset has already completed. There is no ordering in which the
hook could observe a pre-reset state.

*Measured*: I read `git rev-parse HEAD` at the instant the poll broke out,
before sending the kill:

```
HEAD at moment of kill = 009b8f0...
merge-base             = 009b8f0...   <- identical
pre-run HEAD           = 6c3b94b...
=> RESET HAS ALREADY HAPPENED at poll-exit
```

And after the SIGTERM, HEAD was back at `6c3b94b...` (the pre-run commit) — the
trap really did the restoring, from a genuinely reset state. I repeated the
`head_at_kill` check across both arms of the independent red/green run below;
it read `AT-MERGE-BASE` in both.

Worth noting the ordering inside the hook is also correct for a second reason:
the marker is touched *last* (after both PID files are written), so by the time
the poll observes it, `reap_slow_hook_fixture`'s inputs are already populated —
no read-before-write race on the reap.

**3. Both Scenario 12 arms are still real red/green — CONFIRMED
independently**, using the new marker fixture against my own copies of the
script (copied with its `lib/` siblings so the copy actually runs):

| script variant | poll | HEAD at kill | outcome |
| --- | --- | --- | --- |
| pristine | 1 iter | at merge-base | **restored** |
| `trap` line deleted | 1 iter | at merge-base | **STRANDED@merge-base** |

**4. The early-exit assertion is itself failable — CONFIRMED.** I copied the
suite into a scratch tree (`core/` + `test/scripts/`, so `ROOT` resolves) and
replaced the 3.7 arm's predicate with an unmatchable one
(`[ -f "$HOOK_MARKER12.never-exists-unmatchable" ]`):

```
  FAIL 3.7 poll observed the hook starting and broke out early
  ok   3.8 poll observed the hook starting and broke out early (waited 100ms, ...)
squash-branch.test.sh: 82 passed, 1 failed
```

The exact cycle-2 defect — a predicate that can never match — would now fail
loudly instead of silently costing ten seconds and testing nothing. Note the
suite is red on the assertion while `3.7 EXIT trap restores HEAD` still passes,
which is the correct decomposition: the guard fails, not the thing it guards.

**5. `files-modified.md` no longer asserts anything false — CONFIRMED.** Both
retracted statements are gone: it now says "Scenarios 8–13", describes
Scenario 13's ref-lock fixture and the CR1 gate, and describes the reap
accurately ("writes its own hook-shell PID and backgrounded-sleep-child PID to
sibling files and reaps both by exact PID after the kill … since neither the
hook shell's argv (a relative path) nor the sleep child's argv can be
pattern-matched safely"). That is a correct account of the code, including the
non-obvious reason the pattern-match approach was abandoned.

The declared file list is still correct for the squash guard: the three
declared paths are exactly the non-change-dir files in
`git diff --name-only main...HEAD`, and every remaining changed path is under
`openspec/changes/squash-never-strands-branch/`, which the guard allowlists
wholesale via its `<CHANGE_DIR>/**` glob (`core/scripts/squash-branch.sh:232`).

**6. Nothing above the mutation point changed; no drift — CONFIRMED.** First
305 lines byte-identical to `main`; `diff core/scripts/squash-branch.sh
scripts/concertino/squash-branch.sh` empty; drift gate 18/18.

Code-quality review of the delta: the fixture's hook is small and readable, the
reap is factored into a named helper with a comment explaining why a pattern
match cannot work, the marker and PID files live under the fixture's temp
`$BASE12` (outside any repo working tree, so `git status --porcelain`
assertions elsewhere are unaffected), and the retired sentinel machinery is
fully removed with no dead variables left behind.

### Phase 3: UI Review — N/A

No `frontend/**`, `backend/**`, `schemas/**` or `openspec/specs/**` files in the
diff.

### Overall: PASS

### Non-blocking Suggestions

- The poll's comment says the marker is one "the hook touches as its first
  action"; the hook actually touches it *last*, after writing both PID files —
  which is the correct order and is what `make_slow_hook_fixture`'s own comment
  describes ("touches the marker as its last setup action"). The two comments
  contradict each other; the fixture's version is the accurate one.
- `reap_slow_hook_fixture` kills by a PID read from a file. The window between
  the hook recording its PID and the reap is well under a second, so PID reuse
  is not a practical concern here — but it is the one way this reap could touch
  an unrelated process, and a `kill -0` liveness-plus-ownership check would
  close it if this helper is ever reused somewhere longer-lived.
- design.md D5 still enumerates five scenarios and mentions neither Scenario 12
  nor Scenario 13; tasks.md 3.7–3.9 cover both, so nothing is unrecorded, but a
  reader working from D5 alone would undercount the coverage. Carried over from
  cycle 2, still non-blocking.
