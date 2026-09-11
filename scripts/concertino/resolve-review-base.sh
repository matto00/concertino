#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# resolve-review-base.sh — resolve the review diff base LIVE (CON-152).
#
# Usage:
#   resolve-review-base.sh <WORKTREE_PATH> [BASE_BRANCH] [BASE_REMOTE]
#
# BASE_BRANCH defaults to CONCERTINO_BASE_BRANCH or "main"; BASE_REMOTE
# defaults to CONCERTINO_BASE_REMOTE or "origin". CON-152 cycle 3 (finding
# 3): these defaults are sourced from the SAME `.concertino.env` (co-located
# next to this script, one directory up in `scripts/concertino/` once
# rendered) that setup-worktree.sh itself sources — not left as bare
# hardcoded "main"/"origin" fallbacks. A project whose base branch is
# `develop` (or any non-"main" value) would otherwise silently resolve
# against the WRONG remote branch on every no-args call, which is worse
# than a loud failure: `git merge-base HEAD origin/main` can succeed against
# a real-but-irrelevant `origin/main` and hand back a plausible-looking, but
# wrong, SHA.
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
# This script is called LIVE by every review-bearing role, immediately
# before its own diff (see core/roles/orchestrator.md,
# core/roles/{evaluator,skeptic,auditor,executor}.md) — NEVER cached as a
# SHA anywhere (a cycle-1 design of this same fix cached the resolved SHA in
# workflow-state.md once at Setup, which reproduces this exact bug one layer
# later: the moment the branch reconciles against its base mid-run, a
# cached SHA goes stale in the OTHER direction, re-flagging already-absorbed
# base commits as still under review).
#
# Procedure:
#   1. Fetch BASE_REMOTE/BASE_BRANCH fresh (so a base branch that advanced
#      after the worktree was created is actually seen).
#   2. Compute `git merge-base HEAD <BASE_REMOTE>/<BASE_BRANCH>` — the point
#      where this branch actually diverged, never the base branch's live tip.
#
# Output contract (CON-152 cycle 3, finding 2): on success, prints EXACTLY
# the resolved SHA (one line, nothing else) to stdout and exits 0 — no
# "BASE_SHA " prefix, no other output, so a caller never needs `sed`/`awk`
# to extract it and can never silently treat a "FAIL ..." line or empty
# output as a valid (if wrong) base. On failure, prints one "FAIL <reason>"
# line to stderr, prints NOTHING to stdout, and exits 1. A caller MUST check
# the exit status — `BASE_SHA="$(resolve-review-base.sh ...)" || { ... }`
# propagates this script's own exit code to the assignment, so a bare `||`
# is sufficient; do not swallow it through a pipe to `sed`, which would
# report success regardless of this script's own exit code.
# ===========================================================================

USAGE="usage: resolve-review-base.sh <WORKTREE_PATH> [BASE_BRANCH] [BASE_REMOTE]"
WORKTREE_PATH="${1:?$USAGE}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
[ -f "${SCRIPT_DIR}/.concertino.env" ] && source "${SCRIPT_DIR}/.concertino.env"

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

echo "$MERGE_BASE"
