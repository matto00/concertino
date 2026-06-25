#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# cleanup.sh — canonical post-merge teardown for the ticket-delivery flow.
#
# Stops the dev servers bound to this ticket's ports and removes the worktree.
# Safe to re-run.
#
# Usage: cleanup.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#
# Prints "READY cleaned worktree=<path>" on success.
# ===========================================================================

WORKTREE_PATH="${1:?usage: cleanup.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"
DEV_PORT="${2:-}"
BACKEND_PORT="${3:-}"

REPO_ROOT="$(git rev-parse --show-toplevel)"

# Stop dev servers on this ticket's ports (no-op if already down).
[ -n "$DEV_PORT" ]     && fuser -k "${DEV_PORT}/tcp"     2>/dev/null || true
[ -n "$BACKEND_PORT" ] && fuser -k "${BACKEND_PORT}/tcp" 2>/dev/null || true

# Remove the worktree (force: discards the now-merged working tree).
if [ -d "$WORKTREE_PATH" ]; then
  git -C "$REPO_ROOT" worktree remove "$WORKTREE_PATH" --force
fi
git -C "$REPO_ROOT" worktree prune

echo "READY cleaned worktree=${WORKTREE_PATH}"
