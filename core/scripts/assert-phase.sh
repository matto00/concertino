#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# assert-phase.sh — postcondition gate for each orchestrator phase.
#
# The autonomous equivalent of a human glancing and confirming "yep, that
# worked." The orchestrator runs this before leaving a phase; a non-zero exit
# means the phase did NOT actually complete and it must not advance.
#
# Usage:
#   assert-phase.sh setup    <WORKTREE_PATH>
#   assert-phase.sh servers  <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#   assert-phase.sh delivery <WORKTREE_PATH> <BRANCH>
#   assert-phase.sh cleanup  <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#
# Prints "PASS <phase>" on success, "FAIL <reason>" (one per line) + non-zero
# exit on failure.
# ===========================================================================

PHASE="${1:?usage: assert-phase.sh <phase> <worktree> [args]}"
WORKTREE_PATH="${2:?missing WORKTREE_PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"

fail() {
  local msg="$*"
  echo "FAIL $msg" >&2
  FAILED=1
  # Record only the first failure message, trimmed at the source so an
  # oversized reason can't blow emit-event.sh's whole-line byte cap and drop
  # every other field on the gate.result line. fail() is always called as the
  # RHS of a `check || fail ...`, so under `set -e` its own return status must
  # stay 0 on every branch — otherwise a second-or-later call (where the `&&`
  # short-circuits because FIRST_ERROR is already set) would be the last
  # command in that AND-OR list and would kill the script right there.
  if [ -z "$FIRST_ERROR" ]; then
    FIRST_ERROR="${msg:0:200}"
  fi
  return 0
}
FAILED=0
FIRST_ERROR=""

# Resolve a health URL template ($DEV_PORT / $BACKEND_PORT in scope).
resolve_url() { eval "echo \"$1\""; }

START_TS="$(date +%s)"

case "$PHASE" in
  setup)
    [ -d "$WORKTREE_PATH" ]                 || fail "worktree dir missing: $WORKTREE_PATH"
    [ -d "$WORKTREE_PATH/.git" ] || [ -f "$WORKTREE_PATH/.git" ] \
                                            || fail "worktree not a git work tree: $WORKTREE_PATH"
    for f in ${CONCERTINO_ENV_FILES:-}; do
      [ -f "$WORKTREE_PATH/$f" ] || fail "env file not present in worktree: $f (servers will fail)"
    done
    ;;

  servers)
    DEV_PORT="${3:?servers assert needs <DEV_PORT> <BACKEND_PORT>}"
    BACKEND_PORT="${4:?servers assert needs <DEV_PORT> <BACKEND_PORT>}"
    if [ -n "${CONCERTINO_BACKEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_BACKEND_HEALTH")" >/dev/null 2>&1 \
          || fail "backend not healthy on ${BACKEND_PORT}"
    fi
    if [ -n "${CONCERTINO_FRONTEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_FRONTEND_HEALTH")" >/dev/null 2>&1 \
          || fail "frontend not serving on ${DEV_PORT}"
    fi
    ;;

  delivery)
    BRANCH="${3:?delivery assert needs <BRANCH>}"
    git -C "$WORKTREE_PATH" rev-parse --verify --quiet "refs/remotes/origin/${BRANCH}" >/dev/null \
        || fail "branch ${BRANCH} not pushed to origin"
    [ -z "$(git -C "$WORKTREE_PATH" status --porcelain)" ] \
        || fail "worktree has uncommitted changes"
    ;;

  cleanup)
    DEV_PORT="${3:-}"
    BACKEND_PORT="${4:-}"
    if [ -n "$DEV_PORT" ] && [ -n "${CONCERTINO_FRONTEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_FRONTEND_HEALTH")" >/dev/null 2>&1 \
          && fail "frontend still serving on ${DEV_PORT}" || true
    fi
    if [ -n "$BACKEND_PORT" ] && [ -n "${CONCERTINO_BACKEND_HEALTH:-}" ]; then
      curl -sf "$(resolve_url "$CONCERTINO_BACKEND_HEALTH")" >/dev/null 2>&1 \
          && fail "backend still healthy on ${BACKEND_PORT}" || true
    fi
    [ ! -d "$WORKTREE_PATH" ] || fail "worktree dir still present: $WORKTREE_PATH"
    ;;

  *)
    echo "FAIL unknown phase '$PHASE' (expected: setup|servers|delivery|cleanup)" >&2
    exit 2
    ;;
esac

# The ticket id is not an argument here, so derive it from the worktree path —
# worktrees are created at <base>/<branch> and branches end in /<TICKET-ID>.
# A branch that doesn't follow that convention (`chore/cleanup-old-logs`) would
# otherwise write this run's events into a different ticket's log, silently
# splitting one run's history in two. Emitting nothing is the safe failure.
GATE_TICKET="${WORKTREE_PATH##*/}"
looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }

DURATION_MS=$(( ($(date +%s) - START_TS) * 1000 ))

if [ "$FAILED" -ne 0 ]; then
  looks_like_ticket "$GATE_TICKET" && CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.result \
    "ticket=${GATE_TICKET}" "gate=phase:${PHASE}" "status=fail" "duration_ms=${DURATION_MS}" "first_error=${FIRST_ERROR}" || true
  exit 1
fi

looks_like_ticket "$GATE_TICKET" && CONCERTINO_ROLE=script "${SCRIPT_DIR}/emit-event.sh" gate.result \
  "ticket=${GATE_TICKET}" "gate=phase:${PHASE}" "status=pass" "duration_ms=${DURATION_MS}" || true
echo "PASS $PHASE"
