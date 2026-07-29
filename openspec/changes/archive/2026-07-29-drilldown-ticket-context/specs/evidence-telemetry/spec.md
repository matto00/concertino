## MODIFIED Requirements

### Requirement: The orchestrator emits one evidence event per planning artifact
The orchestrator SHALL, at the point it writes `workflow-state.md` transitioning out of
Planning, persist each planning artifact created that phase (`ticket.md`, `proposal.md`,
`design.md`, `tasks.md`, and any spec delta files) via `persist-evidence.sh`, and for each one
whose `persist-evidence.sh` call succeeds, emit `scripts/concertino/emit-event.sh evidence
ticket=<TICKET_ID> role=orchestrator ref=<persisted path> label=<artifact name>`.

#### Scenario: A successful planning phase emits evidence for its artifacts
- **WHEN** the orchestrator completes Phase 1 having written `ticket.md`, `proposal.md`,
  `design.md`, and `tasks.md`
- **THEN** the run's event log contains an `evidence` event for each of the four artifacts, each
  with a `ref` that resolves from the main checkout

#### Scenario: A failed persist does not produce a broken evidence event
- **WHEN** `persist-evidence.sh` fails for one planning artifact (e.g. it was never written
  because Planning escalated first)
- **THEN** no `evidence` event is emitted for that artifact, and the orchestrator's other
  telemetry calls are unaffected
