## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-quick-start/spec.md` in full.
- Cross-checked every `quickStartVisible` / `QUICK_START_TOGGLE_KEY` /
  `toggle-quickstart` reference against ground truth:
  `grep -n "quickStartVisible\|QUICK_START_TOGGLE_KEY\|toggle-quickstart" lib/ui/screens/fleet.js lib/ui/watch.js`
  — confirmed the gate (`fleet.js:471`), the constant + collision-avoidance
  comment (`fleet.js:185-186`), `sectionJumpTargets`'s third parameter
  (`fleet.js:1261`), `handleKey`'s `Q` branch (`fleet.js:1352-1353`), the
  footer hint (`fleet.js:774`), the `watch.js` state declaration
  (`watch.js:555`), `currentState()` (`watch.js:591`), the `draw()`
  conditional (`watch.js:895-896`), and the `'toggle-quickstart'` case in
  `applyAction` (`watch.js:1399-1410`) — every one of these is covered by a
  specific tasks.md item (1.1-1.7, 2.1-2.4).
- Confirmed the local quick-start focus mechanism (`focus-quickstart`,
  `move-quickstart-focus`, `quickstart-add`, `exit-quickstart-focus` in
  `watch.js`, and the `focus === 'quickstart'` key branch in
  `fleet.js:1421-1426`) reads/writes only `focus`/`quickStartFocus`, never
  `quickStartVisible` — the design's core claim that local focus navigation
  is untouched is correct and verified.
- Checked `docs/dashboard.md`'s `## Keys` table (`docs/dashboard.md:101-110`)
  and grepped the whole file for `Quick Start`/`Q` — there is in fact **no**
  existing reference to the `Q` toggle in the docs today. Task 3.1's
  "verify rather than assume" framing is correct and appropriately hedged.
- Cross-checked tasks.md 4.2's enumerated test titles against
  `test/fleet.test.js` (`grep -n "quickStartVisible\|QUICK_START_TOGGLE_KEY\|toggle-quickstart"`)
  — all 6 named tests plus the footer-hint test and the two force-start/
  quit-confirm tests exist at the claimed approximate locations
  (2022, 2065, 2087, 2115, 2211, 2243, 2292, 2284-2289).
- Traced every `sectionJumpTargets(...)` call site in
  `test/fleet.test.js` (lines 2004, 2104, 2110, 2116) against the planned
  signature change (dropping the `quickStartVisible` middle parameter) and
  found a real, unflagged regression — see Change Request 2 below.
- Traced `fakeStdin.emit('data', 'Q')` usages in `test/watch.test.js`
  (`grep -n "emit('data', 'Q')"` → 5 hits at lines 1771, 1814, 1856, 1910,
  1941) against the planned removal of the `Q` binding — found a second
  real, unflagged regression — see Change Request 1 below.

### Verdict: REFUTE

### Change Requests

1. **`test/watch.test.js` has 5 end-to-end tests that press `'Q'` purely as
   the mechanism to enter `quickstart` focus before exercising
   `quickstart-add` — none of these will work once `Q` is unbound, and none
   are caught by tasks.md 4.4's search strategy.**
   Lines: `test/watch.test.js:1771, 1814, 1856, 1910, 1941` (inside
   `'quickstart-add with no active queue...'`,
   `'a second quickstart-add onto an already-active queue...'`,
   `'an already-queued ticket never appears in the QUICK START list...'`,
   `'an out-of-bounds quickstart-add index...'`, and
   `'the eligible list excludes a ticket that already has a live run...'`).
   These tests call `h.fakeStdin.emit('data', 'Q')` to open+focus QUICK
   START, then `h.fakeStdin.emit('data', 'a')` to add a ticket. `'a'` is
   handled by `fleet.js:1421-1426` **only** when `focus === 'quickstart'`
   (verified — it is the sole `key === 'a'` match in the file); there is no
   other path into `quickstart` focus in these tests once `Q` is gone. After
   this change these 5 tests will silently start asserting against a
   default-`focus: 'runs'` frame and fail (`spawnCalls.length` assertions
   will read `0` instead of `1`/`2`).
   Tasks.md 4.4 only instructs "search `test/watch.test.js`... for
   `quickStartVisible`/`toggle-quickstart` references" — none of these 5
   tests contain either symbol; they hardcode the raw keypress `'Q'`. A
   literal grep-by-symbol-name sweep will not surface them.
   **Required revision:** add an explicit tasks.md item instructing the
   executor to grep `test/watch.test.js` for `emit('data', 'Q')` (not just
   the symbol names) and rewrite each of these 5 tests to enter `quickstart`
   focus via digit-jump (the digit that resolves to the QUICK START section
   in each fixture's section set, per `sectionJumpTargets`/`buildSections`
   ordering) instead of `Q`.

2. **`sectionJumpTargets`'s planned signature change (dropping the middle
   `quickStartVisible` parameter) silently shifts positional arguments at
   test call sites not covered by tasks.md's keyword-based sweep — at least
   one of which will start failing for reasons unrelated to
   `quickStartVisible`.**
   `test/fleet.test.js:2110`, test title `'sectionJumpTargets never throws
   when metricsVisible passes the bare {} stand-in buildSections only checks
   for truthiness'`, calls `sectionJumpTargets([run({status:'running'})],
   null, false, true)`. Today this is `(runs, queueState, quickStartVisible:
   false, metricsVisible: true)` and the test asserts `kinds.includes('metrics')`.
   Under the planned new 3-parameter signature `(runs, queueState,
   metricsVisible)`, this same call becomes `(runs, queueState,
   metricsVisible: false, <ignored 4th arg>: true)` — `metricsVisible`
   silently becomes `false`, the METRICS section is no longer built, and
   `kinds.includes('metrics')` fails. This test's name and assertion have
   nothing to do with `quickStartVisible`, so it is not caught by tasks.md
   4.2's enumerated list or 4.3's "sweep... that passes `quickStartVisible:
   true`" instruction (this call site never uses that named property).
   Related: `test/fleet.test.js:2104` (`'sectionJumpTargets includes a
   forceRender-empty QUICK START when visible'`) has its entire premise
   invalidated by the change (QUICK START is no longer conditionally
   visible) but is not in tasks.md's removal list either — it happens to
   keep passing by accident (QUICK START is now always force-rendered
   regardless of the args), which will mask that its name/intent is now
   false.
   **Required revision:** add a tasks.md item instructing the executor to
   grep `test/fleet.test.js` (and any other test file) for every
   `sectionJumpTargets(` call site, not just ones naming `quickStartVisible`,
   and individually re-verify/re-derive each argument list against the new
   3-parameter signature — explicitly calling out
   `test/fleet.test.js:2110` (fix the stale positional arg) and
   `test/fleet.test.js:2104` (rename/rewrite or fold into the "always
   visible" coverage, since its "when visible" framing is no longer
   meaningful).

### Non-blocking notes

- The design correctly identifies (Decision 1) that the flag must be
  removed outright rather than defaulted `true` — verified this is
  necessary: `render()`'s `opts` (task 1.7) stops forwarding
  `quickStartVisible`, and `buildSections` at two of its three call sites
  (`visibleWindow` and `renderFleet`) receives that same `opts` unchanged,
  so a conditional gate left in place would silently regress to
  never-visible without task 1.1's unconditional push.
- Several explanatory comments referencing the soon-removed
  `quickStartVisible` gating semantics are not explicitly targeted by any
  task (e.g. `fleet.js:443-445`'s `buildSections` header comment,
  `fleet.js:816-819`'s `visibleWindow` comment, and
  `watch.js:1436-1438`'s `exit-quickstart-focus` comment, which will read
  "panel stays visible — only Q hides it" after `Q` no longer exists). Not
  blocking on its own, but worth a blanket task item ("grep both files for
  every remaining `quickStartVisible`/`Q`-toggle-referencing comment after
  the mechanical removals and update or delete it") given design.md's own
  stated goal of not leaving dead references behind.
