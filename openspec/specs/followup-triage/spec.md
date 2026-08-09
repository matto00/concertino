# followup-triage Specification

## Purpose
Classifies a suggested follow-up (fold-in / standalone / discard) from concrete, checkable signals — file overlap with the current change and caller-stated acceptance-criteria relevance and effort — before it reaches the human, and ensures a chosen fold-in verdict actually revises the current run's plan rather than being recorded and forgotten.
## Requirements
### Requirement: triage-followup.sh computes file overlap and a deterministic recommendation
`core/scripts/triage-followup.sh` SHALL accept `description=`, `files=`
(comma-separated, or the literal `unknown`), `ac_relevant=` (`yes`/`no`),
`effort=` (`small`/`large`), `worktree=` (a path), and an optional `base=`
(defaulting to `${CONCERTINO_BASE_BRANCH:-main}` when omitted, matching
`core/scripts/cleanup.sh`/`core/scripts/assert-phase.sh`'s existing
base-branch convention), and SHALL:
- compute the current change's already-modified files via
  `git -C <worktree> diff --name-only <base>...HEAD`;
- classify overlap between `files=` and that list as `high` (>=50% of
  `files=`'s entries appear in the diff), `partial` (some but <50%), `none`
  (no overlap), or `unknown` (when `files=unknown` was given, never treated
  as overlap);
- apply this fixed decision table to produce a `recommendation` of `fold-in`
  or `standalone`: `ac_relevant=yes` always recommends `fold-in` regardless
  of effort/overlap; `ac_relevant=no` with `effort=small` and `overlap=high`
  recommends `fold-in`; `ac_relevant=no` with `effort=small` and
  `overlap=partial|none|unknown` recommends `standalone`; `ac_relevant=no`
  with `effort=large` recommends `standalone` regardless of overlap;
- print a plain-text block to stdout stating all four inputs, the computed
  overlap, the resulting recommendation, and the one rule that produced it,
  and note explicitly that `discard` is always a valid human choice
  regardless of the recommendation (the script never recommends `discard`
  itself — it has no signal for "not worth doing");
- exit 0 on success.

A missing required field, an `ac_relevant`/`effort` value outside the
allowed set, or a `worktree=` that is not a git repository SHALL print
`FAIL <reason>` to stderr, print nothing to stdout, and exit non-zero —
mirroring `gather-escalation-context.sh`'s existing failure contract.

#### Scenario: High overlap and small effort recommends fold-in
- **WHEN** `triage-followup.sh description="tighten the icon set" files=lib/ui/icons.js ac_relevant=no effort=small worktree=<a worktree where lib/ui/icons.js is already in the diff> base=main` is run
- **THEN** it exits 0 and its stdout states overlap `high` and recommendation `fold-in`, naming the rule that produced it

#### Scenario: Acceptance-criteria-relevant work always recommends fold-in
- **WHEN** `triage-followup.sh description="add the missing validation the AC requires" files=unknown ac_relevant=yes effort=large worktree=<any valid worktree>` is run
- **THEN** it exits 0 and its stdout recommends `fold-in`, regardless of the `unknown` files/`large` effort

#### Scenario: Large effort or low overlap recommends standalone
- **WHEN** `triage-followup.sh description="add a new dashboard screen" files=lib/ui/screens/new-screen.js ac_relevant=no effort=large worktree=<a worktree where that file is not in the diff> base=main` is run
- **THEN** it exits 0 and its stdout states recommendation `standalone`

#### Scenario: A missing required field fails without printing partial output
- **WHEN** `triage-followup.sh description="x" ac_relevant=no worktree=<path>` is run (missing `files` and `effort`)
- **THEN** it prints `FAIL` and a message naming the missing field(s) to stderr, exits non-zero, and prints nothing to stdout

#### Scenario: The recommendation text always notes discard remains a valid choice
- **WHEN** `triage-followup.sh` succeeds with any combination of valid inputs
- **THEN** its stdout includes a statement that `discard` is a valid choice regardless of the computed recommendation

### Requirement: The orchestrator triages a suggested follow-up before escalating, via one shared sub-procedure
`core/roles/orchestrator.md` SHALL define a single named sub-procedure
("Triaging a suggested follow-up") that: states a `description`/`files` for
the suggestion; states its own `ac_relevant`/`effort` judgment; runs
`triage-followup.sh` and captures its stdout; raises
`emit-event.sh escalation --await` with that output as `context=` (falling
back to raising without `context=` if the script fails, per the existing
`gather-escalation-context.sh` fallback convention — never blocking the
escalation itself on a failed triage call) and `options=fold-in,standalone,discard`.
All three of the workflow's follow-up-surfacing points — Phase 3
Delivery's presentation of non-blocking evaluator/skeptic suggestions that
name discrete additional work, Phase 4 step 4's post-cleanup observation,
and Phase 1 Planning's per-question triage for a design ticket (see the
`design-ticket-type` capability) — SHALL invoke this sub-procedure by name
rather than duplicating its steps.

#### Scenario: A reader finds one shared procedure, not three reimplementations
- **WHEN** a reader compares the Phase 3 delivery-time suggestion handling,
  the Phase 4 post-cleanup step, and design-ticket Planning's per-question
  triage in the rendered orchestrator role
- **THEN** all three reference the same named "Triaging a suggested
  follow-up" sub-procedure rather than each containing its own copy of the
  triage steps

#### Scenario: A failed triage call still lets the escalation proceed
- **WHEN** `triage-followup.sh` fails for any reason during the triage
  sub-procedure
- **THEN** the orchestrator still raises the escalation, with
  `options=fold-in,standalone,discard`, but without a `context=` field

#### Scenario: Design-ticket Planning triages with files=unknown
- **WHEN** the orchestrator triages a design ticket's answered question
  during Planning, before any code exists for the change
- **THEN** it invokes the sub-procedure with `files=unknown`, exactly as
  the existing `triage-followup.sh` contract already supports for a
  suggestion naming no discrete files

### Requirement: A fold-in verdict requires the current run's plan to actually be revised before Execution proceeds
`core/roles/orchestrator.md` SHALL require, when the human selects `fold-in` at either triage call site, that before Execution proceeds (Phase 3 call site) or before Phase 4
cleanup runs (Phase 4 call site): (1) the current change's `ticket.md`
(acceptance criteria extended to state the added scope explicitly — this is
what the evaluator and the final-gate skeptic trace acceptance criteria
from), `proposal.md`, `design.md` (if the added scope needs its own
decisions), and `tasks.md` are extended to cover the added scope;
(2) `openspec validate --change <CHANGE_NAME>` is re-run clean; (3) a fresh
design-soundness skeptic gate (`GATE=design`) is run on the revised plan and
reaches `CONFIRM`, bounded by the same `SKEPTIC_DESIGN_ROUNDS` already
resolved for this run. Only once all three hold does the orchestrator
re-enter (or continue) the Execution/Evaluation loop for the added scope. A
`fold-in` decision recorded via `escalation.answered` with no corresponding
plan revision SHALL NOT be treated as satisfying this requirement — this is
the specific gap CON-30 left open.

#### Scenario: Fold-in at Phase 3 revises the plan before Execution proceeds
- **GIVEN** the human selects `fold-in` for a Phase-3-surfaced suggestion
- **WHEN** the orchestrator proceeds
- **THEN** `ticket.md`/`proposal.md`/`design.md`/`tasks.md` in the current
  change have been extended to cover the added scope, `openspec validate` has
  been re-run clean, and a fresh design-gate skeptic `CONFIRM` has been
  obtained, all before Execution starts on the added scope

#### Scenario: Fold-in at Phase 4 reopens Execution instead of proceeding to cleanup
- **GIVEN** the human selects `fold-in` for the Phase 4 post-cleanup
  observation
- **WHEN** the orchestrator proceeds
- **THEN** it does not run `cleanup.sh --phase4` until the added scope has
  been planned (per the same three-part requirement), executed, evaluated,
  and design/final-gated exactly like the original scope

#### Scenario: A recorded fold-in answer alone does not satisfy the requirement
- **GIVEN** `escalation.answered` has recorded `fold-in` for a suggestion
- **AND** none of `ticket.md`/`proposal.md`/`design.md`/`tasks.md` have been
  edited to cover the added scope
- **THEN** this state does not satisfy the fold-in requirement — the
  orchestrator has not yet done the work this requirement mandates

#### Scenario: Extending tasks.md without extending ticket.md does not satisfy the requirement
- **GIVEN** `tasks.md` has been extended to cover the added scope
- **AND** `ticket.md`'s acceptance criteria were not updated to state that
  added scope
- **THEN** this state does not satisfy the fold-in requirement — an extended
  `tasks.md` with no corresponding `ticket.md` acceptance criteria is
  unverifiable by the evaluator and final-gate skeptic, and reproduces the
  milder form of the gap this requirement exists to close

### Requirement: A discard verdict requires no further action
When the human selects `discard`, `core/roles/orchestrator.md` SHALL require
no further action beyond noting the discarded suggestion in the run's
summary — no ticket is filed and no plan revision occurs.

#### Scenario: Discard is a no-op beyond the summary note
- **GIVEN** the human selects `discard` for a triaged suggestion
- **WHEN** the orchestrator proceeds
- **THEN** no Linear ticket is filed for it, no plan revision occurs, and the
  run's summary simply notes that the suggestion was discarded

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

