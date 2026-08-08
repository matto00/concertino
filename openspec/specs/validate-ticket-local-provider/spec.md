# validate-ticket-local-provider Specification

## Purpose
Lets `concertino validate --ticket <ID>` live-check a `local`- (or `manual`-) provider ticket's on-disk labels, at zero network cost, the same way it already live-checks a Linear ticket's labels over the network.
## Requirements
### Requirement: `concertino validate --ticket <ID>` live-checks a local ticket's on-disk labels
`concertino validate --ticket <ID>` SHALL, when `ticketProvider.kind`
resolves (through `ticket-provider.js`'s alias table) to `local`, read
`tickets/<ID>.md` synchronously from disk and classify its harness-override
labels exactly as it already does for a `linear`-provider ticket's
network-fetched labels, using the same `classifyHarnessOverride` logic.
Only a `ticketProvider.kind` that resolves to neither `linear` nor `local`
SHALL still report the `unsupported-provider` state.

#### Scenario: Local ticket with no harness override
- **WHEN** `concertino validate --ticket CON-12` runs against a project whose
  `ticketProvider.kind` is `local`, and `tickets/CON-12.md` exists with no
  `harness:` label
- **THEN** the Integrations section reports `no-override`, exactly as the
  equivalent Linear case does

#### Scenario: Local ticket with a valid harness override
- **WHEN** `tickets/CON-12.md`'s frontmatter `labels:` includes
  `harness:codex`
- **THEN** the Integrations section reports the `valid` classification for
  `codex`, exactly as the equivalent Linear case does

#### Scenario: Local ticket file missing
- **WHEN** `concertino validate --ticket CON-99` runs against a `local`
  provider and no `tickets/CON-99.md` exists
- **THEN** the command reports an error naming the missing file rather than
  a bare not-found exception

#### Scenario: manual alias resolves the same as local
- **WHEN** `concertino validate --ticket <ID>` runs against a project whose
  `ticketProvider.kind` is the deprecated `manual` alias
- **THEN** the ticket is live-checked exactly as it would be under `local`

#### Scenario: A genuinely unsupported provider still reports unsupported-provider
- **WHEN** `concertino validate --ticket <ID>` runs against a project whose
  `ticketProvider.kind` is `github` (or any kind that is not `linear`,
  `local`, or `manual`)
- **THEN** the Integrations section reports the `unsupported-provider` state
  naming that provider kind, and no fetch (network or disk) is attempted

