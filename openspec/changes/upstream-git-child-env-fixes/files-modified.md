## Files modified

- `core/scripts/lib/git-child-env.sh` — new: `git_child` helper, GIT_*-prefix strip via `compgen -v GIT_`, `()` subshell (ported from helio's `scripts/concertino/lib/git-child-env.sh`).
- `core/scripts/lib/git-child-env.selftest.sh` — new: regression selftest (dual-arm bare-vs-git_child assertion, per-call-site exercise under a simulated poisoned env, static wiring check, and the real-file assertion against `setup-worktree.sh`'s actual hook-eval line).
- `core/scripts/assert-phase.sh` — sources `lib/git-child-env.sh`; 7 call sites now use `git_child`.
- `core/scripts/cleanup.sh` — sources `lib/git-child-env.sh`; 12 call sites now use `git_child`; added the `CONCERTINO_CLEANUP_SKIP_SYNC` env-gated guard around the automatic `concertino sync` call (replacing helio's checkout-local `if true;`/CON-128 hardcoded-disable form, per design.md Decision 5).
- `core/scripts/setup-worktree.sh` — sources `lib/git-child-env.sh`; 8 call sites now use `git_child`; fixed the `CONCERTINO_WORKTREE_HOOKS` eval loop to the verbatim `( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true` sequencing.
- `core/scripts/start-servers.sh` — sources `lib/git-child-env.sh`; 1 call site now uses `git_child`. (`nohup` env-prefix fix already present pre-change — verified, not further modified.)
- `lib/cli/shared.js` — added `listFilesRecursive(dir)`, a recursive relative-posix-path file lister, matching flat `fs.readdirSync` behavior for directories with no subdirectories.
- `lib/cli/emit.js` — `copyAssets`'s `core/scripts/` loop now uses `listFilesRecursive` instead of a flat `fs.readdirSync`, so nested `core/scripts/lib/` renders and gets `chmod 0o755` on `.sh` files.
- `lib/cli/doctor.js` — `checkArtifacts`'s `core/scripts/` loop now uses `listFilesRecursive`, so drift detection covers nested files.
- `lib/cli/resolve-core.js` — `coresDiffer`'s `scripts` sub-loop now uses `listFilesRecursive` instead of `readDirSafe` (avoids `EISDIR` in `fileDiffers` when comparing two `core/` trees that both contain `scripts/lib/`); `laws`/`roles` sub-loops unchanged (flat, no nested dirs).
- `test/scripts/harness-identity.test.sh` — `new_scripts()` fixture now also stages `lib/git-child-env.sh` alongside its copy of `setup-worktree.sh` (which now sources it); pre-existing test infra gap surfaced by wiring `git_child` into the real template.
- `test/scripts/cleanup.test.sh` — `new_pair()` fixture now also stages `lib/git-child-env.sh` alongside its copy of `cleanup.sh`, for the same reason.
- `openspec/changes/upstream-git-child-env-fixes/tasks.md` — all 25 tasks marked complete.
