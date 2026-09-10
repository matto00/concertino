#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# assert-cwd.sh — cross-worktree spawn-collision guard (CON-174).
#
# A spawned role inherits the spawning session's ambient cwd, not its own
# post-cd cwd (a `cd` in one Bash call does not persist to the next). This
# script does NOT check "ambient == WORKTREE_PATH" — a correctly-spawned
# role's ambient cwd is normally an ANCESTOR of WORKTREE_PATH (the driver's
# own root), never WORKTREE_PATH itself or a descendant of it. Instead it
# detects the actual incident signature: ambient resolves inside a
# DIFFERENT ticket's worktree under the same worktree-base directory.
#
# Usage: assert-cwd.sh <AMBIENT_PWD> <WORKTREE_PATH> <BRANCH>
#
# On success prints:
#   READY ambient=<AMB> branch=<BRANCH>
# On failure prints "FAIL <reason>: ..." and exits non-zero.
# ===========================================================================

AMBIENT_PWD="${1:?usage: assert-cwd.sh <AMBIENT_PWD> <WORKTREE_PATH> <BRANCH>}"
WORKTREE_PATH="${2:?usage: assert-cwd.sh <AMBIENT_PWD> <WORKTREE_PATH> <BRANCH>}"
BRANCH="${3:?usage: assert-cwd.sh <AMBIENT_PWD> <WORKTREE_PATH> <BRANCH>}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/git-child-env.sh"

# 1. WORKTREE_PATH must exist.
if [ ! -d "$WORKTREE_PATH" ]; then
  echo "FAIL worktree-missing: ${WORKTREE_PATH}"
  exit 1
fi
WT="$(realpath "$WORKTREE_PATH")"

# 2. Resolve ambient. AMBIENT_PWD is expected to be a freshly-captured
#    `pwd -P` output, so this should always succeed.
if ! AMB="$(realpath "$AMBIENT_PWD" 2>/dev/null)"; then
  echo "FAIL ambient-path-invalid: ${AMBIENT_PWD}"
  exit 1
fi

# 3. Compute BASE exactly from BRANCH, per setup-worktree.sh's own
#    construction: WORKTREE_PATH = "${REPO_ROOT}/${WORKTREE_BASE}/${BRANCH}".
#    Stripping the trailing "/${BRANCH}" recovers "${REPO_ROOT}/${WORKTREE_BASE}"
#    exactly, regardless of how many path segments BRANCH itself contains.
case "$WORKTREE_PATH" in
  */"$BRANCH")
    BASE="${WORKTREE_PATH%/"$BRANCH"}"
    BASE="$(realpath "$BASE" 2>/dev/null || true)"
    ;;
  *)
    # Should not happen given the construction above, but defensive: no
    # collision check possible, never a false BLOCKER.
    BASE=""
    ;;
esac

# 4. Collision check: ambient resolves somewhere under BASE (i.e. inside the
#    worktrees tree at all) AND does not resolve under-or-equal to WT ->
#    ambient is inside a DIFFERENT ticket's worktree. FAIL.
#    AMB == WT (steady state) and AMB == BASE (base dir itself) are both
#    tolerated. AMB not under BASE at all (the ordinary/normal-spawn case,
#    ambient is an ancestor of BASE) is tolerated.
if [ -n "$BASE" ]; then
  case "$AMB" in
    "$BASE")
      : # tolerated — base dir itself, not inside any other ticket's worktree
      ;;
    "$BASE"/*)
      case "$AMB" in
        "$WT"|"$WT"/*)
          : # tolerated — under-or-equal to our own WORKTREE_PATH
          ;;
        *)
          echo "FAIL cwd-mismatch: ambient=${AMB} is inside a different worktree under ${BASE} (expected under ${WT})"
          exit 1
          ;;
      esac
      ;;
    *)
      : # tolerated — ambient not under BASE at all (normal spawn: driver's own root)
      ;;
  esac
fi

# 5. Branch check: WORKTREE_PATH itself must be checked out to BRANCH,
#    independent of where ambient is.
if ! FOUND_BRANCH="$(cd "$WT" && git_child rev-parse --abbrev-ref HEAD 2>/dev/null)"; then
  echo "FAIL not-a-git-worktree: ${WT}"
  exit 1
fi
if [ "$FOUND_BRANCH" != "$BRANCH" ]; then
  echo "FAIL branch-mismatch: found=${FOUND_BRANCH} expected=${BRANCH}"
  exit 1
fi

echo "READY ambient=${AMB} branch=${BRANCH}"
exit 0
