## 1. Canonical script

- [x] 1.1 Create `core/scripts/squash-branch.sh`: usage
      `squash-branch.sh <WORKTREE_PATH> <BASE_REMOTE> <BASE_BRANCH> <SUBJECT> <CHANGE_DIR> [--allow-empty-declaration]`
      (mirror the flag/arg style of `core/scripts/setup-worktree.sh`).
      `<CHANGE_DIR>` is the caller-supplied, already-substituted change
      directory path (e.g. `openspec/changes/<name>` or whatever
      `specProvider.changeDir` resolves to for this project) — the script
      NEVER hardcodes `openspec/changes/...` itself, since `core/scripts/**`
      is copied verbatim with no variable substitution
      (`lib/cli/emit.js:426-428`) and `specProvider.changeDir` is
      configurable (`config/concertino.schema.json:42`,
      `lib/cli/init.js:135`). Mirrors `next-report-number.sh`'s
      caller-passes-the-path convention.
- [x] 1.2 Implement merge-base reset: compute
      `git -C <worktree> merge-base --all HEAD <base-remote>/<base-branch>`;
      if it returns more than one line (criss-cross history), print both and
      exit non-zero (loud stop, no guessing); otherwise `git reset --soft
      <merge-base>`.
- [x] 1.3 Implement base-advancement detection/logging: compare
      `<base-remote>/<base-branch>`'s tip to the computed merge-base; if
      different, log the count of commits between them
      (`git rev-list --count <merge-base>..<base-tip>`). This is a log only —
      it never blocks or requires a rebase (see design.md D3).
- [x] 1.4 Implement the staged-file guard:
      - After the reset, `git diff --cached --name-only`.
      - Build the allowed set as the union of (a) the glob
        `<CHANGE_DIR>/**` (the caller-supplied argument — never hardcoded)
        and (b) paths parsed from `<CHANGE_DIR>/files-modified.md`.
      - Parse `files-modified.md` per design.md D2a: only lines matching
        `^\s*[-*]\s*` followed by a backtick-quoted path count as a
        declared path; ignore backticks elsewhere on the line.
      - If `files-modified.md` is missing, or parses to zero paths while the
        staged set (outside the fixed allowlist) is non-empty, this is
        "no usable declaration": require `--allow-empty-declaration`, else
        print the raw file content (if any) + the staged paths outside the
        allowlist, and exit non-zero without committing.
      - Any staged path outside the allowed union → print every such
        unexpected path, exit non-zero, no commit made.
- [x] 1.5 Always print the staged file count + full file list before any
      commit, unconditionally.
- [x] 1.6 On guard pass, create the squash commit with the given subject
      (`<TICKET_ID> <description>` + `Co-Authored-By:` trailer, supplied by
      the caller).
- [x] 1.7 `chmod +x core/scripts/squash-branch.sh`.

## 2. Orchestrator wiring

- [x] 2.1 Update `core/roles/orchestrator.md` Phase 3 Delivery step 1 (the
      line reading "Squash all branch commits into one with subject ... and
      trailer ...", ~line 775) to replace the unspecified squash mechanism
      with an explicit call to `scripts/concertino/squash-branch.sh`,
      passing the ticket subject/trailer AND the `<change-dir>` token (the
      same substitution `lib/cli/render.js:202` already performs elsewhere
      in role prose from `c.specProvider.changeDir`) as `<CHANGE_DIR>` —
      never a hardcoded `openspec/changes/...` literal. Document the
      guard-trip (non-zero exit) outcome as a `BLOCKER` per the existing
      escalation table, surfaced to the human with the script's printed
      unexpected-file list.
- [x] 2.2 Confirm (do NOT run `concertino sync` against this repo) that
      `lib/cli/emit.js`'s and `lib/cli/resolve-core.js`'s existing
      `listFilesRecursive` enumeration of `core/scripts` already covers a new
      `core/scripts/squash-branch.sh` with no pipeline change needed —
      already verified true at design-gate round 1; no action beyond
      confirming it still holds after 1.1 lands.

## 3. Throwaway-repo acceptance test (red-before-green)

- [x] 3.1 Create `test/scripts/squash-branch.test.sh` (this repo's existing
      convention for script-level tests, distinct from the
      `core/scripts/*.selftest.sh` rendered-artifact convention). It builds a
      throwaway git repo under a temp dir — NEVER this repo or helio — with:
      an initial commit, a feature branch, then an unrelated commit merged
      onto the throwaway "origin/main" simulating a sibling run's merge
      while the branch was in flight.
- [x] 3.2 Before invoking the real fix, print in the test's own output
      exactly what the naive `git reset --soft origin/main` would do to this
      fixture (name the sibling commit's files that would be staged as a
      revert) — the "what would happen to a real repo" statement the ticket
      requires.
- [x] 3.3 Invoke the actual `core/scripts/squash-branch.sh` (via subprocess
      against its real repo path, not an inline reimplementation) against
      the fixture; assert the sibling commit's files are NOT staged/reverted
      and the squash commit only contains the feature branch's own changes.
- [x] 3.4 Prove the guard can fire, with falsifiable per-scenario
      assertions:
      - Temporarily mutate `core/scripts/squash-branch.sh` **in place** (not
        an inline copy) to the naive `git reset --soft <base-ref>`, under a
        `trap` that restores the real file on exit.
      - Re-run scenario 3.3's fixture: assert it now **fails** because the
        sibling commit's file(s) appear in the squash commit's
        `git show --name-only` output.
      - Restore the real file (trap fires) and re-run 3.3: assert it passes
        again (green).
- [x] 3.5 Add a second fixture scenario proving the `files-modified.md`
      guard, using a NON-default change-dir path (e.g. `spec/changes/<name>`,
      not `openspec/changes/<name>`) so the `<CHANGE_DIR>` argument is
      actually exercised rather than merely intended: an executor branch
      that stages a file outside both the `<change-dir>/**` allowlist and
      its own `files-modified.md`
      declaration (e.g. a stray edit to an unrelated source file). Assert
      the script exits non-zero before committing, and that the output
      explicitly names the unexpected file (not a silent failure). Then,
      under the same in-place-mutate-and-trap-restore pattern as 3.4, delete
      the guard block from the real script and assert this scenario now
      **fails** by exiting 0 and creating a commit.
- [x] 3.6 Add a third fixture scenario proving the "always print staged count
      + list" requirement independent of the guard: an ordinary clean squash
      with no violations; assert the count/list appear in output before the
      commit is created.
- [x] 3.7 Add a fourth fixture scenario for the unparseable-declaration path
      (design.md D2a/D2b), also using a non-default `<CHANGE_DIR>`: a
      `files-modified.md` containing only free-form
      prose with no leading-bullet backticked paths, while a staged file
      exists outside the allowlist. Assert the script fails loudly (prints
      the raw declaration content + the outstanding staged paths) without
      `--allow-empty-declaration`, and succeeds when that flag is passed.
- [x] 3.8 Add `bash test/scripts/squash-branch.test.sh` as a new conjunct to
      `package.json`'s `"test"` script (append to the existing chain; do not
      replace or reorder existing entries).

## 4. Verification

- [x] 4.1 Run the throwaway-repo test suite; capture and report the
      red-before-green transitions for tasks 3.4 and 3.5.
- [x] 4.2 Confirm no test in 3.x ever operates against
      `/home/matt/Development/concertino` or `/home/matt/Development/helio`.
- [x] 4.3 Run `npm test` (the full existing chain, now including 3.8's new
      entry) and this project's lint (per `CONTRIBUTING.md`) on the new
      script and test file.
