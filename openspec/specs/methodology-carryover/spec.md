# methodology-carryover Specification

## Purpose
Carries methodology constraints agreed during Planning or a design/final gate
round in `workflow-state.md` itself, so every role's existing resume-time read
of that file picks them up automatically, and detects mechanically when
`tasks.md`, `workflow-state.md`'s `CONSTRAINTS`, and its `CONSTRAINT_REVIEWS`
disagree about what was agreed.

## Requirements

### Requirement: Standing constraints are recorded in workflow-state.md
`workflow-state.md` SHALL carry a `CONSTRAINTS` field: a single-line JSON
array of methodology constraints that bind for the remainder of the run. Each
entry SHALL record `id` (`C<n>`), `text`, `agreed_at`
(`planning|design-gate|final-gate`), and `retired` (boolean, default `false`).
The orchestrator SHALL append an entry the moment a methodology-shaped
constraint is agreed — a Planning ESCALATION answer, or a design-gate/
final-gate skeptic REFUTE round that settles a how-to-verify or
how-to-implement rule meant to bind for the rest of the run (not a one-off,
already-applied fix) — mirrored at the same moment as a `- [C<n>] <text>`
bullet under a `## Standing Constraints` section in `tasks.md`. A constraint
is never deleted; a superseded or expired one is marked `retired: true`
instead, and resuming roles skip retired entries.

#### Scenario: Design-gate REFUTE settles a standing constraint
- **WHEN** the skeptic's REFUTE at the design gate requires a methodology rule
  ("read token values from source, never transcribe them") and the revised
  plan satisfies it
- **THEN** the orchestrator appends that rule to `workflow-state.md`'s
  `CONSTRAINTS` (with a fresh `C<n>` id) and to `tasks.md`'s
  `## Standing Constraints` section with the matching id, before the executor
  is resumed

#### Scenario: A one-off fix is not promoted
- **WHEN** an evaluator FAIL change request is a one-off code fix with no
  standing methodology implication
- **THEN** it is addressed by the executor and reflected in `tasks.md` as
  usual, and is NOT added to `CONSTRAINTS`

#### Scenario: A constraint is later retired
- **WHEN** a previously-agreed constraint is explicitly superseded or expires
- **THEN** the orchestrator sets that entry's `retired` to `true` in
  `CONSTRAINTS` (never deleting the entry or its id) and resuming roles no
  longer treat it as binding

### Requirement: Every skeptic verdict, and every Planning promotion, produces a recorded constraint review
Immediately after every skeptic verdict at the design gate or the final gate
(CONFIRM or REFUTE, every round), the orchestrator SHALL append one entry to
`workflow-state.md`'s `CONSTRAINT_REVIEWS`:
`{"verdict_seq":<n>,"gate":"design|final","round":<n>,"verdict":"CONFIRM|REFUTE","promoted":[...]}`,
where `promoted` lists any `CONSTRAINTS` ids newly written as a result of that
verdict (empty if none). The orchestrator SHALL also increment
`workflow-state.md`'s `SKEPTIC_VERDICTS_TOTAL` counter immediately after every
skeptic spawn returns, independent of whether anything was promoted.
Separately, when a Planning ESCALATION resolution promotes a constraint (no
skeptic verdict involved), the orchestrator SHALL append a
`{"gate":"planning","round":1,"verdict":"n/a","promoted":[...]}` entry — this
counts toward the id-union comparison below but SHALL NOT increment or be
counted against `SKEPTIC_VERDICTS_TOTAL`, which remains a count of skeptic
spawns only.

#### Scenario: A CONFIRM verdict still gets a review entry
- **WHEN** the skeptic returns CONFIRM with no methodology implication
- **THEN** the orchestrator still appends a `CONSTRAINT_REVIEWS` entry for
  that verdict with `"promoted": []`, and still increments
  `SKEPTIC_VERDICTS_TOTAL`

#### Scenario: A Planning-agreed constraint is reviewable without a skeptic verdict
- **WHEN** a Planning ESCALATION answer settles a standing constraint, with no
  skeptic gate involved yet
- **THEN** the orchestrator appends a `{"gate":"planning",...}`
  `CONSTRAINT_REVIEWS` entry recording the promotion, and
  `SKEPTIC_VERDICTS_TOTAL` is unaffected

### Requirement: Resuming roles treat CONSTRAINTS as binding
Any role whose resume path already reads `workflow-state.md` (the executor
and evaluator, at minimum) SHALL treat every non-retired entry in
`CONSTRAINTS` as binding for the remainder of the run, with the same standing
as the Iron Laws, without requiring a separate re-read of `tasks.md` or other
planning artifacts.

#### Scenario: Executor resumed in cycle 3 still honors a round-1 constraint
- **WHEN** the executor is warm-resumed for cycle 3 and does not re-read
  `tasks.md` per its existing resume note
- **THEN** it still reads `workflow-state.md`'s `CONSTRAINTS` (already part of
  its resume-time read) and honors every non-retired listed constraint

### Requirement: Divergence is detected mechanically, before archiving
`check-constraints-carryover.sh <WORKTREE_PATH> <CHANGE_NAME>` SHALL compare
three sources: the `- [C<n>]` marker ids in `tasks.md`'s
`## Standing Constraints` section, the ids in `workflow-state.md`'s
`CONSTRAINTS`, and the union of every `CONSTRAINT_REVIEWS[].promoted` id
(including `"gate":"planning"` entries). It SHALL exit `0` (`OK`, or
`OK (none)` when all three are empty and `SKEPTIC_VERDICTS_TOTAL` is `0`)
only when all three id sets are identical AND
`len(CONSTRAINT_REVIEWS where gate != "planning")` equals
`SKEPTIC_VERDICTS_TOTAL`; exit `1` (`DIVERGED: ...`) on any set disagreement,
count mismatch, or malformed JSON in a field that is present; exit `2`
(`MISSING <path>`) when either input **file** does not exist at all. A field
absent from an existing `workflow-state.md` (as every pre-this-change and
in-flight run's file is) reads as its empty default (`[]` for
`CONSTRAINTS`/`CONSTRAINT_REVIEWS`, `0` for `SKEPTIC_VERDICTS_TOTAL`) — never
a failure. The orchestrator SHALL invoke this check as an explicit step at
the start of Phase 3 (Delivery), before the change directory is archived and
before the squash — never via `assert-phase.sh`'s `delivery` phase, which
fires after archiving has already moved these files (see design.md Decision
2a). On any non-zero result the orchestrator SHALL treat it as a Phase-3
environmental `BLOCKER`, surfaced to the human, and SHALL NOT proceed to the
squash/archive until resolved. Detection is mechanical; remediation
(re-applying a dropped constraint, or correcting a false `CONSTRAINT_REVIEWS`
record) remains a documented prompt-level obligation, not something the
check itself performs.

#### Scenario: tasks.md gained a constraint marker never carried to CONSTRAINTS
- **WHEN** `tasks.md` contains a `- [C2]` marker with no matching entry in
  `workflow-state.md`'s `CONSTRAINTS`
- **THEN** the check exits `1` (`DIVERGED`) naming the mismatched id, and the
  orchestrator blocks before archiving/squashing

#### Scenario: A skeptic verdict was never reviewed
- **WHEN** three skeptic verdicts have been returned this run
  (`SKEPTIC_VERDICTS_TOTAL == 3`) but only two non-planning
  `CONSTRAINT_REVIEWS` entries were recorded
- **THEN** the check exits `1` (`DIVERGED`) naming the count mismatch

#### Scenario: Either input file is missing entirely
- **WHEN** `workflow-state.md` or `tasks.md` does not exist at the expected
  change-dir path (a hard environmental error — Setup always writes
  `workflow-state.md`)
- **THEN** the check exits `2` with `MISSING <path>` — never `0`

#### Scenario: An existing workflow-state.md simply predates these fields
- **WHEN** `workflow-state.md` exists but has no `CONSTRAINTS`,
  `CONSTRAINT_REVIEWS`, or `SKEPTIC_VERDICTS_TOTAL` line (every run predating
  this change, and this run's own file before Setup writes it with the new
  fields)
- **THEN** the check treats each absent field as its empty default and, with
  no constraint markers in `tasks.md` either, exits `0` (`OK (none)`)

#### Scenario: No constraints agreed yet
- **WHEN** no skeptic verdict has been returned yet this run
  (`SKEPTIC_VERDICTS_TOTAL == 0`) and no constraint markers exist anywhere
- **THEN** the check exits `0` (`OK (none)`)
