# cli-harness-flag Specification

## Purpose
Defines the unified `--harness` flag contract shared by `sync`, `diff`, and
`eject`: comma-separated-list parsing with validation against the known
harness ids, and `eject`'s corresponding multi-harness rendering behavior
(including its upfront, harness-independent `--role` validation).

## Requirements
### Requirement: Shared `--harness` comma-list parsing and validation
`sync`, `diff`, and `eject` SHALL parse `--harness` identically: split on
commas, trim each entry, drop empty entries, and validate every remaining
entry against the fixed set `claude-code`, `codex`, `opencode`. If any entry
is not in that set, the command SHALL print a single error naming every
invalid entry and the valid set, and exit non-zero, without performing any
of its normal side effects (writing files, printing a diff, or printing
rendered agent output).

#### Scenario: sync rejects an unrecognized harness name
- **WHEN** a user runs `concertino sync --harness=claude-code,bogus`
- **THEN** the command prints an error naming `bogus` as invalid and listing
  `claude-code, codex, opencode` as the valid set, exits non-zero, and writes
  no files

#### Scenario: diff rejects an unrecognized harness name
- **WHEN** a user runs `concertino diff --harness=bogus`
- **THEN** the command prints an error naming `bogus` as invalid and listing
  the valid set, and exits non-zero

#### Scenario: eject rejects an unrecognized harness name
- **WHEN** a user runs `concertino eject --role=executor --harness=bogus`
- **THEN** the command prints an error naming `bogus` as invalid and listing
  the valid set, exits non-zero, and prints no rendered output to stdout

### Requirement: eject accepts and acts on a comma-separated `--harness` list
`eject --harness` SHALL accept a comma-separated list of harness ids,
identical in parsing to `sync`/`diff`'s own `--harness`, and SHALL render and
print the requested `--role`'s output for every named harness that supports
it (rather than only the first, or erroring on more than one).

#### Scenario: eject renders multiple harnesses in one invocation
- **WHEN** a user runs
  `concertino eject --role=executor --harness=claude-code,opencode`
- **THEN** stdout contains the rendered `executor` output for both
  `claude-code` and `opencode`, each preceded by a
  `# ---- harness: <name> ----` header line, in the order the harnesses were
  given

### Requirement: eject's single-harness output is unchanged
`eject` SHALL print exactly the raw rendered file content to stdout, with no
`# ---- harness: ... ----` header, byte-for-byte identical to its behavior
before this change, whenever `--harness` names exactly one harness — whether
passed explicitly as a single value or omitted (defaulting to `claude-code`
alone, as today).

#### Scenario: bare eject with no --harness is unaffected
- **WHEN** a user runs `concertino eject --role=executor` (no `--harness`)
- **THEN** stdout is exactly the rendered Claude Code `executor` agent file,
  with no harness header line, identical to output before this change

#### Scenario: explicit single-harness eject is unaffected
- **WHEN** a user runs `concertino eject --role=executor --harness=codex`
- **THEN** stdout is exactly the rendered Codex `executor` agent TOML, with
  no harness header line, identical to output before this change

### Requirement: eject validates --role globally, once, before per-harness rendering
`eject` SHALL validate `--role` against the fixed 5-role set
(`orchestrator`, `executor`, `evaluator`, `skeptic`, `auditor`) exactly once,
before rendering any harness in the `--harness` list, and SHALL exit
non-zero with a single "unknown role" error — printing no rendered output —
whenever `--role` is outside that set, regardless of how many harnesses were
named. This check is independent of, and SHALL NOT be folded into, the
per-harness codex-specific role-support check below: a role outside the
5-role set is invalid for every harness, not a per-harness capability gap.

#### Scenario: a globally-invalid role errors once, not once per harness
- **WHEN** a user runs
  `concertino eject --role=bogus --harness=claude-code,opencode`
- **THEN** the command prints exactly one "unknown role" error (not one per
  named harness), prints no rendered output to stdout, and exits non-zero

#### Scenario: a globally-invalid role with a single harness behaves the same as with a list
- **WHEN** a user runs `concertino eject --role=bogus --harness=codex`
- **THEN** the command prints the same single "unknown role" error, prints
  no rendered output, and exits non-zero — identical in shape to the
  multi-harness case above

### Requirement: eject skips a harness that doesn't support the requested role
Once `--role` has passed the global validity check above, `eject` SHALL
print the existing codex-specific role-not-supported stderr note and omit a
harness's section from stdout, continuing to render the remaining harnesses
in the list, whenever `--harness` names more than one harness and one of
them is `codex` with a `--role` outside codex's own narrower supported set
(`executor`, `evaluator`, `auditor`). `eject` SHALL exit non-zero only if
every harness in the list was either invalid or unsupported for the
requested role, leaving zero rendered sections.

#### Scenario: unsupported role is skipped, not fatal, when other harnesses in the list are valid
- **WHEN** a user runs
  `concertino eject --role=skeptic --harness=codex,claude-code`
- **THEN** stderr notes that codex doesn't support the `skeptic` role, stdout
  contains only the rendered `claude-code` `skeptic` output (with its
  harness header, since more than one harness was named), and the command
  exits 0

#### Scenario: unsupported role for every named harness is fatal
- **WHEN** a user runs `concertino eject --role=skeptic --harness=codex`
- **THEN** the command prints the role-not-supported error and exits
  non-zero, printing no rendered output — identical to today's single-harness
  behavior for this case

