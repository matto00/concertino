## 1. Fix the canonical template

- [x] 1.1 Update the comment at `core/scripts/cleanup.sh` (originally lines
      51-52) to the corrected text CON-32 already put in the rendered copy:
      that `renderEnv()` writes both `CONCERTINO_BASE_BRANCH` and
      `CONCERTINO_BASE_REMOTE` (the latter from `project.baseRemote`,
      defaulting to `origin`).

## 2. Propagate and verify

- [x] 2.1 Run `concertino sync` (or the project's equivalent re-render step)
      against this checkout so `scripts/concertino/cleanup.sh` picks up the
      corrected comment from the template.
- [x] 2.2 `git diff` to confirm `scripts/concertino/cleanup.sh`'s comment now
      matches the corrected text, and that no unrelated files changed as a
      side effect of the sync.
- [x] 2.3 Re-run `concertino sync` a second time and confirm it is a no-op
      for `scripts/concertino/cleanup.sh` (proves the fix is durable, i.e.
      acceptance criterion 2).

## 3. Audit for similar drift

- [x] 3.1 Diff every `core/scripts/*.sh` against its rendered
      `scripts/concertino/*.sh` counterpart; fix any other file pair found to
      have diverged the same way (fix applied to the rendered copy only, not
      the template it's regenerated from). No other pair diverged (all 10
      `core/scripts/*.sh` templates match their rendered
      `scripts/concertino/*.sh` counterparts byte-for-byte after this
      ticket's sync).
