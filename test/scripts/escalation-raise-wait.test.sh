#!/usr/bin/env bash
# CON-76: tests for emit-event.sh's --raise-only and --wait-only escalation
# modes (design.md Decisions 1/1a/1b/1c/2). --await's own unchanged behavior
# is already covered by test/scripts/emit-event.test.sh and
# test/scripts/escalation-loop.test.sh — this file covers only the two new
# modes and their interaction with a dashboard-style answer writer.
set -uo pipefail

# See emit-event.test.sh's own header comment for why job control must be on
# for a TERM/INT-kill test run from inside a non-interactive script.
set -m

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/emit-event.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" commit -q --allow-empty -m init
  printf '%s' "$d"
}

write_answer() {
  # Exercises the real dashboard writer, not a hand-rolled stand-in — same
  # module watch.js calls when a human presses an option key.
  node -e '
    const store = require(process.argv[1]);
    const result = store.writeAnswer(process.argv[2], process.argv[3], process.argv[4]);
    console.log(JSON.stringify(result));
  ' "$ROOT/lib/ui/store.js" "$1" "$2" "$3"
}

echo "emit-event.sh --raise-only / --wait-only (CON-76)"

# --- --raise-only writes escalation.raised and returns immediately ---------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-400/events.jsonl"
START=$(date +%s)
( cd "$REPO" && "$SCRIPT" escalation --raise-only \
    ticket=HEL-400 role=orchestrator question=q options=approve,deny ) \
  > "$REPO/out.txt" 2>"$REPO/err.txt"
RC=$?
ELAPSED=$(( $(date +%s) - START ))
check "--raise-only exits 0"                    "$RC" "0"
check "--raise-only returned immediately"        "$([ "$ELAPSED" -le 3 ] && echo yes || echo no)" "yes"
check "--raise-only wrote escalation.raised"     "$(grep -c escalation.raised "$LOG" 2>/dev/null || true)" "1"
check "--raise-only printed nothing to wait on"  "$(cat "$REPO/out.txt")" ""
rm -rf "$REPO"

# --- a single --wait-only call resolves against a dashboard-written answer -
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-401/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --raise-only \
    ticket=HEL-401 role=orchestrator question=q options=approve,deny ) >/dev/null 2>&1
RESULT="$(write_answer "$REPO" HEL-401 approve)"
check "dashboard write succeeded" "$(node -e "console.log(JSON.parse(process.argv[1]).ok)" "$RESULT")" "true"
OUT="$( cd "$REPO" && "$SCRIPT" escalation --wait-only max_wait_sec=5 ticket=HEL-401 )"
RC=$?
check "--wait-only resolves exit 0"        "$RC" "0"
check "--wait-only prints the answer"      "$OUT" "approve"
check "--wait-only recorded escalation.answered" "$(grep -c escalation.answered "$LOG")" "1"
rm -rf "$REPO"

# --- --wait-only returns exit 2 when neither resolved nor timed out --------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-402/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --raise-only \
    ticket=HEL-402 role=orchestrator question=q options=approve,deny ) >/dev/null 2>&1
( cd "$REPO" && "$SCRIPT" escalation --wait-only max_wait_sec=2 ticket=HEL-402 ) >/dev/null 2>&1
RC=$?
check "--wait-only exits 2 when still open"        "$RC" "2"
check "--wait-only recorded no escalation.timeout" "$(grep -c escalation.timeout "$LOG" 2>/dev/null || true)" "0"
check "--wait-only recorded no escalation.answered" "$(grep -c escalation.answered "$LOG" 2>/dev/null || true)" "0"
check "--wait-only did not remove/discard anything" "$(grep -c escalation.answer_discarded "$LOG" 2>/dev/null || true)" "0"
rm -rf "$REPO"

# --- a --wait-only call after the real deadline reports exit 1, even though -
# its own max_wait_sec has not elapsed (design.md Decision 1b/2) ------------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-403/events.jsonl"
( cd "$REPO" && CONCERTINO_ESCALATION_TIMEOUT_MIN=0 "$SCRIPT" escalation --raise-only \
    ticket=HEL-403 role=orchestrator question=q options=approve,deny ) >/dev/null 2>&1
START=$(date +%s)
( cd "$REPO" && CONCERTINO_ESCALATION_TIMEOUT_MIN=0 "$SCRIPT" escalation --wait-only \
    max_wait_sec=25 ticket=HEL-403 ) >/dev/null 2>&1
RC=$?
ELAPSED=$(( $(date +%s) - START ))
check "--wait-only exits 1 once the real deadline is reached" "$RC" "1"
check "--wait-only recorded escalation.timeout"                "$(grep -c escalation.timeout "$LOG")" "1"
check "--wait-only returned well before its own max_wait_sec"  "$([ "$ELAPSED" -le 15 ] && echo yes || echo no)" "yes"
rm -rf "$REPO"

# --- a dashboard answer written BETWEEN two --wait-only calls is picked up -
# by the second call, not discarded as stale leftover state (regression test
# for the Decision 1a defect: the discard check must never repeat) ---------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-404/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --raise-only \
    ticket=HEL-404 role=orchestrator question=q options=approve,deny ) >/dev/null 2>&1
( cd "$REPO" && "$SCRIPT" escalation --wait-only max_wait_sec=1 ticket=HEL-404 ) >/dev/null 2>&1
RC1=$?
check "first --wait-only call exits 2 (nothing answered yet)" "$RC1" "2"
write_answer "$REPO" HEL-404 deny >/dev/null
OUT2="$( cd "$REPO" && "$SCRIPT" escalation --wait-only max_wait_sec=5 ticket=HEL-404 )"
RC2=$?
check "second --wait-only call resolves exit 0"    "$RC2" "0"
check "second call returns the answer, not discarded" "$OUT2" "deny"
check "no escalation.answer_discarded was ever recorded" \
  "$(grep -c escalation.answer_discarded "$LOG" 2>/dev/null || true)" "0"
rm -rf "$REPO"

# --- a --wait-only process killed mid-poll writes no event at all (design.md
# Decision 1c), and a subsequent call resumes normally -----------------------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-405/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --raise-only \
    ticket=HEL-405 role=orchestrator question=q options=approve,deny ) >/dev/null 2>&1
( cd "$REPO" && "$SCRIPT" escalation --wait-only max_wait_sec=30 ticket=HEL-405 ) >/dev/null 2>&1 &
WAIT_PID=$!
for _ in $(seq 1 30); do
  kill -0 "$WAIT_PID" 2>/dev/null && break
  sleep 0.1
done
sleep 0.3
kill -TERM "$WAIT_PID"
wait "$WAIT_PID" 2>/dev/null
check "killed --wait-only wrote no escalation.timeout" \
  "$(grep -c escalation.timeout "$LOG" 2>/dev/null || true)" "0"
check "killed --wait-only wrote no event at all" \
  "$(wc -l < "$LOG" | tr -d ' ')" "1"

write_answer "$REPO" HEL-405 approve >/dev/null
OUT="$( cd "$REPO" && "$SCRIPT" escalation --wait-only max_wait_sec=5 ticket=HEL-405 )"
RC=$?
check "subsequent --wait-only call resolves normally after the kill" "$RC" "0"
check "subsequent call returns the real answer"                       "$OUT" "approve"
rm -rf "$REPO"

# --- same, but via SIGINT (Ctrl-C) ------------------------------------------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-406/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --raise-only \
    ticket=HEL-406 role=orchestrator question=q options=approve,deny ) >/dev/null 2>&1
( cd "$REPO" && "$SCRIPT" escalation --wait-only max_wait_sec=30 ticket=HEL-406 ) >/dev/null 2>&1 &
WAIT_PID=$!
for _ in $(seq 1 30); do
  kill -0 "$WAIT_PID" 2>/dev/null && break
  sleep 0.1
done
sleep 0.3
kill -INT "$WAIT_PID"
wait "$WAIT_PID" 2>/dev/null
check "INT-killed --wait-only wrote no escalation.timeout" \
  "$(grep -c escalation.timeout "$LOG" 2>/dev/null || true)" "0"
check "INT-killed --wait-only wrote no event at all" \
  "$(wc -l < "$LOG" | tr -d ' ')" "1"
rm -rf "$REPO"

# --- multi-part: --wait-only detects sub_questions from the log, not a
# separately-supplied total= argument (design.md Decision 1b) ---------------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-407/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --raise-only \
    ticket=HEL-407 role=orchestrator \
    sub_questions='[{"question":"Keep foo?","options":["yes","no"]},{"question":"Rename bar?","options":["rename","keep"]}]' \
  ) >/dev/null 2>&1

write_sub_answer() {
  node -e '
    const store = require(process.argv[1]);
    const result = store.writeSubAnswer(
      process.argv[2], process.argv[3], Number(process.argv[4]), process.argv[5], Number(process.argv[6]));
    console.log(JSON.stringify(result));
  ' "$ROOT/lib/ui/store.js" "$1" "$2" "$3" "$4" "$5"
}

write_sub_answer "$REPO" HEL-407 0 yes 2 >/dev/null
( cd "$REPO" && "$SCRIPT" escalation --wait-only max_wait_sec=1 ticket=HEL-407 ) >/dev/null 2>&1
RC1=$?
check "multi-part --wait-only: incomplete sub-answers still exit 2" "$RC1" "2"

write_sub_answer "$REPO" HEL-407 1 rename 2 >/dev/null
OUT="$( cd "$REPO" && "$SCRIPT" escalation --wait-only max_wait_sec=5 ticket=HEL-407 )"
RC2=$?
check "multi-part --wait-only: completing exits 0"          "$RC2" "0"
check "multi-part --wait-only: stdout carries both sub-answers, in order" \
  "$OUT" "$(printf 'yes\nrename')"
check "multi-part --wait-only: escalation.answered carries sub_answers" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
    const l = ls.find((x) => JSON.parse(x).kind === "escalation.answered");
    console.log(JSON.parse(JSON.parse(l).sub_answers).join(","));
  ' "$LOG")" \
  "yes,rename"
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
