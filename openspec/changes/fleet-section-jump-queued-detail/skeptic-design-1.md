## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `workflow-state.md`,
  and all three spec deltas
  (`specs/fleet-section-jump/spec.md`, `specs/fleet-queue-force-start/spec.md`,
  `specs/fleet-queue-visibility/spec.md`) in full.
- Confirmed CON-6 (the ticket's stated prerequisite, "land on or after CON-6")
  is already merged to `main` (`git log --oneline`: `7ea12b4 CON-6 Fleet view
  scrolls instead of hiding the selection past the visible window (#33)`), so
  the design's assumption that `visibleWindow`/scroll machinery already exists
  is correct and current.
- Read the actual current `lib/ui/screens/fleet.js` (648 lines),
  `lib/ui/watch.js` (relevant sections around `applyAction`/`draw()`),
  `lib/ui/queue.js` (all 260 lines), `lib/ui/queue-cache.js` (all 135 lines),
  and `lib/ui/screens/launchplan.js`'s `withAgentMergeFlag`/`withSpeedFlag`.
  Cross-checked every concrete claim design.md makes against this file:
  - `tick()`'s admission gate is exactly `inFlight.size < queue.maxConcurrent`
    at `queue.js:118`, as the ticket and design cite.
  - The digit keys `1`-`9`, `f`, and bare `\x1b` (Escape) are genuinely
    unbound in `fleet.js`'s current `handleKey` (only `j`/`k`/arrow aliases,
    `n`/`N`/`q`/Ctrl-C/Enter/`l`/`CONFIRM_RESTORED_QUEUE_KEY='c'` are claimed).
  - `visibleWindow`'s `firstVisibleIndex`/`lastVisibleIndex`/`maxScrollOffset`
    and `watch.js`'s `'move'`-case scroll-adjustment (`watch.js:881-899`) are
    exactly what Decision 2's "factor into `scrollToShow`" plan describes
    reusing.
  - `buildSections`' `unselectable: true` on QUEUED and the existing
    `fleet-queue-visibility` spec requirement "Inserting QUEUED never
    perturbs the row-index a selection resolves to" (confirmed present at
    `openspec/specs/fleet-queue-visibility/spec.md:65-66`) match the design's
    account of the row-index hazard CON-28 flagged, and Decision 1's
    "separate `queueFocus` cursor, not a slot in `selected`" resolution is a
    sound way to preserve that guarantee.
  - `launchplan.js`'s `withAgentMergeFlag`/`withSpeedFlag` token format
    (`{{TICKET}} [--agent-merge|--no-agent-merge] [fast|slow]`, degrading to
    a no-op with no `{{TICKET}}` placeholder) exactly matches what Decision
    5's `parseLaunchCommand` plans to parse.
  - `queue-cache.js`'s `write()` already accepts any object with
    `pending`/`inFlight`/`maxConcurrent`/`launchCommand` — confirms the
    proposal's "no shape change expected" claim for `forceStart`'s output.
  - Drilldown's kill/restart `y`-gate pattern (`drilldown.js:582-586`,
    "any other key" cancels, re-checks liveness) matches Decision 3's cited
    precedent for the force-start confirmation.
- Traced the digit-jump numbering ambiguity the ticket explicitly flagged
  (fixed vs. positional scheme) to Decision 1, which resolves it with a
  rejected-alternative writeup — sound.
- Traced the "force-start scope vs. QUEUED unselectable / row-index hazard"
  ambiguity to Decision 1's second half (QUEUED participates in digit
  numbering but gets its own `state.queueFocus`/`state.focus` cursor instead
  of a `selected` slot) — sound, and tasks 4.1-4.5 implement it with a
  round-trip test (`runs[state.selected]` unchanged before/after visiting
  QUEUED) that satisfies the ticket's own Notes-section discipline request.
- Traced every ticket AC/scope item to a task: digit-jump (tasks 3.x),
  QUEUED speed/agent-merge display (tasks 2.x, 6.x), force-start + warning
  (tasks 1.x, 5.x), CON-29 persistence non-perturbation (task 1.1 + spec's
  "no distinct manually-started state" requirement).

### Verdict: REFUTE

### Change Requests

1. **`forceStart`'s design/task-specified `confirmed: true` passthrough
   silently defeats CON-29's restore-confirm safety gate.** Task 1.1 (and
   design.md Decision 4) directs `forceStart(queue, ticket)` to return a
   queue "shaped identically to `tick()`'s own return `queue` object (same
   `confirmed: true`, `launchCommand`, `restoredFrom` passthrough)". `tick()`
   hard-codes `confirmed: true` (`queue.js:141`) and its own comment
   explains why that is safe: "`confirmed: true` explicitly, always — tick()
   only ever runs on a queue `shouldTick()` already accepted (never `false`,
   per watch.js's guard)" (`queue.js:133-135`). `shouldTick()`
   (`queue.js:165-167`) is the *only* gate that keeps `tick()` off an
   unconfirmed, restored-from-a-previous-session queue
   (`queueState.confirmed === false`, CON-29) — see `watch.js:340-347`'s own
   comment: "nothing a restored queue would launch reaches submitTicket
   until the operator presses the confirm key."

   Force-start's key path (digit-jump into QUEUED, `f`, `y`) is **not**
   gated by `shouldTick()`/`confirmed` at all: `buildSections()`
   (`fleet.js:154-176`) renders the QUEUED section purely off
   `queueState.pending.length`, with no check of `queueState.confirmed`, so
   an operator can digit-jump into QUEUED and force-start a ticket from a
   restored, not-yet-confirmed queue exactly as easily as from a live one.
   As specified, doing so would set the *entire* returned queue's
   `confirmed` to `true` — not just mark the one force-started ticket — and
   the very next `draw()`'s `shouldTick()` check (now `true`) would begin
   auto-admitting every *other* pending ticket in that stale restored queue
   via ordinary `tick()`, with no operator confirmation of the batch ever
   having happened. This is exactly the silent-reactivation-of-a-stale-queue
   failure CON-29's confirm gate exists to prevent, and it is nowhere
   discussed in design.md's Risks/Trade-offs or Decisions, nor in the
   `fleet-queue-force-start` spec delta, nor covered by any task-1.2 unit
   test.

   Required: design.md must explicitly decide and document one of
   (a) `forceStart`'s returned queue preserves the original queue's
   `confirmed` value (only `tick()` — which is provably gated — gets to
   hard-code `true`), or (b) force-start is disallowed, or itself requires
   the CON-29 `'c'` confirm key first, whenever `queueState.confirmed ===
   false`. Whichever is chosen, add a task and a unit test asserting that
   force-starting one ticket out of an unconfirmed restored queue does not
   silently confirm or begin auto-ticking the rest of that queue.

2. **Dangling task cross-reference in tasks.md.** Task 4.3 says "a digit key
   re-resolves per task 3.3/3.6", but tasks.md's group 3 only defines
   subtasks 3.1 through 3.5 — there is no 3.6 anywhere in the file. Since
   this review was specifically asked to confirm tasks.md is "a viable,
   dependency-ordered breakdown", this broken reference needs to be fixed
   (either renumber/add the missing subtask the reference intends, or point
   at the correct existing subtask) so an implementer isn't left hunting for
   a task that doesn't exist.

### Non-blocking notes

- Task 4.3 specifies `j`/`k` (bare) for moving `queueFocus`, but doesn't say
  whether the existing arrow-key aliases (`\x1b[B`/`\x1b[A`, which drive
  ordinary `move` alongside `j`/`k` today) also drive `queueFocus`. Worth
  making explicit either way for consistency with the rest of this file's
  key handling.
- No task updates the fleet footer's key-hint line
  (`buildHeadTail`'s `↵ attach   l details   j/k move   n new run   N launch
  pad   q quit`) to mention the new digit-jump keys or `f` (force-start).
  Operators would have no on-screen way to discover either new affordance.
  Not blocking, but worth a task if on-screen discoverability matters here
  the way it clearly did for the original footer.
- The precise ordering of the `forceStartConfirm` key-interception check
  relative to the existing top-of-`handleKey` `quitConfirm` check isn't
  spelled out (e.g. does pressing `q` while the force-start warning is up
  cancel the warning, per task 5.3's "any other key", or trigger quit's own
  confirm?). Task 5.3's wording implies the former, which seems right, but
  making the precedence explicit in design.md would remove any doubt.
