# ticket-draft Specification

## Purpose
Lets `n` accept a free-text intention as well as a ticket id: it drafts a
title/description/acceptance-criteria via a headless agent invocation, lets
the human review and edit before confirming, then creates the ticket in the
configured provider and launches the run against the real id.
## Requirements
### Requirement: `n` accepts free text as well as a ticket id
The new-run prompt SHALL classify submitted input using
`parseTicketInput(value) !== null` (`lib/ui/prompt.js`) as the sole
classification — itself built on the single `looksLikeTicket` predicate
(`lib/ui/ticket.js`), not a second or duplicate ticket-shape check. Raw
`looksLikeTicket(value)` alone MUST NOT be used as the branch condition,
since it is a whole-string match with no whitespace tolerance and does not
match `"CON-21 fast"` or `"CON-21 --agent-merge"`, while `parseTicketInput`
does.

#### Scenario: Ticket-shaped input behaves unchanged
- **WHEN** the human submits input at the `n` prompt that
  `parseTicketInput` accepts (e.g. `CON-21`, `CON-21 fast`,
  `CON-21 --agent-merge`)
- **THEN** the existing `submitTicket` launch path runs exactly as before,
  with no ticket-draft flow involved

#### Scenario: Free text opens the draft flow
- **WHEN** the human submits input at the `n` prompt that
  `parseTicketInput` rejects (returns `null`) — including free text and any
  ticket-adjacent-but-invalid value such as `"CON-21 nonsense"`
- **THEN** the ticket-draft flow opens with the submitted text as its seed,
  instead of showing a validation error

### Requirement: Ticket provider gating
The ticket-draft flow SHALL only be reachable when the configured
`ticketProvider.kind`, resolved through `ticket-provider.js`'s alias table
(so the deprecated `manual` value resolves to `local`), is `linear`. The
gate SHALL compare the resolved kind, never the raw, unaliased
`ticketProvider.kind` config value.

#### Scenario: Non-Linear provider
- **WHEN** `ticketProvider.kind` is `github` and the human submits free text
  at the `n` prompt
- **THEN** the prompt shows the same "not available for this provider"
  treatment the launch pad (`N` screen) already uses for a non-Linear
  provider, and no draft flow opens

#### Scenario: Local provider
- **WHEN** `ticketProvider.kind` is `local` and the human submits free text
  at the `n` prompt
- **THEN** the prompt explains that dashboard drafting is not available for
  local tickets yet and points at `tickets/<ID>.md`, and no draft flow opens

#### Scenario: Manual provider resolves the same as local
- **WHEN** `ticketProvider.kind` is the deprecated `manual` alias and the
  human submits free text at the `n` prompt
- **THEN** the prompt shows the same local-specific "not available for local
  tickets yet" message the `local` scenario above shows — never the raw-kind
  `ticketProvider.kind "linear" — this project uses "manual"` message — and
  no draft flow opens

### Requirement: Headless drafting produces a reviewable draft
On opening the draft flow, the system SHALL invoke a headless, print-mode
Claude Code process with the free-text seed and parse a structured JSON
response containing a title, description, and acceptance criteria.

#### Scenario: Successful draft
- **WHEN** the headless invocation returns valid JSON with `title`,
  `description`, and `acceptanceCriteria`
- **THEN** the draft-review screen opens populated with those three fields

#### Scenario: Drafting fails or returns malformed output
- **WHEN** the headless invocation exits non-zero, or its output is not
  valid JSON, or is missing a required field
- **THEN** the draft screen does not open; the `n` prompt shows an inline
  error and the human's original free text is preserved for retry or edit

#### Scenario: Human cancels while drafting is in progress
- **WHEN** the human presses cancel while the headless invocation is still
  running
- **THEN** the in-flight child process is terminated and the fleet screen
  returns to its normal state with no draft screen opened

### Requirement: Draft review, edit, and abandon
The draft-review screen SHALL let the human edit the title, description, and
acceptance criteria fields, and SHALL let the human abandon the draft
without creating anything.

#### Scenario: Editing a field
- **WHEN** the human selects a field on the draft-review screen and types
- **THEN** the field's text updates and no ticket is created until the
  human explicitly confirms

#### Scenario: Abandoning the draft
- **WHEN** the human cancels from the draft-review screen
- **THEN** no ticket is created in the provider, and the fleet screen
  returns to its normal state

### Requirement: Confirm creates the ticket and launches the run
On confirm, the system SHALL create the ticket in the configured provider
using a creation-only mutation, then launch the run against the real,
provider-issued ticket id via the existing `submitTicket` path, and SHALL
refresh the launch-pad ticket cache so the new ticket is visible there
without a manual refresh.

#### Scenario: Successful creation and launch
- **WHEN** the human confirms the draft-review screen
- **THEN** a ticket is created in Linear via a creation-only mutation, the
  run launches against the real ticket id through `submitTicket` (including
  its existing `{{TICKET}}` substitution, unchanged), and the launch pad's
  ticket cache is refreshed so the new ticket appears without a manual
  refresh

#### Scenario: Creation fails
- **WHEN** the human confirms the draft-review screen and the provider
  creation mutation fails
- **THEN** no run is launched, the draft-review screen remains open with the
  human's edited content preserved, and an inline error is shown

### Requirement: Ticket-provider write scope stays creation-only
The system SHALL NOT use the ticket-draft flow's provider write capability
for any purpose other than issue creation; ticket status transitions remain
the exclusive responsibility of the orchestrator.

#### Scenario: No status transition from the TUI
- **WHEN** a ticket is created via the ticket-draft flow
- **THEN** the TUI does not set or change that ticket's status — status
  remains whatever the provider assigns newly created issues by default,
  until the orchestrator's own run transitions it

