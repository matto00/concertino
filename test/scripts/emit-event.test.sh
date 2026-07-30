#!/usr/bin/env bash
# Shell tests for core/scripts/emit-event.sh. Run: bash test/scripts/emit-event.test.sh
set -uo pipefail

# Job control on: with it off (the default for a non-interactive script), bash
# auto-ignores SIGINT/SIGQUIT for any `&` child THIS script backgrounds — a
# shell-level quirk of *this test's* harness, unrelated to whether
# emit-event.sh's own INT trap works. A real caller (a harness's process
# supervisor spawning bash directly, not another non-interactive script
# backgrounding it with `&`) never sets that ignore in the first place, so
# without `-m` here the INT-kill test below would hang on a false negative.
set -m

# Some shells export FORCE_COLOR, which makes node's console.log wrap bare
# numbers in ANSI codes even when stdout isn't a TTY (e.g. command
# substitution). That's terminal decoration, not part of the JSON under test
# — disable it so numeric assertions compare raw values.
export NO_COLOR=1
unset FORCE_COLOR

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/emit-event.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# Each test runs in a throwaway git repo so the script's main-checkout
# resolution is exercised for real.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" commit -q --allow-empty -m init
  printf '%s' "$d"
}

echo "emit-event.sh"

# --- writes a well-formed line to the right place --------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" phase.enter ticket=HEL-1 phase=Execution cycle=2 ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-1/events.jsonl"
check "creates events.jsonl" "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "one line"             "$(wc -l < "$LOG" | tr -d ' ')" "1"
check "kind"                 "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).kind)' "$LOG")" "phase.enter"
check "ticket"               "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).ticket)' "$LOG")" "HEL-1"
check "numeric cycle"        "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).cycle)' "$LOG")" "number"
check "t is a number"        "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).t)' "$LOG")" "number"
check "default role"         "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).role)' "$LOG")" "script"
rm -rf "$REPO"

# --- appends rather than truncates -----------------------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-2 msg=one ) >/dev/null 2>&1
( cd "$REPO" && "$SCRIPT" note ticket=HEL-2 msg=two ) >/dev/null 2>&1
check "appends" "$(wc -l < "$REPO/.concertino/runs/HEL-2/events.jsonl" | tr -d ' ')" "2"
rm -rf "$REPO"

# --- quotes and newlines survive as valid JSON ------------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-3 msg='he said "hi"
and left	now' ) >/dev/null 2>&1
check "escapes to valid JSON" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).msg.includes(String.fromCharCode(10))?"multiline":"flat")' "$REPO/.concertino/runs/HEL-3/events.jsonl")" \
  "multiline"
rm -rf "$REPO"

# --- long values are truncated so the line stays atomic ---------------------
REPO="$(new_repo)"
BIG="$(head -c 9000 /dev/zero | tr '\0' 'x')"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-4 msg="$BIG" ) >/dev/null 2>&1
LINELEN="$(head -1 "$REPO/.concertino/runs/HEL-4/events.jsonl" | wc -c | tr -d ' ')"
check "line <= 4000 bytes" "$([ "$LINELEN" -le 4000 ] && echo yes || echo no)" "yes"
check "still valid JSON"   "$(node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim());console.log("yes")' "$REPO/.concertino/runs/HEL-4/events.jsonl")" "yes"
rm -rf "$REPO"

# --- works from inside a worktree, writing to the MAIN checkout -------------
REPO="$(new_repo)"
git -C "$REPO" worktree add -q "$REPO/wt" -b feat 2>/dev/null
( cd "$REPO/wt" && "$SCRIPT" note ticket=HEL-5 msg=from-worktree ) >/dev/null 2>&1
check "writes to main checkout" \
  "$([ -f "$REPO/.concertino/runs/HEL-5/events.jsonl" ] && echo yes || echo no)" "yes"
check "not inside the worktree" \
  "$([ -f "$REPO/wt/.concertino/runs/HEL-5/events.jsonl" ] && echo yes || echo no)" "no"
rm -rf "$REPO"

# --- identity fields stay strings even when they look numeric ---------------
# `ticket` itself can no longer be pure digits (looks_like_ticket requires a
# leading letter/# and a trailing digit — see CON-14), so HEL-42 stands in as
# a ticket-shaped value; `role` carries no such shape requirement, so `7`
# still exercises the same auto-unquote-avoidance for that field.
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-42 role=7 msg=hi ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-42/events.jsonl"
check "ticket stays a string" "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).ticket)' "$LOG")" "string"
check "numeric role stays a string"   "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).role)' "$LOG")" "string"
rm -rf "$REPO"

# --- `t` and `kind` cannot be shadowed by a caller --------------------------
# A duplicate key parses to the LAST occurrence, so a stray `t=` reorders the
# whole log (the reducer sorts by t) and a stray `kind=` rewrites the event's
# meaning. The emitter is called from role prose by a language model, so a
# plausible-looking `t=` is a question of when, not if.
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" phase.enter ticket=HEL-20 t=999 kind=SHADOW phase=Execution ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-20/events.jsonl"
check "shadowed line is valid JSON"  "$(node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim());console.log("yes")' "$LOG" 2>/dev/null || echo no)" "yes"
check "t is not overridden"          "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).t === 999 ? "clobbered" : "intact")' "$LOG")" "intact"
check "t is still a real timestamp"  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).t > 1600000000000 ? "yes" : "no")' "$LOG")" "yes"
check "kind is not overridden"       "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).kind)' "$LOG")" "phase.enter"
check "no duplicate t key"           "$(grep -c '"t":' "$LOG")" "1"
check "no duplicate kind key"        "$(grep -c '"kind":' "$LOG")" "1"
check "legitimate fields still pass" "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).phase)' "$LOG")" "Execution"
rm -rf "$REPO"

# --- zero-padded numbers stay strings rather than emitting invalid JSON -----
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-8 code=007 ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-8/events.jsonl"
check "zero-padded value is valid JSON" "$(node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8").trim());console.log("yes")' "$LOG" 2>/dev/null || echo no)" "yes"
check "zero-padded value is a string"   "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).code)' "$LOG")" "007"
rm -rf "$REPO"

# --- plain integers are still emitted unquoted ------------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=HEL-9 cycle=0 n=-12 ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-9/events.jsonl"
check "zero is a number"     "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).cycle)' "$LOG")" "number"
check "negative is a number" "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).n)' "$LOG")" "-12"
rm -rf "$REPO"

# --- missing ticket is a no-op, never a failure -----------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note msg=orphan ) >/dev/null 2>&1
check "exit 0 without ticket" "$?" "0"
rm -rf "$REPO"

# --- --await returns the answer written by the dashboard --------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-6 question="add zod?" options=approve,deny ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
# Wait for the raised event, then answer it the way the TUI would.
for _ in $(seq 1 50); do
  [ -f "$REPO/.concertino/runs/HEL-6/events.jsonl" ] && break
  sleep 0.1
done
printf '{"answer":"approve"}' > "$REPO/.concertino/runs/HEL-6/answer.json"
wait "$AWAIT_PID"; AWAIT_RC=$?
check "--await exit 0 when answered" "$AWAIT_RC" "0"
check "--await prints the answer"    "$(tr -d '\n' < "$REPO/out.txt")" "approve"
check "--await raised an event"      "$(grep -c 'escalation.raised' "$REPO/.concertino/runs/HEL-6/events.jsonl")" "1"
rm -rf "$REPO"

# --- --await times out rather than hanging forever --------------------------
REPO="$(new_repo)"
( cd "$REPO" && CONCERTINO_ESCALATION_TIMEOUT_MIN=0 "$SCRIPT" escalation --await ticket=HEL-7 question=q ) >/dev/null 2>&1
check "--await exit 1 on timeout" "$?" "1"
check "--await logged a timeout"  "$(grep -c 'escalation.timeout' "$REPO/.concertino/runs/HEL-7/events.jsonl")" "1"
rm -rf "$REPO"

# --- an oversized typed answer is capped, not written whole ------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-10 question=q ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$REPO/.concertino/runs/HEL-10/events.jsonl" ] && break
  sleep 0.1
done
BIGANS="$(head -c 9000 /dev/zero | tr '\0' 'y')"
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({answer: process.argv[2]}))' \
  "$REPO/.concertino/runs/HEL-10/answer.json" "$BIGANS"
wait "$AWAIT_PID" || true
ANSLINE="$(grep 'escalation.answered' "$REPO/.concertino/runs/HEL-10/events.jsonl" | head -1)"
check "answered line <= 4000 bytes" "$([ "$(printf '%s' "$ANSLINE" | wc -c)" -le 4000 ] && echo yes || echo no)" "yes"
check "answered line is valid JSON" "$(printf '%s' "$ANSLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s);console.log("yes")}catch{console.log("no")}})')" "yes"
rm -rf "$REPO"

# --- --await bails immediately if it cannot record the escalation -----------
if [ "$(id -u)" -ne 0 ]; then
REPO="$(new_repo)"
mkdir -p "$REPO/.concertino/runs/HEL-11"
: > "$REPO/.concertino/runs/HEL-11/events.jsonl"
chmod 400 "$REPO/.concertino/runs/HEL-11/events.jsonl"
START=$(date +%s)
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-11 question=q ) >/dev/null 2>&1
RC=$?
ELAPSED=$(( $(date +%s) - START ))
chmod 600 "$REPO/.concertino/runs/HEL-11/events.jsonl"
check "--await exit 1 when it cannot log" "$RC" "1"
check "--await bailed fast, did not poll"  "$([ "$ELAPSED" -le 3 ] && echo yes || echo no)" "yes"
rm -rf "$REPO"
fi

# --- a harness-style TERM still records escalation.timeout before dying -----
# This is the slice-2a Critical: a harness kills the Bash call around --await
# with SIGTERM long before its own deadline. Without a trap, the kill reaches
# no code and the log is left holding only escalation.raised forever.
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-12/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-12 question=q ) >/dev/null 2>&1 &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
kill -TERM "$AWAIT_PID"
wait "$AWAIT_PID" 2>/dev/null
RC=$?
check "killed --await exits non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "killed --await still logged escalation.timeout" \
  "$(grep -c escalation.timeout "$LOG")" "1"
rm -rf "$REPO"

# --- same, but via SIGINT (Ctrl-C) ------------------------------------------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-13/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-13 question=q ) >/dev/null 2>&1 &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
kill -INT "$AWAIT_PID"
wait "$AWAIT_PID" 2>/dev/null
RC=$?
check "INT-killed --await exits non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "INT-killed --await still logged escalation.timeout" \
  "$(grep -c escalation.timeout "$LOG")" "1"
rm -rf "$REPO"

# --- a stale answer file present at wait-start is discarded, not consumed ---
# If a previous --await was killed after a human answered but before it was
# read, a naive retry silently deletes that decision. It must instead be
# recorded and left unconsumed — it may belong to a different escalation.
REPO="$(new_repo)"
mkdir -p "$REPO/.concertino/runs/HEL-14"
printf '{"answer":"stale-approve"}' > "$REPO/.concertino/runs/HEL-14/answer.json"
LOG="$REPO/.concertino/runs/HEL-14/events.jsonl"
( cd "$REPO" && CONCERTINO_ESCALATION_TIMEOUT_MIN=0 "$SCRIPT" escalation --await ticket=HEL-14 question=q ) > "$REPO/out.txt" 2>/dev/null
RC=$?
check "stale-answer run still times out (answer not consumed)" "$RC" "1"
check "stale answer was not printed"        "$(cat "$REPO/out.txt")" ""
check "discard was recorded in the log"     "$(grep -c escalation.answer_discarded "$LOG")" "1"
check "timeout was also recorded"           "$(grep -c escalation.timeout "$LOG")" "1"
rm -rf "$REPO"

# --- a small context= rides inline unchanged, no truncation flags ----------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-15/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-15 question=q options=a,b \
    context="package zod@3.23.0, imported by lib/ui/ticket.js" ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
printf '{"answer":"approve"}' > "$REPO/.concertino/runs/HEL-15/answer.json"
wait "$AWAIT_PID" 2>/dev/null
check "small context: exit 0" "$?" "0"
check "small context: rides inline unchanged" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").find(x=>x.includes("escalation.raised"));console.log(JSON.parse(l).context)' "$LOG")" \
  "package zod@3.23.0, imported by lib/ui/ticket.js"
check "small context: no context_truncated key" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").find(x=>x.includes("escalation.raised"));console.log("context_truncated" in JSON.parse(l))' "$LOG")" \
  "false"
check "small context: no context_ref key" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").find(x=>x.includes("escalation.raised"));console.log("context_ref" in JSON.parse(l))' "$LOG")" \
  "false"
rm -rf "$REPO"

# --- an oversized context= is truncated visibly with a resolvable ref ------
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-16/events.jsonl"
BIGCTX="$(head -c 6000 /dev/zero | tr '\0' 'x')"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-16 question=q options=a,b \
    context="$BIGCTX" ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
printf '{"answer":"approve"}' > "$REPO/.concertino/runs/HEL-16/answer.json"
wait "$AWAIT_PID" 2>/dev/null
RAISEDLINE="$(grep escalation.raised "$LOG" | head -1)"
check "oversized context: raised line <= 4000 bytes" \
  "$([ "$(printf '%s' "$RAISEDLINE" | wc -c)" -le 4000 ] && echo yes || echo no)" "yes"
check "oversized context: still valid JSON" \
  "$(printf '%s' "$RAISEDLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s);console.log("yes")}catch{console.log("no")}})')" \
  "yes"
check "oversized context: context_truncated is true" \
  "$(printf '%s' "$RAISEDLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).context_truncated)})')" \
  "true"
check "oversized context: inline context is shorter than the input" \
  "$(printf '%s' "$RAISEDLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).context.length < 6000 ? "shorter" : "not-shorter")})')" \
  "shorter"
REF="$(printf '%s' "$RAISEDLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).context_ref||"")})')"
check "oversized context: context_ref file exists" "$([ -n "$REF" ] && [ -f "$REF" ] && echo yes || echo no)" "yes"
check "oversized context: ref content is the full untruncated context" \
  "$(wc -c < "$REF" | tr -d ' ')" "6000"
check "oversized context: question is unaffected" \
  "$(printf '%s' "$RAISEDLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).question)})')" \
  "q"
check "oversized context: options are unaffected" \
  "$(printf '%s' "$RAISEDLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).options)})')" \
  "a,b"
rm -rf "$REPO"

# --- a failed persist yields truncated context with no context_ref ---------
if [ "$(id -u)" -ne 0 ]; then
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-17/events.jsonl"
mkdir -p "$REPO/.concertino/runs/HEL-17/evidence"
chmod 500 "$REPO/.concertino/runs/HEL-17/evidence"
BIGCTX="$(head -c 6000 /dev/zero | tr '\0' 'x')"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-17 question=q options=a,b \
    context="$BIGCTX" ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
printf '{"answer":"approve"}' > "$REPO/.concertino/runs/HEL-17/answer.json"
wait "$AWAIT_PID" 2>/dev/null
chmod 700 "$REPO/.concertino/runs/HEL-17/evidence"
RAISEDLINE="$(grep escalation.raised "$LOG" | head -1)"
check "failed persist: context_truncated is still true" \
  "$(printf '%s' "$RAISEDLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).context_truncated)})')" \
  "true"
check "failed persist: no context_ref key" \
  "$(printf '%s' "$RAISEDLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log("context_ref" in JSON.parse(s))})')" \
  "false"
rm -rf "$REPO"
fi

# --- a multi-byte character straddling the truncation boundary is never split (CON-16) -----
# Old bug: the binary search's prefix came from `LC_ALL=C cut -b`, a pure byte-count cut with
# no UTF-8 awareness, so a multi-byte character landing on the cut point was split, leaving a
# lone continuation byte in the emitted JSON string.
#
# First calibrate: an ASCII-only oversized context of the same escalation shape (ticket
# string length, question, options) reports its truncation boundary directly in the marker —
# for ASCII content the marker's byte count is exact (no back-off needed), so read it back to
# learn where THIS shape of escalation actually cuts, rather than guessing a boundary that
# might drift with unrelated overhead (ref path length, timestamp digit count, etc).
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-19/events.jsonl"
CALCTX="$(head -c 6000 /dev/zero | tr '\0' 'x')"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-19 question=q options=a,b \
    context="$CALCTX" ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
printf '{"answer":"approve"}' > "$REPO/.concertino/runs/HEL-19/answer.json"
wait "$AWAIT_PID" 2>/dev/null
CALLINE="$(grep escalation.raised "$LOG" | head -1)"
BOUNDARY="$(printf '%s' "$CALLINE" | node -e '
  let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
    const o = JSON.parse(s);
    const m = o.context.match(/truncated, (\d+) of/);
    console.log(m ? m[1] : "0");
  })')"
rm -rf "$REPO"

# Build a second oversized context of the same shape (same ticket string length, question,
# options — HEL-20 is the same length as HEL-19, and the total byte count keeps the same
# digit count as the calibration run's, so the overhead the marker/JSON contribute to the
# search is unchanged and the search converges on the SAME boundary). Place a single 4-byte
# emoji so its bytes are [BOUNDARY-2, BOUNDARY+2) — straddling the boundary so that keeping
# only the first BOUNDARY bytes keeps exactly 3 of its 4 bytes, splitting it. (A symmetric
# zone of several emoji was tried first and turned out to land exactly on a 4-byte-aligned
# multiple of the calibrated boundary purely by construction, which never actually split
# anything — this direct placement is deliberate, not left to alignment luck.)
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-20/events.jsonl"
EMOJI="$(printf '\xf0\x9f\x98\x80')"           # U+1F600, a 4-byte UTF-8 sequence
BEFORE_N=$(( BOUNDARY > 3 ? BOUNDARY - 3 : 0 ))
BEFORE="$(head -c "$BEFORE_N" /dev/zero | tr '\0' 'x')"
AFTER="$(head -c 3000 /dev/zero | tr '\0' 'x')"
MBCTX="${BEFORE}${EMOJI}${AFTER}"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-20 question=q options=a,b \
    context="$MBCTX" ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
printf '{"answer":"approve"}' > "$REPO/.concertino/runs/HEL-20/answer.json"
wait "$AWAIT_PID" 2>/dev/null
RAISEDLINE="$(grep escalation.raised "$LOG" | head -1)"
check "multi-byte context: still valid JSON" \
  "$(printf '%s' "$RAISEDLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{JSON.parse(s);console.log("yes")}catch{console.log("no")}})')" \
  "yes"
check "multi-byte context: decoded context has no replacement character" \
  "$(printf '%s' "$RAISEDLINE" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(o.context.includes("�")?"has-replacement":"clean")})')" \
  "clean"
check "multi-byte context: marker byte count matches the actual inline prefix's byte length" \
  "$(printf '%s' "$RAISEDLINE" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const o = JSON.parse(s);
      const idx = o.context.indexOf(" … [truncated,");
      const markerText = o.context.slice(idx);
      const reported = parseInt(markerText.match(/truncated, (\d+) of/)[1], 10);
      const markerBytes = Buffer.byteLength(markerText, "utf8");
      const totalBytes = Buffer.byteLength(o.context, "utf8");
      const actualPrefixBytes = totalBytes - markerBytes;
      console.log(reported === actualPrefixBytes ? "match" : "mismatch reported=" + reported + " actual=" + actualPrefixBytes);
    })')" \
  "match"
rm -rf "$REPO"

# --- an escalation raised without context= is byte-for-byte unaffected -----
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-18/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-18 question=q options=a,b ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
printf '{"answer":"approve"}' > "$REPO/.concertino/runs/HEL-18/answer.json"
wait "$AWAIT_PID" 2>/dev/null
check "no context=: no context key at all" \
  "$(grep escalation.raised "$LOG" | head -1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log("context" in JSON.parse(s))})')" \
  "false"
rm -rf "$REPO"

# --- a traversal-shaped ticket writes nothing, anywhere ---------------------
REPO="$(new_repo)"
BEFORE="$(find "$REPO" -type f | sort)"
( cd "$REPO" && "$SCRIPT" note ticket=../../../../escape msg=hi ) >/dev/null 2>&1
RC=$?
AFTER="$(find "$REPO" -type f | sort)"
check "exit 0 on traversal-shaped ticket" "$RC" "0"
check "no runs directory created" "$([ -d "$REPO/.concertino/runs" ] && echo yes || echo no)" "no"
check "no new file created anywhere" "$AFTER" "$BEFORE"
# A well-formed sibling ticket id still succeeds in the same run.
( cd "$REPO" && "$SCRIPT" note ticket=CON-14 msg=hi ) >/dev/null 2>&1
check "well-formed sibling ticket id still writes its event" \
  "$([ -f "$REPO/.concertino/runs/CON-14/events.jsonl" ] && echo yes || echo no)" "yes"
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
