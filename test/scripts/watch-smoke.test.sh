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
# A second, throwaway session for the k/r/y checks below: killing the last
# window in a tmux session destroys the session itself, and those checks
# each deliberately kill the only window present — isolating them means the
# main $SESSION (and its window-count assumptions elsewhere in this file)
# is never at risk of the same fate.
KR_SESSION="concertino-smoke-$$-kr"
KR_WORK="$(mktemp -d)"
printf '{"dashboard":{"tmuxSession":"%s","launchCommand":"sleep 60 # {{TICKET}}"}}' "$KR_SESSION" \
  > "$KR_WORK/concertino.config.json"
cleanup() {
  tmux kill-session -t "$SESSION" 2>/dev/null
  tmux kill-session -t "$KR_SESSION" 2>/dev/null
  rm -rf "$WORK" "$KR_WORK"
}
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

# --- l drills into the run, esc backs out to the fleet ---------------------
# `l` (not enter — enter is already claimed by attach) opens the drill-down on
# the selected run; SMOKE-1 has no event log at all, so this also exercises
# the "no telemetry at all" degradation path end to end, not just a fixture.
printf 'l\x1bq' | timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after l + esc + q" "$STATUS" "0"
grep -q 'TIMELINE' "$OUT" && ok "l opens the drill-down" || bad "l opens the drill-down" "no TIMELINE panel in output"
grep -q 'no telemetry' "$OUT" && ok "the drill-down reports the uninstrumented run honestly" \
  || bad "the drill-down reports the uninstrumented run honestly" "no 'no telemetry' in output"
grep -q 'SMOKE-1' "$OUT" && ok "esc returns to the fleet (SMOKE-1 renders again)" \
  || bad "esc returns to the fleet (SMOKE-1 renders again)" "no SMOKE-1 in output after esc"

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

# --- k/r/y from the drill-down (slice-2b Important 1 & 2 regressions) ------
# The unit tests (test/control.test.js) already drive this against a fake
# session; this is the same seam end to end against a real tmux, so the
# window really dies (or really survives), not just a mock's call log. Each
# check runs against a single-window session so `l` (open the drill-down on
# the selected run, index 0) reliably targets it with no other windows to
# out-sort it.

# `k` then `y` on a live window really kills it.
tmux new-session -d -s "$KR_SESSION" -n KILL-9 'sleep 300'
printf 'lkyq' | timeout 10 node "$ROOT/bin/concertino" watch --out="$KR_WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after l+k+y+q (confirmed kill)" "$STATUS" "0"
tmux list-windows -t "$KR_SESSION" -F '#{window_name}' 2>/dev/null | grep -qx 'KILL-9' \
  && bad "k+y kills the confirmed window" "KILL-9 still present after k+y" \
  || ok "k+y kills the confirmed window"
tmux kill-session -t "$KR_SESSION" 2>/dev/null

# `r` then `y` on a window the dashboard never spawned (fails TICKET_RE — no
# trailing digit) is refused outright, and — this is the Important-1
# regression itself — the window survives rather than being destroyed ahead
# of a spawn that was always going to be refused. Fresh session: killing the
# lone window above ended the previous one.
tmux new-session -d -s "$KR_SESSION" -n adopted-window 'sleep 300'
printf 'lryq' | timeout 10 node "$ROOT/bin/concertino" watch --out="$KR_WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after l+r+y+q (refused restart)" "$STATUS" "0"
tmux list-windows -t "$KR_SESSION" -F '#{window_name}' 2>/dev/null | grep -qx 'adopted-window' \
  && ok "restart on a non-ticket-shaped window leaves it alive rather than destroying it" \
  || bad "restart on a non-ticket-shaped window leaves it alive rather than destroying it" \
       "adopted-window is gone — it was killed before validation refused the spawn"
grep -q 'not a ticket id' "$OUT" \
  && ok "the refusal is reported on screen, not swallowed" \
  || bad "the refusal is reported on screen, not swallowed" "no 'not a ticket id' in output"
tmux kill-session -t "$KR_SESSION" 2>/dev/null

# --- a typed reply survives a transient (non-"already answered") write failure
# slice-2a Important 2: answerEscalation used to clear escalationReply on ANY
# failed write, including an IO error that has nothing to do with what the
# human typed. Make the run directory read-only so store.writeAnswer's
# writeFileSync fails with EACCES (reason: 'error'), not EEXIST
# (reason: 'answered'), and confirm the typed text is still on screen after
# the failed submit rather than silently lost.
if [ "$(id -u)" -ne 0 ]; then
ESC_TICKET="ESC-1"
mkdir -p "$WORK/.concertino/runs/$ESC_TICKET"
printf '{"t":1,"kind":"escalation.raised","project":"p","ticket":"%s","role":"orchestrator","question":"proceed?","options":"approve,deny"}\n' \
  "$ESC_TICKET" > "$WORK/.concertino/runs/$ESC_TICKET/events.jsonl"
tmux new-window -t "$SESSION" -n "$ESC_TICKET" 'sleep 300'
chmod 555 "$WORK/.concertino/runs/$ESC_TICKET"

# ESC-1 is the only run with a live escalation (needs-you sorts first), so
# Enter with nothing else pressed yet opens it. 't' opens the reply box, the
# text follows, then Enter submits — which must fail here since the run
# directory cannot be written to. A trailing Escape (not '\r'/'\n', so it
# survives the piped-stdin trailing-newline strip) cancels the now-failed
# reply so the dashboard falls through to quitting cleanly on EOF.
printf '\rtkeep-this-text\r\x1b' | timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
chmod 755 "$WORK/.concertino/runs/$ESC_TICKET"

check "dashboard exits 0 after the failed submit" "$STATUS" "0"
grep -q 'keep-this-text' "$OUT" \
  && ok "typed reply text survives a failed (non-answered) write" \
  || bad "typed reply text survives a failed (non-answered) write" "'keep-this-text' missing from output"
grep -qi 'could not write answer' "$OUT" \
  && ok "the write error is surfaced on screen" \
  || bad "the write error is surfaced on screen" "no 'could not write answer' in output"
check "no escalation.answered was logged (write never succeeded)" \
  "$(grep -c escalation.answered "$WORK/.concertino/runs/$ESC_TICKET/events.jsonl")" "0"

tmux kill-window -t "$SESSION:$ESC_TICKET" 2>/dev/null
rm -rf "$WORK/.concertino/runs/$ESC_TICKET"
fi

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
