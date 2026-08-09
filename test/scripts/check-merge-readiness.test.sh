#!/usr/bin/env bash
# Shell tests for scripts/concertino/check-merge-readiness.sh (CON-24
# agent-merge-role, extended for the CI-wait / BEHIND-reconcile hotfix): the
# deterministic merge-readiness conditions the auditor relies on before it
# ever runs `gh pr merge`.
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

echo "check-merge-readiness.sh (CON-24 agent-merge-role + CI-wait/BEHIND-reconcile hotfix)"

# Keep every test that doesn't specifically exercise polling instant: a
# zero timeout still runs one query (elapsed(0) >= timeout(0) is checked
# AFTER that query), so a still-pending/still-UNKNOWN state fails on the
# first look, exactly like the script's pre-hotfix single-shot behavior.
# Tests that exercise real polling override these locally and restore them
# afterward.
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=0
export CONCERTINO_CI_POLL_INTERVAL_SEC=1
export CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC=0
export CONCERTINO_MERGE_RECHECK_INTERVAL_SEC=1

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

# A `gh pr view` stub. Serves $GH_MOCK_DIR/rollup.json for the
# statusCheckRollup call and $GH_MOCK_DIR/merge.json for the
# mergeable/mergeStateStatus/reviewDecision/baseRefName call, based on which
# --json fields were requested — or fails outright when $GH_MOCK_FAIL is
# set, to simulate an unauthenticated/unreachable `gh`. Each call is
# counted per field-set ($GH_MOCK_DIR/rollupcalls, .../mergecalls); if a
# numbered override file (rollup-<n>.json / merge-<n>.json) exists for that
# call's ordinal, it is served instead of the static default — this is how
# tests simulate state changing across the script's own poll loop (pending
# -> success, BEHIND -> CLEAN after reconcile) without touching the network.
MOCKBIN="$(mktemp -d)"
cat > "$MOCKBIN/gh" <<'EOF'
#!/usr/bin/env bash
if [ -n "${GH_MOCK_FAIL:-}" ]; then
  echo "gh: mock failure: $GH_MOCK_FAIL" >&2
  exit 1
fi
for a in "$@"; do
  case "$a" in
    *statusCheckRollup*)
      n=0; [ -f "$GH_MOCK_DIR/rollupcalls" ] && n="$(cat "$GH_MOCK_DIR/rollupcalls")"
      n=$((n+1)); echo "$n" > "$GH_MOCK_DIR/rollupcalls"
      if [ -f "$GH_MOCK_DIR/rollup-$n.json" ]; then cat "$GH_MOCK_DIR/rollup-$n.json"; else cat "$GH_MOCK_DIR/rollup.json"; fi
      exit 0
      ;;
    *mergeStateStatus*)
      n=0; [ -f "$GH_MOCK_DIR/mergecalls" ] && n="$(cat "$GH_MOCK_DIR/mergecalls")"
      n=$((n+1)); echo "$n" > "$GH_MOCK_DIR/mergecalls"
      if [ -f "$GH_MOCK_DIR/merge-$n.json" ]; then cat "$GH_MOCK_DIR/merge-$n.json"; else cat "$GH_MOCK_DIR/merge.json"; fi
      exit 0
      ;;
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

# --- a pending CI check is distinct from a failed one, and times out named -
REPO="$(new_repo)"
write_events "$REPO" TEST-2 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","state":"PENDING"},{"name":"lint","conclusion":"SUCCESS"}]}' > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-2 TEST-2
check "2.1 pending CI fails (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
has "2.2 pending CI names the check as pending, not failed, with the timeout" "CI pending after 0s: build" "$ERR"
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

# --- DIRTY/UNSTABLE fail naming the status (BEHIND now auto-reconciles —
# covered separately below, since it now has real git-mutating side effects
# rather than a simple named failure) --------------------------------------
for status in DIRTY UNSTABLE; do
  REPO="$(new_repo)"
  case "$status" in DIRTY) TICKET=TEST-52;; UNSTABLE) TICKET=TEST-53;; esac
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

# --- DRAFT / unenumerated fail CLOSED immediately, never pass silently -----
# (UNKNOWN is now polled as a transient state — covered separately below.)
for status in DRAFT SOMETHING_NEW; do
  REPO="$(new_repo)"
  case "$status" in DRAFT) TICKET=TEST-82;; SOMETHING_NEW) TICKET=TEST-83;; esac
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

# --- UNKNOWN mergeability times out named, when it never resolves ----------
REPO="$(new_repo)"
write_events "$REPO" TEST-84 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '{"mergeable":"UNKNOWN","mergeStateStatus":"UNKNOWN","reviewDecision":null}' > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-8 TEST-84
has "8.4 UNKNOWN mergeability names the timeout" "mergeability not yet determined: UNKNOWN (timed out after 0s)" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"

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

# --- CI genuinely polls: pending on the first look, SUCCESS on a later one -
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=5
export CONCERTINO_CI_POLL_INTERVAL_SEC=1
REPO="$(new_repo)"
write_events "$REPO" TEST-14 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","state":"IN_PROGRESS"}]}' > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup-2.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-14 TEST-14
check "14.1 CI that flips IN_PROGRESS->SUCCESS across a poll passes" "$RC" "0"
check "14.2 CI that flips IN_PROGRESS->SUCCESS prints PASS" "$OUT" "PASS"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=0
export CONCERTINO_CI_POLL_INTERVAL_SEC=1

# --- CI that never resolves genuinely times out (not just skipped) ---------
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=2
export CONCERTINO_CI_POLL_INTERVAL_SEC=1
REPO="$(new_repo)"
write_events "$REPO" TEST-15 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' '{"statusCheckRollup":[{"name":"build","state":"IN_PROGRESS"}]}' > "$GH_MOCK_DIR/rollup.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$REPO" branch-15 TEST-15
has "15.1 CI stuck pending past the timeout names it, after really waiting" "CI pending after 2s: build" "$ERR"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"
export CONCERTINO_CI_WAIT_TIMEOUT_SEC=0
export CONCERTINO_CI_POLL_INTERVAL_SEC=1

# --- mergeability genuinely polls: UNKNOWN then CLEAN across a poll --------
export CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC=5
export CONCERTINO_MERGE_RECHECK_INTERVAL_SEC=1
REPO="$(new_repo)"
write_events "$REPO" TEST-16 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '{"mergeable":"UNKNOWN","mergeStateStatus":"UNKNOWN","reviewDecision":null}' > "$GH_MOCK_DIR/merge.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge-2.json"
export GH_MOCK_DIR
run_check "$REPO" branch-16 TEST-16
check "16.1 mergeability that flips UNKNOWN->CLEAN across a poll passes" "$RC" "0"
rm -rf "$REPO" "$GH_MOCK_DIR" "$ERR"
export CONCERTINO_MERGE_RECHECK_TIMEOUT_SEC=0
export CONCERTINO_MERGE_RECHECK_INTERVAL_SEC=1

# --- BEHIND auto-reconcile: real fetch+merge+push, current work preserved,
# new remote changes land, mergeability re-verified CLEAN on the new HEAD --
ORIGIN="$(mktemp -d)"
git init -q --bare -b main "$ORIGIN"

SEED="$(mktemp -d)"
git init -q -b main "$SEED"
git -C "$SEED" config user.email t@t.test; git -C "$SEED" config user.name t
echo "line1" > "$SEED/shared.txt"
git -C "$SEED" add shared.txt
git -C "$SEED" commit -q -m "main: init"
git -C "$SEED" remote add origin "$ORIGIN"
git -C "$SEED" push -q origin main

WORK="$(mktemp -d)"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.test; git -C "$WORK" config user.name t
git -C "$WORK" checkout -q -b feature-behind
echo "feature work" > "$WORK/feature.txt"
git -C "$WORK" add feature.txt
git -C "$WORK" commit -q -m "feature: current work"
git -C "$WORK" push -q origin feature-behind
FEATURE_TIP_BEFORE="$(git -C "$WORK" rev-parse feature-behind)"

# main advances upstream (a different PR merged) while feature-behind was in flight
echo "line2" >> "$SEED/other.txt"
git -C "$SEED" add other.txt
git -C "$SEED" commit -q -m "main: advanced"
git -C "$SEED" push -q origin main

write_events "$WORK" TEST-17 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '{"mergeStateStatus":"BEHIND","baseRefName":"main"}' > "$GH_MOCK_DIR/merge.json"
printf '%s' "$CLEAN_MERGE" > "$GH_MOCK_DIR/merge-2.json"
export GH_MOCK_DIR
run_check "$WORK" feature-behind TEST-17
check "17.1 BEHIND auto-reconcile ends up mergeable (PASS)" "$OUT" "PASS"
check "17.2 BEHIND auto-reconcile exits zero" "$RC" "0"
FEATURE_LOG="$(git -C "$WORK" log feature-behind --oneline)"
has "17.3 current work commit still present after reconcile" "feature: current work" <(printf '%s\n' "$FEATURE_LOG")
has "17.4 remote's new commit landed after reconcile" "main: advanced" <(printf '%s\n' "$FEATURE_LOG")
ORIGIN_LOG="$(git --git-dir="$ORIGIN" log feature-behind --oneline)"
has "17.5 reconciled branch was pushed back to origin" "main: advanced" <(printf '%s\n' "$ORIGIN_LOG")
rm -rf "$ORIGIN" "$SEED" "$WORK" "$GH_MOCK_DIR" "$ERR"

# --- BEHIND auto-reconcile: a genuine conflict aborts cleanly, current work
# and origin both left exactly as they were, ESCALATE reason names it ------
ORIGIN="$(mktemp -d)"
git init -q --bare -b main "$ORIGIN"

SEED="$(mktemp -d)"
git init -q -b main "$SEED"
git -C "$SEED" config user.email t@t.test; git -C "$SEED" config user.name t
echo "line1" > "$SEED/shared.txt"
git -C "$SEED" add shared.txt
git -C "$SEED" commit -q -m "main: init"
git -C "$SEED" remote add origin "$ORIGIN"
git -C "$SEED" push -q origin main

WORK="$(mktemp -d)"
git clone -q "$ORIGIN" "$WORK"
git -C "$WORK" config user.email t@t.test; git -C "$WORK" config user.name t
git -C "$WORK" checkout -q -b feature-conflict
echo "feature version" > "$WORK/shared.txt"
git -C "$WORK" add shared.txt
git -C "$WORK" commit -q -m "feature: current work"
git -C "$WORK" push -q origin feature-conflict
FEATURE_TIP_BEFORE="$(git -C "$WORK" rev-parse feature-conflict)"
ORIGIN_TIP_BEFORE="$(git --git-dir="$ORIGIN" rev-parse feature-conflict)"

# main advances the SAME line — a real, unresolvable-without-a-human conflict
echo "main version" > "$SEED/shared.txt"
git -C "$SEED" add shared.txt
git -C "$SEED" commit -q -m "main: advanced, conflicting"
git -C "$SEED" push -q origin main

write_events "$WORK" TEST-18 "$EVAL_PASS" "$SKEPTIC_CONFIRM"
GH_MOCK_DIR="$(mktemp -d)"
printf '%s' "$ALL_PASS_ROLLUP" > "$GH_MOCK_DIR/rollup.json"
printf '{"mergeStateStatus":"BEHIND","baseRefName":"main"}' > "$GH_MOCK_DIR/merge.json"
export GH_MOCK_DIR
run_check "$WORK" feature-conflict TEST-18
check "18.1 BEHIND with a real conflict fails (non-zero exit)" "$([ "$RC" -ne 0 ] && echo nonzero || echo zero)" "nonzero"
has "18.2 conflict names BEHIND and the need for human resolution" "not mergeable: BEHIND (auto-reconcile with origin/main hit conflicts" "$ERR"
FEATURE_TIP_AFTER="$(git -C "$WORK" rev-parse feature-conflict)"
check "18.3 current work's branch tip is untouched after an aborted reconcile" "$FEATURE_TIP_AFTER" "$FEATURE_TIP_BEFORE"
check "18.4 the aborted merge leaves no in-progress merge state" "$([ -f "$WORK/.git/MERGE_HEAD" ] && echo present || echo absent)" "absent"
ORIGIN_TIP_AFTER="$(git --git-dir="$ORIGIN" rev-parse feature-conflict)"
check "18.5 origin's branch ref is untouched (no partial push)" "$ORIGIN_TIP_AFTER" "$ORIGIN_TIP_BEFORE"
rm -rf "$ORIGIN" "$SEED" "$WORK" "$GH_MOCK_DIR" "$ERR"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
