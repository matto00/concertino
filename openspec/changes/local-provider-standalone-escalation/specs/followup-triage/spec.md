## RENAMED Requirements
- FROM: `### Requirement: A standalone verdict files a concrete Linear ticket`
- TO: `### Requirement: A standalone verdict files a concrete follow-up ticket`

## MODIFIED Requirements

### Requirement: A standalone verdict files a concrete follow-up ticket
When the human selects `standalone`, `core/roles/orchestrator.md` SHALL require the orchestrator to
file a new ticket summarizing the suggestion's `description` and linking back to the current
ticket, using an action appropriate to the rendered project's `ticketProvider.kind`, and to note the
new ticket's identifier in its summary to the human. No re-planning or scope change to the current
run follows from a `standalone` verdict.

Under `ticketProvider.kind: "linear"` or `"github"`, this SHALL be filing a new remote ticket via
that provider's MCP tool (`mcp__linear__save_issue` with no `id`, or the GitHub equivalent),
unchanged from before this requirement's rename.

Under `ticketProvider.kind: "local"`, the orchestrator SHALL instead:
1. Derive `<prefix>` from `$TICKET_ID` by stripping its trailing `-<digits>` (e.g. `CON-91` →
   `CON`).
2. Run `scripts/concertino/next-ticket-id.sh <tickets-dir> <prefix>` (this project's rendered copy
   of the canonical `core/scripts/next-ticket-id.sh`) to allocate the next free id.
3. Write the returned `path` with frontmatter `title:` (a short title drawn from `description`) and
   `state: backlog`, and a body summarizing `description` plus a line linking back to `$TICKET_ID` —
   the same frontmatter shape `tickets/$TICKET_ID.md` already documents (CON-44).

#### Scenario: Standalone under linear/github produces a filed remote ticket, not just a recorded answer
- **GIVEN** the human selects `standalone` for a triaged suggestion on a `linear`- or `github`-
  configured project
- **WHEN** the orchestrator proceeds
- **THEN** a new remote ticket exists summarizing the suggestion and linking to the current ticket,
  and its identifier appears in the orchestrator's summary to the human

#### Scenario: Standalone under local produces a filed tickets/ entry, not an unexecutable instruction
- **GIVEN** the human selects `standalone` for a triaged suggestion on a `local`-configured project
- **WHEN** the orchestrator proceeds
- **THEN** it allocates a new id via `next-ticket-id.sh`, writes `tickets/<id>.md` with `title:` and
  `state: backlog` frontmatter and a body summarizing the suggestion and linking back to
  `$TICKET_ID`, and that identifier appears in the orchestrator's summary to the human — it never
  attempts to call an MCP tool it was not granted
