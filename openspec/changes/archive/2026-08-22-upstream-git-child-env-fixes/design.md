## Context

Helio's checkout (`/home/matt/Development/helio`) diverged from concertino's `core/` templates:
four scripts were hardened locally against a `GIT_DIR` leak (HEL-805, merged as `cf6f9c64`), and
those fixes were never ported back into `core/`. `concertino sync` regenerates rendered files
whole-file from `core/`, so any project running `sync` today silently loses the hardening. This
change ports the fix into `core/` so it survives every future render.

Concertino self-hosts: `core/scripts/*.sh` are the templates; `scripts/concertino/*.sh` in any
consuming project (including this repo's own dev checkout) are the rendered output of
`concertino sync`. This ticket is delivered against `core/` — the rendered copies in this repo
follow only via an explicit, throwaway-directory verification render, never a real `sync` against
a live checkout.

## Goals / Non-Goals

**Goals:**
- Port `lib/git-child-env.sh` (the `git_child` prefix-strip helper) into `core/scripts/lib/`.
- Wire `git_child` into the four call sites: `assert-phase.sh`, `cleanup.sh`,
  `setup-worktree.sh`, `start-servers.sh`.
- Fix `setup-worktree.sh`'s hook-eval `cd`/`unset`/`eval` sequencing so a failed `cd` never falls
  through to `eval`.
- Port the `cleanup.sh` automatic-sync guard into `core/` unmodified in behavior.
- Port `git-child-env.selftest.sh`, asserting against the real shipped file content (not an
  inline copy), so a future regression in `core/scripts/setup-worktree.sh` is caught.
- Verify via a throwaway-dir render + diff against helio's `scripts/concertino/` that no fix is
  lost.

**Non-Goals:**
- CON-131 (cleanup.sh exits 0 having done nothing when its git ops fail) — not fixed here.
- CON-128 (refuted; no version-stamping work).
- CON-132 (commit-gate-chain changes) — untouched.
- No new denylist of GIT_* variable names anywhere — the prefix-strip approach is the only
  approach used.
- No behavioral change to the sync/doctor CLI surface (flags, output format, exit codes) — the one
  engine change this design makes (Decision 6) is additive support for a nested-directory layout
  under `core/scripts/`, not a redesign of the render/doctor commands.

## Decisions

1. **Prefix strip, not enumerated denylist.** `unset -v $(compgen -v GIT_)` matches every
   `GIT_*`-prefixed variable a shell process currently has set, so it catches
   `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`/`GIT_CONFIG_PARAMETERS` and anything not yet known to
   be leaked, unlike an enumerated denylist which already failed once in this exact codebase.
   Alternative considered and rejected: an enumerated six-name denylist (the original, already-
   failed fix).

2. **`()` subshell, not `{}` group.** `git_child` runs its body in a `()` subshell so `unset`
   never leaks into the caller's own environment — only the one child `git` invocation loses its
   `GIT_*` variables. A `{}` group would run in the current shell and permanently strip `GIT_*`
   from the calling script for the remainder of its execution, which is unwanted where a script
   legitimately needs `GIT_*` for its own top-level git operations outside `git_child`.

3. **Fixed hook-eval line, verbatim including its enclosing subshell.** helio's real, shipped
   line (`scripts/concertino/setup-worktree.sh:357`) is the exact form to port:
   `( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true`
   The enclosing `( ... ) || true` subshell is load-bearing, not incidental: `exit 0` inside it
   ends only that subshell (skipping this one hook and continuing the loop), not the whole
   script; the `cd` and `unset` are confined to the subshell so neither leaks into the calling
   script's own cwd/environment for the remainder of `setup-worktree.sh`; and the trailing
   `|| true` absorbs the subshell's own exit status so one hook's failure never aborts the loop.
   Inside the subshell, `cd "$WORKTREE_PATH" || exit 0` must short-circuit unconditionally on
   failure, with the `GIT_*` strip and `eval` reachable only after a successful `cd` — this is
   what distinguishes it from the original buggy form
   (`cd ... && unset ... || true; eval ...`, written *without* the enclosing subshell), where
   `&&`/`;` precedence let a failed `cd` still reach `eval`: `|| true` absorbed the `&&` chain's
   failure and the trailing `; eval ...` ran unconditionally regardless, in the caller's own
   (still-poisoned) cwd. Alternative considered and rejected: dropping the enclosing subshell for
   "simplicity" — rejected because it changes `exit 0`'s meaning from "skip this hook" to
   "terminate the whole script", and leaks `cd`/`unset` into the caller.

4. **Selftest asserts against the real file, not an inline copy.** The selftest's static-wiring
   check (`grep` on the actual `core/scripts/*.sh` template content, not a string literal
   embedded in the selftest) is required so that a regression in the real template — even one
   that never touches the selftest file itself — is caught. This was an explicit failure mode
   surfaced by helio's own skeptic during HEL-805 (a selftest that passed even after the real fix
   was reverted).

5. **`cleanup.sh` sync guard: port the intent, not the checkout-local hack, gated by config not
   left permanently on.** Helio's actual guard is `if true; then echo "...DISABLED in this
   checkout (CON-128 ...)"; elif other_runs_live; then ...; else <run sync>; fi` — a self-described
   temporary, checkout-local override (`if true;` unconditionally takes the disabled branch; the
   `elif` is dead code) with a comment "Remove this guard (and this comment) once the binary
   resolution is fixed." CON-128 (the ticket that hack cites) was refuted 2026-08-22: there is no
   "binary resolution" bug to fix, so that stated unblock condition can never occur, and porting
   the hack verbatim into `core/` would permanently disable automatic sync for every consuming
   project on a false premise. Decision: port the underlying *capability* — cleanup.sh must be
   able to skip its own automatic `concertino sync` call — as an explicit, named guard read from
   an environment variable, `CONCERTINO_CLEANUP_SKIP_SYNC` (default unset/false, i.e. sync runs
   normally), rather than a hardcoded `if true`. This preserves the emergency-disable capability
   (a project sets the env var, exactly as helio does today via its own wrapper) without shipping
   a permanently-dead branch or a false CON-128 dependency to every project. This requirement
   belongs to its own capability, `cleanup-sync-guard`, not `git-child-env-hardening` — the sync
   guard is about controlling when `concertino sync` fires, unrelated to the GIT_* leak; grouping
   it under git-child-env hardening would misrepresent what the requirement covers. CON-131 (exit
   0 on git-op failure elsewhere in cleanup.sh) remains untouched — orthogonal to this guard.
6. **Render/doctor/resolve-core engine: recursive enumeration for `core/scripts/`, additive
   only.** `lib/cli/emit.js`'s `copyAssets`, `lib/cli/doctor.js`'s `checkArtifacts`, AND
   `lib/cli/resolve-core.js`'s `coresDiffer` all enumerate `core/scripts/` with a flat
   `fs.readdirSync` and a per-entry `fs.copyFileSync`/byte-compare (`coresDiffer`'s `fileDiffers`
   has no try/catch around its `fs.readFileSync(a).equals(...)`, unlike its own sibling
   `readDirSafe`) — confirmed by direct reproduction that a directory entry (e.g. adding
   `core/scripts/lib/`) throws `EISDIR` in all three. `coresDiffer` is reached whenever
   `resolveCore` compares two different worktrees' `core/` directories (e.g. this repo's own
   dev topology, where sibling worktrees each have their own `core/`), so it would surface as a
   crash on any `sync`/`doctor` run from a sibling worktree once both cores contain
   `scripts/lib/` — i.e. after this change has landed and propagated, not necessarily caught by
   this ticket's own single-core render test alone.
   `git-child-env.sh` and `git-child-env.selftest.sh` are added under `core/scripts/lib/`
   (matching helio's actual, already-proven-working checkout-local layout, so no further
   flattening/renaming of the helper is needed and the four call sites' `source
   "${SCRIPT_DIR}/lib/git-child-env.sh"` line matches helio verbatim). To support this, add a
   small recursive file-listing helper to `lib/cli/shared.js` (e.g. `listFilesRecursive(dir)` ->
   relative posix paths) and use it in `copyAssets`'s scripts loop, `checkArtifacts`'s scripts
   loop, AND `coresDiffer`'s `scripts` sub-loop (in place of `readDirSafe` for that one
   subdirectory only -- `laws`/`roles` stay on `readDirSafe` since they have no nested dirs
   today), preserving `.sh` -> `chmod 0o755` for nested files and preserving
   `laws`/`workflow-state.template.md` handling unchanged (still flat -- no nested dirs exist
   there today, no need to touch them). Verification must include a sync/doctor run from a
   sibling worktree whose `core/` also contains `scripts/lib/`, confirming no `EISDIR`. Alternative considered and rejected:
   flattening the helper into `core/scripts/git-child-env.sh` (no `lib/` subdir) to avoid any
   engine change — rejected because it would produce a rendered layout that diverges from helio's
   already-shipped, git-tracked `scripts/concertino/lib/git-child-env.sh` path, breaking the
   ticket's own diff-against-helio acceptance test and forcing an unrelated path migration in
   helio's tracked files as a side effect of this ticket.

## Risks / Trade-offs

- [Risk] Porting into `core/` templates could introduce template-engine syntax (e.g.
  `{{placeholder}}`) mismatches if `core/scripts/*.sh` files use any project-specific
  substitution. → Mitigation: the four files this change touches
  (`assert-phase.sh`/`cleanup.sh`/`setup-worktree.sh`/`start-servers.sh`) were confirmed during
  Setup to be verbatim (non-templated) shell scripts identical in structure to their rendered
  counterparts (e.g. `core/scripts/start-servers.sh`'s `nohup` line already matches the rendered
  file verbatim) — no templating syntax to preserve in any of them. (Note: `core/scripts/` as a
  whole is not universally template-free — `check-agent-merge-permission.sh` does contain
  `{{` placeholders — but that file is untouched by this change.)
- [Risk] A throwaway-dir render might not exercise the exact same code path `concertino sync`
  uses against a live project (e.g. different config). → Mitigation: render using helio's own
  `concertino.config.json` (or an equivalent config) into a `mktemp -d` throwaway directory, per
  the ticket's stated acceptance test, and diff directly against helio's current
  `scripts/concertino/`.
- [Risk] Accidentally running `concertino sync` or any live-repo git operation against a real
  checkout while testing. → Mitigation: every experiment step states explicitly what it would do
  to a real repo if run there, and only ever runs against `mktemp -d` throwaway paths.
- [Risk] The `listFilesRecursive` engine change (Decision 6) regresses `copyAssets`/
  `checkArtifacts` for every existing flat file in `core/scripts/`, not just the new nested ones.
  → Mitigation: the helper must produce identical output to the current flat `readdirSync` for a
  directory with no subdirectories (verified by running the full existing test suite plus a
  throwaway-dir render/doctor pass before and after, diffing output).
- [Risk] `CONCERTINO_CLEANUP_SKIP_SYNC` (Decision 5) is a behavior change to `cleanup.sh` beyond a
  pure port — a reviewer could read this as scope creep toward CON-131. → Mitigation: this env var
  only gates whether the automatic sync call fires; it does not touch CON-131's separate exit-code
  defect on git-op failure, and the design explicitly states this boundary.

## Migration Plan

No runtime migration — this changes `core/` template content only. Existing rendered files in any
project (including this repo's own `scripts/concertino/`) are unaffected until that project's
maintainers explicitly choose to run `concertino sync` again; this change does not itself trigger
a sync anywhere. No rollback beyond a normal git revert of the `core/` changes.

## Open Questions

None — the fix shape (prefix strip, subshell, cd/eval precedence, non-self-referential selftest)
was already validated end-to-end in helio via HEL-805's design/final skeptic gates; this change
ports that validated shape rather than re-deriving it.
