## MODIFIED Requirements

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
