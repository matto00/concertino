## Skeptic Report — design gate (round 5)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/fleet-quick-start/spec.md` in full (post round-4 revision), and
  `skeptic-design-4.md` as a claim to re-check, not a fact.
- Confirmed round 4's single change request is genuinely and completely
  fixed, against fresh reads of ground truth:
  - `lib/ui/screens/fleet.js:375` (`visibleWindow`'s own internal
    `buildSections(buckets, queueState)` call) and `:529` (`renderFleet`'s
    own internal `buildSections(bucketRuns(runs), queueState)` call) are
    exactly as design.md's rewritten passage (lines 67-71) now describes:
    neither forwards `opts` today. design.md's corrected text states this
    accurately (no longer the false "already forward" claim round 4 caught).
  - tasks.md 2.10 and 2.11 name the exact old→new call text at the exact
    two line numbers, matching what I read directly in `fleet.js`.
  - tasks.md 5.1 gained the sentence requiring
    `renderFleet(runs, { ...opts, quickStartVisible: true,
    quickStartTickets: [...] })`'s own returned string to actually contain
    a rendered QUICK START box/hint — closing the exact test gap round 4
    flagged (the old 5.1 never pinned down `renderFleet`'s own
    `buildSections` call being correctly wired).
- Did a full fresh re-read of `lib/ui/screens/fleet.js` (all 794 lines,
  current pre-implementation state), `lib/ui/screens/launchpad.js`
  (`priorityLabel`/`sortByPriority`/`isSelectable`/exports at line
  436-441), `lib/ui/queue.js` (`createQueue`, `pending`/`inFlight` shape),
  and `lib/ui/watch.js` (the `launchCommand` const at line 237, the
  `queuedTitles` build + the actual `router.render(currentState(), {...})`
  call site at lines 686-706 — the exact object literal task 4.2 must
  extend).
- Cross-checked design.md's `enqueueOne`/Decision 5 assumptions against
  `queue.js`'s real `createQueue(tickets, maxConcurrent, launchCommand)`
  signature and `pending`(array)/`inFlight`(Set) shapes — consistent.
- Traced the cold-cache/fully-filtered `emptyHint` requirement (spec.md
  "An empty or cold QUICK START list still renders an explanatory hint",
  design.md line 57/61, tasks.md 2.5) through to its actual data source
  and found the plumbing genuinely missing (see Change Request 1).

### Verdict: REFUTE

### Change Requests

1. **No mechanism is specified for `buildSections()`/`renderFleet` to
   learn whether the ticket cache is cold vs. populated-but-fully-filtered
   — despite `emptyHint`'s text depending exactly on that distinction, and
   spec.md making both outcomes a `SHALL` with distinct scenarios.**

   Ground truth, `lib/ui/watch.js:700-706` — the actual object literal
   `draw()` passes to `router.render` today:
   ```
   const screenText = router.render(currentState(), {
     cols,
     rows: screenRows,
     now,
     queuedTitles,
     ticketText: drillTicketText,
   });
   ```
   Task 4.2 instructs adding `quickStartTickets`/`quickStartVisible`/
   `quickStartFocus` here (mirroring how `queuedTitles` is threaded) — but
   names no field carrying cache-coldness. `quickStartTickets` alone
   cannot distinguish the two cases design.md/spec.md require distinct
   hints for: per Decision 4's own pseudocode, `eligible` is derived from
   `cache.read(root).tickets || []`, filtered and sliced — a never-fetched
   cache (`cache.isCold(...) === true`, `tickets` defaults empty) and a
   fetched-but-fully-filtered cache both produce the identical empty
   array. `buildSections()` (task 2.5) is a pure function inside
   `fleet.js` with no access to the `cache` module or `root` — it can only
   branch on whatever `opts` field is threaded to it, and none is named.

   design.md line 57 names the right function (`cache.isCold`) in a
   parenthetical, but never turns it into a decision: no opts field name,
   no watch.js `draw()` computation step, no statement of which of the
   three `buildSections` call sites actually needs it (only `renderFleet`
   does — `visibleWindow` only needs `forceRender` for the fixed height
   cost, `sectionJumpTargets` only needs it for jump-numbering, neither
   depends on the hint *text*). This is exactly the class of gap this
   document otherwise goes out of its way to close explicitly — design.md
   line 59 promises "all named explicitly here so `tasks.md` does not
   leave any implicit" for this very divergence, and this one piece of it
   is not.

   **Effect if implemented literally:** task 2.5's `emptyHint`-selection
   branch inside `buildSections` has no data to select on. An implementer
   must invent the plumbing (a new opts field, a new watch.js computation)
   without the design ever having named it — or ship a hardcoded/incorrect
   hint, silently failing spec.md's "A cold cache shows a fetch hint, not
   an empty section" / "A fully-filtered list shows a distinct... hint"
   scenarios.

   **Required revision:**
   - design.md Decision 4 needs an explicit mechanism step naming: (a) a
     new opts field (e.g. `quickStartCold`) computed once in `watch.js`'s
     `draw()` via `cache.isCold(cache.read(root))`, gated the same way the
     eligible-list computation already is (only relevant when
     `quickStartVisible`); (b) that field added to the object literal at
     `lib/ui/watch.js:700-706` — named explicitly, the same way 2.10/2.11
     now name `fleet.js:375`/`529`; (c) a statement that only `renderFleet`'s
     own `buildSections` call (not `visibleWindow`'s or
     `sectionJumpTargets`'s) actually needs this field, since the other two
     never read `s.emptyHint`.
   - tasks.md 4.2 must gain this as an explicit new opts field alongside
     `quickStartTickets`/`quickStartVisible`/`quickStartFocus`, naming the
     `lib/ui/watch.js:700-706` call site directly.
   - tasks.md 2.5 must be reworded to say `emptyHint` is selected by
     reading `opts.quickStartCold` (or whatever field 4.2 introduces),
     not left as an unstated decision inside `buildSections`.

### Non-blocking notes

- design.md Decision 4's "Concrete mechanism" section now contains two
  separately-numbered lists that both start at 1 (the original 4-item
  mechanism list at lines 61-65, then a 3-item "none of `buildSections`'
  three call sites forward `opts`" list inserted at lines 67-71, followed
  by items 5-6 at lines 73-74 that are actually continuations of the
  *first* list but appear after the second one). This is confusing to
  read cold, though not itself blocking — every task in tasks.md
  cross-references the relevant content directly rather than relying on
  the numbering to resolve which list an item belongs to. Worth
  renumbering for a future reader, but not a required revision this round.
- Everything else re-verified this round (three `buildSections` call
  sites, `enqueueOne`/`queue.js` shapes, `launchpad.js` exports,
  `launchCommand`'s function-scope const, `sectionJumpTargets`'s minimal
  `{ quickStartVisible }` opts object being sufficient for its own
  `forceRender`-based filter without needing the ticket list) checks out
  against ground truth.
