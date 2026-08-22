## 1. Render/doctor engine: recursive core/scripts/ support

- [x] 1.1 Add `listFilesRecursive(dir)` to `lib/cli/shared.js`: returns relative posix paths for
      every file under `dir`, recursing into subdirectories (no change to behavior for a flat
      directory with no subdirectories — must produce the same set/order-equivalent result as the
      current `fs.readdirSync` for existing flat `core/scripts/*.sh` files).
- [x] 1.2 In `lib/cli/emit.js`'s `copyAssets`, replace the flat `fs.readdirSync(path.join(core,
      'scripts'))` scripts loop with `listFilesRecursive`, preserving the existing
      `.sh` -> `chmodSync 0o755` behavior for nested files too. Leave the `laws` loop and
      `workflow-state.template.md` copy untouched (flat, no subdirectories today).
- [x] 1.3 In `lib/cli/doctor.js`'s `checkArtifacts`, replace the flat `fs.readdirSync(path.join(core,
      'scripts'))` loop with `listFilesRecursive` the same way, so drift detection covers nested
      files.
- [x] 1.4 In `lib/cli/resolve-core.js`'s `coresDiffer`, replace the flat `readDirSafe`-based
      enumeration for the `scripts` sub-loop only (leave `laws`/`roles` on `readDirSafe`, no
      nested dirs there today) with `listFilesRecursive`, so comparing two worktrees' `core/`
      directories — each containing `scripts/lib/` — does not throw `EISDIR` in `fileDiffers`
      (which has no try/catch, unlike `readDirSafe`).
- [x] 1.5 Verify (throwaway dir only) that a render/doctor/resolve-core pass on a `core/scripts/`
      with no subdirectories is byte-identical in output/behavior to pre-change, before
      introducing the nested `lib/` directory in task 2.1. Also verify, once task 2.1 exists, that
      a `sync`/`doctor` run performed from a second throwaway worktree whose `core/` also contains
      `scripts/lib/` does not throw (this is the scenario `coresDiffer` guards).

## 2. Port the git_child helper

- [x] 2.1 Create `core/scripts/lib/git-child-env.sh`, porting helio's
      `scripts/concertino/lib/git-child-env.sh` (`git_child` function, `compgen -v GIT_` prefix
      strip, `()` subshell) verbatim (adjust only header prose referencing helio-specific ticket
      IDs/paths where it would be misleading in the core-template context, but preserve every
      correctness-relevant line unchanged).

## 3. Wire the four call sites

- [x] 3.1 In `core/scripts/assert-phase.sh`: source `lib/git-child-env.sh`; replace every bare
      `git` invocation touching worktree/repo state with `git_child` (helio ground truth: 7
      call sites).
- [x] 3.2 In `core/scripts/cleanup.sh`: source `lib/git-child-env.sh`; replace bare `git`
      invocations with `git_child` (12 call sites); add the `CONCERTINO_CLEANUP_SKIP_SYNC`
      env-gated guard around the automatic `concertino sync` call (see section 5) — do NOT port
      helio's `if true;`-hardcoded, CON-128-referencing form verbatim.
- [x] 3.3 In `core/scripts/setup-worktree.sh`: source `lib/git-child-env.sh`; replace bare `git`
      invocations with `git_child` (8 call sites); fix the `CONCERTINO_WORKTREE_HOOKS` eval loop
      to the exact verbatim line
      `( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true`
      — including its enclosing `( ... ) || true` subshell (load-bearing: makes `exit 0` mean
      "skip this hook, continue the loop" rather than "terminate the script", and confines
      `cd`/`unset`/`eval` so none leak into the calling script) — matching helio's fixed
      sequencing, not the buggy `( cd ... && unset ... || true; eval ... ) || true` form.
- [x] 3.4 In `core/scripts/start-servers.sh`: source `lib/git-child-env.sh`; replace bare `git`
      invocations with `git_child` (1 call site). Confirm the `nohup` env-prefix fix is already
      present (verified during Setup it already landed via an earlier commit) — no further change
      needed to that line.

## 4. Port the regression selftest

- [x] 4.1 Create `core/scripts/lib/git-child-env.selftest.sh`, porting helio's
      `git-child-env.selftest.sh` structure in full: dual-arm bare-vs-git_child assertion,
      per-call-site exercise under a simulated poisoned env, static wiring check (each of the
      four scripts sources the helper and has no remaining bare git invocations), AND the
      real-file assertion against the sibling `setup-worktree.sh`'s actual hook-eval line
      (resolved relative to the selftest's own location, not hardcoded to a `core/` or rendered
      path, and not an inline copy of the pattern). Every fixture MUST live under `mktemp -d`.
- [x] 4.2 NOT wired into any `check:`-prefixed npm script or pre-commit hook enumeration (mirrors
      helio's own deliberate choice, documented in the selftest's own header) — confirm this
      choice is preserved and stated in the ported file's header comment.

## 5. cleanup.sh sync guard

- [x] 5.1 Implement the `CONCERTINO_CLEANUP_SKIP_SYNC` guard in `core/scripts/cleanup.sh` per
      `specs/cleanup-sync-guard/spec.md`: env var unset/falsy -> sync runs as today; truthy ->
      sync is skipped, rest of Phase-4 cleanup unaffected. No `if true;` hardcoding, no dead
      `elif` branch, no reference to CON-128.

## 6. Red-before-green verification (throwaway repo only)

- [x] 6.1 Task 4.1 (the real-file assertion) MUST be implemented and committed to the throwaway
      working copy BEFORE this step — reversing this order makes the "red" demonstration below
      vacuous (a selftest without the real-file assertion cannot fail on a real-file-only
      regression; this was the exact `skeptic-final-2.md` failure mode in helio's own HEL-805
      history). State explicitly, before running anything, what each experiment below would do to
      a real repo if the fix were absent (per the ticket's verification standard) — never run any
      of this against `/home/matt/Development/concertino` or `/home/matt/Development/helio`.
- [x] 6.2 In a `mktemp -d` throwaway copy of the finished `core/scripts/` (selftest included and
      unmodified from 4.1), revert ONLY `core/scripts/setup-worktree.sh`'s real hook-eval line to
      the buggy
      `( cd "$WORKTREE_PATH" && unset -v $(compgen -v GIT_ 2>/dev/null) || true; eval "$hook" >/dev/null 2>&1 ) || true`
      form (enclosing subshell preserved; only the internal `cd`/`unset`/`eval` punctuation
      reverted). Run the selftest and confirm it exits non-zero, naming the sequencing regression
      (red).
- [x] 6.3 Restore the fixed line in that same throwaway copy and re-run the selftest, confirming
      "ALL PASS" (green).
- [x] 6.4 Run the selftest in-place inside `core/scripts/lib/` against the real, finished template
      files (not the throwaway copy) to confirm "ALL PASS" — this exercises only bash/mktemp
      fixtures, not a live-repo git operation.

## 7. Render + diff verification (acceptance test)

- [x] 7.1 Render `core/` with a config equivalent to helio's `concertino.config.json` into a
      `mktemp -d` throwaway directory via the project's render command (`--out=<tmpdir>` — never
      sync against a real repo). Confirm the render succeeds (task 1's engine change is what makes
      this not throw `EISDIR`) and produces `scripts/concertino/lib/git-child-env.sh` and
      `scripts/concertino/lib/git-child-env.selftest.sh`, both executable.
- [x] 7.2 Diff the rendered `scripts/concertino/` tree against helio's current
      `/home/matt/Development/helio/scripts/concertino/` tree.
- [x] 7.3 Confirm zero loss of: the `GIT_*` strip at every HEL-805 call site, the
      `git-child-env.sh` helper + selftest, the `nohup` env-prefix fix, and cleanup.sh's ability
      to skip automatic sync (via the new env-gated form, not a byte-identical diff against
      helio's hardcoded local hack — that specific divergence is expected and is exactly what
      Decision 5 chose). Differences unrelated to the four ticket fixes (e.g. incidental
      helio-local additions like pricing-table.json wiring) are expected and not a failure.
- [x] 7.4 Run `concertino doctor` (or the equivalent throwaway-dir invocation) against the
      throwaway rendered directory and confirm it reports the nested files as in sync (task 1.3).

## 8. Housekeeping

- [x] 8.1 Confirm no bare `git` invocations remain in any of the four touched
      `core/scripts/*.sh` files (the selftest's own static-wiring check from 4.1 covers this;
      re-confirm manually as a final pass).
- [x] 8.2 Confirm CON-128/CON-131/CON-132 scope is untouched (no version-stamping, no
      cleanup.sh exit-code fix, no commit-gate-chain change).
- [x] 8.3 Run the project's own existing test suite (`npm test` or equivalent) to confirm the
      `listFilesRecursive` engine change has not regressed any existing render/doctor test —
      `test/scripts/doctor-artifacts.test.sh` in particular exercises the `checkArtifacts` path
      this change edits directly.
- [x] 8.4 Write `openspec/changes/upstream-git-child-env-fixes/files-modified.md` listing every
      file touched, for the orchestrator's Delivery-phase handoff cleanup.
