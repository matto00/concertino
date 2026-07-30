## Skeptic Report — final gate (round 3)

Post-delivery reconciliation cycle for CON-27, reviewing merge commit `fb356a9`
(parents `600a49f` = squashed+archived delivery, `4c2bea4` = CON-39 on `main`;
merge base `a9e0bf6`). Spawned cold. Every conclusion below is derived from git
objects, an isolated byte-identical export of `fb356a9`, or a live pty run —
never from the executor's handoff or `evaluation-4.md`, both of which I read only
as claims to refute.

**All mutation and gate work was done in a private export of `fb356a9`
(`$SCRATCH/mine`), never in the worktree. I modified no tracked file; this report
is the only file I wrote.** Copy identity proven before use:

```
$SCRATCH/mine/lib/ui/watch.js               58cae37e…  == fb356a9:lib/ui/watch.js
$SCRATCH/mine/test/watch.test.js            44539356…  == fb356a9:test/watch.test.js
$SCRATCH/mine/test/scripts/watch-smoke.sh   9e306499…  == fb356a9:…/watch-smoke.test.sh
file-list diff (my copy vs `git archive fb356a9`)  ->  empty
```

---

### What I verified (with evidence)

#### 1. The `lib/ui/watch.js` auto-merge is genuinely git's own result — reproduced

```
$ git merge-tree --write-tree 600a49f 4c2bea4
d685f499…
100644 490bbd37 1  test/watch.test.js
100644 4bf7244d 2  test/watch.test.js
100644 8f36bf91 3  test/watch.test.js
Auto-merging lib/ui/watch.js
Auto-merging test/watch.test.js
CONFLICT (content): Merge conflict in test/watch.test.js
```

Only `test/watch.test.js` conflicted, exactly as reported. Blob comparison:

```
merge-tree  d685f499:lib/ui/watch.js  ->  58cae37ebfc7dc769ad46b5d04bef5ffa0d21ee6
commit      fb356a9 :lib/ui/watch.js  ->  58cae37ebfc7dc769ad46b5d04bef5ffa0d21ee6
diff <(git show TREE:…) <(git show fb356a9:…)  ->  IDENTICAL
```

So the committed file is byte-for-byte git's three-way merge, with no hand
editing. **Byte-identity to git's own output is necessary but not sufficient**
(cycle 1 proved a clean auto-merge can still be a runtime `ReferenceError`), so I
did not stop there — see 2, 3 and 7.

#### 2. Diff-of-diffs, both directions — nothing lost, nothing invented

Added/removed line sets (hunk headers stripped, sorted):

```
CON-27's edit:  diff(a9e0bf6 -> 600a49f)  vs  diff(4c2bea4 -> fb356a9)   IDENTICAL  (200 lines)
CON-39's edit:  diff(a9e0bf6 -> 4c2bea4)  vs  diff(600a49f -> fb356a9)   IDENTICAL  (145 lines)
```

Set equality in *both* directions: neither side's edit lost a line, and the merge
introduced nothing that came from neither parent.

#### 3. Semantic scope audit of the merged file (the cycle-1 hazard class)

Read from `git show fb356a9:lib/ui/watch.js`, not the worktree (see §10):

```
:604  const totalRows = …   (computeScreenRows' own local)
:809  const totalRows = process.stdout.rows || 0;   <-- draw()'s own, immediately above
:810  const frame = buildFrame(rendered, cols, totalRows, prevFrameLines);
:341  let prevFrameLines = [];      (watch() scope)
:812/:883/:976  the three assignments — draw(), the resize listener, attach's restore callback
:123  const rowAt = …    used at :196, :219, :227
:115/:209  CURSOR_HOME — the overflow fallback only
```

Every identifier CON-27's hunks reference is declared in an enclosing scope in the
merged file; no shadowing, no duplicate `totalRows` in one scope, no orphaned
reference. Confirmed at runtime in §7 rather than by reading alone.

#### 4. Full gate, in the isolated copy — 814/814, exit 0

```
$ cd $SCRATCH/mine && npm test          EXIT=0
ℹ tests 814   ℹ pass 814   ℹ fail 0
shell suites (16 files, summed): 483 passed, 0 failed
  — including test/scripts/watch-smoke.test.sh
```

(I also ran `npm test` in the worktree itself at 15:24, before the interference
described in §10 began: same 814/814, exit 0.)

#### 5. `test/watch.test.js` reconciliation — no coverage lost, and no assertion weakened

Test-name sets extracted from all four revisions:

```
base a9e0bf6: 33   ours 600a49f: 43   theirs 4c2bea4: 36   merged fb356a9: 46
in OURS   but not MERGED:  none
in THEIRS but not MERGED:  3  — all three are in BASE and absent from OURS, i.e.
    the pre-CON-27 buildFrame tests this change deliberately rewrote in cycle 1
in MERGED but in neither parent:  none
CON-39's 3 new tests (theirs − base): all present in merged
```

Name-set equality alone can hide a gutted body, so I also compared **bodies**:

- All 43 of CON-27's test bodies are byte-identical between `600a49f` and
  `fb356a9`. (The one apparent difference is an artifact of my slicer: the last
  test's "body" swallowed trailing non-test content; the test proper is identical
  line-for-line.) The file preamble (both helpers, `screenOf` and `writesByRow`)
  is byte-identical too — and CON-39 never touched the preamble
  (`diff preamble(base) preamble(theirs)` is empty), so nothing of theirs was lost
  there.
- CON-39's 3 test bodies differ from `4c2bea4` in **exactly** the frame-read idiom
  and nothing else: `plainFrame(written[written.length - 1])` → `screenOf(written)`
  at 10 sites, plus deletion of the now-unused `plainFrame` local. **No assertion
  was removed, added, relaxed, or reworded.** I read the full three-way body diff.

#### 6. Mutation testing — CON-27's history intact, plus six mutations of my own

Run in `$SCRATCH/mine`, restoring from a hash-checked pristine copy each time.
The first six reproduce cycle 3's table **exactly**, post-merge:

```
A  resize invalidation deleted              killed(1)  "a rows-only resize repaints every row AND blanks…"
B  resize weakened to prevFrameLines = []   killed(1)  same test, different reason (the stale tail)
C  attach cache reset deleted               killed(2)  normal-return AND throwing path
D  CON-26 trailing-newline strip removed    killed(3)
E  cursor-park write removed                killed(7)
F  diff loop writes every row               killed(5)
```

Six further mutations I chose independently (not in any prior report):

```
G  draw() never updates the cache (`prevFrameLines = frame.lines` deleted)  killed(1)
H  Decision-5 guard removed (`if (frame.bytes)` → unconditional write)      SURVIVED  (see note 1)
I  overflow tail-slice → whole frame                                        killed(2)
J  shrink-blanking loop disabled                                            killed(3)
K  rowAt off-by-one in the diff loop (`i+1` → `i+2`)                        killed(13)
L  cursor park writes row 1 instead of the last row                         killed(6)
```

CON-39's three behaviors, mutated in the *merged* product:

```
N1  scrollToShow's downward clamp disabled   ✖ 3 tests fail, incl. CON-39's digit-jump test
N3  QUEUED-focus entry clobbers `selected`   killed(1)  by exactly its own test
N4  force-start confirm becomes a no-op      killed(1)  by exactly its own test
```

#### 7. The third-instance fix (`screenOf`) proven load-bearing, not cosmetic

This is the crux of the bug class that has now bitten this ticket three times, so
I reproduced the before/after directly on the same broken product — downward
scroll-into-view clamp removed — toggling only the digit-jump test's frame-read
idiom:

```
pre-fix idiom  plainFrame(written[written.length-1])  ->  ✔ PASS   (vacuous)
shipped idiom  screenOf(written)                      ->  ✖ FAIL   (has teeth)
   (node --test --test-name-pattern='a digit press jumps directly', 1 test each)
```

The fix is necessary and correctly targeted. I found **no fourth instance**:

- All 14 frame-inspection sites in `test/watch.test.js` go through `screenOf` or
  `writesByRow`; `grep` for `written[written.length-1]` / `.at(-1)` / `.pop()` /
  `plainFrame` across `lib/`, `test/` and `bin/` returns nothing.
- No stale `lineCount` / `lastFrameLines` reference survives anywhere.
- The four `written.length = 0` sites are deliberate per-phase resets feeding
  `writesByRow` — the correct idiom for a differential writer, not a stale one.
- `test/scripts/watch-smoke.test.sh`: the only order-sensitive check (`grep -n`
  line numbers) and the only `.*`-spanning patterns already route through
  `rows_of`; every other assertion is a literal `grep -q` or `esc_count`, both
  unaffected by row-placement writes.
- Only `test/watch.test.js` and `watch-smoke.test.sh` reference `ui/watch` at all,
  so CON-39's other new tests (`fleet.test.js`, `queue.test.js`,
  `launchplan.test.js`) exercise pure string-returning screens and cannot carry
  the assumption.

#### 8. Live behavior of the merged code, in a real pty

Real 24×100 pty via `script`, two live tmux windows, keys `j k 1 q`:

```
bytes: 2402
ESC[2J: 0        ESC[H (full-rewrite home): 0        ESC[<n>;1H: 16
alt buffer enter/exit: 1 / 1
ReferenceError: 0   TypeError: 0   "is not defined": 0   "Error:": 0
```

Replayed final screen renders both features together — the marker `▸` correctly
back on SKEP-1 after `j` then `k`, and CON-39's footer:

```
  ↵ attach   l details   j/k move   1-9 jump   n new run   N launch pad   q quit
```

16 row-placements total for a 9-row frame across a ~9 s session (≥4 polls plus 4
keypresses) is the ticket's "close to free" claim measured directly: the idle
ticks wrote nothing at all.

#### 9. Acceptance criteria traced

The Linear ticket (fetched fresh; identical to `ticket.md`, PR #38 attached) has
no numbered AC list — its "Desired behavior" and "Scope note" are the criteria,
with the change's own spec delta as the acceptance signal.

| Criterion | Code | Evidence |
|---|---|---|
| Track the previous frame's rendered lines | `:341` `prevFrameLines`, `buildFrame` returns `{bytes, lines}` `:229`, `:812` | mutation **G** |
| Diff the new frame against the previous, line by line | `:217-220` strict per-row compare | mutation **F** |
| Write only changed rows, positioned per-row via `\x1b[<row>;1H`, not a whole-frame rewrite | `rowAt` `:123` at `:196/:219/:227` | mutations **K**, **L**, **E**; pty: 16 placements, 0 `\x1b[H` |
| Poll write-cost close to free when unchanged | `if (frame.bytes)` `:811` + empty `bytes` | pty §8 (idle ticks write nothing) |
| Confined to `lib/ui/watch.js`; router/screens untouched | — | `git diff --name-only 4c2bea4 fb356a9 -- lib/` → `lib/ui/watch.js` alone; `-- lib/ui/router.js lib/ui/screens/` → empty |

CON-17's five inherited ACs, still green after the merge: no `\x1b[2J` (all three
occurrences in `watch.js` are inside comments; 0 in the pty capture and in the
smoke gate); alt buffer 1/1; shrink cleanup (**J**); resize reflow (**A**, **B**);
attach restore on both paths (**C**).

**Delivery bookkeeping.** All three MODIFIED requirements in the archived delta
are present in `openspec/specs/dashboard-render-loop/spec.md` and compare
**IDENTICAL** whitespace-normalized, requirement body by requirement body; the
three canonical-only requirements — including CON-26's "A trailing newline…" —
survive the fold rather than being clobbered. `origin/main` (`4c2bea4`) is an
ancestor of `HEAD`: no drift remains.

#### 10. One anomalous reading, re-run and diagnosed (not a defect)

Mid-review, `lib/ui/watch.js` in the shared worktree read as
`if (false) bytes += rowAt(i + 1) + lines[i];` — a mutation — despite `git status`
having been clean minutes earlier. I did **not** treat that as a finding. Re-running
`git status` and inspecting `/proc` showed a **concurrently running second skeptic
(`skeptic-final-3b`) applying in-place mutations to the shared worktree** from
`$SCRATCH/mutate.sh`, restoring after each. Its pristine baseline hashes to
`58cae37e` (the committed blob), and by the end of my review the worktree was
restored: `git hash-object lib/ui/watch.js` → `58cae37e`, `git status --short`
showing only the expected ` M workflow-state.md` and `?? evaluation-4.md`. Nothing
is wrong with the change; I moved all my own work into a private isolated export
so no reading of mine could be contaminated. Raised as note 4 below because it is a
real hazard to *any* reviewer's evidence, mine or 3b's.

---

### Verdict: CONFIRM

The reconciliation is sound. `lib/ui/watch.js` is provably git's own three-way
result with set-equal edits from both sides and no scope or runtime breakage;
`test/watch.test.js` gained CON-39's three tests without losing one of CON-27's 43
or weakening a single assertion; all fifteen mutations aimed at CON-27's own
behaviors and CON-39's three still die post-merge, including six I designed
independently; the third-instance `screenOf` fix is proven necessary by a
pass-then-fail toggle on the same broken product; and the merged product runs
clean in a real pty with both features visibly working together. Ships.

### Non-blocking notes

1. **`if (frame.bytes)` (`watch.js:811`) is still mutation-survivable** (my
   mutation H: removing the guard leaves 814/814 green). This is a re-discovery,
   not a new finding — `skeptic-final-1.md` note 1 raised it and reasoned it is
   the lowest-priority of the three seams because `write('')` is byte-equivalent
   to not writing, i.e. the mutation is arguably semantics-preserving. The other
   two seams it named (resize sentinel, attach reset) *were* closed in cycles 2-3
   and now die as A/B/C. Not introduced by this merge; the line is untouched by
   CON-39.

2. **The hang-instead-of-fail issue is worse than "a follow-up ticket" makes it
   sound, and I measured it.** With a genuine regression in place (mutation N1),
   `node --test test/watch.test.js` reports the three `✖` failures and then
   **never exits** — I only got a verdict by wrapping it in `timeout`, and
   `--test-timeout=15000` did not help because the leak is a pending handle, not a
   slow test. In CI that is a hung job rather than a red one, on the tests
   guarding the fleet's scroll behavior. The cause is inherited from `main` (the
   `emit('end')`/`await donePromise` pair sits inside `try` at base `a9e0bf6`
   lines 333-335, 537-539, 650-652, not `finally`), so it is genuinely not this
   ticket's to fix — but the follow-up deserves priority over its "nice to have"
   framing, and `withWatchHarness` in the same file already shows the fix.

3. `evaluation-4.md`'s correction of the handoff's "2 passed accidentally for the
   wrong reason" wording is right, and I can state the reproducible version
   precisely: the vacuity is not that the pre-fix tests passed under mutation of
   their *own* feature, it is that a `doesNotMatch` off-screen assertion flips
   from "is this on screen?" to "did this change this tick?" — demonstrated in §7
   (pre-fix PASSES, shipped FAILS, same broken product). Worth folding that
   one-liner into `files-modified.md` so the archived record matches what
   reproduces.

4. **Process hazard, not a code issue:** two cold skeptics were mutating the *same*
   worktree concurrently (§10). A mutation applied by one reviewer is
   indistinguishable, in a single reading, from a defect in the change — this run
   happened to produce a transient reading that looked exactly like a shipped bug.
   Both of us got correct answers only because we each isolated; a future round
   should either serialize the skeptics or have the orchestrator hand each one its
   own export. Worth a ticket against the workflow, not against CON-27.

5. `fb356a9`'s tree still carries the incidental `workflow-state.md` /
   `auditor-report.md` sweep, and the worktree has an uncommitted
   `workflow-state.md` edit plus untracked `evaluation-4.md` (and now this report).
   Bookkeeping only, and folds out at the re-squash — flagging so the re-squash is
   not assumed to be a no-op.
