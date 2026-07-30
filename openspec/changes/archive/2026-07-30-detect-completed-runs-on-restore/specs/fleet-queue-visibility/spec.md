## MODIFIED Requirements

### Requirement: A fresh, non-stale queue file is restored on startup as paused and unconfirmed
The dashboard SHALL attempt to read `.concertino/cache/queue.json` on
`concertino watch` startup, reconciled against a single explicit fleet
snapshot computed once at startup before the regular poll loop begins (not
against an empty or stale `runs` array — see the companion requirement on
concurrency reconstruction below for why this snapshot also governs
`inFlight`). A record whose write timestamp is within a fixed staleness
bound SHALL have its `pending` list reconciled against that startup
snapshot using the same live-run predicate `queue.tick()` uses
(`queue.isRunLive`): any pending ticket id already live is dropped from the
restored pending list. Independently of liveness, a pending ticket id whose
run in the startup snapshot has reached a terminal state (`done` or
`failed`) with an end timestamp strictly after the record's own write
timestamp SHALL also be dropped from the restored pending list — it
completed during the downtime, not before this queue entry was written, and
SHALL NOT be re-offered to the operator as if it had never started. Ticket
ids dropped for this reason SHALL be reported separately (as
`completedDuringDowntime`) from ticket ids that simply never appear in the
restored queue for any other reason. If any pending ticket ids remain after
both reconciliations, the dashboard SHALL restore them into `queueState`
with an explicit `confirmed: false` flag; no restored queue SHALL ever
begin ticking (and therefore SHALL never launch any ticket) until an
operator explicitly confirms it. A record that is missing, malformed, or
outside the staleness bound SHALL be treated as empty — no queue is
restored, and no error is surfaced to the operator.

#### Scenario: A fresh queue file restores as unconfirmed
- **WHEN** the dashboard starts and finds a `queue.json` written within the
  staleness bound, naming pending tickets none of which are currently live
- **THEN** `queueState` is populated with those pending tickets and
  `confirmed: false`, and no ticket from it is launched on the first poll

#### Scenario: A pending ticket already live at restore time is dropped
- **WHEN** the dashboard restores a queue file naming a pending ticket that
  the current fleet snapshot shows as live (started by hand or by another
  dashboard during the downtime)
- **THEN** that ticket is excluded from the restored `queueState.pending`,
  exactly as `queue.tick()` would drop it during normal operation

#### Scenario: A pending ticket that completed during the downtime is dropped and reported distinctly
- **WHEN** the dashboard restores a queue file naming a pending ticket whose
  run in the startup fleet snapshot has status `done` or `failed` with an
  end timestamp after the queue file's own write timestamp
- **THEN** that ticket is excluded from the restored `queueState.pending`
  and its id is included in `completedDuringDowntime`, distinct from a
  ticket dropped for being already live

#### Scenario: A pending ticket whose terminal run predates the queue file is not treated as completed during downtime
- **WHEN** the dashboard restores a queue file naming a pending ticket whose
  run in the startup fleet snapshot has a terminal status, but its end
  timestamp is at or before the queue file's own write timestamp (e.g. an
  earlier, unrelated run of the same ticket id that finished before this
  queue entry was written)
- **THEN** that ticket survives reconciliation into the restored
  `queueState.pending`, exactly as it would if no run record existed for it
  at all

#### Scenario: A stale queue file is not restored
- **WHEN** the dashboard starts and finds a `queue.json` whose write
  timestamp is older than the staleness bound
- **THEN** no queue is restored, `queueState` stays `null`, and the stale
  file is not surfaced as an error

#### Scenario: A missing or malformed queue file is not restored
- **WHEN** `.concertino/cache/queue.json` does not exist, or exists but is
  not valid JSON matching the expected shape
- **THEN** no queue is restored, `queueState` stays `null`, and the
  dashboard starts exactly as it would with no queue file at all

#### Scenario: Reconciliation that empties both pending and in-flight restores nothing
- **WHEN** every pending ticket id in an otherwise-fresh queue file is
  already live at restore time, and no persisted in-flight ticket id is
  still live either
- **THEN** no queue is restored at all, rather than restoring an empty,
  confirmable-but-inert queue

### Requirement: An unconfirmed restored queue never launches until the operator confirms it
While `queueState.confirmed` is `false`, the dashboard SHALL NOT call
`queue.tick()` against that queue on any poll, and therefore SHALL NOT
launch any ticket from it. The QUEUED section (`lib/ui/screens/fleet.js`)
SHALL render an unconfirmed restored queue with an explicit affordance
distinguishing it from a normal in-session queue, indicating that it was
resumed from a previous session and naming the ticket ids it would launch,
with a key the operator can press to confirm it. Confirming SHALL set
`confirmed: true` and SHALL NOT otherwise alter the queue's pending or
in-flight contents; the very next poll SHALL then tick the queue exactly as
a same-session queue would.

#### Scenario: An unconfirmed queue does not tick
- **WHEN** `queueState.confirmed` is `false` on a poll
- **THEN** `queue.tick()` is not called for that queue, and no ticket from
  its pending list is launched on that poll

#### Scenario: The QUEUED section shows a resume affordance for an unconfirmed queue
- **WHEN** the fleet view renders with a `queueState` whose `confirmed` is
  `false`
- **THEN** the QUEUED section shows the pending ticket ids alongside a
  "resumed from a previous session — press <key> to continue" affordance,
  distinct from the normal QUEUED row rendering

#### Scenario: Confirming a restored queue lets it start ticking
- **WHEN** the operator presses the confirm key while an unconfirmed
  restored queue is displayed
- **THEN** `queueState.confirmed` becomes `true` with pending/in-flight
  contents unchanged, and the following poll's `queue.tick()` call proceeds
  normally against it

## ADDED Requirements

### Requirement: The dashboard reports ticket ids that completed during the downtime independently of whether a queue is restored
The dashboard SHALL surface a notice naming any pending ticket ids that
startup restore reconciliation (see the companion requirement on restoring
a fresh, non-stale queue file) dropped because their run completed during
the downtime, regardless of whether any pending or in-flight ticket ids
survive reconciliation to form a restorable queue. This notice SHALL NOT
depend on `queueState` being non-null, and SHALL NOT be gated on the
"resumed from a previous session" affordance being shown — the two are
independent facts that happen to co-occur in the common case: one says what
is still queued, the other says what already finished without the operator.
When no ticket ids were dropped for this reason, no such notice is shown.

#### Scenario: A completed-during-downtime notice accompanies a partially-restored queue
- **WHEN** some (but not all) of a queue file's pending ticket ids are
  dropped because their run completed during the downtime, and at least one
  pending or in-flight ticket id survives reconciliation
- **THEN** the dashboard restores a queue with the survivors, and
  separately shows a notice naming the ticket ids that completed during the
  downtime

#### Scenario: A completed-during-downtime notice appears even when nothing is left to restore
- **WHEN** every one of a queue file's pending ticket ids is dropped
  because its run completed during the downtime, and no persisted in-flight
  ticket id survives reconciliation either, so nothing is restored into
  `queueState`
- **THEN** the dashboard still shows a notice naming the completed-during-
  downtime ticket ids, even though no "resumed from a previous session"
  affordance is shown and no queue is restored

#### Scenario: No notice when nothing completed during the downtime
- **WHEN** startup restore reconciliation runs and no pending ticket id is
  dropped for having completed during the downtime
- **THEN** no completed-during-downtime notice is shown
