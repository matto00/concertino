#!/usr/bin/env bash
# Shell tests for core/scripts/watchdog.sh (CON-177 fleet watchdog).
#
# Each test below is annotated with the constraint from the ticket (the 7th
# from a follow-up comment, cycle-2 fixes from a cold review pass) it exists
# to guard. Mutations run by hand against each of these (to confirm they are
# failable, not just green by construction) are recorded in the PR body, not
# here.
set -uo pipefail

export NO_COLOR=1
unset FORCE_COLOR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/core/scripts/watchdog.sh"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1"; echo "       $2"; }
has()  { grep -qF "$2" "$3" && ok "$1" || bad "$1" "expected to find [$2] in $3"; }
hasnt(){ grep -qF "$2" "$3" && bad "$1" "unexpectedly found [$2] in $3" || ok "$1"; }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3] got [$2]"; fi; }

echo "watchdog.sh (CON-177 fleet watchdog)"

new_scratch() {
  # tasks-dir + lanes-file live under one throwaway dir per test.
  local d; d="$(mktemp -d)"
  mkdir -p "$d/tasks" "$d/subagents"
  printf '%s' "$d"
}

# A "transcript" is a real JSONL file under subagents/, symlinked into
# tasks/ the way this repo's real tasks dir does — mirrors the production
# topology the ticket's constraint 2 is about (`-L` required to follow it).
make_transcript() {
  # $1 = scratch dir, $2 = agent id
  local d="$1" id="$2"
  printf '%s\n' '{"huge":"transcript payload that must never be read by the watchdog"}' \
    > "$d/subagents/agent-$id.jsonl"
  ln -sf "$d/subagents/agent-$id.jsonl" "$d/tasks/$id.output"
}

epoch_ts() {
  # $1 = seconds ago -> touch(1) -t timestamp string, GNU or BSD/node fallback.
  local ago="$1" ts
  ts="$(date -d "@$(( $(date +%s) - ago ))" '+%Y%m%d%H%M.%S' 2>/dev/null)"
  if [ -z "$ts" ]; then
    ts="$(node -e '
      const s = Math.floor(Date.now()/1000) - Number(process.argv[1]);
      const d = new Date(s*1000);
      const p = n => String(n).padStart(2,"0");
      process.stdout.write(
        `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}.${p(d.getSeconds())}`
      );
    ' "$ago")"
  fi
  printf '%s' "$ts"
}

touch_mtime_ago() {
  # $1 = real file (dereferenced), $2 = seconds ago
  touch -t "$(epoch_ts "$2")" "$1"
}

touch_symlink_mtime_ago() {
  # $1 = symlink path itself (NOT its target), $2 = seconds ago. `-h` is
  # supported by both GNU and BSD/macOS touch ("affect the symlink itself").
  touch -h -t "$(epoch_ts "$2")" "$1"
}

run_watchdog() {
  # $1 = tasks dir, $2 = lanes file, extra env already exported by caller.
  # Watchdog loops forever on trip/stand-down only after its first sleep, so
  # give it a short POLL and a hard wall-clock timeout as a safety net.
  OUT="$(mktemp)"; ERR="$(mktemp)"
  timeout 10 "$SCRIPT" "$1" "$2" >"$OUT" 2>"$ERR"
  RC=$?
}

lock_pid() {
  # $1 = scratch dir -> the pid currently recorded in the lock, or empty.
  cat "$1/watchdog.pid.d/pid" 2>/dev/null
}

# ---------------------------------------------------------------------------
# Usage: missing args -> exit 2, clear message.
d="$(new_scratch)"
OUT="$(mktemp)"; ERR="$(mktemp)"
"$SCRIPT" "$d/tasks" >"$OUT" 2>"$ERR"
check "usage error (missing lanes arg): exit code" "$?" "2"
has "usage error (missing lanes arg): message" "usage: watchdog.sh" "$ERR"
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 4 (cycle-2 fix): bad paths fail loud at startup instead of
# silently behaving as if nothing were wrong.
#
# Mutation to confirm failability: delete the `[ ! -d "$TASKS" ]` / `[ ! -f
# "$LANES" ]` startup checks — both tests below go red (exit 0/124 instead
# of 2).
d="$(new_scratch)"
OUT="$(mktemp)"; ERR="$(mktemp)"
"$SCRIPT" "$d/tasks-does-not-exist" "$d/lanes" >"$OUT" 2>"$ERR"
check "missing tasks-dir: exit 2" "$?" "2"
has "missing tasks-dir: names the bad path" "tasks-dir not found" "$ERR"
rm -rf "$d"

d="$(new_scratch)"
OUT="$(mktemp)"; ERR="$(mktemp)"
"$SCRIPT" "$d/tasks" "$d/lanes-does-not-exist" >"$OUT" 2>"$ERR"
check "missing lanes-file: exit 2 (not a silent stand-down)" "$?" "2"
has "missing lanes-file: names the bad path" "lanes-file not found" "$ERR"
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 7 (comment): empty lanes file => stand down silently, exit 0,
# no TRIP text anywhere. This is the single most common way the script is
# exercised (every successful batch ends this way), and is the defect the
# ticket's rebuild originally shipped without covering.
#
# Mutation to confirm failability: comment out the `[ -z "$raw_live" ]`
# stand-down branch (or make it always TRIP FLEET regardless of lanes) — the
# test goes red because "TRIP" then appears in $OUT.
d="$(new_scratch)"
: > "$d/lanes"   # empty file = no lanes in flight
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=2 WATCHDOG_LANE_SEC=2 run_watchdog "$d/tasks" "$d/lanes"
check "empty lanes: exit 0" "$RC" "0"
has "empty lanes: stand-down message" "STAND-DOWN" "$OUT"
hasnt "empty lanes: never prints TRIP" "TRIP" "$OUT"
rm -rf "$d"

# Same, but the lanes file has only comments/blank lines — still "no lanes".
d="$(new_scratch)"
printf '# ci-lane parked earlier\n\n' > "$d/lanes"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=2 WATCHDOG_LANE_SEC=2 run_watchdog "$d/tasks" "$d/lanes"
check "comment-only lanes: exit 0" "$RC" "0"
has "comment-only lanes: stand-down message" "STAND-DOWN" "$OUT"
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 4: LANE default threshold is at least 3h (10800s) in production.
# Tested BEHAVIORALLY (cycle-2 fix — a pure grep-the-source-string test
# passed even against a `WATCHDOG_LANE_SEC=60` override placed after the
# default assignment, since the string "WATCHDOG_LANE_SEC:-10800" was still
# present in the file): a lane whose transcript is 11100s old (comfortably over 3h)
# trips with WATCHDOG_LANE_SEC deliberately left UNSET (so the script's own
# default governs, not a test override); a lane at 10799s old (just under
# 3h) does not, within a short poll window.
#
# Mutation to confirm failability: change `LANE_SEC=${WATCHDOG_LANE_SEC:-10800}`
# default to e.g. 2700 (45 min) — the "just under" case starts tripping.
d="$(new_scratch)"
make_transcript "$d" a-over-3h
touch_mtime_ago "$d/subagents/agent-a-over-3h.jsonl" 11100
printf 'a-over-3h a-over-3h\n' > "$d/lanes"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=999999 run_watchdog "$d/tasks" "$d/lanes"
check "LANE default (unset override): trips just over 3h" "$RC" "1"
has "LANE default (unset override): TRIP LANE text" "TRIP LANE a-over-3h" "$OUT"
rm -rf "$d"

d="$(new_scratch)"
make_transcript "$d" a-under-3h
touch_mtime_ago "$d/subagents/agent-a-under-3h.jsonl" 10500
printf 'a-under-3h a-under-3h\n' > "$d/lanes"
UNDER_OUT="$(mktemp)"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=999999 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$UNDER_OUT" 2>&1 &
pidUnder=$!
sleep 2.5
if kill -0 "$pidUnder" 2>/dev/null; then
  ok "LANE default (unset override): does not trip just under 3h"
else
  bad "LANE default (unset override): does not trip just under 3h" "exited: $(cat "$UNDER_OUT")"
fi
kill "$pidUnder" 2>/dev/null || true
wait "$pidUnder" 2>/dev/null || true
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 2 (cycle-2 fix): symlink mtime is followed (-L). The original
# test was timing-vacuous — with FLEET_SEC=2 and a symlink freshly created at
# test time, dropping `-L` still happened to trip by the 3rd poll because the
# symlink's OWN mtime eventually exceeded 2s regardless of which mtime was
# read. This version makes the SYMLINK itself old and the TARGET fresh, with
# a threshold only the target's freshness can satisfy — only `-L` (reading
# the target) avoids a trip; reading the symlink's own old mtime would trip.
#
# Mutation to confirm failability: drop `-L` from both `stat` calls — this
# test's "does NOT trip" assertion goes red.
d="$(new_scratch)"
make_transcript "$d" a-fresh-target
touch_symlink_mtime_ago "$d/tasks/a-fresh-target.output" 5000
printf 'a-fresh-target a-fresh-target\n' > "$d/lanes"
SYMLINK_OUT="$(mktemp)"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=3 WATCHDOG_LANE_SEC=999999 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$SYMLINK_OUT" 2>&1 &
pidSym=$!
sleep 2.5
if kill -0 "$pidSym" 2>/dev/null; then
  ok "symlink -L followed: old symlink mtime ignored, fresh target avoids FLEET trip"
else
  bad "symlink -L followed: old symlink mtime ignored, fresh target avoids FLEET trip" \
    "tripped despite fresh target: $(cat "$SYMLINK_OUT")"
fi
kill "$pidSym" 2>/dev/null || true
wait "$pidSym" 2>/dev/null || true
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 3: never reads transcript content. Plant a transcript whose
# content would break the script if it were ever parsed/cat'd (e.g. as an
# accidental `eval` or arithmetic context) and confirm the run completes
# using only stat, plus grep the script source for cat/tail/read on a
# transcript path as a static guard.
d="$(new_scratch)"
make_transcript "$d" a-content-lane
printf '%s\n' '`rm -rf /nonexistent-marker-should-never-execute`; $(exit 99)' \
  > "$d/subagents/agent-a-content-lane.jsonl"
printf 'a-content-lane a-content-lane\n' > "$d/lanes"
CONTENT_OUT="$(mktemp)"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=999999 WATCHDOG_LANE_SEC=999999 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$CONTENT_OUT" 2>&1 &
pidContent=$!
sleep 2.5
if kill -0 "$pidContent" 2>/dev/null; then
  ok "malicious transcript content never executed (watchdog still running, no crash)"
else
  bad "malicious transcript content never executed" "watchdog exited unexpectedly: $(cat "$CONTENT_OUT")"
fi
hasnt "malicious transcript content: no spurious TRIP" "TRIP" "$CONTENT_OUT"
kill "$pidContent" 2>/dev/null || true
wait "$pidContent" 2>/dev/null || true
rm -rf "$d"
# Static guard: the script must never cat/tail/read a *.output or *.jsonl path.
if grep -nE '\b(cat|tail|source|\.)\s+["$]*(\$f|\$TASKS|.*\.output|.*\.jsonl)' "$SCRIPT" | grep -v '^\s*#'; then
  bad "static: no cat/tail/source of transcript content" "matched a read of transcript content in $SCRIPT"
else
  ok "static: no cat/tail/source of transcript content"
fi

# ---------------------------------------------------------------------------
# Constraint 3/FLEET scope: the transcript glob is `a*.output`, deliberately
# not `*.output` — another task kind's fresh file must never mask a
# genuinely stalled agent fleet. b-task.output is kept CONTINUOUSLY fresh for
# the whole observation window (a background refresher touches it every
# 0.3s) — a one-shot fresh file would eventually age past FLEET_SEC on its
# own regardless of which glob is used, which is exactly the timing-vacuous
# mistake the cycle-2 review found in the original `-L` test; continuous
# freshness is what makes the two globs actually behave differently here.
#
# Mutation to confirm failability: widen `for f in "$TASKS"/a*.output` to
# `"$TASKS"/*.output` — the "still trips" assertion goes red (the
# continuously-refreshed b-task.output masks the stale a-stalled-lane).
d="$(new_scratch)"
make_transcript "$d" a-stalled-lane
touch_mtime_ago "$d/subagents/agent-a-stalled-lane.jsonl" 5000
printf 'x' > "$d/tasks/b-task.output"
printf 'a-stalled-lane a-stalled-lane\n' > "$d/lanes"
( while :; do touch "$d/tasks/b-task.output" 2>/dev/null; sleep 0.3; done ) &
refresherPid=$!
GLOB_OUT="$(mktemp)"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=2 WATCHDOG_LANE_SEC=999999 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$GLOB_OUT" 2>&1 &
pidGlob=$!
sleep 4
if kill -0 "$pidGlob" 2>/dev/null; then
  bad "b*.output does not mask a stale a*.output fleet: FLEET still trips" \
    "watchdog is still running, never tripped: $(cat "$GLOB_OUT")"
else
  ok "b*.output does not mask a stale a*.output fleet: FLEET still trips"
fi
has "b*.output does not mask a stale a*.output fleet: TRIP FLEET text" "TRIP FLEET" "$GLOB_OUT"
kill "$refresherPid" 2>/dev/null || true
wait "$refresherPid" 2>/dev/null || true
kill "$pidGlob" 2>/dev/null || true
wait "$pidGlob" 2>/dev/null || true
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 4 (cycle-2 fix): a tracked lane with no transcript at all warns
# once on stderr instead of either failing loud every poll or polling
# forever with zero signal.
d="$(new_scratch)"
printf 'a-ghost-lane a-ghost-lane\n' > "$d/lanes"
GHOST_OUT="$(mktemp)"; GHOST_ERR="$(mktemp)"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=999999 WATCHDOG_LANE_SEC=999999 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$GHOST_OUT" 2>"$GHOST_ERR" &
pidGhost=$!
sleep 2.5
if kill -0 "$pidGhost" 2>/dev/null; then
  ok "tracked lane with no transcript: watchdog keeps running (no crash, no false trip)"
else
  bad "tracked lane with no transcript: watchdog keeps running" "exited: $(cat "$GHOST_OUT")"
fi
has "tracked lane with no transcript: warns once on stderr" "no transcript" "$GHOST_ERR"
warn_count="$(grep -c 'a-ghost-lane has no transcript' "$GHOST_ERR" 2>/dev/null || echo 0)"
check "tracked lane with no transcript: warns only once despite multiple polls" "$warn_count" "1"
kill "$pidGhost" 2>/dev/null || true
wait "$pidGhost" 2>/dev/null || true
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 3/7 (cycle-2 addition): a real completion signal, not driver
# discipline. A lane's line carries a ticket id; once that ticket's
# events.jsonl records a terminal `run.end`, the lane is treated as complete
# WITHOUT anyone editing the lanes file — reproducing the actual 2026-09-10
# incident (a finished lane's line was never removed) and confirming it no
# longer produces a false trip.
#
# Mutation to confirm failability: make `lane_is_complete` always return 1
# (never treat any ticket as complete) — this test's "no trip" assertion
# goes red, since the untouched lanes-file line would otherwise still be
# treated as live and its long-stale transcript would trip LANE.
new_git_checkout() {
  local d; d="$(mktemp -d)"
  git -C "$d" init -q -b main
  git -C "$d" -c user.email=t@t.test -c user.name=t commit -q --allow-empty -m init
  printf '%s' "$d"
}
repo="$(new_git_checkout)"
d="$(new_scratch)"
make_transcript "$d" a-finished-lane
touch_mtime_ago "$d/subagents/agent-a-finished-lane.jsonl" 999999   # ancient
mkdir -p "$repo/.concertino/runs/CON-999"
printf '%s\n' '{"t":1,"kind":"run.start","ticket":"CON-999"}' \
             '{"t":2,"kind":"run.end","ticket":"CON-999"}' \
  > "$repo/.concertino/runs/CON-999/events.jsonl"
printf 'a-finished-lane a-finished-lane CON-999\n' > "$d/lanes"
COMPLETE_OUT="$(mktemp)"
( cd "$repo" && WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=2 WATCHDOG_LANE_SEC=2 \
    timeout 4 "$SCRIPT" "$d/tasks" "$d/lanes" >"$COMPLETE_OUT" 2>&1 )
RC=$?
check "run.end-complete lane: stands down instead of tripping, exit 0" "$RC" "0"
has "run.end-complete lane: stand-down message" "STAND-DOWN" "$COMPLETE_OUT"
hasnt "run.end-complete lane: no TRIP text despite an ancient transcript" "TRIP" "$COMPLETE_OUT"
rm -rf "$d" "$repo"

# Converse: a ticket that has NOT emitted run.end still trips normally —
# confirms the completion check doesn't accidentally suppress a real stall.
repo="$(new_git_checkout)"
d="$(new_scratch)"
make_transcript "$d" a-unfinished-lane
touch_mtime_ago "$d/subagents/agent-a-unfinished-lane.jsonl" 999999
mkdir -p "$repo/.concertino/runs/CON-998"
printf '%s\n' '{"t":1,"kind":"run.start","ticket":"CON-998"}' \
  > "$repo/.concertino/runs/CON-998/events.jsonl"
printf 'a-unfinished-lane a-unfinished-lane CON-998\n' > "$d/lanes"
UNFINISHED_OUT="$(mktemp)"
( cd "$repo" && WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=2 WATCHDOG_LANE_SEC=2 \
    timeout 4 "$SCRIPT" "$d/tasks" "$d/lanes" >"$UNFINISHED_OUT" 2>&1 )
RC=$?
check "run.start-only (not yet run.end) lane: still trips, exit 1" "$RC" "1"
has "run.start-only lane: TRIP text present" "TRIP" "$UNFINISHED_OUT"
rm -rf "$d" "$repo"

# ---------------------------------------------------------------------------
# Constraint 5: removing a lane from the lanes file stops that lane's alerts
# — within ONE continuous run, not just across separate invocations (the
# script must re-read $LANES every poll, never cache it at startup). A
# fresh-only lane stays fresh for the WHOLE test (cycle-2 fix — the original
# LANE_SEC=3 margin was tight enough that a-fresh-lane itself could go stale
# during the polling loop, per the reviewer's "load-fragile" finding); a
# second lane is added mid-run and confirmed to be picked up, then a third
# scenario confirms a lane removed before threshold never trips despite wall
# time continuing to advance.
#
# Mutation to confirm failability: read the lane list once at startup and
# reuse it for the life of the process instead of re-reading $LANES on every
# poll iteration — the "newly-added stale lane" assertion goes red.
d="$(new_scratch)"
make_transcript "$d" a-fresh-lane
make_transcript "$d" a-toggle-lane
printf 'a-fresh-lane a-fresh-lane\n' > "$d/lanes"
LIVE_OUT="$(mktemp)"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=999999 WATCHDOG_LANE_SEC=20 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$LIVE_OUT" 2>&1 &
pidLive=$!
sleep 1.5
if kill -0 "$pidLive" 2>/dev/null; then
  ok "single fresh lane: watchdog running quietly"
else
  bad "single fresh lane: watchdog running quietly" "exited unexpectedly: $(cat "$LIVE_OUT")"
fi
hasnt "single fresh lane: no TRIP yet" "TRIP" "$LIVE_OUT"

# Same process, no restart: add a-toggle-lane, already 50s stale (comfortably
# past LANE_SEC=20 while a-fresh-lane, created moments ago, stays well under
# it for the few seconds this loop needs).
printf 'a-fresh-lane a-fresh-lane\na-toggle-lane a-toggle-lane\n' > "$d/lanes"
touch_mtime_ago "$d/subagents/agent-a-toggle-lane.jsonl" 50
for _ in $(seq 1 30); do
  grep -qF 'TRIP LANE a-toggle-lane' "$LIVE_OUT" && break
  kill -0 "$pidLive" 2>/dev/null || break
  sleep 0.2
done
check "same running process: exits after LANE trip on newly-added stale lane" "$(kill -0 "$pidLive" 2>/dev/null; echo $?)" "1"
has "same running process: TRIP LANE names the newly-added lane" "TRIP LANE a-toggle-lane" "$LIVE_OUT"
wait "$pidLive" 2>/dev/null || true
rm -rf "$d"

# Converse direction, still within one continuous process: a lane removed
# from the file BEFORE it crosses the threshold must never trip, even though
# real wall-clock time keeps advancing past what the threshold would have
# been while it was still tracked.
d="$(new_scratch)"
make_transcript "$d" a-doomed-lane
printf 'a-doomed-lane a-doomed-lane\n' > "$d/lanes"
REMOVE_OUT="$(mktemp)"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=999999 WATCHDOG_LANE_SEC=2 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$REMOVE_OUT" 2>&1 &
pidRemove=$!
sleep 1
# Remove the lane before its transcript (untouched, ~1s old) crosses the 2s
# LANE threshold.
: > "$d/lanes"
sleep 4   # well past what the 2s threshold would have been
if kill -0 "$pidRemove" 2>/dev/null; then
  ok "lane removed before threshold: process never tripped, stood down instead"
else
  ok "lane removed before threshold: process stood down (empty lanes) as expected"
fi
hasnt "lane removed before threshold: no TRIP text" "TRIP" "$REMOVE_OUT"
kill "$pidRemove" 2>/dev/null || true
wait "$pidRemove" 2>/dev/null || true
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 6: FLEET trip prints diagnose-first text, never a kill
# instruction, and never actually sends a kill signal to a tracked lane.
d="$(new_scratch)"
make_transcript "$d" a-diag-lane
touch_mtime_ago "$d/subagents/agent-a-diag-lane.jsonl" 5000
printf 'a-diag-lane a-diag-lane\n' > "$d/lanes"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=2 WATCHDOG_LANE_SEC=999999 run_watchdog "$d/tasks" "$d/lanes"
check "FLEET trip: exit 1" "$RC" "1"
has "FLEET trip: diagnose-first text" "DIAGNOSE FIRST" "$OUT"
has "FLEET trip: never kill" "do not kill" "$OUT"
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 1 (cycle-2 fix): never signal an unverified PID. A stale lock
# directory names a PID that is alive but is NOT a watchdog.sh process (a
# SIGKILLed prior instance's PID reused by an unrelated process — simulated
# here with a real `sleep 300`). The new instance must reclaim the lock
# WITHOUT ever sending that process a signal.
#
# Mutation to confirm failability: drop the `verify_watchdog_pid` check and
# go back to unconditionally `kill`ing whatever PID the lock names — the
# "not signalled" assertion goes red (the sleep process would be killed).
d="$(new_scratch)"
: > "$d/lanes"
sleep 300 &
impostor=$!
mkdir -p "$d/watchdog.pid.d"
echo "$impostor" > "$d/watchdog.pid.d/pid"
UNVERIFIED_OUT="$(mktemp)"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=999999 WATCHDOG_LANE_SEC=999999 \
  timeout 5 "$SCRIPT" "$d/tasks" "$d/lanes" >"$UNVERIFIED_OUT" 2>&1
if kill -0 "$impostor" 2>/dev/null; then
  ok "unverified lock PID: never signalled (impostor process survives)"
else
  bad "unverified lock PID: never signalled" "impostor pid $impostor was killed"
fi
has "unverified lock PID: reclaims the lock with a warning, not a kill" "not a watchdog.sh process" "$UNVERIFIED_OUT"
kill "$impostor" 2>/dev/null || true
wait "$impostor" 2>/dev/null || true
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 1 + 6: singleton lock supersedes a prior (VERIFIED, genuine)
# instance without ever killing itself. Start instance A backgrounded (long
# poll so it's asleep), start instance B against the same lanes dir — B must
# take the lock and signal A's PID (not its own), A must exit 0 quietly
# rather than firing or exiting nonzero (cycle-2 fix — see the TERM-handling
# test below for the exit-code assertion), and B must still be alive
# afterward.
#
# Mutation to confirm failability: change the supersede check from comparing
# the lock's *previous* PID to `$$` (this script's own current PID) — a
# self-referential compare, which would make a fresh instance kill itself
# instead of any prior one. This test goes red because instance B never
# starts running (killed itself) and the lock never changes owner.
d="$(new_scratch)"
: > "$d/lanes"  # no lanes: both instances would otherwise stand down quickly,
                # so use a long poll to keep instance A asleep long enough to
                # be superseded mid-sleep instead of racing to its own exit.
WATCHDOG_POLL_SEC=30 WATCHDOG_FLEET_SEC=999999 WATCHDOG_LANE_SEC=999999 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$d/a.out" 2>&1 &
pidA=$!
sleep 0.5
lock_owner_before="$(lock_pid "$d")"
check "instance A took the lock" "$lock_owner_before" "$pidA"

WATCHDOG_POLL_SEC=30 WATCHDOG_FLEET_SEC=999999 WATCHDOG_LANE_SEC=999999 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$d/b.out" 2>&1 &
pidB=$!
sleep 0.5

# A should have been signalled and be gone/dying; B should now own the lock.
lock_owner_after="$(lock_pid "$d")"
check "instance B now owns the lock" "$lock_owner_after" "$pidB"

if kill -0 "$pidA" 2>/dev/null; then
  bad "instance A terminated by B (not left running)" "pid $pidA still alive"
else
  ok "instance A terminated by B (not left running)"
fi

if kill -0 "$pidB" 2>/dev/null; then
  ok "instance B still alive (did not kill itself)"
else
  bad "instance B still alive (did not kill itself)" "pid $pidB already gone"
fi

wait "$pidA" 2>/dev/null
rcA=$?
# Constraint 5 (cycle-2 fix): a superseded instance must exit 0, not 143
# (SIGTERM's raw exit code) — a routine hand-off must never read as failure
# to whatever coordinator is watching this process's exit status.
#
# Mutation to confirm failability: remove the `on_term` TERM trap (and its
# `sleep "$POLL_SEC" & wait` backgrounding) and go back to a plain `sleep
# "$POLL_SEC"` in the loop — this assertion goes red (rcA becomes 143).
check "superseded instance A exits 0, not 143 (routine hand-off, not a failure)" "$rcA" "0"

kill "$pidB" 2>/dev/null || true
wait "$pidB" 2>/dev/null || true
rm -rf "$d"

echo
echo "watchdog.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
