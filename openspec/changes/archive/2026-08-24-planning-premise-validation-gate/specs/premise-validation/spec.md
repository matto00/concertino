## ADDED Requirements

### Requirement: Setup validates the ticket's premise before branch derivation

`core/roles/orchestrator.md`'s Setup section SHALL include a step, run after fetching the
ticket and before deriving a branch name, that checks the ticket's stated premise against the
live tree: cited facts/paths/symbols/counts, a bug/incident ticket's stated root cause,
whether acceptance criteria are already satisfied on the base branch, and collisions with
recently-merged sibling tickets (scoped to the ticket's own Linear parent/epic relation, if
any). The step SHALL run before `setup-worktree.sh` is called.

#### Scenario: A ticket citing a specific file and root cause is checked before the worktree exists

- **WHEN** Setup begins for a ticket whose description states a root cause tied to a specific
  file or symbol
- **THEN** the orchestrator verifies that claim against the live main checkout before deriving
  a branch name or calling `setup-worktree.sh`

### Requirement: The premise-validation step writes a fixed-shape evidence artifact

The orchestrator SHALL write a `premise-validation.md` artifact at the main checkout's repo
root (a bare filename, required for `persist-evidence.sh` to resolve the correct destination),
containing a `## Premise Validation` section with exactly three answered fields — `**Claims
checked:**`, `**Already-done scope:**`, `**Sibling collisions:**` — and a `**Verdict:**` line
whose value is one of `no-drift`, `minor-staleness`, `material-drift`. The write, the
`persist-evidence.sh "$TICKET_ID" premise-validation.md` call, and the removal of the
repo-root copy SHALL be issued as a single shell invocation against the main checkout's
absolute path, to shrink (though not eliminate — see the `premise-validation` capability's
design notes) the cross-run collision window on that fixed filename in the fleet model, and
the copy SHALL be removed regardless of outcome, leaving no stray untracked file behind.

#### Scenario: The evidence artifact is written before branch derivation

- **WHEN** the premise-validation step completes
- **THEN** `.concertino/runs/<TICKET_ID>/evidence/premise-validation.md` exists and contains a
  `## Premise Validation` section with all three fields and a `**Verdict:**` line, and no
  `premise-validation.md` remains at the main checkout's repo root

### Requirement: assert-phase.sh fails the setup gate when the premise-validation evidence is missing or incomplete

`core/scripts/assert-phase.sh setup` SHALL fail closed — printing `FAIL` and a non-zero exit —
when `.concertino/runs/<TICKET_ID>/evidence/premise-validation.md` (resolved against the main
checkout, the same way the Delivery gate's own gate-chain evidence check resolves it) is
absent, does not contain a `## Premise Validation` heading, has any of the three required
fields absent or holding only a placeholder value (`tbd`, `n/a`, `na`, `todo`, or empty), or
has a `**Verdict:**` line whose value is not one of `no-drift`, `minor-staleness`,
`material-drift`. This check applies to every `setup` invocation — it is not conditional on
any diff classification the way the Delivery gate-chain check is.

#### Scenario: A run that skips the premise-validation step fails the setup gate

- **WHEN** `assert-phase.sh setup <worktree> <ticket>` is run and no
  `premise-validation.md` evidence file exists for that ticket
- **THEN** it prints `FAIL` naming the missing premise-validation evidence and exits non-zero

#### Scenario: A premise-validation artifact with an unanswered field fails the setup gate

- **WHEN** `premise-validation.md` exists but its `**Sibling collisions:**` field is empty or
  `tbd`
- **THEN** `assert-phase.sh setup` prints `FAIL` naming the unanswered field and exits non-zero

#### Scenario: A complete premise-validation artifact with a valid verdict passes the setup gate

- **WHEN** `premise-validation.md` exists with all three fields substantively answered and
  `**Verdict:** no-drift`
- **THEN** `assert-phase.sh setup` does not fail on account of premise-validation (other
  existing setup checks still apply independently)

### Requirement: A material-drift verdict requires an actually-raised escalation

When `premise-validation.md`'s verdict is `material-drift`, `assert-phase.sh setup` SHALL
additionally require that `.concertino/runs/<TICKET_ID>/events.jsonl` contains an
`escalation.raised` event for that ticket, tagged `role=orchestrator`, whose `context` field
starts with the literal marker `TICKET-DRIFT-ESCALATION` (a prefix match — `emit-event.sh`
structurally drops any caller-supplied `kind=`, so the discriminator lives in `context`, not a
`kind` field; the marker survives `emit-event.sh`'s own context-truncation path because
truncation only ever removes bytes from the end of the string), before it will pass. Verdicts
of `no-drift` or `minor-staleness` carry no such requirement.

#### Scenario: A recorded material-drift verdict with no raised escalation fails the setup gate

- **WHEN** `premise-validation.md` records `**Verdict:** material-drift` but no matching
  `escalation.raised` event exists in the run's event log
- **THEN** `assert-phase.sh setup` prints `FAIL` naming the missing escalation and exits
  non-zero

#### Scenario: A recorded material-drift verdict with a matching raised escalation passes

- **WHEN** `premise-validation.md` records `**Verdict:** material-drift` and a matching
  `escalation.raised` event (role=orchestrator, `context` starting with
  `TICKET-DRIFT-ESCALATION`) exists in the run's
  event log
- **THEN** `assert-phase.sh setup` does not fail on account of the material-drift check

### Requirement: Minor staleness is re-derived and reported without escalating

The orchestrator SHALL re-derive the correct current fact and proceed without raising an
escalation when the premise-validation step finds only minor staleness — a moved path, an
off-by-one count, or a similar non-material discrepancy that does not change what gets built.
The re-derived fact and a `**Verdict:** minor-staleness` line SHALL be recorded in
`premise-validation.md`.

#### Scenario: A moved-path discrepancy is corrected silently

- **WHEN** a ticket cites a file at a path that has since moved but the file, and the
  scope it describes, still exist unchanged elsewhere
- **THEN** the orchestrator records the corrected path in `premise-validation.md`, sets
  `**Verdict:** minor-staleness`, and proceeds to branch derivation without escalating

### Requirement: Material drift raises a structured ticket-drift escalation

The orchestrator SHALL raise an escalation using `gather-escalation-context.sh ticket-drift`
(per the `escalation-context` capability's `ticket-drift` kind) when the premise-validation
step finds drift that changes what would get built — a refuted root cause, scope already
fully implemented, or a sibling collision that invalidates the ticket's enumeration. The
escalation SHALL carry `claimed` set to what the ticket states, `actual` set to what the live
tree/base branch shows, and `options` covering at least `proceed-as-written`,
`proceed-with-restated-scope`, and `halt`, and SHALL be raised via the orchestrator's existing
"How to raise one" escalation procedure (TUI-liveness check, topology branch, per-call
timeout) rather than a bespoke raise path.

#### Scenario: A refuted root cause raises a ticket-drift escalation

- **WHEN** the premise-validation step finds that a bug ticket's stated root cause does not
  hold against the live tree
- **THEN** the orchestrator raises a `ticket-drift` escalation with the claimed root cause, the
  actual finding, and the proceed/re-scope/halt options, and does not derive a branch or call
  `setup-worktree.sh` until it is resolved

### Requirement: The premise-validation cost is bounded on a no-drift ticket

On a ticket with no drift, the premise-validation step SHALL require no sub-agent spawn, no
escalation, and no additional gate/loop beyond the existing Setup sequence — its cost is bounded
to a read/verification pass over the ticket's own cited facts plus one `persist-evidence.sh`
write of the `premise-validation.md` artifact.

#### Scenario: A ticket that cites no specific facts costs one evidence write

- **WHEN** a ticket describes new, self-contained work with no cited files/paths/counts/root
  cause and no epic siblings
- **THEN** the premise-validation step records `**Verdict:** no-drift` with a brief
  `**Claims checked:**` note (e.g. "no specific facts cited") and proceeds, having spawned no
  sub-agent and raised no escalation
