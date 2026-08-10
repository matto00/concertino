# fleet-failed-remediation Specification

## Purpose
Gives a FAILED fleet row its own meaningful actions (`a` to address, `d` to mark done) so an operator can hand a failed run off for automated remediation or manually clear it, instead of every row sharing one generic action set.
## Requirements
### Requirement: `a`/`d` bind at the fleet screen's top level, conditioned on `focus === 'runs'` and the selected row being FAILED
`lib/ui/screens/fleet/keys.js`'s `handleKey` SHALL bind `a` and `d`,
alongside the existing `t`/`l` bindings (no new focus mode), active only
when `focus === 'runs'` AND `runs[selected]` is present AND
`runs[selected].status === 'failed'`. `a` SHALL resolve to
`{ type: 'address-failure', ticket: runs[selected].ticket }`; `d` SHALL
resolve to `{ type: 'open-mark-done-confirm', ticket: runs[selected].ticket }`.
Neither key SHALL introduce a new local-cursor state field or change
digit-jump behavior. The explicit `focus === 'runs'` condition is required:
without it, these bindings would leak through the `focus === 'queue'`/
`focus === 'quickstart'` blocks and could fire against a stale, off-screen
`runs[selected]` while one of those sections is locally focused — neither
block claims or suppresses `a`/`d` the way both already suppress
`\r`/`l`/`n`/`N`.

#### Scenario: `a` on a FAILED selected row resolves to address-failure
- **GIVEN** `focus === 'runs'` and `runs[selected].status === 'failed'`
- **WHEN** the operator presses `a`
- **THEN** the resolved action is `{ type: 'address-failure', ticket: runs[selected].ticket }`

#### Scenario: `d` on a FAILED selected row opens the mark-done confirm
- **GIVEN** `focus === 'runs'` and `runs[selected].status === 'failed'`
- **WHEN** the operator presses `d`
- **THEN** the resolved action is `{ type: 'open-mark-done-confirm', ticket: runs[selected].ticket }`

#### Scenario: `a`/`d` are no-ops on a non-FAILED selected row
- **GIVEN** `focus === 'runs'` and `runs[selected].status` is `'running'` (or
  any value other than `'failed'`)
- **WHEN** the operator presses `a` or `d`
- **THEN** `handleKey` returns `null` for both (falling through to whatever
  else, if anything, those keys already do elsewhere in the function)

#### Scenario: `a`/`d` are no-ops while QUEUED or QUICK START is locally focused, even if the (off-screen) selected row is FAILED
- **GIVEN** `runs[selected].status === 'failed'`
- **AND** `focus` is `'queue'` or `'quickstart'` (entering that focus never
  changes `selected`, so a FAILED row can remain selected-but-off-screen)
- **WHEN** the operator presses `a` or `d`
- **THEN** `handleKey` returns `null` for both — neither
  `address-failure` nor `open-mark-done-confirm` is resolved against the
  off-screen FAILED row

### Requirement: `a` on a claude-code FAILED run opens a new tmux window running `/concertino-address-failure` in the run's existing worktree
The dashboard SHALL, on `address-failure` for a resolved run whose `harness`
is `claude-code`, launch a new tmux window addressed by that run's ticket id,
running `/concertino-address-failure <TICKET>` — reusing the existing
`session.spawn`/launcher spawn path, which already replaces any existing
(dead) window under that ticket's name rather than requiring new
window-addressing plumbing. When the resolved run's `harness` is not
`claude-code`, `a` SHALL instead be a no-op that sets an inline notice
explaining `/concertino-address-failure` is not yet available for that
harness, rather than silently doing nothing or attempting to spawn anyway.

#### Scenario: `a` on a claude-code FAILED run spawns the address-failure window
- **GIVEN** a FAILED run with `harness: 'claude-code'`
- **WHEN** the operator presses `a` while that run is selected
- **THEN** a tmux window addressed by that run's ticket id is created (or
  replaced, if one already existed) running `/concertino-address-failure
  <TICKET>`

#### Scenario: `a` on a non-claude-code FAILED run shows an inline notice instead of spawning
- **GIVEN** a FAILED run with `harness: 'codex'`
- **WHEN** the operator presses `a` while that run is selected
- **THEN** no tmux window is created or replaced
- **AND** an inline notice explains `/concertino-address-failure` is not yet
  available for that harness

### Requirement: `d` marks the run DONE on the dashboard, behind a `y` confirmation with an on-screen banner, without rewriting telemetry
`open-mark-done-confirm` SHALL set `state.markDoneConfirm = { ticket }`.
While set, `sections.js`'s `buildHeadTail` SHALL render an on-screen
confirmation banner naming the ticket, following the same rendering
treatment `forceStartConfirm`/`clearQueueConfirm` already receive (threaded
through `render.js`'s `render()` and `watch.js`'s `draw()` opts — not merely
intercepted at the keypress level). Any key other than `y` SHALL cancel
(`state.markDoneConfirm = null`) without effect. On `y`, the dashboard SHALL
append a `run.override` event directly to
`.concertino/runs/<TICKET>/events.jsonl`, in-process (mirroring
`session.js`'s existing `run.spawn` in-process write — `role: 'dashboard'`),
carrying `status: 'done'`. This SHALL NOT write, modify, or delete any other
event in the log, and SHALL NOT contact the ticket provider.

#### Scenario: The confirm banner is visible while markDoneConfirm is set
- **GIVEN** `state.markDoneConfirm` is set for a ticket
- **WHEN** the fleet screen renders
- **THEN** an on-screen banner naming that ticket is visible, the same way
  `forceStartConfirm`'s banner already is

#### Scenario: `d` then anything but `y` cancels without effect
- **GIVEN** `state.markDoneConfirm` is set
- **WHEN** the operator presses any key other than `y`
- **THEN** no `run.override` event is written and `state.markDoneConfirm` becomes `null`

#### Scenario: `d` then `y` writes a `run.override` event
- **GIVEN** `state.markDoneConfirm` is set for a ticket
- **WHEN** the operator presses `y`
- **THEN** a `run.override` event with `status: 'done'` and `role: 'dashboard'`
  is appended to that run's `events.jsonl`
- **AND** no other event in the log is modified

### Requirement: A run with a `run.override` event reports that overridden status, at the highest precedence
`lib/ui/reducer.js`'s `deriveStatus` SHALL return the status carried by a
run's most recently-applied `run.override` event, ahead of every other
precedence branch (live escalation, `endStatus`, window liveness), for as
long as that event is present in the run's log. `applyEvent` SHALL set
`run.override` from a `run.override` event's `status` field.

#### Scenario: A FAILED run with a `run.override` status of done reports as done
- **GIVEN** a run's event log contains a `run.end` event with a non-delivered
  status (e.g. `escalated`)
- **AND** the log subsequently contains a `run.override` event with
  `status: 'done'`
- **WHEN** the dashboard reduces this run's events
- **THEN** `run.status` is `'done'`
- **AND** the run appears in the DONE section, not FAILED

#### Scenario: A run with no `run.override` event is unaffected
- **GIVEN** a run's event log contains no `run.override` event
- **WHEN** the dashboard reduces this run's events
- **THEN** `run.status` is derived exactly as before this change

### Requirement: A FAILED run respawned by `a` reports `running`, not the stale terminal status, while its new window is alive
`deriveStatus`'s existing `run.endStatus` branch SHALL be refined so that,
when the run's tmux window is alive AND `run.spawnedAt` is later than
`run.endedAt` (or `run.endedAt` is null), the run reports `'running'` instead
of the stale `endStatus`-derived value. Once the window dies again, or a new
`run.end` event lands (updating `endedAt`/`endStatus` to a value at or after
the current `spawnedAt`), the ordinary `endStatus`/window-liveness precedence
applies unchanged.

#### Scenario: A respawned FAILED run shows RUNNING while its new window is alive
- **GIVEN** a run's event log contains a `run.end` event with a non-delivered
  status
- **AND** a subsequent `run.spawn` event (from `a` re-spawning the window)
- **AND** the run's tmux window is currently alive
- **WHEN** the dashboard reduces this run's events
- **THEN** `run.status` is `'running'`

#### Scenario: Once the respawned window dies with no new run.end, the run reverts to failed
- **GIVEN** the run from the scenario above
- **WHEN** the tmux window is subsequently reported dead, with no new
  `run.end` event having landed
- **THEN** `run.status` is `'failed'`

#### Scenario: Once the respawn concludes with a new run.end, the newest status wins
- **GIVEN** the run from the first scenario above
- **WHEN** a new `run.end` event with `status: 'delivered'` is subsequently
  logged
- **THEN** `run.status` is `'done'`

### Requirement: The FAILED section's footer hint advertises `a`/`d` only while applicable
`sections.js`'s footer-hint construction for the FAILED section SHALL
advertise `a address` / `d done` only when a FAILED section is actually
rendered this frame, following the same "only advertise a key that currently
does something" discipline `f force-start`/`C clear queue` already follow
for QUEUED.

#### Scenario: No FAILED section on screen means no FAILED hint
- **GIVEN** the fleet screen has no FAILED runs this frame
- **WHEN** the footer hints are built
- **THEN** the hint text does not include `a address` or `d done`

### Requirement: `a`/`d` apply to the full FAILED multi-select set, when non-empty, instead of just the cursor row

When `state.multiSelect.failed` is non-empty, pressing `a` or `d` while `focus === 'runs'` (regardless of which row the cursor is currently on) SHALL resolve to a bulk action instead of the existing single-row one: `a` resolves to `{ type: 'open-bulk-address-confirm', tickets: [...state.multiSelect.failed] }`; `d` resolves to `{ type: 'open-bulk-mark-done-confirm', tickets: [...state.multiSelect.failed] }`. When `state.multiSelect.failed` is empty, `a`/`d` behave exactly as before this change (resolving against `runs[selected]` alone).

#### Scenario: `a` with a non-empty FAILED multi-select set opens the bulk address confirm
- **GIVEN** `focus === 'runs'` and `state.multiSelect.failed` contains 3
  tickets
- **WHEN** the operator presses `a`
- **THEN** the resolved action is `{ type: 'open-bulk-address-confirm',
  tickets: [...those 3 tickets] }`, not a single-ticket `address-failure`

#### Scenario: `d` with an empty FAILED multi-select set behaves exactly as before
- **GIVEN** `focus === 'runs'`, `runs[selected].status === 'failed'`, and
  `state.multiSelect.failed` is empty
- **WHEN** the operator presses `d`
- **THEN** the resolved action is the existing single-row
  `{ type: 'open-mark-done-confirm', ticket: runs[selected].ticket }`

### Requirement: A bulk `a`/`d` confirmation names the row count, not one ticket

`sections.js`'s `buildHeadTail` SHALL render a confirmation banner for
`state.bulkConfirm` (`{ section: 'failed', kind: 'address'|'mark-done',
tickets }`) naming `tickets.length` — e.g. "address 3 FAILED runs?" / "mark
4 runs as done?" — following the same `confirmLines` treatment
`markDoneConfirm`'s single-ticket banner already receives, checked in the
same gate-precedence chain (ahead of `quitConfirm`, alongside
`markDoneConfirm`/`forceStartConfirm`/`clearQueueConfirm`). Any key other
than `y` cancels (`state.bulkConfirm = null`) without effect, clearing
`state.multiSelect.failed` per the `fleet-bulk-select` capability.

#### Scenario: The bulk mark-done confirm names the count
- **GIVEN** `state.bulkConfirm = { section: 'failed', kind: 'mark-done',
  tickets: [t1, t2, t3, t4] }`
- **WHEN** the fleet screen renders
- **THEN** the confirmation banner states 4, not any single ticket id

#### Scenario: Any key but `y` cancels the bulk confirm without effect
- **GIVEN** `state.bulkConfirm` is set
- **WHEN** the operator presses any key other than `y`
- **THEN** no `run.override`/spawn action is taken for any ticket, and
  `state.bulkConfirm` becomes `null`

### Requirement: Confirming a bulk `a`/`d` action applies it per ticket and reports a per-row result

On `y`, for each ticket in `state.bulkConfirm.tickets`, the dashboard SHALL
re-resolve the ticket fresh from `state.runs` (never a value cached from
before the confirmation opened) and apply that section's existing
single-row action logic to it — for `mark-done`, appending a
`run.override` event with `status: 'done'`; for `address`, the existing
claude-code-only spawn-or-notice branch. The outcome of each (success,
stale/no-longer-present, or spawn error) SHALL be recorded as `{ ticket,
ok, error }` in `state.bulkResult.results`, and `state.bulkResult` SHALL be
rendered as a per-row result list (ticket id + ✓ or ✗ with its error text)
until the next keypress. This SHALL NOT write, modify, or delete any event
for a ticket other than the one it names, and SHALL NOT contact the ticket
provider, mirroring the existing single-row `d`/`a` requirements'
respective guarantees, applied per ticket instead of once.

#### Scenario: A fully-successful bulk mark-done reports every row as ✓
- **GIVEN** `state.bulkConfirm = { section: 'failed', kind: 'mark-done',
  tickets: [t1, t2, t3] }` and all three are still present in `state.runs`
- **WHEN** the operator presses `y`
- **THEN** a `run.override` event with `status: 'done'` is appended for
  each of t1, t2, t3
- **AND** `state.bulkResult.results` contains an `ok: true` entry for each

#### Scenario: A partial failure is reported per-row, not swallowed into one summary
- **GIVEN** `state.bulkConfirm = { section: 'failed', kind: 'address',
  tickets: [t1, t2] }`, and spawning the address-failure window for t2
  fails (e.g. a tmux window creation error)
- **WHEN** the operator presses `y`
- **THEN** `state.bulkResult.results` contains an `ok: true` entry for t1
  and an `ok: false` entry for t2 carrying its error text
- **AND** t1's spawn is not rolled back or otherwise affected by t2's
  failure

#### Scenario: A ticket that left FAILED between marking and confirming is reported, not silently dropped
- **GIVEN** a ticket in `state.bulkConfirm.tickets` is no longer present in
  `state.runs` by the time `y` is pressed (e.g. it was separately resolved)
- **WHEN** the bulk action runs
- **THEN** that ticket still appears in `state.bulkResult.results` with
  `ok: false` and a stale/no-longer-present reason, rather than being
  omitted from the result list entirely

