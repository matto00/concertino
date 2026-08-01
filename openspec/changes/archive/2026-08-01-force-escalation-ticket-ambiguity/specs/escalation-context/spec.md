## ADDED Requirements

### Requirement: gather-escalation-context.sh formats structured context for a sixth kind, ticket-ambiguity
`core/scripts/gather-escalation-context.sh` SHALL accept a sixth kind, `ticket-ambiguity`,
alongside the existing five (`dependency`, `api-change`, `budget`, `blocker`, `contradiction`),
requiring the fields `signal` (one of `design-fork`, `scope-boundary`, `hedge-phrase`), `detail`
(the specific fork, boundary, or phrase that tripped the rule), and `draft_excerpt` (the ticket
text it would otherwise have gone into), and SHALL print a structured, human-readable plain-text
context block to stdout, exiting 0. A missing required field SHALL fail exactly as the five
existing kinds already do — `FAIL <reason>` to stderr, non-zero exit, nothing printed to stdout.

#### Scenario: A ticket-ambiguity escalation's context includes every field the rule names
- **WHEN** `gather-escalation-context.sh ticket-ambiguity signal=scope-boundary
  detail="does X belong in this ticket or a follow-up" draft_excerpt="likely acceptable to leave
  X out for now"` is run
- **THEN** it exits 0 and its stdout mentions the signal, the detail, and the draft excerpt
  verbatim

#### Scenario: A missing required field fails without printing partial context
- **WHEN** `gather-escalation-context.sh ticket-ambiguity signal=hedge-phrase` is run (missing
  `detail` and `draft_excerpt`)
- **THEN** it prints `FAIL` and a message naming the missing fields to stderr, exits non-zero, and
  prints nothing to stdout

#### Scenario: The five existing kinds are unaffected
- **WHEN** any of the five pre-existing kinds (`dependency`, `api-change`, `budget`, `blocker`,
  `contradiction`) is invoked exactly as before this change
- **THEN** its behavior, required fields, and output format are unchanged
