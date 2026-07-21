#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# cleanup.sh — canonical Phase-4 (post-merge) teardown for the ticket-delivery flow.
#
# Stops the dev servers bound to this ticket's ports and removes the worktree.
# Safe to re-run.
#
# DESTRUCTIVE — Phase-4 only. This script removes the live worktree and kills
# the dev servers. It must run ONLY as the orchestrator's post-merge teardown,
# never mid-review. To guard against a stray invocation it refuses to do any
# work unless an explicit Phase-4 opt-in is present:
#   - the first argument is `--phase4`, OR
#   - the environment sentinel `CONCERTINO_PHASE4=1` is set.
# Without the opt-in it prints a refusal to stderr and exits 0 (safe no-op).
#
# Usage: cleanup.sh --phase4 <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#    or: CONCERTINO_PHASE4=1 cleanup.sh <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>
#
# Prints "READY cleaned worktree=<path>" on success.
# ===========================================================================

# Phase-4 guard: proceed with the destructive steps only on explicit opt-in.
if [ "${1:-}" = "--phase4" ]; then
  shift
elif [ "${CONCERTINO_PHASE4:-}" != "1" ]; then
  echo "cleanup.sh: refusing to run — this is a Phase-4 (post-merge) teardown that" >&2
  echo "removes the live worktree and kills the dev servers. It is invoked only by" >&2
  echo "the orchestrator after merge. Pass --phase4 as the first argument (or set" >&2
  echo "CONCERTINO_PHASE4=1) to proceed. No-op; nothing changed." >&2
  exit 0
fi

WORKTREE_PATH="${1:?usage: cleanup.sh --phase4 <WORKTREE_PATH> <DEV_PORT> <BACKEND_PORT>}"
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
