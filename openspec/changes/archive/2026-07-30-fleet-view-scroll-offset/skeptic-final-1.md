## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff**: `git diff main...HEAD --stat` (commit `33db0d7`) —
  `lib/ui/screens/fleet.js` (+330/-92), `lib/ui/watch.js` (+67/-9), plus
  `test/fleet.test.js` (+193) and `test/watch.test.js` (+230, new file
  content). Read both source files' diffs in full and the corresponding
  test diffs in full — not summarized from `files-modified.md`.

- **Gates re-run fresh, myself** (not trusted from evaluation-1.md):
  `npm test` → exit 0, all suites pass (bash-script suites + `node --test`).
  `node --test test/fleet.test.js test/watch.test.js` → 115/115 pass,
  including all 6 new CON-6 tests (marker alignment at every reachable
  scroll offset, byte-for-byte parity at `scrollOffset: 0`, the regression
  test for the NEEDS-YOU-pollutes-visible-range bug, NEEDS YOU always full,
  `visibleWindow` boundary values, the protection-rule combined
  scroll+height-budget test, small-terminal-plus-scroll, and both
  `watch.js`-level real-keypress tests).

- **Acceptance criteria traced to code, one by one** (`ticket.md`):
  1. "Moving selection past the last rendered row scrolls the view" →
     `lib/ui/watch.js`'s `move` handler (lines ~766-786) calls
     `fleetScreen.visibleWindow` with the candidate `scrollOffset` and
     adjusts it by exactly the overshoot when `selected` lands outside
     `[firstVisibleIndex, lastVisibleIndex]`. Exercised end-to-end by
     `test/watch.test.js`'s real-keypress "repeated j" test (6 `j` presses
     scroll HEL-200/201 fully out of view, marker lands correctly on
     HEL-206).
  2. "NEEDS YOU stays pinned and visible regardless of scroll position" →
     `visibleWindow`'s per-section walk in `fleet.js` sets `shown = groupLen`
     unconditionally for `s.pinned` sections and never subtracts from
     `remaining` (the scroll-skip budget) for them; also explicitly excluded
     from `firstVisibleIndex`/`lastVisibleIndex`. Verified via
     `test/fleet.test.js`'s "NEEDS YOU renders in full at every scroll
     offset" test and my own fuzz (below).
  3. "Selection index and marker remain in agreement at every scroll
     offset — extend the existing test" → the existing marker-alignment
     test was extended exactly as instructed
     (`test/fleet.test.js:"the selection marker points at the correct run
     for every reachable scroll offset"`), and I independently fuzzed this
     property (see below) across 9 `runs` shapes × up to 8 `rows` values ×
     every reachable `scrollOffset` × every `selected` index (18,529 cases,
     plus 5,560 more with a non-empty QUEUED section): **zero cases** of
     more than one `▸` marker or a marker on the wrong row.
  4. "Sane at very small terminal heights" → `visibleWindow`'s existing
     `pinned`-skip-in-trim-loop is unchanged; my fuzz confirms the only
     "output exceeds the row budget" cases are ones where `NEEDS YOU` +
     header/footer alone already exceed the budget — and I confirmed
     against `main`'s own `fleet.js` (via `git show main:...`) that this
     exact degraded case (`rows: 6`, 1 NEEDS YOU run → 7 lines vs budget 5)
     is **pre-existing, unchanged behavior**, not a regression, matching
     design.md Decision 4's explicit statement that this is accepted.

- **Design.md Decision 3 (selected-row protection rule) — the specific risk
  called out in this task** — verified two ways:
  1. Read the implementation (`fleet.js`'s height-budget trim loop,
     `containsSelected`/`distFromHead`/`distFromTail` logic) against the
     decision's prose; it matches: trims from whichever edge is farther from
     `selected`, ties go to trimming the tail, and a section not containing
     `selected` is still trimmed tail-first as before.
  2. **Reverted the fix and confirmed the regression test actually catches
     it** — reverted the `firstVisibleIndex`/`lastVisibleIndex` computation
     to include pinned sections (simulating the pre-fix bug
     `files-modified.md` describes as found during manual verification) and
     reran `test/fleet.test.js`: the regression test failed exactly as
     expected (`RUNNING (index 1) is scrolled entirely past — firstVisibleIndex
     must be greater than it, got 0`), confirming this is a real,
     probe-confirmed root cause with a test that actually exercises the
     fixed path, not a vacuous assertion. Restored the file afterward
     (verified `git diff --stat` on the file was empty and both test files
     pass again at 115/115).

- **Purity preserved**: grepped `fleet.js` for module-level mutable state —
  every `let` is a local inside `visibleWindow`/`renderFleet`; no new
  module-level state was introduced. `render(state, opts)` only reads
  `state.scrollOffset` (mirroring `state.selected`), matching the ticket's
  explicit instruction that scroll position must live in `watch.js`, not
  the screen.

- **No regression to QUEUED / small-terminal / unscrolled behavior**: full
  `npm test` suite (693 total `node --test` tests + shell suites) passes;
  additionally fuzzed 5,560 cases with a populated `queueState` present at
  various scroll offsets — zero marker misalignments.

- **UI/design judgment**: N/A — this is a terminal/TUI project with no
  configured design standard or dev server (per role instructions); nothing
  to screenshot or theme-toggle.

### Verdict: CONFIRM

### Non-blocking notes
- The evaluator's own non-blocking suggestion (`renderFleet` recomputes
  `bucketRuns`/`buildSections` a second time after `visibleWindow` already
  computed them internally) is real but genuinely cosmetic — `runs` arrays
  are small, and I confirmed no correctness issue results from it via the
  fuzz pass. Fine to leave as-is or pick up opportunistically later.
