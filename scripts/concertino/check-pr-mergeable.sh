#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# check-pr-mergeable.sh — deterministic pre-present gate (CON-122).
#
# Usage:
#   check-pr-mergeable.sh <WORKTREE_PATH> <BRANCH>
#
# Verifies a PR's LIVE mergeable state before the orchestrator's Delivery
# phase claims a PR is "ready to merge"/"clean" and presents it to a human
# (the AGENT_MERGE=false path). The agent-merge path already gets this via
# check-merge-readiness.sh's condition 2 (CON-166); this script exists
# because the human-merge path had NO equivalent check at all — an
# orchestrator could (and twice did, HEL-412/HEL-703) assert a PR was
# "clean"/"no overlap conflicts expected" from shallow signals (file-name
# diffing, a belief that a sibling ticket didn't touch the same files)
# instead of actually querying `gh pr view --json mergeable`. Both times the
# PR was actually CONFLICTING/DIRTY, which — worse than an ordinary merge
# conflict — means GitHub never materializes a merge ref at all, so the
# `pull_request`-triggered CI workflow (the real test-gate jobs) never even
# queues; only checks that don't need a computable merge ref (e.g. CodeQL)
# go green, and a driver skimming `gh pr checks` sees a mostly-green PR and
# merges it believing gates passed that never ran.
#
# Procedure:
#   0. Reconcile BEHIND once — if the PR is behind its base, merge the base
#      into BRANCH (never rebase/force-push, so current work is never
#      rewritten) and push, mirroring check-merge-readiness.sh's own
#      condition 0. A real conflict aborts the merge and falls through to
#      the ordinary BEHIND failure for a human to resolve.
#   1. Poll mergeStateStatus, bounded by CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC
#      / CONCERTINO_MERGE_RECHECK_INTERVAL_SEC, only on the transient
#      UNKNOWN state. CLEAN passes; BEHIND/DIRTY/UNSTABLE/BLOCKED fail naming
#      the status (BLOCKED + reviewDecision==REVIEW_REQUIRED fails with the
#      specific branch-protection reason); anything else not enumerated
#      fails CLOSED rather than falling through to a silent pass.
#
# Prints "PASS" and exits 0 only when the PR is actually mergeable.
# Otherwise prints one "FAIL <reason>" line to stderr and exits 1. A `gh`
# call failing outright (not authenticated, GitHub unreachable) is worded
# distinctly ("could not query ... via gh") so the caller can treat it as an
# environmental BLOCKER rather than a real conflict.
#
# Tunables (env):
#   CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC  (default 90 = 1.5m)
#   CONCERTINO_MERGE_RECHECK_INTERVAL_SEC (default 10)
# ===========================================================================

USAGE="usage: check-pr-mergeable.sh <WORKTREE_PATH> <BRANCH>"
WORKTREE_PATH="${1:?$USAGE}"
BRANCH="${2:?$USAGE}"

MERGE_RECHECK_TIMEOUT="${CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC:-90}"
MERGE_RECHECK_INTERVAL="${CONCERTINO_MERGE_RECHECK_INTERVAL_SEC:-10}"

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "FAIL worktree dir missing: ${WORKTREE_PATH}" >&2
  exit 1
fi

fail() {
  echo "FAIL $*" >&2
  exit 1
}

# --- 0: reconcile a BEHIND branch once, before checking mergeability -------
PRE_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json mergeStateStatus,baseRefName 2>&1)"
if [ $? -ne 0 ]; then
  fail "could not query PR status via gh: $(printf '%s' "$PRE_RAW" | tr '\n' ' ' | cut -c1-200)"
fi
PRE_STATUS="$(printf '%s' "$PRE_RAW" | jq -r '.mergeStateStatus // ""' 2>/dev/null)"
BASE_REF="$(printf '%s' "$PRE_RAW" | jq -r '.baseRefName // ""' 2>/dev/null)"
[ -z "$BASE_REF" ] && BASE_REF="${CONCERTINO_BASE_BRANCH:-main}"
if [ "$PRE_STATUS" = "BEHIND" ]; then
  FETCH_OUT="$(cd "$WORKTREE_PATH" && git fetch origin "$BASE_REF" 2>&1)"
  if [ $? -ne 0 ]; then
    fail "not mergeable: BEHIND (auto-reconcile: could not fetch origin/${BASE_REF}: $(printf '%s' "$FETCH_OUT" | tr '\n' ' ' | cut -c1-200))"
  fi
  MERGE_OUT="$(cd "$WORKTREE_PATH" && git merge --no-edit "origin/${BASE_REF}" 2>&1)"
  if [ $? -ne 0 ]; then
    (cd "$WORKTREE_PATH" && git merge --abort) >/dev/null 2>&1 || true
    fail "not mergeable: BEHIND (auto-reconcile with origin/${BASE_REF} hit conflicts — needs human resolution; current work left untouched)"
  fi
  PUSH_OUT="$(cd "$WORKTREE_PATH" && git push origin "HEAD:${BRANCH}" 2>&1)"
  if [ $? -ne 0 ]; then
    fail "not mergeable: BEHIND (auto-reconcile merged origin/${BASE_REF} locally but push to origin/${BRANCH} failed: $(printf '%s' "$PUSH_OUT" | tr '\n' ' ' | cut -c1-200))"
  fi
  # reconciled and pushed cleanly — fall through to the mergeable poll below,
  # which re-queries on the new HEAD.
fi

# --- 1: mergeable, polled only on the transient UNKNOWN state --------------
merge_elapsed=0
while :; do
  MERGE_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json mergeable,mergeStateStatus,reviewDecision 2>&1)"
  if [ $? -ne 0 ]; then
    fail "could not query PR mergeability via gh: $(printf '%s' "$MERGE_RAW" | tr '\n' ' ' | cut -c1-200)"
  fi
  MERGE_STATUS="$(printf '%s' "$MERGE_RAW" | jq -r '.mergeStateStatus // "UNKNOWN"' 2>/dev/null)"
  REVIEW_DECISION="$(printf '%s' "$MERGE_RAW" | jq -r '.reviewDecision // ""' 2>/dev/null)"
  [ -z "$MERGE_STATUS" ] && MERGE_STATUS="UNKNOWN"
  case "$MERGE_STATUS" in
    CLEAN)
      echo "PASS"
      exit 0
      ;;
    BEHIND|DIRTY|UNSTABLE)
      fail "not mergeable: ${MERGE_STATUS}"
      ;;
    BLOCKED)
      if [ "$REVIEW_DECISION" = "REVIEW_REQUIRED" ]; then
        fail "branch protection requires human review"
      else
        fail "not mergeable: BLOCKED"
      fi
      ;;
    UNKNOWN)
      if [ "$merge_elapsed" -ge "$MERGE_RECHECK_TIMEOUT" ]; then
        fail "mergeability not yet determined: UNKNOWN (timed out after ${MERGE_RECHECK_TIMEOUT}s)"
      fi
      sleep "$MERGE_RECHECK_INTERVAL"
      merge_elapsed=$((merge_elapsed + MERGE_RECHECK_INTERVAL))
      ;;
    *)
      fail "mergeability not yet determined: ${MERGE_STATUS}"
      ;;
  esac
done
