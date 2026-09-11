#!/usr/bin/env bash
# Shell tests for scripts/concertino/check-pr-mergeable.sh (CON-122):
# the orchestrator's Delivery-phase pre-present mergeable check for the
# human-merge (AGENT_MERGE=false) path.
#
# `gh` is stubbed with a minimal fake on PATH so these tests never touch the
# network or a real PR. All git state is a throwaway scratch repo.
set -uo pipefail

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

new_repo() {
  local d o
  d="$(mktemp -d)"
  o="$d/.origin-bare"
  git init -q --bare -b main "$o"
  git init -q -b main "$d"
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  git -C "$d" remote add origin "$o"
  git -C "$d" push -q origin main
  printf '%s' "$d"
}

# $1=mergeStateStatus $2=reviewDecision("null" or a string)
merge_json() {
  local rd="$2"
  if [ "$rd" != "null" ]; then rd="\"$rd\""; fi
  printf '{"mergeable":"UNKNOWN","mergeStateStatus":"%s","reviewDecision":%s,"baseRefName":"main"}' "$1" "$rd"
}

MOCKBIN="$(mktemp -d)"
cat > "$MOCKBIN/gh" <<'EOF'
#!/usr/bin/env bash
if [ -n "${GH_MOCK_FAIL:-}" ]; then
  echo "gh: authentication failed" >&2
  exit 1
fi
if [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  n_file="$GH_MOCK_DIR/mergecalls"
  n=0
  [ -f "$n_file" ] && n="$(cat "$n_file")"
  n=$((n+1))
  echo "$n" > "$n_file"
  if [ -f "$GH_MOCK_DIR/merge-$n.json" ]; then
    cat "$GH_MOCK_DIR/merge-$n.json"
  else
    cat "$GH_MOCK_DIR/merge.json"
  fi
  exit 0
fi
echo "unhandled gh invocation: $*" >&2
exit 1
EOF
chmod +x "$MOCKBIN/gh"
export PATH="$MOCKBIN:$PATH"

# --- Case 1: CLEAN -> PASS --------------------------------------------------
REPO="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; export GH_MOCK_DIR
merge_json "CLEAN" "null" > "$GH_MOCK_DIR/merge.json"
OUT="$("$SCRIPT" "$REPO" "some-branch" 2>&1)"; RC=$?
check "CLEAN exits 0" "$RC" "0"
has "CLEAN prints PASS" "$OUT" "PASS"

# --- Case 2: DIRTY (a real conflict — the HEL-412/HEL-703 incident shape) ---
REPO2="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; export GH_MOCK_DIR
merge_json "DIRTY" "null" > "$GH_MOCK_DIR/merge.json"
OUT2="$("$SCRIPT" "$REPO2" "some-branch" 2>&1)"; RC2=$?
check "DIRTY exits 1 (never claims clean)" "$RC2" "1"
has "DIRTY names the actual status" "$OUT2" "FAIL not mergeable: DIRTY"

# --- Case 3: CONFLICTING-shaped BLOCKED with review required ---------------
REPO3="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; export GH_MOCK_DIR
merge_json "BLOCKED" "REVIEW_REQUIRED" > "$GH_MOCK_DIR/merge.json"
OUT3="$("$SCRIPT" "$REPO3" "some-branch" 2>&1)"; RC3=$?
check "BLOCKED+REVIEW_REQUIRED exits 1" "$RC3" "1"
has "BLOCKED+REVIEW_REQUIRED names branch protection" "$OUT3" "branch protection requires human review"

# --- Case 4: UNKNOWN forever (never resolves) -> fails closed, not a pass --
REPO4="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; export GH_MOCK_DIR
merge_json "UNKNOWN" "null" > "$GH_MOCK_DIR/merge.json"
OUT4="$("$SCRIPT" "$REPO4" "some-branch" 2>&1)"; RC4=$?
check "UNKNOWN timeout exits 1 (never silently passes)" "$RC4" "1"
has "UNKNOWN timeout names the state" "$OUT4" "mergeability not yet determined"

# --- Case 5: gh unauthenticated/unreachable -> distinct environmental wording
REPO5="$(new_repo)"
GH_MOCK_DIR="$(mktemp -d)"; export GH_MOCK_DIR
export GH_MOCK_FAIL=1
OUT5="$("$SCRIPT" "$REPO5" "some-branch" 2>&1)"; RC5=$?
unset GH_MOCK_FAIL
check "gh failure exits 1" "$RC5" "1"
has "gh failure worded distinctly from a real conflict" "$OUT5" "could not query PR status via gh"

rm -rf "$REPO" "$REPO2" "$REPO3" "$REPO4" "$REPO5" "$MOCKBIN"

echo "check-pr-mergeable.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
