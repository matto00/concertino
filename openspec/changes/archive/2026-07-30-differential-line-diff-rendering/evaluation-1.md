## Evaluation Report — Cycle 1

Reviewed commit `6a473c3` on `feature/differential-line-diff-rendering/CON-27`.
Gates re-run independently by the evaluator in a throwaway clean worktree
(`CLEAN_WORKTREE=true`), detached at `6a473c3`, removed afterward.

### Phase 1: Spec Review — FAIL

Issues:

1. **BLOCKING — regression against a spec requirement that landed on `main` after
   this branch was cut (CON-26, "A trailing newline in the rendered text does not
   produce an extra written row").**
   The branch's merge-base with `main` is `ce598fa`; `main` is now `aca8385`. Three
   commits touching exactly this code have landed in between:
   - `6ac7a1b` CON-26 — added `text.replace(/\n$/, '')` inside `buildFrame` **and a
     new requirement to `openspec/specs/dashboard-render-loop/spec.md`**
   - `7ea12b4` CON-6 — fleet-view scrolling (`lib/ui/screens/fleet.js`)
   - `aca8385` CON-19 — evidence reader (`lib/ui/screens/docview.js`, `watch.js`)

   Together they change `lib/ui/watch.js` by +234 lines and `test/watch.test.js` by
   +274 lines relative to this branch's base. This change's new `buildFrame`
   (`lib/ui/watch.js:150-151`) reintroduces the un-stripped
   `text.split('\n')`, so the phantom trailing blank row CON-26 removed is back.

   Verified live, not inferred — the branch's own `bin/concertino watch` run under a
   real pty at 24x100 (fleet view, 0 runs) emits:
   ```
   ...\x1b[4;1H<footer>...  \x1b[5;1H<100 spaces>  \x1b[5;1H<100 spaces>
   ```
   Row 5 is the phantom blank row, written once by the diff loop and once more by
   Decision 8's cursor-park write — i.e. the cursor now also comes to rest on a
   blank row rather than on the footer.

2. **Non-blocking (Phase 1):** the ticket's acceptance behavior itself is fully and
   correctly addressed — see below. Every AC in `ticket.md` is met by the code as
   written against its (stale) base:
   - only changed rows are written, per-row `\x1b[<row>;1H` — yes
   - previous frame tracked as content, not a count — yes (`prevFrameLines`)
   - change confined to `lib/ui/watch.js` — verified: `git diff --name-only` touches
     only `lib/ui/watch.js`, `test/watch.test.js`,
     `test/scripts/watch-smoke.test.sh`, and the change dir. `router.js` and
     `screens/*` untouched, as the scope note requires.
   - all 27 tasks in `tasks.md` are marked done and each one is genuinely
     implemented as specified (spot-checked 1.3/1.4/1.5/1.7/2.2/2.3/2.4 against the
     code; task 2.5 confirmed — no `lastFrameLines` or `{ lineCount }` remains in
     `lib/ui/watch.js`).
   - the spec delta
     (`changes/.../specs/dashboard-render-loop/spec.md`) correctly restates the three
     MODIFIED requirements in full and matches the implemented behavior.
   - no scope creep. The one out-of-ticket edit (`watch-smoke.test.sh`) is a genuine
     gate repair, reviewed and verified below.

### Phase 2: Code Review — FAIL

**Gate run (evaluator's own, clean worktree detached at `6a473c3`):**
- `npm test` → **exit 0**, all suites green, including `node --test`,
  `test/scripts/watch-smoke.test.sh` (56 passed, 0 failed) and every other shell
  gate. No dependency/env population was needed (the repo's gates need no
  `node_modules`). Throwaway worktree removed afterward; `git worktree list` is
  clean of it.

Issues:

1. **BLOCKING — merging this branch into current `main` silently produces a runtime
   `ReferenceError` on every redraw.**
   `main` refactored `draw()`: `const totalRows = process.stdout.rows || 0;` no
   longer exists there — it now lives inside a new `computeScreenRows()` helper
   (main's `watch.js:588`), and `draw()` calls `const screenRows =
   computeScreenRows();`. This branch's `draw()` call site
   (`lib/ui/watch.js:626`) is `buildFrame(rendered, cols, totalRows, prevFrameLines)`.
   A dry-run merge (`git merge-tree --write-tree main HEAD`, non-destructive)
   conflicts only inside `buildFrame`'s body/comment (merged file lines 119-195) and
   **auto-merges the `draw()` hunk without a conflict marker**, leaving:
   ```
   774:    const frame = buildFrame(rendered, cols, totalRows, prevFrameLines);
   ```
   with `totalRows` no longer in scope — a crash on the first draw, and one a human
   resolving only the marked conflict would not see.

2. **BLOCKING — `buildFrame` must keep CON-26's trailing-newline strip.** See Phase 1
   issue 1. `lib/ui/watch.js:151` is `text.split('\n')`; it must be
   `text.replace(/\n$/, '').split('\n')`. The new header comment
   (`lib/ui/watch.js:~131-137`) also reasserts the pre-CON-26 rationale ("`text` is
   exactly what draw() is about to write, INCLUDING its own trailing '\n'"), which is
   now factually wrong and would re-land a comment CON-26 deliberately rewrote.

3. **BLOCKING — `test/watch.test.js` will auto-merge into a broken state.** `main`
   added two CON-26 regression tests
   (`buildFrame does not write a phantom trailing blank row...`,
   `buildFrame strips exactly one trailing newline...`) that call the 3-arg
   `buildFrame(text, cols, 0)` and assert `frame.lineCount`. `git merge-tree` reports
   `test/watch.test.js` as auto-merging cleanly, so both would land unchanged against
   the new 4-arg / `{ bytes, lines }` contract and fail (or, worse, be "fixed" by
   deleting the coverage).

**Everything else in Phase 2 passes**, and the code as written against its own base
is good:

- **Diff logic correct.** `lines[i] !== prev[i]` handles changed / new (`undefined`)
  / sentinel (`null`) uniformly; the shrink loop is unchanged in shape and factored
  into one `blankTrailingRows()` helper reused by both writer modes (DRY);
  `overflow = rows > 0 && lines.length > rows` is the single fallback condition the
  design mandates, and `rows === 0` provably never reaches it.
- **Ordering of the three writes** (diff loop → shrink blanking → cursor park) matches
  Decision 8's load-bearing requirement, and the park write is correctly guarded on
  `if (bytes)` so an unchanged tick still writes literally nothing.
- **Boundary case** `lines.length === rows` correctly stays on the diff path, and is
  covered by the truncated-tail test.
- **Overflow cache truncation** returns `lines.slice(Math.max(0, lines.length - rows))`,
  restoring the `prevLines.length <= rows` invariant so a later in-bounds frame
  resumes trustworthy diffing — exactly as Decision 6 requires.
- **Attach/resize invalidation** are both present, in the right places, with the
  right mechanism (`[]` vs. length-preserving `map(() => null)`) and comments that
  explain why the two differ.
- **No dead code, no TODO/FIXME, no untyped escape hatch, no security surface**
  (pure string function, no new input boundary). Comments carry real rationale and
  the ones the design flagged as going stale were all rewritten.
- **Tests are meaningful and would catch real regressions** — the new cases assert
  exact byte sequences, not just "contains", and the growth test's inverted
  assertion is a deliberate semantic rewrite as tasks.md required.
- **Behavior in a real terminal verified independently** (beyond the unit tests, all
  of which run at `rows = 0`):
  - 24x100 pty, fleet view: first frame writes each row via its own
    `\x1b[<row>;1H`, zero `\x1b[H`, zero `\x1b[2J`, and **subsequent unchanged ticks
    write nothing at all** — the ticket's headline goal, observed end to end.
  - 4-row pty (deliberately over-tall frame): 4x `\x1b[H`, **zero** absolute row
    placements, newline flow — the Decision 6 fallback fires and behaves.
  - The design's premise that `fleet.js` deliberately overflows still holds on
    current `main` after CON-6 (`fleet.js:357`, "NEEDS YOU is never trimmed"), so the
    fallback's rationale survives the rebase.

**Verification of the executor's `watch-smoke.test.sh` fix — sound, and it has
teeth.** I re-derived it independently rather than trusting the handoff. Replaying
the CON-35 P-reorder scenario against this branch's `bin/concertino`:

```
with-P   : raw-newlines=0 | rows_of: CON41=37 CON42=36 | old mechanism: CON41=1 CON42=1
           fixed check => PASS      old check => FAIL
without-P: raw-newlines=0 | rows_of: CON41=32 CON42=33 | old mechanism: CON41=1 CON42=1
           fixed check => FAIL      old check => FAIL
```

This confirms all three claims: the captured session genuinely contains zero
newlines under the new writer; the old `grep -n` mechanism was vacuously broken
(both rows report line 1, so `1 < 1` can never hold — the check could not have
passed for any product behavior); and the repaired check passes only when `P` is
actually pressed. `rows_of` is scoped correctly — only the two ordering greps read
through it, while `grep -q` content checks and `esc_count` still read `$OUT`
directly, which is right.

### Phase 3: UI Review — N/A

No UI review is configured for this project, so no dev servers were started and no
browser flows were exercised. (The terminal-rendering behavior that would otherwise
be "the UI" here was still verified objectively under a real pty — see Phase 2.)

### Overall: FAIL

Single root cause: the branch is based on `ce598fa` and never picked up the three
commits that have since landed on `main` in exactly this file. The CON-27 work
itself is well-executed and, apart from the CON-26 interaction, needs no design or
logic changes.

### Change Requests

1. **Bring the branch up to current `main` (`aca8385`) and re-verify.** Merge or
   rebase `main` into `feature/differential-line-diff-rendering/CON-27`. The
   conflict is real (`lib/ui/watch.js`, the whole `buildFrame` body/comment block);
   do not resolve it by taking either side wholesale — items 2-4 below are the
   specific reconciliations.

2. **`lib/ui/watch.js:151` — restore CON-26's trailing-newline strip inside the new
   `buildFrame`:**
   ```js
   const lines = text.replace(/\n$/, '').split('\n').map((line) => format.padTo(line, cols));
   ```
   and rewrite the header comment sentence at `lib/ui/watch.js:~131-137` that
   currently says "`text` is exactly what draw() is about to write, INCLUDING its
   own trailing '\n'" to state CON-26's behavior instead (`buildFrame` strips exactly
   one trailing '\n' before splitting, so `draw()`'s appended newline never
   contributes a row). Without this, `openspec/specs/dashboard-render-loop/spec.md`'s
   "A trailing newline in the rendered text does not produce an extra written row"
   requirement is violated, and the cursor-park write parks on a blank row.

3. **`lib/ui/watch.js:626` (post-merge `draw()`) — stop referencing a `totalRows`
   that no longer exists there.** `main` extracted `computeScreenRows()`; after the
   merge, `draw()` has only `screenRows`. Read the whole terminal height explicitly
   at the call site — e.g. `const totalRows = process.stdout.rows || 0;` immediately
   before the `buildFrame` call — or have `computeScreenRows()` return both values.
   It must remain the WHOLE terminal height, not `screenRows`, per Decision 6.
   Verify by actually running the merged code (this hunk auto-merges without a
   conflict marker, so a clean `git status` after the merge proves nothing).

4. **`test/watch.test.js` — port `main`'s two CON-26 regression tests to the new
   contract.** They are `buildFrame does not write a phantom trailing blank row for a
   trailing-newline-terminated input` and `buildFrame strips exactly one trailing
   newline, preserving genuine blank content lines` (main's `test/watch.test.js:86-120+`).
   Both call `buildFrame(text, cols, 0)` and assert `frame.lineCount`; convert them to
   `buildFrame(text, cols, 0, [])` asserting `frame.lines.length` and the absence of a
   trailing all-blank row in `frame.bytes`. Do not drop this coverage — it is the only
   guard on the behavior in change request 2. Also re-check `main`'s other new
   `watch.test.js` cases (CON-6 / CON-19 added ~274 lines) for any that touch
   `buildFrame`'s contract.

5. **Re-run the full gate (`npm test`) on the merged result**, and re-run the
   `watch-smoke.test.sh` suite specifically — `main`'s fleet/docview changes render
   different frames, and the new `rows_of`-based ordering check and the two new
   escape-sequence assertions should be confirmed still valid against them.

### Non-blocking Suggestions

- `lib/ui/watch.js` builds the row-placement sequence `'\x1b[' + n + ';1H'` inline in
  three places (the shrink loop, the diff loop, the park write). The file's own
  header comment argues for naming terminal-control sequences rather than inlining
  them; a tiny local `const at = (row) => '\x1b[' + row + ';1H';` (which
  `test/watch.test.js` already defines for itself) would match that convention and
  make the three sites obviously identical. Purely cosmetic.
- `test/scripts/watch-smoke.test.sh:28` — `rows_of` uses GNU-sed-only syntax (`\x1b`
  in the pattern, `\n` in the replacement); on BSD/macOS sed it would silently
  produce garbage rather than fail loudly. The repo already assumes GNU userland
  elsewhere (`test/scripts/resolve-speed.test.sh:149` uses `sed -i` with no backup
  suffix), so this is consistent with existing practice — noting it only so the
  assumption is a known one.
- No test covers `buildFrame` being called with `prevLines` omitted/`undefined`
  (the `prevLines || []` guard at `lib/ui/watch.js:152`). One line, if you want the
  guard to be load-bearing rather than defensive-only.
- `openspec/changes/differential-line-diff-rendering/workflow-state.md` is modified
  but uncommitted in the worktree (orchestrator-owned file; flagged only so it is
  not mistaken for stray executor state).
