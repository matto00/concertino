# verdict-sha-binding Specification

## Purpose
Binds each gate verdict to the source state that verdict actually reviewed, so that a merge cannot inherit a PASS or CONFIRM issued about a different state, and so drift between review and merge is detected mechanically rather than by a reader noticing a SHA in prose.

## Requirements

### Requirement: Verdict events record the reviewed SHA

A `verdict` event emitted for the `evaluator` or `skeptic` role SHALL record the commit SHA that role reviewed, together with an indication of whether that SHA was stated by the role or inferred by the script at emit time.

#### Scenario: Role states the SHA it reviewed
- **WHEN** a verdict is emitted with an explicit `head_sha` argument
- **THEN** the event records that SHA and marks its source as stated

#### Scenario: Role omits the SHA
- **WHEN** a verdict is emitted with no `head_sha` argument and the emitting process is inside a git worktree
- **THEN** the event records the current HEAD SHA and marks its source as inferred, distinguishably from a stated SHA

#### Scenario: SHA cannot be determined
- **WHEN** a verdict is emitted with no `head_sha` and no resolvable git HEAD
- **THEN** the event is still written, carrying no SHA, and the emission does not fail

### Requirement: Merge readiness refuses when reviewed source has moved

`check-merge-readiness.sh` SHALL refuse a merge when the source content at the branch head differs from the source content at the SHA recorded on the latest evaluator PASS or the latest skeptic CONFIRM, ignoring only the planning-artifact paths that the delivery archive step legitimately rewrites.

#### Scenario: Head moved but source content is unchanged
- **WHEN** the branch has been squashed and archived after review, so the head SHA differs from every reviewed SHA, but no source path differs
- **THEN** the check passes condition 3

#### Scenario: A source commit landed after review
- **WHEN** a source file differs between a recorded reviewed SHA and the branch head
- **THEN** the check refuses, naming the role, the reviewed SHA, the head SHA and the changed paths, and exits with the distinct stale outcome code

#### Scenario: The reviewed SHA is unresolvable
- **WHEN** a recorded reviewed SHA is not present in the repository's object database
- **THEN** the check refuses rather than passing, reporting that the reviewed state could not be verified

#### Scenario: Verdicts predating this capability
- **WHEN** the latest evaluator or skeptic verdict carries no recorded SHA at all
- **THEN** the check reports the verdict as unbound and refuses, rather than silently treating an absent SHA as a match

### Requirement: A stale verdict is a resumable outcome, not a terminal failure

The stale outcome SHALL be distinguishable by exit code from both a hard failure and a CI-pending result, and SHALL leave the run able to re-review and re-invoke.

#### Scenario: The auditor lease protocol is unchanged by a stale outcome
- **WHEN** the check refuses because a reviewed SHA is stale
- **THEN** the auditor lease is NOT released inside the check; it is released, as it already is for every other outcome, by the auditor's own verdict emission

#### Scenario: Re-review clears the refusal
- **WHEN** the gate whose verdict was stale is re-run against the current head and emits a fresh verdict
- **THEN** a subsequent invocation of the check passes condition 3

### Requirement: The comparison is scoped to the branch's own contribution

The check SHALL compare only paths this branch itself modified relative to its base, so that content merged in from an advancing base ref is not mistaken for work this run authored.

#### Scenario: A base merge changes a path the branch never touched
- **WHEN** the base ref advances and is merged into the branch after review, changing only paths the branch never modified
- **THEN** the check passes that leg

#### Scenario: A base merge changes a path the branch also modified
- **WHEN** the merged base content changes a path this branch also modified
- **THEN** the check refuses, because that interaction has not been reviewed

#### Scenario: The branch contributed no paths outside the archive prefix
- **WHEN** the branch's contribution outside the archive prefix is empty
- **THEN** the check passes that leg, and does not fall back to comparing every path

#### Scenario: The base ref cannot be resolved
- **WHEN** the base ref cannot be determined or its merge-base cannot be computed
- **THEN** the check refuses rather than proceeding with an unscoped comparison

### Requirement: The archive prefix is supplied by the caller

The excluded planning-artifact prefix SHALL be supplied to the check by its caller rather than hardcoded, so projects that archive outside `openspec/` are not refused.

#### Scenario: A project archiving under a different prefix
- **WHEN** the caller supplies its own configured change-directory root
- **THEN** the check excludes that prefix, and no other

### Requirement: The head checked is the head that will be merged

The check SHALL verify that the local head it compares is the same commit the pull request would merge.

#### Scenario: Local head and pull-request head agree
- **WHEN** the local head equals the pull request's head commit
- **THEN** the check proceeds using that head

#### Scenario: Local head and pull-request head diverge
- **WHEN** they differ, or the pull request's head cannot be read
- **THEN** the check refuses rather than verifying a state that is not the one being merged

### Requirement: An owner override waives only the skeptic content check

An owner override of a budget-exhausted final gate SHALL waive the skeptic content check only, and SHALL never waive the evaluator content check.

#### Scenario: Override run, evaluator content moved
- **WHEN** the skeptic gate is cleared by an owner override and source content has moved since the evaluator's PASS
- **THEN** the check still refuses on the evaluator leg

#### Scenario: Override run, skeptic leg
- **WHEN** the skeptic gate is cleared by an owner override
- **THEN** the skeptic content check is skipped and reported as not performed
