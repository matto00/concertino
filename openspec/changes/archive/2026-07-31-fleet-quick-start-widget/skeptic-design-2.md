## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md` (via Linear MCP, CON-40), `proposal.md`, `design.md`,
  `tasks.md` in full (post-revision), and round 1's own report
  (`skeptic-design-1.md`) as a claim to re-check, not a fact.
- Re-read `lib/ui/screens/fleet.js` in full around every call site
  design.md's Decision 4 "concrete mechanism" and Decision 3 name:
  `buildSections` (line 180, and its two existing call sites at line 375
  inside `visibleWindow` and line 529 inside `renderFleet`), `visibleWindow`'s
  `sectionHeight` (lines 410-412), `renderFleet`'s per-section loop (lines
  528-591, including the `boxHeight = contentLines.length + 2` /
  `layout.degrade`/`layout.box` paths cited by Decision 4's "1 + 2" claim),
  `sectionJumpTargets` (lines 633-640), and `handleKey` in full (lines
  643-720+, including the digit-jump branch at ~665-670 and the
  `focus === 'queue'` branch at ~695-706).
- Confirmed `router.js`'s seam again: `handleKey(key, state)` (line 45-48)
  receives only `state`, never `opts` — unchanged since round 1, still the
  load-bearing constraint both this round's CR1 fix and my finding below
  turn on.
- Read `watch.js`'s `currentState()` (lines 394-401) and the `render()` call
  site (line 700-706, `router.render(currentState(), { cols, rows, now,
  queuedTitles, ticketText })`) and fleet.js's own `render(state, opts)`
  wrapper (lines 768-786) — confirmed `render()` merges `state` fields
  (`queueState`, `focus`, `queueFocus`, ...) into the `opts` object it
  forwards to `renderFleet`, but **`handleKey` never goes through this
  merge** — it operates directly on the raw `state` object passed to it.
- Read `lib/ui/queue.js` (`createQueue`, `tick`, `shouldTick`, `forceStart`,
  the `pending`-array/`inFlight`-Set shapes) and `lib/ui/screens/launchpad.js`
  (`PRIORITY_RANK`, `priorityRank`, `sortByPriority`, `isSelectable`,
  `priorityLabel`, `module.exports`) — both confirm Decision 5/6's claims
  about existing signatures accurately; no discrepancies found there.

### Verdict: REFUTE

Round 1's two change requests are genuinely addressed:

- **CR1 (handleKey has no ticket data for `a`)** is resolved cleanly:
  `design.md` Decision 3's new "`handleKey` has no ticket data..." note and
  `tasks.md` 3.4 both now have `handleKey` emit `{ type: 'quickstart-add',
  index: quickStartFocus }` **unconditionally** while `focus === 'quickstart'`,
  deferring existence-checking to `watch.js`'s `quickstart-add` handler
  (`tasks.md` 4.4), which correctly re-derives the eligible list fresh at
  handling time. This is option (b) from round 1's report, applied
  consistently across design.md and tasks.md.
- **CR2 (empty/cold QUICK START vs. the two zero-length-group shortcuts)**
  is resolved with real specificity: Decision 4's new "Concrete mechanism"
  subsection names all four call sites (`buildSections`'s `forceRender`/
  `emptyHint`/`kind` fields; `sectionHeight`'s `if (!s.group.length) return
  s.forceRender ? 3 : 0;`; `renderFleet`'s per-section loop rendering a
  normal bordered box when `forceRender` and empty; `sectionJumpTargets`'s
  filter becoming `s.group.length > 0 || s.forceRender`), and I checked each
  against the actual code it modifies (`fleet.js:411`, `fleet.js:534`,
  `fleet.js:575` for the `contentLines.length + 2` convention the "1 + 2"
  cost claim matches, `fleet.js:634`) — all four are accurate, concrete edits
  to real lines, not hand-waving. `tasks.md` 2.5/2.6/2.7/2.8 mirror them.

However, verifying Decision 4's fourth call site against `handleKey`'s
actual call chain surfaced a **new gap in the same category CR1 already
found and fixed** — this round's revision closed CR1's specific instance
(the `a`-key branch) but missed a structurally identical instance one call
site over.

### Change Requests

1. **`sectionJumpTargets`, when invoked from `handleKey`'s digit-jump
   branch, has no way to learn `quickStartVisible` — so `buildSections`
   will never build a QUICK START section on that path, and digit-jump to
   it silently cannot exist, regardless of design.md's own text.**
   `design.md` Decision 4's mechanism point 4 says `sectionJumpTargets()`'s
   filter changes to `s.group.length > 0 || s.forceRender` (`tasks.md`
   2.8) — correct as far as it goes, but it presupposes `buildSections`
   (called *inside* `sectionJumpTargets`, `fleet.js:634`) already knows
   whether to build the QUICK START section object at all, which per
   `tasks.md` 2.3 depends on a third `opts` parameter carrying
   `quickStartVisible`. That works fine for the two callers that already
   carry real `opts` (`visibleWindow`, which takes `opts` as a parameter
   and threads it straight through at `fleet.js:375`; `renderFleet`, which
   likewise receives `opts` directly at `fleet.js:529`). It does **not**
   work for `sectionJumpTargets`'s only actual caller,
   `handleKey`'s digit-jump branch (`fleet.js:694`,
   `sectionJumpTargets(runs, queueState)`) — this call passes exactly two
   arguments, matching `sectionJumpTargets`'s current two-parameter
   signature (`fleet.js:633`, `function sectionJumpTargets(runs,
   queueState)`), and neither `design.md` nor `tasks.md` names a change to
   this signature or this call site. Nor does `handleKey` reach QUICK
   START's visibility flag any other way: `render(state, opts)`
   (`fleet.js:768-786`) is the one place `state` fields get merged into an
   `opts`-shaped object for rendering, but `handleKey` never calls
   `render()` — it operates on the raw `state` argument `router.handleKey`
   passes it (confirmed again at `router.js:45-48`). So even though
   `tasks.md` 4.1 would put `quickStartVisible` into `currentState()`
   (making it reachable as `state.quickStartVisible` inside `handleKey`),
   nothing in either document says `sectionJumpTargets`'s signature grows a
   parameter for it, or that `handleKey`'s digit-jump call site is updated
   to pass it through. Followed literally, `sectionJumpTargets(runs,
   queueState)` calls `buildSections(bucketRuns(runs), queueState)` with no
   third argument on this path, `opts` is `undefined` inside `buildSections`,
   `quickStartVisible` reads falsy, and the `'quickstart'`-kind section is
   never added to the array `sectionJumpTargets` filters and numbers —
   **even while QUICK START is genuinely open and rendered on screen** (via
   the separate, correctly-wired `renderFleet` path). The practical result:
   pressing a digit while QUICK START is visible either skips it entirely
   (every digit after its would-be position silently maps one section too
   low, e.g. what should jump to QUEUED instead jumps to FAILED) — precisely
   the "digit numbering disagrees with what's on screen" defect Decision 4
   point 4's own text names as the thing being guarded against, just
   recurring at the one call site whose data starvation this round's
   revision didn't check. Required: add an explicit task/design note (a)
   giving `sectionJumpTargets` a third parameter (e.g.
   `quickStartVisible`, not the full ticket list — only the boolean is
   needed to decide inclusion, per Decision 4's "`forceRender: true` ...
   regardless of `group.length`" wording) that it forwards into
   `buildSections`'s `opts` argument, and (b) updating `handleKey`'s
   digit-jump call site (`fleet.js:694`) to read `state.quickStartVisible`
   (once 4.1 adds it to `currentState()`) and pass it through.

### Non-blocking notes

- `design.md` Decision 4's own phrasing ("`forceRender: true` ... whenever
  `quickStartVisible` is true, regardless of `group.length`") and `tasks.md`
  2.5's phrasing ("whenever `quickStartVisible` is true **and**
  `group.length === 0`") are subtly different, though functionally
  equivalent today since `forceRender` is only ever consulted inside
  `if (!s.group.length)` branches. Worth tightening to one wording so a
  future reader doesn't have to prove the equivalence themselves — same
  spirit as round 1's non-blocking note on Decision 5's module-scope wording
  (still not fixed, still harmless).
