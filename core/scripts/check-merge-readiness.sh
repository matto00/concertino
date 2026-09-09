#!/usr/bin/env bash
set -uo pipefail

# ===========================================================================
# check-merge-readiness.sh — deterministic pre-merge gate for the auditor
# (agent-merge).
#
# Usage:
#   check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID> <ARCHIVE_PREFIX>
#
# <ARCHIVE_PREFIX> (CON-166, design.md Decision 1a) is the repo-root-relative
# path (e.g. `openspec`, or `spec` for a `kind: none` spec provider) whose
# planning-artifact tree condition 3's SHA-drift check ignores. Never
# hardcoded — it is supplied by the caller (the auditor role, from its
# resolved change-dir root) so a project archiving under a different prefix
# is not refused on every delivery.
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
#      CON-166: condition 3 ALSO refuses when reviewed source content has
#      moved. Verdicts now carry the SHA the role actually reviewed
#      (`head_sha`, see emit-event.sh). The head actually being merged is
#      GitHub's `headRefOid` (Decision 5), not local HEAD — the two are
#      asserted equal (one re-query on a transient mismatch) before any
#      comparison runs; a surviving mismatch is EXIT 1, not a stale outcome,
#      since no amount of re-review fixes a diverged push. For each of the
#      evaluator's latest PASS and the skeptic's latest CONFIRM, the check
#      unions the paths the branch touched (relative to a freshly-fetched
#      base ref) at review time and now, and refuses if that reviewed-vs-head
#      diff — excluding only <ARCHIVE_PREFIX> — is non-empty (design.md
#      Decision 1). A CON-152 owner override waives the skeptic leg only
#      (Decision 6); the evaluator leg is never waived. See "STALE" below.
#
# Prints "PASS" and exits 0 only when conditions 1-3 hold. Otherwise prints
# one "FAIL <reason>" line per failed condition to stderr and exits
# non-zero — the same stdout/stderr contract assert-phase.sh already uses.
#
# CON-159: a check that is merely STILL RUNNING when the wait window expires
# is reported distinctly — one "PENDING <names>" line, exit code 3 — and is
# NOT a FAIL. The two states were previously indistinguishable, so a repo
# whose slowest required check outruns the window (helio's Scala `backend`
# job takes ~12m against a 7m default) escalated to a human on EVERY PR,
# for a run that was simply not finished yet. The window cannot just be
# raised past the slowest job: the caller's tool timeout (10m, see below)
# bounds how long this script may block at all. So the script stays under
# that ceiling and hands the caller a resumable "not yet" instead of a
# verdict. The caller re-invokes; it does not escalate. Conditions 2-3 are
# skipped in that case — they would be judging a HEAD whose CI is still
# moving.
#
# A
# failure whose reason begins "could not query ... via gh" is an
# environmental failure (gh unauthenticated, GitHub unreachable) — the
# auditor treats that shape of failure as BLOCKER, and every other failure
# as a named ESCALATE reason.
#
# CON-166: a stale reviewed SHA is reported as one "STALE <reason>" line
# per stale role, exit code 4 — distinct from exit 1 ("failed", nothing
# short of a fix clears it), CON-159's exit 3 ("wait, re-invoke unchanged"),
# and a real "FAIL". Exit 4 means "do work (re-run that gate on the current
# head), then re-invoke this script" — a script cannot spawn the agent that
# does that work itself (design.md Decision 4), so remediation is a prompt
# obligation on the orchestrator, triggered by this exit code. The auditor's
# own script-owned lease is NOT released on exit 4 (design.md Decision 4a) —
# unchanged from every other outcome: only the auditor's own verdict emission
# releases it (see emit-event.sh). If a hard FAIL and a stale verdict are
# both present, exit 1 dominates (design.md Decision 6a) — a "do work and
# re-invoke" signal must never mask a failure no amount of re-review clears.
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
#   CONCERTINO_CI_WAIT_TIMEOUT_SEC        (default 540 = 9m)
#   CONCERTINO_CI_POLL_INTERVAL_SEC       (default 20)
#   CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC  (default 90 = 1.5m)
#   CONCERTINO_MERGE_RECHECK_INTERVAL_SEC (default 10)
# ===========================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/lib/auditor-lease.sh"

USAGE="usage: check-merge-readiness.sh <WORKTREE_PATH> <BRANCH> <TICKET_ID> <ARCHIVE_PREFIX>"
WORKTREE_PATH="${1:?$USAGE}"
BRANCH="${2:?$USAGE}"
TICKET_ID="${3:?$USAGE}"
# CON-166 (design.md Decision 1a): the planning-artifact prefix condition 3's
# SHA-drift check excludes, supplied by the caller — never hardcoded, so a
# project archiving outside `openspec/` is not refused on every delivery.
ARCHIVE_PREFIX="${4:?$USAGE}"

CI_WAIT_TIMEOUT="${CONCERTINO_CI_WAIT_TIMEOUT_SEC:-540}"
CI_POLL_INTERVAL="${CONCERTINO_CI_POLL_INTERVAL_SEC:-20}"
MERGE_RECHECK_TIMEOUT="${CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC:-90}"
MERGE_RECHECK_INTERVAL="${CONCERTINO_MERGE_RECHECK_INTERVAL_SEC:-10}"

FAILED=0
CI_PENDING=0
CI_PENDING_NAMES=""
# CON-166: set unconditionally here (not only inside the block that computes
# it) — the script runs under `set -u`, and the exit-code decision at the
# bottom references this even on paths (ROOT unresolvable, no event log)
# that never reach the block below.
STALE=0
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

# --- CON-171: acquire the auditor lease (Signal A) --------------------------
# This is the auditor's first action and a hard precondition of merging, so
# taking the lease here brackets the auditor's entire remaining lifetime.
# Placed strictly after BOTH validations above (ticket-shape, worktree-dir)
# so a lease is never created under a key emit-event.sh's release path could
# not address, or for a worktree that was never confirmed to exist
# (design.md Decision 2, "Acquisition happens after ticket-shape validation,
# not before it" — corrected at design-gate round 4 non-blocking note 3 to
# also sit after the worktree-dir-missing check). Acquisition is idempotent
# by requirement, not merely defensively: this script re-runs up to three
# times on a PENDING (exit 3) re-invoke (see header, CON-159), so a healthy
# PR with slow CI re-acquires the same lease one to three times.
#
# Best-effort: an unresolvable root here does not fail this script's own
# readiness checks (that would change unrelated behaviour this ticket does
# not own) — it is cleanup.sh's query, not this acquire, that must fail
# closed on an unresolvable root (design.md Decision 2).
LEASE_ROOT="$(lease_resolve_root "$WORKTREE_PATH")" || LEASE_ROOT=""
if [ -n "$LEASE_ROOT" ]; then
  lease_acquire "$LEASE_ROOT" "$TICKET_ID" "$WORKTREE_PATH" "check-merge-readiness.sh" \
    || echo "note: could not record auditor lease (non-fatal)" >&2
else
  echo "note: could not resolve run root — auditor lease not recorded (non-fatal)" >&2
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
      # NOT a fail: these checks are running, not broken. Report the state
      # and let the caller come back to it. See CON-159 in the header.
      CI_PENDING=1
      CI_PENDING_NAMES="$PENDING_NAMES"
      break
    fi
    sleep "$CI_POLL_INTERVAL"
    ci_elapsed=$((ci_elapsed + CI_POLL_INTERVAL))
  done
fi

# --- 2: mergeable, polled only on the transient UNKNOWN state --------------
# Skipped while CI is still pending: mergeability judged against a HEAD whose
# checks are still moving is a reading with a shelf life, and reporting it
# alongside a "come back later" would invite acting on it.
if [ "$FAILED" -eq 0 ] && [ "$CI_PENDING" -eq 0 ]; then
  merge_elapsed=0
  while :; do
    # CON-166 (design.md Decision 5): `headRefOid` is added HERE, to the
    # condition-2 query — never to condition-0's pre-reconcile query, whose
    # value would be pre-push and mismatch local HEAD on every reconciled
    # run (a false refusal on the healthy path).
    MERGE_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json mergeable,mergeStateStatus,reviewDecision,headRefOid 2>&1)"
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
        HEAD_REF_OID="$(printf '%s' "$MERGE_RAW" | jq -r '.headRefOid // ""' 2>/dev/null)"
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

# --- 2b: the head being checked is the head that will be merged ------------
# (design.md Decision 5.) `gh pr merge` merges the PR's `headRefOid`, read
# from GitHub above — not local HEAD. GitHub's read-after-push lag gets one
# re-query before refusing. A surviving mismatch, or a failed re-query, is
# EXIT 1 (not the exit-4 STALE outcome): it is not a stale review, and no
# amount of re-review fixes a diverged push.
VERIFIED_HEAD=""
if [ "$FAILED" -eq 0 ] && [ "$CI_PENDING" -eq 0 ]; then
  LOCAL_HEAD="$(cd "$WORKTREE_PATH" && git rev-parse HEAD 2>/dev/null)"
  if [ -z "$HEAD_REF_OID" ] || [ "$LOCAL_HEAD" != "$HEAD_REF_OID" ]; then
    RECHECK_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json headRefOid 2>&1)"
    if [ $? -eq 0 ]; then
      HEAD_REF_OID="$(printf '%s' "$RECHECK_RAW" | jq -r '.headRefOid // ""' 2>/dev/null)"
    else
      HEAD_REF_OID=""
    fi
  fi
  if [ -z "$HEAD_REF_OID" ] || [ -z "$LOCAL_HEAD" ] || [ "$LOCAL_HEAD" != "$HEAD_REF_OID" ]; then
    fail "local HEAD (${LOCAL_HEAD:-unknown}) does not match the pull request's head (${HEAD_REF_OID:-unresolvable}) — refusing to verify a state that is not the one being merged"
  else
    VERIFIED_HEAD="$LOCAL_HEAD"
  fi
fi

# --- 3: this run's own gates passed -----------------------------------------
if [ "$CI_PENDING" -ne 0 ]; then
  echo "PENDING ${CI_PENDING_NAMES} (still running after ${CI_WAIT_TIMEOUT}s — not a failure; re-invoke)" >&2
  exit 3
fi

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
      | ($evs | map(select(.kind == "verdict" and .role == "evaluator")) | last) as $eve
      | ($evs | map(select(.kind == "verdict" and .role == "skeptic")) | last) as $ske
      | (($eve.verdict) // "MISSING") as $ev
      | (($ske.verdict) // "MISSING") as $sk
      | (($eve.head_sha) // "") as $evsha
      | (($ske.head_sha) // "") as $sksha
      | ([$evs | to_entries[] | select(.value.kind == "verdict" and .value.role == "skeptic")] | last | (.key // -1)) as $ski
      | ([$evs | to_entries[] | select(.value.kind == "escalation.answered" and (.value.answer == "proceed-to-delivery"))] | last | (.key // -1)) as $ovi
      | "EVAL=\($ev)\nSKEPTIC=\($sk)\nEVALSHA=\($evsha)\nSKEPTICSHA=\($sksha)\nOVERRIDE=\(if $ovi > $ski then "yes" else "no" end)"
    ' "$LOG" 2>/dev/null)"
    EVAL_VERDICT="$(printf '%s\n' "$GATE_INFO" | sed -n 's/^EVAL=//p')"
    SKEPTIC_VERDICT="$(printf '%s\n' "$GATE_INFO" | sed -n 's/^SKEPTIC=//p')"
    EVAL_SHA="$(printf '%s\n' "$GATE_INFO" | sed -n 's/^EVALSHA=//p')"
    SKEPTIC_SHA="$(printf '%s\n' "$GATE_INFO" | sed -n 's/^SKEPTICSHA=//p')"
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

    # --- 3b: reviewed source has not moved (CON-166, design.md Decision 1) --
    # Only meaningful once the gate VALUES above are known good — a role
    # whose latest verdict isn't PASS/CONFIRM already fails above, and exit 1
    # dominates exit 4 regardless (Decision 6a), so this is skipped whenever
    # $FAILED is already set.
    if [ "$FAILED" -eq 0 ] && [ -n "$VERIFIED_HEAD" ]; then
      # Decision 1b: resolve BASE_REF at a scope this condition can see (the
      # script runs under `set -u`, and condition 0's own BASE_REF is set
      # only inside its own success branch), then fetch unconditionally
      # before any merge-base is computed — this is IN ADDITION to
      # condition 0's own BEHIND-path fetch, not a replacement for it. A
      # stale (behind) local origin/<base> is the failure direction that
      # bites: it would re-admit paths the branch already merged in as
      # though they were still under review.
      C3_BASE_REF=""
      C3_BASE_RAW="$(cd "$WORKTREE_PATH" && gh pr view "$BRANCH" --json baseRefName 2>&1)"
      if [ $? -eq 0 ]; then
        C3_BASE_REF="$(printf '%s' "$C3_BASE_RAW" | jq -r '.baseRefName // ""' 2>/dev/null)"
      fi
      [ -z "$C3_BASE_REF" ] && C3_BASE_REF="${CONCERTINO_BASE_BRANCH:-main}"
      C3_FETCH_OUT="$(cd "$WORKTREE_PATH" && git fetch origin "$C3_BASE_REF" 2>&1)"
      C3_FETCH_RC=$?
      C3_BASE_REMOTE="origin/${C3_BASE_REF}"

      # stale_check <role> <reviewed_sha>
      #
      # Sets STALE=1 and prints one "STALE ..." line to stderr on any
      # uncertainty or detected drift (design.md Decision 3: every
      # uncertainty refuses, fail-closed). Prints nothing and leaves STALE
      # untouched when the leg passes.
      stale_check() {
        local role="$1" reviewed="$2"
        if [ -z "$reviewed" ]; then
          STALE=1
          echo "STALE ${role} verdict has no recorded head_sha — cannot verify reviewed source" >&2
          return
        fi
        if ! git -C "$WORKTREE_PATH" cat-file -e "${reviewed}^{commit}" 2>/dev/null; then
          STALE=1
          echo "STALE ${role} reviewed SHA is unresolvable: ${reviewed}" >&2
          return
        fi
        if [ $C3_FETCH_RC -ne 0 ]; then
          STALE=1
          echo "STALE ${role} could not fetch ${C3_BASE_REMOTE} to scope the comparison" >&2
          return
        fi
        local mb_r mb_h
        mb_r="$(git -C "$WORKTREE_PATH" merge-base "$C3_BASE_REMOTE" "$reviewed" 2>/dev/null)"
        mb_h="$(git -C "$WORKTREE_PATH" merge-base "$C3_BASE_REMOTE" "$VERIFIED_HEAD" 2>/dev/null)"
        if [ -z "$mb_r" ] || [ -z "$mb_h" ]; then
          STALE=1
          echo "STALE ${role} could not resolve a common ancestor with ${C3_BASE_REMOTE} for reviewed=${reviewed} head=${VERIFIED_HEAD}" >&2
          return
        fi
        local paths_r paths_h rc
        paths_r="$(git -C "$WORKTREE_PATH" diff --name-only "$mb_r" "$reviewed" 2>&1)"; rc=$?
        if [ $rc -ne 0 ]; then
          STALE=1
          echo "STALE ${role} could not diff reviewed source (git error)" >&2
          return
        fi
        paths_h="$(git -C "$WORKTREE_PATH" diff --name-only "$mb_h" "$VERIFIED_HEAD" 2>&1)"; rc=$?
        if [ $rc -ne 0 ]; then
          STALE=1
          echo "STALE ${role} could not diff head source (git error)" >&2
          return
        fi
        # Union of branch-touched paths at review time and now — NO exclusion
        # applied here (design.md Decision 1, step 2).
        local paths
        paths="$(printf '%s\n%s\n' "$paths_r" "$paths_h" | sed '/^$/d' | sort -u)"
        if [ -z "$paths" ]; then
          # Decision 1c: empty PATHS passes explicitly. A pathspec list
          # reduced to only the exclusion term means "everything except the
          # prefix" to git, not "nothing" — invoking the diff below with an
          # empty $paths would silently become the whole-commit comparison
          # this check exists to reject.
          return
        fi
        local -a patharr=()
        while IFS= read -r p; do
          [ -n "$p" ] && patharr+=("$p")
        done <<< "$paths"
        local diff_out
        diff_out="$(git -C "$WORKTREE_PATH" diff --name-only "$reviewed" "$VERIFIED_HEAD" -- "${patharr[@]}" ":(exclude)${ARCHIVE_PREFIX}/*" 2>&1)"; rc=$?
        if [ $rc -ne 0 ]; then
          STALE=1
          echo "STALE ${role} could not diff reviewed against head over the branch's own paths (git error)" >&2
          return
        fi
        if [ -n "$diff_out" ]; then
          STALE=1
          local changed
          changed="$(printf '%s' "$diff_out" | tr '\n' ',' | sed 's/,$//')"
          echo "STALE ${role} reviewed=${reviewed} head=${VERIFIED_HEAD} changed=${changed}" >&2
        fi
      }

      # The evaluator leg applies unconditionally, including on a CON-152
      # override run (design.md Decision 6) — the override is the owner's
      # judgment about the SKEPTIC's outstanding objections, never a
      # statement that some later evaluator-reviewed commit was seen.
      stale_check evaluator "$EVAL_SHA"
      if [ "$SKEPTIC_OVERRIDE" = "yes" ]; then
        echo "NOTE skeptic content check not performed — skeptic gate cleared by owner override (Decision 6)" >&2
      else
        stale_check skeptic "$SKEPTIC_SHA"
      fi
    fi
  fi
fi

if [ "$FAILED" -ne 0 ]; then
  exit 1
fi
# CON-166 (design.md Decision 6a): exit 1 dominates exit 4 — a hard failure
# above already returned. A stale reviewed SHA, with no hard failure, is
# distinct from both exit 1 and CON-159's exit 3: it means "do work (re-run
# the stale gate on the current head), then re-invoke" (design.md Decision 4).
if [ "$STALE" -ne 0 ]; then
  exit 4
fi
echo "PASS"
