## Evaluation Report — Cycle 4 (post-delivery reconciliation with CON-39)

Reviewed merge commit `fb356a9` (parents `600a49f` = the squashed+archived delivery
branch, and `4c2bea4` = CON-39 on `main`; merge base `a9e0bf6`). Gates re-run
independently in a throwaway clean worktree (`CLEAN_WORKTREE=true`) detached at
`fb356a9`, removed afterward. Every claim in the executor's handoff was reproduced
rather than accepted — including the auto-merge audit, the coverage reconciliation,
and both sides' mutation-kill teeth.

### Phase 1: Spec Review — PASS

Issues: none.

- **Scope is still exactly the ticket's.** Relative to current `main` (`4c2bea4`) the
  branch changes `lib/ui/watch.js`, `test/watch.test.js` and
  `test/scripts/watch-smoke.test.sh` — and `git diff 4c2bea4 fb356a9 -- lib/` returns
  `lib/ui/watch.js` alone. `lib/ui/router.js` and every `lib/ui/screens/*` module
  remain untouched by this change even after absorbing a merge that itself rewrote
  `screens/fleet.js`. The ticket's scope note survives the reconciliation.
- **Delivery bookkeeping is correct.** The change is archived at
  `openspec/changes/archive/2026-07-30-differential-line-diff-rendering/`, and the
  three MODIFIED requirements were folded into the canonical
  `openspec/specs/dashboard-render-loop/spec.md`. I compared them mechanically
  (whitespace-normalized, requirement by requirement): all three bodies are
  **IDENTICAL** to the archived delta, and CON-26's "A trailing newline…"
  requirement is still present alongside them rather than clobbered by the fold.
- CON-27's acceptance criteria all still hold; the merge changed no behavior of this
  change (see Phase 2's byte-level audit and the live run).
- `main` is an ancestor of `HEAD`, so there is no remaining drift to reconcile.
- The incidental sweep of `workflow-state.md`/`auditor-report.md` into this commit is
  bookkeeping-only, already acknowledged, and folds out at the final re-squash.

### Phase 2: Code Review — PASS

**Gate run (evaluator's own, clean worktree detached at `fb356a9`):**
`npm test` → **exit 0**. `node --test`: 814 tests, 814 pass, 0 fail. All 16 shell
suites `N passed, 0 failed`, including `watch-smoke.test.sh` (56/56).

**1. The `lib/ui/watch.js` auto-merge — independently reproduced, then audited
semantically.** I did not take the diff-of-diffs claim on trust; I did three separate
checks:

- *Mechanical reproduction.* `git merge-tree --write-tree 600a49f 4c2bea4` produces
  `lib/ui/watch.js` blob **`58cae37e`** — byte-identical to the blob committed in
  `fb356a9`. So the file is exactly git's own three-way result with no hand editing,
  and the conflict report confirms the only real conflict was in
  `test/watch.test.js`, as reported.
- *Diff-of-diffs, both directions.* Comparing added/removed lines (hunk headers
  stripped):
  ```
  CON-27's edit: diff(base -> ours)   vs diff(theirs -> merged)   IDENTICAL
  CON-39's edit: diff(base -> theirs) vs diff(ours   -> merged)   IDENTICAL
  ```
  Set equality in both directions means nothing was lost *and* nothing spurious was
  introduced — a stronger statement than "every line landed".
- *Semantic audit, because cycle 1 proved a clean auto-merge can still be wrong.*
  Cycle 1's actual failure was a hunk that auto-merged into a `ReferenceError`
  (`totalRows` no longer in scope after a `main`-side refactor). I checked that class
  directly: CON-39 adds state (`focus`/`queueFocus`/`forceStartConfirm`,
  `watch.js:468-474`), a `queueFocus` re-clamp in `draw()`, and a `scrollToShow()`
  extraction in `applyAction` — none of which touch the `buildFrame` call site.
  In the merged file, `draw()`'s own `const totalRows = process.stdout.rows || 0;`
  (`watch.js:809`) still sits immediately above `buildFrame(...)` (`:810`), separate
  from `computeScreenRows()`'s own local (`:604`); the CON-26 strip is intact
  (`:183`), as are `rowAt` (`:123`), `prevFrameLines` (`:341`), the resize sentinel
  (`:883`) and the attach reset inside `attachAndRestore`'s restore callback (`:976`).
  Confirmed at runtime too — see point 5.

**2. `test/watch.test.js` reconciliation — no coverage lost from either side.**
Compared test-name sets across all three versions:
```
ours 43   theirs 36   merged 46   (= 43 + CON-39's 3 new tests)
in OURS   but missing from MERGED: none
in THEIRS but missing from MERGED: 3 — and all three are the pre-CON-27 buildFrame
    tests this change deliberately rewrote in cycle 1 ("homes the cursor…",
    "reports the line count…", "a frame that grows… blanks nothing"); their
    renamed successors are all present in the merged file
in MERGED but in neither parent: none (nothing invented)
```
CON-39's three new tests (digit-jump, QUEUED focus, force-start) are all present.

**3. The `screenOf()` fix for CON-39's tests — has teeth, verified by mutation.** I
mutated each of CON-39's three behaviors in the merged product and ran the suite:
```
digit jump no longer scrolls the target into view  -> KILLED by "a digit press jumps directly to a scrolled-past section…"
entering QUEUED focus clobbers the run selection   -> KILLED by "jumping into QUEUED focus… leaves the run selection completely unchanged"
confirm-force-start becomes a no-op                -> KILLED by "force-start: f opens a confirmation… y actually starts the ticket…"
```
Each killed by exactly its own test, one failure apiece; pristine baseline 46/46.

**4. The pre-fix state — reproduced, with one honest correction to the handoff's
wording.** I reverted only the 10 frame-read sites inside CON-39's three tests to the
pre-merge "last write is the whole frame" idiom, product intact:
- **1 test fails outright** (the QUEUED-focus one). So the auto-resolved merge could
  not have shipped green regardless — a fix was mandatory, not optional.
- The other two pass. For the coarse mutations of their *own* features above, they
  still failed under the old idiom too — so "2 passed accidentally for the wrong
  reason" is not quite the right characterization of those particular mutations, and
  I could not reproduce it as stated.
- **But the vacuity is real, and I demonstrated it directly** on the assertion where
  it actually bites — the off-screen (`doesNotMatch`) check. Disabling the downward
  scroll-into-view (`scrollToShow`'s clamp):
  ```
  screenOf   (as shipped) -> the digit-jump test FAILS  (has teeth)
  last-chunk (pre-fix)    -> the digit-jump test PASSES (vacuous)
  ```
  That is the same failure mode found in cycle 2 (CON-6's tests) and cycle 3 (the
  wiring lines): an assertion silently changing from "is this on screen?" to "did this
  change on the most recent tick?". The fix is correct and justified; only the
  handoff's one-line summary of the *before* state is slightly overstated, which is a
  documentation nit, not a defect.

**5. CON-27's own mutation history — fully intact after the merge.** Re-ran the whole
set against `fb356a9`; every kill count matches cycle 3 exactly:
```
resize invalidation deleted            -> 1 ("row 1 was not written by the resize redraw…")
resize weakened to prevFrameLines = [] -> 1 ("row 19 was not written…", the stale tail)
attach cache reset deleted             -> 2 (normal path AND throwing path)
CON-26 trailing-newline strip removed  -> 3
cursor-park write removed              -> 7
diff loop writes every row uncondition.-> 5
```
The two resize mutations still fail for their two *different* reasons, so the merge
did not blunt the distinction cycle 3 established.

**6. Live behavior of the merged code, in a real terminal.** 24x100 pty, real poll
loop: exit 0, **zero `ReferenceError`**, 4 real rows each behind its own
`\x1b[<row>;1H`, no phantom row, the park write landing on the footer, zero `\x1b[H`,
zero `\x1b[2J`, and every tick after the first writing nothing at all. Both features
are visibly present together — the footer now reads
`↵ attach   l details   j/k move   1-9 jump   n new run   N launch pad   q quit`
(CON-39's hint) rendered through CON-27's differential writer.

**7. The smoke gate's `rows_of` check still has teeth against CON-39's rendering.**
Replayed the P-reorder scenario at `fb356a9`: passes with the `P` keypress
(`CON41=35 CON42=34`), fails without it (`CON41=30 CON42=31`).

**Code quality:** no `plainFrame`/last-chunk read remains anywhere in the test file
(all 14 frame-inspection sites now go through `screenOf`), the three dead locals both
I and the skeptics flagged are finally gone, no conflict markers, no TODO/FIXME, no
production behavior change in this commit beyond absorbing CON-39.

### Phase 3: UI Review — N/A

No UI review is configured for this project. The terminal rendering that would
otherwise be "the UI" was verified under a real pty (point 6 above), which is the
relevant check for a merge that combines two rendering changes.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `files-modified.md`'s cycle-4 summary says CON-39's three tests were "1 failed
  outright, 2 passed accidentally for the wrong reason". I could reproduce the first
  half exactly, but not the second as stated: for mutations of their own features both
  of those tests did still fail under the old idiom. The vacuity is real but shows up
  on the off-screen `doesNotMatch` assertions specifically (demonstrated above).
  Worth a one-line correction so the archived record matches what is reproducible.
- Still open from cycles 2-3, and now applying to five tests rather than two: the
  older watch()-driving tests (CON-6's two and CON-39's three) still hang the runner
  instead of failing fast when an assertion throws, because their
  `emit('end')`/`await donePromise` pair sits inside `try` rather than `finally`.
  `withWatchHarness` in the same file already demonstrates the fix. A follow-up
  ticket, not this one.
- `test/watch.test.js:90` — `writesByRow` still rebuilds `chunks.join('')` on every
  loop iteration (correct, but subtle); hoisting it would match what `screenOf` does
  one function above.
