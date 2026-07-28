## ADDED Requirements

### Requirement: Canonical phase enum is enforced, not just documented
The dashboard SHALL maintain exactly one canonical, code-owned list of valid `phase.enter`
values (`PHASE_ORDER`, defined in `lib/ui/reducer.js`), and every module that needs the list
(the fleet screen, the drill-down screen) SHALL import it rather than defining or copying its
own.

#### Scenario: Screens import the canonical list
- **WHEN** `lib/ui/screens/fleet.js` or `lib/ui/screens/drilldown.js` compute a phase's position
  in the pipeline
- **THEN** they use the `PHASE_ORDER` array sourced from `lib/ui/reducer.js`, not a locally
  redefined copy

### Requirement: An unrecognised phase value is detected and surfaced, never silently applied
When the reducer processes a `phase.enter` event, it SHALL validate `ev.phase` against
`PHASE_ORDER`. A recognised value SHALL update `run.phase` as before. An unrecognised value
SHALL NOT overwrite `run.phase`, and SHALL increment that run's `malformed` count by one, so it
surfaces through the same "malformed events" indicator the fleet screen already renders for
malformed event-log lines.

#### Scenario: Valid phase value updates the run
- **WHEN** a `phase.enter` event arrives with `phase: "Execution"`
- **THEN** `run.phase` becomes `"Execution"` and `run.malformed` is unchanged

#### Scenario: Unrecognised phase value is dropped and counted, not applied
- **WHEN** a `phase.enter` event arrives with `phase: "Phase 2"` (not a member of `PHASE_ORDER`)
- **THEN** `run.phase` is left at its prior value (or `null` if never set) and `run.malformed`
  increments by one

### Requirement: The malformed counter's documented meaning covers both dropped and rejected events
The doc comments describing the `run.malformed` counter in `lib/ui/store.js` and `lib/ui/screens/drilldown.js` SHALL state it covers two cases, not only the narrower original one:
an event-log line that never became an event at all (unparseable JSON, or missing `t`/`kind`), and
an event that was recorded in `run.events` but carried a field the reducer rejected (e.g. an
unrecognised `phase.enter` value).

#### Scenario: A rejected-field event still appears in the timeline
- **WHEN** a run receives one dropped envelope-malformed line and one `phase.enter` event with
  an unrecognised `phase` value
- **THEN** `run.malformed` is 2, and only the `phase.enter` event (not the dropped line, which
  never became an event) appears in `run.events` / the drill-down timeline

#### Scenario: Unrecognised phase never renders as false progress
- **WHEN** the fleet screen renders a run whose most recent `phase.enter` value was
  unrecognised and no valid phase was ever recorded
- **THEN** the run's status line reads "phase unknown" and its progress bar shows zero fill,
  the same rendering already used for a run with no phase at all — never a phantom phase label
  with an empty bar

### Requirement: The permitted phase values are stated at their point of use in role docs
`core/roles/orchestrator.md` SHALL state the exact permitted `phase=` values inline at the
`emit-event.sh phase.enter` instruction, rather than a placeholder such as `<Phase>`.

#### Scenario: Orchestrator doc names the enum inline
- **WHEN** a reader reaches the `phase.enter` telemetry instruction in
  `core/roles/orchestrator.md`
- **THEN** the instruction lists the exact permitted values
  (`Setup | Planning | Execution | Evaluation | Delivery | Cleanup`) rather than a placeholder
