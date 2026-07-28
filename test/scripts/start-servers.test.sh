#!/usr/bin/env bash
# Shell tests for core/scripts/start-servers.sh's gate.result telemetry
# (duration_ms). Run: bash test/scripts/start-servers.test.sh
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/core/scripts/start-servers.sh"
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

# --- a trivial local HTTP listener stands in for a real dev server ---------
LISTENER_PORT=$(( 20000 + (RANDOM % 20000) ))
node -e '
  require("http").createServer((_, res) => res.end("ok")).listen(process.argv[1]);
' "$LISTENER_PORT" &
LISTENER_PID=$!
cleanup_listener() { kill "$LISTENER_PID" 2>/dev/null || true; }
trap cleanup_listener EXIT

# Wait for it to actually be listening before exercising the "already
# healthy, reusing" branch below.
for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:${LISTENER_PORT}/" >/dev/null 2>&1 && break
  sleep 0.1
done

echo "start-servers.sh"

# --- a server gate.result (reuse branch) carries a numeric duration_ms -----
REPO="$(new_repo)"
WT="$REPO/HEL-1"
mkdir -p "$WT"
(
  cd "$REPO" && \
  CONCERTINO_BACKEND_CWD="." \
  CONCERTINO_BACKEND_START="true" \
  CONCERTINO_BACKEND_HEALTH="http://127.0.0.1:${LISTENER_PORT}/" \
  CONCERTINO_BACKEND_TIMEOUT="5" \
  "$SCRIPT" "$WT" 0 0
) > "$REPO/out.txt" 2>"$REPO/err.txt"
RC=$?
LOG="$REPO/.concertino/runs/HEL-1/events.jsonl"
check "exit 0"                     "$RC" "0"
check "stdout is READY backend"    "$(cat "$REPO/out.txt")" "READY backend=http://127.0.0.1:${LISTENER_PORT}/"
check "note: reused, on stderr"    "$(grep -c 'already healthy' "$REPO/err.txt")" "1"
check "emits gate.result"          "$([ -f "$LOG" ] && echo yes || echo no)" "yes"
check "kind is gate.result"        "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).kind)' "$LOG")" "gate.result"
check "gate is server:backend"     "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).gate)' "$LOG")" "server:backend"
check "status pass"                "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).status)' "$LOG")" "pass"
check "duration_ms is numeric"     "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(typeof JSON.parse(l).duration_ms)' "$LOG")" "number"
check "duration_ms non-negative"   "$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").trim();console.log(JSON.parse(l).duration_ms >= 0)' "$LOG")" "true"
rm -rf "$REPO"

# --- no frontend configured emits no second event, and no crash ------------
REPO="$(new_repo)"
WT="$REPO/HEL-2"
mkdir -p "$WT"
(
  cd "$REPO" && \
  CONCERTINO_BACKEND_START="" \
  CONCERTINO_FRONTEND_START="" \
  "$SCRIPT" "$WT" 0 0
) > "$REPO/out.txt" 2>/dev/null
RC=$?
check "exit 0 with nothing configured" "$RC" "0"
check "no stdout when nothing configured" "$(cat "$REPO/out.txt")" ""
rm -rf "$REPO"

# --- sub-second server gate reports true millisecond resolution ------------
# Same rationale as assert-phase.test.sh's analogous check: a single run of
# the near-instant "already healthy, reusing" branch could legitimately land
# on a millisecond tick (duration_ms == 0) without a bug present, so this
# samples several runs and only requires that NOT ALL of them collapse onto a
# multiple of 1000 — the old `date +%s` * 1000 measurement guaranteed one on
# every single run.
REPO="$(new_repo)"
WT="$REPO/HEL-3"
mkdir -p "$WT"
SAW_NON_MULTIPLE=no
for _ in $(seq 1 20); do
  (
    cd "$REPO" && \
    CONCERTINO_BACKEND_CWD="." \
    CONCERTINO_BACKEND_START="true" \
    CONCERTINO_BACKEND_HEALTH="http://127.0.0.1:${LISTENER_PORT}/" \
    CONCERTINO_BACKEND_TIMEOUT="5" \
    "$SCRIPT" "$WT" 0 0
  ) >/dev/null 2>&1
  LOG="$REPO/.concertino/runs/HEL-3/events.jsonl"
  D="$(node -e 'const lines=require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n");console.log(JSON.parse(lines[lines.length-1]).duration_ms)' "$LOG")"
  if [ "$((D % 1000))" -ne 0 ]; then
    SAW_NON_MULTIPLE=yes
    break
  fi
done
check "sub-second server-start run reports true ms resolution (non-1000-multiple duration_ms) within 20 tries" \
  "$SAW_NON_MULTIPLE" "yes"
rm -rf "$REPO"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
