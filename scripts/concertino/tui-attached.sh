#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# tui-attached.sh — the single authority answering "is a Concertino TUI
# (a `concertino watch` dashboard) attached to this repo right now?"
#
# CON-126. Gates `core/roles/orchestrator.md`'s escalation raise procedure:
# with no dashboard attached, blocking `--await`/`--wait-only` calls against
# `emit-event.sh` can only ever time out against a screen nobody can reach.
#
# Exit 0 = attached. Exit 1 = not attached, or the state is ambiguous for any
# reason — ambiguity NEVER resolves toward "attached" (a false positive here
# reintroduces the dead 8-minute wait this ticket exists to remove; a false
# negative merely costs one skipped dashboard flash-up on a run a human is
# actually watching, which is the safe direction to be wrong in).
#
# Why this signal, and not a heartbeat or an env var (design.md Decision 1):
#   - A fresh per-run heartbeat file rots in the false-negative direction: a
#     dashboard blocked inside `tmux attach` (which blocks its whole event
#     loop) stops heartbeating while still legitimately alive.
#   - An env var exported by `concertino watch` is inherited by every child
#     process of its own tmux session, but a delivery run's orchestrator
#     process is not reliably a child of the dashboard in the live topology
#     (re-attaching/detaching/crash-restart severs that relationship) — an
#     inherited env var can say "attached" when the dashboard that set it is
#     long gone. Wrong in the dangerous direction.
#   - `lib/ui/watch-lock.js` already solves the adjacent problem (CON-68's
#     single-writer guard) with real PID liveness, not heartbeat freshness,
#     as the authority — exactly the "cannot go stale in the dangerous
#     direction" property this ticket needs. This script reuses it rather
#     than inventing a second liveness mechanism that could silently diverge
#     from the first.
#
# Reads:   <main checkout>/.concertino/cache/watch.lock
#          (the same pidfile lib/ui/watch-lock.js's writeLock()/acquire()
#          manage — see that file for the full write-side contract)
#
# Inherited, accepted risk (not new, not mitigated here): a dead dashboard's
# pid can be recycled by an unrelated long-lived process before this script
# runs, which would read as "attached". This is the same residual risk
# watch-lock.js's own header comment documents and accepts (CON-68's
# "smallest useful shape"); it is not remediated separately here, because
# doing so only for this consumer would let the two liveness checks
# silently diverge from each other.
#
# Assumption (non-blocking, stated per design-gate round 1): `concertino
# watch` itself resolves the lock's directory via `resolveOut(args)`
# (cwd/`--out`, lib/cli/watch.js), not via `git rev-parse --git-common-dir`
# as this script (mirroring emit-event.sh) does. These coincide for the
# ordinary invocation (`concertino watch` run at the repo root) and diverge
# only under a non-default `--out=DIR` — the same pre-existing divergence
# `concertino answer`'s own `--out` default already carries. Not remediated
# here; out of this ticket's scope.
# ===========================================================================

# Resolve the main checkout exactly as emit-event.sh's main_checkout() does:
# `git rev-parse --git-common-dir` points at the shared .git directory from a
# worktree as well as from the main checkout, but is RELATIVE on some git
# versions and absolute on others — normalise both.
main_checkout() {
  local common
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -z "$common" ] && return 1
  case "$common" in
    /*) ;;
     *) common="$(cd "$common" 2>/dev/null && pwd)" || return 1 ;;
  esac
  ( cd "$(dirname "$common")" 2>/dev/null && pwd ) || return 1
}

ROOT="$(main_checkout)" || exit 1

LOCK_FILE="${ROOT}/.concertino/cache/watch.lock"

[ -f "$LOCK_FILE" ] || exit 1

# Read `pid` from the lockfile and check its liveness in one node call,
# mirroring lib/ui/watch-lock.js's readLock()+pidAlive() exactly:
#   - a missing/unparsable file, or a `pid` field that isn't a number, is
#     "torn or absent — treated as absent" (readLock's own contract) -> exit 1
#   - process.kill(pid, 0) throwing EPERM means "exists, not ours" -> alive,
#     matching pidAlive()'s own comment verbatim. This is NOT the same as
#     bash's builtin `kill -0`, which was measured (design-gate round 1, CR4)
#     to exit non-zero on EPERM (`bash -c 'kill -0 1'` as a non-root user
#     exits 1) — diverging from pidAlive()'s definition. Using the identical
#     one-line node semantics here means this check can never disagree with
#     watch-lock.js about what "alive" means.
#   - anything else (ESRCH, or no error thrown but a bogus pid) -> not alive
#
# stderr is suppressed so a foreign-owned live pid's EPERM message never
# leaks into an agent's transcript.
node -e '
  const fs = require("fs");
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  } catch (e) {
    process.exit(1);
  }
  if (!parsed || typeof parsed.pid !== "number") process.exit(1);
  try {
    process.kill(parsed.pid, 0);
    process.exit(0);
  } catch (e) {
    process.exit(e && e.code === "EPERM" ? 0 : 1);
  }
' "$LOCK_FILE" 2>/dev/null

exit $?
