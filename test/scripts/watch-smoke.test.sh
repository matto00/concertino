#!/usr/bin/env bash
# Smoke test for `concertino watch`: renders a live tmux window and exits on q.
# Guards the piped-stdin hang where `echo q` sent "q\n", never matched the quit
# key, and left the loop polling forever.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "concertino watch (smoke)"

if ! command -v tmux >/dev/null 2>&1; then
  echo "  skip (tmux not installed)"
  exit 0
fi

# Session name is unique per test process, never the default "concertino" —
# this must never touch a real user's dashboard session.
SESSION="concertino-smoke-$$"
WORK="$(mktemp -d)"
printf '{"dashboard":{"tmuxSession":"%s"}}' "$SESSION" > "$WORK/concertino.config.json"
cleanup() { tmux kill-session -t "$SESSION" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

tmux new-session -d -s "$SESSION" -n SMOKE-1 'sleep 300'

OUT="$WORK/out.txt"

printf q | timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 on q (printf, no newline)" "$STATUS" "0"
grep -q 'SMOKE-1'      "$OUT" && ok "renders the live window"      || bad "renders the live window"      "no SMOKE-1 in output"
grep -q 'no telemetry' "$OUT" && ok "reports missing telemetry"    || bad "reports missing telemetry"    "no 'no telemetry' in output"

echo q | timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 on q (echo, trailing newline)" "$STATUS" "0"

# Immediate EOF: 'data' never fires at all, so a quit path that lives only in
# the keypress handler leaves the poll loop spinning until the timeout kills it.
timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" < /dev/null > "$OUT" 2>&1
STATUS=$?
check "exits 0 on immediate EOF (< /dev/null)" "$STATUS" "0"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
