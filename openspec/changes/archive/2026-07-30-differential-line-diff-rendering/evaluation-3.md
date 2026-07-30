## Evaluation Report — Cycle 3

Reviewed commit `d1c7ae1` on `feature/differential-line-diff-rendering/CON-27`
(narrow loop back for skeptic-final-1b's two change requests). Gates re-run
independently by the evaluator in a throwaway clean worktree
(`CLEAN_WORKTREE=true`) detached at `d1c7ae1`, removed afterward. The executor's
mutation-kill claim was **not** taken at face value — I reproduced the whole matrix
myself, including the pristine-baseline gap it rests on.

### Phase 1: Spec Review — PASS

Issues: none.

- **"Tests only, zero production diff" — confirmed by hash, not by reading the diff.**
  `lib/ui/watch.js` is blob `9621a6b9` at both `985abb1` and `d1c7ae1`; so is
  `test/scripts/watch-smoke.test.sh` (`9e306499`). The only non-`openspec/` file the
  cycle-3 commit touches is `test/watch.test.js`. Nothing about the implementation
  the two skeptics cleared has moved.
- **Both change requests map to scenarios that already existed in this change's spec
  delta** and had no test behind them: "A rows-only resize still triggers a full
  rewrite, not a partial diff" and "The first redraw after returning from attach
  rewrites every row" (the latter explicitly covering the throwing path, which task
  6.3's third test now exercises). This closes a genuine spec-to-test gap rather than
  adding decorative coverage.
- `tasks.md` gained a section 6 that states the scope ("Tests only. No production
  change this cycle") and is honest about *why* the gap existed — task 3.9 tested
  `buildFrame`'s handling of a hand-built sentinel array, never that the resize
  listener produces one; task 2.3 had nothing at all. That diagnosis is correct.
- Scope unchanged: the branch still touches only `lib/ui/watch.js`,
  `test/watch.test.js`, `test/scripts/watch-smoke.test.sh` and its own change dir.
  `lib/ui/router.js` and every `lib/ui/screens/*` module remain untouched.
- Cycle-2's three non-blocking suggestions were all picked up (task 6.5): the two dead
  `plainFrame` locals are gone, and the vacuous CON-26 test now carries the
  load-bearing `first.lines.length === 2` assertion plus an honest comment explaining
  that its earlier form guarded nothing.

### Phase 2: Code Review — PASS

**Gate run (evaluator's own, clean worktree detached at `d1c7ae1`):**
- `npm test` → **exit 0**. `node --test`: 758 tests, 758 pass, 0 fail. All 16 shell
  suites `N passed, 0 failed`.
- Stability: `node --test test/watch.test.js` run 3x non-TTY (43/43 each) and 2x under
  a real 24x100 pty (43/43 each). The new harness manipulates genuinely global state
  (`process.stdout.rows`/`columns` descriptors, the `resize` listener list,
  `process.stdin`, `require.cache`), so the real-TTY repeat runs matter — that is the
  case where failing to restore the original property descriptors would show up. No
  flakiness, no order dependence.

**Mutation matrix — reproduced independently, not accepted from the handoff.** I
applied each mutation to a scratch copy and ran the suite myself:

| mutation | cycle-2 baseline (`985abb1`) | cycle 3 (`d1c7ae1`) |
|---|---|---|
| resize invalidation deleted | **survived** (40/40 pass) | **killed** — 1 test |
| resize invalidation weakened to `prevFrameLines = []` | **survived** (40/40 pass) | **killed** — 1 test |
| attach cache reset deleted | **survived** (40/40 pass) | **killed** — 2 tests |
| CON-26 trailing-newline strip removed | killed — 2 tests | killed — **3** tests |
| (no mutation) | 40/40 pass | 43/43 pass |

Every number matches the executor's reported matrix for the mutations I ran.

**The baseline gap is real, at full-gate scope.** I verified the strongest form of
skeptic #2's claim rather than the convenient one: with the attach cache reset deleted
from the cycle-2 baseline, the **entire `npm test` gate stays green** — exit 0,
755/755 node tests, all 16 shell suites passing. A regression that leaves the
dashboard permanently blank after an attach was, at cycle 2, completely invisible to
the gate. Skeptic #2 was right to refuse on this, and the human's narrow loop-back was
the right call.

**The two resize mutations fail for two *different* reasons — the key property.** This
is what shows the single assertion loop is genuinely covering both failure modes
rather than one masking the other:
```
resize invalidation deleted  -> "row 1 was not written by the resize redraw (frame 1..18, stale tail 19..29)"
                                (unchanged rows skipped — the partial-diff-against-a-changed-shape bug)
resize weakened to []        -> "row 19 was not written by the resize redraw (frame 1..18, stale tail 19..29)"
                                (the stale tail is never blanked — `[]` discarded the length the shrink loop is driven by)
```
That second one is exactly the regression design.md Decision 3 documents at length,
now with a test behind it for the first time. The fixture is real, not contrived: 12
live runs render a 29-row frame at 30 rows and an 18-row frame at 20 rows, with `cols`
held constant so the unchanged rows really are byte-identical.

**The attach tests kill their mutation independently of each other** (2 distinct
failures: the normal-return path and the throwing path), and I confirmed they fire in
the full multi-file `node --test` run, not just when the file is run alone — 758
tests, 756 pass, 2 fail, both the attach tests. So there is no isolation quirk that
would let the coverage evaporate under the real gate.

**Test-code quality (the only code changed this cycle) — good:**
- `writesByRow()` is the right new primitive and its header comment says exactly why
  it is deliberately *not* built on `screenOf`: these tests must distinguish "rewritten
  with identical content" from "left alone", which a replayed screen structurally
  cannot express. That is a real distinction, and it is the whole subject of both
  regressions.
- `withWatchHarness()` is a genuine de-duplication of the fixture/teardown the two
  older watch()-driving tests already open-code, and it is *more* careful than they
  are: `body(...).finally(cleanup)` means teardown runs on a failing assertion too, so
  these tests fail fast instead of hanging the runner (the pre-existing hazard I
  flagged non-blocking in cycle 2 — the new tests do not inherit it).
- The `resize`-listener parking is a hack, but a correct and well-explained one:
  `watch()` never removes its listener and `quit()` does not clear `running`, so a
  previously-finished `watch()` from an earlier test in the file would otherwise also
  redraw into this test's capture. Parked and restored, not discarded.
- Each assertion carries a message that names the actual failure mode; the fixture
  sanity checks (`preHeight > 20`, `newHeight < preHeight`) prevent the test from
  silently degrading into a tautology if the fleet's layout changes later.
- The corrected CON-26 test's new comment is accurate about why the old form was
  vacuous (a leaked phantom row lands in both `lines` and `prevLines` and compares
  equal to itself), which matches what my cycle-2 mutation run showed.
- No dead code, no TODO/FIXME, no production surface touched, no new dependency.

**Nothing else regressed.** Full gate green at `d1c7ae1`; the three files the branch
touches are unchanged from the versions two independent skeptics and cycle 2 already
cleared, apart from the additive test file.

**Base freshness (checked, not re-litigated).** `main` moved again during this review
— now `850f853` (CON-33) — so it is two commits past the branch's `aca8385` base
(`ad2c7ca`, `850f853`). I re-checked whether the drift is still inert rather than
assuming it: the main-only source files are `lib/ui/ticket-text.js`,
`scripts/concertino/{cleanup,emit-event,persist-evidence}.sh` and their tests, all
disjoint from this branch's three files; `git merge-tree main HEAD` reports a clean
merge; and I merged `850f853` into a scratch copy of `d1c7ae1` and ran the **full gate
on the merged result: exit 0, 759/759, all 16 shell suites**. Still inert, now with
evidence against the current tip. No action needed; the delivery-time stale-base
warning remains the right place for this.

### Phase 3: UI Review — N/A

No UI review is configured for this project. The rendering behavior was verified
objectively under real ptys in cycles 1-2 and the production code is byte-identical
this cycle, so no re-run was warranted; the 24x100 pty test runs above confirm the
suite itself behaves in a real terminal.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `test/watch.test.js:90` — `writesByRow` calls `chunks.join('')` inside the `while`
  loop condition, so the joined string is rebuilt on every match. It is correct only
  because `re.lastIndex` carries across calls and the rebuilt strings are identical
  (and the inputs are tiny), but it is subtle enough to be worth hoisting to a
  `const all = chunks.join('');` above the loop — mirroring what `screenOf` already
  does one function up.
- `test/watch.test.js:89` — the `// eslint-disable-next-line no-control-regex` sits
  above the `out.push(...)` line, but the control characters are in the `const re =
  /\x1b\[.../` declaration on the line above it, which is left uncovered. No lint gate
  runs today, so this is cosmetic; move or duplicate the comment if one is ever added.
- Still open from cycle 2, unchanged and out of this cycle's scope: the two older
  CON-6 scroll tests (`test/watch.test.js:~855`, `~975`) still hang the runner instead
  of failing fast when an assertion throws, because their `emit('end')`/`await
  donePromise` pair sits inside `try` rather than `finally`. `withWatchHarness` now
  demonstrates the fix in the same file; folding those two tests onto it would retire
  the hazard entirely.
