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

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"
trap con181_cleanup_scratch EXIT

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

# CON-183: shared bounded-wait / leaked-child-detection helpers
# (wait_killed_bounded, capture_children, assert_children_dead) -- see
# lib/wait-bounded.sh for the full rationale (a plain unbounded `wait` on a
# killed --await hung this suite ~20 minutes during a cold review of PR #138
# on 2026-09-11; checking `pgrep -P` on an already-reaped pid is vacuous).
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/wait-bounded.sh"

# Self-test: prove capture_children()/assert_children_dead() actually catch a
# leaked grandchild, so the checks used against --await below are known to be
# failable rather than vacuously green. Mirrors the reviewer's own proof:
# spawn a parent with a live child, kill+reap the parent, show a NAIVE
# post-reap `pgrep -P <parent>` finds nothing (the vacuous shape being
# replaced) while the FIXED shape (capture before kill, then check the
# captured pid directly) still catches the leaked child.
LEAKY_PARENT_SCRIPT="$(mktemp)"
cat > "$LEAKY_PARENT_SCRIPT" <<'EOF'
#!/usr/bin/env bash
# A deliberately bad parent: on TERM, it exits immediately without waiting
# for or killing its own background child -- the exact "leak a grandchild"
# shape assert_children_dead() must catch.
trap 'exit 1' TERM
sleep 60 &
CHILD=$!
wait "$CHILD"
EOF
chmod +x "$LEAKY_PARENT_SCRIPT"
"$LEAKY_PARENT_SCRIPT" &
LEAKY_PID=$!
# Bounded poll for the child to actually appear, rather than a fixed sleep
# (CON-183 cycle-3 hardening -- a fixed sleep is exactly the class of
# load-fragile wait this ticket exists to remove, even though no failure of
# this specific line has ever been reproduced).
for _ in $(seq 1 50); do
  LEAKY_CHILD="$(capture_children "$LEAKY_PID")"
  [ -n "$LEAKY_CHILD" ] && break
  sleep 0.1
done
check "self-test: leaky parent has a live child to capture" \
  "$([ -n "$LEAKY_CHILD" ] && echo yes || echo no)" "yes"
kill -TERM "$LEAKY_PID"
wait "$LEAKY_PID" 2>/dev/null
check "self-test: the OLD vacuous check (pgrep -P the now-dead parent) finds nothing, proving it cannot fail" \
  "$(pgrep -P "$LEAKY_PID" 2>/dev/null | tr -d '\n')" ""
# CON-183 (cycle-3 review): both arms below now call the SAME shared
# children_alive()/assert_children_dead() functions the real --await checks
# use, rather than a second, inline kill -0 loop -- a mutation to the real
# liveness logic previously left this self-test green (93 passed, 0 failed)
# because the duplicated inline loop here was only accidentally identical.
check "self-test: the FIXED check (captured child pid, by PID) correctly reports it alive" \
  "$([ -n "$(children_alive "$LEAKY_CHILD")" ] && echo alive || echo dead)" "alive"
# Clean up the actually-leaked child -- this test must not itself leave a
# process running past its own completion.
kill -KILL "$LEAKY_CHILD" 2>/dev/null
wait "$LEAKY_CHILD" 2>/dev/null
# CON-189 cycle 4: bounded poll for the SIGKILL to actually be reflected by
# `kill -0` before asserting, mirroring this same file's own "wait for the
# child to appear" idiom a few lines above (seq 1 50 / sleep 0.1 = 5s bound)
# rather than a fixed sleep or a magic constant (CON-200 precedent: no
# constant at or below the poll period it races is ever safe). `wait
# "$LEAKY_CHILD"` above is best-effort only -- LEAKY_CHILD is a grandchild of
# this shell (child of the now-dead LEAKY_PARENT_SCRIPT subshell), not a
# direct job of it, so bash's `wait` silently no-ops on it rather than
# blocking until the kernel finishes tearing it down; under load the very
# next `kill -0` can still observe it alive. This is what turned CI red
# (test (22)=FAILURE, PR #143): the assertion ran before the kill had
# actually taken effect.
for _ in $(seq 1 50); do
  [ -z "$(children_alive "$LEAKY_CHILD")" ] && break
  sleep 0.1
done
assert_children_dead "self-test: after cleanup, assert_children_dead reports it gone" "$LEAKY_CHILD"
rm -f "$LEAKY_PARENT_SCRIPT"

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
wait_killed_bounded "$AWAIT_PID" 20; AWAIT_RC=$?
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
wait_killed_bounded "$AWAIT_PID" 20 || true
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
# Captured BEFORE signalling -- see capture_children()'s header comment for
# why capturing AFTER the parent is reaped cannot ever catch a leak.
PRE_KILL_CHILDREN="$(capture_children "$AWAIT_PID")"
kill -TERM "$AWAIT_PID"
wait_killed_bounded "$AWAIT_PID" 10
RC=$?
check "killed --await responded to SIGTERM within 10s (no SIGKILL fallback)" \
  "$([ "$RC" -ne 124 ] && echo yes || echo no)" "yes"
check "killed --await exits non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "killed --await still logged escalation.timeout" \
  "$(grep -c escalation.timeout "$LOG")" "1"
assert_children_dead "killed --await leaves no orphan child" "$PRE_KILL_CHILDREN"
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
PRE_KILL_CHILDREN="$(capture_children "$AWAIT_PID")"
kill -INT "$AWAIT_PID"
wait_killed_bounded "$AWAIT_PID" 10
RC=$?
check "INT-killed --await responded to SIGINT within 10s (no SIGKILL fallback)" \
  "$([ "$RC" -ne 124 ] && echo yes || echo no)" "yes"
check "INT-killed --await exits non-zero" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "INT-killed --await still logged escalation.timeout" \
  "$(grep -c escalation.timeout "$LOG")" "1"
assert_children_dead "INT-killed --await leaves no orphan child" "$PRE_KILL_CHILDREN"
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
wait_killed_bounded "$AWAIT_PID" 20; RC=$?
check "small context: exit 0" "$RC" "0"
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
wait_killed_bounded "$AWAIT_PID" 20
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
wait_killed_bounded "$AWAIT_PID" 20
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
wait_killed_bounded "$AWAIT_PID" 20
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
wait_killed_bounded "$AWAIT_PID" 20
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
wait_killed_bounded "$AWAIT_PID" 20
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

# ===========================================================================
# CON-80: unconditional case canonicalisation. A validated ticket=, once past
# looks_like_ticket, is upper-cased before it addresses RUN_DIR or is written
# into the event — on EVERY call, not only when a differently-cased run
# directory is already found to exist (design.md Decision 2). This is the
# second, independent line of defense under assert-phase.sh/start-servers.sh's
# explicit-argument fix: even a caller that still infers a lowercase ticket id
# converges on the same directory as one that was told the canonical id.
# ===========================================================================

# --- a lowercase ticket writes to the uppercase run directory --------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=con-79 msg=hi ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/CON-79/events.jsonl"
LOWER_LOG="$REPO/.concertino/runs/con-79/events.jsonl"
check "lowercase ticket writes under the uppercase run dir" \
  "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "no lowercase run dir is created" \
  "$([ -e "$LOWER_LOG" ] && echo present || echo absent)" "absent"
check "the written event's ticket field is itself upper-cased" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).ticket)' "$LOG")" \
  "CON-79"
rm -rf "$REPO"

# --- a mixed-case ticket is likewise canonicalised --------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=Con-80 msg=hi ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/CON-80/events.jsonl"
check "mixed-case ticket writes under the uppercase run dir" \
  "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "mixed-case ticket's event ticket field is upper-cased" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).ticket)' "$LOG")" \
  "CON-80"
rm -rf "$REPO"

# --- two invocations differing only by case converge on ONE directory ------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=con-81 msg=first ) >/dev/null 2>&1
( cd "$REPO" && "$SCRIPT" note ticket=CON-81 msg=second ) >/dev/null 2>&1
( cd "$REPO" && "$SCRIPT" note ticket=Con-81 msg=third ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/CON-81/events.jsonl"
check "only one run directory exists for the ticket regardless of caller case" \
  "$(find "$REPO/.concertino/runs" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' ')" "1"
check "all three events landed in that one directory" \
  "$(wc -l < "$LOG" | tr -d ' ')" "3"
rm -rf "$REPO"

# --- an already-uppercase ticket is unaffected ------------------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" note ticket=CON-82 msg=hi ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/CON-82/events.jsonl"
check "already-uppercase ticket writes exactly where before" \
  "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "already-uppercase ticket's event ticket field is unchanged" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).ticket)' "$LOG")" \
  "CON-82"
rm -rf "$REPO"

# --- canonicalisation runs strictly AFTER the shape check, never widening it
#     — a still-malformed ticket is still dropped/warned exactly as before --
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" run.end ticket=not-shaped status=delivered ) >"$REPO/out.txt" 2>"$REPO/err.txt"
RC=$?
check "exit 0 even for malformed run.end" "$RC" "0"
check "no run dir created for a malformed ticket" \
  "$([ -d "$REPO/.concertino/runs" ] && echo present || echo absent)" "absent"
check "loud WARNING still fires for a malformed run.end ticket" \
  "$(grep -c 'WARNING: run.end' "$REPO/err.txt")" "1"
rm -rf "$REPO"

# --- .concertino.env sourcing (CON-47) --------------------------------------
# `--await`'s deadline comes from CONCERTINO_ESCALATION_TIMEOUT_MIN, which the
# script only sees if it actually sources `.concertino.env`. Every case below
# runs a *copy* of the script in its own temp directory rather than "$SCRIPT"
# itself: `.concertino.env` must never be written into core/scripts/, which is
# the live source tree the rest of this suite invokes directly (the cases above
# that pass CONCERTINO_ESCALATION_TIMEOUT_MIN as a process env var would pick
# it up, since a sourced value overrides an exported one by design).
script_copy() {
  local d; d="$(mktemp -d)"
  cp "$SCRIPT" "$d/emit-event.sh"
  chmod +x "$d/emit-event.sh"
  printf '%s' "$d"
}

# Every case here asserts an IMMEDIATE timeout (the env file sets the deadline
# to 0 minutes). If the sourcing regressed, the script would instead fall back
# to its 60-minute default and park this whole suite for an hour, so bound the
# wait and report the overrun as a failure rather than hanging. SIGKILL, not
# TERM/INT — those two are exactly what on_kill traps to write
# escalation.timeout, which would forge the evidence this is checking for.
run_await_bounded() {
  local max_s="$1" cwd="$2"; shift 2
  local pid i rc
  ( cd "$cwd" && exec "$@" ) >/dev/null 2>&1 &
  pid=$!
  for (( i = 0; i < max_s * 10; i++ )); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    printf 'still-running-after-%ss' "$max_s"
    return 0
  fi
  wait "$pid"; rc=$?
  printf 'rc=%s' "$rc"
}

# --- branch 1: .concertino.env next to the script itself --------------------
REPO="$(new_repo)"
DIR="$(script_copy)"
printf 'CONCERTINO_ESCALATION_TIMEOUT_MIN=0\n' > "$DIR/.concertino.env"
check "local .concertino.env applies (immediate timeout, exit 1)" \
  "$(run_await_bounded 20 "$REPO" "$DIR/emit-event.sh" escalation --await ticket=HEL-30 question=q)" \
  "rc=1"
check "local .concertino.env: timeout was recorded" \
  "$(grep -c escalation.timeout "$REPO/.concertino/runs/HEL-30/events.jsonl")" "1"
rm -rf "$REPO" "$DIR"

# --- branch 2: only the MAIN checkout has it, script runs from a worktree ----
# The real invocation context: the orchestrator has cd'd into WORKTREE_PATH and
# calls scripts/concertino/emit-event.sh by relative path there. That copy's own
# directory has no `.concertino.env` — only the main checkout's does.
REPO="$(new_repo)"
git -C "$REPO" worktree add -q "$REPO/wt" -b feat-env 2>/dev/null
mkdir -p "$REPO/scripts/concertino" "$REPO/wt/scripts/concertino"
cp "$SCRIPT" "$REPO/wt/scripts/concertino/emit-event.sh"
chmod +x "$REPO/wt/scripts/concertino/emit-event.sh"
printf 'CONCERTINO_ESCALATION_TIMEOUT_MIN=0\n' > "$REPO/scripts/concertino/.concertino.env"
check "no .concertino.env beside the worktree's own copy" \
  "$([ -f "$REPO/wt/scripts/concertino/.concertino.env" ] && echo yes || echo no)" "no"
check "main-checkout .concertino.env applies from inside a worktree" \
  "$(run_await_bounded 20 "$REPO/wt" ./scripts/concertino/emit-event.sh escalation --await ticket=HEL-31 question=q)" \
  "rc=1"
check "worktree case: timeout recorded in the main checkout's log" \
  "$(grep -c escalation.timeout "$REPO/.concertino/runs/HEL-31/events.jsonl")" "1"
rm -rf "$REPO"

# --- precedence: a sourced value beats an already-exported one ---------------
# Deliberately this direction only (file 0 vs exported 60), never the reverse:
# if the assertion were ever wrong the wrong way round, the run would block for
# up to an hour instead of failing fast.
REPO="$(new_repo)"
DIR="$(script_copy)"
printf 'CONCERTINO_ESCALATION_TIMEOUT_MIN=0\n' > "$DIR/.concertino.env"
export CONCERTINO_ESCALATION_TIMEOUT_MIN=60
check "sourced .concertino.env overrides an exported timeout" \
  "$(run_await_bounded 20 "$REPO" "$DIR/emit-event.sh" escalation --await ticket=HEL-32 question=q)" \
  "rc=1"
unset CONCERTINO_ESCALATION_TIMEOUT_MIN
rm -rf "$REPO" "$DIR"

# --- no .concertino.env anywhere: the hardcoded default still applies --------
# Can't wait out 60 minutes, so assert the observable consequence: the script
# is still polling (never exited) well past the point the two cases above
# returned in, i.e. it did NOT pick up a 0-minute deadline from nowhere.
REPO="$(new_repo)"
DIR="$(script_copy)"
check "no .concertino.env: default deadline still governs (still waiting)" \
  "$(run_await_bounded 3 "$REPO" "$DIR/emit-event.sh" escalation --await ticket=HEL-33 question=q)" \
  "still-running-after-3s"
check "no .concertino.env: raised but not timed out" \
  "$(grep -c escalation.timeout "$REPO/.concertino/runs/HEL-33/events.jsonl" || true)" "0"
rm -rf "$REPO" "$DIR"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]

# --- CON-166: verdict head_sha / head_sha_source binding --------------------

# Stated head_sha: recorded verbatim, source marked "stated". This half
# (recording head_sha itself) is precondition-guaranteed by the pre-existing
# generic k=v passthrough and is NOT the assertion under test here — the
# assertion is head_sha_source, which the pre-fix script never wrote at all.
REPO="$(new_repo)"
# CON-187 task 5.2: replaced the 8-char `deadbeef` fixture with a full
# 40-character hex SHA — the new format validation necessarily refuses a
# short one. The assertion's original intent (a stated SHA is recorded
# verbatim with head_sha_source=stated) is preserved.
STATED_SHA="deadbeef00112233445566778899aabbccddeeff"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-40 role=evaluator verdict=PASS category=mechanical head_sha="$STATED_SHA" ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-40/events.jsonl"
check "stated head_sha recorded" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).head_sha)' "$LOG")" \
  "$STATED_SHA"
check "stated head_sha_source" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).head_sha_source)' "$LOG")" \
  "stated"
rm -rf "$REPO"

# Omitted head_sha, inside a git worktree: infer HEAD, mark "inferred".
REPO="$(new_repo)"
REAL_HEAD="$(git -C "$REPO" rev-parse HEAD)"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-41 role=skeptic verdict=CONFIRM category=mechanical gate=design ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-41/events.jsonl"
check "inferred head_sha equals git HEAD" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).head_sha)' "$LOG")" \
  "$REAL_HEAD"
check "inferred head_sha_source" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).head_sha_source)' "$LOG")" \
  "inferred"
rm -rf "$REPO"

# Neither stated nor resolvable: a real repo (so ROOT/RUN_DIR resolve) with no
# commits yet, so `git rev-parse HEAD` fails (unborn HEAD). Event is still
# written, carries no SHA/head_sha_source at all, and emission does not fail.
DIR2="$(mktemp -d)"
git -C "$DIR2" init -q
( cd "$DIR2" && "$SCRIPT" verdict ticket=HEL-42 role=evaluator verdict=PASS category=mechanical ) >/dev/null 2>&1
RC=$?
LOG2="$DIR2/.concertino/runs/HEL-42/events.jsonl"
check "unresolvable-HEAD case: emission still exits 0" "$RC" "0"
check "unresolvable-HEAD case: event still written" \
  "$([ -f "$LOG2" ] && echo yes || echo no)" "yes"
check "unresolvable-HEAD case: no head_sha field" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log("head_sha" in JSON.parse(l)?"present":"absent")' "$LOG2")" \
  "absent"
rm -rf "$DIR2"

# =============================================================================
# CON-188: committed shell-level coverage of escalation_id / resolution_channel
# / answer_source, against the REAL script's REAL output (final-gate round 1
# change request, constraint C4 — manual throwaway reproduction is not
# coverage). Each assertion below was proven to fail against the pre-CON-188
# script (git show HEAD~1:core/scripts/emit-event.sh, in a scratch copy)
# before being shown green — see files-modified.md for the per-assertion
# red/green record.
# =============================================================================

# --- 9.1: a real raise carries a well-formed escalation_id ------------------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" escalation --raise-only ticket=HEL-60 question=q options=a,b ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-60/events.jsonl"
check "--raise-only: escalation_id matches <TICKET>-<epoch_ms>-<hex>" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();const id=JSON.parse(l).escalation_id;console.log(/^HEL-60-\d+-[0-9a-f]+$/.test(id)?"yes":"no:"+id)' "$LOG")" \
  "yes"
rm -rf "$REPO"

REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-61 question=q options=a,b ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$REPO/.concertino/runs/HEL-61/events.jsonl" ] && break
  sleep 0.1
done
LOG="$REPO/.concertino/runs/HEL-61/events.jsonl"
check "--await: escalation_id matches <TICKET>-<epoch_ms>-<hex>" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();const id=JSON.parse(l).escalation_id;console.log(/^HEL-61-\d+-[0-9a-f]+$/.test(id)?"yes":"no:"+id)' "$LOG")" \
  "yes"
printf '{"answer":"x"}' > "$REPO/.concertino/runs/HEL-61/answer.json"
wait_killed_bounded "$AWAIT_PID" 20 || true
rm -rf "$REPO"

# Two raises in the same process invocation window must get distinct ids —
# design.md Decision 1's stated "two raises inside one second" case.
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" escalation --raise-only ticket=HEL-62 question=q1 options=a,b ) >/dev/null 2>&1
( cd "$REPO" && "$SCRIPT" escalation --raise-only ticket=HEL-62 question=q2 options=a,b ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-62/events.jsonl"
check "two raises on the same ticket get distinct escalation_ids" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const ids = ls.filter((e) => e.kind === "escalation.raised").map((e) => e.escalation_id);
    console.log(ids.length === 2 && ids[0] && ids[1] && ids[0] !== ids[1] ? "yes" : "no:" + JSON.stringify(ids));
  ' "$LOG")" \
  "yes"
rm -rf "$REPO"

# --- 9.2: all THREE escalation.timeout write sites carry escalation_id, ----
# and NO resolution_channel, distinctly -------------------------------------

# Site 1: --wait-only's own real-deadline check.
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" escalation --raise-only ticket=HEL-63 question=q ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-63/events.jsonl"
RAISED_ID="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).escalation_id)' "$LOG")"
( cd "$REPO" && CONCERTINO_ESCALATION_TIMEOUT_MIN=0 "$SCRIPT" escalation --wait-only max_wait_sec=5 ticket=HEL-63 ) >/dev/null 2>&1
check "--wait-only real-deadline timeout: escalation_id matches the raise" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const l = ls.find((e) => e.kind === "escalation.timeout");
    console.log(l && l.escalation_id === process.argv[2] ? "yes" : "no:" + JSON.stringify(l));
  ' "$LOG" "$RAISED_ID")" \
  "yes"
check "--wait-only real-deadline timeout: NO resolution_channel key" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const l = ls.find((e) => e.kind === "escalation.timeout");
    console.log("resolution_channel" in l ? "present" : "absent");
  ' "$LOG")" \
  "absent"
rm -rf "$REPO"

# Site 2: the on_kill TERM/INT trap.
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-64/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await ticket=HEL-64 question=q ) >/dev/null 2>&1 &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
RAISED_ID="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).escalation_id)' "$LOG")"
kill -TERM "$AWAIT_PID"
wait_killed_bounded "$AWAIT_PID" 10
check "on_kill (TERM) timeout: escalation_id matches the raise" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const l = ls.find((e) => e.kind === "escalation.timeout");
    console.log(l && l.escalation_id === process.argv[2] ? "yes" : "no:" + JSON.stringify(l));
  ' "$LOG" "$RAISED_ID")" \
  "yes"
check "on_kill (TERM) timeout: NO resolution_channel key" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const l = ls.find((e) => e.kind === "escalation.timeout");
    console.log("resolution_channel" in l ? "present" : "absent");
  ' "$LOG")" \
  "absent"
rm -rf "$REPO"

# Site 3: --await's own bottom-of-script timeout (no kill, real deadline).
REPO="$(new_repo)"
( cd "$REPO" && CONCERTINO_ESCALATION_TIMEOUT_MIN=0 "$SCRIPT" escalation --await ticket=HEL-65 question=q ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-65/events.jsonl"
check "--await bottom-of-script timeout: escalation_id matches the raise" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const raised = ls.find((e) => e.kind === "escalation.raised");
    const timedOut = ls.find((e) => e.kind === "escalation.timeout");
    console.log(raised && timedOut && raised.escalation_id && timedOut.escalation_id === raised.escalation_id ? "yes" : "no:" + JSON.stringify({raised, timedOut}));
  ' "$LOG")" \
  "yes"
check "--await bottom-of-script timeout: NO resolution_channel key" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const l = ls.find((e) => e.kind === "escalation.timeout");
    console.log("resolution_channel" in l ? "present" : "absent");
  ' "$LOG")" \
  "absent"
rm -rf "$REPO"

# --- 9.3: discard_stale_answer()'s escalation.answer_discarded carries -----
# escalation_id ---------------------------------------------------------
REPO="$(new_repo)"
mkdir -p "$REPO/.concertino/runs/HEL-66"
printf '{"answer":"stale"}' > "$REPO/.concertino/runs/HEL-66/answer.json"
LOG="$REPO/.concertino/runs/HEL-66/events.jsonl"
( cd "$REPO" && CONCERTINO_ESCALATION_TIMEOUT_MIN=0 "$SCRIPT" escalation --await ticket=HEL-66 question=q ) >/dev/null 2>&1
check "escalation.answer_discarded: escalation_id matches the raise it belongs to" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const raised = ls.find((e) => e.kind === "escalation.raised");
    const discarded = ls.find((e) => e.kind === "escalation.answer_discarded");
    console.log(raised && discarded && raised.escalation_id && discarded.escalation_id === raised.escalation_id ? "yes" : "no:" + JSON.stringify({raised, discarded}));
  ' "$LOG")" \
  "yes"
rm -rf "$REPO"

# --- 9.4: a bogus resolution_channel is refused BEFORE any write -----------
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" escalation.answered ticket=HEL-67 answer=x resolution_channel=carrier-pigeon ) >"$REPO/out.txt" 2>"$REPO/err.txt"
RC=$?
check "bogus resolution_channel: non-zero exit" "$([ "$RC" -ne 0 ] && echo yes || echo no)" "yes"
check "bogus resolution_channel: stderr names the legal values" \
  "$(grep -c "dashboard, cli, chat, self-approved" "$REPO/err.txt")" \
  "1"
check "bogus resolution_channel: NO run directory was created at all" \
  "$([ -d "$REPO/.concertino/runs/HEL-67" ] && echo present || echo absent)" \
  "absent"
check "bogus resolution_channel: NO event line was written" \
  "$([ -f "$REPO/.concertino/runs/HEL-67/events.jsonl" ] && echo present || echo absent)" \
  "absent"
rm -rf "$REPO"

# Each of the four legal values IS accepted (task 3.5's other half — refusal
# alone would be a vacuous "everything is rejected" pass).
for CH in dashboard cli chat self-approved; do
  REPO="$(new_repo)"
  ( cd "$REPO" && "$SCRIPT" escalation.answered ticket=HEL-68 answer=x "resolution_channel=$CH" ) >/dev/null 2>&1
  RC=$?
  LOG="$REPO/.concertino/runs/HEL-68/events.jsonl"
  check "legal resolution_channel=$CH: accepted (exit 0)" "$RC" "0"
  check "legal resolution_channel=$CH: recorded verbatim" \
    "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).resolution_channel)' "$LOG")" \
    "$CH"
  rm -rf "$REPO"
done

# --- 9.5: the moved-to-top-level read_raised_field() serves every mode -----
# that now shares it: --await (same process), --raise-only + a LATER,
# separate --wait-only process (cross-process), and the resolve path with NO
# prior raise at all (must return empty, not error — design.md Decision 3).

# Cross-process: --raise-only in one invocation, --wait-only (a SEPARATE
# process) resolves it later and must still read the id back correctly.
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" escalation --raise-only ticket=HEL-69 question=q sub_questions='[{"question":"a?"},{"question":"b?"}]' ) >/dev/null 2>&1
LOG="$REPO/.concertino/runs/HEL-69/events.jsonl"
RAISED_ID="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).escalation_id)' "$LOG")"
echo '{"complete":true,"subAnswers":["1","2"]}' > "$REPO/.concertino/runs/HEL-69/answer.json"
( cd "$REPO" && timeout 10 "$SCRIPT" escalation --wait-only max_wait_sec=5 ticket=HEL-69 ) >/dev/null 2>&1
check "cross-process read_raised_field: --wait-only resolves the SAME escalation_id --raise-only wrote" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const l = ls.find((e) => e.kind === "escalation.answered");
    console.log(l && l.escalation_id === process.argv[2] ? "yes" : "no:" + JSON.stringify(l));
  ' "$LOG" "$RAISED_ID")" \
  "yes"
check "cross-process read_raised_field: also resolved sub_questions correctly (total=2, not 0)" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
    const l = ls.find((e) => e.kind === "escalation.answered");
    console.log(JSON.parse(l.sub_answers).length);
  ' "$LOG")" \
  "2"
rm -rf "$REPO"

# Resolve path with no prior raise at all: read_raised_field must return
# empty (not error) so the generic write path still appends with no
# escalation_id key, rather than being blocked or crashing.
REPO="$(new_repo)"
mkdir -p "$REPO/.concertino/runs/HEL-70"
( cd "$REPO" && "$SCRIPT" escalation.answered ticket=HEL-70 answer=x resolution_channel=cli ) >/dev/null 2>&1
RC=$?
LOG="$REPO/.concertino/runs/HEL-70/events.jsonl"
check "no prior raise: resolution still appends (exit 0)" "$RC" "0"
check "no prior raise: no escalation_id key (empty read_raised_field, not an error)" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log("escalation_id" in JSON.parse(l) ? "present" : "absent")' "$LOG")" \
  "absent"
rm -rf "$REPO"

# --- CON-189/CON-187/CON-194: verdict category/gate/head_sha validation ----
# CON-197 precedent: a validation that cannot fail is worse than none. Every
# refusal below is asserted RED against the pre-change script FIRST, then
# GREEN against the new one, so a vacuous check (one that would "pass" even
# if the refusal code were deleted) is caught here rather than assumed.
#
# CR2 (evaluation-1.md): the RED half must run unconditionally on every
# `npm test`, not only when an operator remembers to export
# PRE_CHANGE_SCRIPT — a skip-by-default is exactly the "missing committed
# shell-level coverage" shape CON-188 REFUTED on one ticket earlier in this
# batch. So the pre-change copy is now self-derived via `git show` against
# the review-base SHA this change was built against
# (d246b703059e8b8e5ecea6de31c8e46491edacac, permanently in this repo's
# history — the resolve-review-base.sh output recorded in
# files-modified.md), landed in the TMPDIR scratch dir tmp-scratch.sh already
# scopes and cleans up for this file. PRE_CHANGE_SCRIPT remains available as
# an explicit override (e.g. for testing against a different base), but is no
# longer the only path, and an unresolvable git-show is now a LOUD failure —
# a silent skip is what produced this finding in the first place.
CON189_BASE_SHA="d246b703059e8b8e5ecea6de31c8e46491edacac"
CON189_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ -n "${PRE_CHANGE_SCRIPT:-}" ] && [ -x "${PRE_CHANGE_SCRIPT}" ]; then
  PRE="$PRE_CHANGE_SCRIPT"
else
  PRE="$(mktemp)"
  if ! git -C "$CON189_REPO_ROOT" show "${CON189_BASE_SHA}:core/scripts/emit-event.sh" > "$PRE" 2>/dev/null; then
    # CON-189 cycle 3: a depth-1 (shallow) clone — CI's default before this
    # change added `fetch-depth: 0` to pr-ci.yml, and still a real
    # possibility outside CI — cannot resolve a blob from a commit git never
    # fetched. Try to deepen once before treating this as fatal, so the
    # RED-baseline proof is robust to a shallow clone wherever it runs, not
    # only in a CI job that remembered the workflow-level fix. `--unshallow`
    # only applies to an actually-shallow repo; a full clone reports
    # "--unshallow on a complete repository does not make sense" on stderr
    # and exits non-zero, which is fine to ignore here — the point is
    # whether the SECOND `git show` attempt below succeeds, not whether the
    # deepen command itself reported success.
    if [ "$(git -C "$CON189_REPO_ROOT" rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
      git -C "$CON189_REPO_ROOT" fetch --unshallow --quiet 2>/dev/null \
        || git -C "$CON189_REPO_ROOT" fetch --deepen=1000 --quiet 2>/dev/null \
        || true
    fi
    if ! git -C "$CON189_REPO_ROOT" show "${CON189_BASE_SHA}:core/scripts/emit-event.sh" > "$PRE" 2>/dev/null; then
      echo "FATAL: could not resolve pre-change core/scripts/emit-event.sh at ${CON189_BASE_SHA} via git show, even after attempting to deepen a shallow clone — the CON-197 RED-baseline proof cannot run. This is a loud failure, not a skip (CR2, evaluation-1.md). If this is CI, confirm the checkout step uses fetch-depth: 0." >&2
      exit 1
    fi
  fi
  chmod +x "$PRE"
fi

assert_red() {
  # $1=description $2..=k=v args to `verdict`; expects the PRE-change script
  # to exit 0 (i.e. NOT yet refusing) — proving the assertion below is
  # genuinely new coverage, not a vacuously-true check. PRE is always
  # resolved by this point (self-derived via git show, or an explicit
  # override) — no longer conditionally skipped.
  local desc="$1"; shift
  local d; d="$(new_repo)"
  ( cd "$d" && "$PRE" verdict ticket=HEL-90 role=evaluator "$@" ) >/dev/null 2>&1
  local rc=$?
  check "RED (pre-change): $desc still exits 0 (baseline had no validation)" "$rc" "0"
  rm -rf "$d"
}

# category: missing
assert_red "missing category" verdict=PASS
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-90 role=evaluator verdict=PASS ) >/dev/null 2>&1
RC=$?
check "GREEN: missing category refused (non-zero exit)" "$RC" "1"
check "GREEN: missing category — no event appended" \
  "$([ -f "$REPO/.concertino/runs/HEL-90/events.jsonl" ] && echo present || echo absent)" "absent"
rm -rf "$REPO"

# category: unknown value
assert_red "bogus category" verdict=PASS category=totally-bogus
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-91 role=evaluator verdict=PASS category=totally-bogus ) >/dev/null 2>&1
RC=$?
check "GREEN: bogus category refused (non-zero exit)" "$RC" "1"
check "GREEN: bogus category — no event appended" \
  "$([ -f "$REPO/.concertino/runs/HEL-91/events.jsonl" ] && echo present || echo absent)" "absent"
rm -rf "$REPO"

# category: each of the four legal values accepted and recorded verbatim
for CAT in mechanical spec-divergence design-judgment intent-mismatch; do
  REPO="$(new_repo)"
  ( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-92 role=evaluator verdict=PASS "category=$CAT" ) >/dev/null 2>&1
  RC=$?
  LOG="$REPO/.concertino/runs/HEL-92/events.jsonl"
  check "legal category=$CAT: accepted (exit 0)" "$RC" "0"
  check "legal category=$CAT: recorded verbatim" \
    "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).category)' "$LOG")" \
    "$CAT"
  rm -rf "$REPO"
done

# category on a non-verdict event: never required, but an illegal value is
# still refused (CON-189 task 2.3 / verdict-category spec scenario 5).
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" phase.enter ticket=HEL-93 role=orchestrator phase=Execution ) >/dev/null 2>&1
RC=$?
check "phase.enter with no category: exits 0 (category not required off verdicts)" "$RC" "0"
check "phase.enter with no category: still appended" \
  "$(grep -c phase.enter "$REPO/.concertino/runs/HEL-93/events.jsonl" || true)" "1"
rm -rf "$REPO"

REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" phase.enter ticket=HEL-94 role=orchestrator phase=Execution category=bogus ) >/dev/null 2>&1
RC=$?
check "phase.enter with category=bogus: refused (non-zero exit)" "$RC" "1"
check "phase.enter with category=bogus: no event appended" \
  "$([ -f "$REPO/.concertino/runs/HEL-94/events.jsonl" ] && echo present || echo absent)" "absent"
rm -rf "$REPO"

# head_sha: stated, malformed (39 chars, 8 chars, 40 non-hex) vs full 40-hex
FULLSHA="deadbeef00112233445566778899aabbccddeeff"
SHA39="${FULLSHA%?}"
SHA_NONHEX="zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"

assert_red "39-char head_sha" verdict=PASS category=mechanical "head_sha=$SHA39"
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-95 role=evaluator verdict=PASS category=mechanical "head_sha=$SHA39" ) >/dev/null 2>&1
RC=$?
check "GREEN: 39-char head_sha refused" "$RC" "1"
rm -rf "$REPO"

assert_red "8-char head_sha" verdict=PASS category=mechanical head_sha=deadbeef
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-96 role=evaluator verdict=PASS category=mechanical head_sha=deadbeef ) >/dev/null 2>&1
RC=$?
check "GREEN: 8-char head_sha refused" "$RC" "1"
rm -rf "$REPO"

assert_red "40-char non-hex head_sha" verdict=PASS category=mechanical "head_sha=$SHA_NONHEX"
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-97 role=evaluator verdict=PASS category=mechanical "head_sha=$SHA_NONHEX" ) >/dev/null 2>&1
RC=$?
check "GREEN: 40-char non-hex head_sha refused" "$RC" "1"
rm -rf "$REPO"

REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-98 role=evaluator verdict=PASS category=mechanical "head_sha=$FULLSHA" ) >/dev/null 2>&1
RC=$?
LOG="$REPO/.concertino/runs/HEL-98/events.jsonl"
check "GREEN: full 40-char head_sha accepted (exit 0)" "$RC" "0"
check "GREEN: full 40-char head_sha recorded, source=stated" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();const e=JSON.parse(l);console.log(e.head_sha+"|"+e.head_sha_source)' "$LOG")" \
  "$FULLSHA|stated"
rm -rf "$REPO"

# gate: required on role=skeptic only
assert_red "skeptic verdict with no gate" verdict=CONFIRM category=mechanical
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-990 role=skeptic verdict=CONFIRM category=mechanical ) >/dev/null 2>&1
RC=$?
check "GREEN: skeptic verdict with no gate refused" "$RC" "1"
rm -rf "$REPO"

REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-991 role=skeptic verdict=CONFIRM category=mechanical gate=bogus ) >/dev/null 2>&1
RC=$?
check "GREEN: skeptic verdict with illegal gate refused" "$RC" "1"
rm -rf "$REPO"

for G in design final; do
  REPO="$(new_repo)"
  ( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-992 role=skeptic verdict=CONFIRM category=mechanical "gate=$G" ) >/dev/null 2>&1
  RC=$?
  LOG="$REPO/.concertino/runs/HEL-992/events.jsonl"
  check "GREEN: skeptic gate=$G accepted (exit 0)" "$RC" "0"
  check "GREEN: skeptic gate=$G recorded verbatim" \
    "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).gate)' "$LOG")" \
    "$G"
  rm -rf "$REPO"
done

# evaluator/auditor verdicts are NOT required to state gate
REPO="$(new_repo)"
( cd "$REPO" && "$SCRIPT" verdict ticket=HEL-993 role=evaluator verdict=PASS category=mechanical ) >/dev/null 2>&1
RC=$?
check "GREEN: evaluator verdict with no gate still exits 0" "$RC" "0"
rm -rf "$REPO"

# --- CON-189 task 2.7 / CON-171: a refused auditor verdict still releases ---
# --- the Phase-4 teardown lease (design.md Decision 3) ----------------------
# shellcheck disable=SC1091
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/lib/auditor-lease.sh"

assert_refused_auditor_verdict_releases_lease() {
  # $1=description $2.. = extra k=v args that make the verdict get refused
  local desc="$1"; shift
  local WTREPO WT
  WTREPO="$(mktemp -d)"
  git -C "$WTREPO" init -q -b main
  git -C "$WTREPO" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  WT="$(mktemp -d)"; rm -rf "$WT"
  git -C "$WTREPO" worktree add -q -b "lease-test-branch-$$-$RANDOM" "$WT" main >/dev/null 2>&1

  local RESOLVED_ROOT CANON LEASE_FILE
  RESOLVED_ROOT="$(cd "$WT" && lease_resolve_root)"
  CANON="$(lease_canonicalize HEL-CON171)"
  lease_acquire "$RESOLVED_ROOT" "$CANON" "$WT" "check-merge-readiness.sh"
  LEASE_FILE="$(lease_path "$RESOLVED_ROOT" "$CANON")"

  local PRE_EXISTS="no"
  [ -f "$LEASE_FILE" ] && PRE_EXISTS="yes"
  check "$desc: lease exists before the refused verdict" "$PRE_EXISTS" "yes"

  ( cd "$WT" && "$SCRIPT" verdict ticket=HEL-CON171 role=auditor verdict=MERGE "$@" ) >/dev/null 2>&1
  local RC=$?
  check "$desc: verdict itself still exits non-zero" "$RC" "1"

  local POST_EXISTS="yes"
  [ -f "$LEASE_FILE" ] || POST_EXISTS="no"
  check "$desc: lease still released despite the refusal" "$POST_EXISTS" "no"

  git -C "$WTREPO" worktree remove --force "$WT" >/dev/null 2>&1
  rm -rf "$WTREPO" "$WT" 2>/dev/null
}

assert_refused_auditor_verdict_releases_lease "refused on illegal category" category=totally-bogus
assert_refused_auditor_verdict_releases_lease "refused on malformed head_sha" category=mechanical head_sha=deadbeef

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
