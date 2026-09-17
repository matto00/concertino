## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed commit: `dc00be6fa77b33f517ed818868b8b039295c0335` on
`task/typed-verdict-category-validation/CON-189`, diffed against
`4f7331be2714862cf384a5b57d045fab4caaeafc` (the post-archive state). Did not
re-read ticket/proposal/design/tasks (unchanged; the change dir itself is
archived to `openspec/changes/archive/2026-09-16-typed-verdict-category-validation/`,
as the orchestrator noted). Owner-authorized `fix-inline` for a pre-existing,
this-change-unrelated CI flake found post-cycle-3-PASS; +1 execution cycle
granted. Diff is exactly two files, confirmed via `git diff --name-only
4f7331b..HEAD`: `test/scripts/emit-event.test.sh` (+16) and the archived
`files-modified.md` (a cycle-4 addendum). The emitter
(`core/scripts/emit-event.sh` / `scripts/concertino/emit-event.sh`) is
byte-unchanged since cycle 1 (confirmed: `git diff
b7d079c..HEAD -- core/scripts/emit-event.sh scripts/concertino/emit-event.sh`
is empty).

Re-derived every one of the orchestrator's 6 numbered claims independently.

### Phase 1: Spec Review — PASS

Not applicable in the usual sense (no ticket/spec change this cycle — this
is a pure test-flake fix). The archived `files-modified.md` addendum is
scoped, honest, and explicitly notes it is not consumed by `squash-branch.sh`
since no further squash occurs this cycle — read in full and matches what I
independently re-derived below.

### Phase 2: Code Review — PASS

Fresh gate run: `npm test` → exit 0, full ~50-suite chain, no `-n`, run to
completion (`/tmp/npmtest_con189_cycle4.log`).

Independently re-derived every claim, in a full `git clone` of the local
repo (never a partial out-of-tree copy, since `BASH_SOURCE`-relative
sourcing in `test/scripts/lib/wait-bounded.sh` requires the real repo
layout):

1. **Assertion is still failable.** In a scratch clone checked out at
   `dc00be6`, I mutated line 111's `assert_children_dead` target from
   `"$LEAKY_CHILD"` to `"$$"` (the running shell's own definitely-alive
   PID) — a targeted mutation, not a removal of the fix, chosen so the
   assertion itself is exercised rather than short-circuited. Result:
   `FAIL self-test: after cleanup, assert_children_dead reports it gone —
   expected [none] got [alive: <pid>]`, suite exit 1 — matching the
   orchestrator's own reported shape exactly. Reverted the mutation
   (`git checkout --`) and re-ran: `ok ... reports it gone`, suite green.
   Control-green-before/red-during/green-after all independently confirmed.
2. **Pinned before/after rates, re-measured independently (not inherited).**
   Built my own load harness: 4 `taskset -c 0 bash -c 'while :; do :; done'`
   spinners, PIDs recorded explicitly to a file and killed by those exact
   PIDs afterward (never `pgrep -f`, per the orchestrator's own
   self-inflicted-shell-kill warning this cycle). Ran the FULL
   `test/scripts/emit-event.test.sh` suite (not just the self-test slice)
   pinned to the same core (`taskset -c 0 bash test/scripts/emit-event.test.sh`)
   against both a pre-fix clone (checked out at `4f7331b`, byte-identical
   assertion to base `d246b703...`) and the post-fix clone (`dc00be6`), 6
   trials each:
   - **Pre-fix, pinned+loaded: 6/6 `FAIL ... expected [none] got [alive:
     <pid>]`, suite exit 1 every time.**
   - **Post-fix, pinned+loaded: 6/6 `ok ...`, suite exit 0 every time.**
   This corroborates the orchestrator's corrected 6/6→0/6 (and the
   executor's 10/10→0/10 in the archived addendum) with my own
   independently-run trials, not their numbers. All spinner PIDs confirmed
   dead by explicit `kill -0` check after cleanup; no stray processes left.
3. **Bounded condition wait, not a magic constant — confirmed.** The fix
   polls `children_alive "$LEAKY_CHILD"` for emptiness at 0.1s resolution
   with a 50-iteration (5s) cap, breaking early the instant the condition is
   met — this is a genuine condition-driven bounded wait (CON-200's
   principle: it terminates as soon as the awaited fact becomes true, not
   only after some fixed sleep), and it reuses the file's own pre-existing
   idiom rather than inventing a new constant. It does not call
   `wait_killed_bounded` directly, but that is correct, not a shortcut:
   `wait_killed_bounded` performs its own `kill -0`-loop-then-SIGKILL
   sequence expecting to be the one that also sends the kill — here the kill
   already happened (`kill -KILL "$LEAKY_CHILD"` on the prior line), and what
   remains to wait for is just "has the kernel reflected it," which is
   exactly what the `children_alive`-polling idiom (already used a few lines
   above for "wait for the child to appear") checks. Reusing that idiom
   rather than repurposing `wait_killed_bounded` for a job it wasn't built
   for is the more honest choice.
4. **Sibling-assertion claim, confirmed by direct grep.** `grep -n
   "assert_children_dead" test/scripts/emit-event.test.sh` returns three
   call sites: the self-test (line 111, fixed this cycle) and two real
   `--await`-checking sites (`"killed --await leaves no orphan child"` and
   `"INT-killed --await leaves no orphan child"`). Read both directly: each
   already calls `wait_killed_bounded "$AWAIT_PID" 10` on the line
   immediately before its `assert_children_dead` call. No sibling shares the
   defect; the one-assertion diff is correctly scoped.
5. **No regression to cycles 1-3.** `core/scripts/emit-event.sh` is
   byte-identical to the cycle-3-reviewed version. `cmp
   core/scripts/emit-event.sh scripts/concertino/emit-event.sh` → identical;
   `rendered-scripts-drift.test.sh` → `19 passed, 0 failed`. Re-ran
   `test/scripts/check-merge-readiness.test.sh` (including cycle-2's 189.1/
   189.2 historical-tolerance cases) → `81 passed, 0 failed`, confirming the
   CON-171 lease placement, stated-only `head_sha` validation, skeptic
   `gate` requirement, and historical-tolerance properties all still hold
   unchanged.
6. **Full `npm test`, confirmed** as stated above — exit 0, run to
   completion, no `-n`.

`git status --short` after all probing shows only
`openspec/changes/archive/2026-09-16-typed-verdict-category-validation/workflow-state.md`
modified — orchestrator-managed, as noted, and correctly left uncommitted so
it doesn't move HEAD under this verdict.

### Phase 3: UI Review — N/A

No frontend/backend/schema files touched; this repo has no dev server.

### Overall: PASS

The cycle-4 fix-inline correctly and narrowly resolves the pre-existing,
change-unrelated flake, is scoped to exactly the one defective assertion
(verified against its two non-defective siblings), uses a real bounded
condition wait rather than a fixed sleep, and introduces no regression to
any property verified in cycles 1-3. Independently reproduced the flake's
mechanism (100% failure under CPU-pinned load pre-fix, 0% post-fix) with my
own harness rather than trusting either the orchestrator's or executor's
numbers.

### Non-blocking Suggestions

- None beyond evaluation-3.md's still-standing one (the CR2 shallow-clone
  deepen fallback mutating the invoking repo's clone depth) — unrelated to
  this cycle's diff and not re-litigated here.
