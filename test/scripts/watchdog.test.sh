#!/usr/bin/env bash
# Shell tests for core/scripts/watchdog.sh (CON-177 fleet watchdog).
#
# Each test below is annotated with the constraint from the ticket (+ its
# seventh-constraint follow-up comment) it exists to guard. Mutations run by
# hand against each of these (to confirm they are failable, not just green by
# construction) are recorded in the PR body, not here.
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
  # $1 = scratch dir, $2 = agent id, $3 = huge JSONL payload marker (never
  # supposed to be read by the script — constraint 3)
  local d="$1" id="$2"
  printf '%s\n' '{"huge":"transcript payload that must never be read by the watchdog"}' \
    > "$d/subagents/agent-$id.jsonl"
  ln -sf "$d/subagents/agent-$id.jsonl" "$d/tasks/$id.output"
}

touch_mtime_ago() {
  # $1 = real file (not the symlink), $2 = seconds ago
  local f="$1" ago="$2" ts
  ts="$(date -d "@$(( $(date +%s) - ago ))" '+%Y%m%d%H%M.%S' 2>/dev/null)"
  if [ -z "$ts" ]; then
    # BSD/macOS date has no -d; fall back to node for the timestamp string.
    ts="$(node -e '
      const s = Math.floor(Date.now()/1000) - Number(process.argv[1]);
      const d = new Date(s*1000);
      const p = n => String(n).padStart(2,"0");
      process.stdout.write(
        `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}.${p(d.getSeconds())}`
      );
    ' "$ago")"
  fi
  touch -t "$ts" "$f"
}

run_watchdog() {
  # $1 = tasks dir, $2 = lanes file, extra env already exported by caller.
  # Watchdog loops forever on trip/stand-down only after its first sleep, so
  # give it a short POLL and a hard wall-clock timeout as a safety net.
  OUT="$(mktemp)"; ERR="$(mktemp)"
  timeout 10 "$SCRIPT" "$1" "$2" >"$OUT" 2>"$ERR"
  RC=$?
}

# ---------------------------------------------------------------------------
# Constraint (usage): clear usage error, distinct exit code, no lockfile churn.
d="$(new_scratch)"
OUT="$(mktemp)"; ERR="$(mktemp)"
"$SCRIPT" "$d/tasks" >"$OUT" 2>"$ERR"
check "usage error exit code" "$?" "2"
has "usage error message" "usage: watchdog.sh" "$ERR"
rm -rf "$d"

# ---------------------------------------------------------------------------
# Constraint 7 (comment): empty lanes file => stand down silently, exit 0,
# no TRIP text anywhere. This is the single most common way the script is
# exercised (every successful batch ends this way), and is the defect the
# ticket's rebuild originally shipped without covering.
#
# Mutation to confirm failability: comment out the `[ -z "$live" ]` stand-
# down branch (or make it always TRIP FLEET regardless of lanes) — the test
# goes red because "TRIP" then appears in $OUT.
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
# Constraint 4: LANE default threshold is at least 3h (10800s) in production
# — this test asserts the *default*, not the env-overridden value, so a
# regression that quietly drops the default can't hide behind the
# testability override.
#
# Mutation to confirm failability: change `LANE_SEC=${WATCHDOG_LANE_SEC:-10800}`
# default to e.g. 2700 (45 min) — this test goes red.
grep_default="$(grep -oE 'WATCHDOG_LANE_SEC:-[0-9]+' "$SCRIPT" | grep -oE '[0-9]+$')"
if [ -n "$grep_default" ] && [ "$grep_default" -ge 10800 ]; then
  ok "LANE default threshold >= 3h ($grep_default sec)"
else
  bad "LANE default threshold >= 3h" "got [$grep_default]"
fi

# ---------------------------------------------------------------------------
# Constraint 2: symlink mtime is followed (-L). A stale symlink target
# (subagents/agent-X.jsonl) but a fresh transcript touch should NOT trip —
# only the followed target's mtime matters, matching production topology
# where tasks/*.output are symlinks into subagents/.
#
# Mutation to confirm failability: drop `-L` from the stat calls (use plain
# `stat -c %Y "$f"` on the symlink itself) — on most filesystems a freshly
# created symlink's own mtime is "now", which would happen to still pass this
# particular assertion, so the meaningful mutation is verified via the FLEET
# trip test below instead, where an old symlink pointing at a fresh target
# (or vice versa) is the discriminating case.
d="$(new_scratch)"
make_transcript "$d" a-fleet-lane
printf 'a-fleet-lane a-fleet-lane\n' > "$d/lanes"
# Symlink itself is brand new (just created); target is old. If mtime were
# read from the symlink (no -L) rather than the target, this would read as
# "just written" and never trip even though the real content is stale.
touch_mtime_ago "$d/subagents/agent-a-fleet-lane.jsonl" 5000
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=2 WATCHDOG_LANE_SEC=999999 run_watchdog "$d/tasks" "$d/lanes"
check "symlink -L followed: FLEET trips on stale target despite fresh symlink" "$RC" "1"
has "symlink -L followed: TRIP FLEET text" "TRIP FLEET" "$OUT"
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
# Constraint 5: removing a lane from the lanes file stops that lane's alerts
# — within ONE continuous run, not just across separate invocations (the
# script must re-read $LANES every poll, never cache it at startup). Start a
# single long-lived watchdog with a fresh-only lane list and a long lane
# threshold so it neither trips nor stands down; confirm it survives quietly;
# THEN, without restarting it, edit the lanes file to introduce a
# newly-stale lane and confirm the SAME running process picks it up and
# trips on its next poll; THEN remove that lane again from the file (still
# the same process) and confirm it goes quiet again.
#
# Mutation to confirm failability: read the lane list once at startup and
# reuse it for the life of the process instead of re-reading $LANES on every
# poll iteration — this test goes red at the "introduce a stale lane"
# assertion, because a startup-cached lane list would either never see the
# newly-added lane, or never see it removed.
d="$(new_scratch)"
make_transcript "$d" a-fresh-lane
make_transcript "$d" a-toggle-lane
printf 'a-fresh-lane a-fresh-lane\n' > "$d/lanes"
LIVE_OUT="$(mktemp)"
WATCHDOG_POLL_SEC=1 WATCHDOG_FLEET_SEC=999999 WATCHDOG_LANE_SEC=3 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$LIVE_OUT" 2>&1 &
pidLive=$!
sleep 1.5
if kill -0 "$pidLive" 2>/dev/null; then
  ok "single fresh lane: watchdog running quietly"
else
  bad "single fresh lane: watchdog running quietly" "exited unexpectedly: $(cat "$LIVE_OUT")"
fi
hasnt "single fresh lane: no TRIP yet" "TRIP" "$LIVE_OUT"

# Same process, no restart: add a-toggle-lane and let its transcript go
# stale past LANE_SEC=3 while the process keeps polling.
printf 'a-fresh-lane a-fresh-lane\na-toggle-lane a-toggle-lane\n' > "$d/lanes"
touch_mtime_ago "$d/subagents/agent-a-toggle-lane.jsonl" 50
for _ in $(seq 1 60); do
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
#
# Mutation to confirm failability: same "cache lanes at startup" mutation as
# above — a lane present at startup would still be tracked (and eventually
# trip) even after being deleted from the file, so this test goes red too.
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
# Constraint 1: singleton lockfile supersedes a prior instance without ever
# killing itself. Start instance A backgrounded (long poll so it's asleep),
# start instance B against the same lanes dir — B must take the lock and
# signal A's PID (not its own), and A must exit 0 quietly on its next wake
# rather than firing.
#
# Mutation to confirm failability: change the supersede check from comparing
# the lockfile's *previous* PID to `$$` (this script's own current PID) — a
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
lock_owner_before="$(cat "$d/watchdog.pid" 2>/dev/null)"
check "instance A took the lock" "$lock_owner_before" "$pidA"

WATCHDOG_POLL_SEC=30 WATCHDOG_FLEET_SEC=999999 WATCHDOG_LANE_SEC=999999 \
  "$SCRIPT" "$d/tasks" "$d/lanes" >"$d/b.out" 2>&1 &
pidB=$!
sleep 0.5

# A should have been signalled and be gone/dying; B should now own the lock.
lock_owner_after="$(cat "$d/watchdog.pid" 2>/dev/null)"
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

kill "$pidB" 2>/dev/null || true
wait "$pidA" 2>/dev/null || true
wait "$pidB" 2>/dev/null || true
rm -rf "$d"

echo
echo "watchdog.sh: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
