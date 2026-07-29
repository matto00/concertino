## ADDED Requirements

### Requirement: The pending queue is persisted to disk on every tick and removed when idle
The dashboard SHALL write the queue's pending tail, in-flight ticket ids,
and metadata (`maxConcurrent`, `launchCommand`, a session id, and a write
timestamp) to `.concertino/cache/queue.json` whenever `lib/ui/watch.js`
calls `queue.tick()` and the resulting queue is not idle (per
`queue.isIdle`), using a temp-file-then-rename write identical in pattern to
`lib/ui/cache.js`'s `linear.json` write. When the resulting queue is idle,
the dashboard SHALL remove `.concertino/cache/queue.json` if present. The
persisted record SHALL contain only ticket ids and queue metadata — no
ticket titles, descriptions, or other Linear payload.

#### Scenario: An active queue is written on every tick
- **WHEN** `queue.tick()` returns a non-idle queue
- **THEN** `.concertino/cache/queue.json` is written with the queue's
  current pending ids, in-flight ids, `maxConcurrent`, `launchCommand`, a
  session id, and the write timestamp

#### Scenario: An idle queue has no persisted file
- **WHEN** `queue.tick()` returns an idle queue (nothing pending, nothing
  in flight)
- **THEN** `.concertino/cache/queue.json` is removed if it exists

#### Scenario: The persisted record carries no ticket bodies
- **WHEN** the queue file is written
- **THEN** its contents are limited to ticket ids and queue metadata, with
  no ticket title, description, or other fetched Linear content present

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
restored pending list. If any pending ticket ids remain after
reconciliation, the dashboard SHALL restore them into `queueState` with an
explicit `confirmed: false` flag; no restored queue SHALL ever begin
ticking (and therefore SHALL never launch any ticket) until an operator
explicitly confirms it. A record that is missing, malformed, or outside the
staleness bound SHALL be treated as empty — no queue is restored, and no
error is surfaced to the operator.

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

### Requirement: A restored queue reconstructs in-flight concurrency occupancy, not just the pending list
The dashboard SHALL reconstruct the restored queue's `inFlight` set from
the persisted record's in-flight ticket ids, keeping only those still live
per `queue.isRunLive` against the startup reconciliation snapshot. A ticket
still genuinely running at restart time SHALL continue to occupy a
concurrency slot in the restored queue exactly as it did before the
restart, so that a queue's `maxConcurrent` invariant — including a
`maxConcurrent: 1` (sequential) batch never running two tickets at once —
holds across a dashboard restart and is not silently broken by restore
forgetting an in-flight ticket's occupied slot.

#### Scenario: A still-running ticket keeps occupying its concurrency slot after restore
- **WHEN** a queue file persisted with one ticket in-flight is restored,
  and the fleet snapshot at restore time shows that ticket still live
- **THEN** the restored queue's `inFlight` set contains that ticket, and
  confirming the restored queue does not launch a new ticket while that
  slot remains occupied, even under `maxConcurrent: 1`

#### Scenario: A finished in-flight ticket frees its slot on restore
- **WHEN** a queue file persisted with one ticket in-flight is restored,
  and the fleet snapshot at restore time shows that ticket is no longer
  live (its run reached a terminal state during the downtime)
- **THEN** the restored queue's `inFlight` set does not contain that
  ticket, and its concurrency slot is available once the queue is
  confirmed

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
