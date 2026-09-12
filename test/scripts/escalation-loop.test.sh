#!/usr/bin/env bash
# End-to-end proof of the whole control-plane loop: the real
# core/scripts/emit-event.sh escalation --await, blocked in the background
# against a throwaway repo, answered through the dashboard's own writer
# (lib/ui/store.js writeAnswer) rather than a hand-rolled `node -e` write.
# This is the one test that proves the two halves (already-built --await,
# and this task's writer) actually fit together.
set -uo pipefail

# CON-181: scope every mktemp/mktemp -d call in this file to a scratch
# TMPDIR removed on exit -- see test/scripts/lib/tmp-scratch.sh.
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/tmp-scratch.sh"
trap con181_cleanup_scratch EXIT

# CON-183: bound every `wait` on a backgrounded --await -- see
# lib/wait-bounded.sh for the full rationale (a plain unbounded `wait` on a
# killed --await hung the emit-event.sh suite ~20 minutes during a cold
# review of PR #138 on 2026-09-11).
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/wait-bounded.sh"

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

wait_killed_bounded "$AWAIT_PID" 20; AWAIT_RC=$?
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

wait_killed_bounded "$AWAIT_PID" 20; AWAIT_RC=$?
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

wait_killed_bounded "$AWAIT_PID" 20; AWAIT_RC=$?
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

# --- CON-180: the malformed-dedupe hash must come from the SAME read as -----
# the verdict it deduplicates -----------------------------------------------
#
# Root-cause reproduction (cycle-2 review): the pre-fix code computed the
# malformed verdict from one `readFileSync` (inside a node subprocess) and
# then re-read $ANSWER_FILE a second time via a separate bash-side `cksum`
# call, to derive the dedupe marker's hash. Between those two reads, nothing
# stops the file from being rewritten — and this repo's own
# store.writeSubAnswer() does exactly that (tmp+rename) whenever an
# escalation's malformed answer.json is subsequently corrected. A verdict
# computed from stale content, paired with a hash computed from fresh
# content, defeats the marker: the marker never matches what the CURRENT
# verdict was actually about, so it re-warns even though nothing "new", from
# a single consistent read's point of view, ever happened. This matches the
# CI dump (run 34593785095): two escalation.malformed events, one poll
# apart, identical reason, the second landing right after the test's own
# write to answer.json.
#
# To make this race deterministic instead of relying on real scheduling luck,
# reconstruct the OLD (pre-CON-180-fix) two-read shape and inject a
# controllable delay between its two reads via CON180_RACE_WINDOW_SEC (a
# test-only hook that does not exist in, and is irrelevant to, the actual
# fixed script itself).
#
# Built from a COPY of the real, current $SCRIPT via a literal string
# substitution -- deliberately NOT `git show HEAD:...`. This file's own
# earlier revision made exactly that mistake: once the CON-180 fix and this
# test landed in the SAME commit, `git show HEAD:core/scripts/emit-event.sh`
# in CI resolved to the ALREADY-FIXED script (HEAD is self-referential once
# committed), silently producing a mutant identical to the real script and
# making this whole reproduction vacuous -- caught only because the python
# assertion below (correctly) refused to match a cksum line that no longer
# existed... except that failure didn't abort the test file (no `set -e`
# here), so the suite kept going with a WRONG, non-representative mutant.
# Both mistakes are fixed here: no git history involved, and a hard abort if
# the literal substitution's premise (the fixed script's exact current
# shape) doesn't hold.
OLD_MUTANT="$(mktemp)"
cp "$SCRIPT" "$OLD_MUTANT"
python3 - "$OLD_MUTANT" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    src = f.read()
# Revert the MALFORMED-branch node code to the pre-fix one-arg shape (no
# hash coupled to the verdict string).
node_old = 'const malformed = (msg) => process.stdout.write("MALFORMED:" + rawHash + ":" + msg);'
node_new = 'const malformed = (msg) => process.stdout.write("MALFORMED:" + msg);'
assert src.count(node_old) == 1, "premise changed: emit-event.sh's malformed() helper no longer matches the expected fixed shape"
src = src.replace(node_old, node_new)
# Revert the bash-side parsing to the pre-fix two-read shape: the verdict's
# reason is the WHOLE payload again (no hash prefix to split off), and
# content_hash goes back to a SEPARATE, later `cksum` re-read -- with the
# injected window this test controls.
bash_old = (
    '        local payload="${result#MALFORMED:}"\n'
    '        content_hash="${payload%%:*}"\n'
    '        reason="${payload#*:}"\n'
)
bash_new = (
    '        reason="${result#MALFORMED:}"\n'
    '        [ -n "${CON180_RACE_WINDOW_SEC:-}" ] && sleep "$CON180_RACE_WINDOW_SEC"\n'
    '        content_hash="$(cksum "$ANSWER_FILE" 2>/dev/null)"\n'
)
assert src.count(bash_old) == 1, "premise changed: emit-event.sh's MALFORMED-branch parsing no longer matches the expected fixed shape"
src = src.replace(bash_old, bash_new)
with open(path, "w") as f:
    f.write(src)
PYEOF
PYRC=$?
if [ "$PYRC" -ne 0 ]; then
  echo "FATAL: CON-180 mutant generation failed (see traceback above) -- core/scripts/emit-event.sh's shape has drifted from what this test expects. Aborting rather than running the CON-180 checks below against a wrong/vacuous mutant." >&2
  exit 1
fi
chmod +x "$OLD_MUTANT"

MALFORMED_A='{"answer":"a","complete":true}'
MALFORMED_B='{"subAnswers":["x"],"total":2,"complete":true}'

# --- reproduction: the OLD two-read shape really does produce an
# inconsistent (stale-reason, fresh-hash) event under this race ------------
REPO="$(new_repo)"
TICKET=HEL-978
LOG="$REPO/.concertino/runs/$TICKET/events.jsonl"
ANSWER_FILE="$REPO/.concertino/runs/$TICKET/answer.json"
( cd "$REPO" && CON180_RACE_WINDOW_SEC=2 "$OLD_MUTANT" escalation --await \
    ticket="$TICKET" role=orchestrator \
    sub_questions='[{"question":"a?","options":["y","n"]},{"question":"b?","options":["y","n"]}]' \
  ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
# `discard_stale_answer()` (called before the raise) removes any answer.json
# that pre-dates this escalation, so A has to land AFTER raising, not before.
mkdir -p "$(dirname "$ANSWER_FILE")"
printf '%s' "$MALFORMED_A" > "$ANSWER_FILE"
# The mutant's setup work (MULTI_PART/TOTAL derivation, trap install) takes
# a little longer than the raise itself, so give its first poll tick a full
# second to actually read A and enter its injected 2s sleep before B lands
# -- confirmed empirically (0.3s was too tight and let B's write win the
# race for the FIRST read too, which proves nothing). 1s still leaves ample
# margin inside the 2s window for B's write to land before the sleep ends.
sleep 1
printf '%s' "$MALFORMED_B" > "$ANSWER_FILE"
HASH_B="$(cksum "$ANSWER_FILE")"
sleep 3
kill "$AWAIT_PID" 2>/dev/null
wait_killed_bounded "$AWAIT_PID" 20
REPRO_LINE="$(grep escalation.malformed "$LOG" | head -1)"
check "CON-180 repro: the old two-read shape logs a malformed event" \
  "$([ -n "$REPRO_LINE" ] && echo yes || echo no)" "yes"
check "CON-180 repro: its reason describes the STALE content (A, missing subAnswers)" \
  "$(node -e 'console.log(/missing or not an array/.test(JSON.parse(process.argv[1]).reason))' "$REPRO_LINE")" \
  "true"
check "CON-180 repro: its content_hash is the FRESH content's hash (B), not A's -- the inconsistency itself" \
  "$(node -e 'console.log(JSON.parse(process.argv[1]).content_hash)' "$REPRO_LINE")" \
  "$HASH_B"
rm -rf "$REPO"

# --- the fix: the real script, raced identically, is never inconsistent ----
# Same maneuver (rewrite A->B in the instant right after raising) against
# the ACTUAL fixed script, no injected delay needed or possible -- content
# hash and verdict now come from the exact same in-memory buffer inside one
# node invocation, so there is no window between them left to land a rewrite
# in. Whichever content the verdict is actually based on (A or B, depending
# on real scheduling), its own hash must match -- never a stale/fresh split.
REPO="$(new_repo)"
TICKET=HEL-979
LOG="$REPO/.concertino/runs/$TICKET/events.jsonl"
ANSWER_FILE="$REPO/.concertino/runs/$TICKET/answer.json"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket="$TICKET" role=orchestrator \
    sub_questions='[{"question":"a?","options":["y","n"]},{"question":"b?","options":["y","n"]}]' \
  ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
mkdir -p "$(dirname "$ANSWER_FILE")"
printf '%s' "$MALFORMED_A" > "$ANSWER_FILE"
# CON-180's fix hashes with sha1 (crypto.createHash), not `cksum` -- match
# that here so the comparison below is apples-to-apples.
FIXED_HASH_A="$(sha1sum "$ANSWER_FILE" | awk '{print $1}')"
sleep 1
printf '%s' "$MALFORMED_B" > "$ANSWER_FILE"
FIXED_HASH_B="$(sha1sum "$ANSWER_FILE" | awk '{print $1}')"
sleep 3
kill "$AWAIT_PID" 2>/dev/null
wait_killed_bounded "$AWAIT_PID" 20
FIXED_LINE="$(grep escalation.malformed "$LOG" | head -1)"
check "CON-180 fix: a malformed event was logged" "$([ -n "$FIXED_LINE" ] && echo yes || echo no)" "yes"
check "CON-180 fix: reason and content_hash are mutually consistent (both A, or both B -- never split)" \
  "$(node -e '
    const e = JSON.parse(process.argv[1]);
    const hashA = process.argv[2], hashB = process.argv[3];
    const isA = /missing or not an array/.test(e.reason);
    const isB = /arity mismatch/.test(e.reason);
    if (isA) { console.log(e.content_hash === hashA ? "consistent" : "INCONSISTENT:" + e.content_hash); }
    else if (isB) { console.log(e.content_hash === hashB ? "consistent" : "INCONSISTENT:" + e.content_hash); }
    else { console.log("UNEXPECTED_REASON:" + e.reason); }
  ' "$FIXED_LINE" "$FIXED_HASH_A" "$FIXED_HASH_B")" \
  "consistent"
rm -rf "$REPO"
rm -f "$OLD_MUTANT"

# --- CON-179: sub-answer question-text provenance ---------------------------
write_sub_answer_q() {
  # Same writer, but passing the 6th (question) arg — the shape
  # controllers/escalation.js and lib/cli/answer.js now write in practice.
  node -e '
    const store = require(process.argv[1]);
    const result = store.writeSubAnswer(
      process.argv[2], process.argv[3], Number(process.argv[4]), process.argv[5], Number(process.argv[6]), process.argv[7]);
    console.log(JSON.stringify(result));
  ' "$ROOT/lib/ui/store.js" "$1" "$2" "$3" "$4" "$5" "$6"
}

# A well-formed answer.json, with each slot's own question text matching the
# CURRENTLY-raised escalation, resolves normally — provenance recorded but
# never rejected when it's simply correct.
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-350/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket=HEL-350 role=orchestrator \
    sub_questions='[{"question":"Keep foo?","options":["yes","no"]},{"question":"Rename bar?","options":["rename","keep"]}]' \
  ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
write_sub_answer_q "$REPO" HEL-350 0 yes 2 "Keep foo?" >/dev/null
write_sub_answer_q "$REPO" HEL-350 1 rename 2 "Rename bar?" >/dev/null
wait_killed_bounded "$AWAIT_PID" 20; AWAIT_RC=$?
check "CON-179 matching provenance: --await exits 0" "$AWAIT_RC" "0"
check "CON-179 matching provenance: stdout carries both answers" \
  "$(cat "$REPO/out.txt")" "$(printf 'yes\nrename')"
check "CON-179 matching provenance: escalation.answered carries plain values, not {question,value} objects" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
    const l = ls.find((x) => JSON.parse(x).kind === "escalation.answered");
    console.log(JSON.parse(JSON.parse(l).sub_answers).join(","));
  ' "$LOG")" \
  "yes,rename"
rm -rf "$REPO"

# CON-151's failure mode, made detectable: an answer.json whose stored
# question text at an index does NOT match this escalation's own
# currently-raised sub_questions[index] (e.g. left over from a differently-
# ordered or different raise of "this ticket's" escalation) must be rejected
# loudly as escalation.malformed, exactly like every other malformed shape —
# never silently misattributed to the wrong sub-question.
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-351/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket=HEL-351 role=orchestrator \
    sub_questions='[{"question":"Keep foo?","options":["yes","no"]},{"question":"Rename bar?","options":["rename","keep"]}]' \
  ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
# The stored text at index 1 belongs to a DIFFERENT question than the one
# actually raised at that index — the CON-151 off-by-one shape.
write_sub_answer_q "$REPO" HEL-351 0 yes 2 "Keep foo?" >/dev/null
write_sub_answer_q "$REPO" HEL-351 1 rename 2 "Ship it?" >/dev/null
sleep 3
check "CON-179 mismatch: --await is still running (malformed is non-terminal)" \
  "$(kill -0 "$AWAIT_PID" 2>/dev/null && echo running || echo exited)" "running"
check "CON-179 mismatch: never printed a decision" "$(cat "$REPO/out.txt")" ""
check "CON-179 mismatch: no escalation.answered was recorded" \
  "$(grep -c escalation.answered "$LOG" 2>/dev/null || true)" "0"
check "CON-179 mismatch: escalation.malformed was recorded" \
  "$(grep -c escalation.malformed "$LOG")" "1"
check "CON-179 mismatch: escalation.malformed names the index" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
    const l = ls.find((x) => JSON.parse(x).kind === "escalation.malformed");
    console.log(/index 1/.test(JSON.parse(l).reason));
  ' "$LOG")" \
  "true"
kill "$AWAIT_PID" 2>/dev/null
wait_killed_bounded "$AWAIT_PID" 20
rm -rf "$REPO"

# A legacy answer.json (no `question` on any entry — the shape every
# answer.json had before CON-179) must still resolve normally: there is no
# provenance to check, so the resolve loop must not invent a mismatch.
REPO="$(new_repo)"
LOG="$REPO/.concertino/runs/HEL-352/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket=HEL-352 role=orchestrator \
    sub_questions='[{"question":"Keep foo?","options":["yes","no"]},{"question":"Rename bar?","options":["rename","keep"]}]' \
  ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
# Legacy 5-arg write_sub_answer (no question) -- pre-CON-179 shape.
write_sub_answer "$REPO" HEL-352 0 yes 2 >/dev/null
write_sub_answer "$REPO" HEL-352 1 rename 2 >/dev/null
wait_killed_bounded "$AWAIT_PID" 20; AWAIT_RC=$?
check "CON-179 legacy shape: --await still exits 0 (old files still resolve)" "$AWAIT_RC" "0"
check "CON-179 legacy shape: stdout carries both answers" \
  "$(cat "$REPO/out.txt")" "$(printf 'yes\nrename')"
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
wait_killed_bounded "$AWAIT_PID" 20; AWAIT_RC=$?
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


# --- CON-156: a malformed answer file (single-question shape on a --------
# multi-part escalation) must NOT resolve the wait with zero sub-answers.
# This is the exact file from the ticket: `{"answer": "...", "complete":
# true}`, missing `subAnswers` entirely, written to a two-question escalation.
REPO="$(new_repo)"
TICKET=HEL-973
LOG="$REPO/.concertino/runs/$TICKET/events.jsonl"
ANSWER_FILE="$REPO/.concertino/runs/$TICKET/answer.json"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket="$TICKET" role=orchestrator \
    sub_questions='[{"question":"Fold in toast?","options":["fold-in","standalone"]},{"question":"Follow-up severity?","options":["High","Medium"]}]' \
  ) > "$REPO/out.txt" 2> "$REPO/err.txt" &
AWAIT_PID=$!

for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
check "CON-156: escalation.raised landed" \
  "$(grep -c escalation.raised "$LOG" 2>/dev/null || echo 0)" "1"

# Write the malformed single-question-shaped file directly — this is what a
# human handed the wrong answer format actually produces, per the ticket.
mkdir -p "$(dirname "$ANSWER_FILE")"
printf '%s' '{"answer": "fold-in-toast-only; follow-up-1 standalone High", "complete": true}' > "$ANSWER_FILE"

# Give --await several poll ticks to prove the malformed file never resolves
# the wait — it must be treated exactly like no file / an incomplete file.
sleep 3
check "CON-156: malformed file does not resolve — --await is still running" \
  "$(kill -0 "$AWAIT_PID" 2>/dev/null && echo running || echo exited)" "running"
check "CON-156: no escalation.answered was recorded for the malformed file" \
  "$(grep -c escalation.answered "$LOG" 2>/dev/null || true)" "0"
check "CON-156: a diagnostic naming the problem was printed" \
  "$(grep -c 'malformed' "$REPO/err.txt" 2>/dev/null || echo 0)" "1"
# CON-156 (cycle 2, finding 3): `grep -c '2'` was vacuous — it would still
# pass even if the sub-question count were dropped from the message entirely,
# since digit '2' can appear incidentally elsewhere (a PID, a byte count).
# Match the exact phrase the node validator emits instead.
check "CON-156: the diagnostic names the expected sub-question count" \
  "$(grep -c 'expected an array of 2 answers, one per sub-question' "$REPO/err.txt" 2>/dev/null || echo 0)" "1"
# CON-156 (cycle 2, finding 2): a non-terminal escalation.malformed event is
# recorded in the log alongside the stderr diagnostic, so a dashboard viewer
# (or anyone tailing events.jsonl, not just the blocked --await caller) also
# learns something is wrong — and the escalation must stay open (NEEDS YOU),
# never be treated as resolved by this event.
check "CON-156: an escalation.malformed event was recorded" \
  "$(grep -c escalation.malformed "$LOG" 2>/dev/null || echo 0)" "1"
check "CON-156: escalation.malformed carries the same reason" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
    const l = ls.find((x) => JSON.parse(x).kind === "escalation.malformed");
    console.log(JSON.parse(l).reason);
  ' "$LOG")" \
  "subAnswers is missing or not an array (expected an array of 2 answers, one per sub-question)"

# Now write a well-formed multi-part answer over it — the escalation must
# still be resolvable once the file is fixed (non-destructive, self-correcting).
write_sub_answer "$REPO" "$TICKET" 0 fold-in 2 >/dev/null
write_sub_answer "$REPO" "$TICKET" 1 High 2 >/dev/null

wait_killed_bounded "$AWAIT_PID" 20; AWAIT_RC=$?
check "CON-156: --await exits 0 once a well-formed file replaces the malformed one" "$AWAIT_RC" "0"
check "CON-156: exactly one escalation.answered, from the well-formed write" \
  "$(grep -c escalation.answered "$LOG")" "1"
check "CON-156: recorded sub_answers are the real ones, not empty" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
    const l = ls.find((x) => JSON.parse(x).kind === "escalation.answered");
    console.log(JSON.parse(JSON.parse(l).sub_answers).join(","));
  ' "$LOG")" \
  "fold-in,High"
rm -rf "$REPO"

# --- CON-156: arity mismatch (fewer subAnswers than sub_questions) is --------
# handled the same way as a missing subAnswers array — treated as malformed,
# never resolved with a short/padded array.
REPO="$(new_repo)"
TICKET=HEL-974
LOG="$REPO/.concertino/runs/$TICKET/events.jsonl"
ANSWER_FILE="$REPO/.concertino/runs/$TICKET/answer.json"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket="$TICKET" role=orchestrator \
    sub_questions='[{"question":"a?","options":["y","n"]},{"question":"b?","options":["y","n"]},{"question":"c?","options":["y","n"]}]' \
  ) > "$REPO/out.txt" 2> "$REPO/err.txt" &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done

mkdir -p "$(dirname "$ANSWER_FILE")"
printf '%s' '{"subAnswers": ["y"], "total": 3, "complete": true}' > "$ANSWER_FILE"
sleep 3
check "CON-156 arity: mismatched-arity file does not resolve — --await still running" \
  "$(kill -0 "$AWAIT_PID" 2>/dev/null && echo running || echo exited)" "running"
check "CON-156 arity: no escalation.answered was recorded" \
  "$(grep -c escalation.answered "$LOG" 2>/dev/null || true)" "0"
check "CON-156 arity: an escalation.malformed event names the arity mismatch" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
    const l = ls.find((x) => JSON.parse(x).kind === "escalation.malformed");
    console.log(l ? JSON.parse(l).reason : "NONE");
  ' "$LOG")" \
  "subAnswers has 1 entries, expected 3 (one per sub-question) — arity mismatch"

kill "$AWAIT_PID" 2>/dev/null
wait_killed_bounded "$AWAIT_PID" 20
rm -rf "$REPO"

# --- CON-156 (cycle 3, finding 2): right-length but null/empty entries ------
# under complete:true is the same class of lie as a wrong-length array (a
# hand-edited or partially-clobbered answer.json) — must be rejected, never
# resolved with an empty answer for the null'd sub-question.
REPO="$(new_repo)"
TICKET=HEL-977
LOG="$REPO/.concertino/runs/$TICKET/events.jsonl"
ANSWER_FILE="$REPO/.concertino/runs/$TICKET/answer.json"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket="$TICKET" role=orchestrator \
    sub_questions='[{"question":"a?","options":["y","n"]},{"question":"b?","options":["y","n"]}]' \
  ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done

mkdir -p "$(dirname "$ANSWER_FILE")"
printf '%s' '{"subAnswers": ["x", null], "complete": true}' > "$ANSWER_FILE"
sleep 3
check "CON-156 null-entry: right-length-but-null file does not resolve — --await still running" \
  "$(kill -0 "$AWAIT_PID" 2>/dev/null && echo running || echo exited)" "running"
check "CON-156 null-entry: no escalation.answered was recorded" \
  "$(grep -c escalation.answered "$LOG" 2>/dev/null || true)" "0"
check "CON-156 null-entry: an escalation.malformed event names the null slot" \
  "$(node -e '
    const ls = require("fs").readFileSync(process.argv[1], "utf8").trim().split("\n");
    const l = ls.find((x) => JSON.parse(x).kind === "escalation.malformed");
    console.log(l ? JSON.parse(l).reason : "NONE");
  ' "$LOG")" \
  "subAnswers has a null/empty entry at index 1 while complete=true (every slot must be filled)"

# The escalation must still be resolvable once a genuinely complete file
# replaces the bad one — non-destructive, self-correcting, same as every
# other malformed case above.
write_sub_answer "$REPO" "$TICKET" 1 n 2 >/dev/null
wait_killed_bounded "$AWAIT_PID" 20; AWAIT_RC=$?
check "CON-156 null-entry: --await exits 0 once the null slot is genuinely filled" "$AWAIT_RC" "0"
rm -rf "$REPO"

# An empty-string entry is the same class of lie as null.
REPO="$(new_repo)"
TICKET=HEL-978
LOG="$REPO/.concertino/runs/$TICKET/events.jsonl"
ANSWER_FILE="$REPO/.concertino/runs/$TICKET/answer.json"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket="$TICKET" role=orchestrator \
    sub_questions='[{"question":"a?","options":["y","n"]}]' \
  ) > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
mkdir -p "$(dirname "$ANSWER_FILE")"
printf '%s' '{"subAnswers": [""], "complete": true}' > "$ANSWER_FILE"
sleep 2
check "CON-156 empty-string entry: does not resolve" \
  "$(kill -0 "$AWAIT_PID" 2>/dev/null && echo running || echo exited)" "running"
kill "$AWAIT_PID" 2>/dev/null
wait_killed_bounded "$AWAIT_PID" 20
rm -rf "$REPO"

# --- CON-156 (cycle 2, finding 4): the malformed-content dedupe marker must ---
# not survive past the escalation it warned about — a byte-identical
# malformed file raised again in a LATER escalation on the SAME ticket must
# still warn (the marker's whole job is de-duplicating repeats of the SAME
# still-open escalation, never suppressing a warning across escalations).
REPO="$(new_repo)"
TICKET=HEL-976
LOG="$REPO/.concertino/runs/$TICKET/events.jsonl"
ANSWER_FILE="$REPO/.concertino/runs/$TICKET/answer.json"
MALFORMED_JSON='{"answer": "x", "complete": true}'

( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket="$TICKET" role=orchestrator \
    sub_questions='[{"question":"a?","options":["y","n"]},{"question":"b?","options":["y","n"]}]' \
  ) > "$REPO/out1.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
mkdir -p "$(dirname "$ANSWER_FILE")"
printf '%s' "$MALFORMED_JSON" > "$ANSWER_FILE"
sleep 2
check "CON-156 marker: first escalation logs one escalation.malformed" \
  "$(grep -c escalation.malformed "$LOG" 2>/dev/null || echo 0)" "1"
check "CON-156 marker: malformed-warned marker file exists after the first escalation" \
  "$([ -f "$ANSWER_FILE.malformed-warned" ] && echo yes || echo no)" "yes"

# Resolve the first escalation properly, then discard_stale_answer's next run
# (triggered by raising a SECOND escalation on the same ticket) must clear the
# marker file — this simulates the run's next escalation, not a poll of the
# same one.
write_sub_answer "$REPO" "$TICKET" 0 y 2 >/dev/null
write_sub_answer "$REPO" "$TICKET" 1 n 2 >/dev/null
wait_killed_bounded "$AWAIT_PID" 20

( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket="$TICKET" role=orchestrator \
    sub_questions='[{"question":"c?","options":["y","n"]},{"question":"d?","options":["y","n"]}]' \
  ) > "$REPO/out2.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ "$(grep -c escalation.raised "$LOG" 2>/dev/null || echo 0)" -ge 2 ] && break
  sleep 0.1
done
# CON-156 flake fix: write_escalation_raised() (which is what the loop above
# polls for, via the escalation.raised line landing in LOG) and
# discard_stale_answer()'s `rm -f "$ANSWER_FILE.malformed-warned"` are two
# SEPARATE statements in the script (core/scripts/emit-event.sh) — the log
# write happens first, the marker removal second. Checking the marker in the
# same instant the log line appears races that gap: under load (this repo's
# full `npm test` run, many scripts executing concurrently) the marker check
# can observe the file before the script has reached its own rm -f, producing
# an intermittent false "yes" here. Poll for the marker's actual absence,
# bounded, rather than asserting on the log write alone.
for _ in $(seq 1 50); do
  [ -f "$ANSWER_FILE.malformed-warned" ] || break
  sleep 0.1
done
check "CON-156 marker: cleared by the second escalation's raise" \
  "$([ -f "$ANSWER_FILE.malformed-warned" ] && echo yes || echo no)" "no"

# The exact same malformed content, on the second escalation, must warn AGAIN
# (a second escalation.malformed event) — not be silently suppressed by a
# marker left over from the first.
#
# CI investigation (cycle 2, finding 9 / cycle 3, finding 1): this
# assertion failed on GitHub Actions (PR #135, test(16)/test(22)) with
# count=3 instead of 2, at both 358d2dc and 2bfda46 (the latter already had
# the marker-absence poll above). Cycle 2's own local reproduction attempt
# (5x under heavy load) never produced more than 1 event, but the cycle-3
# reviewer reproduced a genuinely different race (43/96) in the discard
# ordering when the answer is written before discard_stale_answer runs, and
# separately ran 0/96 standalone, 0/30 parallel-full-suite, and 0/16
# single-core reproductions of THIS specific count=3 symptom, ruling out
# byte-identical dedupe-marker collision, torn reads, cksum mismatch,
# writeSubAnswer, write_line double-writing, and an orphaned poller as
# causes. THE GOT-[3] CAUSE REMAINS UNCONFIRMED — this comment makes no
# claim to have found it; do not read the fix below as a root-cause claim.
#
# Cycle 2's own "fix" here was itself a bug: it broke out of its
# stabilization loop after just ONE unchanged 0.2s sample once the count
# reached 2, which is a FAR shorter window than emit-event.sh's own poll
# period (`try_resolve` then `sleep 1`) — so a genuine regression (e.g. a
# mutant that never writes `$ANSWER_FILE.malformed-warned` at all, which
# re-warns on every ~1s poll and would eventually reach count=4) could still
# land on a transient, unchanged count=2 or 3 reading inside a single 0.2s
# window and PASS. Fixed by waiting for the count to first reach >= 2, then
# observing across a FULL fixed window of at least two of emit-event.sh's
# own poll intervals (>= 2s) before taking the final reading — long enough
# that a same-process re-warn on the very next poll tick would show up, and
# NOT adaptively short-circuited the moment two consecutive samples happen
# to agree. On a mismatch, dump the run's own event log to help diagnose
# the still-open got-[3] question rather than requiring a re-run to see it.
printf '%s' "$MALFORMED_JSON" > "$ANSWER_FILE"
for _ in $(seq 1 100); do
  [ "$(grep -c escalation.malformed "$LOG" 2>/dev/null || echo 0)" -ge 2 ] && break
  sleep 0.1
done
sleep 2.5 # >= 2 full emit-event.sh poll intervals (1s each), fixed, not adaptive
FINAL_MALFORMED_COUNT="$(grep -c escalation.malformed "$LOG" 2>/dev/null || echo 0)"
if [ "$FINAL_MALFORMED_COUNT" != "2" ]; then
  echo "CON-156 marker assertion about to fail — dumping $LOG for diagnosis:" >&2
  cat "$LOG" >&2 2>/dev/null || true
fi
check "CON-156 marker: the second escalation ALSO logs its own escalation.malformed" \
  "$FINAL_MALFORMED_COUNT" "2"

kill "$AWAIT_PID" 2>/dev/null
wait_killed_bounded "$AWAIT_PID" 20
rm -rf "$REPO"

# --- CON-156: the single-question path is unaffected -----------------------
REPO="$(new_repo)"
TICKET=HEL-975
LOG="$REPO/.concertino/runs/$TICKET/events.jsonl"
( cd "$REPO" && "$SCRIPT" escalation --await \
    ticket="$TICKET" role=orchestrator question=q options=approve,deny ) \
  > "$REPO/out.txt" 2>/dev/null &
AWAIT_PID=$!
for _ in $(seq 1 50); do
  [ -f "$LOG" ] && grep -q escalation.raised "$LOG" 2>/dev/null && break
  sleep 0.1
done
RESULT="$(write_answer "$REPO" "$TICKET" approve)"
check "CON-156 regression: single-question writer still reports success" \
  "$(node -e "console.log(JSON.parse(process.argv[1]).ok)" "$RESULT")" "true"
wait_killed_bounded "$AWAIT_PID" 20; AWAIT_RC=$?
check "CON-156 regression: single-question --await still exits 0" "$AWAIT_RC" "0"
check "CON-156 regression: single-question --await still prints the answer" \
  "$(tr -d '\n' < "$REPO/out.txt")" "approve"
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
