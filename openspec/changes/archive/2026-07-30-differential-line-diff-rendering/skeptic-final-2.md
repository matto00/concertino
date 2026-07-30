## Skeptic Report — final gate (round 2)

Commit reviewed: `d1c7ae1` on `feature/differential-line-diff-rendering/CON-27`.
Spawned cold. I read `skeptic-final-1.md`, `skeptic-final-1b.md` and
`evaluation-3.md`, but every number below is from a command I ran myself in this
session. In particular I did **not** take the reproduced-mutation-matrix claim on
trust: I rebuilt both trees (`985abb1` and `d1c7ae1`) from `git archive` in a
scratch directory and ran the whole matrix from scratch, plus mutations nobody
else ran. The worktree itself was never modified (`git status --porcelain` shows
only `workflow-state.md` modified and `evaluation-3.md` untracked; `git diff HEAD
-- lib test scripts` is empty, before and after my work).

### What I verified (with evidence)

**1. The cycle-3 commit really is test-only.**
`git rev-parse 985abb1:lib/ui/watch.js d1c7ae1:lib/ui/watch.js` → both
`9621a6b9749078413d269adea81486af4d5bb5c7`. `git show --stat d1c7ae1` touches
`test/watch.test.js` plus openspec artifacts and nothing else. So the
implementation two skeptics cleared in round 1 has not moved by one byte.

**2. Scope holds.** `git diff --name-only main...HEAD -- lib/` → `lib/ui/watch.js`
only. Non-openspec files on the branch: `lib/ui/watch.js`,
`test/watch.test.js`, `test/scripts/watch-smoke.test.sh`. `lib/ui/router.js` and
`lib/ui/screens/*` untouched, as the ticket's scope note requires.

**3. The configured gate, re-run by me.** In the worktree: `npm test` → **exit 0**,
`node --test` 758 tests / 758 pass / 0 fail, all 16 shell suites `N passed, 0
failed`. Re-run `node --test` twice more: 758/758 both times. Under a real
24×100 pty (`script -qc`): `node --test test/watch.test.js` → 43/43, exit 0. No
flakiness, no order sensitivity observed.

**4. Mutation matrix — rebuilt from scratch, both trees, at full `node --test`
scope.** Each mutation applied to a pristine `git archive` extraction, full suite
run, file restored:

| # | mutation | cycle-2 `985abb1` | cycle-3 `d1c7ae1` |
|---|---|---|---|
| — | control (no mutation) | 755/755, **exit 0** | 758/758, **exit 0** |
| M1 | resize invalidation **deleted** (`watch.js:827`) | **SURVIVED**, exit 0, 755/755 | **KILLED**, exit 1, 757/758 |
| M2 | resize invalidation **weakened to `prevFrameLines = []`** | **SURVIVED**, exit 0, 755/755 | **KILLED**, exit 1, 757/758 |
| M3 | attach cache reset **deleted** (`watch.js:920`) | **SURVIVED**, exit 0, 755/755 | **KILLED**, exit 1, 756/758 (2 tests) |
| M4 | attach reset **moved out of the restore callback** (runs only on the normal return) | — | **KILLED**, and *only* the throwing-path test fails |

So skeptic #2's original refusal was factually correct — I reproduced the
cycle-2 baseline letting all three through the **full** gate with exit 0 — and the
cycle-3 tests genuinely close it.

**5. The two resize mutations fail for genuinely different reasons** (this is what
proves one test is not coincidentally masking two holes). Assertion messages I
extracted from my own runs:
```
M1 (deleted):      row 1  was not written by the resize redraw (frame 1..18, stale tail 19..29)
M2 (weakened []):  row 19 was not written by the resize redraw (frame 1..18, stale tail 19..29)
```
M1 fails because unchanged rows are skipped (the partial-diff-against-a-changed-shape
bug); M2 fails because the stale tail is never blanked (`[]` discards the length
the shrink loop is driven by). Two distinct failure modes, two distinct
assertions.

**6. The third (throwing-attach) test is not redundant — I proved it with a
mutation nobody else ran.** M4 keeps `prevFrameLines = []` but moves it *after*
`attachAndRestore(...)` instead of inside the restore callback, so the normal
path still resets and the exception path does not. Result: `the first redraw
after returning from attach repaints every row` **passes**, `the first redraw
after an attach that THREW also repaints every row` **fails** ("the first redraw
after a THROWING attach wrote nothing — the dashboard would be left blank"). The
`finally` guarantee the spec delta explicitly requires ("whether or not the
attach call itself threw") has its own independent guard.

**7. The new tests are not vacuous.** Instrumented in scratch: the resize test's
pre-resize frame is 29 rows and its post-resize frame 18, so the "every row
1..preHeight" loop asserts on 29 real rows plus an 11-row stale tail; the attach
tests' frame is 13 rows (14 writes incl. the cursor park). Both carry fixture
sanity assertions (`preHeight > 20`, `newHeight < preHeight`) that fail loudly
rather than degrading to a tautology if the fleet layout changes.

**8. No new coverage gap of the same shape — checked by a wider sweep, not by
argument.** 11 further mutations over the production lines this change added,
each against the full `node --test`:

| mutation (line) | result |
|---|---|
| diff loop writes every row unconditionally (219) | KILLED |
| shrink-blanking removed on the diff path (221) | KILLED |
| `blankTrailingRows` off-by-one (195) | KILLED |
| cursor park removed (227) | KILLED |
| cursor park made unconditional (227) | KILLED |
| overflow condition `>` → `>=` (207) | KILLED |
| overflow branch disabled (207) | KILLED |
| overflow tail-truncation removed (210) | KILLED |
| cache never updated, `prevFrameLines = frame.lines` deleted (771) | KILLED |
| resize listener's `if (running) runs = draw()` deleted (828) | KILLED (2 tests) |
| **`blankTrailingRows()` dropped from the over-tall fallback (209)** | **SURVIVED** |

10/11 killed. The one survivor is discussed in the notes below: it is
**pre-existing** (I re-ran it against `985abb1`: also survives, 40/40), it is not
of the same shape as the two closed gaps, and it sits on a branch no real screen
reaches.

**9. The new harness does not pollute global state for later tests.** The harness
mutates genuinely global things (`process.stdout.write`, `process.stdin`,
`rows`/`columns` property descriptors, the `resize` listener list). I appended a
probe test at the end of a scratch copy of the file asserting each is back to its
load-time value: `process.stdout.write`, `process.stdin`, and both property
descriptors all restored exactly. The `resize` listener count drifts 0 → 2 — but
I measured the same drift **0 → 2 at the cycle-2 baseline**, i.e. it comes
entirely from the two pre-existing CON-6 `watch()`-driving tests, and the new
harness's park/remove-all/restore cycle is net-neutral. The three new tests add
zero leakage.

**10. Live behavior, in a real terminal, on my own fixture** (`tmux` pane, 100×40,
`node bin/concertino watch` against a scratch fixture root; sessions killed
afterwards — `tmux ls` confirms nothing of mine left behind):
- initial / steady / rows-only shrink 40→24 / regrow 24→40: 24, 24, 21, 24
  non-blank rows and **exactly one `▸` selection marker in every state** — no
  interleaved double-render, no blank frame, borders well formed, correct
  `… and 2 more` clipping.
- Headline goal, measured with `tmux pipe-pane` over 6 s of steady state on the
  same fixture and pane size: **baseline `aca8385` = 24,960 bytes; this branch =
  1,800 bytes** (~93% reduction; the residual is the elapsed-time fields that
  genuinely change every tick). The two rendered screens are identical modulo
  those elapsed-time strings.

**11. Acceptance criteria traced.** The ticket states its criteria as prose
("Desired behavior" + "Scope note"), not a numbered list:
- *"Diff the new frame against the previous one line by line, and only write the
  rows that actually changed"* → `lib/ui/watch.js:217-220`; proven by the
  always-write-row mutation being killed and by §10's byte measurement.
- *"positioning the cursor per-row via `\x1b[<row>;1H` rather than rewriting the
  whole frame"* → `rowAt()` at `lib/ui/watch.js:66` used at `:219`, `:196`,
  `:227`; the over-tall fallback is the only remaining `CURSOR_HOME` user, as the
  spec delta specifies.
- *"terminal-write cost close to free in the common case"* → §10, 24,960 → 1,800
  bytes.
- *"remain entirely confined to `lib/ui/watch.js`"* → §2.

**12. Iron Laws.** `verification-before-completion.md` read and applied — every
claim above is a command run in this session, and every mutation result was
produced twice in effect (once on each tree) rather than asserted.
`systematic-debugging.md`: this cycle is a coverage fix, and it meets that law's
bar — the executor's recorded diagnosis (task 3.9 tested `buildFrame`'s handling
of a hand-built sentinel array, never that the resize listener *produces* one;
task 2.3 had no test at all) is one I independently confirmed, and the added
tests are shown to fail against the exact regressions they guard rather than
passing without exercising the fixed path.

### Verdict: CONFIRM

The two change requests from `skeptic-final-1b.md` are closed, and closed for the
right reason: not "a test now exists", but "the specific regression now makes the
gate red, and each guard fails for its own distinct reason". I reproduced the
before/after on both trees myself, and I added a mutation of my own (M4) to check
that the third test earns its place — it does. The production code is
byte-identical to the commit two independent skeptics already found functionally
correct, the full gate is green four times over including under a real pty, and
the live dashboard renders cleanly across shrink/regrow with the ticket's headline
goal measurable at ~93% fewer steady-state bytes than `main`. Ships.

### Non-blocking notes

- **One surviving mutation, pre-existing and low value:** dropping
  `blankTrailingRows()` from the over-tall fallback (`lib/ui/watch.js:209`) passes
  the full gate. It is a real, non-equivalent mutant at unit level —
  `buildFrame('a\nb\nc', 5, 2, ['x','y','z','w','v'])` writes
  `\x1b[4;1H     \x1b[5;1H     ` with the line and nothing without it, and `main`'s
  writer always blanked that tail, so removing it would deviate from the spec's
  "exactly as every redraw did before this capability". But it survives at
  `985abb1` too, so the cycle-3 work did not introduce it; reaching it needs
  `prevLines.length > lines.length > rows`, and skeptic #1b already established no
  real screen reaches the over-tall branch at all (the fleet self-caps to the row
  budget). A one-line unit test using the call above would close it whenever
  someone is next in this file. Not worth another cycle.
- **A killed mutation in this area hangs the runner instead of failing fast.**
  Deleting the resize listener's `if (running) runs = draw();` fails two tests —
  the new resize test and the pre-existing `ticket-text.resolve runs once per
  draw()` test — and then `node --test` never exits, because that older test's
  `emit('end')`/`await donePromise` pair sits in `try` rather than `finally` and
  leaks a live poll loop. Same hazard the evaluator flagged for the two CON-6
  scroll tests. It does not affect this delivery (the gate is green and the
  failures are reported before the hang), but it means a future regression there
  surfaces as a CI timeout rather than a clean red. `withWatchHarness`'s
  `body(...).finally(cleanup)` is the fix and is now in the same file; folding
  those older tests onto it would retire it.
- Concur with the evaluator's `writesByRow` note: hoist `chunks.join('')` out of
  the `while` condition. Correct today only because `re.lastIndex` carries across
  identical rebuilt strings.
- Environmental housekeeping, unrelated to the change: four `probe-*` tmux
  sessions from earlier agents in this workflow are still running on the user's
  tmux server (`probe-c2-556963`, `probe-c2b-559371`, `probe-tty-238355`,
  `probe-tty2-239873`). I left them alone rather than killing sessions I did not
  create, but they should be cleaned up.
