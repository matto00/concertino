#!/usr/bin/env bash
# Shell tests for scripts/concertino/check-merge-readiness.sh (CON-24
# agent-merge-role): the three deterministic merge-readiness conditions the
# auditor relies on before it ever runs `gh pr merge`.
#
# `gh` is stubbed with a minimal fake on PATH so these tests never touch the
# network or a real PR — see mock_gh() below. All git/event-log state is a
# throwaway scratch repo, never this checkout's own.
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/check-merge-readiness.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }
has()  { if grep -qF "$2" "$3" 2>/dev/null; then ok "$1"; else bad "$1" "expected to find [$2] in $3"; fi; }

echo "check-merge-readiness.sh (CON-24 agent-merge-role)"

# A throwaway repo standing in for both the "worktree" and "main checkout" —
# check-merge-readiness.sh only ever needs a git-common-dir to resolve from,
# and a single non-worktree checkout resolves to itself, same as it would
# from the main checkout in a real delivery.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q -b main
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  printf '%s' "$d"
}

# A minimal `gh pr view` stub. Serves $GH_MOCK_DIR/rollup.json for the
# statusCheckRollup call and $GH_MOCK_DIR/merge.json for the
# mergeable/mergeStateStatus/reviewDecision call, based on which --json
# fields were requested — or fails outright when $GH_MOCK_FAIL is set, to
# simulate an unauthenticated/unreachable `gh`.
MOCKBIN="$(mktemp -d)"
cat > "$MOCKBIN/gh" <<'EOF'
#!/usr/bin/env bash
if [ -n "${GH_MOCK_FAIL:-}" ]; then
  echo "gh: mock failure: $GH_MOCK_FAIL" >&2
  exit 1
fi
for a in "$@"; do
  case "$a" in
    *statusCheckRollup*) cat "$GH_MOCK_DIR/rollup.json"; exit 0 ;;
    *mergeStateStatus*)  cat "$GH_MOCK_DIR/merge.json"; exit 0 ;;
  esac
done
echo '{}'
EOF
chmod +x "$MOCKBIN/gh"
export PATH="$MOCKBIN:$PATH"

write_events() {
  # $1 = repo, $2 = ticket, $3.. = lines to write verbatim
  local repo="$1" ticket="$2"; shift 2
  local dir="$repo/.concertino/runs/$ticket"
  mkdir -p "$dir"
  printf '%s\n' "$@" > "$dir/events.jsonl"
}

ALL_PASS_ROLLUP='{"statusCheckRollup":[{"name":"build","conclusion":"SUCCESS"},{"name":"lint","conclusion":"SUCCESS"}]}'
CLEAN_MERGE='{"mergeable":"MERGEABLE","mergeStateStatus":"CLEAN","reviewDecision":null}'
EVAL_PASS='{"t":1,"kind":"verdict","role":"evaluator","verdict":"PASS"}'
SKEPTIC_CONFIRM='{"t":2,"kind":"verdict","role":"skeptic","verdict":"CONFIRM"}'

run_check() {
  # $1 = repo, $2 = branch, $3 = ticket ; result on stdout, stderr captured to $ERR
  local repo="$1" branch="$2" ticket="$3"
  ERR="$(mktemp)"
  OUT="$("$SCRIPT" "$repo" "$branch" "$ticket" 2>"$ERR")"
  RC=$?
}

# --- all three conditions pass ----------------------------------------------
REPO="$(new_repo)"
write_events "$REPO" TEST-1 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-1 TEST-1
check "1.1 all-pass exits zero" "$RC" "0"
check "1.2 all-pass prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- a pending CI check is distinct from a failed one -----------------------
REPO="$(new_repo)"
write_events "$REPO" TEST-2 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","state":"PENDING"},{"name":"lint","conclusion":"SUCCESS"}]}' > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-2 TEST-2
check "2.1 pending CI fails (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
has "2.2 pending CI names the check as pending, not failed" "CI pending: build" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- a failed CI check is reported distinctly from pending ------------------
REPO="$(new_repo)"
write_events "$REPO" TEST-3 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","conclusion":"FAILURE"}]}' > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-3 TEST-3
has "3.1 failed CI names the check as failed, not pending" "CI failed: build" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- an empty rollup passes the CI check ------------------------------------
REPO="$(new_repo)"
write_events "$REPO" TEST-4 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[]}' > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-4 TEST-4
check "4.1 empty rollup passes overall" "$RC" "0"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- BEHIND/DIRTY fail naming the status ------------------------------------
for status in BEHIND DIRTY UNSTABLE; do
  REPO="$(new_repo)"
  # Ticket ids must end in a digit (looks_like_ticket) — a numeric suffix per
  # status keeps each iteration's ticket distinct and valid.
  case "$status" in BEHIND) TICKET=TEST-51;; DIRTY) TICKET=TEST-52;; UNSTABLE) TICKET=TEST-53;; esac
  write_events "$REPO" "$TICKET" "$EVAL_PASS" "$SKEPTIC_CONFIRM"
  GH_MOCK_DIR="$(mktemp -d)"
  printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
  printf '{"mergeable":"CONFLICTING","mergeStateStatus":"%s","reviewDecision":null}' "$status" > "$GH_MOCK_DIR/merge.json"
  export GH_MOCK_DIR
  run_check "$REPO" branch-5 "$TICKET"
  has "5.$status not mergeable names the status" "not mergeable: $status" "$ERR"
  rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"
done

# --- BLOCKED + REVIEW_REQUIRED names branch protection specifically ---------
REPO="$(new_repo)"
write_events "$REPO" TEST-6 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '%s' '{"mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED","reviewDecision":"REVIEW_REQUIRED"}' > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-6 TEST-6
has "6.1 BLOCKED+REVIEW_REQUIRED names branch protection specifically" "branch protection requires human review" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- BLOCKED without REVIEW_REQUIRED falls back to a generic reason ---------
REPO="$(new_repo)"
write_events "$REPO" TEST-7 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '%s' '{"mergeable":"MERGEABLE","mergeStateStatus":"BLOCKED","reviewDecision":"APPROVED"}' > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-7 TEST-7
has "7.1 BLOCKED without REVIEW_REQUIRED names BLOCKED generically" "not mergeable: BLOCKED" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- UNKNOWN / DRAFT / unenumerated fail CLOSED, never pass silently --------
for status in UNKNOWN DRAFT SOMETHING_NEW; do
  REPO="$(new_repo)"
  TICKET="TEST-8"
  case "$status" in UNKNOWN) TICKET=TEST-81;; DRAFT) TICKET=TEST-82;; SOMETHING_NEW) TICKET=TEST-83;; esac
  write_events "$REPO" "$TICKET" "$EVAL_PASS" "$SKEPTIC_CONFIRM"
  GH_MOCK_DIR="$(mktemp -d)"
  printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
  printf '{"mergeable":"UNKNOWN","mergeStateStatus":"%s","reviewDecision":null}' "$status" > "$GH_MOCK_DIR/merge.json"
  export GH_MOCK_DIR
  run_check "$REPO" branch-8 "$TICKET"
  check "8.$status fails closed (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
  has "8.$status names mergeability as not yet determined" "mergeability not yet determined: $status" "$ERR"
  rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"
done

# --- missing evaluator PASS / skeptic CONFIRM fail the gates check ----------
REPO="$(new_repo)"
write_events "$REPO" TEST-9 '{"t":1,"kind":"verdict","role":"evaluator","verdict":"FAIL"}' "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-9 TEST-9
has "9.1 non-PASS evaluator verdict fails, naming the gate" "evaluator gate not passed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

REPO="$(new_repo)"
write_events "$REPO" TEST-10 "$EVAL_PASS" '{"t":2,"kind":"verdict","role":"skeptic","verdict":"REFUTE"}'
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-10 TEST-10
has "10.1 non-CONFIRM skeptic verdict fails, naming the gate" "skeptic gate not confirmed" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- "latest" verdict wins even when an earlier one would have failed ------
REPO="$(new_repo)"
write_events "$REPO" TEST-11 \
  '{"t":1,"kind":"verdict","role":"evaluator","verdict":"FAIL"}' \
  '{"t":2,"kind":"verdict","role":"evaluator","verdict":"PASS"}' \
  "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-11 TEST-11
check "11.1 latest evaluator verdict (PASS) wins over an earlier FAIL" "$RC" "0"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- a malformed line in the log is skipped, not fatal ----------------------
REPO="$(new_repo)"
mkdir -p "$REPO/.concertino/runs/TEST-12"
printf '%s\n%s\n%s\n' "$EVAL_PASS" "not valid json at all" "$SKEPTIC_CONFIRM" > "$REPO/.concertino/runs/TEST-12/events.jsonl"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-12 TEST-12
check "12.1 a torn line elsewhere in the log does not blind the check" "$RC" "0"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

# --- an environmental gh failure is worded distinctly -----------------------
REPO="$(new_repo)"
write_events "$REPO" TEST-13 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
export GH_MOCK_DIR
export GH_MOCK_FAIL="not authenticated"
run_check "$REPO" branch-13 TEST-13
has "13.1 a gh failure is worded 'could not query ... via gh'" "could not query PR status via gh" "$ERR"
unset GH_MOCK_FAIL
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
