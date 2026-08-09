# address-failure-skill Specification

## Purpose
Defines `/concertino-address-failure`, the command that audits a FAILED run's evidence and event log, restores or reconstructs its worktree/planning state, and resumes the ordinary executor/evaluator/skeptic delivery loop to actually fix and re-deliver it.
## Requirements
### Requirement: `/concertino-address-failure` audits the failed run's event log before doing anything else
On invocation with a `TICKET_ID`, `/concertino-address-failure` SHALL spawn
`concertino-orchestrator` with `ADDRESS_FAILURE=true` and the ticket id. The
orchestrator's Address-Failure entry point SHALL read
`.concertino/runs/<TICKET_ID>/events.jsonl` in full before taking any
write action, extracting at minimum: the most recent `run.start` event
(branch/worktree/speed/harness), the phase/gate/verdict/escalation timeline,
and any evaluator/skeptic report referenced by an `evidence` event.

#### Scenario: The audit reads the full event log before any write
- **GIVEN** a FAILED run's `events.jsonl` contains a `run.start` event and a
  timeline of `phase.enter`/`gate.result`/`verdict` events
- **WHEN** `/concertino-address-failure <TICKET_ID>` is invoked
- **THEN** the orchestrator reads that full log before creating or modifying
  any worktree, branch, or file

### Requirement: The worktree is restored idempotently via `setup-worktree.sh`, never hand-rolled
The Address-Failure entry point SHALL restore the run's worktree by calling
`scripts/concertino/setup-worktree.sh` with the branch name recorded in the
audited `run.start` event, relying on that script's existing idempotency
(reusing an already-present worktree, or recreating one checked out at the
same branch if it was removed) rather than re-implementing worktree/branch
detection.

#### Scenario: An existing worktree is reused, not recreated
- **GIVEN** the FAILED run's worktree is still present on disk
- **WHEN** the Address-Failure entry point calls `setup-worktree.sh` with the
  audited branch name
- **THEN** the existing worktree is reused unchanged (per `setup-worktree.sh`'s
  own idempotency contract)

#### Scenario: A deleted worktree is recreated on the same branch
- **GIVEN** the FAILED run's worktree directory no longer exists on disk, but
  its branch still exists in the repository
- **WHEN** the Address-Failure entry point calls `setup-worktree.sh` with the
  audited branch name
- **THEN** a new worktree is created checked out at that same branch, so any
  previously-committed work on it survives

### Requirement: Planning state is resumed from `workflow-state.md` when present, reconstructed from persisted evidence when not, and never silently invented
The Address-Failure entry point SHALL resume from `workflow-state.md`'s
recorded `PHASE` (exactly as an ordinary mid-session resume does) when that
file is present in the restored worktree's change directory. When it is
absent, the entry point SHALL instead reconstruct `ticket.md`/`proposal.md`/
`design.md`/`tasks.md` from `.concertino/runs/<TICKET_ID>/evidence/` (the
durable, main-checkout output of Phase 1's `persist-evidence.sh`) and resume
from Planning. When evidence is also absent, the entry point SHALL fall back
to an ordinary fresh delivery run for the ticket and SHALL state plainly in
its audit summary that nothing was found to remediate, rather than
proceeding as though a resume occurred.

#### Scenario: workflow-state.md present — resume from its recorded phase
- **GIVEN** the restored worktree contains a `workflow-state.md` with
  `PHASE: Execution`
- **WHEN** the Address-Failure entry point resumes
- **THEN** it continues from the Execution phase, not from Planning

#### Scenario: workflow-state.md absent, evidence present — reconstruct and resume from Planning
- **GIVEN** the restored worktree has no `workflow-state.md`
- **AND** `.concertino/runs/<TICKET_ID>/evidence/` contains a persisted
  `ticket.md`
- **WHEN** the Address-Failure entry point resumes
- **THEN** it reconstructs the planning artifacts from that evidence and
  resumes from Planning

#### Scenario: Neither workflow-state.md nor evidence present — honest fresh start
- **GIVEN** the restored worktree has no `workflow-state.md`
- **AND** `.concertino/runs/<TICKET_ID>/evidence/` is empty or absent
- **WHEN** the Address-Failure entry point resumes
- **THEN** it proceeds as an ordinary fresh delivery run for the ticket
- **AND** its audit summary states plainly that nothing was found to remediate

### Requirement: The audit is persisted as evidence, visible in the drill-down's EVIDENCE panel
The Address-Failure entry point SHALL persist its audit summary via the
existing `persist-evidence.sh`, under
`.concertino/runs/<TICKET_ID>/evidence/`, so it appears in the drill-down
screen's EVIDENCE panel like every other persisted artifact.

#### Scenario: The audit summary is discoverable in the drill-down
- **GIVEN** `/concertino-address-failure` has run its audit step for a ticket
- **WHEN** an operator opens that run's drill-down EVIDENCE panel
- **THEN** the audit summary appears as an evidence entry

### Requirement: Remediation reuses the existing executor/evaluator/skeptic/delivery loop, not a separate implementation of it
The Address-Failure entry point SHALL continue the ordinary Execution →
Evaluation → final gate → Delivery → Cleanup loop already defined for
`concertino-orchestrator`, after the audit and worktree/state restoration,
passing the audit's findings to the first resumed executor call the same way
an ordinary evaluator FAIL cycle passes its report. No parallel
implementation of the executor/evaluator/skeptic loop SHALL be introduced for
this entry point.

#### Scenario: A resumed Execution cycle receives the audit's findings
- **GIVEN** the Address-Failure entry point resumed from `PHASE: Execution`
- **WHEN** it resumes the executor
- **THEN** the executor receives the audit's findings the same way it would
  receive `EVALUATION_REPORT_PATH` on an ordinary FAIL cycle

### Requirement: `/concertino-address-failure` is scoped to the claude-code harness only
The Address-Failure entry point SHALL only be reachable via a claude-code
slash command in this change; no Codex or OpenCode prompt file is added for
it.

#### Scenario: No Codex/OpenCode prompt file exists for address-failure
- **GIVEN** a project synced with `harnesses: ["claude-code", "codex"]`
- **WHEN** `concertino sync` runs
- **THEN** `.claude/commands/concertino-address-failure.md` is written
- **AND** no equivalent file is written under `.codex/` or `.opencode/`

