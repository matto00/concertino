#!/usr/bin/env bash
# Shell tests for core/scripts/assert-phase.sh's gate.result telemetry
# (duration_ms / first_error). Run: bash test/scripts/assert-phase.test.sh
set -uo pipefail

# See emit-event.test.sh for why this is disabled: FORCE_COLOR would wrap
# node's bare-number output in ANSI codes even off a TTY.
export NO_COLOR=1
unset FORCE_COLOR

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/assert-phase.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

# Each test runs in a throwaway git repo so emit-event.sh's main-checkout
# resolution is exercised for real, exactly like emit-event.test.sh does.
new_repo() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q
  git -C "$d" commit -q --allow-empty -m init
  printf '%s' "$d"
}

echo "assert-phase.sh"

# --- passing phase emits a numeric duration and no first_error -------------
REPO="$(new_repo)"
WT="$REPO/worktrees/HEL-1"
mkdir -p "$WT/.git"          # satisfies the "looks like a git worktree" check
OUT="$(cd "$REPO" && "$SCRIPT" setup "$WT")"
RC=$?
LOG="$REPO/.concertino/runs/HEL-1/events.jsonl"
check "exit 0 on pass"          "$RC" "0"
check "stdout is PASS setup"    "$OUT" "PASS setup"
check "emits gate.result"       "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "one gate.result line"    "$(wc -l < "$LOG" | tr -d ' ')" "1"
check "kind is gate.result"     "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).kind)' "$LOG")" "gate.result"
check "status pass"             "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).status)' "$LOG")" "pass"
check "duration_ms is numeric"  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).duration_ms)' "$LOG")" "number"
check "duration_ms non-negative" "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).duration_ms >= 0)' "$LOG")" "true"
check "no first_error on pass"  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log("first_error" in JSON.parse(l))' "$LOG")" "false"
rm -rf "$REPO"

# --- failing phase emits a duration and the first failure message ----------
# The setup phase trips two checks in order when the worktree dir is simply
# missing (dir-missing, then not-a-git-worktree) — this doubles as coverage
# for "only the FIRST failure is recorded, not a concatenation of all of them".
REPO="$(new_repo)"
WT="$REPO/worktrees/HEL-2"     # deliberately never created
ERR="$(cd "$REPO" && "$SCRIPT" setup "$WT" 2>&1 >/dev/null)"
RC=$?
LOG="$REPO/.concertino/runs/HEL-2/events.jsonl"
check "exit 1 on fail"              "$RC" "1"
check "stderr reports first failure only as FAIL line 1" \
  "$(printf '%s\n' "$ERR" | sed -n '1p')" "FAIL worktree dir missing: $WT"
check "stderr also reports the second failure" \
  "$(printf '%s\n' "$ERR" | sed -n '2p')" "FAIL worktree not a git work tree: $WT"
check "emits gate.result"           "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "status fail"                 "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).status)' "$LOG")" "fail"
check "duration_ms is numeric"      "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).duration_ms)' "$LOG")" "number"
check "first_error is the FIRST failure message" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error)' "$LOG")" \
  "worktree dir missing: $WT"
rm -rf "$REPO"

# --- an oversized failure message is trimmed at the source ------------------
REPO="$(new_repo)"
mkdir -p "$REPO/HEL-3" && git -C "$REPO/HEL-3" init -q
LONG_BRANCH="$(head -c 300 /dev/zero | tr '\0' 'b')"
( cd "$REPO" && "$SCRIPT" delivery "$REPO/HEL-3" "$LONG_BRANCH" ) >/dev/null 2>&1
RC=$?
LOG="$REPO/.concertino/runs/HEL-3/events.jsonl"
EXPECTED_MSG="branch ${LONG_BRANCH} not pushed to origin"
check "exit 1 on fail"              "$RC" "1"
check "first_error trimmed to 200 chars" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error.length)' "$LOG")" "200"
check "first_error is a prefix of the untrimmed message" \
  "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).first_error)' "$LOG")" \
  "${EXPECTED_MSG:0:200}"
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
