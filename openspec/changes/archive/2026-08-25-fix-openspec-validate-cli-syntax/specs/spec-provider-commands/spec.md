## ADDED Requirements

### Requirement: Documented openspec invocations MUST match the installed CLI surface

Every `openspec` command that Concertino instructs an agent to run — whether authored directly in `core/roles/*.md`, injected at render time from `specProvider.*Cmd` configuration, hardcoded as a render fallback, or scaffolded into a new project by `concertino init` — MUST be a valid invocation of the openspec CLI surface the documentation states it targets.

Specifically, the planning-artifact validation command MUST name the change as a positional argument with an explicit `--type change`, not via a `--change` flag, which the targeted CLI does not accept.

#### Scenario: Validation command is invoked with the documented form

- **WHEN** an agent runs the validation command exactly as the role documentation and rendered agent outputs instruct
- **THEN** the openspec CLI accepts the invocation and actually performs validation
- **AND** it does not terminate with `error: unknown option '--change'`

#### Scenario: A newly initialised project inherits a valid command

- **WHEN** `concertino init` scaffolds a configuration with `specProvider.kind` of `openspec`
- **THEN** the generated `specProvider.validateCmd` is a valid invocation of the targeted CLI surface

#### Scenario: A configuration omitting the validation command falls back to a valid default

- **WHEN** a configuration sets `specProvider.kind` to `openspec` but omits `validateCmd`
- **THEN** the render fallback supplies a valid invocation of the targeted CLI surface

### Requirement: The validation gate MUST fail observably on a malformed change

The planning validation step MUST be able to distinguish a malformed set of planning artifacts from a well-formed one, and the role documentation MUST assert on whichever signal the CLI reports failure through.

The targeted CLI reports validation failure through a non-zero exit status, so asserting on exit status is sufficient and the documentation MUST NOT be required to parse stdout.

#### Scenario: Malformed change is rejected

- **WHEN** the documented validation command is run against a change whose spec deltas are malformed
- **THEN** the command reports the validation errors
- **AND** it exits with a non-zero status

#### Scenario: Well-formed change is accepted

- **WHEN** the documented validation command is run against a well-formed change
- **THEN** the command reports the change as valid
- **AND** it exits zero

### Requirement: The targeted openspec CLI version MUST be stated with a disagreement rule

The role documentation MUST record which openspec CLI version its documented command surface was verified against, and MUST tell the agent what to do when the installed CLI disagrees with the documentation.

#### Scenario: Agent encounters a CLI that contradicts the documentation

- **WHEN** an agent finds that `openspec <command> --help` on the installed CLI disagrees with the command form the documentation instructs
- **THEN** the documentation directs the agent to trust the installed CLI's own help output
- **AND** to raise a follow-up rather than guessing at a replacement invocation
