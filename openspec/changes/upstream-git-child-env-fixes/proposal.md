## Why

`concertino sync` is a faithful whole-file regeneration from `core/`. HEL-805 hardened four
rendered concertino scripts in helio against a git `GIT_DIR` leak that re-initialised a real repo
as bare (the incident that went unnoticed for ~70 minutes). That fix lives only in helio's
rendered files, never in `core/` templates — so the next `concertino sync` anywhere silently
deletes it and restores the incident conditions. This change ports the fix into `core/` so every
render reproduces it.

## What Changes

- Add `core/scripts/lib/git-child-env.sh`: a `git_child` helper that strips every `GIT_*`-prefixed
  environment variable (via `compgen -v GIT_`, not an enumerated denylist) before exec'ing a child
  `git` invocation, in a `()` subshell so the strip never leaks into the caller's own environment.
- Wire `git_child` into the four call sites `core/scripts/assert-phase.sh`,
  `core/scripts/cleanup.sh`, `core/scripts/setup-worktree.sh`, `core/scripts/start-servers.sh` —
  replacing their bare `git` invocations that touch worktree/repo state.
- Fix `core/scripts/setup-worktree.sh`'s `CONCERTINO_WORKTREE_HOOKS` eval loop to helio's exact
  verbatim line
  `( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true`
  — the enclosing `( ... ) || true` subshell is load-bearing (confines `cd`/strip/`eval` to one
  hook, and makes `exit 0` mean "skip this hook" rather than "terminate the script") — never the
  buggy `( cd ... && unset ... || true; eval ... ) || true` form, which lets `eval` run in the
  caller's still-poisoned cwd when `cd` fails.
- Add a `CONCERTINO_CLEANUP_SKIP_SYNC` env-gated guard to `core/scripts/cleanup.sh` that skips its
  automatic `concertino sync` call when set — the capability behind helio's local, checkout-only
  disable hack, ported as a real, non-project-specific, non-permanently-on guard rather than
  verbatim (helio's actual guard is an `if true;` hardcoded to always-disabled, justified by a
  refuted ticket, CON-128 — porting it verbatim would permanently disable sync everywhere on a
  false premise). CON-131's separate defect (cleanup.sh exiting 0 having done nothing when git ops
  fail) is explicitly out of scope for this change.
- Add a `listFilesRecursive` helper to `lib/cli/shared.js`, and use it in `lib/cli/emit.js`'s
  `copyAssets`, `lib/cli/doctor.js`'s `checkArtifacts`, and `lib/cli/resolve-core.js`'s
  `coresDiffer` (its `scripts` sub-loop only) in place of their current flat enumeration of
  `core/scripts/` — required because `core/scripts/lib/` (the new helper's directory) is not
  enumerable by any of the three current flat-enumeration sites (`fs.copyFileSync`/read-based
  compare/`fileDiffers` all throw `EISDIR` on a directory entry, confirmed by reproduction; the
  third site, `coresDiffer`, is reached whenever two worktrees' `core/` directories are compared,
  e.g. this repo's own sibling-worktree dev topology). This is the minimum engine change that
  makes the four items above renderable at all; behavior for existing flat `core/scripts/*.sh`
  files is unchanged.
- Add `core/scripts/lib/git-child-env.selftest.sh`, a regression test that (a) proves the
  simulated poisoned-env attack is real (a bare `git` call IS misdirected), (b) proves
  `git_child` is NOT misdirected, (c) exercises each of the four scripts' actual `git_child`
  call sites under a poisoned env, and (d) asserts directly against the real shipped
  `setup-worktree.sh` line (not an inline copy of the pattern) so a regression in the real file
  is caught even if the selftest itself is untouched.
- Verify (already landed per an earlier commit, confirmed in Setup) that the `nohup` env-prefix
  fix in `core/scripts/start-servers.sh` is intact; no further change needed there beyond
  wiring its `git_child` call site.

## Capabilities

### New Capabilities

- `git-child-env-hardening`: hermetic environment for child `git` invocations in concertino's
  scripts, guarding against the git-exported `GIT_*` env leak from a linked worktree's hook
  subprocess re-targeting a different real repository. Covers the `git_child` helper, its four
  call sites, the `cd`/`eval` precedence fix, and its regression selftest.

- `cleanup-sync-guard`: the `CONCERTINO_CLEANUP_SKIP_SYNC` env-gated guard controlling whether
  `cleanup.sh`'s Phase-4 flow triggers an automatic `concertino sync`. Separate capability from
  `git-child-env-hardening` since it is not about the GIT_* leak.

### Modified Capabilities

(none — no existing spec's requirements change; the render/doctor engine change (`listFilesRecursive`)
is an internal implementation detail enabling the two new capabilities above, not a change to any
existing capability's documented requirements)

## Impact

- `core/scripts/lib/git-child-env.sh` (new)
- `core/scripts/lib/git-child-env.selftest.sh` (new)
- `core/scripts/assert-phase.sh`, `core/scripts/cleanup.sh`, `core/scripts/setup-worktree.sh`,
  `core/scripts/start-servers.sh` (wire `git_child` + precedence fix; `cleanup.sh` also gets the
  `CONCERTINO_CLEANUP_SKIP_SYNC` guard)
- `lib/cli/shared.js` (new `listFilesRecursive` helper), `lib/cli/emit.js` (`copyAssets` scripts
  loop), `lib/cli/doctor.js` (`checkArtifacts` scripts loop), `lib/cli/resolve-core.js`
  (`coresDiffer` scripts sub-loop) — additive engine change enabling a nested `core/scripts/lib/`
  layout to render/drift-check/compare correctly
- Every project that runs `concertino sync` going forward (this is the safety-critical path the
  ticket exists to close)
