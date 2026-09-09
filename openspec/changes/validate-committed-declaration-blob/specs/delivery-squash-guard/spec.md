# delivery-squash-guard Specification

## MODIFIED Requirements

### Requirement: Staged file set is guarded against the run's declared touched-file set
The squash step SHALL compare the file set that the merge-base reset *would*
stage — computed without moving HEAD — against the union of (a) a
caller-supplied `<CHANGE_DIR>/**` workflow-artifact allowlist (never hardcoded
in the script itself) and (b) the paths parsed out of the change's
`files-modified.md` declaration **as that declaration exists in the index**,
and SHALL stop without committing if that set contains any file outside that
union. The declaration SHALL be read from the staged blob, never from the
worktree file, so the content the guard validates is the content the commit
captures.

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
- **WHEN** the staged `files-modified.md` blob is absent, or its content
  contains no line matching a leading-bullet backtick-quoted path, and at least
  one prospective staged file falls outside the fixed workflow-artifact
  allowlist
- **THEN** the script fails loudly — printing the raw declaration content (if
  present) and the outstanding staged paths — and exits non-zero unless
  `--allow-empty-declaration` was passed, in which case it proceeds

#### Scenario: The on-disk declaration differs from the staged declaration
- **WHEN** the worktree copy of `<CHANGE_DIR>/files-modified.md` differs from
  the blob staged in the index at squash time
- **THEN** the script exits non-zero, commits nothing, and reports the
  divergence together with the remedy (stage the corrected declaration, or
  revert it, then re-run) — the divergence is never resolved silently toward
  either copy

#### Scenario: The declaration exists on disk but is absent from the index
- **WHEN** `<CHANGE_DIR>/files-modified.md` is present in the worktree but has
  no staged blob (untracked, or staged for deletion)
- **THEN** the script exits non-zero with a diagnostic naming that specific
  cause AND stating the self-service remedy (stage the declaration, then
  re-run), rather than falling through to the generic no-usable-declaration
  branch whose remedy would be the wrong one

#### Scenario: The declaration is absent from the worktree but present in the index
- **WHEN** `<CHANGE_DIR>/files-modified.md` has a staged blob but no worktree
  file
- **THEN** the script parses the staged blob and proceeds — this is not a
  divergence, because the staged blob is exactly what the commit will capture —
  and the declaration it contains is still enforced, so a staged file that blob
  does not declare is still refused

#### Scenario: --allow-empty-declaration does not suppress a declaration divergence
- **WHEN** the declaration diverges between index and worktree, or is present on
  disk but absent from the index, and `--allow-empty-declaration` is passed
- **THEN** the script still exits non-zero and commits nothing, because that
  flag opts in only to the narrowly-stated no-usable-declaration condition and
  is never a general proceed-anyway switch
