## Skeptic Report — final gate (round 3b)

Cold, independent review of `fb356a9` (the CON-39 reconciliation merge). I did not
read `skeptic-final-3.md` (the concurrent reviewer's report). Everything below is
derived from commands I ran myself against the worktree; the executor's handoff and
`evaluation-4.md` were treated as claims to refute, and I only read the latter's
mutation section *after* producing my own numbers, to cross-check.

All mutation testing was done against an isolated `git archive fb356a9` copy in the
scratchpad, never the worktree — `git status` on `lib/` and `test/` is clean.

### What I verified (with evidence)

**1. The `lib/ui/watch.js` auto-merge is genuinely git's own, not hand-edited.**
Reproduced the three-way merge from scratch:
```
git merge-base 600a49f 4c2bea4          -> a9e0bf6 (CON-37)
git merge-tree --write-tree 600a49f 4c2bea4
  -> tree d685f499...; CONFLICT (content) in test/watch.test.js ONLY
     "Auto-merging lib/ui/watch.js" with no conflict entry
git rev-parse d685f499:lib/ui/watch.js  -> 58cae37ebfc7dc769ad46b5d04bef5ffa0d21ee6
git rev-parse fb356a9:lib/ui/watch.js   -> 58cae37ebfc7dc769ad46b5d04bef5ffa0d21ee6
```
Identical blob OIDs — byte-identity confirmed, not merely "diff is empty".
`git diff d685f499 fb356a9` shows the only other divergences are `test/watch.test.js`
(the resolved conflict) and three change-dir markdown files. Claim holds.

**2. Diff-of-diffs: set equality in both directions, exactly.**
```
ext a9e0bf6 4c2bea4  (CON-39 intended) vs ext 600a49f fb356a9  (CON-39 landed)
ext a9e0bf6 600a49f  (CON-27 intended) vs ext 4c2bea4 fb356a9  (CON-27 landed)
```
All four `comm` directions returned empty. Nothing lost from either parent, nothing
spurious introduced. `git diff 4c2bea4 fb356a9 -- lib/ui/watch.js` is exactly
CON-27's contribution (buildFrame rewrite, `prevFrameLines`, resize sentinel, attach
reset); `git diff 600a49f fb356a9 -- lib/ui/watch.js` is exactly CON-39's (5 hunks:
focus/queueFocus/forceStartConfirm state, the draw() re-clamp, `scrollToShow()`, and
the six new action cases). Disjoint regions, as claimed.

**3. Semantic audit — no repeat of the cycle-1 hazard (clean merge, broken runtime).**
- `grep -n "lastFrameLines\|lineCount\|prevLineCount" lib/ui/watch.js test/watch.test.js`
  → zero hits. CON-39's code references no identifier CON-27 renamed.
- `node --check` clean on both files.
- `buildFrame` has exactly one production call site, `watch.js:810`, at the new
  4-arg arity (`rendered, cols, totalRows, prevFrameLines`); all 27 test call sites
  are 3- or 4-arg with the new `rows` parameter.
- CON-39's `scrollToShow()` calls `computeScreenRows()` and references
  `restoreNotice` — both present in the merged file (base-provided). No undefined
  references. Confirmed at runtime in §8 below.

**4. `test/watch.test.js` lost no coverage — verified at the body level, not just by
name.** Extracted every `test(...)` block from all four revisions and set-compared:

| | count |
|---|---|
| BASE (a9e0bf6) | 33 |
| CON-27 parent (600a49f) | 43 |
| CON-39 parent (4c2bea4) | 36 |
| MERGED (fb356a9) | **46** |

- 30 shared + 13 CON-27-only + 3 CON-39-only = 46. **Zero tests in neither parent**
  (nothing invented during conflict resolution).
- **43 of 46 bodies are byte-identical to their owning parent.** The only 3
  mismatches are exactly CON-39's 3 new tests.
- 3 BASE tests absent from merged (`buildFrame homes the cursor instead of
  clearing`, `buildFrame reports the line count it padded from`, `a frame that grows
  … blanks nothing`). `comm` shows `BASE − CON27` = exactly those 3 and
  `BASE − CON39` = ∅ — i.e. they are CON-27's own deliberate semantic rewrites
  (renamed to `positions the cursor…`, `reports the lines it padded from`, `writes
  each new row via its own cursor placement`), correctly honored over CON-39's
  untouched copies. Not merge loss.

**5. The 3 modified CON-39 tests: only the frame-read idiom changed, no assertion
weakened.** Full `diff -u` of each body against its CON-39 original shows *nothing*
but `plainFrame(written[written.length - 1])` → `screenOf(written)` at 10 sites
(2 + 4 + 4) and removal of the 3 now-dead `plainFrame` locals. Every `assert.match`,
`assert.doesNotMatch`, `assert.equal` line is character-for-character unchanged.

**6. Full gate, re-run by me.** `npm test` → `EXIT=0`, `ℹ tests 814 / pass 814 /
fail 0`, plus all 16 shell suites green (`0` `not ok` lines). Consistent with 770 +
CON-39's 44.

**7. Mutation testing — my own matrix, 12 mutations, on the merged code.**

| # | Mutation (lib/ui/watch.js) | Result |
|---|---|---|
| M1 | diff condition → always write every row | killed (5) |
| M2 | diff condition → never write | killed (suite hangs/non-zero) |
| M3 | cursor-park write removed | killed (7) |
| M4 | `blankTrailingRows()` removed from diff path | killed (3) |
| M5 | `overflow` → always false | killed (2) |
| M6 | overflow tail-slice → full `lines` | killed (2) |
| M7 | `rowAt(i + 1)` → `rowAt(i + 2)` | killed (13) |
| M8 | `if (frame.bytes)` write guard removed | **SURVIVED** (see notes) |
| M9 | attach `prevFrameLines = []` removed | killed (2 — normal AND throwing path) |
| M10 | resize sentinel removed | killed (1) |
| M11 | resize sentinel → `prevFrameLines = []` | killed (1, *different* test message) |
| M12 | CON-26 trailing-newline strip removed | killed (3) |

Six of these correspond one-to-one to the counts `evaluation-4.md` claims for
CON-27's history, and **every count matches exactly**: resize-deleted 1 (M10),
resize-weakened 1 (M11), attach-reset 2 (M9), CON-26 strip 3 (M12), park write 7
(M3), diff-loop-unconditional 5 (M1). M10 and M11 still fail for their two
*different* reasons (`row 1 was not written…` vs the stale-tail row), so the merge
did not blunt the distinction cycle 3 established. CON-27's mutation history is
genuinely intact, not merely asserted to be.

**8. CON-39's tests have real teeth under `screenOf` — 6/6 killed, each by its own
test.** I mutated CON-39's product logic (not the evaluator's 3, an independent
superset): `jump` ignoring `action.index`; `jump` skipping scroll-into-view;
`focus-queue` not setting focus; `focus-queue` clobbering `selected`;
`exit-queue-focus` resetting `selected`; `open-force-start-confirm` becoming a no-op.
All 6 killed, and the failing-test names map exactly to the intended CON-39 test each
time. The `screenOf` conversion did not make them vacuous.

**9. Independently reproduced the pre-fix state — and the evaluator's correction is
right.** I reverted *only* the 3 CON-39-new test bodies to their originals (leaving
CON-27's own test rewrites in place) against the merged product:
`ℹ pass 45 / fail 1` — exactly one failure, `jumping into QUEUED focus…`. So (a) the
fix was **mandatory**, the auto-resolved merge could not have shipped green, and
(b) the executor's handoff overstated the pre-fix behaviour; `evaluation-4.md`'s
correction is accurate. (My first, over-broad revert of all 12 differing bodies also
independently re-surfaced cycle 2's CON-6 failure, `scrolling back up with k…`,
confirming this bug class was real there too.)

**10. Fourth-instance hunt — none found.** The exposure surface is provably
confined: `grep -rn "process.stdout.write *=" test/ lib/ bin/` and
`grep -rln "require.*ui/watch" test/ lib/ bin/` both return **only
`test/watch.test.js`**. Within it, every one of the 16 `written` read sites is
accounted for: 10 screen-content questions go through `screenOf`, the rest use
`writesByRow` / `written.join('')` — which is the *correct* question for CON-27's own
"which rows did this tick touch" tests, not a stale assumption. No `plainFrame`
remains anywhere. `grep -rn "length - 1\]\|\.pop()\|at(-1)\|slice(-1)" test/` surfaces
only `test/layout.test.js:101,109`, which index a pure `layout.box()` return array,
not a stdout capture — not this bug class. `test/scripts/watch-smoke.test.sh` is
explicitly CON-27-aware (`rows_of()` re-splits on row placements, with a comment
naming the exact hazard).

**11. `screenOf` itself is sound and non-degenerate** (every converted assertion
depends on it). Instrumented the digit-jump test to dump `scrolledFrame`: a full
**26-row, 2105-char** screen — NEEDS YOU / DONE panes, `▸` on HEL-306, `… and 1 more
running` where HEL-2 scrolled off, and CON-39's `1-9 jump` in the footer. The
`doesNotMatch(/HEL-2\b/)` assertion is asking the real "is this on screen?" question
against real content, not passing on an empty string.

**12. Live pty run of the merged binary — both features together.** Real 30×100 pty
(`script -qfc`, `stty rows 30 cols 100`, actual `bin/concertino watch`):
```
full-clear \x1b[2J   : 0      alt-enter/alt-exit : 1 / 1
bare cursor-home     : 0      ReferenceError     : 0     exit 0
per-row placements   : 5      CON-39 "1-9 jump"  : present in footer
```
Raw capture shows `\x1b[?1049h`, then rows 1–4 each behind their own
`\x1b[<n>;1H`, then **row 4 written a second time** — Decision 8's cursor-park write,
observed live — then `\x1b[?1049l`. A separate 12-second idle run (≈12 poll ticks):
still only **5 placements total**, i.e. the first frame plus its park write and then
*nothing at all* for ~11 subsequent ticks. That is CON-27's headline acceptance
criterion ("close to free in the common case") verified live on the merged code, with
CON-39 present.

**13. Ticket AC and scope constraint traced.**
- Scope note ("entirely confined to `lib/ui/watch.js`; `router.js` and `screens/*`
  untouched"): `git diff --stat a9e0bf6 600a49f -- lib/` = `lib/ui/watch.js` only.
  `git diff --stat a9e0bf6 fb356a9 -- lib/ui/router.js` = empty. Held.
- Desired behavior (track previous frame, diff line-by-line, per-row
  `\x1b[<row>;1H`): §12's live capture and M1/M7.
- Spec delta applied to the live spec: `git diff --stat a9e0bf6 600a49f --
  openspec/specs/` → `dashboard-render-loop/spec.md +110/-17`; all five key
  requirement phrases present. All `tasks.md` boxes checked; no unchecked items.
- No conflict markers anywhere in `lib/`, `test/`, `openspec/`.
- `git merge-base --is-ancestor origin/main HEAD` → true: `4c2bea4` is now an
  ancestor, so the mergeability blocker that failed the auditor is resolved.

### Verdict: CONFIRM

The reconciliation is sound. The `lib/ui/watch.js` auto-merge is provably git's own
output with zero hand-editing; both parents' contributions landed in full with
nothing spurious; the `test/watch.test.js` resolution lost no coverage at the body
level; CON-27's acceptance criteria and its entire mutation-kill history survive the
merge with identical kill counts; the third instance of the stale-full-rewrite
assumption was fixed with teeth intact; and I found no fourth instance on a surface
I proved is confined to a single file. It ships.

### Non-blocking notes

1. **`watch.js:810`'s `if (frame.bytes)` guard is the one design decision with no
   test.** M8 (removing the guard, writing unconditionally) survives both
   `test/watch.test.js` **and** the full `watch-smoke.test.sh` suite (56 passed).
   `design.md` Decision 5 states the guard is load-bearing — "an unchanged tick
   touches stdout not at all, literally true, not merely writes zero bytes to a
   stream call" — but nothing pins it. This is arguably an equivalent mutant
   (`process.stdout.write('')` is unobservable at the terminal), it is pre-existing
   and unchanged by this merge, and rounds 1–2 both accepted it — so it is not a
   change request. Flagging it only because it is the sole surviving mutation in an
   otherwise 11/12 matrix.

2. **`screenOf`'s escape-strip regex does not cover private-mode sequences**, unlike
   `writesByRow`'s twenty lines below it:
   `test/watch.test.js:73` uses `/\x1b\[[0-9;]*[A-Za-z]/g`;
   `test/watch.test.js:98` uses `/\x1b\[[0-9;?]*[A-Za-z]/g` (note the `?`).
   Probed directly:
   ```
   screenOf(["\x1b[?1049h", "\x1b[1;1Hhello", "\x1b[2;1Hworld"]) -> "hello\nworld"   (fine)
   screenOf(["\x1b[?1049h",                   "\x1b[2;1Hworld"]) -> "\x1b[?1049h\nworld"  (leaks)
   ```
   Unreachable today: Decision 7 forces a full repaint after every attach, so row 1
   is always rewritten and overwrites the artifact — which is why the real dump in
   §11 is clean. But it is a latent trap in exactly the helper this ticket has now
   had to fix three times, and aligning the two regexes is a one-character change.

3. **Cycle-4's own evidence is uncommitted.** `evaluation-4.md` is untracked and
   `workflow-state.md` is modified in the worktree; `fb356a9` does not contain them.
   Process artifact, not a code defect — but the auditor will need these committed
   before re-attempting the merge, or the delivered history will be missing the
   reconciliation cycle's record.

4. **`watch-smoke.test.sh`'s P-reorder ordering check is tick-order-sensitive.** It
   takes `tail -1` of each ticket's `rows_of` match, which under the diff writer means
   "the last tick that rewrote that row". Sound as written only because the key
   sequence ends `esc + q` so no further launch-pad frame is drawn (the surrounding
   comment says as much). Worth remembering if a future test adds ticks after `P`.
