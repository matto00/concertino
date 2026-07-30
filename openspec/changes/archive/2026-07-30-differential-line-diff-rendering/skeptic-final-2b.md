## Skeptic Report — final gate (round 2b)

Cold, independent review of `d1c7ae1` (branch `feature/differential-line-diff-rendering/CON-27`).
Every claim below is grounded in a command I ran myself in the worktree. I did not
read `skeptic-final-2.md`, `evaluation-3.md`'s numbers as fact, or the executor's
commit message as evidence — the commit message and the prior reports were treated
purely as hypotheses to attack.

Note: this project has no UI/design surface configured (no dev server, no design
standard doc), so gate step 4 (visual judgment) is N/A. The whole surface of this
change is a terminal-writer module and its tests.

---

### What I verified (with evidence)

#### 1. The delivered diff really is test-only on top of the reviewed commit

```
git rev-parse 985abb1:lib/ui/watch.js d1c7ae1:lib/ui/watch.js HEAD:lib/ui/watch.js
  -> 9621a6b9749078413d269adea81486af4d5bb5c7  (all three identical)
git hash-object lib/ui/watch.js  -> 9621a6b9...   (working tree matches too)
```

`git show --stat d1c7ae1` touches only `test/watch.test.js` and openspec docs. So the
production behaviour both round-1 skeptics independently found correct is *bit-for-bit*
the thing being shipped — the round-2 review surface is genuinely only the new tests.

Scope constraint from the ticket ("entirely confined to `lib/ui/watch.js`; router.js and
`screens/*` untouched") holds: `git diff --name-only main...HEAD | grep -v ^openspec/`
returns exactly `lib/ui/watch.js`, `test/watch.test.js`, `test/scripts/watch-smoke.test.sh`.

#### 2. Core gates, run by me, stable

- `npm test` (full gate, all 17 suites): **exit 0**, `tests 758 / pass 758 / fail 0`.
  Smoke suite included and green, with the CON-27 assertions firing:
  `ok no full-rewrite cursor-home (\x1b[H) in the session (q)`,
  `ok redraws position each written row individually (differential path)`,
  `ok no \x1b[2J anywhere in the session` (×4 exit paths).
- Stability: `node --test` run 3× back-to-back → exit 0, 758/758 each time. No flake,
  no order-dependence.
- Isolation: `node --test test/watch.test.js` alone → 43/43 pass. The new tests pass both
  in isolation and inside the full multi-file run.

#### 3. Mutation matrix — reproduced from scratch, not read

I wrote my own mutation harness (apply → run gate → restore → assert the file hash is
back to `9621a6b9`) and designed my own mutation list before reading anyone's numbers.
14 mutations against `lib/ui/watch.js`; gate = full `npm test` (or bounded `node --test`
where a mutant hangs).

| # | Mutation | Result at HEAD | Killed by |
|---|---|---|---|
| M1 | resize invalidation (`watch.js:827`) **deleted** | **KILLED** | rows-only-resize test |
| M2 | resize invalidation **weakened to `prevFrameLines = []`** | **KILLED** | rows-only-resize test |
| M3 | attach cache reset (`watch.js:920`) **deleted** | **KILLED** | *both* attach tests |
| M4 | attach reset weakened to the resize sentinel | SURVIVED — *equivalent mutant*, see notes | — |
| M5 | cursor-park write (`:227`) deleted | KILLED | 3 buildFrame tests |
| M6 | diff condition removed (always write every row) | KILLED | 3 buildFrame tests |
| M7 | `blankTrailingRows` loop made a no-op | KILLED | 3 tests incl. the new resize one |
| M8 | over-tall fallback disabled | KILLED | 2 buildFrame tests |
| M9 | CON-26 trailing-newline strip removed | KILLED | 3 tests incl. the *strengthened* one |
| M10 | `format.padTo` → raw `String.padEnd` | KILLED | visible-width padding test |
| M11 | `prevFrameLines = frame.lines` (`:771`) deleted | KILLED | the new resize test |
| M12 | resize listener's `draw()` deleted | KILLED | the new resize test |
| M13 | resize invalidation moved *after* the draw | KILLED | the new resize test |
| M14 | attach reset moved *outside* `attachAndRestore`'s finally | KILLED | throwing-attach test **only** |

**13/14 killed. The single survivor is provably behaviour-equivalent (M4 — see notes).**

##### 3a. The two round-1 change requests are genuinely closed, for genuinely different reasons

I read the actual assertion messages, not just the exit codes:

- **M1** (deleted) dies on `row 1 was not written by the resize redraw (frame 1..18, stale tail 19..29)`
  — i.e. the *unchanged-content rows were skipped*.
- **M2** (weakened to `[]`) dies on `row 19 was not written by the resize redraw (frame 1..18, stale tail 19..29)`
  — i.e. the *stale tail was not blanked*, because `[]` discards the length the shrink loop
  is driven by.

Different rows, different failure modes, in the same test. This is not one assertion
coincidentally catching both; part (a) of the test covers the repaint and the shrink tail
as one contiguous 1..preHeight range, and each mutation lands in a different part of it.

- **M3** (attach reset deleted) dies in *both* attach tests on
  `the post-attach redraw wrote nothing at all — the dashboard would be left blank`,
  which is exactly the live failure skeptic #1b demonstrated in tmux.

##### 3b. M14 — my own addition — proves the third new test is not redundant

I moved the attach reset out of the `attachAndRestore` restore callback to *after* the
call (so it still runs on the normal path but is skipped when attach throws). This is the
most plausible "looks fine, silently regresses" refactor of that line. It is killed by
**only** `the first redraw after an attach that THREW also repaints every row`. So the
third test is not a duplicate of the second — it independently pins the try/finally
placement the spec delta requires ("on both the normal return path and the throwing path").

##### 3c. The pre-fix baseline really was blind (skeptic #1b's claim independently confirmed)

I extracted `985abb1` into a clean scratch tree (`git archive 985abb1 | tar -x`) and re-ran
its own suite with each mutation applied:

```
985abb1 (unmutated)  exit=0  tests 755 / pass 755 / fail 0
985abb1 + M1         exit=0  tests 755 / pass 755 / fail 0   <- SURVIVED
985abb1 + M2         exit=0  tests 755 / pass 755 / fail 0   <- SURVIVED
985abb1 + M3         exit=0  tests 755 / pass 755 / fail 0   <- SURVIVED
```

So skeptic #1b's refusal was factually correct, and the three tests added in `d1c7ae1`
(+3 tests: 755 → 758) close exactly those holes and nothing was papered over.

#### 4. No new gap of the same shape introduced by the fix

The fix is test-only, so it cannot open a *production* coverage gap. I attacked the
tests themselves instead:

- Both new tests carry fixture-sanity guards that fail loudly rather than degrade to
  vacuous (`assert.ok(before.length > 0)`, `preHeight > 20`, `newHeight < preHeight`,
  `assert.ok(after.length > 0)`). A fixture drift that stopped exercising the shrink path
  would fail the test, not silently pass it.
- `writesByRow` is keyed on the `\x1b[<row>;1H` placement the writer emits; if the writer
  ever stopped emitting it, `before.length > 0` fails first. It cannot silently return `[]`.
- The resize test asserts the diff path is in use (`assert.doesNotMatch(..., /\x1b\[H/)`),
  so it cannot accidentally start asserting about the over-tall fallback instead.
- The harness's listener parking is *better* hygiene than the pre-existing CON-6 tests:
  it removes the watch-under-test's own resize listener at cleanup and restores only the
  parked ones. Confirmed no leakage empirically — 3 consecutive clean full runs.
- The `plainFrame` deletions are dead-local removals only; the strengthened CON-26 test
  is strictly additive (it keeps the old `second.bytes === ''` assertion and adds a length
  + `deepEqual`), and M9 confirms it now has teeth.

#### 5. Acceptance criteria traced

The ticket states desired behaviour rather than a numbered AC list; the operative
acceptance signal is this change's own spec delta
(`specs/dashboard-render-loop/spec.md`). All 16 scenarios trace to code and to a test
with demonstrated mutation teeth:

| Scenario | Code | Test / mutation evidence |
|---|---|---|
| No `\x1b[2J` steady-state / on shutdown | no `2J` anywhere in `watch.js`; `quit()` writes only `ALT_SCREEN_EXIT` (`:858`) | unit test + smoke `esc_count 2J == 0` on 4 exit paths |
| Changed row written, padded by visible cols | `:218-220`, `format.padTo` `:183` | M6, M10 |
| Coloured line padded by visible width | `format.padTo` `:183` | M10 |
| Unchanged row not rewritten; unchanged frame writes nothing; cursor unmoved | `:219` guard; `if (frame.bytes)` `:770` | M6 |
| Single changed row + last-row park only | `:227` | M5, M6 |
| Over-tall frame → full-rewrite fallback | `:207-211` | M8 |
| Cursor parked at last row after any writing tick | `:227` | M5 |
| Attach exits/re-enters alt buffer, incl. throwing path | `:893`, `:906-907`, `attachAndRestore` `:250` | `attachAndRestore` tests + both new attach tests |
| **First redraw after attach rewrites every row** | `:920` | **M3, M14** (new) |
| Resize triggers immediate redraw | `:828` | M12 |
| Shrinking terminal blanks the stale tail | `blankTrailingRows` `:193-199` | M7, M2 |
| **Rows-only resize → full rewrite** | `:827` | **M1, M2, M13** (new) |
| No phantom trailing row in cached lines | `:183` strip | M9 |

#### 6. Iron Laws

- **Verification-before-completion:** I re-ran the full gate myself rather than relying on
  a pasted PASS; every mutation result above is from a log I read.
- **Systematic debugging:** this cycle is a bug-*coverage* fix, not a behaviour fix. The
  root cause is stated concretely (the two wiring lines are unreachable from `buildFrame`'s
  pure tests; task 3.9 tested the wrong seam by hand-building a null-filled array instead
  of proving the resize listener produces one) and I confirmed the regression tests
  actually exercise the fixed path — M1/M2/M3/M13/M14 all die, and the same tests pass on
  unmutated code. That is the "a test that passes without exercising the fixed path proves
  nothing" bar, met by construction.

#### 7. Cleanliness

The worktree is exactly as I found it: `git status --short` shows only the pre-existing
` M workflow-state.md` and untracked `evaluation-3.md`; `lib/ui/watch.js` and
`test/watch.test.js` hash back to their HEAD blobs. All mutations were applied to a copy,
run, and restored under an asserted hash check. I modified no code.

---

### Verdict: CONFIRM

The two round-1 change requests are closed on the merits, not on assertion. I reproduced
the pre-fix blindness (M1/M2/M3 all survive 755/755 on `985abb1`) and the post-fix kills
(all three now die, each for its own distinct, correct reason). The broader implementation
is unchanged byte-for-byte from the commit both round-1 skeptics found functionally
correct, the full gate is green and stable across repeated runs, and an 14-mutation sweep
of the whole writer leaves only one survivor, which is behaviour-equivalent. This ships.

### Non-blocking notes

1. **M4 is an equivalent mutant, correctly left uncaught.** Replacing the attach reset's
   `prevFrameLines = []` with the resize sentinel `prevFrameLines.map(() => null)` survives
   the gate. That is right, not a gap: after `ALT_SCREEN_ENTER` the alternate buffer is
   cleared, so the sentinel version's only difference is emitting blank writes for rows
   `L_new+1..L_old` that are already blank (and `prevFrameLines` is always truncated to
   `≤ rows` on the overflow path, so those writes can never escape the terminal). Output is
   visually identical; `[]` is simply the cheaper spelling, and the comment at `:915-919`
   already explains the choice. Asserting `[]` specifically would be testing the
   implementation, not the behaviour. No action.

2. **Pre-existing (not introduced here) test-hygiene wart, surfaced by my M12 run.** When
   `ticket-text.resolve runs once per draw() while mode is drilldown`
   (`test/watch.test.js:686`, unchanged by this change and present at `985abb1`) fails its
   assertions, it leaks a live `watch()` poll loop, and `node --test` then hangs instead of
   exiting non-zero — I had to bound it with `timeout`. Harmless on green runs, but it makes
   future mutation/debug runs on this file slow and confusing. The *new* harness
   (`withWatchHarness`) does not have this problem — it tears down via `.finally(cleanup)`.
   Worth a small follow-up ticket to bring the older test up to the new harness's standard.

3. **Micro-robustness in `withWatchHarness`.** `donePromise = watchModule.watch(...)` is
   assigned outside the `try`; if `watch()` ever threw *synchronously* (it cannot today — it
   is `async`), `.finally(cleanup)` would never run and `process.stdout.write` would stay
   patched for the remainder of the file, poisoning every later test with a confusing
   failure. Wrapping the start in the same lifetime as `cleanup` would remove the
   footgun. Cosmetic; not worth a cycle on its own.
