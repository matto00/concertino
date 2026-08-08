# local-provider-drift-guard Specification

## Purpose
Couples the local ticket provider's duplicated constants and logic (state-type filtering, the five-state vocabulary, and the tickets-directory argument) to their Linear-side or shell-side counterparts with tests that fail on divergence, so the two providers cannot silently disagree.
## Requirements
### Requirement: stateTypesFromConfig is shared code, not a parallel implementation

`lib/ui/tickets/local.js` SHALL obtain `stateTypesFromConfig` by importing it
from `lib/ui/linear.js` (the same module it already imports `deriveEpics` and
`OPEN_STATE_TYPES` from), and SHALL NOT define its own implementation of the
function's logic.

#### Scenario: local.js exports the same function linear.js defines

- **WHEN** `lib/ui/tickets/local.js`'s `stateTypesFromConfig` export is
  compared to `lib/ui/linear.js`'s `stateTypesFromConfig` export
- **THEN** they are the identical function reference (an import/re-export),
  not two separately-defined functions that happen to behave the same

### Requirement: The local provider's STATES vocabulary stays byte-identical to set-ticket-state.sh's copy

`lib/ui/tickets/local.js`'s `STATES` array and `core/scripts/set-ticket-state.sh`'s `STATES` shell string SHALL contain the same five values in the same order.
A test SHALL extract both and byte-compare them (after normalising the JS
array literal and the space-separated shell string to the same comparable
form), following the precedent `test/scripts/ticket-pattern.test.sh` already
set for keeping the canonical ticket-id pattern byte-identical across
multiple shell copies.

#### Scenario: Both copies agree

- **WHEN** the drift test extracts `STATES` from `lib/ui/tickets/local.js`
  and from `core/scripts/set-ticket-state.sh`
- **THEN** it reports both as the identical ordered value list:
  `backlog unstarted started completed canceled`

#### Scenario: A future edit to one copy without the other fails the test

- **WHEN** either `lib/ui/tickets/local.js`'s `STATES` array or
  `core/scripts/set-ticket-state.sh`'s `STATES` string is changed (an
  addition, removal, reorder, or rename of a value) without the same change
  being made to the other
- **THEN** the drift test fails, naming the mismatch, rather than the two
  copies silently disagreeing

### Requirement: set-ticket-state.sh's tickets-directory argument is a documented test-only exception, pinned by a regression test

`core/scripts/set-ticket-state.sh`'s `<tickets-dir>` first positional argument SHALL be documented — in both the
script's own header comment and in
`docs/superpowers/specs/2026-08-07-local-ticket-provider-design.md`'s
Decision 3 — as existing solely so the script's own test suite can exercise
it against an isolated scratch directory, never as a production-configurable
tickets location. The only production call site
(`lib/cli/render.js`'s rendered orchestrator prose) SHALL always pass the
literal string `tickets`, and a test SHALL assert this literal is present in
the rendered output.

#### Scenario: The rendered orchestrator prose always passes the literal tickets-dir

- **WHEN** `concertino sync` renders the orchestrator agent for a project
  configured with `ticketProvider.kind: "local"`
- **THEN** the rendered prose's `set-ticket-state.sh` invocation names the
  literal argument `tickets`, not a templated or configurable value

#### Scenario: The script's own usage comment names the exception

- **WHEN** a reader opens `core/scripts/set-ticket-state.sh` without also
  reading the design doc
- **THEN** the script's header comment explains that `<tickets-dir>` exists
  for test isolation only, and that production always passes the literal
  `tickets`

