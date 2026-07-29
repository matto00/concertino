## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and the delta spec
  `specs/fleet-queue-visibility/spec.md` in full.
- Read ground truth: `lib/ui/watch.js` (full file, 1059 lines), `lib/ui/queue.js`
  (full file, 130 lines), `lib/ui/cache.js` (full file), `lib/ui/screens/fleet.js`
  (full file), and the currently-shipped
  `openspec/specs/fleet-queue-visibility/spec.md`.
- Traced `queue.tick()`'s actual concurrency accounting
  (`lib/ui/queue.js:82-120`): capacity is governed *solely* by
  `queue.inFlight.size < queue.maxConcurrent`, where `queue.inFlight` is a
  `Set` the queue itself maintains — it is never derived from, or
  cross-checked against, the wider `runs` fleet snapshot. `pending`
  reconciliation (dropping an already-live id) is a *separate* mechanism from
  concurrency accounting; the two do not compensate for each other.
- Traced `watch.js`'s `draw()` (`lib/ui/watch.js:353-457`) and the top-level
  `watch()` startup sequence (`lib/ui/watch.js:153-233`, `462-464`): `runs`
  is initialised to `[]` at `watch.js:183` and is only ever populated inside
  `draw()`'s `reduce(store.readAll(...), sampleWindows(now), now)` call
  (`watch.js:385`). The single `queue.tick()` call site
  (`watch.js:367-383`) runs *before* that `reduce()` call in the same
  `draw()` invocation, deliberately against the *previous* poll's `runs`
  (see the comment at `watch.js:356-366`) — there is no code path today that
  produces a "first computed runs snapshot" independent of a `draw()` call.

### Verdict: REFUTE

### Change Requests

1. **Restoring the pending tail without reconstructing `inFlight` lets a
   resumed queue silently exceed `maxConcurrent` (including breaking
   "sequential" mode), which is exactly the safety property this ticket
   exists to protect.**
   `design.md` Decision 2 and the Non-Goals section explicitly choose not to
   restore `inFlight` into a launchable/tracked state ("written for
   completeness/diagnostics only; never restored into a launchable state" /
   "in-flight runs are already durable via tmux + the run's own event log,
   the queue file only needs to remember the pending tail"). That reasoning
   conflates two different things: the *run* surviving a dashboard crash
   (true — tmux windows are independent processes) versus the *queue's own
   concurrency bookkeeping* surviving it (false, by design, once restored).
   `queue.tick()` (`lib/ui/queue.js:82-120`) computes how many new tickets it
   may launch purely from `queue.inFlight.size`, which is queue-local state,
   not derived from `runs`. If a batch was queued with `maxConcurrent: 1`
   (sequential) and one ticket was genuinely in flight — still running in
   its own tmux window — at the moment of the crash, and it is *still
   running* when the dashboard restarts, the design as written restores that
   ticket into neither `pending` (correct — it isn't pending) nor
   `inFlight` (the gap). On confirm, the next tick sees `inFlight.size = 0 <
   maxConcurrent`, and launches the next pending ticket immediately — two
   tickets now running concurrently under a queue the operator explicitly
   configured as sequential, one-at-a-time (`lib/ui/queue.js:8-12`'s own
   documented contract: "Sequential is `maxConcurrent: 1`... launches one
   ticket, waits for that run to reach a terminal state, and launches the
   next"). This is precisely the "eight-hour overnight batch" scenario the
   ticket itself motivates the whole change with (ticket.md line 11), and is
   exactly the kind of hazard proposal.md's own "The reconciliation problem
   is the actual work" section says must be solved, not sidestepped.
   **Required revision:** either (a) reconstruct `inFlight` at restore time
   by checking each persisted `inFlight` ticket id against `isRunLive` (the
   same predicate already used for `pending`) and seeding the restored
   queue's `inFlight` Set with the still-live ones, so the concurrency slot
   they occupy is respected until they finish, or (b) if that is
   deliberately out of scope, `design.md` must say so explicitly as a named,
   accepted risk (with the concrete "sequential mode can silently become
   parallel across a restart" consequence spelled out, not just "written for
   diagnostics only"), and the required-safety-property section of the
   ticket/proposal must be revised to acknowledge the gap rather than imply
   restore is "strictly safer than the status quo" (design.md Goals, second
   bullet) when, on this axis, it is not — the status quo never launches a
   second concurrent ticket under a live sequential run at all.

2. **Task 3.3 describes an ordering that does not exist in the current code,
   and depending on how an implementer resolves the ambiguity, the restore
   path's "already live?" reconciliation — the single most important safety
   check this ticket names — can be silently neutered on the very first
   restore.**
   `tasks.md` 3.3 says: "On dashboard startup (before the first poll/draw),
   read `queue-cache.js`... reconcile via `queue.reconcileRestored` against
   the first computed `runs` snapshot." But in `watch.js`, `runs` is `[]`
   until the first `draw()` call computes it (`watch.js:183`, `385`), and
   `draw()`'s own single `queue.tick()` call site is deliberately sequenced
   *before* that computation, against the prior poll's snapshot
   (`watch.js:356-366`'s comment explains why). There is no "first computed
   runs snapshot" available *before* the first poll/draw, as task 3.3
   instructs — that snapshot literally does not exist yet at that point in
   the program. A competent implementer reading task 3.3 could go two ways:
   (a) reconcile against the still-empty `runs = []` initialised at
   `watch.js:183`, in which case `isRunLive` returns false for every
   candidate and *nothing* is ever dropped as "already live" on a restore
   — i.e. the exact "ticket started by hand while this one was down must not
   be double-launched" property (design.md Goals, third bullet;
   proposal.md's "Already live?" bullet) silently does not hold on the very
   first restore reconciliation; or (b) restructure `draw()`'s first call
   to compute `sampleWindows()`/`reduce()` before reconciling, which is a
   real code change to the startup sequence that `design.md` never
   describes or acknowledges as necessary. **Required revision:**
   `design.md` (Decision 5) and `tasks.md` (3.3) must specify concretely
   *which* fleet snapshot restore-time reconciliation runs against — e.g.
   "compute one `sampleWindows()`/`reduce()` pass at startup, before
   `queueState` is set and before the alt-screen/poll timer are entered, and
   use that as the reconciliation snapshot" — rather than the currently
   self-contradictory "before the first poll/draw... against the first
   computed runs snapshot."

### Non-blocking notes

- `design.md`/`tasks.md` do not say whether `fleet.js`'s existing "▲ queue:
  N running · M queued" tail line (`lib/ui/screens/fleet.js:156-162`, gated
  only on `queueState` truthiness, not `confirmed`) should also render
  alongside the new "resumed — press X to continue" affordance for an
  unconfirmed restored queue, or be suppressed in favour of it. Not
  necessarily wrong either way, but worth the executor making an explicit
  choice rather than leaving it as an accidental side effect of an unguarded
  check.
- Decision 6's confirmation keybinding and the Open Questions' "cross-check
  event logs" item are both explicitly left to the executor's judgment in
  `design.md` — that is a reasonable, bounded deferral for a design gate,
  not a gap.
