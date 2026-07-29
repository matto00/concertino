#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# check-merge-readiness.sh — deterministic pre-merge gate for the auditor
# (agent-merge).
#
# Usage:
#   check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>
#
# Checks, in one invocation, the three MACHINE-VERIFIABLE conditions a safe
# merge requires. The fourth condition a merge requires — the diff actually
# satisfies the ticket's acceptance criteria — is cold subjective judgment
# and stays entirely with the auditor; this script never attempts it.
#
#   1. CI green      — every check reported on BRANCH's PR is SUCCESS. A
#      PENDING/QUEUED/IN_PROGRESS/missing conclusion is a DISTINCT failure
#      from an actual failed check ("a pending check is not a pass" — the
#      ticket is explicit these are never collapsed into one message). An
#      empty rollup (no checks configured) passes.
#   2. Mergeable     — mergeStateStatus == CLEAN passes. BEHIND/DIRTY/
#      UNSTABLE/BLOCKED fail naming the status, except BLOCKED with
#      reviewDecision == REVIEW_REQUIRED, which fails with the specific
#      "branch protection requires human review" reason instead of a
#      generic one. Every OTHER value — UNKNOWN (GitHub's transient
#      still-computing state, most likely right after this same Phase 3's
#      own `git push` + `gh pr create`), DRAFT, or anything not enumerated
#      here — fails CLOSED as "mergeability not yet determined: <status>",
#      never falling through to a silent pass.
#   3. This run's own gates passed — the latest role=evaluator `verdict`
#      event in this ticket's event log (read from the MAIN checkout, the
#      same resolution emit-event.sh uses) is PASS, and the latest
#      role=skeptic `verdict` event is CONFIRM. (Why "latest" is sufficient
#      without a separate design/final `gate` field: see design.md
#      Decision 2 of the agent-merge-role change — by construction, the
#      final-gate CONFIRM is always the most recent by the time the auditor
#      runs.)
#
# Prints "PASS" and exits 0 only when all three hold. Otherwise prints one
# "FAIL <reason>" line per failed condition to stderr and exits non-zero —
# the same stdout/stderr contract assert-phase.sh already uses. A failure
# whose reason begins "could not query ... via gh" is an environmental
# failure (gh unauthenticated, GitHub unreachable) — the auditor treats
# that shape of failure as BLOCKER, and every other failure as a named
# ESCALATE reason.
# ===========================================================================

WORKTREE_PATH="${1:?usage: check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>}"
BRANCH="${2:?usage: check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>}"
TICKET_ID="${3:?usage: check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>}"

FAILED=0
fail() {
  echo "FAIL $*" >&2
  FAILED=1
  return 0
}

# A ticket id feeds directly into a runs/ path below; unvalidated, a
# traversal shape (`../../../..`) walks out of the runs directory. Same
# pattern every other procedure script in this suite carries (see
# emit-event.sh/persist-evidence.sh's identical guard).
looks_like_ticket() { [[ "$1" =~ ^[A-Za-z#][A-Za-z0-9_-]*[0-9]$ ]]; }
if ! looks_like_ticket "$TICKET_ID"; then
  echo "FAIL invalid TICKET_ID: ${TICKET_ID}" >&2
  exit 1
fi

if [ ! -d "$WORKTREE_PATH" ]; then
  echo "FAIL worktree dir missing: ${WORKTREE_PATH}" >&2
  exit 1
fi

# Resolve the main checkout FROM WORKTREE_PATH. Duplicated from
# emit-event.sh's main_checkout() rather than sourced — every procedure
# script in this suite stays standalone (see emit-event.sh's own comment on
# why now_ms() is copied rather than imported, same reasoning here).
main_checkout() {
  local common
  common="$(cd "$WORKTREE_PATH" 2>/dev/null && git rev-parse --git-common-dir 2>/dev/null)" || return 1
  [ -z "$common" ] && return 1
  case "$common" in
    /*) ;;
     *) common="$(cd "$WORKTREE_PATH" 2>/dev/null && cd "$common" 2>/dev/null && pwd)" || return 1 ;;
  esac
  ( cd "$(dirname "$common")" 2>/dev/null && pwd ) || return 1
}

# --- 1 & 2: query the PR once per field-set needed via `gh` -----------------
# A `gh` call failing outright (not authenticated, GitHub unreachable, `gh`
# missing) is worded distinctly ("could not query ... via gh") so the
# auditor can tell an environmental BLOCKER apart from a real ESCALATE
# reason without re-deriving it from prose.
ROLLUP_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json statusCheckRollup 2>&1)"
ROLLUP_RC=$?
if [ $ROLLUP_RC -ne 0 ]; then
  fail "could not query PR status via gh: $(printf '%s' "$ROLLUP_RAW" | tr '\n' ' ' | cut -c1-200)"
else
  PENDING_NAMES="$(printf '%s' "$ROLLUP_RAW" | jq -r '
    [.statusCheckRollup[]? |
      ((.conclusion // .state // "") | ascii_upcase) as $c |
      select($c == "" or $c == "PENDING" or $c == "QUEUED" or $c == "IN_PROGRESS" or $c == "WAITING" or $c == "EXPECTED") |
      (.name // .context // "unnamed check")
    ] | join(", ")' 2>/dev/null)"
  FAILED_NAMES="$(printf '%s' "$ROLLUP_RAW" | jq -r '
    [.statusCheckRollup[]? |
      ((.conclusion // .state // "") | ascii_upcase) as $c |
      select($c != "" and $c != "SUCCESS" and $c != "PENDING" and $c != "QUEUED" and $c != "IN_PROGRESS" and $c != "WAITING" and $c != "EXPECTED") |
      (.name // .context // "unnamed check")
    ] | join(", ")' 2>/dev/null)"
  [ -n "$FAILED_NAMES" ] && fail "CI failed: ${FAILED_NAMES}"
  [ -n "$PENDING_NAMES" ] && fail "CI pending: ${PENDING_NAMES}"
fi

MERGE_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json mergeable,mergeStateStatus,reviewDecision 2>&1)"
MERGE_RC=$?
if [ $MERGE_RC -ne 0 ]; then
  fail "could not query PR mergeability via gh: $(printf '%s' "$MERGE_RAW" | tr '\n' ' ' | cut -c1-200)"
else
  MERGE_STATUS="$(printf '%s' "$MERGE_RAW" | jq -r '.mergeStateStatus // "UNKNOWN"' 2>/dev/null)"
  REVIEW_DECISION="$(printf '%s' "$MERGE_RAW" | jq -r '.reviewDecision // ""' 2>/dev/null)"
  [ -z "$MERGE_STATUS" ] && MERGE_STATUS="UNKNOWN"
  case "$MERGE_STATUS" in
    CLEAN) ;; # passes
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
    *)
      # UNKNOWN, DRAFT, or anything not enumerated above — fail CLOSED
      # rather than fall through to a pass (same philosophy as the CI
      # check: an undetermined mergeability is not a pass either).
      fail "mergeability not yet determined: ${MERGE_STATUS}"
      ;;
  esac
fi

# --- 3: this run's own gates passed -----------------------------------------
ROOT="$(main_checkout)"
if [ -z "${ROOT:-}" ]; then
  fail "could not resolve main checkout (not inside a git repo?)"
else
  LOG="${ROOT}/.concertino/runs/${TICKET_ID}/events.jsonl"
  if [ ! -f "$LOG" ]; then
    fail "no event log found for ${TICKET_ID} — cannot verify evaluator/skeptic verdicts"
  else
    # Read the log as JSONL: split into lines, parse each independently
    # (dropping any malformed line rather than aborting on it — one torn
    # write must not blind this check to every OTHER line in the log), then
    # take the LAST role=evaluator / role=skeptic verdict event by append
    # order. See this script's own header comment for why "latest" is
    # sufficient without a design/final `gate` field.
    GATE_INFO="$(jq -R -r -s '
      (split("\n") | map(select(length > 0)) | map(try fromjson catch empty)) as $evs
      | ($evs | map(select(.kind == "verdict" and .role == "evaluator")) | last | (.verdict // "MISSING")) as $ev
      | ($evs | map(select(.kind == "verdict" and .role == "skeptic")) | last | (.verdict // "MISSING")) as $sk
      | "EVAL=\($ev)\nSKEPTIC=\($sk)"
    ' "$LOG" 2>/dev/null)"
    EVAL_VERDICT="$(printf '%s\n' "$GATE_INFO" | sed -n 's/^EVAL=//p')"
    SKEPTIC_VERDICT="$(printf '%s\n' "$GATE_INFO" | sed -n 's/^SKEPTIC=//p')"
    [ -z "$EVAL_VERDICT" ] && EVAL_VERDICT="MISSING"
    [ -z "$SKEPTIC_VERDICT" ] && SKEPTIC_VERDICT="MISSING"

    [ "$EVAL_VERDICT" = "PASS" ] \
      || fail "evaluator gate not passed (latest role=evaluator verdict: ${EVAL_VERDICT})"
    [ "$SKEPTIC_VERDICT" = "CONFIRM" ] \
      || fail "skeptic gate not confirmed (latest role=skeptic verdict: ${SKEPTIC_VERDICT})"
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
echo "PASS"
