#!/usr/bin/env bash
# End-to-end proof of the whole control-plane loop: the real
# core/scripts/emit-event.sh escalation --await, blocked in the background
# against a throwaway repo, answered through the dashboard's own writer
# (lib/ui/store.js writeAnswer) rather than a hand-rolled `node -e` write.
# This is the one test that proves the two halves (already-built --await,
# and this task's writer) actually fit together.
set -uo pipefail

# Some shells export FORCE_COLOR, which makes node's console.log wrap bare
# booleans in ANSI codes even when stdout isn't a TTY (e.g. command
# substitution). That's terminal decoration, not part of the JSON under test.
export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/emit-event.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "escalation loop (emit-event.sh --await + the dashboard's answer writer)"

new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" commit -q --allow-empty -m init
  printf '%s' "$d"
}

write_answer() {
  # Exercises the actual writer, not a stand-in for it — same module watch.js
  # calls when a human presses an option key on the escalation screen.
  node -e '
    const store = require(process.argv[1]);
    const result = store.writeAnswer(process.argv[2], process.argv[3], process.argv[4]);
    console.log(JSON.stringify(result));
  ' "$ROOT/lib/ui/store.js" "$1" "$2" "$3"
}

REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-338/events.jsonl"

( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket=HEL-338 role=orchestrator \
    question="add zod@3.23 as a runtime dependency?" \
    options=approve,deny ) > "$REPO/out.txt" 2> "$REPO/err.txt" &
AWAIT_PID=$!

# Wait for escalation.raised to land — this is what the dashboard would poll
# the event log for to light up NEEDS YOU in the first place.
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
check "escalation.raised landed before the answer" \
  "$(grep -c escalation.raised "$LOG" 2>/dev/null || echo 0)" "1"

# Answer it through the writer, exactly as the escalation screen would after
# the human presses [a]pprove.
RESULT="$(write_answer "$REPO" HEL-338 approve)"
check "writer reports success" "$(node -e "console.log(JSON.parse(process.argv[1]).ok)" "$RESULT")" "true"

wait "$AWAIT_PID"; AWAIT_RC=$?
check "--await exits 0" "$AWAIT_RC" "0"
check "--await prints the decision on stdout" "$(tr -d '\n' < "$REPO/out.txt")" "approve"
check "log carries exactly one escalation.answered" "$(grep -c escalation.answered "$LOG")" "1"
check "the logged answer is what was written" \
  "$(node -e 'const ls=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n");const l=ls.find(x=>JSON.parse(x).kind==="escalation.answered");console.log(JSON.parse(l).answer)' "$LOG")" \
  "approve"
rm -rf "$REPO"

# --- a second dashboard answering the same escalation is refused, not raced -
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-339/events.jsonl"

( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket=HEL-339 role=orchestrator question=q options=approve,deny ) \
  > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!

for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done

FIRST="$(write_answer "$REPO" HEL-339 approve)"
SECOND="$(write_answer "$REPO" HEL-339 deny)"
check "first writer wins"       "$(node -e "console.log(JSON.parse(process.argv[1]).ok)" "$FIRST")"  "true"
check "second writer is refused" "$(node -e "console.log(JSON.parse(process.argv[1]).ok)" "$SECOND")" "false"
check "second writer is told why" "$(node -e "console.log(JSON.parse(process.argv[1]).reason)" "$SECOND")" "answered"

wait "$AWAIT_PID"; AWAIT_RC=$?
check "--await still exits 0 (picked up the first writer's file)" "$AWAIT_RC" "0"
check "the winning answer is the one --await returned" "$(tr -d '\n' < "$REPO/out.txt")" "approve"
check "still exactly one escalation.answered despite two writers" \
  "$(grep -c escalation.answered "$LOG")" "1"
rm -rf "$REPO"

# --- CON-46: multi-part escalation --------------------------------------

write_sub_answer() {
  # Exercises the actual writer, not a stand-in — same module watch.js calls
  # via answerEscalationSub() when a human answers a wizard step.
  node -e '
    const store = require(process.argv[1]);
    const result = store.writeSubAnswer(
      process.argv[2], process.argv[3], Number(process.argv[4]), process.argv[5], Number(process.argv[6]));
    console.log(JSON.stringify(result));
  ' "$ROOT/lib/ui/store.js" "$1" "$2" "$3" "$4" "$5"
}

# --- an incomplete multi-part answer.json does not resolve the wait --------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-340/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket=HEL-340 role=orchestrator \
    sub_questions='[{"question":"Keep foo?","options":["yes","no"]},{"question":"Rename bar?","options":["rename","keep"]}]' \
  ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!

for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
check "multi-part: escalation.raised landed" \
  "$(grep -c escalation.raised "$LOG" 2>/dev/null || echo 0)" "1"

RESULT1="$(write_sub_answer "$REPO" HEL-340 0 yes 2)"
check "multi-part: first sub-answer write ok" \
  "$(node -e "console.log(JSON.parse(process.argv[1]).ok)" "$RESULT1")" "true"
check "multi-part: first sub-answer write is not yet complete" \
  "$(node -e "console.log(JSON.parse(process.argv[1]).complete)" "$RESULT1")" "false"

# Give --await a couple of poll ticks to prove an incomplete file is treated
# identically to no file at all — it must NOT resolve the wait.
sleep 2
check "multi-part: incomplete file does not resolve — --await is still running" \
  "$(kill -0 "$AWAIT_PID" 2>/dev/null && echo running || echo exited)" "running"
check "multi-part: no escalation.answered yet" \
  "$(grep -c escalation.answered "$LOG" 2>/dev/null || true)" "0"

RESULT2="$(write_sub_answer "$REPO" HEL-340 1 rename 2)"
check "multi-part: second sub-answer write completes the file" \
  "$(node -e "console.log(JSON.parse(process.argv[1]).complete)" "$RESULT2")" "true"

wait "$AWAIT_PID"; AWAIT_RC=$?
check "multi-part: --await exits 0 once complete" "$AWAIT_RC" "0"
check "multi-part: stdout carries each sub-answer on its own line, in order" \
  "$(cat "$REPO/out.txt")" "$(printf 'yes\nrename')"
check "multi-part: log carries exactly one escalation.answered" \
  "$(grep -c escalation.answered "$LOG")" "1"
check "multi-part: escalation.answered carries sub_answers, in order" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
    const l = ls.find((x) => JSON.parse(x).kind === "escalation.answered");
    console.log(JSON.parse(JSON.parse(l).sub_answers).join(","));
  ' "$LOG")" \
  "yes,rename"
rm -rf "$REPO"

# --- a complete multi-part answer.json resolves the wait immediately -------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-343/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket=HEL-343 role=orchestrator \
    sub_questions='[{"question":"Ship it?","options":["ship","hold"]}]' \
  ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
write_sub_answer "$REPO" HEL-343 0 ship 1 >/dev/null
wait "$AWAIT_PID"; AWAIT_RC=$?
check "single-sub-question multi-part: --await exits 0" "$AWAIT_RC" "0"
check "single-sub-question multi-part: stdout is the one sub-answer" \
  "$(cat "$REPO/out.txt")" "ship"
rm -rf "$REPO"

# --- design.md Decision 4: an oversized sub_questions payload fails the -----
# raise outright, never silently dropping sub_questions via either lossy
# fallback — case (a): no context= at all.
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-341/events.jsonl"
BIGOPT="$(head -c 6000 /dev/zero | tr '\0' 'x')"
BIGSQ='[{"question":"q","options":["'"$BIGOPT"'"]}]'
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-341 role=orchestrator \
    sub_questions="$BIGSQ" ) >/dev/null 2>&1
RC=$?
check "oversized sub_questions, no context: raise fails outright (non-zero exit)" "$RC" "1"
check "oversized sub_questions, no context: no escalation.raised line written" \
  "$([ -f "$LOG" ] && grep -c escalation.raised "$LOG" 2>/dev/null || echo 0)" "0"
rm -rf "$REPO"

# --- case (b): a small, otherwise-independently-truncatable context= is ----
# ALSO present — must not let sub_questions sneak through the context-
# truncation fallback path instead.
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-342/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-342 role=orchestrator \
    sub_questions="$BIGSQ" context="small, otherwise-truncatable context" ) >/dev/null 2>&1
RC=$?
check "oversized sub_questions with small context: raise still fails outright" "$RC" "1"
check "oversized sub_questions with small context: no escalation.raised line written" \
  "$([ -f "$LOG" ] && grep -c escalation.raised "$LOG" 2>/dev/null || echo 0)" "0"
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
