## MODIFIED Requirements

### Requirement: Verdict events record the reviewed SHA

A `verdict` event emitted for the `evaluator` or `skeptic` role SHALL record the commit SHA that role reviewed, together with an indication of whether that SHA was stated by the role or inferred by the script at emit time. When a `head_sha` is stated explicitly, it SHALL be a full 40-character hexadecimal SHA; a stated value of any other length or containing any non-hexadecimal character SHALL be refused with a non-zero exit and a message stating the required form, and SHALL append no event. A verdict recorded against a malformed SHA is worse than one recorded against none, because it looks verified. This format constraint applies only to a STATED `head_sha`: omitting `head_sha` remains legitimate and unchanged, and an inferred SHA is full-length by construction because it comes from resolving the current git HEAD.

#### Scenario: Role states the SHA it reviewed
- **WHEN** a verdict is emitted with an explicit `head_sha` argument that is a full 40-character hexadecimal SHA
- **THEN** the event records that SHA and marks its source as stated

#### Scenario: Role states an abbreviated SHA
- **WHEN** a verdict is emitted with an explicit `head_sha` shorter than 40 characters, such as an abbreviated or truncated SHA
- **THEN** the command exits non-zero with a message stating that a full 40-character hexadecimal SHA is required, and no event is appended

#### Scenario: Role states a non-hexadecimal SHA
- **WHEN** a verdict is emitted with an explicit `head_sha` of 40 characters containing a non-hexadecimal character
- **THEN** the command exits non-zero with a message stating the required form, and no event is appended

#### Scenario: Role omits the SHA
- **WHEN** a verdict is emitted with no `head_sha` argument and the emitting process is inside a git worktree
- **THEN** the event records the current HEAD SHA and marks its source as inferred, distinguishably from a stated SHA

#### Scenario: SHA cannot be determined
- **WHEN** a verdict is emitted with no `head_sha` and no resolvable git HEAD
- **THEN** the event is still written, carrying no SHA, and the emission does not fail

#### Scenario: A refused auditor verdict still releases the teardown lease
- **WHEN** a `verdict` event with `role=auditor` is emitted with a malformed stated `head_sha` and is refused
- **THEN** the auditor's teardown lease is released exactly as it would be for an accepted verdict, and the command still exits non-zero

#### Scenario: Historical verdicts carrying a malformed SHA are not rewritten
- **WHEN** an event log already contains a `verdict` event whose recorded `head_sha` is not a full 40-character SHA
- **THEN** that event is left exactly as written, and every consumer keeps its existing behavior for it
