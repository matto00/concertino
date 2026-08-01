## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/launchpad-queue-status/spec.md`, and my own round-1 report
  (`skeptic-design-1.md`) in full.
- Re-read the real source the change targets to check the round-2 revisions
  against ground truth, not against the executor's narrative:
  - `lib/ui/watch.js`: `quickstart-add` (1363-1390, identifier extraction at
    line 1367), `quickStartEligible` (685-705), `toggle-select` (1749-1758),
    `select-all` (1760-1767), `open-launchplan` (1811-1822), `confirm-launch`
    (1984-2017, `isSelectable` filters at 1995-1996), closure-scoped
    `let queueState` (line 477, reassigned at 741/969/1284/1375 — confirming
    it is already in scope, unchanged, at every one of the above call sites).
  - `lib/ui/screens/launchpad.js`: `inlineStatus` (114-119), `isSelectable`
    (129-131), `selectableIdentifiers` (135-137), `ticketRow` (196-217,
    `inlineStatus` call at 199), `renderLaunchPad` (219-, `opts.queueState`
    read at 227, hints array built at 409-418), `handleKey` (426-482, `q`
    confirmed unbound), `module.exports` (503-510, confirms `inlineStatus`/
    `isSelectable`/`selectableIdentifiers` are exported by name already).
  - `lib/ui/queue.js`: `createQueue(tickets, maxConcurrent, launchCommand,
    confirmed)` (54-64), `tick()`'s `byTicket`/`pending`/`inFlight` handling
    (110-128, confirms `pending` is an array of identifier strings and
    `inFlight` a `Set` of the same), `enqueueOne(queue, ticket)` (337-341) —
    all match the signatures the design's Decision 3 code sketch uses.
  - `lib/ui/format.js`: `STATUS_COLOUR` (43-51) — `running: cyan`,
    `queued: dim`, confirming the two are visually distinct as required.
- Grepped every `isSelectable`/`selectableIdentifiers` call site in the
  codebase (`watch.js:702, 1757, 1765, 1820, 1995, 1996`) to confirm the
  design's Decision 4 enumerates all of them: four are threaded with
  `queueState` (`toggle-select`, `select-all`/`selectableIdentifiers`,
  `open-launchplan`, and now `confirm-launch`), and the fifth
  (`quickStartEligible`, line 702) is deliberately left two-arg with its own
  separate `inQueue` filter already covering queue membership — matching the
  proposal's Non-Goal that CON-40's widget needs no change.

### Change Request 1 (round 1) — verified fixed
`design.md` Decision 4 now explicitly names `confirm-launch`
(`watch.js:1984-2017`, re-check at `1995-1996`) as the fourth call site to
thread `queueState` through, with the exact same reasoning I raised (the
interval between `open-launchplan`'s snapshot and the confirm keypress).
`tasks.md` task 2.3 lists all four call sites including `confirm-launch` by
name and line range, explicitly flagged "not optional." `spec.md` gained a
new scenario ("A ticket that becomes queued between opening and confirming
the launch plan is not duplicated") that exercises exactly this path.
`tasks.md` task 6.5 adds a regression test for the same race, which also
satisfies my round-1 non-blocking suggestion. All line numbers cited in the
revision match the actual current file content (verified above).

### Change Request 2 (round 1) — verified fixed
`design.md` Decision 3 now reads: "`const id = t.identifier; queueState ?
queue.enqueueOne(queueState, id) : queue.createQueue([id], 1,
launchCommand);`" — explicit identifier extraction, matching
`quickstart-add`'s verified pattern (`watch.js:1367`, `const ticket =
t.identifier;`) and `queue.js`'s actual data model (`pending`/`inFlight`
hold identifier strings, not ticket objects — confirmed above). `tasks.md`
task 3.2 mirrors this exactly ("extract `const id = t.identifier;`
(matching `quickstart-add`'s `watch.js:1367` pattern — the ticket OBJECT is
never passed to the queue primitives...)"). No remaining ambiguity about
what value reaches the queue primitives.

### Additional full design-soundness review (round 2)

- No placeholders/TBDs/hand-waving found in any of the four artifacts.
- No internal contradictions between `proposal.md`, `design.md`, `tasks.md`,
  and `spec.md` — task numbering maps cleanly onto design decisions, and
  every spec scenario is traceable to a task.
- Every AC implied by `ticket.md` (queued status distinct from running;
  single-ticket "add to queue" action reusing existing primitives; selection
  refusal extended to queued tickets to prevent duplicate-queue hazard) has
  a corresponding task and spec requirement/scenario.
- No scope drift: `fleet.js`/CON-40's QUICK START widget is correctly
  scoped out (it already excludes queued tickets independently), and the
  full multi-select -> launch-plan -> confirm flow is preserved unchanged
  alongside the new lighter `q` path, per the ticket's own framing.
- No missing contract/spec updates: this is the first spec-driven change
  touching `inlineStatus`/`isSelectable`, and the new
  `specs/launchpad-queue-status/spec.md` covers all four requirement areas
  (status display, selection refusal, the `q` action, and hint gating) with
  concrete scenarios.
- Verified `createQueue`/`enqueueOne` signatures, `STATUS_COLOUR` table,
  `handleKey`'s current unbound `q`, and `renderLaunchPad`'s existing
  `opts.queueState` read all match what the design assumes — no invented
  APIs or stale assumptions about the current codebase.

### Verdict: CONFIRM

### Non-blocking notes
- None beyond what round 1 already raised (now resolved).
