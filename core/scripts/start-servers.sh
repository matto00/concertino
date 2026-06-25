#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# start-servers.sh — canonical dev-server startup for the evaluator / skeptic.
#
# Deterministic ports, env injection, and health-waits. Idempotent: reuses a
# server already healthy on the target port. Backend and/or frontend are
# optional — if a project has no backend, leave CONCERTINO_BACKEND_START empty.
#
# Usage: start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#
# Reads from .concertino.env (next to this script):
#   CONCERTINO_BACKEND_CWD / CONCERTINO_FRONTEND_CWD     dir (worktree-relative)
#   CONCERTINO_BACKEND_START / CONCERTINO_FRONTEND_START  command (no nohup/redirect;
#                                  may reference $DEV_PORT / $BACKEND_PORT)
#   CONCERTINO_BACKEND_HEALTH / CONCERTINO_FRONTEND_HEALTH  health URL (may ref ports)
#   CONCERTINO_BACKEND_TIMEOUT / CONCERTINO_FRONTEND_TIMEOUT  seconds (default 300/60)
#   CONCERTINO_ENV_FILES   re-copied here as a safety net
#
# On success prints:
#   READY backend=<url>      (omitted if no backend configured)
#   READY frontend=<url>     (omitted if no frontend configured)
# On failure prints "FAIL <reason>" plus a log path and exits non-zero. A
# server that never becomes healthy is an environmental BLOCKER.
# ===========================================================================

WORKTREE_PATH="${1:?usage: start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"
DEV_PORT="${2:?usage: start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"
BACKEND_PORT="${3:?usage: start-servers.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"
export DEV_PORT BACKEND_PORT

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"

REPO_ROOT="$(git rev-parse --show-toplevel)"
BACKEND_LOG="${WORKTREE_PATH}/.concertino-backend.log"
FRONTEND_LOG="${WORKTREE_PATH}/.concertino-frontend.log"

# Safety net: re-copy any env files setup-worktree.sh should have placed.
for f in ${CONCERTINO_ENV_FILES:-}; do
  if [ ! -f "${WORKTREE_PATH}/${f}" ] && [ -f "${REPO_ROOT}/${f}" ]; then
    mkdir -p "$(dirname "${WORKTREE_PATH}/${f}")"
    cp "${REPO_ROOT}/${f}" "${WORKTREE_PATH}/${f}"
  fi
done

start_one() {
  local label="$1" cwd="$2" cmd="$3" health="$4" timeout="$5" log="$6"
  [ -z "$cmd" ] && return 0
  local url; url="$(eval "echo \"$health\"")"
  if curl -sf "$url" >/dev/null 2>&1; then
    echo "note: ${label} already healthy at ${url}, reusing" >&2
  else
    ( cd "${WORKTREE_PATH}/${cwd}" && eval "nohup $cmd >\"$log\" 2>&1 & disown" )
    if ! timeout "$timeout" bash -c \
        "until curl -sf '$url' >/dev/null 2>&1; do sleep 3; done"; then
      echo "FAIL ${label} did not become healthy at ${url} within ${timeout}s (log: ${log})" >&2
      exit 1
    fi
  fi
  echo "READY ${label}=${url}"
}

start_one backend  "${CONCERTINO_BACKEND_CWD:-.}"  "${CONCERTINO_BACKEND_START:-}" \
          "${CONCERTINO_BACKEND_HEALTH:-}"  "${CONCERTINO_BACKEND_TIMEOUT:-300}" "$BACKEND_LOG"
start_one frontend "${CONCERTINO_FRONTEND_CWD:-.}" "${CONCERTINO_FRONTEND_START:-}" \
          "${CONCERTINO_FRONTEND_HEALTH:-}" "${CONCERTINO_FRONTEND_TIMEOUT:-60}" "$FRONTEND_LOG"
