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
# CON-122 cycle 2 (opus review): this script runs right after `gh pr
# create`, when the just-created PR's required CI has almost certainly not
# finished yet. Judging mergeability BEFORE that CI resolves reads a
# GitHub-computed status that legitimately reflects "checks still running"
# as BLOCKED/UNSTABLE — which the cycle-1 version of this script failed
# immediately on, meaning the human-merge path would BLOCKER on essentially
# every ordinary run. Fixed the same way check-merge-readiness.sh's own
# condition 1 does: poll CI to a terminal state first (bounded), THEN judge
# mergeability. This script does NOT reuse check-merge-readiness.sh's CI
# rollup helper as shared code (that script's rollup logic is entangled with
# its own PENDING/exit-3 resumable-poll contract, which this pre-present
# check has no equivalent of — it just waits inline, bounded, and fails
# closed on timeout) — but DOES share the identical BEHIND-auto-reconcile
# logic via lib/pr-reconcile.sh, since that piece genuinely is
# byte-identical between the two scripts.
#
# Procedure:
#   0. Reconcile BEHIND once (lib/pr-reconcile.sh's pr_reconcile_behind_once
#      — never rebase/force-push, so current work is never rewritten). A
#      real conflict aborts the merge and falls through to the ordinary
#      BEHIND failure for a human to resolve.
#   1. Poll CI to a terminal state, bounded by CONCERTINO_CI_WAIT_TIMEOUT_SEC
#      / CONCERTINO_CI_POLL_INTERVAL_SEC — mirrors check-merge-readiness.sh's
#      own condition 1 semantics: a FAILED check is an immediate FAIL; a
#      still-PENDING/QUEUED/IN_PROGRESS check is polled, and if the whole
#      wait window elapses with checks still pending, that is reported
#      distinctly (not a hard FAIL — CI may simply not be done yet) and this
#      script exits 3 so the caller can re-invoke rather than escalating a
#      run that hasn't finished.
#   2. Poll mergeable state, bounded by CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC
#      / CONCERTINO_MERGE_RECHECK_INTERVAL_SEC, only on the transient
#      UNKNOWN state. CLEAN passes ONLY after verifying local HEAD is
#      actually the PR's `headRefOid` (CON-122 cycle 3, finding 4 —
#      lib/pr-reconcile.sh's pr_verify_head, shared with
#      check-merge-readiness.sh's own condition 2b: without this, a query
#      right after condition 0's own reconcile push can read back a
#      mergeability computed for the PRE-push head before GitHub catches up,
#      trusting CI that never ran on the actual head); `mergeable ==
#      CONFLICTING` OR `mergeStateStatus` in BEHIND/DIRTY/UNSTABLE fails
#      naming the status (BLOCKED + reviewDecision==REVIEW_REQUIRED fails
#      with the specific branch-protection reason); anything else not
#      enumerated fails CLOSED rather than falling through to a silent pass.
#
# Prints "PASS" and exits 0 only when the PR is actually mergeable and CI is
# green. Prints "PENDING <names>" and exits 3 when CI simply hasn't finished
# yet (re-invoke — not a failure). Otherwise prints one "FAIL <reason>" line
# to stderr and exits 1. A `gh` call failing outright (not authenticated,
# GitHub unreachable) is worded distinctly ("could not query ... via gh") so
# the caller can treat it as an environmental BLOCKER rather than a real
# conflict.
#
# Tunables (env):
#   CONCERTINO_CI_WAIT_TIMEOUT_SEC        (default 540 = 9m)
#   CONCERTINO_CI_POLL_INTERVAL_SEC       (default 20)
#   CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC  (default 90 = 1.5m)
#   CONCERTINO_MERGE_RECHECK_INTERVAL_SEC (default 10)
# ===========================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/pr-reconcile.sh"

USAGE="usage: check-pr-mergeable.sh <WORKTREE_PATH> <BRANCH>"
WORKTREE_PATH="${1:?$USAGE}"
BRANCH="${2:?$USAGE}"

CI_WAIT_TIMEOUT="${CONCERTINO_CI_WAIT_TIMEOUT_SEC:-540}"
CI_POLL_INTERVAL="${CONCERTINO_CI_POLL_INTERVAL_SEC:-20}"
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

# --- 0: reconcile a BEHIND branch once, before checking anything else ------
RECONCILE_MSG="$(pr_reconcile_behind_once "$WORKTREE_PATH" "$BRANCH")"
if [ $? -ne 0 ]; then
  fail "$RECONCILE_MSG"
fi

# --- 1: CI green, polled to a terminal state --------------------------------
ci_elapsed=0
while :; do
  ROLLUP_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json statusCheckRollup 2>&1)"
  if [ $? -ne 0 ]; then
    fail "could not query PR status via gh: $(printf '%s' "$ROLLUP_RAW" | tr '\n' ' ' | cut -c1-200)"
  fi
  PENDING_NAMES="$(printf '%s' "$ROLLUP_RAW" | jq -r '
    [.statusCheckRollup[]? |
      ((.conclusion // .state // "") | ascii_upcase) as $c |
      select($c == "" or $c == "PENDING" or $c == "QUEUED" or $c == "IN_PROGRESS" or $c == "WAITING" or $c == "EXPECTED") |
      (.name // .context // "unnamed check")
    ] | join(", ")' 2>/dev/null)"
  FAILED_NAMES="$(printf '%s' "$ROLLUP_RAW" | jq -r '
    [.statusCheckRollup[]? |
      ((.conclusion // .state // "") | ascii_upcase) as $c |
      select($c != "" and $c != "SUCCESS" and $c != "SKIPPED" and $c != "NEUTRAL" and $c != "PENDING" and $c != "QUEUED" and $c != "IN_PROGRESS" and $c != "WAITING" and $c != "EXPECTED") |
      (.name // .context // "unnamed check")
    ] | join(", ")' 2>/dev/null)"
  if [ -n "$FAILED_NAMES" ]; then
    fail "CI failed: ${FAILED_NAMES}"
  fi
  if [ -z "$PENDING_NAMES" ]; then
    break # every check SUCCESS, or an empty rollup — condition 1 passes
  fi
  if [ "$ci_elapsed" -ge "$CI_WAIT_TIMEOUT" ]; then
    # NOT a fail: these checks are running, not broken. Report the state and
    # let the caller come back to it (mirrors check-merge-readiness.sh's own
    # CON-159 PENDING/exit-3 contract).
    echo "PENDING ${PENDING_NAMES} (still running after ${CI_WAIT_TIMEOUT}s — not a failure; re-invoke)" >&2
    exit 3
  fi
  sleep "$CI_POLL_INTERVAL"
  ci_elapsed=$((ci_elapsed + CI_POLL_INTERVAL))
done

# --- 2: mergeable, polled only on the transient UNKNOWN state --------------
merge_elapsed=0
while :; do
  MERGE_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json mergeable,mergeStateStatus,reviewDecision,headRefOid 2>&1)"
  if [ $? -ne 0 ]; then
    fail "could not query PR mergeability via gh: $(printf '%s' "$MERGE_RAW" | tr '\n' ' ' | cut -c1-200)"
  fi
  MERGEABLE="$(printf '%s' "$MERGE_RAW" | jq -r '.mergeable // "UNKNOWN"' 2>/dev/null)"
  MERGE_STATUS="$(printf '%s' "$MERGE_RAW" | jq -r '.mergeStateStatus // "UNKNOWN"' 2>/dev/null)"
  REVIEW_DECISION="$(printf '%s' "$MERGE_RAW" | jq -r '.reviewDecision // ""' 2>/dev/null)"
  HEAD_REF_OID="$(printf '%s' "$MERGE_RAW" | jq -r '.headRefOid // ""' 2>/dev/null)"
  [ -z "$MERGEABLE" ] && MERGEABLE="UNKNOWN"
  [ -z "$MERGE_STATUS" ] && MERGE_STATUS="UNKNOWN"

  # `mergeable` (CONFLICTING/MERGEABLE/UNKNOWN) is GitHub's independent
  # yes/no merge-ref-computability signal — checked explicitly (CON-122
  # cycle 2, finding 5) rather than relying on mergeStateStatus alone, since
  # a real conflict is exactly what CONFLICTING means and is the precise
  # HEL-412/HEL-703 incident shape (a merge ref GitHub could not compute).
  if [ "$MERGEABLE" = "CONFLICTING" ]; then
    fail "not mergeable: CONFLICTING"
  fi

  case "$MERGE_STATUS" in
    CLEAN)
      # CON-122 cycle 3, finding 4: without this, a `gh pr view` right after
      # THIS SCRIPT'S OWN reconcile push (condition 0 above) can return a
      # mergeability read GitHub computed for the PRE-push head — a stale
      # "CLEAN" for a commit whose CI never actually ran. Verify the head
      # being judged is really the head that would be merged (shared with
      # check-merge-readiness.sh's own condition 2b via
      # lib/pr-reconcile.sh's pr_verify_head) before trusting CLEAN.
      if ! VERIFIED_HEAD="$(pr_verify_head "$WORKTREE_PATH" "$BRANCH" "$HEAD_REF_OID")"; then
        LOCAL_HEAD="$(cd "$WORKTREE_PATH" && git rev-parse HEAD 2>/dev/null)"
        fail "local HEAD (${LOCAL_HEAD:-unknown}) does not match the pull request's head (${HEAD_REF_OID:-unresolvable}) — refusing to trust a mergeable read for a state that is not the one being merged"
      fi
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
