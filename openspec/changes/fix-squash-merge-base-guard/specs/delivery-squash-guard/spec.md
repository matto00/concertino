## ADDED Requirements

### Requirement: Squash resets against the branch's true merge-base
The delivery squash step SHALL reset the branch against
`git merge-base HEAD <base-ref>` rather than against `<base-ref>`'s current
tip, so commits landed on the base after the branch diverged are never staged
as reverts.

#### Scenario: Base advanced with an unrelated merge during Execution
- **WHEN** a sibling change merges to the base ref while this branch is still
  in its Execution/Evaluation loop, and the branch later reaches Delivery
- **THEN** squashing resets against the merge-base computed at squash time,
  and the sibling change's files are not staged for deletion or modification

### Requirement: Staged file set is guarded against the run's declared touched-file set
The squash step SHALL compare the file set staged by the merge-base reset
against the union of (a) a caller-supplied `<CHANGE_DIR>/**` workflow-artifact
allowlist (never hardcoded in the script itself) and (b) the paths parsed out
of the change's `files-modified.md` declaration, and SHALL stop without
committing if the staged set contains any file outside that union.

#### Scenario: Staged set exceeds the declared touched-file set
- **WHEN** the post-reset staged file list contains a path absent from both
  the fixed workflow-artifact allowlist and the parsed `files-modified.md`
  declaration
- **THEN** the script exits non-zero, commits nothing, and reports the
  unexpected file(s) explicitly

#### Scenario: Staged set matches the declared touched-file set
- **WHEN** every staged file is present in the fixed workflow-artifact
  allowlist or the parsed `files-modified.md` declaration
- **THEN** the script proceeds to create the squash commit

#### Scenario: A workflow artifact is staged but not individually named in files-modified.md
- **WHEN** a staged file falls under the caller-supplied `<CHANGE_DIR>/**`
  (e.g. `proposal.md`, `workflow-state.md`, a `skeptic-*.md` report) and is
  not itself listed in `files-modified.md`
- **THEN** the script proceeds without stopping, because the change-dir
  allowlist already covers it — regardless of whether `<CHANGE_DIR>` is
  `openspec/changes/<name>` or a project-configured alternative

#### Scenario: files-modified.md yields no parseable paths while staged files remain outstanding
- **WHEN** `files-modified.md` is missing, or its content contains no line
  matching a leading-bullet backtick-quoted path, and at least one staged
  file falls outside the fixed workflow-artifact allowlist
- **THEN** the script fails loudly — printing the raw declaration content (if
  present) and the outstanding staged paths — and exits non-zero unless
  `--allow-empty-declaration` was passed, in which case it proceeds

### Requirement: Staged file count and list are always printed before committing
The squash step SHALL print the staged file count and the full staged file
list before creating any commit, regardless of whether the guard trips.

#### Scenario: Ordinary successful squash
- **WHEN** the guard passes and the script proceeds to commit
- **THEN** the staged file count and list were already printed to output
  before that commit was created

### Requirement: Base advancement is logged explicitly
The squash step SHALL detect and log when the base ref's tip differs from the
computed merge-base (i.e. the base advanced since the branch point), without
requiring a rebase before squashing.

#### Scenario: Base ref tip differs from merge-base
- **WHEN** `<base-ref>`'s current tip is not identical to
  `git merge-base HEAD <base-ref>`
- **THEN** the script logs that the base advanced and how many commits
  separate the merge-base from the base ref's tip, then proceeds using D1's
  merge-base reset
