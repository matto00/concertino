## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-quick-start/spec.md` in full (post-revision), plus round 1's
  report (`skeptic-design-1.md`) to know exactly what was required.
- Confirmed `fleet.js`'s live `sectionJumpTargets` signature is still
  `(runs, queueState, quickStartVisible, metricsVisible)`
  (`grep -n "function sectionJumpTargets" lib/ui/screens/fleet.js` →
  `fleet.js:1261`) — the design's planned 3-param signature change is real
  and still in scope, so round 1's Change Request 2 remains applicable and
  needed exactly the fix now present.
- Re-verified all `sectionJumpTargets(` call sites in `test/fleet.test.js`
  (`grep -n "sectionJumpTargets("` → lines 2004, 2104, 2110, 2116) against
  the new task 4.5:
  - `:2104` — live call is `sectionJumpTargets([run({status:'running'})], null, true)`
    (`'sectionJumpTargets includes a forceRender-empty QUICK START when visible'`)
    — task 4.5 correctly flags its "when visible" premise as now-moot and
    directs a rewrite/fold, matching round 1's finding.
  - `:2110` — live call is `sectionJumpTargets([run({status:'running'})], null, false, true)`
    (`'...never throws when metricsVisible passes the bare {} stand-in...'`)
    — task 4.5's called-out fix (`sectionJumpTargets([run({status:'running'})], null, true)`)
    is the mathematically correct rewrite: it preserves `metricsVisible: true`
    under the new 3-param signature, exactly resolving round 1's Change
    Request 2.
  - `:2004` and `:2116` — independently re-checked: `:2004` passes `false`
    as its 3rd/only extra arg in both old (`quickStartVisible: false`,
    `metricsVisible: undefined`) and new (`metricsVisible: false`) readings
    — both falsy, no behavioral change, so no fix is actually required there
    despite the generic sweep instruction covering it; `:2116` belongs to a
    test (`'sectionJumpTargets omits QUICK START entirely when
    quickStartVisible is false'`) already scheduled for removal under task
    4.2's enumerated list. No gap.
- Re-verified `test/watch.test.js` for the raw-`'Q'`-keypress hazard:
  `grep -n "emit('data', 'Q')" test/watch.test.js` → exactly 5 hits, lines
  1771, 1814, 1856, 1910, 1941 — matches task 4.6's claimed line numbers and
  test titles precisely (read all 5 tests in full: each uses `Q` purely to
  enter `quickstart` focus before pressing `'a'` to exercise
  `quickstart-add`). Task 4.6's instruction (grep the raw keypress, rewrite
  via digit-jump, do not delete since `quickstart-add` coverage must
  survive) directly and correctly resolves round 1's Change Request 1.
- Confirmed `test/watch.test.js` contains **zero** `quickStartVisible`
  string references (`grep -n "quickStartVisible" test/watch.test.js` →
  no output) — this is precisely why a symbol-name sweep (the original task
  4.4) could never have found these 5 tests, confirming task 4.6 was a
  necessary, not redundant, addition.
- Swept for anything the revision might still be missing:
  `grep -rn "'Q'\|\"Q\"\|QUICK_START_TOGGLE_KEY" test/ | grep -v "emit('data', 'Q')"`
  surfaces only `test/fleet.test.js` usages of the `QUICK_START_TOGGLE_KEY`
  constant (import at line 6, and calls at lines 2212, 2214, 2285, 2289) —
  all already explicitly covered by tasks 4.1 (import removal) and 4.2
  (rewrite/remove list, including the named "~line 2284-2289" force-start/
  quit-confirm tests). No further raw-keypress or symbol-name test
  references exist outside what tasks 4.1/4.2/4.5/4.6 already account for.
- Spot-checked the round-1 non-blocking note (dead comments) is now
  resolved by new task 4.7: read `watch.js:999` (a comment referencing
  `quickStartVisible`/`quickStartFocus` not explicitly named in 4.7's
  examples) and confirmed it still falls under 4.7's general instruction to
  "grep both files for every remaining comment referencing
  `quickStartVisible`/the `Q` toggle" — not a gap, since 4.7's examples are
  prefixed "e.g." rather than exhaustive.
- Confirmed task numbering is internally consistent (4.1-4.8, renumbered as
  claimed, no gaps/duplicates) and `workflow-state.md` shows nothing
  anomalous (still Phase: Planning, cycle 0 — consistent with round 2 of an
  in-progress design gate).

### Verdict: CONFIRM

Both round-1 required revisions are verified resolved against live ground
truth, with correct and specific fixes (not hand-waved), and no new gaps
were introduced by the revision.

### Non-blocking notes

- None beyond what round 1 already raised and task 4.7 now addresses.
