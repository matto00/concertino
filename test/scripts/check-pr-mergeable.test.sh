#!/usr/bin/env bash
# Shell tests for scripts/concertino/check-pr-mergeable.sh (CON-122):
# the orchestrator's Delivery-phase pre-present mergeable check for the
# human-merge (AGENT_MERGE=false) path.
#
# `gh` is stubbed with a minimal fake on PATH so these tests never touch the
# network or a real PR. All git state is a throwaway scratch repo, cleaned
# up unconditionally via a trap (cycle 2 finding 7 — leaked GH_MOCK_DIR/repo
# temp dirs from a first cut of this test file contributed to a /tmp inode
# exhaustion incident on this machine).
set -uo pipefail

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh. This
# file already installs its own EXIT trap below, so cleanup() calls
# con181_cleanup_scratch instead of a second `trap ... EXIT`.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/check-pr-mergeable.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if printf '%s' "$2" | grep -qF "$3"; then ok "$1"; else bad "$1" "expected to find [$3] in: $2"; fi; }

echo "check-pr-mergeable.sh (CON-122)"

export CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC=0
export CONCERTINO_MERGE_RECHECK_INTERVAL_SEC=1
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=0
export CONCERTINO_CI_POLL_INTERVAL_SEC=1

CLEANUP_DIRS=()
cleanup() {
  con181_cleanup_scratch
  local d
  for d in "${CLEANUP_DIRS[@]:-}"; do
    [ -n "$d" ] && rm -rf "$d"
  done
}
trap cleanup EXIT

new_repo() {
  local d o
  d="$(mktemp -d)"
  CLEANUP_DIRS+=("$d")
  o="$d/.origin-bare"
  git init -q --bare -b main "$o"
  git init -q -b main "$d"
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  git -C "$d" remote add origin "$o"
  git -C "$d" push -q origin main
  printf '%s' "$d"
}

# $1=mergeable $2=mergeStateStatus $3=reviewDecision("null" or a string)
# `headRefOid` is deliberately NOT baked in here — the mock's `gh` stub
# overlays the WORKTREE's actual live HEAD onto every mergeable-query
# response by default (see below), since a real `gh pr view` always
# reflects the PR's true current head. A test that specifically wants a
# STALE/mismatched headRefOid (case 11) writes $GH_MOCK_DIR/head-override
# instead of relying on this default.
merge_json() {
  local rd="$3"
  if [ "$rd" != "null" ]; then rd="\"$rd\""; fi
  printf '{"mergeable":"%s","mergeStateStatus":"%s","reviewDecision":%s,"baseRefName":"main"}' "$1" "$2" "$rd"
}

# $1=array of {name,conclusion} pairs as a JSON array literal for statusCheckRollup
rollup_json() {
  printf '{"statusCheckRollup":%s}' "$1"
}

MOCKBIN="$(mktemp -d)"
CLEANUP_DIRS+=("$MOCKBIN")
cat > "$MOCKBIN/gh" <<'EOF'
#!/usr/bin/env bash
if [ -n "${GH_MOCK_FAIL:-}" ]; then
  echo "gh: authentication failed" >&2
  exit 1
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  # Distinguish the rollup query (statusCheckRollup) from the mergeable
  # query (mergeable,mergeStateStatus,reviewDecision) by which fields were
  # requested, same convention check-merge-readiness.test.sh's mock uses.
  args="$*"
  case "$args" in
    *statusCheckRollup*)
      n_file="$GH_MOCK_DIR/rollupcalls"
      n=0
      [ -f "$n_file" ] && n="$(cat "$n_file")"
      n=$((n+1))
      echo "$n" > "$n_file"
      if [ -f "$GH_MOCK_DIR/rollup-$n.json" ]; then
        cat "$GH_MOCK_DIR/rollup-$n.json"
      else
        cat "$GH_MOCK_DIR/rollup.json"
      fi
      exit 0
      ;;
    *mergeable*)
      n_file="$GH_MOCK_DIR/mergecalls"
      n=0
      [ -f "$n_file" ] && n="$(cat "$n_file")"
      n=$((n+1))
      echo "$n" > "$n_file"
      if [ -f "$GH_MOCK_DIR/merge-$n.json" ]; then
        FILE="$GH_MOCK_DIR/merge-$n.json"
      else
        FILE="$GH_MOCK_DIR/merge.json"
      fi
      # Overlay a headRefOid: an explicit override file wins (case 11's
      # stale-head test); otherwise reflect the worktree's ACTUAL live HEAD,
      # exactly like a real `gh pr view` would after this script's own
      # reconcile push (cases 1/9/10 all rely on this default so CLEAN
      # keeps passing without each test having to predict a commit SHA).
      if [ -f "$GH_MOCK_DIR/head-override" ]; then
        HEAD_VAL="$(cat "$GH_MOCK_DIR/head-override")"
      else
        HEAD_VAL="$(git rev-parse HEAD 2>/dev/null)"
      fi
      jq --arg h "$HEAD_VAL" '.headRefOid = $h' "$FILE"
      exit 0
      ;;
    *headRefOid*)
      # pr_verify_head's own re-query (--json headRefOid only)
      if [ -f "$GH_MOCK_DIR/head-override" ]; then
        HEAD_VAL="$(cat "$GH_MOCK_DIR/head-override")"
      else
        HEAD_VAL="$(git rev-parse HEAD 2>/dev/null)"
      fi
      printf '{"headRefOid":"%s"}' "$HEAD_VAL"
      exit 0
      ;;
    *mergeStateStatus*baseRefName*)
      # condition-0 pre-reconcile query
      cat "$GH_MOCK_DIR/pre.json"
      exit 0
      ;;
  esac
fi
echo "unhandled gh invocation: $*" >&2
exit 1
EOF
chmod +x "$MOCKBIN/gh"
export PATH="$MOCKBIN:$PATH"

empty_rollup() { rollup_json '[]'; }

# --- Case 1: CI green (empty rollup), CLEAN -> PASS -------------------------
REPO="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
printf '{"mergeStateStatus":"CLEAN","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
empty_rollup > "$GH_MOCK_DIR/rollup.json"
merge_json "MERGEABLE" "CLEAN" "null" > "$GH_MOCK_DIR/merge.json"
OUT="$("$SCRIPT" "$REPO" "some-branch" 2>&1)"; RC=$?
check "CLEAN exits 0" "$RC" "0"
has "CLEAN prints PASS" "$OUT" "PASS"

# --- Case 2: DIRTY (a real conflict — the HEL-412/HEL-703 incident shape) ---
REPO2="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
printf '{"mergeStateStatus":"DIRTY","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
empty_rollup > "$GH_MOCK_DIR/rollup.json"
merge_json "MERGEABLE" "DIRTY" "null" > "$GH_MOCK_DIR/merge.json"
OUT2="$("$SCRIPT" "$REPO2" "some-branch" 2>&1)"; RC2=$?
check "DIRTY exits 1 (never claims clean)" "$RC2" "1"
has "DIRTY names the actual status" "$OUT2" "FAIL not mergeable: DIRTY"

# --- Case 3: CONFLICTING (mergeable field itself, not mergeStateStatus) -----
REPO3="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
printf '{"mergeStateStatus":"UNKNOWN","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
empty_rollup > "$GH_MOCK_DIR/rollup.json"
merge_json "CONFLICTING" "UNKNOWN" "null" > "$GH_MOCK_DIR/merge.json"
OUT3="$("$SCRIPT" "$REPO3" "some-branch" 2>&1)"; RC3=$?
check "CONFLICTING exits 1" "$RC3" "1"
has "CONFLICTING names the mergeable field, not just mergeStateStatus" "$OUT3" "FAIL not mergeable: CONFLICTING"

# --- Case 4: BLOCKED with review required -----------------------------------
REPO4="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
printf '{"mergeStateStatus":"BLOCKED","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
empty_rollup > "$GH_MOCK_DIR/rollup.json"
merge_json "MERGEABLE" "BLOCKED" "REVIEW_REQUIRED" > "$GH_MOCK_DIR/merge.json"
OUT4="$("$SCRIPT" "$REPO4" "some-branch" 2>&1)"; RC4=$?
check "BLOCKED+REVIEW_REQUIRED exits 1" "$RC4" "1"
has "BLOCKED+REVIEW_REQUIRED names branch protection" "$OUT4" "branch protection requires human review"

# --- Case 5: UNKNOWN mergeability forever -> fails closed, not a pass ------
REPO5="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
printf '{"mergeStateStatus":"UNKNOWN","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
empty_rollup > "$GH_MOCK_DIR/rollup.json"
merge_json "UNKNOWN" "UNKNOWN" "null" > "$GH_MOCK_DIR/merge.json"
OUT5="$("$SCRIPT" "$REPO5" "some-branch" 2>&1)"; RC5=$?
check "UNKNOWN timeout exits 1 (never silently passes)" "$RC5" "1"
has "UNKNOWN timeout names the state" "$OUT5" "mergeability not yet determined"

# --- Case 6: gh unauthenticated/unreachable -> distinct environmental wording
REPO6="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
export GH_MOCK_FAIL=1
OUT6="$("$SCRIPT" "$REPO6" "some-branch" 2>&1)"; RC6=$?
unset GH_MOCK_FAIL
check "gh failure exits 1" "$RC6" "1"
has "gh failure worded distinctly from a real conflict" "$OUT6" "could not query"

# --- Case 7: CI still pending after the wait window -> PENDING, exit 3 -----
# (never a silent pass, and distinct from a hard FAIL — CON-159 shape).
REPO7="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
printf '{"mergeStateStatus":"UNKNOWN","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
rollup_json '[{"name":"backend","conclusion":""}]' > "$GH_MOCK_DIR/rollup.json"
merge_json "MERGEABLE" "CLEAN" "null" > "$GH_MOCK_DIR/merge.json"
OUT7="$("$SCRIPT" "$REPO7" "some-branch" 2>&1)"; RC7=$?
check "pending CI exits 3 (re-invoke, not a failure)" "$RC7" "3"
has "pending CI reports PENDING" "$OUT7" "PENDING"

# --- Case 8: a real required CI job fails -> FAIL, not a mergeable-only view
REPO8="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
printf '{"mergeStateStatus":"UNKNOWN","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
rollup_json '[{"name":"backend","conclusion":"FAILURE"}]' > "$GH_MOCK_DIR/rollup.json"
merge_json "MERGEABLE" "CLEAN" "null" > "$GH_MOCK_DIR/merge.json"
OUT8="$("$SCRIPT" "$REPO8" "some-branch" 2>&1)"; RC8=$?
check "failed required CI job exits 1" "$RC8" "1"
has "failed CI names the job" "$OUT8" "CI failed: backend"

# --- Case 9: CI eventually resolves across polls (exercises the poll loop,
# not a timeout=0 single-shot) — rollup-1 pending, rollup-2 green.
REPO9="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
printf '{"mergeStateStatus":"CLEAN","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
rollup_json '[{"name":"backend","conclusion":""}]' > "$GH_MOCK_DIR/rollup-1.json"
rollup_json '[{"name":"backend","conclusion":"SUCCESS"}]' > "$GH_MOCK_DIR/rollup.json"
merge_json "MERGEABLE" "CLEAN" "null" > "$GH_MOCK_DIR/merge.json"
CONCERTINO_CI_WAIT_TIMEOUT_SEC=30 CONCERTINO_CI_POLL_INTERVAL_SEC=1 \
  OUT9="$("$SCRIPT" "$REPO9" "some-branch" 2>&1)"; RC9=$?
check "CI resolves across a real poll -> exits 0" "$RC9" "0"
has "CI resolves across a real poll -> PASS" "$OUT9" "PASS"

# --- Case 10: BEHIND is actually reconciled (real fetch+merge+push), then
# passes on the reconciled HEAD — exercises lib/pr-reconcile.sh for real,
# not just the failure branches.
REPO10="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
git -C "$REPO10" checkout -q -b bug/some-ticket/CON-999
echo "ticket" > "$REPO10/ticket.txt"
git -C "$REPO10" add -A
git -C "$REPO10" -c user.email=t@t.test -c user.name=t commit -q -m "ticket commit"
# Base advances on the real origin remote after the branch diverged.
SIBLING="$(mktemp -d)"; CLEANUP_DIRS+=("$SIBLING")
git clone -q "$(git -C "$REPO10" remote get-url origin)" "$SIBLING"
echo "sibling" > "$SIBLING/sibling.txt"
git -C "$SIBLING" add -A
git -C "$SIBLING" -c user.email=t@t.test -c user.name=t commit -q -m "sibling merge"
git -C "$SIBLING" push -q origin main
printf '{"mergeStateStatus":"BEHIND","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
empty_rollup > "$GH_MOCK_DIR/rollup.json"
merge_json "MERGEABLE" "CLEAN" "null" > "$GH_MOCK_DIR/merge.json"
# The real reconcile does `git push origin HEAD:some-branch` — origin needs
# that ref to exist for a real push to be meaningful; git allows creating it.
OUT10="$("$SCRIPT" "$REPO10" "some-branch" 2>&1)"; RC10=$?
check "BEHIND is actually reconciled then passes" "$RC10" "0"
has "reconcile result prints PASS" "$OUT10" "PASS"
MERGED_LOG="$(git -C "$REPO10" log --oneline -3)"
has "the branch actually contains the sibling's merge after reconcile" "$MERGED_LOG" "sibling merge"

# --- Case 11 (CON-122 cycle 3, MEDIUM finding 4): a CLEAN mergeable read for
# a head that ISN'T actually local HEAD (e.g. GitHub's read-after-push lag
# right after this script's own reconcile push in condition 0, still
# reflecting the PRE-push head) must NOT be trusted — this is exactly the
# gap check-merge-readiness.sh's condition 2b already closes for the
# agent-merge path via lib/pr-reconcile.sh's pr_verify_head.
REPO11="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
printf '{"mergeStateStatus":"CLEAN","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
empty_rollup > "$GH_MOCK_DIR/rollup.json"
merge_json "MERGEABLE" "CLEAN" "null" > "$GH_MOCK_DIR/merge.json"
# Force every headRefOid query (both the mergeable query and pr_verify_head's
# own re-query) to report a SHA that is NOT this worktree's real HEAD —
# simulating GitHub still reporting the pre-push head.
echo "0000000000000000000000000000000000000000" > "$GH_MOCK_DIR/head-override"
OUT11="$("$SCRIPT" "$REPO11" "some-branch" 2>&1)"; RC11=$?
check "stale headRefOid (never matches local HEAD) exits 1, never a false PASS" "$RC11" "1"
has "stale headRefOid names the mismatch" "$OUT11" "does not match the pull request's head"

# --- Case 12 (CON-122 cycle 3, LOW finding 5): UNKNOWN mergeability
# resolves to CLEAN across a REAL poll (a nonzero recheck timeout/interval,
# using the mock's merge-N.json per-call sequencing) — case "UNKNOWN
# timeout" above only proves the timeout path with
# CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC=0 (a single shot), which cannot
# distinguish "polls and recovers" from "never actually polls at all".
REPO12="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; CLEANUP_DIRS+=("$GH_MOCK_DIR"); export GH_MOCK_DIR
printf '{"mergeStateStatus":"CLEAN","baseRefName":"main"}' > "$GH_MOCK_DIR/pre.json"
empty_rollup > "$GH_MOCK_DIR/rollup.json"
merge_json "UNKNOWN" "UNKNOWN" "null" > "$GH_MOCK_DIR/merge-1.json"
merge_json "MERGEABLE" "CLEAN" "null" > "$GH_MOCK_DIR/merge.json"
CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC=30 CONCERTINO_MERGE_RECHECK_INTERVAL_SEC=1 \
  OUT12="$("$SCRIPT" "$REPO12" "some-branch" 2>&1)"; RC12=$?
check "UNKNOWN resolves to CLEAN across a real poll -> exits 0" "$RC12" "0"
has "UNKNOWN resolves to CLEAN across a real poll -> PASS" "$OUT12" "PASS"

echo "check-pr-mergeable.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
