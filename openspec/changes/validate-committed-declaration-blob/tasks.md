# Tasks

## 1. Fix the read source (D1, D6)

- [x] 1.1 In `core/scripts/squash-branch.sh`, read the declaration from the
      staged blob via `git show :<CHANGE_DIR_NORM>/files-modified.md` (run
      against the worktree) instead of from `FILES_MODIFIED_PATH`.
- [x] 1.2 Keep the existing D2a/D2a-ii parse (leading bullet, every
      backtick-quoted path-shaped span) unchanged — only its input changes.
- [x] 1.3 (D6) Point the failure-branch diagnostics at the same source the
      decision used: echo the STAGED BLOB as the raw declaration content, and
      word the "allowed:" line as the staged declaration rather than naming
      `$FILES_MODIFIED_PATH`.

## 2. Refuse on divergence (D2, D3, D4, D4a, D7)

- [x] 2.1 ONLY WHEN the worktree file exists (`[ -f "$FILES_MODIFIED_PATH" ]` —
      on-disk presence is evaluated first, per 2.2/2.4, and routes control):
      refuse, non-zero and committing nothing, when the staged blob and the
      worktree copy of the declaration file differ. Detect via
      `git diff --quiet -- <CHANGE_DIR_NORM>/files-modified.md` (D7), never by
      string-comparing command substitutions. Note the detector exits 1 for a
      worktree deletion, so running it ungated would wrongly refuse the 2.4
      shape. Print both the cause and the
      remedy (stage the corrected declaration, or revert it, then re-run).
- [x] 2.2 Refuse, with a distinct diagnostic naming the cause AND stating the
      self-service remedy `git add <CHANGE_DIR>/files-modified.md`, when the
      declaration exists on disk but is absent from the index. Branch on the
      file's on-disk presence, not on `git show`'s exit code (128 covers both
      that case and missing-from-both).
- [x] 2.3 Scope both refusals to the declaration file only — no other declared
      path is checked for dirtiness.
- [x] 2.4 (D4a) When the declaration has a staged blob but no worktree file,
      parse the blob and proceed — not a divergence, and the D7 detector is not
      reached at all on this path. Note in the output that the declaration was
      read from the index with no worktree copy present. (Separately, per D6/1.3,
      the GENERIC no-usable-declaration diagnostic is phrased around the absence
      of a staged blob rather than around the worktree path — that is the generic
      branch, not this one.)

## 3. Keep the escape hatches narrow (D5, D4a)

- [x] 3.1 Evaluate 2.1 and 2.2 independently of `ALLOW_EMPTY_DECLARATION`, so
      that flag cannot suppress either.
- [x] 3.2 D4a is itself an exemption (it skips the divergence check), so it must
      not become a route past the declaration check: the blob must still be
      parsed and enforced, never treated as an empty declaration.

## 4. Tests (mutation-proven)

- [x] 4.1 Add a scenario to `test/scripts/squash-branch.test.sh`: stage one
      declaration content, write DIFFERENT content to disk, assert the script
      refuses and commits nothing.
- [x] 4.2 Add a scenario asserting the divergent on-disk declaration cannot
      authorise a staged file the STAGED declaration does not declare (the
      probe's live-bypass shape).
- [x] 4.3 Add a structural scenario (D5): the same divergence WITH
      `--allow-empty-declaration` passed still refuses.
- [x] 4.3b Add the other half of D5 (CR3): declaration on disk but NOT in the
      index, `--allow-empty-declaration` passed, still refuses and commits
      nothing.
- [x] 4.4 Add a scenario: declaration on disk but not in the index refuses with
      its own diagnostic, and assert the remedy text (`git add ...`) is present
      in that diagnostic — not merely that some distinct message fired.
- [x] 4.4b Add a scenario (D4a / task 3.2): declaration absent on disk with a
      staged blob present — the blob is parsed and enforced, so an undeclared
      staged file is still refused. This is the structural check that D4a's
      exemption did not become a blanket amnesty.
- [x] 4.4c Add a scenario pinning the ordering (CR1, round 2): declaration with a
      staged blob and NO worktree file, whose blob declares every staged path —
      the script must COMMIT, proving the D7 divergence detector was not reached.
- [x] 4.5 Add a regression scenario: an ordinary run whose declaration is
      identical in index and worktree still commits normally.
- [x] 4.6 Prove 4.1, 4.2, 4.3, 4.3b, 4.4, 4.4b failable by mutation (and, if cheap, 4.4c under an ORDERING mutation: move the divergence detector ahead of the -f branch and show 4.4c goes red), using the
      suite's existing in-place mutate/restore convention: revert the fix in the
      real script, show each scenario goes red, restore. Capture the transcript
      as evidence.

## 5. Spec

- [x] 5.1 Update the `delivery-squash-guard` spec delta: the declaration source
      is the staged blob; declaration divergence and absence-from-index are
      refusals not suppressible by `--allow-empty-declaration`; absent-on-disk
      with a staged blob parses the blob and proceeds.

## 6. Out of scope (do not do)

- [x] 6.1 No dry-run flag (CON-164).
- [x] 6.2 No edit to `scripts/concertino/squash-branch.sh` (render target;
      drift routed to CON-172).
- [x] 6.3 No unrelated refactor of `squash-branch.sh`.
