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
# CON-17: counts raw occurrences of an escape-sequence byte pattern in a
# captured output file — `grep -c` counts matching LINES, not occurrences,
# which would undercount a sequence that appears more than once with no
# newline in between (exactly what an alternate-buffer enter/exit pair looks
# like when written back-to-back around a fast-failing attach). `grep -o`
# emits one line per match instead, so `wc -l` gives the real count.
esc_count() { grep -o "$1" "$2" 2>/dev/null | wc -l | tr -d ' '; }
# CON-27: emits the captured output with one LINE per written terminal row.
# The differential writer positions every row it writes with its own
# `\x1b[<row>;1H` and no line feed at all (only the over-tall fallback still
# flows by newlines), so a captured session is now a single enormous line —
# and any check that reasons about the ORDER of two rows via `grep -n` line
# numbers, or that uses a `.*` pattern expecting it to stop at a row
# boundary, silently stops working. Splitting on the row-placement sequence
# restores both properties for those checks. Content-only checks (`grep -q`)
# and esc_count are unaffected and keep reading "$OUT" directly.
# Assumes GNU sed (`\x1b` in the pattern, `\n` in the replacement) — a known,
# pre-existing assumption in this suite, not a new one (see
# test/scripts/resolve-speed.test.sh's `sed -i` with no backup suffix).
rows_of() { sed 's/\x1b\[[0-9]\{1,\};1H/\n&/g' "$1"; }

echo "concertino watch (smoke)"

# CON-59: `concertino help` and `concertino --version` must stay explicit —
# unaffected by the bare-invocation default. Neither needs tmux, so these run
# unconditionally, before the tmux-availability skip below.
HELP_OUT="$(node "$ROOT/bin/concertino" help 2>&1)"
grep -q 'concertino watch' <<<"$HELP_OUT" \
  && ok "concertino help still prints help text" \
  || bad "concertino help still prints help text" "no 'concertino watch' entry in help output"
VERSION_OUT="$(node "$ROOT/bin/concertino" --version 2>&1)"
grep -q '^concertino v' <<<"$VERSION_OUT" \
  && ok "concertino --version still prints the version" \
  || bad "concertino --version still prints the version" "got: $VERSION_OUT"

if ! command -v tmux >/dev/null 2>&1; then
  echo "  skip (rest of suite — tmux not installed)"
  echo "  $PASS passed, $FAIL failed"
  [ "$FAIL" -eq 0 ]
  exit $?
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
  # Defined further down (nounset-safe): a timeout/interrupt hitting this trap
  # before either block runs must still clean up $SESSION/$KR_SESSION above
  # rather than aborting on an unset variable under `set -u`.
  [ -n "${LP2_SESSION:-}" ] && tmux kill-session -t "$LP2_SESSION" 2>/dev/null
  [ -n "${Q_SESSION:-}" ] && tmux kill-session -t "$Q_SESSION" 2>/dev/null
  [ -n "${H_SESSION:-}" ] && tmux kill-session -t "$H_SESSION" 2>/dev/null
  [ -n "${LP3_SESSION:-}" ] && tmux kill-session -t "$LP3_SESSION" 2>/dev/null
  rm -rf "$WORK" "$KR_WORK" "${LP2_WORK:-}" "${Q_WORK:-}" "${H_WORK:-}" "${LP3_WORK:-}"
}
trap cleanup EXIT

tmux new-session -d -s "$SESSION" -n SMOKE-1 'sleep 300'

OUT="$WORK/out.txt"

printf q | timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 on q (printf, no newline)" "$STATUS" "0"
grep -q 'SMOKE-1'      "$OUT" && ok "renders the live window"      || bad "renders the live window"      "no SMOKE-1 in output"
grep -q 'no telemetry' "$OUT" && ok "reports missing telemetry"    || bad "reports missing telemetry"    "no 'no telemetry' in output"
# CON-17: no full-screen clear anywhere in the dashboard's real lifetime
# (steady-state redraw AND quit()'s shutdown), and the alternate-screen
# buffer is entered exactly once (startup) and exited exactly once (quit) —
# real bytes from the real running dashboard, not a unit-test double.
check "no \\x1b[2J anywhere in the session (q)"        "$(esc_count $'\x1b\[2J' "$OUT")"     "0"
check "alternate buffer entered exactly once (q)"      "$(esc_count $'\x1b\[?1049h' "$OUT")"  "1"
check "alternate buffer exited exactly once (q)"       "$(esc_count $'\x1b\[?1049l' "$OUT")"  "1"
# CON-27: the real dashboard redraws through the DIFF path, not the old
# full-frame rewrite — every row it writes carries its own `\x1b[<row>;1H`
# placement, and the full-rewrite prefix `\x1b[H` never appears. Stdout is
# redirected to a file here, so process.stdout.rows is unset and the
# over-tall fallback (the only remaining CURSOR_HOME writer) can never
# trigger; a nonzero cursor-home count would mean the fallback fired when
# the terminal height is unknown, which design.md Decision 6 forbids.
# Deliberately NOT asserted here: "a steady-state tick with no state change
# writes nothing". The fleet frame carries per-second idle timers, so two
# consecutive real ticks are not reliably byte-identical and that assertion
# would be flaky end to end — it is covered deterministically instead by
# test/watch.test.js's "an entirely unchanged frame writes no bytes at all".
check "no full-rewrite cursor-home (\\x1b[H) in the session (q)" "$(esc_count $'\x1b\[H' "$OUT")" "0"
[ "$(esc_count $'\x1b\[[0-9]\{1,\};1H' "$OUT")" -gt 0 ] \
  && ok "redraws position each written row individually (differential path)" \
  || bad "redraws position each written row individually (differential path)" \
       "no \\x1b[<row>;1H placements in a real session's output"

# --- CON-59: bare `concertino` (no subcommand) launches the same dashboard
# as `concertino watch`, including --out flag resolution ---------------------
printf q | timeout 10 node "$ROOT/bin/concertino" --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "bare concertino (no subcommand) exits 0 on q" "$STATUS" "0"
grep -q 'SMOKE-1' "$OUT" \
  && ok "bare concertino renders the live window (same as concertino watch)" \
  || bad "bare concertino renders the live window" "no SMOKE-1 in output"

echo q | timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 on q (echo, trailing newline)" "$STATUS" "0"
check "no \\x1b[2J anywhere in the session (echo q)"   "$(esc_count $'\x1b\[2J' "$OUT")"     "0"
check "alternate buffer entered exactly once (echo q)" "$(esc_count $'\x1b\[?1049h' "$OUT")"  "1"
check "alternate buffer exited exactly once (echo q)"  "$(esc_count $'\x1b\[?1049l' "$OUT")"  "1"

# Immediate EOF: 'data' never fires at all, so a quit path that lives only in
# the keypress handler leaves the poll loop spinning until the timeout kills it.
# This also drives BOTH stdin 'end' and 'close' through the same quit() —
# without quit()'s re-entry guard this would double-write \x1b[?1049l.
timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" < /dev/null > "$OUT" 2>&1
STATUS=$?
check "exits 0 on immediate EOF (< /dev/null)" "$STATUS" "0"
check "no \\x1b[2J anywhere in the session (EOF)"      "$(esc_count $'\x1b\[2J' "$OUT")"     "0"
check "alternate buffer entered exactly once (EOF)"    "$(esc_count $'\x1b\[?1049h' "$OUT")"  "1"
check "alternate buffer exited exactly once (EOF)"     "$(esc_count $'\x1b\[?1049l' "$OUT")"  "1"

# --- Enter attaches; the alternate buffer is suspended around it and
# restored on return (design.md Decision 4) ---------------------------------
# tmux fails fast ("open terminal failed: not a terminal") with a non-tty
# stdout, so this reliably drives the suspend/restore pair without hanging:
# \r (attach the selected run) then q (quit). Total across the session: TWO
# enters (startup + post-attach restore) and TWO exits (pre-attach suspend +
# final quit).
printf '\rq' | timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after enter (attach attempt) + q" "$STATUS" "0"
check "no \\x1b[2J anywhere in the session (attach)"          "$(esc_count $'\x1b\[2J' "$OUT")"     "0"
check "alternate buffer entered twice (startup + post-attach)" "$(esc_count $'\x1b\[?1049h' "$OUT")" "2"
check "alternate buffer exited twice (pre-attach + quit)"      "$(esc_count $'\x1b\[?1049l' "$OUT")" "2"

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

# --- N opens the launch pad against a cold cache, no network, no key -------
# The launch pad's feature gate needs all three of dashboard.launchPad.enabled,
# ticketProvider.kind=linear, and LINEAR_API_KEY. This config sets the first
# two so the gate fails on the third, deterministically, without ever
# touching the network — `env -u` strips LINEAR_API_KEY even if the invoking
# shell happens to have one exported, so this assertion cannot flake against
# a developer's own login environment. Per linear.js's launchPadStatus, the
# failure must EXPLAIN itself rather than render nothing.
LP_WORK="$(mktemp -d)"
cat > "$LP_WORK/concertino.config.json" <<EOF
{"dashboard":{"tmuxSession":"$SESSION","launchPad":{"enabled":true}},"ticketProvider":{"kind":"linear","idExample":"CON-1"}}
EOF
printf 'N\x1bq' | env -u LINEAR_API_KEY timeout 10 node "$ROOT/bin/concertino" watch --out="$LP_WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after N + esc + q (no key)" "$STATUS" "0"
grep -q 'LINEAR_API_KEY' "$OUT" \
  && ok "the gate failure explains itself (LINEAR_API_KEY) rather than showing nothing" \
  || bad "the gate failure explains itself (LINEAR_API_KEY) rather than showing nothing" "no 'LINEAR_API_KEY' in output"

# Now with a (dummy, never used for a real request since 'r' is never
# pressed) key present, the gate passes and a cold cache — no
# .concertino/cache/linear.json at all — renders the "press r to fetch" hint
# rather than an empty list or a crash. Still no network call is made.
printf 'N\x1bq' | LINEAR_API_KEY=dummy-not-a-real-key timeout 10 node "$ROOT/bin/concertino" watch --out="$LP_WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after N + esc + q (cold cache, key present)" "$STATUS" "0"
grep -q 'press r to fetch' "$OUT" \
  && ok "a cold cache renders 'press r to fetch' with no network and no prior fetch" \
  || bad "a cold cache renders 'press r to fetch' with no network and no prior fetch" "no 'press r to fetch' in output"
rm -rf "$LP_WORK"

# --- Critical-1 regression: the launch pad refuses to (re-)select a ticket
# it already shows as "▲ running" ------------------------------------------
# Reproduced by hand against real tmux before this fix: `tmux new-window -n
# CON-9` when a window of that name already exists succeeds and creates a
# SECOND window with the same name, after which `capture-pane`/`kill-window
# -t sess:CON-9` both fail — "can't find window", ambiguous target. CON-9 is
# "already running" via a real tmux window in a dedicated session; the
# launch pad's own ticket cache is seeded directly (no network) with a
# ticket sharing that identifier — exactly the reviewer's failure scenario
# (a ticket started by hand, then reachable again from the launch pad).
LP2_SESSION="concertino-smoke-$$-lp2"
LP2_WORK="$(mktemp -d)"
tmux new-session -d -s "$LP2_SESSION" -n CON-9 'sleep 300'
mkdir -p "$LP2_WORK/.concertino/cache"
printf '{"schemaVersion":3,"fetchedAt":%s,"teamKey":"CON","tickets":[{"identifier":"CON-9","title":"already-running-ticket","epicId":"e1","epicName":"Epic","state":{"name":"Todo","type":"unstarted"}}],"epics":[{"id":"e1","name":"Epic","openCount":1}]}' \
  "$(($(date +%s) * 1000))" > "$LP2_WORK/.concertino/cache/linear.json"
cat > "$LP2_WORK/concertino.config.json" <<EOF
{"dashboard":{"tmuxSession":"$LP2_SESSION","launchPad":{"enabled":true}},"ticketProvider":{"kind":"linear","idExample":"CON-1"}}
EOF
# N (open) · Tab (switch to tickets pane) · space (attempt select CON-9) ·
# a (attempt select-all) · esc (back to fleet) · q (quit).
printf 'N\t a\x1bq' | LINEAR_API_KEY=dummy-not-a-real-key timeout 10 node "$ROOT/bin/concertino" watch --out="$LP2_WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after N + attempted select + select-all + esc + q" "$STATUS" "0"
grep -q '▲ running' "$OUT" \
  && ok "the already-running ticket shows ▲ running in the launch pad" \
  || bad "the already-running ticket shows ▲ running in the launch pad" "no '▲ running' in output"
grep -q '\[x\] CON-9' "$OUT" \
  && bad "refuses to select a ticket already showing ▲ running" "CON-9 was selected ([x]) despite being live — see launchpad.js's isSelectable" \
  || ok "refuses to select a ticket already showing ▲ running (space and 'a' both no-op)"
tmux kill-session -t "$LP2_SESSION" 2>/dev/null
rm -rf "$LP2_WORK"

# --- Critical-2 regression: an active queue is visible, and quitting with
# tickets still queued warns instead of silently discarding them -----------
# Before this fix, only queueNotice (a FAILURE string) ever reached the
# footer, and `q` quit unconditionally regardless of what was still queued.
Q_SESSION="concertino-smoke-$$-queue"
Q_WORK="$(mktemp -d)"
mkdir -p "$Q_WORK/.concertino/cache"
printf '{"schemaVersion":3,"fetchedAt":%s,"teamKey":"CON","tickets":[{"identifier":"CON-21","title":"batch-one","epicId":"e2","epicName":"Batch","state":{"name":"Todo","type":"unstarted"}},{"identifier":"CON-22","title":"batch-two","epicId":"e2","epicName":"Batch","state":{"name":"Todo","type":"unstarted"}}],"epics":[{"id":"e2","name":"Batch","openCount":2}]}' \
  "$(($(date +%s) * 1000))" > "$Q_WORK/.concertino/cache/linear.json"
cat > "$Q_WORK/concertino.config.json" <<EOF
{"dashboard":{"tmuxSession":"$Q_SESSION","launchPad":{"enabled":true},"launchCommand":"sleep 60 # {{TICKET}}"},"ticketProvider":{"kind":"linear","idExample":"CON-1"}}
EOF
# N (open) · Tab (tickets pane) · space (select CON-21) · j (move) ·
# space (select CON-22) · s (sequential) · L (open plan) · enter (confirm —
# launches CON-21, queues CON-22) · j (harmless move, snapshot the footer) ·
# q (queued+running > 0: must ASK, not quit) · j (any other key: cancel) ·
# q (ask again) · q (repeated q: confirmed quit).
printf 'N\t j sL\rjqjqq' | LINEAR_API_KEY=dummy-not-a-real-key timeout 10 node "$ROOT/bin/concertino" watch --out="$Q_WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after launching a 2-ticket sequential batch and confirming quit" "$STATUS" "0"
grep -q '1 running' "$OUT" && grep -q '1 queued' "$OUT" \
  && ok "the active queue is shown persistently in the fleet footer (1 running, 1 queued)" \
  || bad "the active queue is shown persistently in the fleet footer" "no '1 running'/'1 queued' queue line in output"
grep -q 'quit with 2 ticket' "$OUT" \
  && ok "q with a live queue warns before quitting, rather than discarding it silently" \
  || bad "q with a live queue warns before quitting" "no 'quit with 2 ticket' warning in output"
grep -q 'quitting with 2 queued ticket' "$OUT" \
  && ok "the confirmed quit still reports what was abandoned, not silent" \
  || bad "the confirmed quit still reports what was abandoned" "no 'quitting with 2 queued ticket' notice in output"
tmux kill-session -t "$Q_SESSION" 2>/dev/null
rm -rf "$Q_WORK"

# --- Minor 1 regression: 'h' harness cycling is not advertised when a
# launchCommand override pins the actual command regardless -----------------
# Before this fix, `harnesses.length < 2` was the only gate, so with BOTH a
# launchCommand override and 2+ harnesses configured, 'h' still changed the
# displayed harness label while the real command stayed pinned — a footer
# hint promising something the key did not actually do.
H_SESSION="concertino-smoke-$$-harness"
H_WORK="$(mktemp -d)"
mkdir -p "$H_WORK/.concertino/cache"
printf '{"schemaVersion":3,"fetchedAt":%s,"teamKey":"CON","tickets":[{"identifier":"CON-31","title":"harness-check","epicId":"e3","epicName":"Epic3","state":{"name":"Todo","type":"unstarted"}}],"epics":[{"id":"e3","name":"Epic3","openCount":1}]}' \
  "$(($(date +%s) * 1000))" > "$H_WORK/.concertino/cache/linear.json"
cat > "$H_WORK/concertino.config.json" <<EOF
{"dashboard":{"tmuxSession":"$H_SESSION","launchPad":{"enabled":true},"launchCommand":"sleep 60 # {{TICKET}}"},"harnesses":["claude","codex"],"ticketProvider":{"kind":"linear","idExample":"CON-1"}}
EOF
# N (open) · Tab (tickets pane) · space (select CON-31) · L (open plan) ·
# esc (cancel plan) · esc (back to fleet) · q (quit).
printf 'N\t L\x1b\x1bq' | LINEAR_API_KEY=dummy-not-a-real-key timeout 10 node "$ROOT/bin/concertino" watch --out="$H_WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after N + select + L + esc + esc + q" "$STATUS" "0"
grep -q 'LAUNCH PLAN' "$OUT" \
  && ok "the launch plan opened" \
  || bad "the launch plan opened" "no LAUNCH PLAN in output"
grep -q 'h harness' "$OUT" \
  && bad "'h harness' is not advertised when a launchCommand override pins the real command" \
       "'h harness' hint shown despite dashboard.launchCommand being set — the label could cycle while the command stayed pinned" \
  || ok "'h harness' is not advertised when a launchCommand override pins the real command"
tmux kill-session -t "$H_SESSION" 2>/dev/null
rm -rf "$H_WORK"

# --- CON-35: P actually reorders the tickets pane, end to end --------------
# handleKey('P', ...) returning the right action, and renderLaunchPad sorting
# correctly against a hand-built fixture, are both covered by the unit tests
# in test/launchpad.test.js — but applyAction/openLaunchPad are private
# closures inside watch(opts) (see lib/ui/watch.js's own header comment above
# module.exports), so the only way to prove the REAL keypress reaches
# lp.ticketSort is end to end, against a real running dashboard. Two tickets,
# same epic, deliberately seeded in "None-then-Urgent" (identifier) order so
# a priority-sort toggle has something to actually change.
LP3_SESSION="concertino-smoke-$$-lp3"
LP3_WORK="$(mktemp -d)"
mkdir -p "$LP3_WORK/.concertino/cache"
tmux new-session -d -s "$LP3_SESSION" -n LP3-WINDOW 'sleep 300'
printf '{"schemaVersion":3,"fetchedAt":%s,"teamKey":"CON","tickets":[{"identifier":"CON-41","title":"none-priority-ticket","priority":0,"epicId":"e4","epicName":"Priorities","state":{"name":"Todo","type":"unstarted"}},{"identifier":"CON-42","title":"urgent-priority-ticket","priority":1,"epicId":"e4","epicName":"Priorities","state":{"name":"Todo","type":"unstarted"}}],"epics":[{"id":"e4","name":"Priorities","openCount":2}]}' \
  "$(($(date +%s) * 1000))" > "$LP3_WORK/.concertino/cache/linear.json"
cat > "$LP3_WORK/concertino.config.json" <<EOF
{"dashboard":{"tmuxSession":"$LP3_SESSION","launchPad":{"enabled":true}},"ticketProvider":{"kind":"linear","idExample":"CON-1"}}
EOF
# N (open) · Tab (tickets pane) · P (toggle priority sort — CON-42 (Urgent)
# must now render ahead of CON-41 (None), reversing the seeded order) ·
# esc (back to fleet, so no further launch-pad frame is drawn) · q (quit).
printf 'N\tP\x1bq' | LINEAR_API_KEY=dummy-not-a-real-key timeout 10 node "$ROOT/bin/concertino" watch --out="$LP3_WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after N + Tab + P + esc + q" "$STATUS" "0"
# Matched against the "[ ]" checkbox prefix so this only finds the TICKETS
# PANE row, not the inline detail pane's own header line (CON-35) — which
# also renders the selected ticket's identifier and would otherwise be the
# last match, silently defeating this ordering check.
# Read through rows_of, not "$OUT" directly: under CON-27's differential
# writer each row is placed by its own escape sequence with no line feed, so
# on the raw file both greps report line 1 and the ordering comparison below
# is vacuous. rows_of puts each written row back on its own line, which is
# also what keeps the `.*` above from wandering across row boundaries.
CON41_LINE="$(rows_of "$OUT" | grep -n '\[ \].*CON-41' | tail -1 | cut -d: -f1)"
CON42_LINE="$(rows_of "$OUT" | grep -n '\[ \].*CON-42' | tail -1 | cut -d: -f1)"
if [ -n "$CON41_LINE" ] && [ -n "$CON42_LINE" ] && [ "$CON42_LINE" -lt "$CON41_LINE" ]; then
  ok "P actually reorders the tickets pane — Urgent (CON-42) renders ahead of None (CON-41) after the real keypress"
else
  bad "P actually reorders the tickets pane" \
    "expected CON-42 (Urgent) to render before CON-41 (None) in the final frame; CON-41 line=$CON41_LINE CON-42 line=$CON42_LINE"
fi
tmux kill-session -t "$LP3_SESSION" 2>/dev/null
rm -rf "$LP3_WORK"

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
#
# CON-21: `$(touch <path>)` is not ticket-shaped (parseTicketInput rejects
# it), so it no longer reaches submitTicket/session.spawn at all — it now
# takes the SAME path any other free text takes, into the ticket-draft flow.
# This config carries no ticketProvider, so that flow's own provider gate
# refuses it inline before any drafting invocation (a real network/subprocess
# call) is ever started — a different message than before, but the same
# "the payload is neither executed nor silently swallowed" property.
MARK="$WORK/injection-mark"
rm -f "$MARK"
printf 'n$(touch %s)\rq' "$MARK" | timeout 10 node "$ROOT/bin/concertino" watch --out="$WORK" > "$OUT" 2>&1
STATUS=$?
check "exits 0 after a shell-injection payload as the ticket" "$STATUS" "0"
[ -e "$MARK" ] \
  && bad "rejects the \$(touch ...) payload without executing it" "marker file was created: $MARK" \
  || ok "rejects the \$(touch ...) payload without executing it"
grep -q 'ticket drafting needs ticketProvider.kind' "$OUT" \
  && ok "reports the ticket-draft provider gate on the prompt" \
  || bad "reports the ticket-draft provider gate on the prompt" \
       "no 'ticket drafting needs ticketProvider.kind' in output"

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
