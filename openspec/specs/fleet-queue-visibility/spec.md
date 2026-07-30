# fleet-queue-visibility Specification

## Purpose
Defines how the dashboard's fleet view (`lib/ui/screens/fleet.js`) renders the launch pad's in-memory queue as a visible, trimmable QUEUED section, and guarantees that doing so never perturbs the row-index contract `watch.js` uses to resolve a selected row to a run.
## Requirements
### Requirement: A non-empty queue renders a QUEUED section on the fleet view
The fleet view (`lib/ui/screens/fleet.js`) SHALL render a `QUEUED` section
whenever `queueState.pending` is non-empty, positioned after `RUNNING` and
before `FAILED`. The section title SHALL include the count of pending
tickets and the queue's concurrency cap (e.g.
`QUEUED (3, running 1 at a time)`). The section SHALL NOT render when
`queueState` is absent or `queueState.pending` is empty.

#### Scenario: A queued batch renders its own section
- **WHEN** the fleet view renders with `queueState.pending` containing one
  or more ticket ids
- **THEN** the output includes a `QUEUED` section positioned after `RUNNING`
  and before `FAILED`, titled with the pending count and
  `queueState.maxConcurrent`

#### Scenario: No queue, no section
- **WHEN** `queueState` is `null`, or `queueState.pending` is empty
- **THEN** no `QUEUED` section is rendered, and the rest of the fleet view is
  unaffected

### Requirement: A queued row shows only data that actually exists
Each queued row SHALL render as exactly one line: its 1-based position in the queue, the ticket id, the ticket's title if present in the on-disk ticket cache, and the batch's speed and agent-merge setting parsed from `queueState.launchCommand`. A queued row SHALL NOT show a status, phase, elapsed time, or progress bar, since none of that data exists for a ticket that has not started. The speed and agent-merge setting are per-batch properties (parsed once from `queueState.launchCommand`, not stored or re-derived per ticket) — every row in a given QUEUED section SHALL show the same speed/agent-merge values. When `queueState.launchCommand` carries no agent-merge flag token at all (a custom launch-command override with no `{{TICKET}}` placeholder), the agent-merge field SHALL be omitted rather than showing a fabricated on/off value.

#### Scenario: A queued row with a cached title
- **WHEN** a pending ticket's id is present in the ticket-title lookup passed to the fleet screen
- **THEN** its queued row shows the queue position, the ticket id, and the title, on a single line

#### Scenario: A queued row with no cached title
- **WHEN** a pending ticket's id has no entry in the ticket-title lookup
- **THEN** its queued row shows the queue position and the ticket id only, with no fabricated title, status, or progress indicator

#### Scenario: A queued row shows the batch's speed and agent-merge setting
- **WHEN** `queueState.launchCommand` carries an explicit speed token and an explicit `--agent-merge`/`--no-agent-merge` flag
- **THEN** every queued row in the QUEUED section shows that same speed and agent-merge setting, in addition to its position/ticket-id/title

#### Scenario: A queued row omits agent-merge when the launch command carries no flag
- **WHEN** `queueState.launchCommand` is a custom override with no `{{TICKET}}` placeholder and therefore no agent-merge flag token
- **THEN** queued rows omit the agent-merge field rather than showing a fabricated on/off value

### Requirement: QUEUED respects the existing height-budget and cap machinery
The `QUEUED` section SHALL participate in the same trimming machinery as
`RUNNING`/`FAILED`/`DONE` — the section's shown-row count SHALL be reduced
under the same terminal-height budget as the other capped sections, and a
trimmed `QUEUED` section SHALL show a `… and N more queued` line identical
in form to the existing capped sections' overflow line. `QUEUED` SHALL NOT
be `pinned`; `NEEDS YOU` SHALL remain the only pinned section.

#### Scenario: A long queue is trimmed like FAILED/DONE
- **WHEN** the terminal height budget forces the fleet view to trim
  sections and `QUEUED` has more pending tickets than its capped display
  count
- **THEN** `QUEUED` is trimmed to its cap and shows a
  `… and N more queued` line, exactly as `FAILED`/`DONE` do today

#### Scenario: NEEDS YOU remains the only pinned section
- **WHEN** the trimming loop reduces section row counts under a height
  budget
- **THEN** `NEEDS YOU` is never trimmed, and `QUEUED` is trimmed like any
  other non-pinned section

### Requirement: Inserting QUEUED never perturbs the row-index a selection resolves to
Queued rows SHALL NOT consume a slot in the row-index space used to resolve
`state.selected` to a run. The row index that advances once per
run-corresponding row (rendered or hidden-under-cap) SHALL skip advancement
entirely for the `QUEUED` section, so that any row rendered in `FAILED` or
`DONE` below a non-empty `QUEUED` section resolves to the exact same run it
would have resolved to had `QUEUED` not been rendered at all.

#### Scenario: Selecting a row below a non-empty QUEUED section resolves the correct run
- **WHEN** the fleet view renders `RUNNING`, a non-empty `QUEUED` section,
  and `FAILED` sections together, and a row within `FAILED` is selected
- **THEN** the ticket resolved for that selection (via `runs[selected]`) is
  the same run that row displays, unaffected by how many rows `QUEUED`
  rendered above it

#### Scenario: Queued rows are never marked as the selected row
- **WHEN** the fleet view renders with a non-empty `QUEUED` section and any
  value of `state.selected` valid for the current `runs` array
- **THEN** no row within the `QUEUED` section is ever rendered with the
  selection marker

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

### Requirement: Entering QUEUED focus SHALL never perturb the row-index a run selection resolves to
Entering or leaving QUEUED-local focus (see the `fleet-section-jump` and `fleet-queue-force-start` capabilities) SHALL NOT alter `state.selected` or the row-index space `runs[state.selected]` resolves against. This holds the existing "Inserting QUEUED never perturbs the row-index a selection resolves to" requirement's guarantee even now that QUEUED has its own, independent navigable cursor.

#### Scenario: Round-tripping through QUEUED focus leaves run selection resolution unchanged
- **WHEN** `state.selected` resolves to a given run, the operator jumps into QUEUED focus, moves the QUEUED-local cursor, and exits QUEUED focus
- **THEN** `state.selected` still resolves to the exact same run it did before entering QUEUED focus

