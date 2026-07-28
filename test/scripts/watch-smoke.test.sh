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
# launchCommand is inert on purpose: `n` must never start a real harness here.
printf '{"dashboard":{"tmuxSession":"%s","launchCommand":"sleep 60 # {{TICKET}}"}}' "$SESSION" \
  > "$WORK/concertino.config.json"
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

# --- `n` starts a run -------------------------------------------------------
# Piped stdin delivers the whole script as ONE chunk, so this also covers the
# per-key split: without it "nCON-777\rq" matches no key at all and the prompt
# is unreachable. The trailing q is what strips: the non-TTY path drops trailing
# newlines, which would eat the \r that submits.
printf 'nCON-777\rq' | timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after n + ticket + enter" "$STATUS" "0"
tmux list-windows -t "$SESSION" -F '#{window_name}' | grep -qx 'CON-777' \
  && ok "n spawned a tmux window named for the ticket" \
  || bad "n spawned a tmux window named for the ticket" "no CON-777 window in $SESSION"

# A launch that fails must land on the prompt, not take the dashboard down: one
# mistyped ticket cannot be allowed to lose sight of every other run. The shim
# is a real tmux for everything except new-window, which spawn() calls first.
REAL_TMUX="$(command -v tmux)"
mkdir -p "$WORK/bin"
{ echo '#!/usr/bin/env bash'
  echo 'for a in "$@"; do [ "$a" = "new-window" ] && { echo "tmux: refused by test shim" >&2; exit 1; }; done'
  echo "exec $REAL_TMUX \"\$@\""
} > "$WORK/bin/tmux"
chmod +x "$WORK/bin/tmux"

printf 'nCON-778\rq' | PATH="$WORK/bin:$PATH" timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "survives a failed launch" "$STATUS" "0"
grep -q 'could not start CON-778' "$OUT" \
  && ok "reports the failed launch on the prompt" \
  || bad "reports the failed launch on the prompt" "no 'could not start CON-778' in output"

# --- shell-injection regression ---------------------------------------------
# The exact payload confirmed to inject: launchCommand puts the ticket inside
# double quotes (`claude "/concertino-deliver {{TICKET}}"`), and a ticket of
# `$(touch <path>)` ran during shell expansion — before `claude` even started
# — the moment `session.spawn` handed the built string to `tmux
# respawn-window`. This drives the real prompt -> session.spawn -> tmux path
# (not a mock) with that payload and asserts the marker file never appears.
MARK="$WORK/injection-mark"
rm -f "$MARK"
printf 'n$(touch %s)\rq' "$MARK" | timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after a shell-injection payload as the ticket" "$STATUS" "0"
[ -e "$MARK" ] \
  && bad "rejects the \$(touch ...) payload without executing it" "marker file was created: $MARK" \
  || ok "rejects the \$(touch ...) payload without executing it"
grep -q 'not a ticket id' "$OUT" \
  && ok "reports the validation error on the prompt" \
  || bad "reports the validation error on the prompt" "no 'not a ticket id' in output"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
