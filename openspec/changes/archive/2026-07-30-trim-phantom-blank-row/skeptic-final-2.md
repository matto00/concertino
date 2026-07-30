## Skeptic Report — final gate (round 2)

Spawned cold. Every conclusion below is derived from files/commands I ran myself in
this worktree; `evaluation-1.md` and `skeptic-final-1.md` were read only as claims to
check, and `evaluation-1.md` is in fact stale (it describes a one-test, pre-amendment
state of `test/watch.test.js` that no longer matches HEAD — see "Notes on prior
reports" below).

### What I verified (with evidence)

**Ground truth**
- `git log -1` → single commit on the branch: `5e5b2cd CON-26 Trim phantom trailing
  blank row in dashboard's per-poll redraw` (2026-07-30 01:48 -0700 — amended, as
  round 1's report cited `a370860`).
- `git diff main...HEAD` read in full. Code surface is exactly two files:
  - `lib/ui/watch.js` — 9 insertions / 9 deletions: one behavioural line (112) plus
    a rewritten `buildFrame()` header comment block (lines 99-106).
  - `test/watch.test.js` — 44 insertions, **0 deletions** (verified via `--stat`:
    `44 ++++...`), so no pre-existing assertion was weakened or removed to make the
    new behaviour pass.
  - Everything else in the diff is `openspec/changes/trim-phantom-blank-row/*`.
- `git status --porcelain -- lib test scripts core adapters bin` → empty. No
  uncommitted code hiding outside the commit.

**AC-by-AC trace (`ticket.md:13-15`)**

- **AC1 — `draw()`/`buildFrame()` do not count or write the trailing empty row.**
  Traced to `lib/ui/watch.js:112`:
  ```js
  const lines = text.replace(/\n$/, '').split('\n').map((line) => format.padTo(line, cols));
  ```
  Both outputs of the function derive from that one `lines` array — `bytes =
  CURSOR_HOME + lines.join('\n')` (line 113) and `lineCount: lines.length` (line 128)
  — so the phantom is removed from the written rows *and* the count, in one unit.
  I proved this is a real behavioural repair rather than a no-op by reverting the
  `.replace()` in a throwaway copy of the tree (scratchpad, never this worktree) and
  re-running the suite: both new tests go red (see "red-before-green" below).
  Independently confirmed the frame-height arithmetic it fixes: `draw()` computes
  `screenRows = totalRows - bannerLines` (`watch.js:504-506`) and builds
  `rendered = banner + '\n' + screenText + '\n'` (`watch.js:538`), so pre-fix a
  full-height frame was `totalRows + 1` rows — one taller than the alt-screen buffer.
  Post-fix it is exactly `totalRows`. **MET.**

- **AC2 — self-contained to `lib/ui/watch.js`.** `git diff --name-only main...HEAD`
  lists no `lib/ui/router.js` and no `lib/ui/screens/*`. Also checked there is no
  second synced copy of this file that would need the same edit:
  `find . -name watch.js -not -path ./.git/*` → exactly one result,
  `./lib/ui/watch.js`. **MET.**

- **AC3 — `test/watch.test.js` asserts the row count for a `router.render()`-shaped
  input.** Two tests at `test/watch.test.js:91-108` and `:110-127`. The first feeds
  `'content line 1\ncontent line 2\n'` and asserts both `frame.lineCount === 2` and
  that the written bytes split into exactly 2 lines. **MET.**

**Round-1 change request #1 (stale header comment) — fixed, and the fix is correct.**
Read `lib/ui/watch.js:96-109` fresh. It now reads "`buildFrame` strips exactly one
trailing `'\n'` before splitting into lines (CON-26), so `draw()`'s appended newline
never contributes an extra row — the line count this function pads from and the line
count it returns remain in one-to-one correspondence with actual rendered content
(design.md Decision 2)." That is a true description of line 112. I also checked the
`design.md Decision 2` citation it preserves is still apt rather than cargo-culted:
`openspec/changes/archive/2026-07-29-fix-dashboard-render-flicker/design.md:89-102`
requires the count be "the same split-on-`\n` array used for padding ... not a
separate count that could disagree on whether the trailing `'\n'` `draw()` appends
... contributes an extra line". That invariant still holds post-fix; the citation is
accurate. And the *other* comment that carries the same premise — `watch.js:226-228`
("in the same units buildFrame() both pads from and returns") — was correctly left
alone, because it is still true.

**Round-1 change request #2 (test didn't pin "strip exactly one") — fixed, and I
verified the pin actually bites.** Rather than take the new test's wording on faith, I
copied the tree to the scratchpad and ran `node --test test/watch.test.js` against
three mutants of line 112:

| line 112 variant | result |
| --- | --- |
| `text.split(...)` (fix reverted) | `tests 31 / pass 29 / fail 2` — **both** new tests fail |
| `text.replace(/\n+$/, '').split(...)` (loosened) | `tests 31 / pass 30 / fail 1` — "strips exactly one trailing newline" fails |
| `text.trimEnd().split(...)` (loosened) | `tests 31 / pass 30 / fail 1` — "strips exactly one trailing newline" fails |
| shipped `text.replace(/\n$/, '')` | `tests 31 / pass 31 / fail 0` |

So the regression tests exercise the fixed path (red before green) and the new second
test genuinely discriminates "eat one synthetic newline" from "eat a genuine trailing
blank content line". Round 1's exact escape hatch is closed. As a bonus it also
addresses round 1's non-blocking note: it asserts the surviving lines are still padded
(`'content   '`, `'          '` at `test/watch.test.js:124-126`).

**Iron Law: verification-before-completion (`core/laws/verification-before-completion.md`)**
- Gate per `concertino.config.json → gates`: `test` / `when: always` / `npm test`.
- **Measurement instability handled, not concluded from.** My first `npm test` run
  (piped to `tail`, no stdin redirect) hung and was killed at the 5-minute tool
  timeout. Per the reproduce-before-refute rule I did not treat that as a failure: I
  timed all 15 shell suites individually (all `rc=0`, ~53s total) plus
  `node --test` (`tests 686 / pass 686 / fail 0`, exit 0) and
  `test/scripts/watch-smoke.test.sh` (`54 passed, 0 failed`, 1.2s), then re-ran the
  real gate with stdin redirected:
  ```
  $ npm test > npmtest.log 2>&1 < /dev/null
  EXIT=0 in 56s
  ...
  22 passed, 0 failed
  ```
  The first reading was a harness artifact (a suite reading the inherited stdin), not
  a product defect. Gate is green.
- Both new tests are present in that fresh gate log:
  ```
  ✔ buildFrame does not write a phantom trailing blank row for a trailing-newline-terminated input (0.109787ms)
  ✔ buildFrame strips exactly one trailing newline, preserving genuine blank content lines (0.144422ms)
  ```
- `npx openspec validate --changes` → `✓ change/trim-phantom-blank-row`,
  `Totals: 1 passed, 0 failed`, exit 0.

**Root cause + regression coverage (systematic-debugging expectations for a bug fix)**
The root cause is probe-confirmed and recorded, not guessed: `design.md` states it
concretely (`"a\nb\n".split('\n')` is `["a","b",""]` — a `String.split` artifact, not
a content line), and I reproduced the mechanism directly via the mutant runs above.
The regression test fails without the fix, so it demonstrably exercises the fixed path.

**Regression-safety edges I probed rather than assumed**
- Shrink cleanup (`watch.js:122-127`) is unaffected: `prevLineCount` and the returned
  `lineCount` are still the same unit (`lastFrameLines = frame.lineCount`,
  `watch.js:546`), both now one smaller in lockstep, so the blank-out loop still
  covers exactly the rows the shorter frame left stale. The row the old phantom used
  to blank is now covered by that loop instead. Confirmed by the two pre-existing
  shrink/grow tests still passing untouched.
- Degenerate inputs: `''` → 1 line (unchanged), `'a\nb'` (no trailing newline) → 2
  lines (unchanged), `'\n'` → 1 line. No path produces a negative or NaN count.
- No screen module smuggles in its own trailing newline that would defeat the fix:
  every `lib/ui/screens/*.js` render path ends in `.join('\n')` (checked all six), so
  `rendered` ends in exactly one `'\n'`.

**UI / design judgment — genuinely N/A, verified not assumed**
`concertino.config.json:40-43` → `"ui": { "enabled": false, "tool": "none" }`. No
design standard is configured for this project and there is no web UI to screenshot.
The change's only visual surface is the terminal frame, which I evaluated the only way
it can be evaluated here — the byte-level frame contents and the row arithmetic above.
No dev/backend server started; starting one would have proved nothing about this
change.

**Notes on prior reports (treated as claims, and one is wrong)**
`evaluation-1.md` is stale relative to HEAD: it describes the test addition as "lines
85-108" and a single test, and its Phase-2 line "No dead code — No unused imports or
abandoned comments" cleared the very stale comment round 1 refuted on. It also reports
"30 watch.test.js tests" where the file now has 31. None of this changes my verdict —
I verified HEAD directly — but the evaluator's PASS should not be read as covering the
round-2 amendments, because it predates them.

### Verdict: CONFIRM

The behavioural change is one line, correct, in scope, and now backed by two tests
that both go red without it, one of which specifically enforces `design.md`'s "strip
exactly one" decision against the two obvious loosenings. The file's own documentation
— which in `lib/ui/watch.js` functions as the design record — now matches the code.
Both round-1 change requests are genuinely resolved, not papered over. Full gate green
on a reproduced run. Ships.

### Non-blocking notes

- `lib/ui/router.js:36`'s unknown-screen fallback returns a newline-terminated string
  (`'concertino: unknown screen "..."\n'`), so on that path `rendered` ends in `'\n\n'`
  and one blank row survives the strip. That is an internal-invariant-violation error
  path (`state.mode` is set only by `watch.js` itself) and AC2 explicitly forbids
  touching `router.js` in this ticket. Flagging only so it is not mistaken for a hole
  in the fix.
- `test/watch.test.js:112-113`'s decomposition comment (`"content\n" (real line) + ""
  (real blank line) + "\n" (synthetic from draw())`) concatenates correctly but reads
  awkwardly. Purely a wording nit; the assertions themselves are unambiguous.
- Pre-existing config drift, unrelated to this ticket and inherited from round 1's
  note: `concertino.config.json:19`'s `validateCmd` uses `--change` (singular), which
  this `openspec` version rejects with `unknown option '--change' (Did you mean
  --changes?)`. I re-confirmed both spellings today. Worth its own ticket.
- The `npm test` stdin sensitivity described above (hangs when run with inherited
  stdin under an agent harness) is a real papercut for every automated gate run in
  this repo, not something CON-26 introduced. Also worth its own ticket.
