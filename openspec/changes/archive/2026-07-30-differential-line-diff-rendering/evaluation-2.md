## Evaluation Report — Cycle 2

Reviewed commit `985abb1` (merge of `6a473c3` and `aca8385`) on
`feature/differential-line-diff-rendering/CON-27`. Gates re-run independently by
the evaluator in a throwaway clean worktree (`CLEAN_WORKTREE=true`) detached at
`985abb1`, removed afterward. Every cycle-1 change request was re-verified by
running the merged code, not by reading it — as change request 3 itself demanded.

### Phase 1: Spec Review — PASS

Issues: none.

- **All five cycle-1 change requests are addressed**, and `tasks.md` gained an
  honest section 5 recording the reconciliation as extra work rather than
  back-dating it into sections 1-4.
- **`main` is now fully merged**: `git merge-base --is-ancestor main HEAD` → yes (at
  the `aca8385` the executor merged), and the branch still touches only
  `lib/ui/watch.js`, `test/watch.test.js`, `test/scripts/watch-smoke.test.sh` and its
  own change dir. `lib/ui/router.js` and every `lib/ui/screens/*` module remain
  untouched, per the ticket's scope note.
- **The CON-26 spec requirement that cycle 1 regressed is satisfied again**, verified
  live rather than by inspection (see Phase 2). CON-6's scroll behavior and CON-19's
  evidence reader are intact.
- All ticket acceptance criteria remain addressed, no AC reinterpreted, no scope
  creep, all task items marked done and matching what was implemented, and the spec
  delta still describes the implemented behavior accurately.
- **Base drift during this review (not blocking, flagged for the record):** `main`
  advanced to `ad2c7ca` (CON-23, `persist-evidence.sh`) while I was reviewing. Unlike
  the cycle-1 staleness, this is inert: the new commit's file set is completely
  disjoint from this branch's, `git merge-tree main HEAD` reports a clean merge, and
  I verified empirically by merging `ad2c7ca` into a scratch copy of `985abb1` and
  running the full gate there — **756/756 tests, exit 0**. No action required; noting
  it only so the merge is known-good against the newest `main`, not just `aca8385`.

### Phase 2: Code Review — PASS

**Gate run (evaluator's own, clean worktree detached at `985abb1`):**
- `npm test` → **exit 0**. `node --test`: 755 tests, 755 pass, 0 fail. All 16 shell
  suites report `N passed, 0 failed`, including `watch-smoke.test.sh` (56/56).
- Additionally under a **real 12-row pty** (`script -qec "stty rows 12 cols 80; node
  --test test/watch.test.js"`): 40/40 pass. This matters because every unit test
  otherwise runs with `process.stdout.rows` unset; at 12 rows the over-tall fallback
  genuinely fires inside the two watch()-driving tests, exercising `screenOf()`'s
  newline-flow branch. No TTY-dependent flakiness.
- Throwaway worktrees removed on every path; `git worktree list` is clean of them.

**Change request 2 (CON-26 strip) — verified fixed, live.** `lib/ui/watch.js:183` is
`text.replace(/\n$/, '').split('\n')...`, and the header comment now states the strip
and explains why the diff path makes it matter *more* (a phantom row would also be
where the park write leaves the cursor). Re-ran the cycle-1 pty probe (24x100, fleet,
0 runs) against `985abb1`:

```
cycle 1 (6a473c3): 695 bytes, 6 placements — rows 1-4 + a PHANTOM blank row 5,
                   written twice (diff + park write); cursor rests on the blank row
cycle 2 (985abb1): 599 bytes, 5 placements — rows 1-4 + the park write's duplicate
                   of row 4; no row 5 exists; cursor rests on the footer
```
Zero `\x1b[H`, zero `\x1b[2J`, and every tick after the first wrote nothing at all —
the ticket's headline goal, still observed end to end after the merge.

**Change request 3 (`draw()` call site) — verified fixed, by running it.**
`lib/ui/watch.js:768-769` reads `const totalRows = process.stdout.rows || 0;`
immediately before `buildFrame(rendered, cols, totalRows, prevFrameLines)`; the
`computeScreenRows()` helper keeps its own separate local (`watch.js:578`), so there
is no shadowing and no reuse of the banner-adjusted sub-budget. The comment now
explains exactly why `screenRows` would be wrong here. Confirmed at runtime, not from
a clean `git status`: the module loads, and pty runs at 24 rows (diff path,
`cursor-home=0`) and 4 rows (fallback fires, `cursor-home=3`, and the frames that fit
still use placements — both modes coexisting and switching correctly) all exit 0 with
no `ReferenceError`.

**Change request 4 (ported CON-26 tests) — verified present and load-bearing.** Both
of `main`'s tests were ported to the 4-arg / `{ bytes, lines }` contract rather than
deleted, and each now additionally asserts where the park write points. Teeth checked
by mutation (scratch copy, strip removed from `buildFrame`):
```
strip present : 40 tests, 40 pass, 0 fail
strip removed : 40 tests, 38 pass, 2 fail  <- both ported CON-26 tests
```

**Change request 5 (`rows_of` still valid post-merge) — re-verified against `main`'s
fleet/docview rendering.** Replayed the CON-35 P-reorder scenario against `985abb1`:
```
with-P   : raw-newlines=0 | rows_of: CON41=35 CON42=34 -> check PASSES
without-P: raw-newlines=0 | rows_of: CON41=30 CON42=31 -> check FAILS (teeth intact)
```
The smoke helper also gained the GNU-sed portability note suggested in cycle 1.

**The new CON-6 scroll-test fix (`screenOf()`) — reviewed from scratch and verified
in both directions.** This was not something I had reviewed before, so I tested the
executor's diagnosis rather than accepting it:

| product | assertion helper | result |
|---|---|---|
| correct | `screenOf(written)` (new) | 40/40 pass |
| correct | `plainFrame(last chunk)` (old) | **39/40 — the k-scroll test fails**: `AssertionError: RUNNING should have collapsed to its own overflow line`, actual being a five-row fragment |
| scroll broken (mutation: downward `scrollOffset` update disabled) | `screenOf(written)` (new) | **both scroll tests fail** |
| scroll broken | `plainFrame(last chunk)` (old) | both fail |

Two things fall out of this. First, the executor's diagnosis is exactly right and the
fix is load-bearing, not a way to make a test go green: the old helper asks "what
changed on the most recent tick?", which under the diff writer breaks the positive
`match(/and \d+ more running/)` assertion outright *and* makes the
`doesNotMatch(/HEL-200\b/)` assertions in the other test pass vacuously (a row absent
from the last partial chunk is not thereby off-screen). Second, `screenOf()` restores
real teeth — with scrolling deliberately broken, both tests fail. The replay is
correct for both writer modes (`\x1b[<n>;1H` absolute placement and `\x1b[H` +
newline flow), which the 12-row pty run exercises for real.

I also checked for the *same class of bug elsewhere* in the merged suite: only two
tests capture stdout chunks at all (`test/watch.test.js:815, 934`), and all four of
their frame-inspection call sites now go through `screenOf`. The other two
watch()-driving tests discard writes entirely. Nothing else in the suite asserts on
frame layout via a property of the old writer.

**Remaining code-quality checks (all pass):** the diff/fallback/park logic is
unchanged from cycle 1 and still matches the design (ordering diff → shrink-blank →
park; single `overflow` condition; tail truncation; `[]` vs. length-preserving
sentinel invalidation). The new module-level `rowAt(row)` helper is a clean pickup of
cycle 1's suggestion and is used by all three emit sites. No conflict markers
anywhere, no TODO/FIXME introduced, no dead product code, no new input boundary or
type-safety escape hatch, comments carry accurate rationale, and the handoff
(`files-modified.md`) documents both fixed bugs with real probe evidence whose
numbers match what I reproduced independently.

### Phase 3: UI Review — N/A

No UI review is configured for this project, so no dev servers were started. The
terminal-rendering behavior that would otherwise be "the UI" here was again verified
objectively under real ptys (24x100 diff path, 4-row fallback, 12-row unit-test run).

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `test/watch.test.js:825` and `test/watch.test.js:944` — the two `plainFrame` locals
  are now dead: all four of their call sites moved to `screenOf`. Delete both
  declarations (and their `eslint-disable-next-line no-control-regex` comments) so a
  future reader is not tempted to reach for the helper the merge just proved unsafe.
- `test/watch.test.js:325-334` — the third new CON-26 test ("buildFrame ignores a
  phantom trailing row when diffing against the previous frame") is vacuous as
  written: it passes with the strip removed too (confirmed by the mutation run above,
  where only the other two CON-26 tests failed). Its rationale comment says a leaked
  phantom row "would make the two frames diff as different", but a phantom row lands
  in *both* `lines` and `prevLines`, so it compares equal and `bytes` is still `''`.
  Either fix the comment, or give the test teeth by also asserting
  `second.lines.length === 2` / `first.lines.length === 2`.
- Pre-existing, surfaced by my mutation runs rather than introduced here: when an
  assertion inside the two watch()-driving tests fails, `fakeStdin.emit('end')` is
  never reached, `watch()`'s promise stays pending and the whole `node --test` run
  hangs instead of failing fast (I had to bound it with `timeout`). Wrapping the
  `emit('end')`/`await donePromise` pair into the existing `finally` would make a
  future failure in these tests report in seconds rather than time out. Came in with
  CON-6 on `main`; out of scope for this ticket, worth a follow-up.
- `design.md` is unchanged since cycle 1 and so does not mention the CON-26
  interaction; `tasks.md` section 5.2 and the code comment both do, which is
  sufficient. Only worth touching if the design doc is meant to stand alone as the
  archived record.
