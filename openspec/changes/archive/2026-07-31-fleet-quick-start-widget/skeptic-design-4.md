## Skeptic Report — design gate (round 4)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/fleet-quick-start/spec.md` in full (post round-3 revision), and
  all three prior skeptic reports (`skeptic-design-1.md` through
  `skeptic-design-3.md`) as claims to re-check, not facts.
- Confirmed round 3's two change requests are genuinely fixed:
  - CR1 (row-dispatch for QUICK START ticket objects vs. QUEUED id
    strings, plus a focused-row marker): design.md Decision 4 mechanism
    step 5 and tasks.md 2.4/2.7 now explicitly require branching on
    `s.kind` (not `s.unselectable` alone), a new ticket-object row
    renderer with a `focused` param, and `renderQueuedRow`'s path is left
    untouched for `kind === 'queued'`. The spec's focus-cursor requirement
    (`specs/fleet-quick-start/spec.md`, "QUICK START has its own focus
    cursor...") now requires the focused-row visual marker explicitly.
  - CR2 (missing `cap` on the QUICK START section object → `NaN`):
    design.md Decision 4 mechanism step 6 and tasks.md 2.3 now both name
    `cap: QUICK_START_COUNT` explicitly.
- Did a full fresh re-read of `lib/ui/screens/fleet.js` (all 794 lines),
  `lib/ui/screens/launchpad.js` (`priorityLabel`/`PRIORITY_RANK`/
  `priorityRank`/`sortByPriority`/`isSelectable`/`selectableIdentifiers`,
  lines 46-128, 436-441 — all exported and shaped as design.md assumes),
  `lib/ui/queue.js` (`createQueue`, `tick`, `shouldTick`, `pending`/
  `inFlight` shape, lines 48-298 — matches Decision 5's `enqueueOne`
  assumptions), `lib/ui/watch.js` (`currentState()` 394-403, the
  `queuedTitles`/`router.render` call site 686-706), and `lib/ui/router.js`
  (full file — `handleKey(key, state)` receives no `opts`, confirmed).
- Cross-checked every `buildSections(` call site against design.md's
  Decision 4 mechanism list and tasks.md 2.3/2.9.

### Verdict: REFUTE

A new, previously-unflagged gap, in the same category rounds 1-3 already
caught three times: an existing code path that silently keeps its old,
pre-QUICK-START behaviour because neither `design.md` nor `tasks.md`
names it as a call site needing a change — and this time design.md
actively asserts (incorrectly, against the real code) that no change is
needed there.

### Change Requests

1. **`visibleWindow`'s and `renderFleet`'s own internal `buildSections(...)`
   calls (`fleet.js:375` and `fleet.js:529`) do not forward `opts` today,
   and neither document instructs updating them — while design.md
   explicitly (and incorrectly) claims they already do.**

   Ground truth, `fleet.js`:
   ```
   375:  const sections = buildSections(buckets, queueState);              // inside visibleWindow(runs, opts)
   529:  const sections = buildSections(bucketRuns(runs), queueState);     // inside renderFleet(runs, opts)
   ```
   Both calls pass exactly two arguments today — neither forwards the
   `opts` object each enclosing function already receives as its own
   parameter.

   design.md (line 67) says, in the middle of justifying why only
   `sectionJumpTargets` needs a signature-and-call-site fix: *"`buildSections(buckets, queueState, opts)` (point 1 above) reads
   `quickStartVisible`/the eligible list off a third `opts` argument —
   fine for `visibleWindow` and `renderFleet`, which both already receive
   and forward a real `opts` object."* This is false against the actual
   code quoted above: `visibleWindow`/`renderFleet` receive `opts` as
   their own parameter, but neither one *forwards* it into their own
   internal `buildSections` call — that forwarding does not exist yet and
   is not requested anywhere in tasks.md.

   tasks.md 2.3 only says to "Extend `buildSections(buckets, queueState,
   opts)` ... to insert a `QUICK START` entry ... included whenever
   `quickStartVisible` is true" — this describes the function body, not
   its call sites. Task 2.9 explicitly fixes the *third* `buildSections`
   call site (`sectionJumpTargets`'s own internal call) with a named
   three-part fix (a/b/c). No task gives the equivalent instruction for
   the other two call sites at `fleet.js:375`/`529`.

   **Effect if implemented literally, following design.md's false "already
   forward" claim at face value:** `Q` still sets `quickStartVisible: true`
   and `focus: 'quickstart'` (via `toggle-quickstart`, task 4.3); digit-jump
   still correctly reaches QUICK START (since `sectionJumpTargets`'s own
   call site *is* correctly fixed per 2.9/3.3). But `renderFleet`'s own
   `sections` array — built from its own unfixed, opts-less
   `buildSections(bucketRuns(runs), queueState)` call at line 529 — never
   contains a QUICK START entry, so nothing is ever drawn on screen for it,
   regardless of `quickStartVisible`. Likewise `visibleWindow`'s own
   unfixed call at line 375 never sizes a QUICK START entry into its height
   budget. The operator ends up with `focus === 'quickstart'` and a
   (correctly digit-numbered, per 2.9) but **invisible** section — `j`/`k`
   move a cursor over a section that was never rendered, and `a` would add
   whatever ticket the fresh eligible-list re-derivation in `watch.js`'s
   `quickstart-add` handler happens to resolve to index 0, with the
   operator unable to see what they just added. This is the same class of
   defect rounds 1-3 already caught three times (a single-purpose call
   site silently kept in its pre-change shape) — not cosmetic, a real
   functional break of the section's own visibility.

   **Required revision:** design.md line 67 must be corrected to state
   that `visibleWindow`'s and `renderFleet`'s own internal `buildSections`
   calls do **not** currently forward `opts`, and must be updated
   alongside `sectionJumpTargets`'s. tasks.md 2.3 (or a new subtask) must
   explicitly instruct changing `fleet.js:375`'s
   `buildSections(buckets, queueState)` to
   `buildSections(buckets, queueState, opts)` and `fleet.js:529`'s
   `buildSections(bucketRuns(runs), queueState)` to
   `buildSections(bucketRuns(runs), queueState, opts)` — the same explicit,
   named treatment already given to the `sectionJumpTargets` call site in
   the paragraph immediately following this false claim. tasks.md 5.1
   should also gain an assertion that a populated, visible QUICK START
   section actually renders via `renderFleet` (not just that
   `sectionJumpTargets` includes it) — the current 5.1 wording tests
   `sectionHeight`/`sectionJumpTargets`/row-rendering-given-a-section, but
   never pins down that `renderFleet`'s own `buildSections` call is
   correctly wired for `quickStartVisible` in the first place.

### Non-blocking notes
- Everything else in this round's fresh re-read — `enqueueOne`'s shape
  against `queue.js`'s actual `pending`/`inFlight` conventions, the
  `launchpad.js` function signatures Decision 4's `eligible` computation
  and the new row renderer depend on, the `focus === 'quickstart'`
  suppression list against `handleKey`'s existing `focus === 'queue'`
  branch, and the `render()` wrapper's `Object.assign({}, opts, {...})`
  pass-through (which *does* correctly carry `quickStartTickets`/
  `quickStartVisible`/`quickStartFocus` through untouched, once task 4.2
  is followed) — checks out against ground truth.
