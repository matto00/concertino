# ticket-provenance Specification

## Purpose
Records where a ticket came from at the moment a role files it — including the repository the filing role was actually running in — so provenance is a recorded fact in both the event log and the ticket itself, rather than something inferred by a proxy now known to fail.. Update Purpose after archive.

## Requirements

### Requirement: A ticket filed by a role emits a ticket.filed event carrying full provenance

When a role files a ticket during a run, a `ticket.filed` event SHALL be appended to the filing run's event log carrying all of: `ticket_id` (the newly filed ticket), `origin_ticket` (the ticket whose run filed it), `origin_repo` (the repository the filing role was running in), `origin_role`, `origin_phase`, `origin_kind`, `suggested_by`, and a `triage` field.

`origin_kind` SHALL be exactly one of `followup`, `roadmap`, `escalation-split`, or `human`. `suggested_by` SHALL be exactly one of `agent` or `human`. A `ticket.filed` invocation missing any required field, or carrying an `origin_kind`/`suggested_by` value outside those sets, SHALL be refused with a non-zero exit and a message naming the offending field and its legal values, and SHALL append no event — matching the refusal contract already established for `verdict`'s `category`.

`origin_repo` SHALL be resolved from the repository whose event log is being written, not from the filed ticket's identifier prefix, so that a role running in one repository filing a ticket in another records the repository it actually ran in. Recording the filed ticket's own prefix instead SHALL NOT satisfy this requirement, since that is the conflation that invalidated the original provenance inference.

#### Scenario: A filed ticket records every provenance field
- **WHEN** a role files a ticket and emits `ticket.filed` with every required field
- **THEN** the event is appended carrying each field verbatim, and the command exits zero

#### Scenario: A missing required field is refused
- **WHEN** a `ticket.filed` event is emitted without one of the required fields
- **THEN** the command exits non-zero naming that field, and no event is appended

#### Scenario: An illegal origin_kind is refused
- **WHEN** a `ticket.filed` event is emitted with an `origin_kind` outside the four legal values
- **THEN** the command exits non-zero naming the legal values, and no event is appended

#### Scenario: An illegal suggested_by is refused
- **WHEN** a `ticket.filed` event is emitted with a `suggested_by` value other than `agent` or `human`
- **THEN** the command exits non-zero naming the legal values, and no event is appended

#### Scenario: origin_repo reflects the running repository, not the filed ticket's prefix
- **WHEN** a role running in a repository named `helio` files a ticket whose identifier begins `CON-`
- **THEN** the emitted `ticket.filed` event records `origin_repo` as the repository the role ran in (`helio`), and the event is appended to that repository's own event log for `origin_ticket`

#### Scenario: Required fields are enforced only for ticket.filed
- **WHEN** an event of any other kind is emitted without `origin_kind`, `origin_repo` or any other field this requirement mandates
- **THEN** it is appended exactly as before this change, and the command exits zero

### Requirement: The triage signal is persisted rather than discarded

The `triage` field on `ticket.filed` SHALL carry the acceptance-criteria relevance, effort, computed file overlap, and recommendation that `triage-followup.sh` already derives for the suggestion, so that attention which stays inside the current work is distinguishable from attention that wanders. It SHALL be recorded as a single JSON-encoded value, following the existing precedent by which `run.start` records its per-role `models` object.

#### Scenario: The triage block records the computed overlap and recommendation
- **WHEN** a ticket is filed following a triage whose computed overlap was `none` and whose recommendation was `standalone`
- **THEN** the emitted `ticket.filed` event's `triage` value records that overlap and recommendation, alongside the stated `ac_relevant` and `effort`

### Requirement: Provenance is mirrored onto the filed ticket itself

The filed ticket SHALL itself carry `origin_kind` and `origin_ticket`, written through the configured ticket provider, so provenance survives independently of the event log and remains queryable from the provider even if the event log is pruned or unavailable.

#### Scenario: The filed ticket carries its own provenance
- **WHEN** a role files a follow-up ticket for origin ticket `CON-190`
- **THEN** the filed ticket's own content records `origin_kind` and `origin_ticket: CON-190`, independently of any event log

#### Scenario: Event-log pruning does not destroy provenance
- **WHEN** the filing run's event log has been pruned under the retention policy
- **THEN** the filed ticket still states its `origin_kind` and `origin_ticket`
