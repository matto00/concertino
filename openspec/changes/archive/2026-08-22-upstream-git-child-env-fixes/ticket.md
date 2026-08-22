# CON-133: Upstream helio's local fixes to rendered concertino scripts into core/ templates

## Description

`concertino sync` is a faithful whole-file regeneration from `core/`. Any fix applied to a
**rendered** file rather than to its template is therefore deleted on the next sync — silently,
and correctly, because sync is doing exactly what it is designed to do.

Several fixes in the helio checkout live only in rendered files. Verified 2026-08-22 by rendering
from the dev `core/` with helio's config into a throwaway directory and diffing against helio's
current files (helio `main` at `cf6f9c64`):

| File | current | fresh render | what a sync would delete |
| -- | -- | -- | -- |
| `scripts/concertino/setup-worktree.sh` | 391 | 383 | HEL-805's `compgen -v GIT_` env strip (1 occurrence -> 0) |
| `scripts/concertino/lib/git-child-env.sh` | present | not rendered at all | the entire HEL-805 helper library |
| `scripts/concertino/cleanup.sh` | 305 | 282 | the local guard disabling automatic `concertino sync` (3 refs -> 0) |
| `scripts/concertino/start-servers.sh` | 104 | 102 | 4 lines, consistent with the `nohup` env-prefix fix (NOTE: this one has
  already landed in concertino's own `core/` per an earlier commit `1e3c293`, confirmed during Setup) |

This is the mechanism behind the long-running "sync clobbers local script fixes" annoyance.

## Why this is Urgent

HEL-805 (merged into helio as `cf6f9c64`) hardened four concertino scripts against the git
`GIT_DIR` leak that re-initialised the helio repository as bare on 2026-08-21 — a corruption that
went unnoticed for ~70 minutes and cost hours of forensics. The entire fix lives in rendered
files. One `concertino sync` reverts all of it, restoring the exact conditions of that incident.

## Mechanism

Git exports an absolute `GIT_DIR` to hook subprocesses. From a linked worktree that value is
`<repo>/.git/worktrees/<name>`, whose basename is not `.git`, so git's `guess_repository_type()`
treats it as bare. A child `git init` inheriting it re-initialises the real repo as bare.
`core.bare` is a COMMON (non-worktree-scoped) key, so every linked worktree keeps working while
the main checkout is dead. The fix is a PREFIX strip (`compgen -v GIT_`), NOT an enumerated
denylist — a denylist already failed once, missing GIT_AUTHOR_DATE/GIT_COMMITTER_DATE/
GIT_CONFIG_PARAMETERS.

Also required: the `cd`/`eval` precedence fix in setup-worktree.sh's hook loop must be

```
( cd "$WORKTREE_PATH" || exit 0; unset -v $(compgen -v GIT_ 2>/dev/null) 2>/dev/null; eval "$hook" >/dev/null 2>&1 ) || true
```

NOT `( cd ... && unset ... || true; eval ... ) || true` — with `&&`/`;` precedence a failed `cd`
still falls through to `eval` in the caller's poisoned cwd, reproducing the detonation shape
inside the fix itself. The enclosing `( ... ) || true` subshell is itself load-bearing (confines
`cd`/`unset`/`eval` to one hook, and makes `exit 0` mean "skip this hook" rather than "terminate
the whole script").

## What to do

- Port HEL-805's `lib/git-child-env.sh` helper (`git_child` function, GIT_*-prefix strip) into
  `core/scripts/lib/git-child-env.sh`, and wire its four call sites (`assert-phase.sh`,
  `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`) into the `core/` templates so a render
  reproduces them.
- Port the `nohup` env-prefix fix in `start-servers.sh` (confirm already present in core; verify
  during planning).
- Decide and port the correct upstream form of the `cleanup.sh` automatic-sync guard. NOTE:
  CON-131 (cleanup.sh exits 0 having done nothing when git ops fail) is explicitly OUT OF SCOPE —
  port the guard behavior as it exists today; do not fix CON-131's separate defect here.
- Port HEL-805's `git-child-env.selftest.sh` regression test so templates ship with the test, not
  just the fix. The test must assert against the ACTUAL file being tested (not an inline copy of
  the pattern) — helio's skeptic caught exactly this failure mode.
- Re-render into a throwaway directory (never into a real repo) and diff against helio's
  `scripts/concertino/` to confirm zero regression of the fixes above.

## Acceptance Criteria

- [ ] A fresh `concertino sync` render (into a throwaway dir with helio's config) contains the
      `GIT_*` env strip at every call site HEL-805 hardened.
- [ ] A fresh render includes the `git-child-env.sh` helper and its selftest.
- [ ] A fresh render includes the `nohup` env-prefix fix in `start-servers.sh`.
- [ ] Rendering into a throwaway dir and diffing against helio's `scripts/concertino/` shows no
      loss of any fix listed in the table above.
- [ ] The regression test is demonstrated to go RED when the strip is removed from a template
      (red-before-green, in a throwaway repo — never against a live checkout).
- [ ] No changes to CON-128 (refuted, do not build version-stamping), CON-131 (cleanup.sh exit
      code on git-op failure), or CON-132 (commit-gate-chain) scope.

## Out of scope

- CON-128, CON-131, CON-132 — explicitly not touched by this ticket.
- CON-129 (delivery squash mass revert) — not touched; but per orchestrator instruction, origin/main
  must be merged into this branch before the evaluation gates run.
