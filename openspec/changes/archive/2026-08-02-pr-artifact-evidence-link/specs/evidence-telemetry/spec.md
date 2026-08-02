## ADDED Requirements

### Requirement: The orchestrator emits a `pr` evidence event once a run's PR exists
The orchestrator SHALL, immediately after successfully creating a run's pull request (Phase 3
Delivery), emit `scripts/concertino/emit-event.sh pr ticket=<TICKET_ID> role=orchestrator
url=<PR_URL> label=<a short label identifying the PR>`. This is a distinct event kind from
`evidence` — it carries a `url`, not a local-file `ref`, and is never accompanied by a
`persist-evidence.sh` call (there is no local file to persist; the URL itself is the durable
reference).

#### Scenario: A successful PR creation emits a pr event
- **WHEN** the orchestrator successfully creates a run's PR in Phase 3 Delivery
- **THEN** the run's event log contains a `pr` event carrying that PR's URL

#### Scenario: A pr event carries no local-file ref
- **WHEN** the orchestrator emits a `pr` event
- **THEN** that event has a `url` field and no `ref` field, and no corresponding
  `persist-evidence.sh` call is made for it
