#!/usr/bin/env bash
# Shell tests for core/scripts/report-cost.sh (track-per-run-cost-spend): the
# SessionEnd + SubagentStop hook body that sums a firing's INCREMENT of
# transcript token usage, resolves cost_usd via pricing-table.json, and calls
# emit-event.sh directly. Run: bash test/scripts/report-cost.test.sh
#
# Mirrors emit-event.test.sh's `new_repo` / events.jsonl-reading conventions
# — every test runs in a throwaway git repo so main_checkout() resolution is
# exercised for real, never this checkout's own .concertino/.
#
# report-cost.sh is invoked from ITS OWN location (core/scripts/), never
# copied into a scratch scripts/concertino/ dir first — its SCRIPT_DIR-
# relative lookups for emit-event.sh/pricing-table.json already resolve
# correctly there, since both sit right next to it in core/scripts/.
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/report-cost.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q -b main
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  printf '%s' "$d"
}

# json_field <file> <dotted.path> — reads the LAST line of a JSONL file (the
# most recently appended event) and prints one field, "undefined" (as a
# literal string) when the field/line is absent — never throws on a missing
# file (mirrors report-cost.sh's own "missing degrades to absent" posture).
json_field() {
  node -e '
    const fs = require("fs");
    let last;
    try {
      const lines = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").filter(Boolean);
      last = JSON.parse(lines[lines.length - 1]);
    } catch (e) { console.log("undefined"); process.exit(0); }
    const path = process.argv[2].split(".");
    let v = last;
    for (const p of path) v = (v == null) ? undefined : v[p];
    console.log(v === undefined ? "undefined" : v);
  ' "$1" "$2"
}

# event_count <file> — number of JSONL lines, "0" for a missing file.
event_count() {
  [ -f "$1" ] && wc -l < "$1" | tr -d ' ' || echo 0
}

write_transcript() {
  # $1 = path, $2.. = one assistant usage entry per remaining arg, each
  # "input,output,cacheRead,cacheCreation,model"
  local path="$1"; shift
  : > "$path"
  for entry in "$@"; do
    IFS=',' read -r inTok outTok cr cc model <<< "$entry"
    printf '{"type":"user","message":{"role":"user","content":"hi"}}\n' >> "$path"
    printf '{"type":"assistant","message":{"role":"assistant","model":"%s","usage":{"input_tokens":%s,"output_tokens":%s,"cache_read_input_tokens":%s,"cache_creation_input_tokens":%s}}}\n' \
      "$model" "$inTok" "$outTok" "$cr" "$cc" >> "$path"
  done
}

echo "report-cost.sh"

# --- 1. CONCERTINO_TICKET unset: clean no-op --------------------------------
REPO="$(new_repo)"
TRANSCRIPT="$REPO/transcript.jsonl"
write_transcript "$TRANSCRIPT" "100,50,0,0,claude-haiku-4-5-20251001"
PAYLOAD="{\"session_id\":\"s1\",\"hook_event_name\":\"SessionEnd\",\"transcript_path\":\"$TRANSCRIPT\"}"
( cd "$REPO" && unset CONCERTINO_TICKET && printf '%s' "$PAYLOAD" | "$SCRIPT" )
RC=$?
check "1.1 exits 0 with CONCERTINO_TICKET unset" "$RC" "0"
check "1.2 no .concertino/ directory ever created" "$([ -d "$REPO/.concertino" ] && echo yes || echo no)" "no"
rm -rf "$REPO"

# --- 2. SessionEnd, no agent_type -> role=orchestrator ----------------------
REPO="$(new_repo)"
TRANSCRIPT="$REPO/transcript.jsonl"
write_transcript "$TRANSCRIPT" "100,50,10,5,claude-haiku-4-5-20251001"
PAYLOAD="{\"session_id\":\"s2\",\"hook_event_name\":\"SessionEnd\",\"transcript_path\":\"$TRANSCRIPT\"}"
( cd "$REPO" && CONCERTINO_TICKET=CON-1 bash -c "printf '%s' '$PAYLOAD' | '$SCRIPT'" )
LOG="$REPO/.concertino/runs/CON-1/events.jsonl"
check "2.1 emits exactly one event"       "$(event_count "$LOG")" "1"
check "2.2 kind is run.cost"              "$(json_field "$LOG" kind)" "run.cost"
check "2.3 role defaults to orchestrator" "$(json_field "$LOG" role)" "orchestrator"
check "2.4 input_tokens summed"           "$(json_field "$LOG" input_tokens)" "100"
check "2.5 output_tokens summed"          "$(json_field "$LOG" output_tokens)" "50"
check "2.6 cache_read_tokens summed"      "$(json_field "$LOG" cache_read_tokens)" "10"
check "2.7 cache_creation_tokens summed"  "$(json_field "$LOG" cache_creation_tokens)" "5"
check "2.8 recognized model resolves cost_usd" "$([ "$(json_field "$LOG" cost_usd)" != "undefined" ] && echo present || echo absent)" "present"
rm -rf "$REPO"

# --- 3. SubagentStop with agent_type -> role derived correctly --------------
REPO="$(new_repo)"
TRANSCRIPT="$REPO/agent-transcript.jsonl"
write_transcript "$TRANSCRIPT" "200,80,0,0,claude-sonnet-4-5-20250929"
PAYLOAD="{\"session_id\":\"root-s\",\"agent_id\":\"agentA\",\"agent_type\":\"concertino-executor\",\"hook_event_name\":\"SubagentStop\",\"agent_transcript_path\":\"$TRANSCRIPT\"}"
( cd "$REPO" && CONCERTINO_TICKET=CON-2 bash -c "printf '%s' '$PAYLOAD' | '$SCRIPT'" )
LOG="$REPO/.concertino/runs/CON-2/events.jsonl"
check "3.1 emits exactly one event"          "$(event_count "$LOG")" "1"
check "3.2 role strips concertino- prefix"   "$(json_field "$LOG" role)" "executor"
check "3.3 ticket tagged"                    "$(json_field "$LOG" ticket)" "CON-2"
check "3.4 input_tokens from agent_transcript_path" "$(json_field "$LOG" input_tokens)" "200"
check "3.5 output_tokens from agent_transcript_path" "$(json_field "$LOG" output_tokens)" "80"
rm -rf "$REPO"

# --- 4. THE core regression: a resumed subagent's second SubagentStop firing
# must report only the INCREMENT, never a re-sum of the whole (appended)
# transcript. This is the exact bug design.md Decision 1/5 documents fixing.
REPO="$(new_repo)"
TRANSCRIPT="$REPO/agent-transcript.jsonl"
write_transcript "$TRANSCRIPT" "100,50,0,0,claude-haiku-4-5-20251001"
PAYLOAD="{\"session_id\":\"root-s\",\"agent_id\":\"agentB\",\"agent_type\":\"concertino-executor\",\"hook_event_name\":\"SubagentStop\",\"agent_transcript_path\":\"$TRANSCRIPT\"}"
( cd "$REPO" && CONCERTINO_TICKET=CON-3 bash -c "printf '%s' '$PAYLOAD' | '$SCRIPT'" )
LOG="$REPO/.concertino/runs/CON-3/events.jsonl"
check "4.1 first firing emits one event"        "$(event_count "$LOG")" "1"
check "4.2 first firing sums the full transcript" "$(json_field "$LOG" input_tokens)" "100"

# Resume: the SAME transcript file grows (appended, not replaced) — exactly
# what a real SubagentStop firing for a resumed agent_id looks like.
{
  printf '{"type":"user","message":{"role":"user","content":"continue"}}\n'
  printf '{"type":"assistant","message":{"role":"assistant","model":"claude-haiku-4-5-20251001","usage":{"input_tokens":30,"output_tokens":15,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}\n'
} >> "$TRANSCRIPT"
( cd "$REPO" && CONCERTINO_TICKET=CON-3 bash -c "printf '%s' '$PAYLOAD' | '$SCRIPT'" )
check "4.3 second firing emits a SECOND event (two total)" "$(event_count "$LOG")" "2"
LAST_INPUT="$(json_field "$LOG" input_tokens)"
check "4.4 second firing reports ONLY the increment (30), not a re-sum (130)" "$LAST_INPUT" "30"
LAST_OUTPUT="$(json_field "$LOG" output_tokens)"
check "4.5 second firing's output_tokens is also just the increment (15)" "$LAST_OUTPUT" "15"
rm -rf "$REPO"

# --- 5. Unrecognized model: tokens present, cost_usd omitted ----------------
REPO="$(new_repo)"
TRANSCRIPT="$REPO/transcript.jsonl"
write_transcript "$TRANSCRIPT" "42,7,0,0,some-future-model-id"
PAYLOAD="{\"session_id\":\"s5\",\"hook_event_name\":\"SessionEnd\",\"transcript_path\":\"$TRANSCRIPT\"}"
( cd "$REPO" && CONCERTINO_TICKET=CON-5 bash -c "printf '%s' '$PAYLOAD' | '$SCRIPT'" )
LOG="$REPO/.concertino/runs/CON-5/events.jsonl"
check "5.1 event still emitted"        "$(event_count "$LOG")" "1"
check "5.2 input_tokens still present" "$(json_field "$LOG" input_tokens)" "42"
check "5.3 cost_usd omitted, not 0"    "$(json_field "$LOG" cost_usd)" "undefined"
rm -rf "$REPO"

# --- 6. Missing/unreadable transcript: clean no-op --------------------------
REPO="$(new_repo)"
PAYLOAD="{\"session_id\":\"s6\",\"hook_event_name\":\"SessionEnd\",\"transcript_path\":\"$REPO/does-not-exist.jsonl\"}"
( cd "$REPO" && CONCERTINO_TICKET=CON-6 bash -c "printf '%s' '$PAYLOAD' | '$SCRIPT'" )
RC=$?
check "6.1 exits 0 for a missing transcript" "$RC" "0"
check "6.2 no event emitted for a missing transcript" "$(event_count "$REPO/.concertino/runs/CON-6/events.jsonl")" "0"
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
