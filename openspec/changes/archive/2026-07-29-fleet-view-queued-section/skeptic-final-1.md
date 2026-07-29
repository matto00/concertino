## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Row-index hazard (ticket's primary hazard).** Read `lib/ui/screens/fleet.js`
  in full. Confirmed structurally, not just by comment:
  - `sections` gains a QUEUED entry (`fleet.js:222-231`) with `unselectable: true`.
  - The single shared `index` counter, used both for the fully-collapsed branch
    (`fleet.js:280-286`) and the per-row branch (`fleet.js:292-309`), is only
    advanced when `!s.unselectable` — for QUEUED it is never touched.
  - `renderQueuedRow` (called only for `s.unselectable` sections) has no
    `selected`/marker parameter at all, so a queued row cannot structurally
    ever carry the `▸` marker — not merely "doesn't today by convention."
  - `watch.js`'s `selected` is bounded to `[0, runs.length - 1]`
    (`watch.js:386`) and `runs` never contains queued tickets (they come from
    `queueState.pending`, a wholly separate array) — so `runs[selected]` can
    never resolve to a queued ticket, and QUEUED rows can never shift what a
    FAILED/DONE row below them resolves to.
  - Ran the actual regression tests directly (not just read them):
    `node --test test/fleet.test.js` — 70/70 pass, including "the selection
    marker still points at the correct run when a non-empty QUEUED section
    renders between RUNNING and FAILED" (drives real `reduce()` output through
    `renderFleet` with `queueState` present, for every `selected` index) and
    "inserting a non-empty QUEUED section never perturbs which run a
    FAILED/DONE row below it resolves to" (before/after QUEUED comparison).
  - Manually re-derived by hand: for `s.unselectable`, `index` is skipped in
    both the hidden-under-cap path (`fleet.js:284`) and the shown path
    (`fleet.js:309`) — confirmed both sites, not just one, skip it.

- **Height-budget invariant / prior incident.** Read the header comment on
  `test/fleet.test.js`'s `'the total-height cap holds with all four sections
  populated'` test (lines 328-333) describing the real prior incident (a
  section trimmed to zero used to still cost a title+blank+more-line floor,
  which at 4 populated sections exceeded a short terminal and silently
  stopped capping, scrolling NEEDS YOU off the top).
  - Confirmed `sectionHeight()` (`fleet.js:249-253`) now reads `s.linesPerRow`
    instead of a hardcoded `2 *` multiplier, and every one of the 5 section
    entries sets `linesPerRow` explicitly (`2` for NEEDS YOU/RUNNING/FAILED/
    DONE, `1` for QUEUED — `fleet.js:210-211,229,233-234`).
  - Ran `test/fleet.test.js`'s new CON-28-specific regression, "the
    total-height cap holds with all five sections (including a populated
    QUEUED) populated" — exercises 6 different terminal heights
    (12/14/16/20/24/28 rows) with a fully populated QUEUED section (20
    pending tickets) alongside all four other sections, and passes: header,
    NEEDS YOU, and total line count within budget hold at every height.
  - I additionally exercised the case the design/evaluator did *not* cover
    with a test — a fully-collapsed-to-zero QUEUED section (rows 8-11,
    reproduced live below) — the height math still held (never exceeded
    budget), only the *text* of the overflow line is affected (see
    non-blocking note).

- **Spec conformance.** Read
  `openspec/changes/fleet-view-queued-section/specs/fleet-queue-visibility/spec.md`
  in full and traced each of its 4 requirements/8 scenarios against the
  shipped code and a passing test:
  - Section renders after RUNNING/before FAILED only when pending non-empty,
    titled with count + `maxConcurrent` — `fleet.js:222-231`, test at
    `test/fleet.test.js:114-131`.
  - Queued row is exactly 1 line, no fabricated status/phase/elapsed/bar —
    `renderQueuedRow` (`fleet.js:111-114`), tests at
    `test/fleet.test.js:133-152` (verified the "no fabricated status" test
    actually asserts against the row text, not just that a row renders).
  - Height-budget/trim parity, QUEUED never pinned — confirmed above;
    `test/fleet.test.js:154-161` runs a 20-item queue at `rows:13` and
    confirms ≤5 shown plus an overflow line.
  - Row-index safety — confirmed above.
  I ran `npx openspec validate --changes fleet-view-queued-section --strict`
  myself: `✓ change/fleet-view-queued-section`, 1 passed / 0 failed.

- **Full test suite, run myself (not trusted from the evaluator's report):**
  `node --test` inside the worktree: **501/501 pass, 0 fail.** (`npm test`'s
  shell-script suites were not independently re-run since this change touches
  no shell scripts and `files-modified.md`/`git diff --stat` confirm the diff
  is scoped to `lib/ui/format.js`, `lib/ui/screens/fleet.js`, `lib/ui/watch.js`,
  `test/fleet.test.js`, plus openspec change-tracking files.)

- **Design-gate resolution check.** Read `skeptic-design-1.md` (REFUTE, 4
  change requests: Decision 4's self-contradiction on `maxConcurrent` source,
  missing `linesPerRow` generalization, missing `statusKey: 'queued'` wiring,
  under-specified render-loop branching mechanism) and confirmed all 4 are
  actually resolved in the shipped code: `queueState.maxConcurrent` is read
  directly (`fleet.js:224`, no new config plumbing in `watch.js`'s diff);
  `linesPerRow` is generalized and set on every entry; `statusKey: 'queued'`
  is set (`fleet.js:226`) and `format.js`'s diff adds `queued: dim` to
  `STATUS_COLOUR`; the render loop branches explicitly on `s.unselectable`
  (`fleet.js:294`), documented in design.md Decision 5.

- **General code quality.** `git diff main...HEAD` for the 4 touched source
  files: no `TODO`/`FIXME`/`console.log`/`debugger` left in. Diff is minimal
  and scoped — `lib/ui/queue.js` untouched (matches design's explicit
  non-goal). `files-modified.md`'s description matches the actual diff line
  for line. `tasks.md`: all 17 tasks checked, 0 unchecked.

- **UI/design judgment:** N/A — this project has no browser UI or design
  standard configured (CLI/TUI screen only); did not start dev servers per
  the task's explicit note.

### Verdict: CONFIRM

### Non-blocking notes

1. The fully-collapsed-to-zero overflow line (`fleet.js:281`,
   `… and ${hidden} more ${s.title.toLowerCase()}`) is pre-existing code,
   only parameterized here — but for QUEUED it now prints the section's
   *entire* parenthesized title, producing a redundant line. Reproduced live:
   at `rows: 8-11` with a populated NEEDS YOU section and a 20-item queue,
   QUEUED collapses fully and the output includes
   `… and 20 more queued (20, running 1 at a time)` instead of a terse
   `… and 20 more queued`. This is purely cosmetic (the height math itself
   is correct at every width tested — NEEDS YOU/header never scroll off) and
   is not covered by any spec.md scenario (which only describes the
   partially-trimmed, non-zero-shown case, correctly implemented via the
   plain `… and N more` form at `fleet.js:308`). Already flagged identically
   by the evaluator in `evaluation-1.md`; concur it does not block this
   ticket, but should be picked up as a quick follow-up (e.g. a short
   section label distinct from the display title, used only by this one
   line).
2. `queuedTitles`' wiring through `watch.js`'s `draw()` → `router.render()` →
   `fleet.render()` has no dedicated end-to-end test in `test/watch.test.js`
   (only `test/fleet.test.js`'s unit-level tests exercise `renderFleet`
   directly with a hand-built `queuedTitles` map). The glue itself is a
   3-line, low-risk read-and-forward (confirmed by direct reading), so this
   is a coverage gap rather than a defect, but worth closing in a future
   pass if `draw()`'s wiring logic grows more complex.
