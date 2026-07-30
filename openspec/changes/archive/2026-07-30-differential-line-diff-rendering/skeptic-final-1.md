## Skeptic Report — final gate (round 1)

Reviewed `985abb1` on `feature/differential-line-diff-rendering/CON-27`
(merge-base with local `main` = `aca8385`). Everything below was derived from
the code, the running loop, and command output I produced myself. The
executor's `files-modified.md` and the evaluator's `evaluation-2.md` were read
only as claims to test.

### What I verified (with evidence)

**1. Scope — confined to `lib/ui/watch.js` as the ticket's scope note demands**

```
$ git diff main...HEAD --name-only | grep -v '^openspec/'
lib/ui/watch.js
test/scripts/watch-smoke.test.sh
test/watch.test.js
```
`lib/ui/router.js` and every `lib/ui/screens/*` module are untouched. ✅

**2. Gates, re-run by me from scratch**

```
$ npm test                     -> exit 0
   node --test: 755 tests, 755 pass, 0 fail
   all 16 shell suites: "N passed, 0 failed"
$ bash test/scripts/watch-smoke.test.sh
   56 passed, 0 failed   EXIT=0
$ npx openspec validate differential-line-diff-rendering --strict
   Change 'differential-line-diff-rendering' is valid   EXIT=0
```

**3. Base drift re-checked against the *current* `origin/main` (`ad2c7ca`, CON-23)**

I did not take the evaluator's word for "inert". Fresh clone → checkout branch
HEAD → `git merge origin/main` (clean, no conflicts) → full gate on the merged
tree:

```
ℹ tests 756 / ℹ pass 756 / ℹ fail 0     EXIT=0
```

**4. Acceptance criteria traced to live behavior, not to code reading**

The ticket's ACs are its "Desired behavior" paragraph. I wrote a probe that
drives the **real** `watch()` loop (real `store`/`reduce`/`router`, faked
`session`, `process.stdout` with synthetic `columns`/`rows`) and measured the
actual bytes. Probe at
`/tmp/claude-1000/-home-matt-Development-concertino/a79871df-840e-4d2e-96e3-7b9a1fbc09fe/scratchpad/probe.js`:

```
A. first frame:              rows written = [1..7]  bytes=696  \x1b[H count=0
B. resize, same size 80x40:  rows = [1..7]          bytes=688
C. ROWS-ONLY resize 40->30:  rows = [1..7]          bytes=688
D. one real 1 Hz poll tick, no state change:
                             writeCalls=0  bytes=0  rows=[]
F. resize 40 -> 4 rows:      placements, in order =
                             [1;1H 2;1H 3;1H 4;1H 5;1H 6;1H 7;1H 4;1H]
                             TAIL = "...\x1b[4;1H  ↵ attach   l details  ..."
G. resize back to 40 rows:   rows = [1..7]          bytes=688
H. steady tick afterwards:   writeCalls=0  bytes=0
E. attach round-trip:        attachCalls=1  1049l=1  1049h=1
                             post-attach redraw rows = [1..7]  bytes=704
```

- *"Diff line by line and only write the rows that actually changed"* — **D/H**:
  a genuine steady-state poll tick calls `process.stdout.write` **zero times**.
  That is the ticket's headline goal, observed end to end.
- *"Positioning the cursor per-row via `\x1b[<row>;1H` rather than rewriting the
  whole frame"* — **A**: every row carries its own placement and `\x1b[H` never
  appears. The smoke gate asserts the same thing against a real session
  (`no full-rewrite cursor-home (\x1b[H) in the session (q)` → 0).
- *"Track the previous frame's rendered lines"* — `prevFrameLines`
  (`watch.js:341`), one array, `.length` doubling as the shrink-cleanup count.

**5. The spec delta's harder scenarios, verified live**

- *"A rows-only resize still triggers a full rewrite, not a partial diff"* —
  **C**: cols unchanged (so padded content is byte-identical), rows 40→30, and
  all seven rows still repaint. The `watch.js:827` sentinel works.
- *"The first redraw after returning from attach rewrites every row"* — **E**:
  `1049l`/`1049h` paired around a real `session.attach()` call, and the redraw
  that follows writes all seven rows. `watch.js:920` works.
- *Decision 8's cursor-park is load-bearing, not cosmetic* — **F** is the
  proof I most wanted and did not expect to get so cleanly. On a 40→4 row
  resize the writer emits content rows 1–4, then blanks rows 5–7 (which on a
  4-row terminal **clamp onto physical row 4**, erasing the footer), then the
  park write repairs row 4 with its real content, last. Exactly the repair
  `tasks.md` 1.7 and `design.md` Decision 8 claim it performs, observed in the
  real loop rather than argued from the source.
- *Over-tall fallback* — `buildFrame(text, 5, 5, [])` with 10 lines returns
  `CURSOR_HOME + padded.join('\n')`, zero `\x1b[<row>;1H`, and caches only the
  visible tail (`lines.slice(5)`), so a later in-bounds frame diffs against
  physical rows. Covered by unit tests I re-ran and by direct call.

**6. Mutation testing — do the tests actually have teeth?**

Run against a scratch copy of the tree (the worktree itself was never
modified). `node --test` unless noted:

| # | mutation | result |
|---|---|---|
| M1 | drop CON-26 strip `text.replace(/\n$/,'')` | **38/40 — 2 fail** (both ported CON-26 tests, named below) |
| M2 | drop the Decision-8 cursor-park line | **33/40 — 7 fail** |
| M6 | disable downward fleet scroll (`applyAction 'move'`) | **fails** `repeated j past the visible window…` |
| M7 | disable upward fleet scroll | **39/40 — 1 fail** |
| M3 | resize sentinel `.map(() => null)` → `[]` | 755/755 **still pass** |
| M4 | delete `prevFrameLines = []` in `doAttach`'s restore | 755/755 **still pass** |
| M5 | `if (frame.bytes) write(...)` → unconditional write | 755/755 **still pass** |

M1's two failures:
```
✖ buildFrame does not write a phantom trailing blank row for a trailing-newline-terminated input
✖ buildFrame strips exactly one trailing newline, preserving genuine blank content lines
```

M6/M7 are the check that mattered most for trust: the executor **changed two
tests that were passing on `main`** (the CON-6 scroll tests, rerouted through
the new `screenOf()` replay helper). Changing a green test to keep it green is
the classic way work gets waved through. It is not what happened here — with
the fleet's scroll logic deliberately broken in either direction, both tests
fail through the new helper. The helper restores the original question ("what
is on screen?") rather than softening it.

**7. CON-26 / CON-6 / CON-19 regressions from cycle 1 — closed**

`watch.js:183` is `text.replace(/\n$/, '').split('\n')…` (the strip cycle 1
reverted), guarded by the two live tests above. `watch.js:768-769` reads
`process.stdout.rows || 0` into its own `totalRows` local — the auto-merge
`ReferenceError` is gone, proven by the probe *running* rather than by a clean
`git status`. No `lastFrameLines` or `lineCount` reference survives anywhere in
`lib/` or `test/`. All three `2J` occurrences in `watch.js` are inside comments.

### Verdict: CONFIRM

Every acceptance criterion traces to behavior I observed in the running loop,
not to a claim. The gates are green on the branch and on the branch merged with
the newest `main`. The two riskiest judgment calls in the change — the
cursor-park write and the `screenOf()` test rewrite — both turned out to be
load-bearing under adversarial probing rather than convenient.

### Non-blocking notes

1. **Three seams in `watch.js` are silently mutable** (M3/M4/M5 above): the
   resize sentinel (`watch.js:827`), the attach cache reset (`watch.js:920`),
   and the `if (frame.bytes)` guard (`watch.js:770`). Two of them back explicit
   spec-delta scenarios ("A rows-only resize still triggers a full rewrite…",
   "The first redraw after returning from attach rewrites every row"), and both
   would produce a visibly broken screen if regressed — yet the whole 755-test
   suite stays green when they are removed. Task 3.9 tests the sentinel
   *mechanism* (`buildFrame` given a null-mapped array) but never that
   `watch.js` actually uses it, and no task covers the attach reset at all.
   This is a plan-level gap that the design gate signed off on, and I verified
   both behave correctly today (probe C and E), so nothing ships broken — but a
   future `watch.js` edit has no safety net here. A `watch()`-driving test in
   the shape of my probe would close it in ~30 lines. (M5 is lowest priority:
   `write('')` is byte-equivalent to not writing, so that mutation is arguably
   semantics-preserving.)
2. `test/watch.test.js:325-334` — "buildFrame ignores a phantom trailing row
   when diffing against the previous frame" is vacuous; M1 confirms only the
   other two CON-26 tests catch the strip's removal. A phantom row lands in
   both `lines` and `prevLines`, so it compares equal and `bytes` is `''`
   either way. Adding `assert.equal(second.lines.length, 2)` would give it
   teeth. (Independently reproduced; the evaluator flagged the same thing.)
3. `test/watch.test.js:825` and `:944` — the two `plainFrame` locals are dead
   now that all four call sites use `screenOf`. Worth deleting so nobody
   reaches for the helper the merge just proved unsafe.
4. **Pre-existing, not a regression:** on the over-tall fallback path,
   `blankTrailingRows()` still emits absolute placements past the terminal's
   height when `prevLines.length > rows` (reachable only via the resize
   sentinel, which preserves the pre-resize length). Verified directly:
   `buildFrame(30 lines, cols 5, rows 20, 40 sentinels)` emits ten blanks at
   rows 31–40, all clamping onto physical row 20 and erasing the last visible
   line for one tick. `main`'s `buildFrame` has the identical loop and the same
   exposure, the next tick's full rewrite repairs it, and `tasks.md` 1.7
   explicitly dispositions this as pre-existing. Noted only so it is on the
   record, not as a change request.
5. Process, not code: `evaluation-2.md` is **untracked** and
   `workflow-state.md` is modified-but-uncommitted in the worktree. Every other
   change-dir artifact (`evaluation-1.md`, all four `skeptic-design-*.md`) is
   committed. Unless these are committed before delivery, the cycle-2
   evaluation record — the one documenting the stale-base recovery — will not
   reach the delivered branch.
6. The branch is one commit behind `origin/main` (`ad2c7ca`). It merges cleanly
   and passes 756/756 merged (section 3), so this is informational.
