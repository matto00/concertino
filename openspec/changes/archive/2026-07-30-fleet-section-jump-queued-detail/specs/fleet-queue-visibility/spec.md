## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Entering QUEUED focus SHALL never perturb the row-index a run selection resolves to
Entering or leaving QUEUED-local focus (see the `fleet-section-jump` and `fleet-queue-force-start` capabilities) SHALL NOT alter `state.selected` or the row-index space `runs[state.selected]` resolves against. This holds the existing "Inserting QUEUED never perturbs the row-index a selection resolves to" requirement's guarantee even now that QUEUED has its own, independent navigable cursor.

#### Scenario: Round-tripping through QUEUED focus leaves run selection resolution unchanged
- **WHEN** `state.selected` resolves to a given run, the operator jumps into QUEUED focus, moves the QUEUED-local cursor, and exits QUEUED focus
- **THEN** `state.selected` still resolves to the exact same run it did before entering QUEUED focus
