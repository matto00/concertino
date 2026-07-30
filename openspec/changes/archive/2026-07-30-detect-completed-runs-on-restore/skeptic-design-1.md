## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/fleet-queue-visibility/spec.md` in full.
- Read ground truth: `lib/ui/queue.js` (full), `lib/ui/queue-cache.js` (full),
  `lib/ui/reducer.js` (lines 1-239, `applyEvent`/`deriveStatus`/`reduce`),
  `lib/ui/watch.js` (startup restore block, lines 688-702), and
  `lib/ui/screens/fleet.js`'s `buildHeadTail` (lines 186-260).
- Read the archived CON-29 design's Decision 5/5a and "Open Questions"
  (`openspec/changes/archive/2026-07-29-persist-restore-queue-tail/design.md`)
  to confirm the precedent this change extends, in particular the "if
  reconciliation leaves both pending and inFlight empty... no queue is
  restored at all" rule (line 61) and the un-addressed open question this
  ticket exists to close (lines 79).
- Confirmed `reduce()`'s `store.readAll` already reads every ticket
  directory unconditionally (`store.listTickets`), so the proposal's "zero
  additional file reads" claim is accurate — `startupRuns` genuinely already
  carries `status`/`endedAt` for every ticket, live window or not.
- Confirmed no other caller of `reconcileRestored`/`createRestoredQueue`
  exists besides `watch.js` (`grep -rn` across the repo, excluding
  `node_modules`) and existing tests, so the signature-widening plan doesn't
  have a hidden call site to break.
- Confirmed `reducer.js`'s `applyEvent` sets `endedAt`/`endStatus` only in
  the `run.end` case (line 94-97), so Decision 3's core comparison
  (`endedAt > record.writtenAt`) is well-formed for the common case.
- Traced `fleet.js`'s existing restore-affordance line (line 230): it is
  gated on `queueState.confirmed === false && (inFlightCount ||
  pendingCount)` — i.e. it (and, per task 2.1/2.2, the new notice line
  appended after it) only ever renders when the restored queue is
  *non-empty*.

### Verdict: REFUTE

### Change Requests

1. **The design silently discards the `completedDuringDowntime` notice in
   exactly the scenario the ticket exists to fix — the case where an
   operator's whole restored queue already completed during the downtime.**

   - `tasks.md` 1.4 explicitly re-confirms `createRestoredQueue`'s existing
     "both `pending` and `inFlight` empty → return `null`" rule
     (`lib/ui/queue.js:207`) is *unaffected* by this change: a pending id
     moved into `completedDuringDowntime` no longer counts toward `pending`,
     so if every persisted pending id is dropped this way and no persisted
     `inFlight` id survives, `createRestoredQueue` returns `null`.
   - When it returns `null`, `watch.js`'s startup block never assigns
     `queueState` (`lib/ui/watch.js:697-699`), so `fleet.js`'s
     `buildHeadTail` — which only reads `restoredFrom.completedDuringDowntime`
     off a non-null `queueState` — has nothing to render the new notice
     from. The `completedDuringDowntime` array Decision 2 computes is built
     and then thrown away with the rest of the discarded restore object.
   - This directly contradicts the modified requirement's own unconditional
     language in `specs/fleet-queue-visibility/spec.md` lines 20-21: "Ticket
     ids dropped for this reason SHALL be reported separately (as
     `completedDuringDowntime`)" — there is no carve-out in that sentence for
     "unless nothing else survives reconciliation," yet that is exactly what
     `tasks.md` 1.4 codifies.
   - It also directly contradicts the ticket's own motivating scenario
     (`ticket.md` "Consequence": "An operator resuming a restored queue could
     re-launch a ticket that already delivered successfully during the
     downtime"). The single most likely real-world trigger for this bug is a
     short queue (1-3 tickets) that *all* finished overnight while the
     dashboard was closed — precisely the case where `pending` fully drains
     into `completedDuringDowntime` and no `inFlight` survives. Under the
     current design, that operator opens the dashboard to... nothing. No
     "resumed from a previous session" line, no completed-during-downtime
     notice, no queue at all — the exact silent ambiguity CON-37 was written
     to close, now reproduced one level up (at the "was anything even
     queued?" level instead of the "which pending ticket already ran?"
     level).
   - `tasks.md` 2.2 compounds this: it asks the executor to "verify the new
     line never renders on its own without the existing resume-affordance
     line (it shouldn't be reachable...)" — i.e. it encodes as an *invariant
     to defend* the exact configuration (no pending/inFlight survivors, but
     a non-empty `completedDuringDowntime`) that a correct fix needs to make
     reachable. As currently written, the design and the test plan actively
     guard against fixing this gap rather than closing it.
   - **Required revision** (pick one, and update `design.md` Decision 2/4,
     `tasks.md` 1.4/2.1/2.2, and the spec scenario at
     `specs/fleet-queue-visibility/spec.md` lines 107-113 to match):
     - (a) Change `createRestoredQueue`'s null-return condition to also keep
       a (non-null) restored-queue object alive whenever
       `completedDuringDowntime` is non-empty, even if both `pending` and
       `inFlight` end up empty — and update `fleet.js`'s banner so the
       completed-during-downtime notice can render standalone (without
       requiring the "resumed from a previous session — press X to
       continue" line, which is meaningless when there is nothing left to
       resume/confirm), or
     - (b) Deliver the notice through a path independent of `queueState`
       entirely (e.g. a one-shot startup `queueNotice`-style message set
       directly in `watch.js`'s startup restore block when
       `completedDuringDowntime` is non-empty, regardless of whether
       `createRestoredQueue` itself returns null).
     Either way, the spec's "alongside (not instead of) the resume
     affordance" phrasing (line 113) needs to be revisited — it currently
     assumes the resume affordance is always present whenever
     `completedDuringDowntime` is non-empty, which is not a real invariant
     once `pending` can be fully drained by this exact change.

### Non-blocking notes

- `design.md` Decision 3 states a terminal `status` with no `endedAt` "should
  not happen per `reducer.js`'s `applyEvent`." This is not quite accurate:
  `deriveStatus` (`lib/ui/reducer.js:168-175`) also derives `'failed'` from
  `run.window && !run.window.alive` (a dead-but-still-listed tmux window)
  *without* ever going through the `run.end`/`endedAt` path — so a terminal
  status with `endedAt == null` is a real, reachable case, not just a
  defensive one. This doesn't change the correctness of the decision itself
  (leaving such a ticket in `pending` rather than guessing is still the
  right call, and is what the code as specified will do), but the design's
  rationale for *why* is slightly wrong — worth a one-line correction so a
  future reader doesn't rely on the "can't happen" framing elsewhere.
- Separately (out of scope for this change, flagged for awareness only):
  `events.jsonl` accumulates across every historical run of the same ticket
  id (`scripts/concertino/setup-worktree.sh` never resets it, and
  `retention.js` only prunes it ~30 days after a `run.end`), and
  `applyEvent`'s `run.start`/`run.end` handling always overwrites
  `startedAt`/`endedAt`/`endStatus` with the *last* event of that kind seen,
  not the pair belonging to the current run. That means a ticket re-queued
  and relaunched after an earlier completion, whose *new* run is still
  in-flight and has not yet emitted its own `run.end`, can fold to
  `status: 'done'` (from the stale old `run.end`) even while genuinely
  running — a latent bug in the existing `isRunLive`-based `inFlight`
  reconciliation, unrelated to this change (which explicitly leaves
  `inFlight` reconciliation untouched) and not something CON-37 needs to fix,
  but worth a ticket of its own.
