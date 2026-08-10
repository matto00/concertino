## ADDED Requirements

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
