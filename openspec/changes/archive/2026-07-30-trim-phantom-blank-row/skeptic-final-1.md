## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established**
- `git branch --show-current` → `bug/trim-phantom-blank-row/CON-26`; `git log --oneline main..HEAD` → single commit `a370860 CON-26 Trim phantom trailing blank row in dashboard's per-poll redraw`.
- `git diff main...HEAD` read in full. Code change is exactly one line, `lib/ui/watch.js:112`:
  `const lines = text.replace(/\n$/, '').split('\n').map((line) => format.padTo(line, cols));`
  plus one new test block at `test/watch.test.js:85-108`. All other diff hunks are planning artifacts under `openspec/changes/trim-phantom-blank-row/`.

**AC-by-AC trace (ticket.md:13-15)**
- **AC1 — no phantom row counted or written.** Traced to `lib/ui/watch.js:112`. `buildFrame` derives both the written rows (`bytes = CURSOR_HOME + lines.join('\n')`, line 113) and the returned `lineCount` (line 128) from the same `lines` array, so stripping the trailing `'\n'` removes the phantom from both. Verified the underlying string behavior directly:
  ```
  PRE-FIX  split length: 3 ["content line 1","content line 2",""]
  POST-FIX split length: 2 ["content line 1","content line 2"]
  ```
  Also confirmed the fix is a real off-by-one repair, not just cosmetic: `draw()` computes `screenRows = totalRows - bannerLines` (`watch.js:506`) and builds `rendered = banner + screenText + '\n'` (`watch.js:538`), so pre-fix the frame was `totalRows + 1` lines — one row taller than the terminal. Post-fix it is exactly `totalRows`. **MET.**
- **AC2 — self-contained to `lib/ui/watch.js`.** `git diff --name-only main...HEAD` shows only `lib/ui/watch.js`, `test/watch.test.js`, and change-dir artifacts. No `lib/ui/router.js`, no `lib/ui/screens/*`. **MET.**
- **AC3 — regression coverage in `test/watch.test.js`.** Test at `test/watch.test.js:91-108` uses a `router.render()`-shaped input `'content line 1\ncontent line 2\n'` and asserts both `frame.lineCount === 2` and written-bytes split length `=== 2`. I confirmed it is a genuine regression test rather than a tautology: the pre-fix expression `text.split('\n')` yields 3 elements (evidence above), so removing the `.replace()` makes both assertions fail. **MET.**

**Iron Law: verification-before-completion (`core/laws/verification-before-completion.md`)**
- Gate per `concertino.config.json → gates` is `npm test` (`when: always`). Re-run fresh by me, twice, both green:
  ```
  74 passed, 0 failed ... 22 passed, 0 failed  (16 suites)
  OVERALL_EXIT=0
  ```
- Targeted re-run: `node --test test/watch.test.js` →
  `✔ buildFrame does not write a phantom trailing blank row for a trailing-newline-terminated input (0.106419ms)`, exit 0.
- `npx openspec validate --changes trim-phantom-blank-row` → `✓ change/trim-phantom-blank-row`, `Totals: 1 passed, 0 failed`.

**Regression safety / edge cases (probed directly, not assumed)**
- `'a\n\n'` → `["a",""]` — a *genuine* trailing blank line is correctly preserved (only one newline stripped, per design.md's stated decision).
- `''` → `[""]`, `'a\nb'` → `["a","b"]` — empty and non-newline-terminated inputs behave as before. No shrink-cleanup regression: `prevLineCount` and `lineCount` remain the same unit (`watch.js:122-128, 226-229, 546`).
- Existing `dashboard-render-loop` capability spec (`openspec/specs/dashboard-render-loop/spec.md:18-51`) contains no requirement that the old phantom row satisfied, so the delta being `## ADDED Requirements` is correct — no MODIFIED/REMOVED delta is owed.
- Style check: new line is 92 chars; `lib/ui/watch.js` already has many lines in the 92-123 range, so it is in-pattern. Not an issue.

**UI / design judgment**
- N/A and independently confirmed, not taken on faith: `concertino.config.json:40-43` → `"ui": { "enabled": false, "tool": "none" }`. No dev server started, no screenshots — correctly out of scope for this project.

### Verdict: REFUTE

The functional change is correct, minimal, in scope, and properly tested — I found no defect in the shipped behavior. What blocks it is that the change leaves this file's own documentation asserting the behavior the ticket just removed. In `lib/ui/watch.js` the comments are the design record (they cite `design.md` Decisions by number, and tests grep for comment-documented guarantees), so a header comment that contradicts the line directly beneath it is a real defect here, not a nit. The evaluator explicitly cleared this checklist item — `evaluation-1.md:79-81`, "No dead code — No unused imports or abandoned comments" — which is factually wrong. Both fixes below are one small edit each, in files already in the ticket's scope.

### Change Requests

1. **`lib/ui/watch.js:100-104` — `buildFrame()`'s header comment now states the opposite of what the code does.** The comment reads:
   ```
   // the terminal shows neither frame. `text` is exactly what draw() is about
   // to write, INCLUDING its own trailing '\n' — so the line count this
   // function pads from and the line count it returns can never disagree about
   // whether that trailing newline contributes an extra line (design.md
   // Decision 2).
   ```
   After line 112, `text` is *no longer* what `draw()` writes, and the trailing `'\n'` is now explicitly *excluded* rather than "INCLUDED". A maintainer reading this would conclude the trailing newline is still written as a row and could reintroduce the phantom. Rewrite the clause to state the post-CON-26 invariant: `buildFrame` strips exactly one trailing `'\n'` before splitting, so the trailing newline never contributes a row to either the padded output or the returned `lineCount` (CON-17 design.md Decision 2's "one count, not two that could disagree" guarantee is preserved — say that, rather than the stale premise). Keep the surrounding CON-17 text (no-full-screen-clear, `padTo` reuse) intact.

2. **`test/watch.test.js` — no test pins design.md's "strip *exactly one*" decision.** design.md states the decision as "Strip exactly one trailing `'\n'`", but the only new assertion covers the single-trailing-newline case. Widening the strip to `.replace(/\n+$/, '')` or `.trimEnd()` would silently eat a *genuine* trailing blank content line (and, for `trimEnd()`, the last line's width padding) with the whole suite still green. Add one assertion — e.g. `buildFrame('a\n\n', 5, 0)` must yield `lineCount === 2` (the real blank content line survives; only the `draw()`-appended newline is removed) — so the stated decision is actually enforced.

### Non-blocking notes

- The new test asserts `lines.length === 2` but not that the surviving lines are still padded to `cols`. The pre-existing padding tests (`test/watch.test.js:30-35, 44-59`) cover padding generally, so this is only a completeness observation, not a gap I'd block on.
- `openspec validate` accepts `--changes` (plural) on this version; the `validateCmd` in `concertino.config.json:19` is written as `--change` (singular), which errors with `unknown option '--change'`. Pre-existing config drift, entirely outside this ticket — flagging only so it is not mistaken for something this change introduced.
