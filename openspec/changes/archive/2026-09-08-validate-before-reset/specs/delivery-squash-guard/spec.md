## MODIFIED Requirements

### Requirement: Staged file set is guarded against the run's declared touched-file set
The squash step SHALL compare the file set that the merge-base reset *would*
stage — computed without moving HEAD — against the union of (a) a
caller-supplied `<CHANGE_DIR>/**` workflow-artifact allowlist (never hardcoded
in the script itself) and (b) the paths parsed out of the change's
`files-modified.md` declaration, and SHALL stop without committing if that set
contains any file outside that union.

#### Scenario: Staged set exceeds the declared touched-file set
- **WHEN** the prospective staged file list contains a path absent from both
  the fixed workflow-artifact allowlist and the parsed `files-modified.md`
  declaration
- **THEN** the script exits non-zero, commits nothing, and reports the
  unexpected file(s) explicitly

#### Scenario: Staged set matches the declared touched-file set
- **WHEN** every prospective staged file is present in the fixed
  workflow-artifact allowlist or the parsed `files-modified.md` declaration
- **THEN** the script resets against the merge-base and creates the squash
  commit

#### Scenario: A workflow artifact is staged but not individually named in files-modified.md
- **WHEN** a prospective staged file falls under the caller-supplied
  `<CHANGE_DIR>/**` (e.g. `proposal.md`, `workflow-state.md`, a `skeptic-*.md`
  report) and is not itself listed in `files-modified.md`
- **THEN** the script proceeds without stopping, because the change-dir
  allowlist already covers it — regardless of whether `<CHANGE_DIR>` is
  `openspec/changes/<name>` or a project-configured alternative

#### Scenario: files-modified.md yields no parseable paths while staged files remain outstanding
- **WHEN** `files-modified.md` is missing, or its content contains no line
  matching a leading-bullet backtick-quoted path, and at least one prospective
  staged file falls outside the fixed workflow-artifact allowlist
- **THEN** the script fails loudly — printing the raw declaration content (if
  present) and the outstanding staged paths — and exits non-zero unless
  `--allow-empty-declaration` was passed, in which case it proceeds

### Requirement: Staged file count and list are always printed before committing
The squash step SHALL print the prospective staged file count and the full
staged file list before creating any commit and before performing the reset,
regardless of whether the guard trips.

#### Scenario: Ordinary successful squash
- **WHEN** the guard passes and the script proceeds to reset and commit
- **THEN** the staged file count and list were already printed to output
  before that reset and commit

## ADDED Requirements

### Requirement: A refusal leaves the branch exactly as it found it
The squash step SHALL NOT move HEAD, alter the index, or alter the working
tree on any path that ends in a refusal. The merge-base reset SHALL be
performed only after the guard has passed, so a branch whose squash was
refused retains its own commits reachable from HEAD and can be inspected,
corrected and re-squashed without consulting the reflog.

#### Scenario: Guard refuses a branch carrying its own commits
- **WHEN** the guard rejects the prospective staged set — because a staged
  path is outside the declared union, or because no usable declaration exists
  while unexpected paths remain
- **THEN** the script exits non-zero having committed nothing, and
  `git rev-parse HEAD` is identical to its value before the script ran

#### Scenario: An earlier precondition fails
- **WHEN** the script stops before the guard for any other reason — an
  ambiguous merge-base, or a merge-base that cannot be computed
- **THEN** HEAD is likewise unchanged, because no reset has been attempted
  at that point
