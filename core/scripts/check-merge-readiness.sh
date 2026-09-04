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
#   0. Reconcile BEHIND  — if the PR is behind its base when this script
#      starts, merge the base into BRANCH once, push, and let conditions 1-2
#      re-derive fresh state on the new HEAD, instead of failing outright.
#      Current work is never discarded: a merge (not a rebase/force-push)
#      is used, and a real conflict aborts the merge and falls through to
#      the ordinary BEHIND failure below for a human to resolve. See
#      "Reconciliation (condition 0)" below.
#   1. CI green      — every check reported on BRANCH's PR is SUCCESS,
#      SKIPPED or NEUTRAL. SKIPPED/NEUTRAL are terminal non-failures, not
#      passes-in-waiting: a workflow that deliberately no-ops on PRs it
#      does not apply to (e.g. a Dependabot-metadata job gated on the PR
#      author) reports SKIPPED on every other PR, and treating that as a
#      failed check fails closed on every such PR forever. A
#      PENDING/QUEUED/IN_PROGRESS/missing conclusion is a DISTINCT failure
#      from an actual failed check ("a pending check is not a pass" — the
#      ticket is explicit these are never collapsed into one message), but
#      it is not an immediate fail either: this script polls, bounded by
#      CONCERTINO_CI_WAIT_TIMEOUT_SEC, before giving up. An empty rollup (no
#      checks configured) passes immediately.
#   2. Mergeable     — mergeStateStatus == CLEAN passes. BEHIND/DIRTY/
#      UNSTABLE/BLOCKED fail naming the status, except BLOCKED with
#      reviewDecision == REVIEW_REQUIRED, which fails with the specific
#      "branch protection requires human review" reason instead of a
#      generic one. UNKNOWN — GitHub's transient still-computing state,
#      expected right after this script's own reconciliation push, or after
#      Phase 3's `git push` + `gh pr create` — is polled, bounded by
#      CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC, before giving up. DRAFT or
#      anything else not enumerated here fails CLOSED immediately as
#      "mergeability not yet determined: <status>", never falling through to
#      a silent pass.
#   3. This run's own gates passed — the latest role=evaluator `verdict`
#      event in this ticket's event log (read from the MAIN checkout, the
#      same resolution emit-event.sh uses) is PASS, and the latest
#      role=skeptic `verdict` event is CONFIRM. (Why "latest" is sufficient
#      without a separate design/final `gate` field: see design.md
#      Decision 2 of the agent-merge-role change — by construction, the
#      final-gate CONFIRM is always the most recent by the time the auditor
#      runs.) CON-152: the skeptic leg is ALSO satisfied when the human
#      answered a budget-exhaustion escalation `proceed-to-delivery` AFTER
#      that latest skeptic verdict — an owner override, reported as such
#      rather than as a CONFIRM. Read from `escalation.answered`, which only
#      emit-event.sh's resolution path writes from a human's answer file, so
#      no agent can forge it; an orchestrator-written verdict never clears
#      this gate.
#
# Prints "PASS" and exits 0 only when conditions 1-3 hold. Otherwise prints
# one "FAIL <reason>" line per failed condition to stderr and exits
# non-zero — the same stdout/stderr contract assert-phase.sh already uses. A
# failure whose reason begins "could not query ... via gh" is an
# environmental failure (gh unauthenticated, GitHub unreachable) — the
# auditor treats that shape of failure as BLOCKER, and every other failure
# as a named ESCALATE reason.
#
# This invocation can block for a while (bounded by the two timeouts below,
# worst case a few minutes) — a caller invoking this via a tool with its own
# default timeout (e.g. a 2-minute default Bash-tool timeout) must raise it
# explicitly, or a still-genuinely-pending CI run reads as a tool timeout
# instead of the "CI pending after Ns" FAIL this script would otherwise
# produce on its own.
#
# Tunables (env, not sourced from .concertino.env — override directly when
# needed, e.g. in tests):
#   CONCERTINO_CI_WAIT_TIMEOUT_SEC        (default 420 = 7m)
#   CONCERTINO_CI_POLL_INTERVAL_SEC       (default 20)
#   CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC  (default 90 = 1.5m)
#   CONCERTINO_MERGE_RECHECK_INTERVAL_SEC (default 10)
# ===========================================================================

WORKTREE_PATH="${1:?usage: check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>}"
BRANCH="${2:?usage: check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>}"
TICKET_ID="${3:?usage: check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID>}"

CI_WAIT_TIMEOUT="${CONCERTINO_CI_WAIT_TIMEOUT_SEC:-420}"
CI_POLL_INTERVAL="${CONCERTINO_CI_POLL_INTERVAL_SEC:-20}"
MERGE_RECHECK_TIMEOUT="${CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC:-90}"
MERGE_RECHECK_INTERVAL="${CONCERTINO_MERGE_RECHECK_INTERVAL_SEC:-10}"

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

# --- 0: reconcile a BEHIND branch once, before anything else ---------------
# A merge (never a rebase/force-push) so current work is never rewritten or
# lost — it only ever gains the base's new commits on top. Run before
# conditions 1-2 so that, on success, both re-derive fresh state against the
# new HEAD (CI restarts on a new commit; mergeability recomputes) rather
# than judging a HEAD this script just moved past.
PRE_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json mergeStateStatus,baseRefName 2>&1)"
if [ $? -eq 0 ]; then
  PRE_STATUS="$(printf '%s' "$PRE_RAW" | jq -r '.mergeStateStatus // ""' 2>/dev/null)"
  BASE_REF="$(printf '%s' "$PRE_RAW" | jq -r '.baseRefName // ""' 2>/dev/null)"
  [ -z "$BASE_REF" ] && BASE_REF="${CONCERTINO_BASE_BRANCH:-main}"
  if [ "$PRE_STATUS" = "BEHIND" ]; then
    FETCH_OUT="$(cd "$WORKTREE_PATH" && git fetch origin "$BASE_REF" 2>&1)"
    if [ $? -ne 0 ]; then
      fail "not mergeable: BEHIND (auto-reconcile: could not fetch origin/${BASE_REF}: $(printf '%s' "$FETCH_OUT" | tr '\n' ' ' | cut -c1-200))"
    else
      MERGE_OUT="$(cd "$WORKTREE_PATH" && git merge --no-edit "origin/${BASE_REF}" 2>&1)"
      if [ $? -ne 0 ]; then
        (cd "$WORKTREE_PATH" && git merge --abort) >/dev/null 2>&1 || true
        fail "not mergeable: BEHIND (auto-reconcile with origin/${BASE_REF} hit conflicts — needs human resolution; current work left untouched)"
      else
        PUSH_OUT="$(cd "$WORKTREE_PATH" && git push origin "HEAD:${BRANCH}" 2>&1)"
        if [ $? -ne 0 ]; then
          fail "not mergeable: BEHIND (auto-reconcile merged origin/${BASE_REF} locally but push to origin/${BRANCH} failed: $(printf '%s' "$PUSH_OUT" | tr '\n' ' ' | cut -c1-200))"
        fi
        # else: reconciled and pushed cleanly — fall through to 1/2 below,
        # which re-query on the new HEAD.
      fi
    fi
  fi
fi

# --- 1: CI green, polled ----------------------------------------------------
# A `gh` call failing outright (not authenticated, GitHub unreachable, `gh`
# missing) is worded distinctly ("could not query ... via gh") so the
# auditor can tell an environmental BLOCKER apart from a real ESCALATE
# reason without re-deriving it from prose.
if [ "$FAILED" -eq 0 ]; then
  ci_elapsed=0
  while :; do
    ROLLUP_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json statusCheckRollup 2>&1)"
    ROLLUP_RC=$?
    if [ $ROLLUP_RC -ne 0 ]; then
      fail "could not query PR status via gh: $(printf '%s' "$ROLLUP_RAW" | tr '\n' ' ' | cut -c1-200)"
      break
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
      break
    fi
    if [ -z "$PENDING_NAMES" ]; then
      break # every check SUCCESS, or an empty rollup — condition 1 passes
    fi
    if [ "$ci_elapsed" -ge "$CI_WAIT_TIMEOUT" ]; then
      fail "CI pending after ${CI_WAIT_TIMEOUT}s: ${PENDING_NAMES}"
      break
    fi
    sleep "$CI_POLL_INTERVAL"
    ci_elapsed=$((ci_elapsed + CI_POLL_INTERVAL))
  done
fi

# --- 2: mergeable, polled only on the transient UNKNOWN state --------------
if [ "$FAILED" -eq 0 ]; then
  merge_elapsed=0
  while :; do
    MERGE_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json mergeable,mergeStateStatus,reviewDecision 2>&1)"
    MERGE_RC=$?
    if [ $MERGE_RC -ne 0 ]; then
      fail "could not query PR mergeability via gh: $(printf '%s' "$MERGE_RAW" | tr '\n' ' ' | cut -c1-200)"
      break
    fi
    MERGE_STATUS="$(printf '%s' "$MERGE_RAW" | jq -r '.mergeStateStatus // "UNKNOWN"' 2>/dev/null)"
    REVIEW_DECISION="$(printf '%s' "$MERGE_RAW" | jq -r '.reviewDecision // ""' 2>/dev/null)"
    [ -z "$MERGE_STATUS" ] && MERGE_STATUS="UNKNOWN"
    case "$MERGE_STATUS" in
      CLEAN)
        break # passes
        ;;
      BEHIND|DIRTY|UNSTABLE)
        fail "not mergeable: ${MERGE_STATUS}"
        break
        ;;
      BLOCKED)
        if [ "$REVIEW_DECISION" = "REVIEW_REQUIRED" ]; then
          fail "branch protection requires human review"
        else
          fail "not mergeable: BLOCKED"
        fi
        break
        ;;
      UNKNOWN)
        if [ "$merge_elapsed" -ge "$MERGE_RECHECK_TIMEOUT" ]; then
          fail "mergeability not yet determined: UNKNOWN (timed out after ${MERGE_RECHECK_TIMEOUT}s)"
          break
        fi
        sleep "$MERGE_RECHECK_INTERVAL"
        merge_elapsed=$((merge_elapsed + MERGE_RECHECK_INTERVAL))
        ;;
      *)
        # DRAFT, or anything not enumerated above — fail CLOSED immediately
        # rather than fall through to a pass or retry a non-transient state.
        fail "mergeability not yet determined: ${MERGE_STATUS}"
        break
        ;;
    esac
  done
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
      | ([$evs | to_entries[] | select(.value.kind == "verdict" and .value.role == "skeptic")] | last | (.key // -1)) as $ski
      | ([$evs | to_entries[] | select(.value.kind == "escalation.answered" and (.value.answer == "proceed-to-delivery"))] | last | (.key // -1)) as $ovi
      | "EVAL=\($ev)\nSKEPTIC=\($sk)\nOVERRIDE=\(if $ovi > $ski then "yes" else "no" end)"
    ' "$LOG" 2>/dev/null)"
    EVAL_VERDICT="$(printf '%s\n' "$GATE_INFO" | sed -n 's/^EVAL=//p')"
    SKEPTIC_VERDICT="$(printf '%s\n' "$GATE_INFO" | sed -n 's/^SKEPTIC=//p')"
    SKEPTIC_OVERRIDE="$(printf '%s\n' "$GATE_INFO" | sed -n 's/^OVERRIDE=//p')"
    [ -z "$EVAL_VERDICT" ] && EVAL_VERDICT="MISSING"
    [ -z "$SKEPTIC_VERDICT" ] && SKEPTIC_VERDICT="MISSING"
    [ -z "$SKEPTIC_OVERRIDE" ] && SKEPTIC_OVERRIDE="no"

    [ "$EVAL_VERDICT" = "PASS" ] \
      || fail "evaluator gate not passed (latest role=evaluator verdict: ${EVAL_VERDICT})"
    # CON-152: an owner override of a budget-exhausted final gate is a
    # legitimate resolution the gate previously had no way to represent, so
    # ANY run resolved that way was permanently unmergeable by agent-merge.
    # Same shape as CON-149/HEL-959, one layer up: a real non-failure state
    # with no representation. Cleared by the HUMAN's recorded answer, never by
    # an agent-written verdict -- `escalation.answered` is written only by
    # emit-event.sh's own resolution path, from an answer file a human wrote,
    # so no agent can forge one. An orchestrator-emitted CONFIRM standing in
    # for an override would be a relayed authorization, which is not
    # authority. The override must also POST-DATE the latest skeptic verdict
    # (index comparison above), so a stale override from an earlier
    # escalation can never clear a REFUTE raised after it. Reported
    # distinguishably from a real CONFIRM so the log still says who cleared
    # the gate.
    if [ "$SKEPTIC_VERDICT" = "CONFIRM" ]; then
      :
    elif [ "$SKEPTIC_OVERRIDE" = "yes" ]; then
      echo "NOTE skeptic gate cleared by owner override (proceed-to-delivery answered after the latest role=skeptic verdict: ${SKEPTIC_VERDICT}) — not a skeptic CONFIRM" >&2
    else
      fail "skeptic gate not confirmed (latest role=skeptic verdict: ${SKEPTIC_VERDICT})"
    fi
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
echo "PASS"
