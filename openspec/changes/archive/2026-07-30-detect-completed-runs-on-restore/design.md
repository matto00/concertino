## Context

CON-29's design (`openspec/changes/archive/2026-07-29-persist-restore-queue-tail/design.md`,
Decision 5) reconciles a restored queue's `pending` list against a
one-off startup fleet snapshot (`reduce(store.readAll(root, eventsCache),
sampleWindows(startupNow), startupNow)`, computed in `lib/ui/watch.js` before
the poll loop begins) using `queue.isRunLive`. `isRunLive(run)` is
`!!run && run.status !== 'done' && run.status !== 'failed'` — it treats "no
run object for this ticket at all" and "run object present but terminal" as
the same "not live" case, so both survive into the reconciled `pending` list
unchanged. The design doc names this explicitly as a known, accepted gap and
leaves closing it as an "open question... left to the executor's judgment."

Critically, `store.readAll(root, eventsCache)` already reads **every**
ticket directory under `.concertino/runs/` (`store.listTickets` lists all
subdirectories, not just ones tied to a live tmux window), and `reducer.js`'s
`reduce()` already produces a `run` object — with `status: 'done'|'failed'`
and `endedAt` set from the `run.end` event — for any ticket with a
completed run, live window or not. So `startupRuns` (the variable
`reconcileRestored` already receives) already carries the exact information
needed to close this gap. No additional per-ticket file read is needed; the
open question's "cost of N extra file reads" concern does not apply once you
look at where `startupRuns` actually comes from.

## Goals / Non-Goals

**Goals:**
- A pending ticket whose run reached a terminal state (`done` or `failed`)
  strictly after the persisted queue record's own `writtenAt` is treated
  distinctly from a pending ticket that never ran: it is dropped from the
  restored `pending` list and reported by id, not silently re-offered.
- Zero additional filesystem reads beyond what `watch.js`'s existing startup
  restore block already performs.
- A pending ticket whose terminal `run.end` predates `writtenAt` (a stale
  leftover from an earlier, unrelated run of the same ticket id, before this
  queue entry was ever written) is left alone — that ordering means the
  operator queued this ticket again on purpose, after any earlier run of it
  already finished, and this change must not second-guess that.

**Non-Goals:**
- No change to how `inFlight` is reconciled — an in-flight ticket that
  finishes during the downtime already correctly drops out of the restored
  `inFlight` Set today (Decision 5a's existing behavior); the ambiguity this
  change closes only exists for `pending`, where "not live" is currently
  the only signal.
- No change to the staleness bound (Decision 4, 24h) or to the
  confirm/unconfirmed flow (Decision 5/6) — this only sharpens what
  `pending` reconciliation reports, not when a restore is attempted or how
  confirmation works.
- Not reworking `isRunLive` itself — `tick()`'s own use of it (live-session
  reconciliation, not restore) is unaffected; the new logic lives alongside
  it in `reconcileRestored`, which already has its own bespoke restore-time
  contract distinct from `tick()`'s.

## Decisions

### Decision 1: Detect via `startupRuns`, not a separate event-log read
As established above, `reconcileRestored(record, runs)`'s existing `runs`
argument (the reducer's `startupRuns`) already has everything needed: a
terminal `run` object's `status` and `endedAt`. Add the check directly
inside `reconcileRestored` rather than adding a new helper that re-reads
`events.jsonl` — the data is already in hand at the one call site
(`watch.js`'s startup restore block) that needs it, and `reconcileRestored`
is deliberately still a filesystem-free, pure function (matching `tick()`'s
own contract, per `queue.js`'s file header) taking `runs` as a plain array.

Reconciliation still runs exactly **once**: `watch.js`'s startup block calls
`queue.reconcileRestored(queueRecord, startupRuns)` directly (rather than
only indirectly through `createRestoredQueue`) to obtain
`{ pending, inFlight, completedDuringDowntime }`, and `createRestoredQueue`
is refactored to accept that same already-computed result (or to call
`reconcileRestored` itself and have `watch.js` call it a second time only
for `completedDuringDowntime` — implementation detail left to the executor,
but the two call sites MUST NOT each run their own independent
reconciliation pass over `runs`, since that would let `pending`/`inFlight`
and `completedDuringDowntime` silently diverge if the two passes ever computed
different results).

### Decision 2: New return field `completedDuringDowntime`, reported independently of whether a queue restores
`reconcileRestored` returns `{ pending, inFlight, completedDuringDowntime }`.
`completedDuringDowntime` is the list of pending ticket ids dropped because
they matched the terminal-during-downtime condition (kept separate from the
plain `dropped`-by-liveness case, which `reconcileRestored` doesn't report
at all today — it only returns the survivors). Surfacing the list (rather
than just omitting the ids from `pending` with no further trace) matches the
proposal's requirement that the operator not lose visibility into what
happened to a ticket they might expect to see — the whole reason CON-29's
own mitigation was "surface the ids so a human can eyeball them" in the
first place.

**Revision after design-gate skeptic round 1:** the first draft of this
decision threaded `completedDuringDowntime` onto
`createRestoredQueue`'s return value, nested under `restoredFrom`. That is
wrong: `createRestoredQueue` still returns `null` whenever both `pending`
and `inFlight` end up empty (Decision 5/5a of the CON-29 design — unchanged
by this ticket, see Decision 3 below), which is exactly the scenario a short
queue that finished entirely overnight produces — every pending id lands in
`completedDuringDowntime`, nothing survives into `pending` or `inFlight`,
`createRestoredQueue` returns `null`, and a value nested inside that `null`
is unreachable. That is the single most likely real-world trigger for the
bug this ticket exists to fix, so silently losing the notice there defeats
the change. `completedDuringDowntime` is therefore **not** nested under
`restoredFrom`/`queueState` at all — see Decision 4, which delivers it via a
notice independent of whether `createRestoredQueue` returns a queue object.

### Decision 3: Terminal-during-downtime condition is `status is done/failed AND endedAt > record.writtenAt`; `createRestoredQueue`'s own null-return rule is unchanged
Using `status` alone (ignoring `writtenAt`) would also match a ticket that
finished long before this queue entry was ever persisted (e.g. `CON-12`
delivered a week ago; the operator explicitly queues `CON-12` again today).
That is a deliberate re-queue, not a downtime race, and must not be treated
as "completed while you were away." Comparing `endedAt` (set from the
`run.end` event's own timestamp, per `reducer.js`) against the record's own
`writtenAt` is the one signal that actually distinguishes "finished after we
last knew about this queue" from "finished a while ago, irrelevant to this
restore." A run with a terminal `status` but no `endedAt` is treated as not
matching (left in `pending`) rather than guessed at — this case is reachable
in practice, not just defensive: `deriveStatus` (`reducer.js`) also derives
`'failed'` from a dead-but-still-listed tmux window (`run.window &&
!run.window.alive`) without ever going through the `run.end`/`endedAt` path,
so a terminal status with no `endedAt` genuinely occurs for a window that
died rather than delivering cleanly.

`createRestoredQueue`'s existing "both `pending` and `inFlight` empty ⇒
return `null`" rule (CON-29 design.md Decision 5/5a — no empty-but-
confirmable queue) is **unchanged** by this ticket: a pending id moved into
`completedDuringDowntime` no longer counts toward `pending`, so a queue
whose every pending ticket completed during the downtime and has nothing
in-flight still correctly returns `null` — there is genuinely nothing left
to restore or confirm. What changes is that this no longer means the
operator hears nothing about it: see Decision 4.

### Decision 4: The completed-during-downtime notice is delivered independently of `queueState`, not nested inside it
`createRestoredQueue` returning `null` in the all-caught-up-and-also-
everything-finished case (Decision 3) must not also discard
`completedDuringDowntime` — that was the design-gate skeptic's core finding
against the first draft of this design, which nested the list under
`restoredFrom` and therefore lost it in exactly that case.

`completedDuringDowntime` is instead surfaced through a new sticky notice
variable in `watch.js`, structurally identical to the existing `queueNotice`
variable's lifecycle (module-scoped, set once when non-empty, persists
across polls until overwritten, threaded through to `draw()`'s render
options alongside `queueNotice`/`queueState`) — call it `restoreNotice`.
`watch.js`'s startup restore block sets it once, before the poll loop
begins, from the `completedDuringDowntime` produced by the single
reconciliation pass (Decision 1), independently of whatever
`createRestoredQueue` itself returns.

`lib/ui/screens/fleet.js`'s `buildHeadTail` renders `restoreNotice` as its
own tail line, gated only on the notice being non-empty — **not** on
`queueState` being present or on `queueState.confirmed === false` — e.g.:

```
▲ resumed from a previous session — press x to continue
▲ 2 ticket(s) completed while you were away and were not restored: CON-12, CON-14
```

The two lines are independent facts that happen to co-occur in the common
case (some pending tickets survive, some don't) but must each render on
their own when only one is true: `restoreNotice` alone (nothing left to
restore, but something finished during the downtime) with no "resumed from
a previous session" line, or the reverse (a restored queue with nothing
flagged as completed). Rendered via the same `f.yellow`/truncate pattern the
existing restore line uses, truncated the same way `queueNotice` already is
(`f.truncate(..., cols - 4)`) since the id list is unbounded in principle.

## Risks / Trade-offs

- [Risk] `endedAt` comparison assumes the reducer's timestamps and the
  queue-cache's `writtenAt` are both `Date.now()`-based epoch ms from the
  same machine clock — already true today (both `queue-cache.js` and every
  event emitter use `Date.now()`), so no new clock-skew exposure beyond what
  the existing staleness bound (Decision 4 of CON-29) already accepts.
- [Trade-off] A ticket whose run.end lands in the same millisecond as
  `writtenAt` is treated as NOT completed-during-downtime (`>`, not `>=`) —
  an intentional bias toward "ambiguous timing keeps the existing, already-
  shipped behavior (re-offer it)" rather than a new behavior guessing wrong
  in the other direction on a boundary that will essentially never occur in
  practice (write and a separate process's terminal event landing in the
  same ms).

## Migration Plan

Purely additive to an already-additive CON-29 feature: `reconcileRestored`'s
new `completedDuringDowntime` return field and `watch.js`'s new
`restoreNotice` variable are both new, never-previously-populated additions
— no existing caller reads a shape that changes underneath it, and
`queueState`'s own shape is untouched (Decision 4 deliberately keeps this
out of `queueState`). `fleet.js`'s new banner line only ever renders when
`restoreNotice` is non-empty, so a queue restored by an older-format cache
record (no behavioral difference — the record shape itself is unchanged)
simply never triggers the new line. No rollback concern beyond reverting the
code.
