#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# resolve-review-base.sh — resolve the review diff base ONCE per run (CON-152).
#
# Usage:
#   resolve-review-base.sh <WORKTREE_PATH> [BASE_BRANCH] [BASE_REMOTE]
#
# BASE_BRANCH defaults to CONCERTINO_BASE_BRANCH or "main"; BASE_REMOTE
# defaults to CONCERTINO_BASE_REMOTE or "origin" — same env vars and
# defaults setup-worktree.sh already uses, so callers that don't pass them
# explicitly still resolve the same base setup-worktree.sh cut the branch
# from.
#
# Why this exists: every review-bearing role (evaluator/skeptic/auditor) and
# the executor's own gate-selection step used to compute their diff surface
# against a bare, unresolved `<base>` (in practice, a local branch ref named
# after BASE_BRANCH). In a long-lived worktree that local ref is created once
# at branch time and NEVER moves, while the remote base branch keeps
# advancing as sibling tickets merge during the run — so the diff silently
# grows to include every commit merged to the remote base since the worktree
# was created, work the ticket never touched (CON-152; observed on HEL-983:
# a one-line fix produced a ~2,400-line diff after absorbing four unrelated
# merges).
#
# This script is the ONE place that resolves the base, called once at Setup
# (see core/roles/orchestrator.md) and recorded as REVIEW_BASE_SHA in
# workflow-state.md. Every later role reads that recorded SHA instead of
# recomputing "<base>" itself, so evaluator/skeptic/auditor/executor all
# review the identical surface even as the remote base branch keeps moving
# under them mid-run — a base that differs between roles is its own failure
# mode (see the ticket's acceptance criteria).
#
# Procedure:
#   1. Fetch BASE_REMOTE/BASE_BRANCH fresh (so a base branch that advanced
#      after the worktree was created is actually seen).
#   2. Compute `git merge-base HEAD <BASE_REMOTE>/<BASE_BRANCH>` — the point
#      where this branch actually diverged, never the base branch's live tip.
#
# Output: on success, prints exactly one line to stdout:
#   BASE_SHA <sha>
# and exits 0. On failure, prints one "FAIL <reason>" line to stderr and
# exits 1 — never falls back to a guessed/bare ref silently.
# ===========================================================================

USAGE="usage: resolve-review-base.sh <WORKTREE_PATH> [BASE_BRANCH] [BASE_REMOTE]"
WORKTREE_PATH="${1:?$USAGE}"
BASE_BRANCH="${2:-${CONCERTINO_BASE_BRANCH:-main}}"
BASE_REMOTE="${3:-${CONCERTINO_BASE_REMOTE:-origin}}"

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "FAIL worktree dir missing: ${WORKTREE_PATH}" >&2
  exit 1
fi

FETCH_OUT="$(cd "$WORKTREE_PATH" && git fetch "$BASE_REMOTE" "$BASE_BRANCH" 2>&1)"
if [ $? -ne 0 ]; then
  echo "FAIL could not fetch ${BASE_REMOTE}/${BASE_BRANCH}: $(printf '%s' "$FETCH_OUT" | tr '\n' ' ' | cut -c1-200)" >&2
  exit 1
fi

BASE_REF="${BASE_REMOTE}/${BASE_BRANCH}"
MERGE_BASE="$(cd "$WORKTREE_PATH" && git merge-base HEAD "$BASE_REF" 2>/dev/null)"
if [ -z "$MERGE_BASE" ]; then
  echo "FAIL could not resolve a merge-base between HEAD and ${BASE_REF}" >&2
  exit 1
fi

echo "BASE_SHA ${MERGE_BASE}"
